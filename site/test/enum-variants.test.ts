import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, memberSignals, pageMembersOf, symbolsForProduct, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiMemberSections, memberTable, memberTableColumns, splitVariantMembers, variantPayloads } from '../src/lib/api-sections'
import mentionsData from '../src/data/mentions.json'
import { productApiHref } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { apiComponents } from './api-components'
import { loadAstroTemplate, withoutScope } from './astro-templates'

// A reference page asks the content collection for its sidebar; none of these checks reads one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const model = API_MODELS.rs
const hrefFor = (symbol: ApiSymbol) => `/en/rs/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'rs')
const raw: { symbols: ApiSymbol[] } = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8'))

/**
 * What the committed file says, written out apart from the predicates under test: an enum's variants are its constants,
 * and a variant's payload is its attribute children in file order.
 */
const rawChildren = (id: string) => raw.symbols.filter((entry) => entry.parent === id)
const rawVariants = (enumId: string) => rawChildren(enumId).filter((entry) => entry.kind === 'constant')
const rawPayload = (variantId: string) => rawChildren(variantId).filter((entry) => entry.kind === 'attribute')
const rawEnums = raw.symbols.filter((entry) => entry.kind === 'enum' && rawVariants(entry.id).length > 0)
/** The payload as Rust writes it, or nothing for a variant that carries no fields. */
function written(variant: ApiSymbol): string {
  const fields = rawPayload(variant.id)
  if (fields.length === 0) return ''
  return variant.variant === 'tuple' ? `(${fields.map((field) => field.type).join(', ')})`
    : `{ ${fields.map((field) => `${field.name}: ${field.type}`).join(', ')} }`
}
/**
 * What the file lets a Payload cell say. A variant the file gives no shape is unknown, whatever its source declares;
 * one with a shape and no fields carries nothing; the rest carry their fields.
 */
const cellKind = (variant: ApiSymbol) => variant.variant === undefined ? 'unknown' as const : rawPayload(variant.id).length === 0 ? 'none' as const : 'fields' as const
/** The text of the Payload cell: the sr-only words of a variant with none are part of it. */
const cellText = (variant: ApiSymbol) => ({ fields: written(variant), none: 'No payload', unknown: 'Not extracted' })[cellKind(variant)]
/** The same cell in Markdown, where a variant with none is left empty. */
const markdownCell = (variant: ApiSymbol) => ({ fields: written(variant), none: '', unknown: '*Not extracted*' })[cellKind(variant)]

/** A payload cell of a Markdown row with link syntax, code spans and pipe escapes removed. */
const payloadText = (row: string) => row.split(' | ')[1]!.replace(/\[`([^`]*)`\]\([^)]*\)/g, '$1').replaceAll('`', '').replaceAll('\\|', '|')
const sectionRows = (markdown: string, heading: string) => {
  const lines = markdown.split('\n')
  const start = lines.indexOf(heading)
  if (start < 0) return []
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start, end < 0 ? undefined : end).filter((line) => line.startsWith('| [`'))
}

/**
 * Draw the table of every enum with the real components, then read the cells back against the file.
 * `html` is what the page is drawn from and `markdown` what the export is, so a case can corrupt one and not the other.
 * Each problem starts with the id of the enum or variant it is about.
 */
