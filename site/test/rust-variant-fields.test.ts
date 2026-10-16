import { describe, expect, it } from 'vitest'
import { membersOf, navSidecarFor, SymbolIndex, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { isMemberOwner } from '../src/lib/api-models'
import { membersByTypeFor, navTreeFor, referenceTreeFor } from '../src/lib/api-tree'
import { searchApi } from '../src/lib/api-search'
import { apiEntryFields, apiEntrySections, hasScalarMembers } from '../src/lib/api-sections'
import { symbolPreview } from '../src/lib/link-preview'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const source = { file: 'control.rs', repo: 'libtmux/libtmux-rs', revision: 'pinned' }
const symbols: ApiSymbol[] = [
  { id: 'control.Event', name: 'Event', kind: 'enum', modifiers: [], signatures: [], source },
  { id: 'control.Event.Output', name: 'Output', parent: 'control.Event', kind: 'constant', variant: 'struct', modifiers: [],
    signatures: [{ raw: 'Output {\n    pane: PaneId,\n    bytes: Vec<u8>,\n}', params: [] }], source },
  { id: 'control.Event.Output.pane', name: 'pane', parent: 'control.Event.Output', kind: 'attribute', type: 'PaneId',
    modifiers: [], signatures: [], doc: { summary: 'The pane that produced it.' }, source },
  { id: 'control.Event.Output.bytes', name: 'bytes', parent: 'control.Event.Output', kind: 'attribute', type: 'Vec<u8>',
    modifiers: [], signatures: [], doc: { summary: 'The output bytes.' }, source },
]
const model: ApiModel = { port: 'rs', extractor: 'test', symbols }
const variant = symbols[1]
const hrefFor = (symbol: ApiSymbol) => `/en/rs/latest/reference/${symbol.id}/`
const index = new SymbolIndex(symbols, hrefFor, 'rs')

describe('Rust payload documentation surfaces', () => {
  it.fails('keeps field order and makes payload fields discoverable through initial and lazy navigation and search', () => {
    expect(isMemberOwner(variant)).toBe(true)
    expect(membersOf(model, variant).map((field) => field.name)).toEqual(['pane', 'bytes'])
    expect(membersByTypeFor('rs', model).get(variant.id)?.map((field) => field.id)).toEqual(symbols.slice(2).map((field) => field.id))
    const nav = navSidecarFor('rs', model, { buckets: [{ id: 'events', label: 'Events', match: { kind: 'id', is: 'control.Event' } }] })
    const tree = referenceTreeFor('rs', model, navTreeFor(model, nav))
    expect(tree.members[variant.id]?.map((row) => row[2])).toEqual(symbols.slice(2).map((field) => field.id))
    expect(searchApi(tree, 'Event Output bytes').map((field) => field.id)).toContain('control.Event.Output.bytes')
    expect(hasScalarMembers(variant, membersOf(model, variant))).toBe(false)
  })

  it.fails('exports structural payload text and linked typed fields without a parameter section', () => {
    const markdown = symbolMarkdown({ model, symbol: variant, index, hrefFor })
    expect(markdown).toContain(variant.signatures[0].raw)
    expect(markdown).toContain('## Fields')
    expect(markdown).toContain('[`pane`](/en/rs/latest/reference/control.Event.Output.pane/) (`PaneId`): The pane that produced it.')
    expect(markdown).toContain('[`bytes`](/en/rs/latest/reference/control.Event.Output.bytes/) (`Vec<u8>`): The output bytes.')
    expect(markdown).not.toContain('## Parameters')
    expect(symbolMarkdown({ model, symbol: symbols[2], index, hrefFor })).toContain('pane: PaneId')
    expect(apiEntryFields(variant, 'rs').params).toEqual([])
    expect(apiEntrySections(variant, 'rs')).not.toContainEqual(expect.objectContaining({ label: 'Parameters' }))
    expect(symbolPreview(model, variant, 'latest')).toMatchObject({ signature: variant.signatures[0].raw, signatureLanguage: 'rust' })
  })

  it('does not turn ordinary constants or methods into payload owners', () => {
    const ordinary = { ...variant, variant: undefined }
    expect(isMemberOwner(ordinary)).toBe(false)
    expect(apiEntrySections({ ...ordinary, kind: 'method', signatures: [{ params: [{ name: 'value', doc: 'The input.' }] }] }, 'rs'))
      .toContainEqual(expect.objectContaining({ label: 'Parameters' }))
  })
})
