import { describe, expect, it } from 'vitest'
import { compareMembers, memberSignals, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { apiEntrySections, apiMemberGroups, relatedApiTypes } from '../src/lib/api-sections'

const symbol = (id: string, overrides: Partial<ApiSymbol> = {}): ApiSymbol => ({
  id, name: id.split('.').at(-1)!, kind: 'class', modifiers: [], signatures: [],
  source: { file: 'example.ts', line: 1 }, ...overrides,
})

describe('reference page navigation', () => {
  it('offers parameter sections only when the port renders those parameters', () => {
    const method = symbol('Server.capture', { signatures: [{ params: [{ name: 'limit', type: 'number' }] }] })
    expect(apiEntrySections(method, 'ts')).toEqual([])
    expect(apiEntrySections(method, 'kotlin')).toEqual([{ id: 'Server.capture.parameters', label: 'Parameters' }])
    method.signatures[0].params[0].doc = 'Maximum lines to capture.'
    expect(apiEntrySections(method, 'ts')).toEqual([{ id: 'Server.capture.parameters', label: 'Parameters' }])
  })

  it('preserves semantic ordering and deprecated listings when grouping members', () => {
    const signals = memberSignals('ts')
    const members = [
      symbol('Server.close', { kind: 'method' }),
      symbol('Server.windows', { kind: 'property' }),
      symbol('Server.sessions', { kind: 'property' }),
      symbol('Server.panes', { kind: 'property' }),
      symbol('Server.listPanes', { kind: 'method', modifiers: ['deprecated'] }),
      symbol('Server.create', { kind: 'method', doc: { summary: 'Create a session.', examples: [{ code: 'create()', lang: 'ts' }] } }),
    ].sort(compareMembers(signals))
    const groups = apiMemberGroups(members, signals)
    expect(groups[0].members.map((member) => member.name)).toEqual(['sessions', 'windows', 'panes'])
    expect(groups.flatMap((group) => group.members)).toEqual(members)
    expect(groups.at(-1)!.members.at(-1)!.name).toBe('listPanes')
  })

  it('uses declared relationships without inventing targets for ambiguous or unknown names', () => {
    const owner = symbol('core.Server', { signatures: [{ params: [], returns: 'Promise<Session | Missing>' }] })
    const session = symbol('core.Session')
    const unrelated = symbol('other.Client')
    const another = symbol('second.Client')
    const member = symbol('core.Server.clients', { signatures: [{ params: [], returns: 'Client[]' }] })
    const index = new SymbolIndex([owner, session, unrelated, another, member], (value) => `/${value.id}/`, 'ts')
    expect(relatedApiTypes(owner, [member], index)).toEqual([session])
    expect(relatedApiTypes(member, [], index, owner)).toEqual([owner])
  })
})
