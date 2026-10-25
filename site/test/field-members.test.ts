import { Window } from 'happy-dom'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { membersOf, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { hasFieldMembers } from '../src/lib/api-sections'
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
      expect(rows[i]).toContain(field.type!.split(/\W+/).filter(Boolean)[0])
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

  it('renders the fields of every eligible type, one row per modelled field', () => {
    const eligible = model.symbols.filter((owner) => hasFieldMembers(owner, fieldsOf(owner), 'rs'))
    expect(eligible.length).toBeGreaterThan(0)
    for (const owner of eligible) expect(markdownRows(owner), owner.id).toHaveLength(fieldsOf(owner).length)
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
