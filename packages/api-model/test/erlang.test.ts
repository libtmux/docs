import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { extractErlang } from '../src/languages/erlang.ts'
import { SymbolIndex } from '../src/link.ts'
import { tokenizeDoc } from '../src/doc/roles.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/erlang-native.json', import.meta.url), 'utf8'))
const model = () => extractErlang(fixture, fixture.source.revision)

describe('Erlang compiler artifact adapter', () => {
  it('retains source identity, native arities and compiler declarations', () => {
    const result = model()
    const symbol = (id: string) => result.symbols.find((entry) => entry.id === id)!
    expect(result).toMatchObject({ port: 'erlang', revision: fixture.source.revision, repo: 'libtmux/probe' })
    expect(result.nativeProvenance?.files).toEqual(fixture.source.files)
    expect(fixture.exporter.source_sha256).toBe(createHash('sha256')
      .update(readFileSync(new URL('../scripts/export-erlang.escript', import.meta.url))).digest('hex'))
    expect(symbol('probe:double/1')).toMatchObject({ name: 'double/1', parent: 'probe', kind: 'function' })
    expect(symbol('probe:double/1').signatures.map((signature) => signature.params)).toEqual([
      [{ name: 'Number', type: 'integer()' }], [{ name: 'Number', type: 'float()' }],
    ])
    expect(symbol('probe:double/1').modifiers).toContain('overload')
    expect(symbol('t:probe:handle/0').signatures[0]?.raw).toBe('-opaque handle().')
    expect(symbol('t:probe:handle/0').type).toBeUndefined()
    expect(symbol('t:probe:internal_mode/0').apiScope).toBe('supporting')
    expect(symbol('t:probe:id/0').signatures[0]?.raw).toContain('-nominal id()')
    expect(symbol('t:probe:included_id/0').source?.file).toBe('include/public_types.hrl')
    expect(symbol("t:probe:'λ-handle'/1").name).toBe("'λ-handle'/1")
    expect(symbol("t:probe:'a::b'/0").signatures[0]?.raw).toBe("-opaque 'a::b'().")
    expect(symbol('#probe:row{}')).toMatchObject({ kind: 'struct', parent: 'probe' })
    expect(symbol('c:probe:prepare/1').signatures[0]?.raw).toContain('-callback prepare(')
    expect(symbol('probe').doc?.examples?.[0]?.code).toContain('1> probe:double(2).')
  })

  it('resolves native module, function, type and callback references in their module', () => {
    const result = model()
    const index = new SymbolIndex(result.symbols, (symbol) => `/reference/${encodeURIComponent(symbol.id)}`, 'erlang')
    const context = result.symbols.find((symbol) => symbol.id === 'probe:read/1')!
    const refs = tokenizeDoc('`m:probe` `read/1` `t:handle/0` `c:prepare/1`', 'erlang')
    expect(refs.filter((span) => span.kind === 'ref').map((span) => span.label)).toEqual(['probe', 'read/1', 'handle/0', 'prepare/1'])
    for (const [target, id] of [['m:probe', 'probe'], ['read/1', 'probe:read/1'], ['t:handle/0', 't:probe:handle/0'], ['c:prepare/1', 'c:probe:prepare/1']]) {
      expect(index.resolve(target!, 'any', context)?.symbol?.id).toBe(id)
    }
    expect(index.resolve('handle/0', 'any', context)?.symbol?.id).toBe('probe:handle/0')
    expect(tokenizeDoc('[the module](`m:probe`)', 'erlang')).toEqual([
      { kind: 'ref', role: 'any', target: 'm:probe', label: 'the module' },
    ])
    expect(index.resolve('missing:read/1', 'any', context)).toBeUndefined()
    expect(index.resolve('t:read/1', 'any', context)).toBeUndefined()
    expect(index.resolve('probe:read/1', 'class', context)).toBeUndefined()
  })

  it('rejects unsupported, mismatched, duplicate or source-less artifacts', () => {
    expect(() => extractErlang(fixture, '0'.repeat(40))).toThrow(/revision/)
    expect(() => extractErlang({ ...fixture, schema: 2 })).toThrow(/schema/)
    const duplicate = structuredClone(fixture)
    duplicate.modules[0].members.push(duplicate.modules[0].members[0])
    expect(() => extractErlang(duplicate)).toThrow(/repeats/)
    const missing = structuredClone(fixture)
    missing.modules[0].members[0].source.file = '../outside.erl'
    expect(() => extractErlang(missing)).toThrow(/source/)
    const opaque = structuredClone(fixture)
    opaque.modules[0].members.find((member: { visibility: string }) => member.visibility === 'opaque').declarations[0] += ' :: private_body'
    expect(() => extractErlang(opaque)).toThrow(/opaque type body/)
    const head = structuredClone(fixture)
    head.modules[0].members.find((member: { kind: string }) => member.kind === 'function').signatures = []
    expect(() => extractErlang(head)).toThrow(/signature/)
    const parameter = structuredClone(fixture)
    delete parameter.modules[0].members.find((member: { kind: string; arity: number }) => member.kind === 'function' && member.arity > 0).specs[0].parameters[0].type
    expect(() => extractErlang(parameter)).toThrow(/signature/)
  })
})
