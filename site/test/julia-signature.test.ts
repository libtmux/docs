import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { apiMethodDetails, nativeSignatureText } from '../src/lib/api-sections'
import { productApiIndex } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = API_MODELS.julia
const index = productApiIndex(model, 'latest')
const application = model.symbols.find((symbol) => symbol.id === 'LibTmuxMCP.Application')!
const format = (raw: string) => nativeSignatureText(application, { raw, params: [] }, 'julia')
const adjointDefaults = [
  "tuple(matrix',')',',')",
  "tuple(matrix',')',';')",
  "tuple(matrix', ')', ',')",
  "tuple(matrix[1]',')',',')",
  "tuple((matrix)',')',',')",
  "tuple(matrix'',')',',')",
  "tuple(α₁',')',',')",
  "tuple(1',')',',')",
  "tuple('a'',')',',')",
  "tuple(begin return')' end, ',')",
]

describe('Julia declaration layout', () => {
  it('distinguishes adjacent postfix adjoints from character literals in nested defaults', () => {
    for (const value of adjointDefaults) {
      const raw = `configure(value = ${value}, very_long_argument_name_to_force_multiline = nothing)`
      expect(format(raw)).toBe(
        `configure(\n    value = ${value},\n    very_long_argument_name_to_force_multiline = nothing\n)`,
      )
    }
  })

  it('puts every Application overload parameter on an indented line, retaining keyword boundaries', () => {
    expect(application.signatures).toHaveLength(3)
    for (const signature of application.signatures) {
      const lines = nativeSignatureText(application, signature, 'julia').split('\n')
      expect(lines[0]).toBe('LibTmuxMCP.Application(')
      expect(lines.at(-1)).toBe(')')
      expect(lines.slice(1, -1)).toHaveLength(signature.params.length)
      expect(lines.slice(1, -1).every((line) => /^ {4}\S/.test(line))).toBe(true)
    }
    const keyword = nativeSignatureText(application, application.signatures[1], 'julia')
    expect(keyword).toContain('    server::LibTmux.Server;\n    caller,')
    const typed = nativeSignatureText(application, application.signatures[0], 'julia')
    expect(typed).toContain('    caller::Union{Nothing, LibTmux.PaneRef},\n')
    expect(typed).toContain('    _owned::Dict{LibTmux.SessionRef, Vector{LibTmux.PaneRef}},\n')
  })

  it('preserves nested calls, type parameters, literals, adjoints and where clauses', () => {
    const raw =
      'configure(connection::LibTmux.ControlConnection; value::Tuple{T, String} = (map(identity, [1, 2]), "a, b"), transpose = matrix\', marker = \',\', message = "$(join(["a", "b"], ","))", command = `printf "a,b"`, rest...) where {T<:Real}'
    expect(format(raw)).toBe(
      [
        'configure(',
        '    connection::LibTmux.ControlConnection;',
        '    value::Tuple{T, String} = (map(identity, [1, 2]), "a, b"),',
        "    transpose = matrix',",
        "    marker = ',',",
        '    message = "$(join(["a", "b"], ","))",',
        '    command = `printf "a,b"`,',
        '    rest...',
        ') where {T<:Real}',
      ].join('\n'),
    )
    const keywordOnly =
      'configure(; path = "C:\\tmp\\\\", pattern = raw"a,b", label = "first, \\"second\\"", long_argument_name = nothing)'
    expect(format(keywordOnly)).toBe(
      [
        'configure(;',
        '    path = "C:\\tmp\\\\",',
        '    pattern = raw"a,b",',
        '    label = "first, \\"second\\"",',
        '    long_argument_name = nothing',
        ')',
      ].join('\n'),
    )
    const multilineLiteral =
      'configure(connection::LibTmux.ControlConnection; message = """first,\n  second; (third)""", nested = Dict(:a => (1, 2)))'
    expect(format(multilineLiteral)).toContain(
      '    message = """first,\n  second; (third)""",\n    nested = Dict(:a => (1, 2))\n)',
    )
    const nonInterpolated =
      'configure(connection::LibTmux.ControlConnection; pattern = raw"$(literal, (text", long_argument_name = nothing)'
    expect(format(nonInterpolated)).toContain(
      '    pattern = raw"$(literal, (text",\n    long_argument_name = nothing\n)',
    )
  })

  it('formats callable constructors after their receiver and leaves short signatures untouched', () => {
    const owner = model.symbols.find((symbol) => symbol.id === 'LibTmux.ControlSignal')!
    const signature = owner.signatures.find((entry) => entry.raw?.startsWith('(var'))!
    const formatted = nativeSignatureText(owner, signature, 'julia')
    expect(formatted.split('\n')[0]).toBe('(var"#ctor-self#"::Type{LibTmux.ControlSignal{C}} where C)(')
    expect(formatted).toContain('\n    connection,\n    name,\n')
    expect(format('from_env(; env, socket_path, socket_name, tmux)')).toBe(
      'from_env(; env, socket_path, socket_name, tmux)',
    )
  })

  it('retains all native signature tokens, links and method identities across the Julia inventory', () => {
    let formattedCount = 0
    for (const symbol of model.symbols) {
      const methods = apiMethodDetails(symbol)
      for (const signature of symbol.signatures) {
        if (!signature.raw) continue
        const formatted = nativeSignatureText(symbol, signature, 'julia')
        expect(formatted.replace(/\s/g, ''), symbol.id).toBe(signature.raw.replace(/\s/g, ''))
        expect(nativeSignatureText(symbol, { ...signature, raw: formatted }, 'julia'), symbol.id).toBe(formatted)
        const linked = (text: string) =>
          index
            .linkType(text, symbol, signature)
            .filter((span) => span.link)
            .map((span) => ({ text: span.text, href: span.link!.href }))
        expect(linked(formatted), symbol.id).toEqual(linked(signature.raw))
        if (formatted !== signature.raw) formattedCount++
      }
      expect(apiMethodDetails(symbol)).toEqual(methods)
    }
    expect(formattedCount).toBeGreaterThan(100)
  })

  it('exports the same declaration blocks for the header and every long method', () => {
    const markdown = symbolMarkdown({ model, symbol: application, index })
    const blocks = fromMarkdown(markdown)
      .children.filter((node) => node.type === 'code')
      .map((node) => node.value)
    const formatted = application.signatures.map((signature) => nativeSignatureText(application, signature, 'julia'))
    expect(blocks).toContain(formatted.join('\n\n'))
    for (const declaration of formatted) expect(blocks).toContain(declaration)
    expect(markdown).toContain('### `Application` (overload 1)')
    expect(markdown).not.toContain('### `LibTmuxMCP.Application(server')
    for (const language of ['csharp', 'fsharp', 'scala', 'kotlin', 'c']) {
      expect(nativeSignatureText(application, application.signatures[0], language)).toBe(application.signatures[0].raw)
    }
  })
})
