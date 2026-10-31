import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { SymbolIndex } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { fieldsRepeated, memberTable } from '../src/lib/api-sections'
import { apiComponents } from './api-components'
import { loadAstroTemplate, withoutScope } from './astro-templates'

// A reference page asks the content collection for its sidebar; none of these checks reads one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))

type Port = 'rs' | 'go' | 'csharp' | 'swift'

/** The plain spans `check-type-links` counts are identifiers. A row's punctuation may open a different span than its entry's: `[` for `: [`. */
const counted = (text: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

describe('a type page with a table of fields', () => {
  // The table, the contents rail and the badges are the page's own; the type and prose cells draw plain text.
  const PAGE = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiScalarMembers.astro']
  async function page(port: Port, id: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', {
      real: PAGE,
      stubs: { 'components/api/ApiType.astro': '---\nconst { type, repeated } = Astro.props\n---\n<span data-type data-repeated={String(Boolean(repeated))}>{type}</span>' },
    })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    const owner = API_MODELS[port].symbols.find((entry) => entry.id === id)!
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model: API_MODELS[port], owner },
    }))
    return win.document
  }
  const contents = (document: Window['document']) => [...document.querySelectorAll('nav[aria-label="On this page"] a')].map((link) => [link.getAttribute('href'), link.textContent])

  // C# and Swift rows repeat what each property's own page draws; Go and Rust rows are the only place a type page draws theirs.
  it.each([['csharp', 'LibTmux.TmuxCommand', 'Properties', true], ['swift', 'Client', 'Properties', true], ['go', 'tmux.SessionFilter', 'Fields', false]] as const)(
    '%s %s names its table %s in the heading, its permalink, its caption and its contents entry', async (port, id, word, repeated) => {
      const document = await page(port, id)
      const heading = document.querySelector('h2#api-fields')!
      expect(heading.firstChild?.textContent).toBe(word)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe(`Link to ${word}`)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('href')).toBe('#api-fields')
      expect(document.querySelector('.api-field-table caption')?.textContent).toContain(` ${word.toLowerCase()}`)
      expect(contents(document)).toContainEqual(['#api-fields', word])
      // The rest of the members keep their own heading and id.
      expect(document.querySelector('.api-members > h2#api-members')?.firstChild?.textContent).toBe('Members')
      // The gate that counts plain names sees a type where it is drawn in full: a repeat is counted on its own page.
      const cells = [...document.querySelectorAll('.api-field-table [data-type]')]
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.every((cell) => cell.getAttribute('data-repeated') === String(repeated))).toBe(true)
    }, 60_000)

  it.each([['csharp', 'LibTmux.ClientAttachment'], ['swift', 'FilterSchema.Field']] as const)(
    'names the one heading of the %s type %s, which holds only properties, Properties, and keeps it the sticky Members bar', async (port, id) => {
    const document = await page(port, id)
    expect(document.querySelector('#api-fields')).toBeNull()
    const heading = document.querySelector('.api-members > h2#api-members')!
    expect(heading.firstChild?.textContent).toBe('Properties')
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Properties')
    expect(contents(document)).toContainEqual(['#api-members', 'Properties'])
    expect(document.querySelector('.api-members caption')?.textContent).toContain(' properties')
  }, 60_000)

  it.each([['csharp', 'LibTmux.ClientAttachment', true], ['swift', 'FilterSchema.Field', true], ['rs', 'pane.CapturedLine', false]] as const)(
    'sets the repeat flag of the one table of %s %s to %s', async (port, id, repeated) => {
      const cells = [...(await page(port, id)).querySelectorAll('.api-members [data-type]')]
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.every((cell) => cell.getAttribute('data-repeated') === String(repeated))).toBe(true)
    }, 60_000)

  // The row draws the text its port keeps as a field's type: a Swift property's declaration without its keyword and name, every other port's `type`.
  it.each([['swift', 'Client'], ['swift', 'FilterSchema.Field'], ['csharp', 'LibTmux.TmuxCommand'], ['go', 'tmux.SessionFilter']] as const)(
    'draws each row of %s %s with the type text its port keeps', async (port, id) => {
      const document = await page(port, id)
      const rows = [...document.querySelectorAll('table.api-scalar-members tbody tr')]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        const member = API_MODELS[port].symbols.find((entry) => (entry.publicId ?? entry.id) === row.id.replace(/^member-/, ''))!
        const kept = port === 'swift' ? member.type!.replace(/^(?:let|var) \w+: /, '') : member.type
        expect(kept, member.id).not.toBe('')
        expect(row.querySelector('[data-type]')?.textContent, member.id).toBe(kept)
        if (port === 'swift') expect(row.querySelector('[data-type]')?.textContent, member.id).not.toBe(member.type)
      }
    }, 60_000)

  it('repeats the types of a C# or Swift table only, so Rust and Go rows stay counted where they stand', () => {
    expect([fieldsRepeated('csharp'), fieldsRepeated('swift'), fieldsRepeated('rs'), fieldsRepeated('go'), fieldsRepeated('py'), fieldsRepeated(undefined)]).toEqual([true, true, false, false, false, false])
  })
})

