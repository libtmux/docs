import { describe, expect, it } from 'vitest'
import type { ApiModelBase, ApiSymbol } from '@libtmux/api-model'
import type { PortNavData } from '../src/lib/api-models'
import { bucketTotal, firstEntry, membersByTypeFor, navTreeFor, referenceIndexSectionsFor, referenceTreeFor } from '../src/lib/api-tree'
import { searchApi } from '../src/lib/api-search'

const symbol = (id: string, kind: ApiSymbol['kind'], parent?: string): ApiSymbol => ({
  id, name: id, qualifiedName: id, kind, parent, slug: id.replaceAll(':', '-'),
  apiScope: 'internal', modifiers: [], signatures: [], source: { file: 'tmux.h' },
})
const model: ApiModelBase = { extractor: 'fixture', symbols: [
  symbol('value', 'union'), symbol('value:nested', 'union', 'value'),
  symbol('value:nested:integer', 'attribute', 'value:nested'), symbol('read', 'function'),
  { ...symbol('one:callback', 'function'), name: 'callback' },
  { ...symbol('two:callback', 'function'), name: 'callback' },
] }
const entry = (id: string) => {
  const item = model.symbols.find((candidate) => candidate.id === id)!
  return { id, name: item.name, kind: item.kind, slug: item.slug! }
}
const nav: PortNavData = {
  port: 'tmux',
  buckets: [{ id: 'source', label: 'Source', collapsed: false, children: [
    { id: 'header', label: 'Header', collapsed: true, children: [
      { id: 'types', label: 'Types', collapsed: true },
    ] },
  ] }],
  assignments: { source: [entry('read'), entry('one:callback'), entry('two:callback')], header: [], types: [entry('value')] },
  placement: { read: 'source', 'one:callback': 'source', 'two:callback': 'source', value: 'types' },
  unplaced: [],
}

describe('source catalog reference navigation', () => {
  it('shares ordered sections, counts, search and nested union members without a library port', () => {
    const tree = navTreeFor(model, nav)
    expect(tree[0].entries.map((item) => item.name)).toEqual(['read', 'one:callback', 'two:callback'])
    expect(bucketTotal(tree[0])).toBe(4)
    expect(firstEntry(tree[0])?.slug).toBe('value')
    const sections = referenceIndexSectionsFor(model, tree)
    expect(sections.map((section) => [section.id, section.name, section.collapsed])).toEqual([
      ['source', 'Source', false], ['types', 'Source — Header — Types', true],
    ])
    expect(sections[1].types.map((item) => item.id)).toEqual(['value'])
    const json = referenceTreeFor('tmux:3.7c', model, tree)
    expect(json.port).toBe('tmux:3.7c')
    expect(json.members.value[0].slice(0, 5)).toEqual(['value:nested', 'value-nested', 'value:nested', 'union', 'types'])
    expect(json.members['value:nested'][0][2]).toBe('value:nested:integer')
    expect(searchApi(json, '').map((item) => item.id).sort()).toEqual(model.symbols.map((item) => item.id).sort())
    expect(searchApi(json, 'value:nested', 'types').map((item) => item.id)).toContain('value:nested')
    expect(searchApi(json, 'value:nested:integer', 'members').map((item) => item.id)).toEqual(['value:nested:integer'])
    expect(model).not.toHaveProperty('port')
  })

  it('does not share member caches between releases with the same scope', () => {
    const first = membersByTypeFor('tmux', model)
    const next: ApiModelBase = { ...model, symbols: model.symbols.filter((item) => item.id !== 'value:nested:integer') }
    const second = membersByTypeFor('tmux', next)
    expect(first.get('value:nested')?.map((item) => item.id)).toEqual(['value:nested:integer'])
    expect(second.has('value:nested')).toBe(false)
    expect(membersByTypeFor('tmux', model)).toEqual(first)
  })

  it.each([
    [false, false, false, false],
    [false, true, false, true],
    [false, false, true, true],
    [true, false, false, true],
  ])('inherits closed sections for parent=%s child=%s grandchild=%s', (parent, child, grandchild, expected) => {
    const compiled = structuredClone(nav)
    compiled.buckets[0].collapsed = parent
    compiled.buckets[0].children![0].collapsed = child
    compiled.buckets[0].children![0].children![0].collapsed = grandchild
    const sections = referenceIndexSectionsFor(model, navTreeFor(model, compiled))
    expect(sections.map((section) => section.id)).toEqual(['source', 'types'])
    expect(sections[0].collapsed).toBe(parent)
    expect(sections[1].collapsed).toBe(expected)
    expect(sections[1].types.map((item) => item.id)).toEqual(['value'])
  })

  it('filters products only when requested and preserves internal declarations and input records', () => {
    const catalog: ApiModelBase = { extractor: 'fixture', symbols: [
      { ...symbol('workspace', 'struct'), product: 'workspace', apiScope: 'exported' },
      { ...symbol('workspace:public', 'attribute', 'workspace'), product: 'workspace', apiScope: 'exported' },
      { ...symbol('internal', 'union'), product: 'workspace' },
      symbol('internal:field', 'attribute', 'internal'),
    ] }
    const compiled: PortNavData = { port: 'fixture', buckets: [{ id: 'all', label: 'All', collapsed: false }],
      assignments: { all: catalog.symbols.filter((item) => !item.parent).map((item) => ({ id: item.id, name: item.name, kind: item.kind, slug: item.slug! })) },
      placement: { workspace: 'all', internal: 'all' }, unplaced: [] }
    const cached = membersByTypeFor('fixture', catalog)
    const before = structuredClone([...cached])
    const all = referenceTreeFor('fixture', catalog, navTreeFor(catalog, compiled))
    expect(searchApi(all, '').map((item) => item.id).sort()).toEqual(catalog.symbols.map((item) => item.id).sort())
    const core = referenceTreeFor('fixture', catalog, navTreeFor(catalog, compiled, { excludeProducts: true }), { excludeProducts: true, members: cached })
    expect(searchApi(core, '').map((item) => item.id)).toEqual(['internal', 'internal:field'])
    expect(Object.keys(core.members)).toEqual(['internal'])
    expect([...cached]).toEqual(before)
  })
})