async function sweep(html: ApiSymbol[], markdown: ApiSymbol[] = html, only?: string[]): Promise<string[]> {
  const { members, doc } = await apiComponents()
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  const problems: string[] = []
  const tabled: string[] = []
  for (const owner of html.filter((entry) => entry.kind === 'enum' && (!only || only.includes(entry.id)))) {
    const table = memberTable(owner, membersOf({ ...model, symbols: html }, owner), 'rs')
    if (!table) continue
    tabled.push(owner.id)
    win.document.body.innerHTML = await container.renderToString(members, { props: {
      owner, members: table.rows, index, hrefFor, columns: table.columns, label: table.label, payloads: variantPayloads(html, table.rows), repeated: true,
    } })
    const rows = [...win.document.querySelectorAll('tbody tr')]
    const expected = rawVariants(owner.id)
    const ids = (list: { id: string }[]) => list.map((entry) => entry.id).toSorted()
    if (ids(rows).join() !== ids(expected.map((entry) => ({ id: `member-${entry.publicId ?? entry.id}` }))).join()) {
      problems.push(`${owner.id}: ${rows.length} rows for ${expected.length} variants`)
    }
    const exported = sectionRows(symbolMarkdown({ model: { ...model, symbols: markdown }, symbol: markdown.find((entry) => entry.id === owner.id)!, index, hrefFor }), '## Variants')
    if (exported.length !== expected.length) problems.push(`${owner.id}: ${exported.length} Markdown rows for ${expected.length} variants`)
    for (const variant of expected) {
      const row = rows.find((entry) => entry.id === `member-${variant.publicId ?? variant.id}`)
      if (!row) continue
      const want = cellText(variant)
      const cell = row.querySelector('td:nth-child(2)')!
      if (cell.textContent !== want) problems.push(`${variant.id}: payload ${JSON.stringify(cell.textContent)}, want ${JSON.stringify(want)}`)
      // Three kinds of cell stay apart: a unit variant is empty to the eye and reads No payload to a screen reader,
      // one without a shape says so, and the rest draw their fields.
      const kind = cellKind(variant)
      const shape = { none: cell.classList.contains('api-payload-none') && cell.children.length === 1 && cell.querySelector(':scope > .sr-only') !== null,
        unknown: cell.classList.length === 0 && cell.querySelector(':scope > .api-payload-unknown') !== null,
        fields: cell.classList.length === 0 && cell.querySelector(':scope > code.api-literal') !== null && cell.querySelector('.sr-only, .api-payload-unknown') === null }[kind]
      if (!shape) problems.push(`${variant.id}: the cell is not that of a variant with ${kind === 'fields' ? 'fields' : kind === 'none' ? 'no payload' : 'no shape'}`)
      if (row.querySelector('th a')?.getAttribute('href') !== hrefFor(variant)) problems.push(`${variant.id}: Case does not link to its own page`)
      // The summary is drawn as every member summary is: by ApiDoc, in the member's context. Both pass through the
      // DOM, which spells an apostrophe or an entity one way.
      const scratch = win.document.createElement('td')
      scratch.innerHTML = variant.doc?.summary ? await container.renderToString(doc, { props: { text: variant.doc.summary, index, context: variant, citations: false } }) : ''
      if (row.querySelector('td:last-child')!.innerHTML.trim() !== scratch.innerHTML.trim()) problems.push(`${variant.id}: Description is not the rendered summary`)
      const line = exported.find((entry) => entry.includes(`](${hrefFor(variant)})`))
      if (line && payloadText(line) !== markdownCell(variant)) problems.push(`${variant.id}: Markdown payload ${JSON.stringify(payloadText(line))}, want ${JSON.stringify(markdownCell(variant))}`)
    }
  }
  if (!only) {
    const missing = rawEnums.map((entry) => entry.id).filter((id) => !tabled.includes(id))
    if (missing.length) problems.push(`${missing.join(', ')}: an enum with variants has no table`)
  }
  return problems
}

