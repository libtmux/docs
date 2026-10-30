import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, memberSignals, memberTier, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiMemberSections, fieldsLabel, hasFieldMembers, memberTableColumns, splitFieldMembers } from '../src/lib/api-sections'
import mentionsData from '../src/data/mentions.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { apiComponents } from './api-components'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

type FieldPort = 'rs' | 'go' | 'csharp'

/**
 * What the committed file calls an owner of fields and a field, written out apart from the predicate under test.
 * A C# static property is a named value of its type, as a constant is, so the oracle leaves it out.
 */
const isRecord = (entry: ApiSymbol) => entry.kind === 'struct' || entry.variant === 'struct' || entry.variant === 'tuple'
const RAW_RULES: Record<FieldPort, { owner: (entry: ApiSymbol) => boolean; field: (entry: ApiSymbol) => boolean }> = {
  rs: { owner: isRecord, field: (entry) => entry.kind === 'attribute' },
  go: { owner: isRecord, field: (entry) => entry.kind === 'attribute' },
  csharp: { owner: (entry) => entry.kind === 'class' || entry.kind === 'struct', field: (entry) => entry.kind === 'property' && !entry.modifiers.includes('static') },
}

/** One port's model, its address scheme, and the committed file the oracle reads instead of the model. */
function portFixture(port: FieldPort) {
  const model = API_MODELS[port]
  const hrefFor = (symbol: ApiSymbol) => `/en/${port}/latest/reference/${symbol.slug}/`
  const index = new SymbolIndex(model.symbols, hrefFor, port)
  const raw: { symbols: ApiSymbol[] } = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8'))
  const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
  const fieldsOf = (owner: ApiSymbol) => membersOf(model, owner).filter((member) => !member.inheritedFrom)
  const markdown = (owner: ApiSymbol, symbols = model.symbols) => symbolMarkdown({ model: { ...model, symbols }, symbol: owner, index, hrefFor })
  const markdownRows = (owner: ApiSymbol) => markdown(owner)
    .split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Name') && !line.startsWith('| ---'))
  // The raw fields an owner declares, in the file's order, whatever the model orders or filters.
  const isRawField = RAW_RULES[port].field
  const rawFields = (owner: ApiSymbol) => raw.symbols.filter((entry) => entry.parent === owner.id && isRawField(entry))
  return { port, model, hrefFor, index, raw, symbol, fieldsOf, markdown, markdownRows, rawFields, isRawField, isRawOwner: RAW_RULES[port].owner }
}

const { model, hrefFor, index, symbol, fieldsOf, markdownRows } = portFixture('rs')

/** The Type cell with link syntax, code spans and pipe escapes removed. */
const typeText = (row: string) => row.split(' | ')[1].replace(/\[`([^`]*)`\]\([^)]*\)/g, '$1').replaceAll('`', '').replaceAll('\\|', '|')

// A struct, a named-field variant, a tuple variant, and a variant whose field type resolves to a page of its own.
const owners = ['pane.CapturedLine', 'control.Event.Output', 'control.Subscription.Window']