interface Rule { container?: string; layered: boolean; selectors: string[]; declarations: Record<string, string> }

/** The style rules of a stylesheet, each with the `@container` condition around it and whether a `@layer` holds it. */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = []
  const walk = (text: string, container?: string, layered = false) => {
    for (let at = 0; at < text.length;) {
      const open = text.indexOf('{', at)
      if (open < 0) return
      let depth = 1
      let close = open + 1
      for (; close < text.length && depth; close++) depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0
      const prelude = text.slice(at, open).trim()
      const body = text.slice(open + 1, close - 1)
      if (prelude.startsWith('@container')) walk(body, prelude.slice('@container'.length).trim(), layered)
      else if (prelude.startsWith('@layer')) walk(body, container, true)
      else if (prelude.startsWith('@')) walk(body, container, layered)
      else rules.push({
        container, layered, selectors: prelude.split(/,(?![^(]*\))/).map((selector) => selector.replace(/\s+/g, ' ').trim()),
        declarations: Object.fromEntries(body.split(';').flatMap((declaration) => {
          const colon = declaration.indexOf(':')
          return colon > 0 ? [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]] : []
        })),
      })
      at = close
    }
  }
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''))
  return rules
}

/**
 * What a narrow Name, Type, Description table owes its reader: every column on screen, none clipped or broken inside a word.
 * The prose table rule of a docs page keeps a heading on one line and a cell at six rem, so the stacked layout has to beat it.
 */
function stackingViolations(css: string): string[] {
  const rules = parseRules(css)
  const found: string[] = []
  const box = rules.find((rule) => rule.selectors.includes('.api-scalar-box'))
  const name = /^(\S+) \/ inline-size$/.exec(box?.declarations.container ?? '')?.[1]
  if (!name) return ['the box that holds the table is not a container the query can measure']
  // The stacked layout answers the query for a narrow box; the table's own rules answer the one for a wide box.
  const narrow = rules.filter((rule) => rule.container?.startsWith(name) && rule.container.includes('max-width'))
  const width = Number(/^\S+ \(max-width: (\d+(?:\.\d+)?)rem\)$/.exec(narrow[0]?.container ?? '')?.[1])
  // A phone column is about 22rem and a tablet's about 40rem; below the first the table is cut, above the second it fits.
  if (!(width >= 30 && width <= 48)) found.push(`the table stacks at ${width}rem, not between a phone and a tablet column`)
  const declared = (selector: string) => Object.assign({}, ...narrow.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations))
  const cells = declared('.api-scalar-members :is(th, td)')
  for (const selector of ['.api-scalar-members', '.api-scalar-members tbody']) {
    if (declared(selector).display !== 'block') found.push(`${selector} stays a table part, so its rows keep their columns`)
  }
  const row = declared('.api-scalar-members tr')
  if (row.display !== 'flex' || row['flex-wrap'] !== 'wrap') found.push('a row does not wrap its name, type and description over lines')
  if (cells['min-width'] !== '0') found.push('a cell keeps the minimum width of the prose rule, so a column is squeezed past its text')
  const type = declared('.api-scalar-members td:nth-child(2)')
  if (type.flex !== '1 0 auto' || type['max-width'] !== '100%') found.push('a type is squeezed beside the name instead of taking the line under it')
  if (cells['white-space'] !== 'normal') found.push('a heading cell keeps white-space: nowrap from the prose rule')
  if (cells['overflow-wrap'] !== 'break-word') found.push('a cell breaks inside a word before its line is full')
  if (cells.padding !== '0') found.push('a cell keeps the padding of a column')
  if (!/(^|\s)100%$/.test(declared('.api-scalar-members td:last-child').flex ?? '')) found.push('the description does not take a line of its own')
  // The chips of the second column clone their padding and border onto each wrapped line: 0.2em and 1px of a 13px chip.
  if (!(Number.parseFloat(declared('.api-scalar-members td:nth-child(2)')['padding-inline-end'] ?? '') >= 0.25)) found.push('a wrapped chip overhangs the cell by its end padding and border')
  const head = declared('.api-scalar-members thead')
  if (head.display === 'none' || head.visibility === 'hidden') found.push('the header row leaves assistive technology')
  else if (head.position !== 'absolute' || head.overflow !== 'hidden') found.push('the header row stays on screen')
  if (narrow.some((rule) => rule.layered) || rules.filter((rule) => rule.selectors.includes('.api-scalar-box')).some((rule) => rule.layered)) {
    found.push('a layered rule loses to the prose table rule it overrides')
  }
  return found
}

