import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { productApiIndex } from '../src/lib/product-api'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

interface Pair { input: string; formatted: string }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/julia-formatter-margin-60.json', import.meta.url), 'utf8')) as {
  formatter: { version: string; options: { margin: number; indent: number } }
  shapes: (Pair & { name: string })[]
  corpus: Pair[]
}
const model = API_MODELS.julia
const index = productApiIndex(model, 'latest')
const names = (raw: string) => [...raw.matchAll(/(?:^|[(,;]\s*)([\p{L}_][\p{L}\p{N}_!]*)(?=::|\.\.\.|[,;)])/gu)].map((match) => match[1]!)

function callable(raw: string): ApiSymbol {
  const callee = /^([^({\s]+)/.exec(raw)?.[1] ?? 'callable'
  return {
    id: `Probe.${callee}`, name: callee.split('.').pop()!, kind: 'function', modifiers: [],
    signatures: [{ raw, params: names(raw).map((name) => ({ name })) }], source: { file: 'probe.jl' },
  }
}

async function layoutOf(raw: string) {
  const symbol = callable(raw)
  const layout = (await apiSignatureLayouts(symbol, 'julia')).get(symbol.signatures[0]!)
  expect(layout).toBeDefined()
  return { symbol, layout: layout! }
}

const lines = (text: string) => text.split('\n')
/** Whitespace and list-closing commas are the only text a layout may add or remove. */
const tokens = (text: string) => text.replace(/\s/g, '').replace(/,(?=[)\]}])/g, '')