describe('Rust field tables', () => {
  it.each(owners)('%s has a field table of exactly its modelled fields', (id) => {
    const owner = symbol(id)
    const fields = fieldsOf(owner)
    expect(fields.length).toBeGreaterThan(0)
    expect(hasFieldMembers(owner, fields, 'rs')).toBe(true)
    const rows = markdownRows(owner)
    expect(rows).toHaveLength(fields.length)
    fields.forEach((field, i) => {
      expect(rows[i]).toContain(`[\`${field.name}\`](${hrefFor(field)})`)
      expect(typeText(rows[i])).toBe(field.type!.replaceAll('\n', ' '))
      if (field.doc?.summary) expect(rows[i]).toContain(field.doc.summary.replaceAll('\n', ' '))
    })
    expect(symbolMarkdown({ model, symbol: owner, index, hrefFor })).toContain('| Name | Type | Description |')
  })

  it('links a field type that resolves to a declaration, in Markdown and HTML', async () => {
    const owner = symbol('control.Event.Output')
    const target = index.linkType('PaneId', fieldsOf(owner)[0]).find((span) => span.link)!.link!.href
    expect(markdownRows(owner)[0]).toContain(`[\`PaneId\`](${target})`)
    const { members } = await apiComponents()
    const window = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      window.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: fieldsOf(owner), index, hrefFor, columns: 'fields' } })
      expect([...window.document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
      const rows = [...window.document.querySelectorAll('tbody tr')]
      expect(rows).toHaveLength(fieldsOf(owner).length)
      expect(rows[0].querySelector('td a.api-type-link')?.getAttribute('href')).toBe(target)
      expect(rows[0].querySelector('td:last-child')?.textContent).toContain(fieldsOf(owner)[0].doc!.summary)
    } finally { await window.happyDOM.abort() }
  })

  it('keeps the Fields block out of every .api-members selector, and styled like it', () => {
    const page = readFileSync(new URL('../src/components/api/ApiReference.astro', import.meta.url), 'utf8')
    const block = /<div class="([^"]*)">\s*<h2[^>]*id=\{table\.id\}/.exec(page)![1]
    // Its own class: .api-members would capture the sticky members logic, and .api-fields is the field-list rule.
    expect(block.split(' ')).toContain('api-field-table')
    expect(block.split(' ')).not.toContain('api-members')
    expect(block.split(' ')).not.toContain('api-fields')
    expect(block.split(' ')).not.toContain('api-members')
    const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.api-field-table > h2,\n\.api-members > h2,/)
    expect(css).not.toMatch(/(?:^|[\s,}])\.api-field-table\s*\{[^}]*(?:margin|font-size)/m)
    expect(apiMemberSections({ fields: 0, members: 0, label: 'Members', groups: [] })).toEqual([])
  })

  it('fails when a field is dropped from the model', () => {
    const owner = symbol('pane.CapturedLine')
    const dropped = fieldsOf(owner).slice(1)
    const smaller = { ...model, symbols: model.symbols.filter((entry) => entry.id !== fieldsOf(owner)[0].id) }
    const rows = symbolMarkdown({ model: smaller, symbol: owner, index, hrefFor })
      .split('\n').filter((line) => line.startsWith('| [`'))
    expect(rows).toHaveLength(dropped.length)
    expect(rows).not.toHaveLength(fieldsOf(owner).length)
  })
})

// Per port: a type of only fields (the one the sabotage cases remove a field from), types with methods or
// static values beside their fields, and a type the model keeps no field of.
const PURE: Record<FieldPort, string> = { rs: 'pane.CapturedLine', go: 'tmux.DisplayMessageRequest', csharp: 'LibTmux.ClientAttachment' }
const MIXED: Record<FieldPort, string[]> = {
  rs: ['config.Workspace', 'config.ShellCommand', 'mcp.cli.Options'],
  go: ['tmux.SessionFilter', 'tmux.CommandError', 'tmux.CommandTrace'],
  // ServerConnectionOptions also declares a static property, which belongs to the list.
  csharp: ['LibTmux.TmuxCommand', 'LibTmux.Client', 'LibTmux.ServerConnectionOptions'],
}
// LibTmuxInfo declares typed properties too, all of them static.
const FIELDLESS: Record<FieldPort, string> = { rs: 'blocking.Runtime', go: 'tmux.Connection', csharp: 'LibTmux.LibTmuxInfo' }

