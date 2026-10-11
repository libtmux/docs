import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractJulia } from '../src/languages/julia.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/julia-native.json', import.meta.url), 'utf8'))
const model = extractJulia(fixture, fixture.source.revision)
const binding = (id: string) => model.symbols.find((symbol) => symbol.id === id)!

describe('Julia native API adapter', () => {
  it('extracts native argument bullets without consuming examples or unrelated prose', () => {
    const input = structuredClone(fixture)
    const method = input.symbols.find((entry) => entry.id === 'LibTmux.from_env').methods[0]
    method.documentation[0].markdown = [
      '```julia', 'from_env(; env=ENV)', '```', '',
      'Describe the selected endpoint.', '', '# Arguments', '',
      '- `env=ENV`: Read `TMUX` from this mapping.',
      '  Use [`Server`](@ref) for explicit selection.', '',
      '  A second paragraph stays with the parameter.', '',
      '- `unknown`: Keep documentation that has no matching native parameter.', '',
      '# Examples', '', '```julia', '# Arguments', '- `env`: not an argument description', '```',
    ].join('\n')
    const actual = extractJulia(input).symbols.find((entry) => entry.id === 'LibTmux.from_env')!
    const parameter = actual.signatures[0]!.params.find((entry) => entry.name === 'env')!
    expect(parameter).toMatchObject({ default: 'ENV', keywordOnly: true })
    expect(parameter.doc).toContain('Read `TMUX` from this mapping.')
    expect(parameter.doc).toContain('[`Server`](@ref)')
    expect(parameter.doc).toContain('\n\nA second paragraph')
    expect(parameter.doc).not.toContain('not an argument description')
    const doc = actual.signatures[0]!.doc!
    expect(doc.summary).toBe('Describe the selected endpoint.')
    expect(doc.body).toContain('Keep documentation that has no matching native parameter.')
    expect(doc.body).toContain('- `env`: not an argument description')
    expect(doc.body).not.toContain('Read `TMUX` from this mapping.')
    expect(actual.source).toEqual(actual.signatures[0]!.source)
  })

  it('keeps keyword argument descriptions attached to their own dispatch methods', () => {
    const input = structuredClone(fixture)
    const entry = input.symbols.find((entry) => entry.id === 'LibTmux.kill_session')
    for (const [i, method] of entry.methods.entries()) {
      const parameter = method.parameters.find((parameter) => parameter.name)
      method.documentation = [{ signature: 'native', source: method.source, fields: {},
        markdown: `Remove the session.\n\n# Keyword arguments\n\n- \`${parameter.name}::Any\`: Description for method ${i}.` }]
    }
    const actual = extractJulia(input).symbols.find((symbol) => symbol.id === entry.id)!
    actual.signatures.forEach((method, i) => {
      expect(method.params.find((parameter) => parameter.doc)?.doc).toBe(`Description for method ${i}.`)
      expect(method.doc?.body ?? '').not.toContain('Keyword arguments')
    })
  })

  it('preserves every selected native method and its exact identity and source', () => {
    const expected = [...fixture.symbols, ...fixture.extensionMethods].flatMap((symbol) => symbol.methods)
    const actual = model.symbols.flatMap((symbol) => symbol.signatures)
    expect(actual).toHaveLength(expected.length)
    expect(actual.map((signature) => signature.identity).sort()).toEqual(expected.map((method) => method.identity).sort())
    for (const method of expected) {
      expect(actual.find((signature) => signature.identity === method.identity)?.source).toMatchObject(method.source)
    }
    expect(model.sources?.map((source) => source.product)).toEqual(['core', 'mcp', 'workspace'])
  })

  it('keeps method-specific docs, optional extensions and keyword defaults', () => {
    const kill = binding('LibTmux.kill_session')
    const control = kill.signatures.find((signature) => signature.raw?.includes('ControlConnection'))!
    expect(JSON.stringify(control.doc)).toContain('pinned daemon')
    expect(control.source?.file).toBe('src/control_topology.jl')
    expect(control.params.find((parameter) => parameter.name === 'kwargs')?.variadic).toBe('keyword')
    expect(binding('LibTmux.read_where_json').signatures[0]?.extension).toBe('LibTmuxJSONExt')
    expect(binding('LibTmux.Filters.Contains').signatures[0]?.params.find((parameter) => parameter.name === 'case')).toMatchObject({ default: ':sensitive', keywordOnly: true, type: 'Symbol' })
  })

  it('retains callable instances, parameterized constructors, aliases and fields', () => {
    expect(binding('LibTmux.Criterion').signatures[0]).toMatchObject({ methodKind: 'call', receiver: { name: 'q', type: 'LibTmux.Criterion' } })
    expect(binding('LibTmux.RowProjection').signatures[0]?.raw).toContain('RowProjection{R, S}')
    expect(binding('LibTmux.RowProjection').typeParams).toEqual(['R<:NamedTuple', 'S<:LibTmux.Selection'])
    expect(binding('LibTmux.SessionID')).toMatchObject({ kind: 'typealias', type: 'TmuxID{:session}', typeParams: [':session'], source: { file: 'src/model.jl', line: 41 } })
    expect(binding('LibTmux.TmuxID').apiScope).toBe('supporting')
    expect(binding('LibTmux.Server.socket_path')).toMatchObject({ kind: 'property', parent: 'LibTmux.Server', modifiers: ['readonly'] })
    expect(binding('LibTmux.Server.socket_path').source.line).toBeUndefined()
    expect(binding('LibTmux.Base.IndexStyle').signatures).toHaveLength(3)
    expect(binding('LibTmux.Base.IteratorSize').signatures).toHaveLength(1)
  })

  it('scopes external methods to the package that implements them', () => {
    expect(binding('LibTmux.Base.close')).toMatchObject({ qualifiedName: 'Base.close', product: 'core' })
    const mcp = binding('LibTmuxMCP.Application')
    expect(mcp.product).toBe('mcp')
    expect(binding('LibTmuxWorkspace.parse_config').product).toBe('workspace')
    expect(model.symbols.every((symbol) => !symbol.id.includes('.#'))).toBe(true)
  })

  it('rejects omitted bindings, duplicate dispatch identities and incomplete aliases', () => {
    expect(() => extractJulia(fixture, '0'.repeat(40))).toThrow(/source revision/)
    const missing = structuredClone(fixture)
    missing.symbols.pop()
    expect(() => extractJulia(missing)).toThrow(/inventory differs/)
    const duplicate = structuredClone(fixture)
    const method = duplicate.symbols.find((symbol) => symbol.methods.length)
    method.methods.push(method.methods[0])
    expect(() => extractJulia(duplicate)).toThrow(/repeats a method/)
    const alias = structuredClone(fixture)
    alias.symbols.find((symbol) => symbol.id === 'LibTmux.SessionID').definition = null
    expect(() => extractJulia(alias)).toThrow(/alias lost its definition/)
    const extension = structuredClone(fixture)
    extension.extensions = []
    expect(() => extractJulia(extension)).toThrow(/unloaded extension/)
  })
})