// The table, the contents rail and the badges are the page's own; types and summaries draw plain text.
const PAGE = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiScalarMembers.astro']
let template: Promise<unknown> | undefined
async function page(id: string) {
  template ??= loadAstroTemplate('components/api/ApiReference.astro', {
    real: PAGE,
    stubs: {
      'components/api/ApiType.astro': '---\nconst { type, repeated } = Astro.props\n---\n<span data-type data-repeated={String(Boolean(repeated))}>{type}</span>',
      'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n{text}',
    },
  })
  const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
  const win = new Window()
  windows.push(win)
  const owner = model.symbols.find((entry) => entry.id === id)!
  win.document.body.innerHTML = withoutScope(await container.renderToString(await template as never, {
    request: new Request(`https://libtmux.org/en/rs/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model, owner },
  }))
  return win.document
}
const contents = (document: Window['document']) => [...document.querySelectorAll('nav[aria-label="On this page"] a')].map((link) => [link.getAttribute('href'), link.textContent])

const without = (id: string) => model.symbols.filter((entry) => entry.id !== id)
const retyped = (id: string, type: string) => model.symbols.map((entry) => entry.id === id ? { ...entry, type } : entry)
const reshaped = (id: string, variant: ApiSymbol['variant']) => model.symbols.map((entry) => entry.id === id ? { ...entry, variant } : entry)
function swapped(first: string, second: string) {
  const symbols = [...model.symbols]
  const [a, b] = [symbols.findIndex((entry) => entry.id === first), symbols.findIndex((entry) => entry.id === second)]
  ;[symbols[a], symbols[b]] = [symbols[b]!, symbols[a]!]
  return symbols
}
const unsummarized = (id: string) => model.symbols.map((entry) => entry.id === id ? { ...entry, doc: undefined } : entry)
const withField = (variantId: string): ApiSymbol[] => [...model.symbols, {
  id: `${variantId}.extra`, name: 'extra', kind: 'attribute', parent: variantId, type: 'u8', modifiers: [], signatures: [], source: model.symbols[0]!.source,
}]

describe('the Variants table of every Rust enum', () => {
  it('has one row per variant, its payload as Rust writes it, and an empty cell for a variant without one', async () => {
    expect(await sweep(model.symbols)).toEqual([])
  }, 120_000)

  it('covers each kind of variant the file has, so the sweep cannot pass on one kind alone', () => {
    const variants = rawEnums.flatMap((entry) => rawVariants(entry.id))
    const kind = (variant: ApiSymbol) => `${variant.variant ?? 'unclassified'}${written(variant) ? ' with a payload' : ''}`
    expect(new Set(variants.map(kind))).toEqual(new Set(['struct with a payload', 'tuple with a payload', 'unit', 'unclassified']))
  })

  const struct = 'control.Event.SessionRenamed'
  const tuple = 'control.Subscription.Window'
  const unit = 'control.Event.SessionsChanged'
  // A variant the file gives no shape: its source declares fields, which the model does not keep.
  const unshaped = 'error.Error.Spawn'
  const enumOf = (id: string) => [id.split('.').slice(0, -1).join('.')]
  // Each corrupts the data one page and export are drawn from, and must be named by the sweep and by nothing else.
  it.each([
    ['two fields swapped', swapped(`${struct}.session`, `${struct}.name`), struct],
    ['a field dropped', without(`${struct}.name`), struct],
    ['a field retyped', retyped(`${struct}.name`, 'u64'), struct],
    ['a tuple drawn with names', reshaped(tuple, 'struct'), tuple],
    ['a unit variant given a field', withField(unit), unit],
    ['a summary lost', unsummarized(struct), struct],
    ['a variant without a shape drawn as one without a payload', reshaped(unshaped, 'unit'), unshaped],
    ['a unit variant drawn as one without a shape', reshaped(unit, undefined), unit],
  ] as const)('fails on its variant only when %s', async (_, symbols, victim) => {
    const problems = await sweep([...symbols], [...symbols], enumOf(victim))
    // The page and the export are each checked, so a corrupted variant can be named twice.
    expect([...new Set(problems.map((problem) => problem.split(':')[0]))], problems.join('\n')).toEqual([victim])
  }, 120_000)

  it('fails when a variant is dropped from the data the page is drawn from', async () => {
    const owner = 'window.SplitDirection'
    const variants = rawVariants(owner).length
    const problems = await sweep(without(`${owner}.Above`), model.symbols, [owner])
    expect(problems).toContainEqual(`${owner}: ${variants - 1} rows for ${variants} variants`)
  }, 120_000)

  it('fails the Markdown parity when the export lacks a field the page draws', async () => {
    const struct = 'control.Event.SessionRenamed'
    const problems = await sweep(model.symbols, without(`${struct}.name`), ['control.Event'])
    expect(problems.filter((problem) => problem.startsWith(struct))).toEqual([
      `${struct}: Markdown payload "{ session: SessionId }", want "{ session: SessionId, name: TmuxText }"`,
    ])
  }, 120_000)
})

describe('which owners get the table', () => {
  const enumNamed = (id: string) => model.symbols.find((entry) => entry.id === id)!

  it('leaves the methods of an enum in the member list and takes only the variants', () => {
    const owner = enumNamed('control.Event')
    const members = membersOf(model, owner)
    const { variants, rest } = splitVariantMembers(owner, members, 'rs')
    expect(variants.map((entry) => entry.id).toSorted()).toEqual(rawVariants(owner.id).map((entry) => entry.id).toSorted())
    expect(rest.map((entry) => entry.kind)).toEqual(rest.map(() => 'method'))
    expect(rest.length).toBeGreaterThan(0)
    expect(memberTable(owner, members, 'rs')).toMatchObject({ columns: 'variants', label: 'Variants', id: 'api-variants' })
    // Methods beside the variants keep the list; an enum of only variants is one table.
    expect(memberTableColumns(owner, members, 'rs')).toBeUndefined()
    const only = enumNamed('window.SplitDirection')
    expect(memberTableColumns(only, membersOf(model, only), 'rs')).toBe('variants')
  })

  it('does not take a typed constant of an enum for a variant', () => {
    const owner = enumNamed('window.SplitDirection')
    const constant: ApiSymbol = { ...membersOf(model, owner)[0]!, id: 'window.SplitDirection.MAX', name: 'MAX', variant: undefined, type: 'u8', value: '4' }
    const { variants, rest } = splitVariantMembers(owner, [...membersOf(model, owner), constant], 'rs')
    expect(variants).not.toContain(constant)
    expect(rest).toEqual([constant])
  })

  it('leaves an enum of every other port, and a Rust struct, without a variants table', () => {
    const owner = enumNamed('control.Event')
    expect(memberTable(owner, membersOf(model, owner), 'csharp')).toBeUndefined()
    expect(memberTable(owner, membersOf(model, owner), undefined)).toBeUndefined()
    const others = Object.entries(API_MODELS).filter(([port]) => port !== 'rs')
      .flatMap(([port, other]) => other.symbols.filter((entry) => entry.kind === 'enum').map((entry) => [port, other, entry] as const))
    expect(others.length).toBeGreaterThan(0)
    for (const [port, other, entry] of others) expect(memberTable(entry, membersOf(other, entry), port), `${port} ${entry.id}`).toBeUndefined()
    const struct = enumNamed('control.Event.Output')
    expect(memberTable(struct, membersOf(model, struct), 'rs')).toMatchObject({ columns: 'fields', label: 'Fields', id: 'api-fields' })
  })

  it('names the variants block in the section navigation, ahead of the members', () => {
    expect(apiMemberSections({ fields: 3, members: 2, label: 'Members', fieldsLabel: 'Variants', fieldsId: 'api-variants', groups: [] })).toEqual([
      { id: 'api-variants', label: 'Variants', count: 3 },
      { id: 'api-members', label: 'Members', count: 2 },
    ])
    // The id stays api-fields unless a caller names another, as every existing caller does.
    expect(apiMemberSections({ fields: 1, members: 0, label: 'Members', groups: [] })[0]).toMatchObject({ id: 'api-fields' })
  })
})

describe('an enum page', () => {
  it('opens an enum with methods on a counted Variants table, then lists the methods under Members', async () => {
    const document = await page('control.Event')
    const variants = rawVariants('control.Event')
    const methods = rawChildren('control.Event').filter((entry) => entry.kind === 'method')
    expect(methods.length).toBeGreaterThan(0)

    const heading = document.querySelector('h2#api-variants')!
    expect(heading.firstChild?.textContent).toBe('Variants')
    expect(heading.querySelector('.api-section-count')?.textContent).toBe(String(variants.length))
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('href')).toBe('#api-variants')
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Variants')
    // Its own wrapper: .api-members would hand this bar to the sticky Members logic.
    const block = heading.parentElement!
    expect(block.classList.contains('api-field-table')).toBe(true)
    expect(block.classList.contains('api-members')).toBe(false)
    expect([...block.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Case', 'Payload', 'Description'])
    expect(block.querySelector('caption')?.textContent).toBe('Event variants')
    expect(block.querySelector(':scope > .api-scalar-box > table.api-scalar-members.table')).not.toBeNull()

    // The contents rail and the page agree on the word and the id.
    expect(contents(document)).toContainEqual(['#api-variants', 'Variants'])
    expect(contents(document)).toContainEqual(['#api-members', 'Members'])
    const rail = contents(document).map(([href]) => href)
    expect(rail.indexOf('#api-variants')).toBeLessThan(rail.indexOf('#api-members'))

    // The rest of the members keep their heading, count and list; no variant is in it.
    const members = document.querySelector('.api-members > h2#api-members')!
    expect(members.firstChild?.textContent).toBe('Members')
    expect(members.querySelector('.api-section-count')?.textContent).toBe(String(methods.length))
    expect([...document.querySelectorAll('.api-members .api-member-link')].map((link) => link.textContent).toSorted()).toEqual(methods.map((entry) => entry.name).toSorted())
    expect(heading.compareDocumentPosition(members) & 4, 'Variants come before Members').toBeGreaterThan(0)
  }, 60_000)

  it('keeps an anchor and a link to its own page on every variant, and gives each id once', async () => {
    const document = await page('control.Event')
    for (const variant of rawVariants('control.Event')) {
      const row = document.getElementById(`member-${variant.publicId ?? variant.id}`)!
      expect(row?.tagName, variant.id).toBe('TR')
      const link = row.querySelector('th[scope="row"] > a.api-member-link')!
      expect(link.textContent).toBe(variant.name)
      expect(link.getAttribute('href')).toBe(productApiHref(model, variant, 'latest'))
      expect(row.querySelector('td:nth-child(2)')?.textContent, variant.id).toBe(cellText(variant))
      expect(row.querySelector('td:last-child')?.textContent, variant.id).toBe(variant.doc?.summary ?? '')
    }
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size, 'every id on the page is unique').toBe(ids.length)
  }, 60_000)

  it('draws each payload type as a repeat of the variant page, and the table is the only place the page draws it', async () => {
    const document = await page('control.Event')
    const drawn = [...document.querySelectorAll('.api-field-table [data-type]')]
    expect(drawn).toHaveLength(rawVariants('control.Event').reduce((sum, variant) => sum + rawPayload(variant.id).length, 0))
    expect(drawn.every((cell) => cell.getAttribute('data-repeated') === 'true')).toBe(true)
    expect(document.querySelectorAll('.api-members [data-type]')).toHaveLength(0)
  }, 60_000)

  it('makes an enum of only variants one table under the sticky bar, headed Variants', async () => {
    const document = await page('window.SplitDirection')
    expect(document.querySelector('#api-variants')).toBeNull()
    const heading = document.querySelector('.api-members > h2#api-members')!
    expect(heading.firstChild?.textContent).toBe('Variants')
    expect(heading.querySelector('.api-section-count')?.textContent).toBe(String(rawVariants('window.SplitDirection').length))
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Variants')
    expect(contents(document)).toContainEqual(['#api-members', 'Variants'])
    expect(document.querySelector('.api-members caption')?.textContent).toBe('SplitDirection variants')
    expect(document.querySelectorAll('.api-members tbody tr')).toHaveLength(rawVariants('window.SplitDirection').length)
    expect(document.querySelector('.api-members .api-member-list')).toBeNull()
    // A unit variant carries nothing: the cell shows nothing, as an empty Description cell does, and reads No payload.
    const cells = [...document.querySelectorAll('.api-members tbody td:nth-child(2)')]
    expect(cells).toHaveLength(rawVariants('window.SplitDirection').length)
    for (const cell of cells) {
      expect(cell.classList.contains('api-payload-none')).toBe(true)
      expect([...cell.children].map((child) => `${child.tagName} ${child.className} ${child.textContent}`)).toEqual(['SPAN sr-only No payload'])
    }
  }, 60_000)

  it('says a variant has no shape when the model holds none, and keeps No payload for a unit variant', async () => {
    const document = await page('error.Error')
    const cell = (name: string) => document.getElementById(`member-error.Error.${name}`)!.querySelector('td:nth-child(2)')!
    // Spawn declares fields in its source and the model keeps none, so an empty cell would read as "no payload".
    expect(cell('Spawn').textContent).toBe('Not extracted')
    expect(cell('Spawn').children[0]?.className).toBe('api-payload-unknown')
    expect(cell('Spawn').classList.length).toBe(0)
    expect(cell('UnrecognizedLayout').textContent).toBe('No payload')
    expect(cell('UnrecognizedLayout').classList.contains('api-payload-none')).toBe(true)
    // A hidden owner leaves its real unit variants without a shape too, so the page cannot tell them from a variant with fields.
    const hidden = await page('query.schema.FilterValueSchema')
    for (const name of ['Text', 'Bool', 'Many']) {
      expect(hidden.getElementById(`member-query.schema.FilterValueSchema.${name}`)!.querySelector('td:nth-child(2)')?.textContent, name).toBe('Not extracted')
    }
  }, 60_000)

  it('writes Variants in the heading, the contents rail and the Markdown export alike', async () => {
    const document = await page('control.Event')
    const owner = model.symbols.find((entry) => entry.id === 'control.Event')!
    const markdown = symbolMarkdown({ model, symbol: owner, index, hrefFor })
    expect(markdown).toContain('\n## Variants\n\n| Case | Payload | Description |\n| --- | --- | --- |\n')
    expect(markdown).toContain('\n## Members\n')
    expect(markdown).not.toContain('| Name | Type | Description |')
    expect(document.querySelector('h2#api-variants')?.firstChild?.textContent).toBe('Variants')
    expect(contents(document)).toContainEqual(['#api-variants', 'Variants'])
    const alone = model.symbols.find((entry) => entry.id === 'window.SplitDirection')!
    const aloneMarkdown = symbolMarkdown({ model, symbol: alone, index, hrefFor })
    expect(aloneMarkdown).toContain('\n## Variants\n')
    expect(aloneMarkdown).not.toContain('\n## Members\n')
    expect((await page('window.SplitDirection')).querySelector('.api-members > h2#api-members')?.firstChild?.textContent).toBe('Variants')
  }, 60_000)

  it('leaves the Fields block of a variant page as it was', async () => {
    const document = await page('control.Event.Output')
    expect(document.querySelector('h2#api-members')?.firstChild?.textContent).toBe('Fields')
    expect([...document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
    expect(document.querySelector('#api-variants')).toBeNull()
    expect([...document.querySelectorAll('[data-type]')].every((cell) => cell.getAttribute('data-repeated') === 'false')).toBe(true)
  }, 60_000)
})

const coreEnums = rawEnums.filter((entry) => entry.product === 'core').map((entry) => model.symbols.find((symbol) => symbol.id === entry.id)!)

describe('the payload types an enum page repeats', () => {
  /** The texts that the repeats draw with nothing to match them among the originals, one for one. */
  function unpaired(repeats: string[], originals: string[]): string[] {
    const left = [...originals]
    return repeats.filter((text) => { const at = left.indexOf(text); if (at < 0) return true; left.splice(at, 1); return false })
  }
  const texts = (nodes: Iterable<{ textContent: string | null }>) => [...nodes].map((node) => node.textContent!.trim())
  /** The flagged payload types of each variant row of an enum page, and the unflagged ones the variant's own page draws. */
  async function drawings(owner: ApiSymbol, variant: ApiSymbol) {
    const row = (await page(owner.id)).getElementById(`member-${variant.publicId ?? variant.id}`)!
    return { repeats: row.querySelectorAll('[data-type]'), originals: (await page(variant.id)).querySelectorAll('[data-type][data-repeated="false"]') }
  }

  it('draws each as a repeat, and has the variant\'s own page draw it again unflagged, for every enum', async () => {
    const problems: string[] = []
    let repeated = 0
    for (const owner of coreEnums) {
      const document = await page(owner.id)
      for (const variant of rawVariants(owner.id).filter((entry) => rawPayload(entry.id).length > 0)) {
        const row = document.getElementById(`member-${variant.publicId ?? variant.id}`)!
        const repeats = [...row.querySelectorAll('[data-type]')]
        const types = rawPayload(variant.id).map((field) => field.type!)
        if (texts(repeats).join('\n') !== types.join('\n')) problems.push(`${variant.id}: the row draws ${JSON.stringify(texts(repeats))}, not ${JSON.stringify(types)}`)
        if (!repeats.every((node) => node.getAttribute('data-repeated') === 'true')) problems.push(`${variant.id}: a payload type on the enum page is not flagged`)
        repeated += repeats.length
        const own = texts((await page(variant.id)).querySelectorAll('[data-type][data-repeated="false"]'))
        const lacking = unpaired(texts(repeats), own)
        if (lacking.length) problems.push(`${variant.id}: ${lacking.join(', ')} has no unflagged drawing on the variant's page`)
      }
    }
    expect(problems).toEqual([])
    // An enum page with nothing flagged would pass without proving anything.
    expect(repeated).toBeGreaterThan(0)
  }, 300_000)

  it('is found unpaired when the variant\'s page stops drawing the type, or draws it flagged (control)', async () => {
    const owner = model.symbols.find((entry) => entry.id === 'control.Event')!
    const variant = model.symbols.find((entry) => entry.id === 'control.Event.Output')!
    const { repeats, originals } = await drawings(owner, variant)
    expect(unpaired(texts(repeats), texts(originals))).toEqual([])
    expect(unpaired(texts(repeats), [])).toEqual(texts(repeats))
    expect(unpaired(texts(repeats), texts(originals).slice(1))).toEqual([texts(repeats)[0]])
  }, 60_000)
})

