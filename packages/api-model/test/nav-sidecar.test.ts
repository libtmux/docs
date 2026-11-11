import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ApiModel, ApiModelBase, ApiSymbol } from '../src/model.ts'
import { NAV } from '../src/nav-config.ts'
import { navSidecar, navSidecarFor, type NavConfig } from '../src/nav-sidecar.ts'

const symbol = (id: string, kind: ApiSymbol['kind'], parent?: string): ApiSymbol => ({
  id, name: id, kind, parent, slug: id, modifiers: [], signatures: [],
  apiScope: 'internal', source: { file: 'tmux.h' },
})

describe('explicit catalog navigation', () => {
  it('compiles native unions, free declarations and diagnostics without a library port', () => {
    const model: ApiModelBase = { extractor: 'fixture', symbols: [
      symbol('read_value', 'function'), symbol('value', 'union'),
      symbol('integer', 'attribute', 'value'), symbol('orphan', 'constant'),
    ] }
    const config: NavConfig = { buckets: [
      { id: 'types', label: 'Types', match: { kind: 'symbol', kinds: ['union'] } },
      { id: 'functions', label: 'Functions', match: { kind: 'symbol', kinds: ['function'] } },
      { id: 'missing', label: 'Missing', match: { kind: 'name', prefix: 'not_present' } },
    ] }
    const actual = navSidecarFor('tmux:3.7c', model, config)
    expect(actual.port).toBe('tmux:3.7c')
    expect(actual.assignments.types.map((entry) => entry.id)).toEqual(['value'])
    expect(actual.assignments.functions.map((entry) => entry.id)).toEqual(['read_value'])
    expect(actual.placement).toEqual({ value: 'types', read_value: 'functions', orphan: '__unplaced' })
    expect(actual.diagnostics).toEqual({ unmatched: ['orphan'], deadBuckets: ['missing'], ambiguous: [], staleUnsettled: [] })
    expect(actual.unplaced.map((entry) => entry.id)).toEqual(['orphan'])
    expect(model).not.toHaveProperty('port')
  })

  it('keeps union owners before free declarations and retains nested bucket shape', () => {
    const model: ApiModelBase = { extractor: 'fixture', symbols: [symbol('a_function', 'function'), symbol('z_union', 'union')] }
    const config: NavConfig = { buckets: [{ id: 'root', label: 'Root', match: { kind: 'path', re: 'tmux.h' }, children: [
      { id: 'child', label: 'Child', match: { kind: 'path', re: 'tmux.h' }, children: [
        { id: 'leaf', label: 'Leaf', match: { kind: 'path', re: 'tmux.h' } },
      ] },
    ] }] }
    const actual = navSidecarFor('tmux', model, config)
    expect(actual.buckets[0].children?.[0].children?.[0].id).toBe('leaf')
    expect(actual.assignments.leaf.map((entry) => entry.id)).toEqual(['z_union', 'a_function'])
  })

  it('ranks assigned exact ids before defaults without moving or duplicating declarations', () => {
    const model: ApiModelBase = { extractor: 'fixture', symbols: [
      symbol('first', 'struct'), { ...symbol('native_second', 'union'), publicId: 'second' },
      symbol('a_function', 'function'), symbol('z_function', 'function'), symbol('a_constant', 'constant'),
      { ...symbol('elsewhere', 'struct'), source: { file: 'other.c' } },
    ] }
    const config: NavConfig = { buckets: [{ id: 'root', label: 'Root', match: { kind: 'path', re: '^tmux.h$' }, children: [
      { id: 'nested', label: 'Nested', match: { kind: 'path', re: '^tmux.h$' },
        order: ['z_function', 'second', 'z_function', 'missing', 'elsewhere'] },
    ] }, { id: 'other', label: 'Other', match: { kind: 'path', re: '^other.c$' } }] }
    const original = structuredClone(config)
    const baseline = structuredClone(config)
    delete baseline.buckets[0].children![0].order
    const before = navSidecarFor('tmux', model, baseline)
    const actual = navSidecarFor('tmux', model, config)
    expect(before.assignments.nested.map((entry) => entry.id)).toEqual([
      'first', 'second', 'a_constant', 'a_function', 'z_function',
    ])
    expect(actual.assignments.nested.map((entry) => entry.id)).toEqual([
      'z_function', 'second', 'first', 'a_constant', 'a_function',
    ])
    expect(actual.assignments.other).toEqual(before.assignments.other)
    expect(actual.placement).toEqual(before.placement)
    expect(actual.diagnostics).toEqual(before.diagnostics)
    expect(config).toEqual(original)
  })

  it('keeps contextual shortcuts separate from canonical placement and rejects missing targets', () => {
    const model: ApiModelBase = { extractor: 'fixture', symbols: [symbol('owner', 'struct'), symbol('list_items', 'function')] }
    const config: NavConfig = { buckets: [
      { id: 'owner', label: 'Owner', match: { kind: 'id', is: 'owner' }, shortcuts: ['list_items'] },
      { id: 'items', label: 'Items', match: { kind: 'id', is: 'list_items' } },
    ] }
    const before = structuredClone(model)
    const actual = navSidecarFor('fixture', model, config)
    expect(actual.buckets[0].shortcuts?.map((entry) => entry.id)).toEqual(['list_items'])
    expect(actual.assignments.owner.map((entry) => entry.id)).toEqual(['owner'])
    expect(actual.placement.list_items).toBe('items')
    expect(actual.diagnostics.unmatched).toEqual([])
    expect(model).toEqual(before)
    config.buckets[0].shortcuts = ['missing']
    expect(() => navSidecarFor('fixture', model, config)).toThrow('unknown navigation shortcut')
  })
})