describe.each(['rs', 'go', 'csharp'] as const)('%s field tables against the committed data', (port) => {
  const f = portFixture(port)
  const hasTable = (owner: ApiSymbol) => splitFieldMembers(owner, f.fieldsOf(owner), port).fields.length > 0
  // The rows of the Fields table: from its heading to the next top-level section.
  const tableRows = (owner: ApiSymbol, symbols = f.model.symbols) => {
    const lines = f.markdown(owner, symbols).split('\n')
    const start = lines.indexOf(`## ${fieldsLabel(port)}`)
    if (start < 0) return []
    const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
    return lines.slice(start, end < 0 ? undefined : end).filter((line) => line.startsWith('| [`'))
  }
  const sweep = (symbols: ApiSymbol[]) => f.model.symbols.filter(hasTable).map((owner) => ({
    id: owner.id, rows: tableRows(owner, symbols).length, expected: f.rawFields(owner).length,
  }))

  it('has a field table for a struct of only fields', () => {
    const owner = f.symbol(PURE[port])
    expect(f.rawFields(owner).length).toBeGreaterThan(0)
    expect(hasFieldMembers(owner, f.fieldsOf(owner), port)).toBe(true)
    expect(memberTableColumns(owner, f.fieldsOf(owner), port)).toBe('fields')
  })

  it('renders one row per raw field for every eligible type, and for every type that has raw fields', () => {
    const results = sweep(f.model.symbols)
    expect(results.filter((entry) => entry.rows !== entry.expected)).toEqual([])
    const withFields = f.raw.symbols.filter((owner) => f.isRawOwner(owner) && f.rawFields(owner).some((field) => field.type !== undefined))
    expect(results.map((entry) => entry.id).toSorted()).toEqual(withFields.map((owner) => owner.id).toSorted())
  })

  it('the sweep fails when one field is removed from a copy of the data', () => {
    const victim = f.fieldsOf(f.symbol(PURE[port]))[0].id
    const results = sweep(f.model.symbols.filter((entry) => entry.id !== victim))
    expect(results.filter((entry) => entry.rows !== entry.expected).map((entry) => entry.id)).toEqual([PURE[port]])
  })

  it('chooses the fields columns for every field owner, never the value columns', () => {
    const owners = f.model.symbols.filter((entry) => hasFieldMembers(entry, f.fieldsOf(entry), port))
    expect(owners.length).toBeGreaterThan(0)
    for (const owner of owners) expect(memberTableColumns(owner, f.fieldsOf(owner), port), owner.id).toBe('fields')
    const fieldless = f.symbol(FIELDLESS[port])
    expect(memberTableColumns(fieldless, f.fieldsOf(fieldless), port)).toBeUndefined()
  })

  it('shows no table for a type without fields (clean control)', () => {
    const owner = f.symbol(FIELDLESS[port])
    expect(hasFieldMembers(owner, f.fieldsOf(owner), port)).toBe(false)
    expect(f.markdown(owner)).not.toContain('| Name | Type | Description |')
    const record = f.symbol(PURE[port])
    expect(hasFieldMembers({ ...record }, [], port)).toBe(false)
    // The port is what turns the table on: the same fields under a port without one stay a list.
    expect(hasFieldMembers(record, f.fieldsOf(record), 'py')).toBe(false)
  })

  describe.each(MIXED[port])('mixed type %s', (id) => {
    const owner = f.symbol(id)
    const children = () => f.raw.symbols.filter((entry) => entry.parent === id)
    const hrefs = (symbols: ApiSymbol[]) => symbols.map((entry) => f.hrefFor(f.model.symbols.find((m) => m.id === entry.id)!))
    const linkedIn = (lines: string[]) => lines.map((line) => /\]\(([^)]*)\)/.exec(line)![1])
    // Each part ends at the next top-level section; later sections link elsewhere.
    const nextSection = (lines: string[], from: number) => {
      const at = lines.findIndex((line, i) => i > from && line.startsWith('## '))
      return at < 0 ? lines.length : at
    }
    const split = (symbols = f.model.symbols) => {
      const lines = f.markdown(owner, symbols).split('\n')
      const fieldsAt = lines.indexOf(`## ${fieldsLabel(port)}`)
      const membersAt = lines.indexOf('## Members')
      return {
        fieldsAt, membersAt,
        table: linkedIn(lines.slice(fieldsAt, nextSection(lines, fieldsAt)).filter((line) => line.startsWith('| [`'))),
        list: linkedIn(lines.slice(membersAt, nextSection(lines, membersAt)).filter((line) => line.startsWith('- ['))),
      }
    }

    it('splits the raw children into a Fields table and the remaining list, with none lost or repeated', () => {
      const fields = children().filter(f.isRawField)
      const others = children().filter((entry) => !f.isRawField(entry))
      expect(fields.length).toBeGreaterThan(0)
      expect(others.length).toBeGreaterThan(0)
      const parts = splitFieldMembers(owner, f.fieldsOf(owner), port)
      expect(parts.fields.map((entry) => entry.id).toSorted()).toEqual(fields.map((entry) => entry.id).toSorted())
      expect(parts.rest.map((entry) => entry.id).toSorted()).toEqual(others.map((entry) => entry.id).toSorted())
      expect(hasFieldMembers(owner, f.fieldsOf(owner), port)).toBe(false)
      expect(memberTableColumns(owner, f.fieldsOf(owner), port)).toBeUndefined()
      const out = split()
      expect(out.fieldsAt).toBeGreaterThan(-1)
      expect(out.membersAt).toBeGreaterThan(out.fieldsAt)
      expect(out.table.toSorted()).toEqual(hrefs(fields).toSorted())
      expect(out.list.toSorted()).toEqual(hrefs(others).toSorted())
      const all = [...out.table, ...out.list]
      expect(new Set(all).size).toBe(all.length)
      expect(all.toSorted()).toEqual(hrefs(children()).toSorted())
    })

    it('lists Fields before Members in the section navigation, each with its own count', () => {
      const { fields, rest } = splitFieldMembers(owner, f.fieldsOf(owner), port)
      const groups = [{ id: 'api-other-members', label: 'Other members' }]
      expect(apiMemberSections({ fields: fields.length, members: rest.length, label: 'Members', fieldsLabel: fieldsLabel(port), groups })).toEqual([
        { id: 'api-fields', label: fieldsLabel(port), count: fields.length },
        { id: 'api-members', label: 'Members', count: rest.length },
        { id: 'api-other-members', label: 'Other members', nested: true },
      ])
    })

    it('fails the split when a field is dropped from a copy of the data', () => {
      const victim = children().find(f.isRawField)!.id
      const out = split(f.model.symbols.filter((entry) => entry.id !== victim))
      expect(out.table).toHaveLength(children().filter(f.isRawField).length - 1)
    })
  })
})

