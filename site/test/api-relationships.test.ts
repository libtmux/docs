import { describe, expect, it } from 'vitest'
import type { ApiModelBase, ApiSymbol } from '@libtmux/api-model'
import { apiRelationshipPath, apiRelationshipSections, apiRelationships } from '../src/lib/api-relationships'

const symbol = (id: string, references: ApiSymbol['references'] = []): ApiSymbol => ({
  id,
  name: id,
  kind: 'function',
  modifiers: [],
  signatures: [],
  source: { file: 'source.c' },
  references,
})
const callback = symbol('callback')
const child = symbol('child', [{ target: 'child', kind: 'call' }])
const caller = symbol('caller', [
  { target: 'child', kind: 'call' },
  { target: 'child', kind: 'reference' },
  { target: 'callback', kind: 'reference' },
  { target: 'external', kind: 'call' },
])
const model: ApiModelBase = { extractor: 'fixture', symbols: [caller, child, callback] }

describe('shared function relationships', () => {
  it('distinguishes calls, recursion and callback references in both directions', () => {
    const groups = apiRelationshipSections(model, caller)
    expect(groups.find((group) => group.label === 'Calls')?.items.map((item) => item.id)).toEqual(['child'])
    expect(groups.find((group) => group.label === 'Other function references')?.items.map((item) => item.id)).toEqual([
      'callback',
    ])
    expect(
      apiRelationshipSections(model, child)
        .find((group) => group.label === 'Called by')
        ?.items.map((item) => item.id),
    ).toEqual(['caller', 'child'])
    expect(apiRelationshipSections(model, callback).map((group) => group.label)).toEqual(['Referenced by'])
    expect(apiRelationships(model, caller).outgoing.some((edge) => edge.to.id === 'external')).toBe(false)
  })
  it('requires every path edge and keeps different versions separate', () => {
    expect(apiRelationshipPath(model, 'Call', ['caller', 'child'])?.edges).toEqual(['call'])
    expect(apiRelationshipPath(model, 'Callback', ['caller', 'callback'])?.edges).toEqual(['reference'])
    expect(apiRelationshipPath(model, 'Invented', ['caller', 'child', 'callback'])).toBeUndefined()
    const older: ApiModelBase = { ...model, symbols: [symbol('caller'), child, callback] }
    expect(apiRelationshipPath(older, 'Absent in older source', ['caller', 'child'])).toBeUndefined()
    expect(apiRelationships(older, child).incoming.map((edge) => edge.from.id)).toEqual(['child'])
  })
})