describe('the narrow layout of a table of fields', () => {
  const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
  const prose = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  /** `css` with `from` replaced by `to`, from the narrow block on; the edit must land, or the control proves nothing. */
  const edit = (from: string | RegExp, to: string) => {
    const start = css.indexOf('@container api-scalar-members')
    expect(start, 'the narrow block is in the stylesheet').toBeGreaterThan(-1)
    const changed = css.slice(0, start) + css.slice(start).replace(from, to)
    expect(changed, `${from} is in the narrow block`).not.toBe(css)
    return changed
  }

  it('stacks each row in a narrow box and keeps the header for assistive technology', () => {
    expect(stackingViolations(css)).toEqual([])
  })

  it('answers the rules it overrides: the prose table keeps a heading on one line and a cell at six rem', () => {
    const rule = (selector: string) => Object.assign({}, ...parseRules(prose).filter((entry) => entry.selectors.includes(selector)).map((entry) => entry.declarations))
    expect(rule('.prose :where(th)')['white-space']).toBe('nowrap')
    expect(rule('.prose :where(td)')['min-width']).toBe('6rem')
    expect(rule('.prose :where(table)').display).toBe('block')
  })

  it.each([
    ['the container name does not reach the query', () => {
      const box = '.api-scalar-box { container: api-scalar-members / inline-size; }'
      expect(css).toContain(box)
      return css.replace(box, '.api-scalar-box { container-type: inline-size; }')
    }, 'not a container'],
    ['a phone column is outside the query', () => edit('(max-width: 46rem)', '(max-width: 20rem)'), 'not between a phone and a tablet column'],
    ['the rows keep their columns', () => edit('.api-scalar-members tbody { display: block; }', '.api-scalar-members tbody { display: table-row-group; }'), 'rows keep their columns'],
    ['a row stops wrapping', () => edit('flex-wrap: wrap;', ''), 'wrap its name'],
    ['a cell keeps the prose minimum width', () => edit('    min-width: 0;\n', ''), 'minimum width'],
    ['a type is squeezed beside the name', () => edit('flex: 1 0 auto; max-width: 100%;', 'flex: 1 1 8rem;'), 'squeezed beside the name'],
    ['a heading keeps nowrap', () => edit('    white-space: normal;\n', ''), 'nowrap'],
    ['a word breaks early', () => edit('overflow-wrap: break-word;', 'overflow-wrap: anywhere;'), 'inside a word'],
    ['the cell loses its room for a wrapped chip', () => edit(' padding-inline-end: 0.25rem;', ''), 'overhangs the cell'],
    ['the description shares a line', () => edit('.api-scalar-members td:last-child { flex: 1 0 100%; }', '.api-scalar-members td:last-child { flex: 1 1 auto; }'), 'line of its own'],
    ['the header row is removed from assistive technology', () => edit('    position: absolute;\n', '    display: none;\n'), 'leaves assistive technology'],
    ['the header row is left on screen', () => edit('    overflow: hidden;\n    clip-path', '    clip-path'), 'stays on screen'],
    ['a layer holds the rules', () => `@layer components {\n${css}\n}`, 'layered rule'],
  ])('fails when %s', (_, sabotage, problem) => {
    expect(stackingViolations(sabotage()).join('\n')).toContain(problem)
  })
})