describe('Go field tables', () => {
  const go = portFixture('go')
  const owner = go.symbol('tmux.DisplayMessageRequest')
  const field = (name: string) => go.fieldsOf(owner).find((member) => member.name === name)!

  it('writes the type of every field as Go does, in the Markdown row of every struct that has fields', () => {
    let checked = 0
    for (const record of go.model.symbols.filter((entry) => go.rawFields(entry).length > 0)) {
      const rows = go.markdownRows(record).filter((row) => row.startsWith('| [`'))
      for (const raw of go.rawFields(record)) {
        const row = rows.find((candidate) => candidate.includes(`](${go.hrefFor(raw)})`))
        expect(row, raw.id).toBeDefined()
        expect(typeText(row!), raw.id).toBe(raw.type)
        checked++
      }
    }
    expect(checked).toBe(go.raw.symbols.filter((entry) => entry.kind === 'attribute' && entry.parent !== undefined).length)
  })

  it('links a pointer, a slice and a declared type to their own pages, in Markdown and HTML', async () => {
    const target = go.index.linkType('ClientName', field('TargetClient')).find((span) => span.link)!.link!.href
    const rows = go.markdownRows(owner)
    const row = (name: string) => rows.find((candidate) => candidate.startsWith(`| [\`${name}\`]`))!
    expect(row('TargetClient')).toContain(`[\`ClientName\`](${target})`)
    expect(row('Delay')).toContain('`*`[`time.Duration`](https://pkg.go.dev/time#Duration)')
    const filter = go.symbol('tmux.SessionFilter')
    expect(go.markdownRows(filter).find((candidate) => candidate.startsWith('| [`AnyOf`]'))).toContain(`\`[]\`[\`SessionFilter\`](${go.hrefFor(filter)})`)

    const { members } = await apiComponents()
    const window = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      window.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: go.fieldsOf(owner), index: go.index, hrefFor: go.hrefFor, columns: 'fields' } })
      expect([...window.document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
      const htmlRows = [...window.document.querySelectorAll('tbody tr')]
      expect(htmlRows).toHaveLength(go.fieldsOf(owner).length)
      const htmlRow = (name: string) => htmlRows.find((candidate) => candidate.querySelector('th a')?.textContent === name)!
      expect(htmlRow('TargetClient').querySelector('td a.api-type-link')?.getAttribute('href')).toBe(target)
      expect(htmlRow('Delay').querySelector('td:nth-child(2)')?.textContent).toBe('*time.Duration')
      expect(htmlRow('Delay').querySelector('td a.api-type-link')?.getAttribute('href')).toBe('https://pkg.go.dev/time#Duration')
      expect(htmlRow('Delay').querySelector('td:last-child')?.textContent).toContain(field('Delay').doc!.summary)
    } finally { await window.happyDOM.abort() }
  })
})

