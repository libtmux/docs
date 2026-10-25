import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { hasFieldMembers, memberTableColumns } from '../src/lib/api-sections'
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
    for (const id of ['blocking.Runtime', 'config.Workspace']) {
      const owner = symbol(id)
      expect(hasFieldMembers(owner, fieldsOf(owner), 'rs'), id).toBe(false)
      expect(symbolMarkdown({ model, symbol: owner, index, hrefFor })).not.toContain('| Name | Type | Description |')
    }
    const empty = { ...symbol('pane.CapturedLine') }
    expect(hasFieldMembers(empty, [], 'rs')).toBe(false)
    expect(hasFieldMembers(symbol('pane.CapturedLine'), fieldsOf(symbol('pane.CapturedLine')), 'go')).toBe(false)
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