describe('Julia callable layouts', () => {
  it('records the formatter and options the fixtures were generated with', () => {
    expect(fixture.formatter).toMatchObject({ package: 'JuliaFormatter.jl', version: '2.14.0', options: { margin: CODE_COLUMNS.api, indent: 4 } })
  })

  it.each(fixture.shapes.map((shape) => [shape.name, shape] as const))('matches JuliaFormatter for %s', async (_name, shape) => {
    const { layout } = await layoutOf(shape.input)
    expect(layout.text).toBe(shape.formatted)
    expect(layout.limit).toBe(CODE_COLUMNS.api)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it('matches JuliaFormatter for every wrapped signature in the inventory', async () => {
    const divergent: string[] = []
    for (const { input, formatted } of fixture.corpus) {
      const { layout } = await layoutOf(input)
      if (layout.text !== formatted) divergent.push(input)
    }
    // The formatter leaves this header 62 columns wide; the documentation cap does not allow that.
    expect(divergent).toEqual(['(var"#ctor-self#"::Type{LibTmux.ControlSignal{C}} where {C})(connection, name, state, notified, request, cleanup_queued, cleanup_done, error)'])
    const pair = fixture.corpus.find((entry) => entry.input === divergent[0])!
    expect(lines(pair.formatted).some((line) => line.length > CODE_COLUMNS.api)).toBe(true)
    const { layout } = await layoutOf(divergent[0]!)
    expect(layout.failures).toEqual([])
    expect(layout.text.startsWith('(\n    var"#ctor-self#"::Type{\n        LibTmux.ControlSignal{C},\n    } where {C}\n)(\n    connection,\n')).toBe(true)
  })

  it('wraps every inventory signature within the API budget and keeps its tokens', async () => {
    let wrapped = 0
    let total = 0
    for (const symbol of model.symbols) {
      const layouts = await apiSignatureLayouts(symbol, 'julia')
      expect(layouts.size, symbol.id).toBe(symbol.signatures.length)
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        total++
        expect(layout.limit).toBe(CODE_COLUMNS.api)
        expect(layout.failures, signature.raw).toEqual([])
        expect(await codeWidthFailures(layout.text, 'api'), signature.raw).toEqual([])
        expect(tokens(layout.text), symbol.id).toBe(tokens(signature.raw!))
        // A signature that fits stays on one line, exactly as extracted.
        expect(layout.text.includes('\n'), signature.raw).toBe(signature.raw!.length > CODE_COLUMNS.api)
        if (layout.text.includes('\n')) wrapped++
        else expect(layout.text).toBe(signature.raw)
        const again = await apiSignatureLayouts({ ...symbol, signatures: [{ ...signature, raw: layout.text }] }, 'julia')
        expect([...again.values()][0]!.text, symbol.id).toBe(layout.text)
      }
    }
    expect(wrapped).toBeGreaterThan(200)
    expect(total).toBeGreaterThan(wrapped)
  })

  it('fails the width check for the unwrapped inventory, so the budget test can fail', async () => {
    const raws = model.symbols.flatMap((symbol) => symbol.signatures.map((signature) => signature.raw!))
    expect((await Promise.all(raws.map((raw) => codeWidthFailures(raw, 'api')))).filter((failures) => failures.length).length).toBeGreaterThan(200)
    expect(await codeWidthFailures('f(x::Int)', 'api')).toEqual([])
  })

  it('keeps the keyword semicolon with the list it opens and puts keywords on their own rows', async () => {
    const wrapped = await layoutOf('capture_pane(connection::LibTmux.ControlConnection, pane::LibTmux.PaneRef; invalid, kwargs...)')
    expect(wrapped.layout.text).toBe('capture_pane(\n    connection::LibTmux.ControlConnection,\n    pane::LibTmux.PaneRef;\n    invalid,\n    kwargs...,\n)')
    const only = await layoutOf('open_server(; tmux, env, timeout, cancel, another_keyword_argument, final)')
    expect(only.layout.text).toBe('open_server(;\n    tmux,\n    env,\n    timeout,\n    cancel,\n    another_keyword_argument,\n    final,\n)')
    expect((await layoutOf('open_server(; tmux, env, timeout, cancel)')).layout.text).toBe('open_server(; tmux, env, timeout, cancel)')
    expect((await layoutOf('main(; ...)')).layout.text).toBe('main(; ...)')
  })

  it('retains defaults, string literals and macro arguments without adding punctuation', async () => {
    const defaults = await layoutOf('run(connection::LibTmux.ControlConnection, command::Cmd, x::Int = 1; timeout::Real = 5.0, cancel = nothing)')
    expect(defaults.layout.text).toBe('run(\n    connection::LibTmux.ControlConnection,\n    command::Cmd,\n    x::Int = 1;\n    timeout::Real = 5.0,\n    cancel = nothing,\n)')
    const literals = await layoutOf('configure(; path = "C:\\\\tmp\\\\", pattern = raw"a,b", label = "first, \\"second\\"", mark = \',\', note = `a;b`, long_argument_name = nothing)')
    expect(literals.layout.text).toBe([
      'configure(;', '    path = "C:\\\\tmp\\\\",', '    pattern = raw"a,b",', '    label = "first, \\"second\\"",', "    mark = ',',",
      '    note = `a;b`,', '    long_argument_name = nothing,', ')',
    ].join('\n'))
    const macro = await layoutOf('@sync_command(connection::LibTmux.ControlConnection, target::LibTmux.PaneRef, extra...)')
    expect(macro.layout.text).toBe('@sync_command(\n    connection::LibTmux.ControlConnection,\n    target::LibTmux.PaneRef,\n    extra...\n)')
    const multiline = await layoutOf('configure(connection::LibTmux.ControlConnection; message = """first,\n  second; (third)""", nested = Dict(:a => (1, 2)))')
    expect(multiline.layout.text).toBe('configure(\n    connection::LibTmux.ControlConnection;\n    message = """first,\n  second; (third)""",\n    nested = Dict(:a => (1, 2)),\n)')
  })

  it('wraps constructors, where clauses and type parameters at their own brackets', async () => {
    const parametric = await layoutOf('LibTmux.EntityRef{I}(server::LibTmux.ServerIdentity, id) where I<:EntityID')
    expect(parametric.layout.text).toBe('LibTmux.EntityRef{I}(\n    server::LibTmux.ServerIdentity,\n    id,\n) where I<:EntityID')
    const union = await layoutOf('windowlinks(parent::Union{LibTmux.SessionSnapshot, LibTmux.WindowSnapshot})')
    expect(union.layout.text).toBe('windowlinks(\n    parent::Union{\n        LibTmux.SessionSnapshot,\n        LibTmux.WindowSnapshot,\n    },\n)')
    const receiver = await layoutOf('(var"#ctor-self#"::Type{LibTmux.ControlSignal{C}} where C)(connection, name, state, notified, request, cleanup_queued, cleanup_done, error)')
    expect(receiver.layout.text.split('\n')[0]).toBe('(var"#ctor-self#"::Type{LibTmux.ControlSignal{C}} where C)(')
    expect(receiver.layout.failures).toEqual([])
  })

  it('records indivisible tokens as failures instead of shrinking or splitting names', async () => {
    const raw = 'a_function_with_one_extremely_long_positional_argument_name_that_cannot_fit(argument_with_an_extremely_long_name_that_overflows::Int)'
    const { layout } = await layoutOf(raw)
    expect(layout.text).toBe('a_function_with_one_extremely_long_positional_argument_name_that_cannot_fit(\n    argument_with_an_extremely_long_name_that_overflows::Int,\n)')
    expect(layout.failures).toEqual([{ line: 1, columns: 76, limit: 60 }, { line: 2, columns: 61, limit: 60 }])
    expect(tokens(layout.text)).toBe(tokens(raw))
    const clean = await layoutOf('f(x::Int)')
    expect(clean.layout.failures).toEqual([])
  })

  it('rejects headers it cannot tokenize instead of guessing', async () => {
    for (const raw of ['f(a, b', 'f(a))', 'f(a, "open)', 'f(a) # comment']) {
      await expect(apiSignatureLayouts(callable(raw), 'julia'), raw).rejects.toThrow(/callable header/)
    }
  })

  it('leaves other languages and signatures without extracted text alone', async () => {
    const symbol = callable('f(x::Int)')
    expect(await apiSignatureLayouts(symbol)).toEqual(new Map())
    expect(await apiSignatureLayouts(symbol, 'probe')).toEqual(new Map())
    expect(await apiSignatureLayouts({ ...symbol, signatures: [{ params: [] }] }, 'julia')).toEqual(new Map())
    expect(usesNativeSignatures(symbol, 'julia')).toBe(true)
  })
})

describe('Julia layout roles and exports', () => {
  it('keeps the declared name, links and keywords exactly as the unformatted header resolved them', async () => {
    let checked = 0
    for (const symbol of model.symbols) {
      const layouts = await apiSignatureLayouts(symbol, 'julia')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        const spans = signatureSpans(layout, index, symbol, signature)
        const before = index.linkType(signature.raw!, symbol, signature)
        expect(spans.map((span) => span.text).join(''), symbol.id).toBe(layout.text)
        const links = (list: typeof spans) => list.filter((span) => span.link).map((span) => [span.text, span.link!.href])
        expect(links(spans), signature.raw).toEqual(links(before))
        expect(spans.filter((span) => span.keyword).map((span) => span.text), signature.raw)
          .toEqual(before.filter((span) => span.keyword).map((span) => span.text))
        expect(spans.filter((span) => span.declaration).map((span) => span.text), signature.raw)
          .toEqual(before.filter((span) => span.declaration).map((span) => span.text))
        const names = spans.filter((span) => span.declarationName)
        expect(names.length, signature.raw).toBe(before.some((span) => span.declaration && span.text === symbol.name && !span.link) ? 1 : 0)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(450)
  })

  it('marks one declaration name and keeps parameter anchors on a wrapped constructor', async () => {
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.GroupResult')!
    const signature = symbol.signatures[0]!
    const layout = (await apiSignatureLayouts(symbol, 'julia')).get(signature)!
    expect(layout.text).toBe([
      'LibTmux.GroupResult(', '    operations::Vector{LibTmux.OperationResult},', '    aggregate::Union{',
      '        Nothing,', '        LibTmux.CommandResult,', '        LibTmux.ControlResult,', '    },',
      '    error::Union{Nothing, Exception},', '    retired::Bool,', '    opaque::Bool,', ')',
    ].join('\n'))
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['GroupResult'])
    expect(spans.filter((span) => span.declaration && span.link).map((span) => span.link!.href.split('#')[1]))
      .toEqual(['operations', 'aggregate', 'error', 'retired', 'opaque'].map((name) => `${symbol.id}.parameter.${name}`))
    expect(spans.filter((span) => span.link && !span.declaration).map((span) => span.text).slice(0, 4))
      .toEqual(['LibTmux', 'Vector', 'LibTmux.OperationResult', 'Union'])
  })

  it('exports the declaration the page shows, in the header and under every overloaded method', async () => {
    for (const id of ['LibTmux.GroupResult', 'LibTmuxMCP.Application', 'LibTmux.capture_pane']) {
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const layouts = await apiSignatureLayouts(symbol, 'julia')
      const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
      const blocks = fromMarkdown(markdown).children.filter((node) => node.type === 'code').map((node) => node.value)
      const declarations = symbol.signatures.map((signature) => layouts.get(signature)!.text)
      expect(blocks, id).toContain(declarations.join('\n\n'))
      if (symbol.signatures.length > 1) {
        for (const declaration of declarations.filter((text) => text.includes('\n'))) expect(blocks, id).toContain(declaration)
      }
      for (const declaration of declarations) {
        for (const row of lines(declaration)) expect(row.length, `${id}: ${row}`).toBeLessThanOrEqual(CODE_COLUMNS.api)
      }
    }
    const application = model.symbols.find((entry) => entry.id === 'LibTmuxMCP.Application')!
    const unformatted = application.signatures.map((signature) => nativeSignatureText(application, signature, 'julia'))
    const markdown = await symbolMarkdownWithLayout({ model, symbol: application, index })
    for (const text of unformatted) expect(markdown).not.toContain(text)
  })
})
