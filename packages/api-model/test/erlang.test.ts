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
    for (const file of fixture.source.files) {
      expect(file.sha256).toBe(createHash('sha256')
        .update(readFileSync(new URL(`./fixtures/erlang-project/${file.path}`, import.meta.url))).digest('hex'))
    }
    expect(symbol('probe:double/1')).toMatchObject({ name: 'double/1', parent: 'probe', kind: 'function' })
    expect(symbol('probe:double/1').signatures.map((signature) =>
      signature.params.map(({ name, type }) => ({ name, type })))).toEqual([
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

  it('links compiler type ranges by native arity and namespace without rewriting text', () => {
    const result = model()
    const index = new SymbolIndex(result.symbols, (symbol) => `/reference/${encodeURIComponent(symbol.id)}`, 'erlang')
    const read = result.symbols.find((symbol) => symbol.id === 'probe:read/1')!
    const handle = result.symbols.find((symbol) => symbol.id === 'probe:handle/0')!
    expect(index.linkType(read.signatures[0]!.params[0]!.type!, read)
      .filter((span) => span.link).map((span) => span.link?.symbol?.id)).toEqual(['t:probe:handle/0'])
    const handleSpans = index.linkType(handle.signatures[0]!.raw!, handle, handle.signatures[0])
    expect(handleSpans.filter((span) => span.link).map((span) => span.link?.symbol?.id)).toEqual(['t:probe:handle/0'])
    const links = result.symbols.find((symbol) => symbol.id === 'probe:links/1')!
    const signature = links.signatures[0]!
    const spans = index.linkType(signature.raw!, links, signature)
    expect(spans.map((span) => span.text).join('')).toBe(signature.raw)
    expect(spans.filter((span) => span.link?.symbol).map((span) => span.link!.symbol!.id)).toEqual([
      't:probe:container/3', 't:probe:box/0', '#probe:row{}',
      't:probe:box/0', "t:probe:'🧭'/0", "t:probe:'a::b'/0", 't:probe:box/1',
    ])
    expect(spans.find((span) => span.link?.href.includes('/kernel/file.html'))?.text).toBe('file:filename_all')
    expect(spans.find((span) => span.link?.symbol?.id === "t:probe:'🧭'/0")?.text).toBe("'🧭'")
    expect(spans.find((span) => span.link?.symbol?.id === '#probe:row{}')?.text).toBe('#probe:row')
    expect(spans.filter((span) => span.link).some((span) => span.text.includes('literal'))).toBe(false)
    expect(spans.filter((span) => span.link).some((span) => span.text.includes('__libtmux_record'))).toBe(false)
    const unresolved = result.symbols.find((symbol) => symbol.id === 't:probe:unresolved/0')!
    expect(index.linkType(unresolved.signatures[0]!.raw!, unresolved)
      .find((span) => span.text === 'file:no_such_type')?.link).toBeUndefined()
  })

  it('retains the workspace application product boundary', () => {
    const workspace = structuredClone(fixture)
    workspace.package.name = 'libtmux_erlang_workspace'
    expect(extractErlang(workspace).symbols.every((symbol) => symbol.product === 'workspace' &&
      symbol.package === 'libtmux_erlang_workspace')).toBe(true)
    expect(model().symbols.every((symbol) => symbol.product === 'core')).toBe(true)
  })

  it('rejects malformed, overlapping, surrogate-splitting and unsafe external reference ranges', () => {
    const changed = (mutate: (input: typeof fixture) => void) => {
      const input = structuredClone(fixture)
      mutate(input)
      return () => extractErlang(input)
    }
    const read = (input: typeof fixture) => input.modules[0].members.find((member: { name: string }) => member.name === 'read')
    expect(changed((input) => { delete read(input).specs[0].parameters[0].references })).toThrow(/references/)
    expect(changed((input) => { read(input).specs[0].references[1].start = 0 })).toThrow(/ranges/)
    expect(changed((input) => { read(input).specs[0].parameters[0].references[0].end = 999 })).toThrow(/ranges/)
    expect(changed((input) => {
      const spec = input.modules[0].members.find((member: { name: string }) => member.name === 'links').specs[0]
      const at = spec.parameters[0].type.indexOf('🧭')
      expect(at).toBeGreaterThan(0)
      spec.parameters[0].references = [{ start: at + 1, end: at + 2, target: "t:probe:'🧭'/0" }]
    })).toThrow(/ranges/)
    expect(changed((input) => {
      read(input).specs[0].parameters[0].references[0].external = { href: 'javascript:alert(1)', project: 'Erlang/OTP' }
    })).toThrow(/destination/)
    expect(changed((input) => {
      input.modules[0].members.find((member: { name: string; kind: string }) => member.name === 'handle' && member.kind === 'type')
        .declaration_references[0] = [{ start: 8, end: 14, target: 't:probe:private/0' }]
    })).toThrow(/opaque/)
  })
})