describe('the type names a product table repeats', () => {
  const script = fileURLToPath(new URL('../../scripts/check-type-links.mjs', import.meta.url))

  /** The plain names that `check-type-links` counts for csharp in a site whose one product reference page holds `html`. */
  function plainNames(html: string): number {
    const dir = mkdtempSync(join(tmpdir(), 'type-links-'))
    try {
      mkdirSync(join(dir, 'csharp', 'latest', 'reference'), { recursive: true })
      const page = join(dir, 'csharp', 'latest', 'workspace', 'reference', 'workspaceaction')
      mkdirSync(page, { recursive: true })
      writeFileSync(join(page, 'index.html'), `<html><body>${html}</body></html>`)
      const listing = execFileSync(process.execPath, [script, dir, '--list'], { encoding: 'utf8' })
      return Number(/^csharp\s+\d+ linked\s+(\d+) plain/m.exec(listing)![1])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  const model = API_MODELS.csharp
  const hrefFor = (symbol: { slug?: string }) => `/en/csharp/latest/workspace/reference/${symbol.slug}/`
  const index = new SymbolIndex(model.symbols, hrefFor, 'csharp')
  const owner = model.symbols.find((entry) => entry.id === 'LibTmux.Workspace.WorkspaceAction')!
  // WorkspaceAction<TRequest> and WorkspaceAction share one id, and the model keeps no type parameter on it.
  const request = model.symbols.find((entry) => entry.id === 'LibTmux.Workspace.WorkspaceAction.Request')!

  async function draw(repeated: boolean) {
    const { type, members } = await apiComponents()
    const container = await experimental_AstroContainer.create()
    const entry = await container.renderToString(type, { props: { type: request.type, index, context: request } })
    const row = await container.renderToString(members, { props: { owner, members: [request], index, hrefFor, columns: 'fields', repeated } })
    return { entry, row }
  }

  it('leaves a name that fails to resolve counted once, where the entry draws it', async () => {
    expect(request.type).toBe('TRequest')
    expect(owner.typeParams).toBeUndefined()
    const { entry, row: quiet } = await draw(true)
    const { row: loud } = await draw(false)
    expect(plainNames(entry), 'the entry alone').toBe(1)
    expect(plainNames(entry + quiet), 'the entry and a row that repeats it').toBe(1)
    // Without the flag the table counts the same name again: the case this guards.
    expect(plainNames(entry + loud), 'the entry and a row that does not know it repeats').toBe(2)
  }, 60_000)

  it('draws the same text and links in a repeated row, so only the count differs', async () => {
    const win = new Window()
    windows.push(win)
    const { members } = await apiComponents()
    const container = await experimental_AstroContainer.create()
    const cells = async (repeated: boolean) => {
      win.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: model.symbols.filter((entry) => entry.parent === owner.id && entry.kind === 'property' && entry.type), index, hrefFor, columns: 'fields', repeated } })
      return [...win.document.querySelectorAll('tbody td:nth-child(2)')].map((cell) => ({
        text: cell.textContent, links: [...cell.querySelectorAll('a')].map((link) => link.getAttribute('href')),
      }))
    }
    expect(await cells(true)).toEqual(await cells(false))
    win.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: [request], index, hrefFor, columns: 'fields', repeated: true } })
    expect(win.document.querySelector('tbody td:nth-child(2) .api-punct.api-type-repeat')?.textContent).toBe('TRequest')
  }, 60_000)
})