describe('the order of the Variants rows', () => {
  const signals = memberSignals('rs', mentionsData.mentions)
  const names = (document: Window['document']) => [...document.querySelectorAll('tbody th a')].map((link) => link.textContent!)
  const declared = (id: string) => rawVariants(id).map((entry) => entry.name)

  it('follows the page\'s member order, the one the sidebar uses, for every enum', async () => {
    for (const owner of coreEnums) {
      const expected = pageMembersOf(model, owner, signals).filter((member) => rawVariants(owner.id).some((entry) => entry.id === member.id)).map((member) => member.name)
      expect(names(await page(owner.id)), owner.id).toEqual(expected)
    }
  }, 300_000)

  it('pins today\'s order, tier then name, which is not declaration order; the fields of a payload keep declaration order', async () => {
    // Alphabetical, where the file declares the variants in the order tmux sends them.
    const event = names(await page('control.Event'))
    expect(event).toEqual(declared('control.Event').toSorted((a, b) => a.localeCompare(b)))
    expect(event).not.toEqual(declared('control.Event'))
    // A variant the guides discuss comes first, and the rest follow by name.
    const error = names(await page('error.Error'))
    expect(error[0]).toBe('OptionScopeMismatch')
    expect(error.slice(1)).toEqual(declared('error.Error').filter((name) => name !== 'OptionScopeMismatch').toSorted((a, b) => a.localeCompare(b)))
    const fields = [...(await page('control.Event')).getElementById('member-control.Event.SessionRenamed')!.querySelectorAll('[data-type]')].map((node) => node.textContent)
    expect(fields).toEqual(rawPayload('control.Event.SessionRenamed').map((field) => field.type))
    expect(rawPayload('control.Event.SessionRenamed').map((field) => field.name)).toEqual(['session', 'name'])
  }, 120_000)
})

