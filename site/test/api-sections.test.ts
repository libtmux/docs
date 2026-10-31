import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareMembers, extractPowerShell, memberSignals, SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { apiCommandFacts, apiEntryFields, apiEntrySections, apiMemberGroups, apiMethodDetails, apiOverloadId, parameterBindingFacts, parameterBindingText, relatedApiTypes } from '../src/lib/api-sections'
import { API_MODELS } from '../src/lib/api-models'

const symbol = (id: string, overrides: Partial<ApiSymbol> = {}): ApiSymbol => ({
  id, name: id.split('.').at(-1)!, kind: 'class', modifiers: [], signatures: [],
  source: { file: 'example.ts', line: 1 }, ...overrides,
})

describe('reference page navigation', () => {
  it('keeps overload fragments stable through insertion, reordering, and signature formatting', () => {
    const owner = symbol('Server.open')
    const first = { params: [{ name: 'name', type: 'string' }], returns: 'Server', raw: 'open(name: string): Server' }
    const other = { params: [{ name: 'number', type: 'number' }], returns: 'Server' }
    const key = apiOverloadId(owner, first)
    expect([other, first].map((signature) => apiOverloadId(owner, signature))[1]).toBe(key)
    expect(apiOverloadId(owner, { ...first, raw: 'open(\n name: string\n): Server' })).toBe(key)
    expect(apiOverloadId(owner, other)).not.toBe(key)
  })
  it('retains native qualifiers, companion declarations, keyword names, and literal spaces', () => {
    for (const [port, id] of [['cxx', 'libtmux::AttachCommand::AttachCommand'], ['fsharp', 'LibTmux.FSharp.Filter'], ['scala', 'io.github.libtmux.scaladsl.Client'], ['ruby', 'LibTmux::Workspace::ApplyResult::Effect.new']]) {
      const owner = API_MODELS[port].symbols.find((symbol) => symbol.id === id)!
      expect(new Set(owner.signatures.map((signature) => apiOverloadId(owner, signature))).size, id).toBe(owner.signatures.length)
    }
    const owner = symbol('read')
    const first = { params: [], raw: 'read("a b")' }
    expect(apiOverloadId(owner, first)).toBe(apiOverloadId(owner, { ...first, raw: 'read (\n "a b"\n )' }))
    expect(apiOverloadId(owner, first)).not.toBe(apiOverloadId(owner, { ...first, raw: 'read("ab")' }))
    expect(apiOverloadId(owner, { params: [{ name: 'target', keywordOnly: true }] })).not.toBe(apiOverloadId(owner, { params: [{ name: 'source', keywordOnly: true }] }))
    const native = { params: [{ name: 'const Command &' }], raw: 'Command(const Command &)' }
    expect(apiOverloadId(owner, native)).toBe(apiOverloadId(owner, { ...native, params: [{ name: 'arg1', type: 'const Command &' }] }))
  })
  it('connects Julia overload qualifiers to their distinct methods', () => {
    for (const id of ['LibTmux.SessionID', 'LibTmux.HookCommand']) {
      const owner = API_MODELS.julia.symbols.find((symbol) => symbol.id === id)!
      const fields = apiEntryFields(owner, 'julia')
      const methods = apiMethodDetails(owner)
      expect(new Set(methods.map((method) => method.id)).size).toBe(methods.length)
      for (const parameter of fields.params) {
        for (const label of parameter.overloads) {
          const target = methods.find((method) => method.overloadLabel === label)
          expect(target?.signature.params.some((param) => param.name === parameter.name && param.type === parameter.type), label).toBe(true)
        }
      }
    }
  })
  it('renders native commands without a default parameter set', () => {
    const model = extractPowerShell(JSON.parse(readFileSync(new URL('../../packages/api-model/test/fixtures/powershell-native.json', import.meta.url), 'utf8')))
    const index = new SymbolIndex(model.symbols, (entry) => `#${entry.id}`, 'powershell')
    const control = model.symbols.find((entry) => entry.name === 'Connect-TmuxControl')!
    const facts = apiCommandFacts(control)
    expect(() => facts.map((fact) => index.linkText(fact.value, control))).not.toThrow()
    expect(facts.some((fact) => fact.label === 'Default parameter set')).toBe(false)
  })

  it('keeps native parameter sets and binding details in the rendered section order', () => {
    const model = extractPowerShell(JSON.parse(readFileSync(new URL('../../packages/api-model/test/fixtures/powershell-native.json', import.meta.url), 'utf8')))
    const pane = model.symbols.find((entry) => entry.name === 'Get-TmuxPane')!
    const fields = apiEntryFields(pane, 'powershell')
    const server = fields.params.find((entry) => entry.name === 'Server')!
    expect(server.overloads).toEqual(['Server'])
    expect(parameterBindingText(server)).toContain('Required. Position 0. Accepts pipeline input by value.')
    expect(parameterBindingFacts(server)).toEqual(expect.arrayContaining([
      { label: 'Required', value: 'Yes' },
      { label: 'Position', value: '0' },
      { label: 'Pipeline input', value: 'By value' },
    ]))
    const id = fields.params.find((entry) => entry.name === 'Id')!
    expect(parameterBindingText(id)).toContain('ValidateNotNullOrEmpty()')
    expect(parameterBindingFacts(id)).toContainEqual({ label: 'Validation', value: '[`ValidateNotNullOrEmpty()`](https://learn.microsoft.com/dotnet/api/system.management.automation.validatenotnulloremptyattribute?view=powershellsdk-7.4.0)' })
    expect(apiEntrySections(pane, 'powershell').map((entry) => entry.label)).toEqual([
      'Description', 'Command details', 'Examples', 'Parameters', 'Returns',
    ])
    const control = model.symbols.find((entry) => entry.name === 'Connect-TmuxControl')!
    expect(apiCommandFacts(control).find((entry) => entry.label === 'Confirmation')?.value).toContain('`-WhatIf` and `-Confirm`')
    expect(apiCommandFacts(pane).find((entry) => entry.label === 'Outputs')?.value).toBe('`LibTmux.Pane`')
  })

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

  it('lists a method receiver nowhere, and every other parameter', () => {
    const method = symbol('Pane.resize', { kind: 'method', signatures: [{ params: [{ name: 'self' }, { name: 'width', type: 'int' }] }] })
    expect(apiEntryFields(method, 'py').params.map((param) => param.name)).toEqual(['width'])
    expect(apiEntryFields(method, 'lua').params.map((param) => param.name)).toEqual(['width'])
  })

  it.each(['self', 'mut self', '&self', '&mut self', "&'a self", "&'a mut self"])(
    'lists a Rust `%s` receiver nowhere, and keeps the parameters after it', (receiver) => {
      const bare = symbol('Pane.kill', { kind: 'method', signatures: [{ params: [{ name: receiver }] }] })
      expect(apiEntryFields(bare, 'rs').params).toEqual([])
      expect(apiEntrySections(bare, 'rs').map((section) => section.label)).not.toContain('Parameters')
      const method = symbol('Pane.resize', { kind: 'method', signatures: [{ params: [{ name: receiver }, { name: 'width', type: 'u16' }] }] })
      expect(apiEntryFields(method, 'rs').params.map((param) => param.name)).toEqual(['width'])
      expect(apiEntrySections(method, 'rs').map((section) => section.label)).toContain('Parameters')
    })

  it.each(['myself', 'self_', 'selfish', 'mut selfish'])('keeps the Rust parameter `%s`, whose name only resembles a receiver', (name) => {
    const method = symbol('Pane.send', { kind: 'method', signatures: [{ params: [{ name, type: 'u8' }] }] })
    expect(apiEntryFields(method, 'rs').params.map((param) => param.name)).toEqual([name])
  })

  it('keeps a Rust receiver that the page documents', () => {
    const method = symbol('Pane.send', { kind: 'method', signatures: [{ params: [{ name: '&self', doc: 'The pane.' }] }] })
    expect(apiEntryFields(method, 'rs').params.map((param) => param.name)).toEqual(['&self'])
  })

  it('lists a C function\'s leading self, which the caller passes', () => {
    const exec = symbol('cmd_show_messages_exec', { kind: 'function', signatures: [{ params: [{ name: 'self', type: 'struct cmd *' }, { name: 'item', type: 'struct cmdq_item *' }] }] })
    expect(apiEntryFields(exec, 'c').params.map((param) => param.name)).toEqual(['self', 'item'])
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

  it('offers a parameter section in every port, documented or not', () => {
    const method = symbol('Server.capture', { signatures: [{ params: [{ name: 'limit', type: 'number' }] }] })
    for (const port of ['py', 'ruby', 'lua', 'swift']) {
      expect(apiEntrySections(method, port), port).toEqual([{ id: 'Server.capture.parameters', label: 'Parameters' }])
    }
    expect(apiEntrySections(method, 'ts')).toEqual([{ id: 'Server.capture.parameters', label: 'Parameters' }])
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
