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
})

describe('existing port sidecars', () => {
  it.each(Object.keys(NAV))('keeps the generated %s sidecar byte-equivalent', (port) => {
    const model = JSON.parse(readFileSync(new URL(`../../../site/src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const expected = readFileSync(new URL(`../../../site/src/data/api/${port}.nav.json`, import.meta.url), 'utf8')
    expect(`${JSON.stringify(navSidecar(port, model))}\n`).toBe(expected)
  })
})