describe('the narrow layout of a Payload cell', () => {
  const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
  // A unit variant's cell holds screen-reader text, so :empty no longer matches it; the stacked row must still drop it.
  const hidesNoPayload = (source: string) => /\.api-scalar-members td:is\(:empty, \.api-payload-none\)\s*\{\s*display:\s*none;/.test(source.slice(source.indexOf('@container api-scalar-members')))

  it('hides the cell of a unit variant with the empty cells', () => {
    expect(hidesNoPayload(css)).toBe(true)
  })

  it('fails when the rule loses the cell of a unit variant (control)', () => {
    expect(hidesNoPayload(css.replace('td:is(:empty, .api-payload-none)', 'td:empty'))).toBe(false)
  })
})

describe('the Markdown export of an enum', () => {
  const owner = model.symbols.find((entry) => entry.id === 'control.Event')!
  const markdown = symbolMarkdown({ model, symbol: owner, index, hrefFor })
  const variant = (id: string) => model.symbols.find((entry) => entry.id === id)!

  it('links each Case to its page and each payload type that resolves, as the page does', () => {
    const rows = sectionRows(markdown, '## Variants')
    const output = variant('control.Event.Output')
    const pane = index.linkType('PaneId', rawPayload(output.id)[0]!).find((span) => span.link)!.link!.href
    const bytes = index.linkType('Vec<u8>', rawPayload(output.id)[1]!).filter((span) => span.link).map((span) => span.link!.href)
    expect(rows.find((row) => row.startsWith(`| [\`Output\`](${hrefFor(output)}) |`))).toBe(
      `| [\`Output\`](${hrefFor(output)}) | \`{ pane: \`[\`PaneId\`](${pane})\`, bytes: \`[\`Vec\`](${bytes[0]})\`<\`[\`u8\`](${bytes[1]})\`> }\` | ${output.doc!.summary} |`)
  })

  it('leaves a unit variant a Case and a Description around an empty Payload', () => {
    const unit = variant('control.Event.SessionsChanged')
    expect(unit.variant).toBe('unit')
    expect(sectionRows(markdown, '## Variants')).toContainEqual(`| [\`SessionsChanged\`](${hrefFor(unit)}) |  | ${unit.doc!.summary} |`)
  })

  it('writes a tuple payload without names, and a payload with no resolvable type as one code span', () => {
    const subscription = model.symbols.find((entry) => entry.id === 'control.Subscription')!
    const rows = sectionRows(symbolMarkdown({ model, symbol: subscription, index, hrefFor }), '## Variants')
    const tuple = variant('control.Subscription.Window')
    const row = rows.find((entry) => entry.includes(`](${hrefFor(tuple)})`))!
    expect(payloadText(row)).toBe('(WindowId)')
    const unlinked = variant('options.OptionValueRefusal.OutOfRange')
    const refusal = model.symbols.find((entry) => entry.id === 'options.OptionValueRefusal')!
    const line = sectionRows(symbolMarkdown({ model, symbol: refusal, index, hrefFor }), '## Variants').find((entry) => entry.includes(`](${hrefFor(unlinked)})`))!
    expect(payloadText(line)).toBe('{ range: RangeInclusive<i64> }')
    // Text with no link between its parts is one code span: two side by side would fuse into one.
    expect(line.split(' | ')[1]).toMatch(/^`\{ range: RangeInclusive<`\[`i64`\]\([^)]*\)`> \}`$/)
  })

  it('keeps the methods of the enum in the member list and no variant in it', () => {
    const list = markdown.slice(markdown.indexOf('\n## Members\n'))
    for (const entry of rawVariants('control.Event')) expect(list, entry.id).not.toContain(`[\`${entry.name}\`](${hrefFor(entry)})`)
    for (const entry of rawChildren('control.Event').filter((child) => child.kind === 'method')) expect(list).toContain(`[\`${entry.name}\`](${hrefFor(entry)})`)
  })

  it('exports no variants table for another port\'s enum', () => {
    const csharp = API_MODELS.csharp
    const enumeration = csharp.symbols.find((entry) => entry.kind === 'enum' && csharp.symbols.some((child) => child.parent === entry.id))!
    const exported = symbolMarkdown({ model: csharp, symbol: enumeration, index: new SymbolIndex(csharp.symbols, (symbol) => `/en/csharp/latest/reference/${symbol.slug}/`, 'csharp') })
    expect(exported).not.toContain('| Case | Payload | Description |')
    expect(exported).not.toContain('## Variants')
  })
})