describe('existing port sidecars', () => {
  it.each(Object.keys(NAV))('keeps the generated %s sidecar byte-equivalent', (port) => {
    const model = JSON.parse(readFileSync(new URL(`../../../site/src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const expected = readFileSync(new URL(`../../../site/src/data/api/${port}.nav.json`, import.meta.url), 'utf8')
    expect(`${JSON.stringify(navSidecar(port, model))}\n`).toBe(expected)
  })
})

describe('native export groups', () => {
  const fixture = (): ApiModel => ({
    port: 'haskell', extractor: 'fixture',
    exportGroups: [
      { owner: 'Module.Z', title: 'Types', members: ['Module.Z#t:Value'] },
      { owner: 'Module.Z', title: 'Read values', members: ['Module.Z#v:z', 'Module.Z#v:a'] },
      { owner: 'Module.A', title: 'Types', members: ['Module.A#t:Other'] },
    ],
    symbols: [
      symbol('Module.Z', 'module'), symbol('Module.A', 'module'),
      symbol('Module.Z#v:a', 'function', 'Module.Z'),
      symbol('Module.Z#v:z', 'function', 'Module.Z'),
      symbol('Module.Z#t:Value', 'typealias', 'Module.Z'),
      symbol('Module.Z#v:Value', 'function', 'Module.Z#t:Value'),
      symbol('Module.A#t:Other', 'typealias', 'Module.A'),
    ].map((entry) => ({ ...entry, apiScope: 'exported' })),
  })

  it('preserves native module, group and declaration order without reparenting', () => {
    const model = fixture()
    const before = structuredClone(model)
    const actual = navSidecar('haskell', model)!
    expect(actual.buckets.map((bucket) => bucket.label)).toEqual(['Module.Z', 'Module.A'])
    const [first, second] = actual.buckets
    expect(first.children?.map((bucket) => bucket.label)).toEqual(['Types', 'Read values'])
    expect(first.children![0].id).not.toBe(second.children![0].id)
    expect(actual.assignments[first.children![1].id].map((entry) => entry.id)).toEqual(['Module.Z#v:z', 'Module.Z#v:a'])
    expect(actual.assignments[first.id].map((entry) => entry.id)).toEqual(['Module.Z'])
    expect(actual.placement).not.toHaveProperty('Module.Z#v:Value')
    expect(actual.diagnostics).toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
    expect(navSidecar('haskell', structuredClone(model))).toEqual(actual)
    expect(model).toEqual(before)
  })

  it('places a reexport-only module without inventing direct members or groups', () => {
    const model = fixture()
    model.symbols.unshift({ ...symbol('Root', 'module'), apiScope: 'exported',
      references: [{ target: 'Module.Z', kind: 'reference' }, { target: 'Module.A', kind: 'reference' }] })
    const actual = navSidecar('haskell', model)!
    expect(actual.buckets.map((bucket) => bucket.label)).toEqual(['Root', 'Module.Z', 'Module.A'])
    const root = actual.buckets[0]
    expect(root.children).toEqual([])
    expect(actual.assignments[root.id].map((entry) => entry.id)).toEqual(['Root'])
    expect(actual.placement.Root).toBe(root.id)
    expect(actual.diagnostics).toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
    expect(model.exportGroups).toHaveLength(3)
  })

  it('rejects empty modules with no distinct public module relation', () => {
    const relationships: NonNullable<ApiSymbol['references']>[] = [[],
      [{ target: 'Root', kind: 'reference' }], [{ target: 'private.module', kind: 'reference' }]]
    for (const references of relationships) {
      const model = fixture()
      model.symbols.unshift({ ...symbol('Root', 'module'), apiScope: 'exported', references })
      model.symbols.push(symbol('private.module', 'module'))
      expect(() => navSidecar('haskell', model)).toThrow(/module has no groups/)
    }
  })

  it('excludes nonpublic declarations that are absent from the native export groups', () => {
    const model = fixture()
    model.symbols.push(symbol('private', 'function', 'Module.Z'), symbol('private.module', 'module'))
    const actual = navSidecar('haskell', model)!
    expect(actual.placement).not.toHaveProperty('private')
    expect(actual.placement).not.toHaveProperty('private.module')
    expect(actual.diagnostics.unmatched).toEqual([])
  })

  it.each([
    ['missing direct declaration', (model: ApiModel) => model.exportGroups![1].members.pop()],
    ['duplicate declaration', (model: ApiModel) => model.exportGroups![1].members.push('Module.Z#v:z')],
    ['duplicate symbol identity', (model: ApiModel) => { model.symbols.push({ ...model.symbols[2] }) }],
    ['unknown declaration', (model: ApiModel) => model.exportGroups![1].members.push('missing')],
    ['nested constructor', (model: ApiModel) => model.exportGroups![0].members.push('Module.Z#v:Value')],
    ['wrong owner', (model: ApiModel) => { model.exportGroups![0].owner = 'Module.A' }],
    ['nonpublic declaration', (model: ApiModel) => { model.symbols[2].apiScope = 'internal' }],
    ['ungrouped module', (model: ApiModel) => { model.exportGroups!.pop() }],
    ['malformed group', (model: ApiModel) => { Object.assign(model.exportGroups!, { 0: null }) }],
    ['no groups', (model: ApiModel) => { model.exportGroups = [] }],
    ['no metadata', (model: ApiModel) => { delete model.exportGroups }],
  ])('rejects %s before filtering navigation candidates', (_name, mutate) => {
    const model = fixture()
    mutate(model)
    expect(() => navSidecar('haskell', model)).toThrow(/export group/i)
  })
})
