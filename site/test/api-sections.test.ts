import { describe, expect, it } from 'vitest'
import { compareMembers, memberSignals, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { apiEntryFields, apiEntrySections, apiMemberGroups, relatedApiTypes } from '../src/lib/api-sections'
import { API_MODELS } from '../src/lib/api-models'

const symbol = (id: string, overrides: Partial<ApiSymbol> = {}): ApiSymbol => ({
  id, name: id.split('.').at(-1)!, kind: 'class', modifiers: [], signatures: [],
  source: { file: 'example.ts', line: 1 }, ...overrides,
})

describe('reference page navigation', () => {
  it('preserves distinct overload fields and identifies which calls they describe', () => {
    const method = symbol('Server.session', { kind: 'method', signatures: [
      { params: [{ name: 'value', type: 'Expr', doc: 'Match exactly one session.' }],
        returnsDoc: 'The matching session.', raises: [{ type: 'CardinalityError', doc: 'Zero or multiple matches.' }] },
      { params: [{ name: 'value', type: 'string', doc: 'Look up a session name.' }],
        returnsDoc: 'The named session or null.' },
      { params: [{ name: 'id', type: 'SessionId' }] },
    ] })
    const fields = apiEntryFields(method, 'kotlin')
    expect(fields.params.map((param) => [param.name, param.type, param.doc])).toEqual([
      ['value', 'Expr', 'Match exactly one session.'], ['value', 'string', 'Look up a session name.'],
      ['id', 'SessionId', undefined],
    ])
    expect(fields.returns).toEqual([
      { doc: 'The matching session.', overloads: ['session(value) [overload 1]'] },
      { doc: 'The named session or null.', overloads: ['session(value) [overload 2]'] },
    ])
    expect(fields.raises).toEqual([
      { type: 'CardinalityError', doc: 'Zero or multiple matches.', overloads: ['session(value) [overload 1]'] },
    ])
    expect(apiEntrySections(method, 'kotlin').map((section) => section.label)).toEqual(['Parameters', 'Returns', 'Errors'])
  })

  it('treats the Python implementation docstring as documentation for every overload', () => {
    const capture = API_MODELS.py.symbols.find((entry) => entry.id === 'libtmux.pane.Pane.capture_pane')!
    const fields = apiEntryFields(capture, 'py')
    expect(fields.params).toHaveLength(15)
    expect(fields.params.every((param) => param.overloads.length === 0)).toBe(true)
    expect(fields.returns[0].doc).toContain('Captured pane content')
    expect(fields.returns[0].overloads).toEqual([])
  })

  it('distinguishes Swift overloads without duplicating its name parentheses', () => {
    const next = API_MODELS.swift.symbols.find((entry) => entry.id === 'ControlNotificationStream.Iterator.next()')!
    const fields = apiEntryFields(next, 'swift')
    expect(fields.raises.map((entry) => entry.overloads)).toEqual([
      ['next() [overload 1]'], ['next() [overload 2]'],
    ])
  })

  it('renders a shared field once without an unnecessary overload qualifier', () => {
    const common = { params: [{ name: 'value', type: 'string', doc: 'The name.' }],
      returnsDoc: 'The matching session.', raises: [{ type: 'TransportError', doc: 'The server is unavailable.' }] }
    const method = symbol('Server.session', { signatures: [common, { ...common, returns: 'Session?' }] })
    const fields = apiEntryFields(method, 'kotlin')
    expect(fields.params).toHaveLength(1)
    expect(fields.returns).toEqual([{ doc: 'The matching session.', overloads: [] }])
    expect(fields.raises).toEqual([{ type: 'TransportError', doc: 'The server is unavailable.', overloads: [] }])
  })

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

  it.each(['py', 'ts', 'java', 'kotlin', 'scala', 'csharp'])('groups %s parent objects before its other members', (port) => {
    const signals = memberSignals(port)
    const owner = API_MODELS[port].symbols.find((entry) => entry.name === 'Pane' && entry.kind === 'class')!
    const members = API_MODELS[port].symbols.filter((entry) => entry.parent === owner.id).sort(compareMembers(signals))
    const groups = apiMemberGroups(members, signals)
    expect(groups[0].id).toBe('api-parent-objects')
    expect(groups[0].label).toBe('Parent objects')
    expect(groups[0].members.map((member) => member.name.toLowerCase())).toEqual(
      ['py', 'ts', 'csharp'].includes(port) ? ['window', 'session', 'server'] : ['window', 'server'],
    )
    expect(groups.flatMap((group) => group.members)).toEqual(members)
  })
})
