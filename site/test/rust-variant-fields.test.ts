import { describe, expect, it, vi } from 'vitest'
import { isMemberOwner as sharedMemberOwner, OWNER_KINDS as sharedOwnerKinds, ownersOf as proseOwnersOf, membersOf, navSidecarFor, SymbolIndex, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, API_NAV, isMemberOwner, OWNER_KINDS, ownersOf } from '../src/lib/api-models'
import { membersByTypeFor, navTreeFor, referenceTreeFor } from '../src/lib/api-tree'
import { searchApi } from '../src/lib/api-search'
import { apiEntryFields, apiEntrySections, hasScalarMembers } from '../src/lib/api-sections'
import { symbolPreview } from '../src/lib/link-preview'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { GET as referenceMarkdown, getStaticPaths } from '../src/pages/reference/[...slug].md'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

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
  it('publishes native ID owners in navigation, search and the real Markdown endpoint', async () => {
    const nativeModel = API_MODELS.rs
    const tree = referenceTreeFor('rs', nativeModel, navTreeFor(nativeModel, API_NAV.rs))
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'rs')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    try {
      const paths = await getStaticPaths()
      for (const name of ['SessionId', 'WindowId', 'PaneId']) {
        const owner = nativeModel.symbols.find((entry) => entry.id === `target.${name}`)!
        expect(searchApi(tree, name).map((entry) => entry.id)).toContain(owner.id)
        expect(paths).toContainEqual({ params: { slug: owner.slug }, props: { port: 'rs', id: owner.id } })
        // The endpoint only consumes props/site; no request runtime is needed.
        const response = await referenceMarkdown({
          props: { port: 'rs', id: owner.id }, site: new URL('https://libtmux.org'),
        } as unknown as Parameters<typeof referenceMarkdown>[0])
        expect(response.status).toBe(200)
        const markdown = await response.text()
        expect(markdown).toContain(owner.doc!.summary)
        expect(markdown).toContain(owner.doc!.body)
        expect(markdown).toContain(owner.doc!.examples![0].code)
        expect(markdown).toContain(`https://github.com/libtmux/libtmux-rs/blob/${nativeModel.revision}/crates/libtmux/src/primitives/target.rs#L${owner.source.line}`)
        expect(markdown).not.toContain('number: u32')
        expect(markdown).not.toContain('later_method')
      }
    } finally { vi.unstubAllEnvs() }
  })

  it('keeps field order and makes payload fields discoverable through initial and lazy navigation and search', () => {
    expect(isMemberOwner(variant)).toBe(true)
    expect(membersOf(model, variant).map((field) => field.name)).toEqual(['pane', 'bytes'])
    expect(membersByTypeFor('rs', model).get(variant.id)?.map((field) => field.id)).toEqual(symbols.slice(2).map((field) => field.id))
    const nav = navSidecarFor('rs', model, { buckets: [{ id: 'events', label: 'Events', match: { kind: 'id', is: 'control.Event' } }] })
    const tree = referenceTreeFor('rs', model, navTreeFor(model, nav))
    expect(tree.members[variant.id]?.map((row) => row[2])).toEqual(symbols.slice(2).map((field) => field.id))
    expect(searchApi(tree, 'Event Output bytes').map((field) => field.id)).toContain('control.Event.Output.bytes')
    expect(hasScalarMembers(variant, membersOf(model, variant))).toBe(false)
  })

  it('exports structural payload text and linked typed fields without a parameter section', () => {
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


describe('shared reference member ownership', () => {
  const constant = { kind: 'constant' as const, text: 'export const Direction = { Up: "UP" } as const', source }
  const typealias = { kind: 'typealias' as const, text: 'export type Direction = "UP"', source }
  const cases: [string, Partial<ApiSymbol>, boolean][] = [
    ...['class', 'exception', 'interface', 'struct', 'union', 'trait', 'enum', 'module', 'typealias'].map((kind) =>
      [kind, { kind: kind as ApiSymbol['kind'] }, true] as [string, Partial<ApiSymbol>, boolean]),
    ['named variant', { kind: 'constant', variant: 'struct' }, true],
    ['tuple variant', { kind: 'constant', variant: 'tuple' }, true],
    ['unit variant', { kind: 'constant', variant: 'unit' }, false],
    ['scalar constant', { kind: 'constant', type: 'number', modifiers: ['readonly'] }, false],
    ['constant object', { kind: 'constant', declarations: [constant] }, true],
    ['type/value family', { kind: 'typealias', declarations: [typealias, constant] }, true],
    ['type-only metadata on constant', { kind: 'constant', declarations: [typealias] }, false],
    ['nested function', { kind: 'function' }, false],
    ['constant metadata on function', { kind: 'function', declarations: [constant] }, false],
  ]

  it('uses the checker predicate without changing prose kind ownership', () => {
    expect(isMemberOwner).toBe(sharedMemberOwner)
    expect(OWNER_KINDS).toBe(sharedOwnerKinds)
    expect(ownersOf(model).map((owner) => owner.id)).toContain(variant.id)
    expect(proseOwnersOf(model).map((owner) => owner.id)).not.toContain(variant.id)
  })

  it.each(cases)('keeps initial and lazy %s ownership aligned', (_label, shape, expected) => {
    const parent: ApiSymbol = {
      id: 'fixture.Parent', name: 'Parent', kind: 'class', modifiers: [], signatures: [], source, ...shape,
    }
    const child: ApiSymbol = {
      id: `${parent.id}.child`, name: 'child', parent: parent.id,
      kind: 'attribute', type: 'u8', modifiers: [], signatures: [], source,
    }
    const fixture: ApiModel = { port: 'rs', extractor: 'fixture', symbols: [parent, child] }
    const nav = navSidecarFor('rs', fixture, { buckets: [{ id: 'parents', label: 'Parents', match: { kind: 'id', is: parent.id } }] })
    const tree = referenceTreeFor('rs', fixture, navTreeFor(fixture, nav))
    expect(ownersOf(fixture).map((owner) => owner.id)).toEqual(expected ? [parent.id] : [])
    expect(membersByTypeFor('rs', fixture).get(parent.id)?.map((member) => member.id)).toEqual(expected ? [child.id] : undefined)
    expect(tree.members[parent.id]?.map((row) => row[2])).toEqual(expected ? [child.id] : undefined)
  })
})
