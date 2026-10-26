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

const model = API_MODELS.rs
const hrefFor = (symbol: ApiSymbol) => `/en/rs/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'rs')
const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
const fieldsOf = (owner: ApiSymbol) => membersOf(model, owner).filter((member) => !member.inheritedFrom)
const markdownRows = (owner: ApiSymbol) => symbolMarkdown({ model, symbol: owner, index, hrefFor })
  .split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Name') && !line.startsWith('| ---'))

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

  // The oracle reads the committed file, not the member list the predicate and renderer consume.
  const raw: { symbols: ApiSymbol[] } = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8'))
  const rawFieldCount = (symbols: ApiSymbol[], owner: ApiSymbol) =>
    symbols.filter((entry) => entry.parent === owner.id && entry.kind === 'attribute').length
  const sweep = (symbols: ApiSymbol[]) => {
    const copy = { ...model, symbols }
    return model.symbols.filter((owner) => hasFieldMembers(owner, fieldsOf(owner), 'rs')).map((owner) => ({
      id: owner.id, rows: symbolMarkdown({ model: copy, symbol: owner, index, hrefFor }).split('\n').filter((line) => line.startsWith('| [`')).length,
      expected: rawFieldCount(raw.symbols, owner),
    }))
  }

  it('renders one row per raw field for every eligible type', () => {
    const results = sweep(model.symbols)
    expect(results.length).toBeGreaterThan(50)
    expect(results.filter((entry) => entry.rows !== entry.expected)).toEqual([])
  })

  it('the sweep fails when one field is removed from a copy of the data', () => {
    const victim = fieldsOf(symbol('pane.CapturedLine'))[0].id
    const results = sweep(model.symbols.filter((entry) => entry.id !== victim))
    expect(results.filter((entry) => entry.rows !== entry.expected).map((entry) => entry.id)).toEqual(['pane.CapturedLine'])
  })

  it('chooses the fields columns for every Rust field owner, never the value columns', () => {
    for (const owner of model.symbols.filter((entry) => hasFieldMembers(entry, fieldsOf(entry), 'rs'))) {
      expect(memberTableColumns(owner, fieldsOf(owner), 'rs'), owner.id).toBe('fields')
    }
    expect(memberTableColumns(symbol('blocking.Runtime'), fieldsOf(symbol('blocking.Runtime')), 'rs')).toBeUndefined()
  })

  it('shows no table for a type without fields (clean control)', () => {
    for (const id of ['blocking.Runtime']) {
      const owner = symbol(id)
      expect(hasFieldMembers(owner, fieldsOf(owner), 'rs'), id).toBe(false)
      expect(symbolMarkdown({ model, symbol: owner, index, hrefFor })).not.toContain('| Name | Type | Description |')
    }
    const empty = { ...symbol('pane.CapturedLine') }
    expect(hasFieldMembers(empty, [], 'rs')).toBe(false)
    expect(hasFieldMembers(symbol('pane.CapturedLine'), fieldsOf(symbol('pane.CapturedLine')), 'go')).toBe(false)
  })

  describe.each(['config.Workspace', 'config.ShellCommand', 'mcp.cli.Options'])('mixed type %s', (id) => {
    const owner = symbol(id)
    const children = () => raw.symbols.filter((entry) => entry.parent === id)
    const hrefs = (symbols: ApiSymbol[]) => symbols.map((entry) => hrefFor(model.symbols.find((m) => m.id === entry.id)!))
    const linkedIn = (lines: string[]) => lines.map((line) => /\]\(([^)]*)\)/.exec(line)![1])
    // Each part ends at the next top-level section; later sections link elsewhere.
    const nextSection = (lines: string[], from: number) => {
      const at = lines.findIndex((line, i) => i > from && line.startsWith('## '))
      return at < 0 ? lines.length : at
    }
    const split = (symbols = model.symbols) => {
      const lines = symbolMarkdown({ model: { ...model, symbols }, symbol: owner, index, hrefFor }).split('\n')
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
      const parts = splitFieldMembers(owner, fieldsOf(owner), 'rs')
      expect(parts.fields.map((entry) => entry.id).toSorted()).toEqual(fields.map((entry) => entry.id).toSorted())
      expect(parts.rest.map((entry) => entry.id).toSorted()).toEqual(others.map((entry) => entry.id).toSorted())
      expect(hasFieldMembers(owner, fieldsOf(owner), 'rs')).toBe(false)
      expect(memberTableColumns(owner, fieldsOf(owner), 'rs')).toBeUndefined()
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
      const { fields, rest } = splitFieldMembers(owner, fieldsOf(owner), 'rs')
      const groups = [{ id: 'api-other-members', label: 'Other members' }]
      expect(apiMemberSections({ fields: fields.length, members: rest.length, label: 'Members', groups })).toEqual([
        { id: 'api-fields', label: 'Fields', count: fields.length },
        { id: 'api-members', label: 'Members', count: rest.length },
        { id: 'api-other-members', label: 'Other members', nested: true },
      ])
    })

    it('fails the split when a field is dropped from a copy of the data', () => {
      const victim = children().find((entry) => entry.kind === 'attribute')!.id
      const out = split(model.symbols.filter((entry) => entry.id !== victim))
      expect(out.table).toHaveLength(children().filter((entry) => entry.kind === 'attribute').length - 1)
    })
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

afterAll(() => vi.unstubAllGlobals())