describe('C# field tables', () => {
  const cs = portFixture('csharp')
  const owner = cs.symbol('LibTmux.TmuxCommand')
  const field = (name: string) => cs.fieldsOf(owner).find((member) => member.name === name)!

  it('writes the type of every property as C# does, in the Markdown row of every class and struct that has them', () => {
    let checked = 0
    for (const record of cs.model.symbols.filter((entry) => cs.isRawOwner(entry) && cs.rawFields(entry).length > 0)) {
      const rows = cs.markdownRows(record).filter((row) => row.startsWith('| [`'))
      for (const raw of cs.rawFields(record)) {
        const row = rows.find((candidate) => candidate.includes(`](${cs.hrefFor(raw)})`))
        expect(row, raw.id).toBeDefined()
        expect(typeText(row!), raw.id).toBe(raw.type)
        checked++
      }
    }
    expect(checked).toBe(cs.raw.symbols.filter((entry) => cs.isRawField(entry) && cs.isRawOwner(cs.raw.symbols.find((parent) => parent.id === entry.parent)!)).length)
  })

  it('keeps a static property in the member list, beside the fields of its type', () => {
    const options = cs.symbol('LibTmux.ServerConnectionOptions')
    const named = cs.raw.symbols.find((entry) => entry.id === 'LibTmux.ServerConnectionOptions.Default')!
    expect(named).toMatchObject({ kind: 'property', modifiers: ['static'] })
    const { fields, rest } = splitFieldMembers(options, cs.fieldsOf(options), 'csharp')
    expect(fields.map((entry) => entry.id)).not.toContain(named.id)
    expect(rest.map((entry) => entry.id)).toContain(named.id)
    const markdown = cs.markdown(options)
    expect(markdown.slice(markdown.indexOf('## Properties'), markdown.indexOf('## Members'))).not.toContain('`Default`')
    expect(markdown.slice(markdown.indexOf('## Members'))).toContain(`[\`Default\`](${cs.hrefFor(named)}) (property)`)
  })

  it('lists only property members: an attribute or a constant on the same type stays in the member list', () => {
    const cases = ['attribute', 'constant'] as const
    for (const kind of cases) {
      const extra: ApiSymbol = { ...field('RequiredGeneration'), id: `${owner.id}.Extra`, name: 'Extra', kind }
      const { fields, rest } = splitFieldMembers(owner, [...cs.fieldsOf(owner), extra], 'csharp')
      expect(fields.map((entry) => entry.id), kind).not.toContain(extra.id)
      expect(rest.map((entry) => entry.id), kind).toContain(extra.id)
    }
    // An interface states a contract, and its properties are not what an instance holds.
    const contract: ApiSymbol = { ...owner, kind: 'interface' }
    expect(splitFieldMembers(contract, cs.fieldsOf(owner), 'csharp').fields).toEqual([])
  })

  it('lists only the properties a type declares, not the ones it inherits', () => {
    const borrowed = field('RequiredGeneration')
    const members = cs.fieldsOf(owner).map((entry) => entry === borrowed ? { ...entry, inheritedFrom: 'LibTmux.TmuxChain' } : entry)
    const { fields, rest } = splitFieldMembers(owner, members, 'csharp')
    expect(fields.map((entry) => entry.id)).not.toContain(borrowed.id)
    expect(rest.map((entry) => entry.id)).toContain(borrowed.id)
    expect(fields.map((entry) => entry.id)).toEqual(splitFieldMembers(owner, cs.fieldsOf(owner), 'csharp').fields.map((entry) => entry.id).filter((id) => id !== borrowed.id))
  })

  it('shows a struct that holds a nullable property beside static values as a Fields table', () => {
    const position = cs.symbol('LibTmux.CapturePanePosition')
    expect(position.kind).toBe('struct')
    expect(cs.markdownRows(position).filter((row) => row.startsWith('| [`'))).toHaveLength(cs.rawFields(position).length)
    expect(typeText(cs.markdownRows(position).find((row) => row.startsWith('| [`LineNumber`]'))!)).toBe('int?')
  })

  it('keeps nullability and generic arguments, and links each declared type, in Markdown and HTML', async () => {
    const generation = cs.index.linkType('ServerGeneration?', field('RequiredGeneration')).find((span) => span.link)!.link!.href
    const row = (owning: ApiSymbol, name: string) => cs.markdownRows(owning).find((candidate) => candidate.startsWith(`| [\`${name}\`]`))!
    expect(row(owner, 'RequiredGeneration')).toContain(`[\`ServerGeneration\`](${generation})\`?\``)
    const chain = cs.symbol('LibTmux.TmuxChain')
    const listed = cs.fieldsOf(chain).find((member) => member.name === 'Commands')!
    const commands = cs.index.linkType('TmuxCommand', listed).find((span) => span.link)!.link!.href
    expect(row(chain, 'Commands')).toContain('[`IReadOnlyList`](https://learn.microsoft.com/dotnet/api/system.collections.generic.ireadonlylist-1)')
    expect(row(chain, 'Commands')).toContain(`[\`TmuxCommand\`](${commands})`)

    const { members } = await apiComponents()
    const window = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      window.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: splitFieldMembers(owner, cs.fieldsOf(owner), 'csharp').fields, index: cs.index, hrefFor: cs.hrefFor, columns: 'fields' } })
      expect([...window.document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
      const htmlRows = [...window.document.querySelectorAll('tbody tr')]
      expect(htmlRows).toHaveLength(cs.rawFields(owner).length)
      const htmlRow = (name: string) => htmlRows.find((candidate) => candidate.querySelector('th a')?.textContent === name)!
      expect(htmlRow('RequiredGeneration').querySelector('td:nth-child(2)')?.textContent).toBe('ServerGeneration?')
      expect(htmlRow('RequiredGeneration').querySelector('td a.api-type-link')?.getAttribute('href')).toBe(generation)
      expect(htmlRow('RequiredGeneration').querySelector('td:last-child')?.textContent).toContain(field('RequiredGeneration').doc!.summary)
    } finally { await window.happyDOM.abort() }
  })
})

