import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, memberSignals, memberTier, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiMemberSections, fieldsLabel, hasFieldMembers, memberTable, memberTableColumns, splitFieldMembers } from '../src/lib/api-sections'
import mentionsData from '../src/data/mentions.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { apiComponents } from './api-components'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

type FieldPort = 'rs' | 'go' | 'csharp' | 'swift'

/**
 * What the committed file calls an owner of fields and a field, written out apart from the predicate under test.
 * A C# or Swift static property is a named value of its type, as a constant is, so the oracle leaves it out.
 * A Swift member inherited from a protocol is declared by that protocol, not by the type that conforms.
 */
const isRecord = (entry: ApiSymbol) => entry.kind === 'struct' || entry.variant === 'struct' || entry.variant === 'tuple'
const RAW_RULES: Record<FieldPort, { owner: (entry: ApiSymbol) => boolean; field: (entry: ApiSymbol) => boolean }> = {
  rs: { owner: isRecord, field: (entry) => entry.kind === 'attribute' },
  go: { owner: isRecord, field: (entry) => entry.kind === 'attribute' },
  csharp: { owner: (entry) => entry.kind === 'class' || entry.kind === 'struct', field: (entry) => entry.kind === 'property' && !entry.modifiers.includes('static') },
  swift: { owner: (entry) => entry.kind === 'class' || entry.kind === 'struct', field: (entry) => entry.kind === 'property' && !entry.modifiers.includes('static') && !entry.inheritedFrom },
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
const PURE: Record<FieldPort, string> = { rs: 'pane.CapturedLine', go: 'tmux.DisplayMessageRequest', csharp: 'LibTmux.ClientAttachment', swift: 'ToolDefinition' }
const MIXED: Record<FieldPort, string[]> = {
  rs: ['config.Workspace', 'config.ShellCommand', 'mcp.cli.Options'],
  go: ['tmux.SessionFilter', 'tmux.CommandError', 'tmux.CommandTrace'],
  // ServerConnectionOptions also declares a static property, which belongs to the list.
  csharp: ['LibTmux.TmuxCommand', 'LibTmux.Client', 'LibTmux.ServerConnectionOptions'],
  // Client is a struct with methods and an inherited operator, ServerConfiguration one with a static property beside its
  // properties, and SessionID one with a static property and a property inherited from RawRepresentable.
  swift: ['Client', 'ServerConfiguration', 'SessionID'],
}
// LibTmuxInfo and MCPRequestHandler declare typed properties too, all of them static.
const FIELDLESS: Record<FieldPort, string> = { rs: 'blocking.Runtime', go: 'tmux.Connection', csharp: 'LibTmux.LibTmuxInfo', swift: 'MCPRequestHandler' }

describe.each(['rs', 'go', 'csharp', 'swift'] as const)('%s field tables against the committed data', (port) => {
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
    // The first link of a line is its member's page; a Swift selector puts parentheses in that address, and every address ends in a slash.
    const linkedIn = (lines: string[]) => lines.map((line) => /\]\((\S*?\/)\)/.exec(line)![1])
    // Each part ends at the next top-level section; later sections link elsewhere.
    const nextSection = (lines: string[], from: number) => {
      const at = lines.findIndex((line, i) => i > from && line.startsWith('## '))
      return at < 0 ? lines.length : at
    }
    const split = (symbols = f.model.symbols) => {
      const lines = f.markdown(owner, symbols).split('\n')
      const fieldsAt = lines.indexOf(`## ${fieldsLabel(port)}`)
      const membersAt = lines.indexOf('## Members')
      const inheritedAt = lines.indexOf('## Inherited members')
      return {
        fieldsAt, membersAt,
        table: linkedIn(lines.slice(fieldsAt, nextSection(lines, fieldsAt)).filter((line) => line.startsWith('| [`'))),
        list: linkedIn(lines.slice(membersAt, nextSection(lines, membersAt)).filter((line) => line.startsWith('- ['))),
        inherited: inheritedAt < 0 ? [] : linkedIn(lines.slice(inheritedAt, nextSection(lines, inheritedAt)).filter((line) => line.startsWith('- ['))),
      }
    }

    it('splits the raw children into a Fields table and the remaining list, with none lost or repeated', () => {
      // A member the type inherits is listed apart from both, under Inherited members.
      const inherited = children().filter((entry) => entry.inheritedFrom)
      const fields = children().filter(f.isRawField)
      const others = children().filter((entry) => !f.isRawField(entry) && !entry.inheritedFrom)
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
      expect(out.inherited.toSorted()).toEqual(hrefs(inherited).toSorted())
      const all = [...out.table, ...out.list, ...out.inherited]
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

describe('Swift field tables', () => {
  const sw = portFixture('swift')
  const owner = sw.symbol('Client')
  const field = (name: string) => sw.fieldsOf(owner).find((member) => member.name === name)!
  const children = (id: string) => sw.raw.symbols.filter((entry) => entry.parent === id)
  const rowsOf = (record: ApiSymbol) => sw.markdownRows(record).filter((row) => row.startsWith('| [`'))
  /** The text a Markdown reader shows in a row's Type cell: code spans as CommonMark reads them, links as their labels. */
  const shownType = (row: string) => {
    const text = (node: { value?: string; children?: unknown[] }): string => node.value ?? (node.children ?? []).map((child) => text(child as typeof node)).join('')
    return text(fromMarkdown(row.split(' | ')[1].replaceAll('\\|', '|')))
  }
  const ids = (symbols: ApiSymbol[]) => symbols.map((entry) => entry.id).toSorted()
  /** The Properties section of a type's Markdown, and the Members section after it. */
  const sections = (record: ApiSymbol) => {
    const markdown = sw.markdown(record)
    const members = markdown.indexOf('## Members')
    return { table: markdown.slice(markdown.indexOf('## Properties'), members < 0 ? undefined : members), members: members < 0 ? '' : markdown.slice(members) }
  }

  it('has one row per raw child of a struct of only properties, and one per raw instance property of a mixed one', () => {
    const pure = sw.symbol('ToolDefinition')
    expect(children(pure.id).length).toBeGreaterThan(0)
    expect(children(pure.id).every((entry) => entry.kind === 'property' && !entry.modifiers.includes('static'))).toBe(true)
    expect(rowsOf(pure)).toHaveLength(children(pure.id).length)

    const declared = children(owner.id).filter((entry) => !entry.inheritedFrom)
    const instance = declared.filter((entry) => entry.kind === 'property' && !entry.modifiers.includes('static'))
    expect(instance.length).toBeGreaterThan(0)
    expect(instance.length).toBeLessThan(children(owner.id).length)
    expect(rowsOf(owner)).toHaveLength(instance.length)
    // The methods stay in the list, and nothing outside the table is a row.
    expect(rowsOf(owner).map((row) => /\]\((\S*?\/)\)/.exec(row)![1]).toSorted()).toEqual(instance.map((entry) => sw.hrefFor(entry)).toSorted())
  })

  it('writes the type of every property as the model records it, in the Markdown row of every struct and class that has them', () => {
    let checked = 0
    for (const record of sw.model.symbols.filter((entry) => sw.isRawOwner(entry) && sw.rawFields(entry).length > 0)) {
      const rows = rowsOf(record)
      for (const raw of sw.rawFields(record)) {
        const row = rows.find((candidate) => candidate.includes(`](${sw.hrefFor(raw)})`))
        expect(row, raw.id).toBeDefined()
        expect(shownType(row!), raw.id).toBe(raw.type)
        checked++
      }
    }
    expect(checked).toBe(sw.raw.symbols.filter((entry) => sw.isRawField(entry) && sw.isRawOwner(sw.raw.symbols.find((parent) => parent.id === entry.parent)!)).length)
  })

  it('shows a property with no summary as an empty description, and writes none for it', async () => {
    const pure = sw.symbol('ToolDefinition')
    const bare = sw.fieldsOf(pure).filter((member) => !member.doc?.summary)
    const documented = sw.fieldsOf(pure).filter((member) => member.doc?.summary)
    expect(bare.length).toBeGreaterThan(0)
    expect(documented.length).toBeGreaterThan(0)
    for (const member of bare) expect(rowsOf(pure).find((row) => row.includes(`](${sw.hrefFor(member)})`))!.endsWith(' |  |'), member.id).toBe(true)

    const { members } = await apiComponents()
    const window = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      window.document.body.innerHTML = await container.renderToString(members, { props: { owner: pure, members: sw.fieldsOf(pure), index: sw.index, hrefFor: sw.hrefFor, columns: 'fields' } })
      const htmlRows = [...window.document.querySelectorAll('tbody tr')]
      const description = (member: ApiSymbol) => htmlRows.find((row) => row.querySelector('th a')?.textContent === member.name)!.querySelector('td:last-child')!
      for (const member of bare) expect(description(member).textContent, member.id).toBe('')
      // A DocC reference in a summary draws as code, so the page's text and the raw summary differ; the plain ones match.
      for (const member of documented) expect(description(member).textContent!.trim(), member.id).not.toBe('')
      expect(description(sw.symbol('ToolDefinition.title')).textContent).toContain(sw.symbol('ToolDefinition.title').doc!.summary)
    } finally { await window.happyDOM.abort() }
  })

  it('links a nullable and a builtin type to their pages, in Markdown and HTML', async () => {
    const pane = sw.index.linkType('PaneID?', field('activePaneID')).find((span) => span.text === 'PaneID')!.link!.href
    const int = sw.index.linkType('Int?', field('height')).find((span) => span.text === 'Int')!.link!.href
    expect(pane).toBe(sw.hrefFor(sw.symbol('PaneID')))
    expect(int).toBe('https://developer.apple.com/documentation/swift/int')
    const row = (name: string) => rowsOf(owner).find((candidate) => candidate.startsWith(`| [\`${name}\`]`))!
    expect(row('activePaneID')).toContain(`[\`PaneID\`](${pane})\`?\``)
    expect(row('height')).toContain(`[\`Int\`](${int})\`?\``)

    const { members } = await apiComponents()
    const window = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      window.document.body.innerHTML = await container.renderToString(members, { props: { owner, members: splitFieldMembers(owner, sw.fieldsOf(owner), 'swift').fields, index: sw.index, hrefFor: sw.hrefFor, columns: 'fields', repeated: true } })
      expect([...window.document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Name', 'Type', 'Description'])
      const htmlRows = [...window.document.querySelectorAll('tbody tr')]
      expect(htmlRows).toHaveLength(sw.rawFields(owner).length)
      const htmlRow = (name: string) => htmlRows.find((candidate) => candidate.querySelector('th a')?.textContent === name)!
      const hrefs = (name: string) => [...htmlRow(name).querySelectorAll('td:nth-child(2) a.api-type-link')].map((link) => link.getAttribute('href'))
      expect(htmlRow('activePaneID').querySelector('td:nth-child(2)')?.textContent).toBe(field('activePaneID').type)
      expect(hrefs('activePaneID')).toContain(pane)
      expect(hrefs('height')).toContain(int)
      expect(htmlRow('activePaneID').querySelector('td:last-child')?.textContent).toContain(field('activePaneID').doc!.summary)
    } finally { await window.happyDOM.abort() }
  })

  it('keeps a static property in the member list, beside the properties of its type', () => {
    const id = sw.symbol('SessionID')
    const named = sw.raw.symbols.find((entry) => entry.id === 'SessionID.sigil')!
    expect(named).toMatchObject({ kind: 'property', modifiers: ['static'] })
    const { fields, rest } = splitFieldMembers(id, sw.fieldsOf(id), 'swift')
    expect(fields.map((entry) => entry.id)).not.toContain(named.id)
    expect(rest.map((entry) => entry.id)).toContain(named.id)
    const { table, members } = sections(id)
    expect(table).not.toContain('`sigil`')
    expect(members).toContain(`[\`sigil\`](${sw.hrefFor(named)}) (property)`)
  })

  it('lists a property that a type inherits under Inherited members, not in the table or the member list', () => {
    const id = sw.symbol('SessionID')
    const borrowed = sw.raw.symbols.find((entry) => entry.id === 'SessionID.hashValue')!
    expect(borrowed).toMatchObject({ kind: 'property', inheritedFrom: 'RawRepresentable.hashValue' })
    const all = membersOf(sw.model, id)
    expect(all.map((entry) => entry.id)).toContain(borrowed.id)
    const { fields, rest } = splitFieldMembers(id, all, 'swift')
    expect(fields.map((entry) => entry.id)).not.toContain(borrowed.id)
    expect(rest.map((entry) => entry.id)).toContain(borrowed.id)
    const markdown = sw.markdown(id)
    const inheritedAt = markdown.indexOf('## Inherited members')
    expect(inheritedAt).toBeGreaterThan(-1)
    expect(markdown.slice(0, inheritedAt)).not.toContain(`](${sw.hrefFor(borrowed)})`)
    expect(markdown.slice(inheritedAt)).toContain(`[\`hashValue\`](${sw.hrefFor(borrowed)}) (property), inherited from`)
  })

  it('keeps an enum\'s properties in its member list: they are computed from its cases', () => {
    const enumeration = sw.symbol('JSONValue')
    expect(enumeration.kind).toBe('enum')
    const computed = children(enumeration.id).filter((entry) => entry.kind === 'property' && !entry.modifiers.includes('static') && !entry.inheritedFrom)
    expect(computed.length).toBeGreaterThan(0)
    expect(computed.every((entry) => entry.type !== undefined)).toBe(true)
    const { fields, rest } = splitFieldMembers(enumeration, sw.fieldsOf(enumeration), 'swift')
    expect(fields).toEqual([])
    for (const entry of computed) expect(rest.map((member) => member.id)).toContain(entry.id)
    expect(hasFieldMembers(enumeration, sw.fieldsOf(enumeration), 'swift')).toBe(false)
    expect(memberTable(enumeration, sw.fieldsOf(enumeration), 'swift')).toBeUndefined()
    expect(memberTableColumns(enumeration, sw.fieldsOf(enumeration), 'swift')).toBeUndefined()
    const markdown = sw.markdown(enumeration)
    expect(markdown).not.toContain('## Properties')
    expect(markdown).not.toContain('| Name | Type | Description |')
    for (const entry of computed) expect(markdown).toContain(`[\`${entry.name}\`](${sw.hrefFor(entry)}) (property)`)
    // The same properties on a struct are a table, so it is the owner that decides.
    expect(ids(splitFieldMembers({ ...enumeration, kind: 'struct' }, sw.fieldsOf(enumeration), 'swift').fields)).toEqual(ids(computed))
  })

  it('lists only property members of a struct or a class: an attribute, a constant or a protocol does not hold them', () => {
    for (const kind of ['attribute', 'constant'] as const) {
      const extra: ApiSymbol = { ...field('width'), id: `${owner.id}.Extra`, name: 'Extra', kind }
      const { fields, rest } = splitFieldMembers(owner, [...sw.fieldsOf(owner), extra], 'swift')
      expect(fields.map((entry) => entry.id), kind).not.toContain(extra.id)
      expect(rest.map((entry) => entry.id), kind).toContain(extra.id)
    }
    expect(splitFieldMembers({ ...owner, kind: 'interface' }, sw.fieldsOf(owner), 'swift').fields).toEqual([])
    // A property with no type has nothing for the Type column, so it stays in the list.
    const untyped: ApiSymbol = { ...field('width'), id: `${owner.id}.Untyped`, name: 'Untyped', type: undefined }
    const parts = splitFieldMembers(owner, [...sw.fieldsOf(owner), untyped], 'swift')
    expect(parts.fields.map((entry) => entry.id)).not.toContain(untyped.id)
    expect(parts.rest.map((entry) => entry.id)).toContain(untyped.id)
    const holder = sw.symbol('ControlSession')
    expect(holder.kind).toBe('class')
    expect(ids(splitFieldMembers(holder, sw.fieldsOf(holder), 'swift').fields)).toEqual(ids(sw.rawFields(holder)))
  })

  it('names the table Properties through the function the page uses, and keeps one table for a type of only properties', () => {
    const pure = sw.symbol('ToolDefinition')
    const table = memberTable(pure, sw.fieldsOf(pure), 'swift')!
    expect(table).toMatchObject({ columns: 'fields', label: 'Properties', id: 'api-fields', rest: [] })
    expect(ids(table.rows)).toEqual(ids(sw.rawFields(pure)))
    expect(memberTableColumns(pure, sw.fieldsOf(pure), 'swift')).toBe('fields')
    const mixed = memberTable(owner, sw.fieldsOf(owner), 'swift')!
    expect(mixed).toMatchObject({ columns: 'fields', label: 'Properties', id: 'api-fields' })
    expect(mixed.rest.length).toBeGreaterThan(0)
    expect(memberTableColumns(owner, sw.fieldsOf(owner), 'swift')).toBeUndefined()
  })
})

describe('a port\'s word for its fields', () => {
  it('is Properties for C# and Swift, whose types declare properties, and Fields for Rust, Go and any other port', () => {
    expect(fieldsLabel('csharp')).toBe('Properties')
    expect(fieldsLabel('swift')).toBe('Properties')
    for (const port of ['rs', 'go', 'py', undefined]) expect(fieldsLabel(port), String(port)).toBe('Fields')
  })

  it.each([['rs', 'pane.CapturedLine', 'Fields'], ['go', 'tmux.DisplayMessageRequest', 'Fields'], ['csharp', 'LibTmux.ClientAttachment', 'Properties'], ['swift', 'ToolDefinition', 'Properties'], ['swift', 'Client', 'Properties']] as const)(
    'heads the Markdown table of %s %s with %s, and with no other word', (port, id, word) => {
      const f = portFixture(port)
      const headings = f.markdown(f.symbol(id)).split('\n').filter((line) => line.startsWith('## '))
      expect(headings).toContain(`## ${word}`)
      expect(headings).not.toContain(`## ${word === 'Fields' ? 'Properties' : 'Fields'}`)
    })

  it('is the contents entry beside the count, under the same id', () => {
    const sections = apiMemberSections({ fields: 3, members: 2, label: 'Members', fieldsLabel: fieldsLabel('csharp'), groups: [] })
    expect(sections).toEqual([{ id: 'api-fields', label: 'Properties', count: 3 }, { id: 'api-members', label: 'Members', count: 2 }])
    expect(apiMemberSections({ fields: 3, members: 2, label: 'Members', fieldsLabel: fieldsLabel('swift'), groups: [] })).toEqual(sections)
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