describe('every repeated type name on a product page', () => {
  // The real entry, table and type, as the page draws them; the shell around the page is not needed.
  const load = () => loadAstroTemplate('components/api/ProductApiPage.astro', {
    real: ['components/api/ApiEntry.astro', 'components/api/ApiScalarMembers.astro', 'components/api/ApiType.astro', 'components/api/SymbolName.astro', 'components/api/ApiBadge.astro'],
    modules: {
      // An example in a doc comment renders through this component; an empty Astro component stands in.
      'astro-expressive-code/components': { Code: createComponent(() => renderTemplate``) },
      '../../lib/page-ports-for': { pagePortsFor: async () => [] },
      '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
    },
  })
  /** The product declarations of a port that draw a table: a Fields table, or the Variants of a Rust enum. */
  function owners(port: Port) {
    const model = API_MODELS[port]
    const members = (id: string) => model.symbols.filter((entry) => entry.parent === id && entry.product === model.symbols.find((owner) => owner.id === id)?.product)
    return model.symbols.filter((owner) => owner.product && owner.product !== 'core' && owner.apiScope !== 'internal' && memberTable(owner, members(owner.id), port) !== undefined)
  }
  async function product(port: Port, id: string) {
    const model = API_MODELS[port]
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const container = await experimental_AstroContainer.create()
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(await load() as never, {
      props: { model, symbol, version: 'latest' }, request: new Request('https://libtmux.org/en/'),
    }))
    return win.document
  }
  /**
   * What the repeats on a page owe the gate that counts plain names: each is a name drawn a second time, so the page
   * must draw it first somewhere else. The repeats of a text may not outnumber its originals outside the table.
   */
  function orphans(document: Window['document']): string[] {
    const spans = (selector: string) => [...document.querySelectorAll(selector)].map((span) => span.textContent!.trim())
    const repeats = spans('.api-field-table span.api-type-repeat')
    const originals = spans('span.api-punct:not(.api-type-repeat)')
    // Everything flagged lies in the table, whose cells are the only ones that carry the flag.
    expect(document.querySelectorAll('span.api-type-repeat')).toHaveLength(repeats.length)
    // The punctuation a payload writes around its types is syntax, which the gate does not count.
    const tableOriginals = spans('.api-field-table span.api-punct:not(.api-type-repeat):not([data-api-role="syntax"])')
    expect(tableOriginals, 'a table cell drawn without the flag counts the name a second time').toEqual([])
    return [...new Set(repeats)].filter(counted).filter((text) => originals.filter((original) => original === text).length < repeats.filter((repeat) => repeat === text).length)
  }

  it('has its original drawn by the entry, so the gate counts the name once', async () => {
    const document = await product('csharp', 'LibTmux.Workspace.WorkspaceAction')
    const repeats = [...document.querySelectorAll('.api-field-table span.api-type-repeat')].map((span) => span.textContent!.trim())
    // The name the model cannot resolve is among them, and so is the punctuation around resolved ones.
    expect(repeats).toContain('TRequest')
    expect(orphans(document)).toEqual([])
  }, 120_000)

  it.each(['rs', 'go', 'csharp', 'swift'] as const)('has its original on every %s product page that draws a table', async (port) => {
    const found = owners(port)
    expect(found.length).toBeGreaterThan(0)
    const problems: string[] = []
    let repeated = 0
    for (const owner of found) {
      const document = await product(port, owner.id)
      repeated += document.querySelectorAll('span.api-type-repeat').length
      const lacking = orphans(document)
      if (lacking.length) problems.push(`${owner.id}: ${lacking.join(', ')}`)
    }
    expect(problems).toEqual([])
    // A port whose types were all links or keywords would pass without proving anything.
    expect(repeated).toBeGreaterThan(0)
  }, 600_000)

  it('is found missing when the entry stops drawing the type (control)', async () => {
    const document = await product('csharp', 'LibTmux.Workspace.WorkspaceAction')
    // Take the entry's own drawing of the unresolved name away, as a change to ApiEntry would.
    for (const span of document.querySelectorAll('.api-members span.api-punct:not(.api-type-repeat)')) if (span.textContent!.trim() === 'TRequest') span.remove()
    expect(orphans(document)).toEqual(['TRequest'])
  }, 120_000)
})