describe('a port\'s word for its fields', () => {
  it('is Properties for C#, whose types declare properties, and Fields for Rust, Go and any other port', () => {
    expect(fieldsLabel('csharp')).toBe('Properties')
    for (const port of ['rs', 'go', 'py', undefined]) expect(fieldsLabel(port), String(port)).toBe('Fields')
  })

  it.each([['rs', 'pane.CapturedLine', 'Fields'], ['go', 'tmux.DisplayMessageRequest', 'Fields'], ['csharp', 'LibTmux.ClientAttachment', 'Properties']] as const)(
    'heads the Markdown table of %s %s with %s, and with no other word', (port, id, word) => {
      const f = portFixture(port)
      const headings = f.markdown(f.symbol(id)).split('\n').filter((line) => line.startsWith('## '))
      expect(headings).toContain(`## ${word}`)
      expect(headings).not.toContain(`## ${word === 'Fields' ? 'Properties' : 'Fields'}`)
    })

  it('is the contents entry beside the count, under the same id', () => {
    const sections = apiMemberSections({ fields: 3, members: 2, label: 'Members', fieldsLabel: fieldsLabel('csharp'), groups: [] })
    expect(sections).toEqual([{ id: 'api-fields', label: 'Properties', count: 3 }, { id: 'api-members', label: 'Members', count: 2 }])
    expect(apiMemberSections({ fields: 3, members: 0, label: 'Members', groups: [] })).toEqual([{ id: 'api-fields', label: 'Fields', count: 3 }])
  })

  it('keeps the parent objects of a type at the head of its table, as they led its member list', () => {
    const cs = portFixture('csharp')
    const signals = memberSignals('csharp', mentionsData.mentions)
    for (const id of ['LibTmux.Pane', 'LibTmux.Session', 'LibTmux.Window']) {
      const owner = cs.symbol(id)
      const fields = splitFieldMembers(owner, membersOf(cs.model, owner, signals), 'csharp').fields
      const parents = fields.filter((field) => memberTier(field, signals) === 'parent')
      expect(parents.length, id).toBeGreaterThan(0)
      expect(fields.slice(0, parents.length).map((field) => field.id), id).toEqual(parents.map((field) => field.id))
      const rows = cs.markdown(owner).split('\n').filter((line) => line.startsWith('| [`'))
      expect(rows.slice(0, parents.length).map((row) => /\]\(([^)]*)\)/.exec(row)![1]), id).toEqual(parents.map((field) => cs.hrefFor(field)))
    }
  })
})

afterAll(() => vi.unstubAllGlobals())