describe('a product page of a Rust enum', () => {
  const load = () => loadAstroTemplate('components/api/ProductApiPage.astro', {
    real: ['components/api/ApiScalarMembers.astro'],
    stubs: {
      'components/api/ApiEntry.astro': `---
const { symbol, member } = Astro.props
---
<dl data-entry={symbol.id} data-member={String(Boolean(member))}></dl>`,
      'components/api/ApiType.astro': '---\nconst { type, repeated } = Astro.props\n---\n<span data-type data-repeated={String(Boolean(repeated))}>{type}</span>',
      'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n{text}',
    },
  })
  async function render(id: string) {
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    const container = await experimental_AstroContainer.create()
    win.document.body.innerHTML = await container.renderToString(await load() as never, {
      props: { model, symbol, version: 'latest' }, request: new Request('https://libtmux.org/en/'),
    })
    return { symbol, document: win.document, members: symbolsForProduct(model, symbol.product as 'mcp').filter((entry) => entry.parent === id) }
  }

  it.each(['mcp.cli.Stop', 'mcp.policy.Toolset', 'src.BuildError'])('%s opens on a Variants table above its member details', async (id) => {
    const { document, members } = await render(id)
    const variants = members.filter((entry) => entry.kind === 'constant')
    const heading = document.querySelector('h2#api-variants')!
    expect(heading.firstChild?.textContent).toBe('Variants')
    expect(heading.querySelector('.api-section-count')?.textContent).toBe(String(variants.length))
    expect([...heading.parentElement!.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Case', 'Payload', 'Description'])
    const rows = [...heading.parentElement!.querySelectorAll('tbody tr')]
    expect(rows.map((row) => row.id).toSorted()).toEqual(variants.map((entry) => `member-${entry.publicId ?? entry.id}`).toSorted())
    for (const row of rows) {
      const variant = variants.find((entry) => row.id === `member-${entry.publicId ?? entry.id}`)!
      expect(row.querySelector('td:nth-child(2)')?.textContent, variant.id).toBe(cellText(variant))
    }
    // Each entry draws the payload types in full, so the table's drawings are the repeats.
    expect([...heading.parentElement!.querySelectorAll('[data-type]')].every((cell) => cell.getAttribute('data-repeated') === 'true')).toBe(true)
    // Every member keeps its entry, so the lower heading counts them all and reads as their detail.
    const details = document.querySelector('.api-members > h2#api-members')!
    expect(details.firstChild?.textContent).toBe('Member details')
    expect(details.querySelector('.api-section-count')?.textContent).toBe(String(members.length))
    expect(document.querySelectorAll('.api-members > dl[data-entry]')).toHaveLength(members.length)
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size, 'every id on the page is unique').toBe(ids.length)
  }, 60_000)
})

describe('the type names a Variants table repeats', () => {
  const script = fileURLToPath(new URL('../../scripts/check-type-links.mjs', import.meta.url))

  /** The plain names that `check-type-links` counts for rs in a site whose core reference holds these pages. */
  function plainNames(pages: Record<string, string>): number {
    const dir = mkdtempSync(join(tmpdir(), 'type-links-'))
    try {
      for (const [slug, html] of Object.entries(pages)) {
        const page = join(dir, 'rs', 'latest', 'reference', slug)
        mkdirSync(page, { recursive: true })
        writeFileSync(join(page, 'index.html'), `<html><body>${html}</body></html>`)
      }
      const listing = execFileSync(process.execPath, [script, dir, '--list'], { encoding: 'utf8' })
      return Number(/^rs\s+\d+ linked\s+(\d+) plain/m.exec(listing)![1])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  // RangeInclusive is a std type the model cannot resolve, so it renders as a plain name wherever a page draws it.
  const owner = model.symbols.find((entry) => entry.id === 'options.OptionValueRefusal')!
  const variant = model.symbols.find((entry) => entry.id === 'options.OptionValueRefusal.OutOfRange')!
  const fields = model.symbols.filter((entry) => entry.parent === variant.id && entry.kind === 'attribute')

  async function draw(repeated: boolean) {
    const { members } = await apiComponents()
    const container = await experimental_AstroContainer.create()
    // The variant's page draws its fields in a Fields table, which a type page leaves unflagged.
    const own = await container.renderToString(members, { props: { owner: variant, members: fields, index, hrefFor, columns: 'fields' } })
    const row = await container.renderToString(members, { props: {
      owner, members: [variant], index, hrefFor, columns: 'variants', payloads: variantPayloads(model.symbols, [variant]), repeated,
    } })
    return { own, row }
  }

  it('counts a name that fails to resolve once, where the variant page draws it', async () => {
    expect(fields.map((field) => field.type)).toEqual(['RangeInclusive<i64>'])
    const { own, row: quiet } = await draw(true)
    const { row: loud } = await draw(false)
    expect(plainNames({ [variant.slug!]: own }), 'the variant page alone').toBe(1)
    expect(plainNames({ [variant.slug!]: own, [owner.slug!]: quiet }), 'the variant page and an enum page that repeats it').toBe(1)
    // Without the flag the enum page counts the same name again: the case this guards.
    expect(plainNames({ [variant.slug!]: own, [owner.slug!]: loud }), 'the variant page and an enum page that does not').toBe(2)
  }, 60_000)

  it('adds no plain name across every core enum page, where unflagged payloads would add names the variant pages already count', async () => {
    const { members } = await apiComponents()
    const container = await experimental_AstroContainer.create()
    const variantPages: Record<string, string> = {}
    const flaggedPages: Record<string, string> = {}
    const unflaggedPages: Record<string, string> = {}
    for (const enumeration of coreEnums) {
      const table = memberTable(enumeration, membersOf(model, enumeration), 'rs')!
      const props = { owner: enumeration, members: table.rows, index, hrefFor, columns: 'variants', payloads: variantPayloads(model.symbols, table.rows) }
      flaggedPages[enumeration.slug!] = await container.renderToString(members, { props: { ...props, repeated: true } })
      unflaggedPages[enumeration.slug!] = await container.renderToString(members, { props: { ...props, repeated: false } })
      for (const entry of table.rows) {
        const own = model.symbols.filter((symbol) => symbol.parent === entry.id && symbol.kind === 'attribute' && symbol.type !== undefined)
        if (own.length) variantPages[entry.slug!] = await container.renderToString(members, { props: { owner: entry, members: own, index, hrefFor, columns: 'fields' } })
      }
    }
    const counted = plainNames(variantPages)
    expect(plainNames({ ...variantPages, ...flaggedPages }), 'the enum pages add no name to the gate').toBe(counted)
    // Without the flag they would count again every plain name that the variant pages already count.
    expect(plainNames({ ...variantPages, ...unflaggedPages })).toBeGreaterThan(counted)
  }, 300_000)

  it('draws the same text and links in a repeated payload, so only the count differs', async () => {
    const win = new Window()
    windows.push(win)
    const { row: quiet } = await draw(true)
    const { row: loud } = await draw(false)
    const read = (html: string) => {
      win.document.body.innerHTML = html
      const cell = win.document.querySelector('tbody td:nth-child(2)')!
      return { text: cell.textContent, links: [...cell.querySelectorAll('a')].map((link) => link.getAttribute('href')) }
    }
    expect(read(quiet)).toEqual(read(loud))
    expect(read(quiet).text).toBe('{ range: RangeInclusive<i64> }')
    win.document.body.innerHTML = quiet
    expect(win.document.querySelector('tbody td:nth-child(2) .api-punct.api-type-repeat')?.textContent).toBe('RangeInclusive')
  }, 60_000)
})