// A property's own page draws its type in full, unflagged. The control names a type the model cannot resolve, so the gate counts it there.
describe.each([
  { port: 'csharp', language: 'C#', control: 'LibTmux.ServerConnectionOptions.Interceptor', plain: 'TmuxInterceptor', floor: 100 },
  { port: 'swift', language: 'Swift', control: 'TmuxReply.exitCode', plain: 'Int32', floor: 20 },
] as const)('every repeated type name in a $language properties table', ({ port, control, plain, floor }) => {
  // The real entry, table and type, as a core page draws them; the shell around the page is not needed.
  const load = () => loadAstroTemplate('components/api/ApiReference.astro', {
    real: ['components/api/ApiEntry.astro', 'components/api/ApiScalarMembers.astro', 'components/api/ApiType.astro', 'components/api/SymbolName.astro', 'components/api/ApiBadge.astro', 'components/api/ApiPageContents.astro'],
    modules: {
      'astro-expressive-code/components': { Code: createComponent(() => renderTemplate``) },
      '../../lib/page-ports-for': { pagePortsFor: async () => [] },
      '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
    },
  })
  const model = API_MODELS[port]
  const byAnchor = new Map(model.symbols.map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
  async function render(template: unknown, id: string) {
    const owner = model.symbols.find((entry) => entry.id === id)!
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model, owner },
    }))
    return win.document
  }
  const texts = (document: Window['document'], selector: string) => [...document.querySelectorAll(selector)].map((span) => span.textContent!.trim())
  /** The texts of `wanted` that `drawn` does not hold as many times, the way a repeat needs its original. */
  const missing = (wanted: string[], drawn: string[]) => [...new Set(wanted)].filter(counted).filter((text) => drawn.filter((entry) => entry === text).length < wanted.filter((entry) => entry === text).length)

  /** Every row of every core class and struct table, with the property whose own page must hold what the row repeats. */
  async function rows(template: unknown) {
    const found: { owner: string; property: string; repeats: string[] }[] = []
    for (const owner of model.symbols.filter((entry) => ['class', 'struct'].includes(entry.kind) && (!entry.product || entry.product === 'core' || entry.apiScope === 'internal'))) {
      const document = await render(template, owner.id)
      // Nothing in a table cell is drawn without the flag, or the gate would count the name on both pages.
      expect(texts(document, 'table.api-scalar-members span.api-punct:not(.api-type-repeat)'), owner.id).toEqual([])
      for (const row of document.querySelectorAll('table.api-scalar-members tbody tr')) {
        const repeats = [...row.querySelectorAll('span.api-type-repeat')].map((span) => span.textContent!.trim())
        if (repeats.length) found.push({ owner: owner.id, property: row.id.replace(/^member-/, ''), repeats })
      }
    }
    return found
  }

  it('is drawn in full, unflagged, on the property\'s own page', async () => {
    const template = await load()
    const found = await rows(template)
    expect(found.length).toBeGreaterThan(floor)
    expect(found.map((row) => row.repeats).flat()).toContain(plain)
    const problems: string[] = []
    for (const row of found) {
      const property = byAnchor.get(row.property)!
      expect(property?.kind, row.property).toBe('property')
      const lacking = missing(row.repeats, texts(await render(template, property.id), 'span.api-punct:not(.api-type-repeat)'))
      if (lacking.length) problems.push(`${row.owner} ${property.name}: ${lacking.join(', ')}`)
    }
    expect(problems).toEqual([])
  }, 300_000)

  it('is found missing when a property\'s own page stops drawing its type (control)', async () => {
    const template = await load()
    const row = (await rows(template)).find((entry) => entry.property === control)!
    expect(row.repeats).toContain(plain)
    const own = await render(template, row.property)
    expect(missing(row.repeats, texts(own, 'span.api-punct:not(.api-type-repeat)'))).toEqual([])
    for (const span of own.querySelectorAll('span.api-punct')) if (span.textContent!.trim() === plain) span.remove()
    expect(missing(row.repeats, texts(own, 'span.api-punct:not(.api-type-repeat)'))).toEqual([plain])
  }, 120_000)
})
