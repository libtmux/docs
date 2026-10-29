import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiMemberSections, hasFieldMembers, memberTableColumns, splitFieldMembers } from '../src/lib/api-sections'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { apiComponents } from './api-components'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

type FieldPort = 'rs' | 'go'

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
  // The raw attributes an owner declares, in the file's order, whatever the model orders or filters.
  const rawFields = (owner: ApiSymbol) => raw.symbols.filter((entry) => entry.parent === owner.id && entry.kind === 'attribute')
  return { port, model, hrefFor, index, raw, symbol, fieldsOf, markdown, markdownRows, rawFields }
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
    const block = /<div class="([^"]*)">\s*<h2[^>]*id="api-fields"/.exec(page)![1]
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

// Per port: a struct of only fields (the one the sabotage cases remove a field from), structs with methods
// beside their fields, and a type the model keeps no field of.
const PURE: Record<FieldPort, string> = { rs: 'pane.CapturedLine', go: 'tmux.DisplayMessageRequest' }
const MIXED: Record<FieldPort, string[]> = {
  rs: ['config.Workspace', 'config.ShellCommand', 'mcp.cli.Options'],
  go: ['tmux.SessionFilter', 'tmux.CommandError', 'tmux.CommandTrace'],
}
const FIELDLESS: Record<FieldPort, string> = { rs: 'blocking.Runtime', go: 'tmux.Connection' }

describe.each(['rs', 'go'] as const)('%s field tables against the committed data', (port) => {
  const f = portFixture(port)
  const isRecord = (owner: ApiSymbol) => owner.kind === 'struct' || owner.variant === 'struct' || owner.variant === 'tuple'
  const hasTable = (owner: ApiSymbol) => splitFieldMembers(owner, f.fieldsOf(owner), port).fields.length > 0
  // The rows of the Fields table: from its heading to the next top-level section.
  const tableRows = (owner: ApiSymbol, symbols = f.model.symbols) => {
    const lines = f.markdown(owner, symbols).split('\n')
    const start = lines.indexOf('## Fields')
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
    const withFields = f.raw.symbols.filter((owner) => isRecord(owner) && f.rawFields(owner).some((field) => field.type !== undefined))
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
      const fieldsAt = lines.indexOf('## Fields')
      const membersAt = lines.indexOf('## Members')
      return {
        fieldsAt, membersAt,
        table: linkedIn(lines.slice(fieldsAt, nextSection(lines, fieldsAt)).filter((line) => line.startsWith('| [`'))),
        list: linkedIn(lines.slice(membersAt, nextSection(lines, membersAt)).filter((line) => line.startsWith('- ['))),
      }
    }

    it('splits the raw children into a Fields table and the remaining list, with none lost or repeated', () => {
      const fields = children().filter((entry) => entry.kind === 'attribute')
      const others = children().filter((entry) => entry.kind !== 'attribute')
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
      expect(apiMemberSections({ fields: fields.length, members: rest.length, label: 'Members', groups })).toEqual([
        { id: 'api-fields', label: 'Fields', count: fields.length },
        { id: 'api-members', label: 'Members', count: rest.length },
        { id: 'api-other-members', label: 'Other members', nested: true },
      ])
    })

    it('fails the split when a field is dropped from a copy of the data', () => {
      const victim = children().find((entry) => entry.kind === 'attribute')!.id
      const out = split(f.model.symbols.filter((entry) => entry.id !== victim))
      expect(out.table).toHaveLength(children().filter((entry) => entry.kind === 'attribute').length - 1)
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

afterAll(() => vi.unstubAllGlobals())
