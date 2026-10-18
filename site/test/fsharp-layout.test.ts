import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ApiModel, ApiSymbol, Signature } from '@libtmux/api-model'
import { API_MODELS, createApiIndex } from '../src/lib/api-models'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans, supportsFSharpSignatures } from '../src/lib/code-layout'
import { formatFSharpSignature } from '../src/lib/fsharp-code-layout'
import { symbolMarkdown, symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

interface Case { origin: string; width: number; source: string[]; formatted: string[] }
/** Output captured from the Fantomas release and settings recorded in the fixture. */
const fantomas = JSON.parse(readFileSync(new URL('./fixtures/fsharp-fantomas-signatures.json', import.meta.url), 'utf8')) as
  { formatter: { name: string; version: string; settings: Record<string, unknown> }; cases: Case[] }
const model = JSON.parse(readFileSync(new URL('../src/data/api/fsharp.json', import.meta.url), 'utf8')) as ApiModel
const symbolById = (id: string) => model.symbols.find((symbol) => symbol.id === id)!
const callable = (raw: string, params: Signature['params'] = []): ApiSymbol => ({
  id: 'LibTmux.FSharp.Probe.f', name: 'f', kind: 'function', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'probe.fsi' },
})
const layoutOf = async (symbol: ApiSymbol) => {
  const layout = (await apiSignatureLayouts(symbol, 'fsharp')).get(symbol.signatures[0]!)
  expect(layout).toBeDefined()
  return layout!
}
/** The extractor drops the opening parenthesis of an active-pattern name; Fantomas needs it. */
const fantomasSource = (raw: string) => raw.replace(/^val \|/, 'val (|')
const lineWidths = (text: string) => text.split('\n').map((line) => line.length)

describe('Fantomas reference output', () => {
  it('records the formatter release and settings behind the fixture', () => {
    expect(fantomas.formatter.name).toBe('Fantomas')
    expect(fantomas.formatter.version).toMatch(/^8\.0\.10\+[0-9a-f]{9,}$/)
    expect(fantomas.formatter.settings).toMatchObject({ indent_size: 4 })
    expect(new Set(fantomas.cases.map((entry) => entry.width))).toEqual(new Set([40, 60, 80]))
  })

  it('reproduces the captured output for every val and member shape', () => {
    const mismatches = fantomas.cases.flatMap((entry) => {
      const actual = formatFSharpSignature(entry.source.join('\n'), entry.width)
      return actual === entry.formatted.join('\n') ? [] : [{ origin: entry.origin, source: entry.source, expected: entry.formatted, actual: actual.split('\n') }]
    })
    expect(mismatches).toEqual([])
  })

  it('covers each layout decision with a captured multiline case', () => {
    const multiline = fantomas.cases.filter((entry) => entry.formatted.length > 1).map((entry) => entry.formatted.join('\n'))
    const decisions: [string, RegExp][] = [
      ['a trailing arrow after each argument', /^ {4}\S.* ->$/m],
      ['the result one level below the arguments', /->\n {8}\S/],
      ['a constraint under the arguments', /^ {8}when /m],
      ['a continued constraint', /^ {8}and /m],
      ['a tupled argument broken after its star', /\*$/m],
      ['type arguments broken after the opening bracket', /<$/m],
      ['a closing bracket one column inside its type name', /^ +>( ->)?$/m],
      ['an optional argument', /^ {4}\?\w+: /m],
      ['a parenthesized function argument', /^ +\(\S.*$/m],
    ]
    for (const [description, pattern] of decisions) {
      expect(multiline.filter((text) => pattern.test(text)).length, description).toBeGreaterThan(0)
    }
    expect(fantomas.cases.some((entry) => entry.source[0]!.startsWith('member') && entry.formatted.length > 1)).toBe(true)
  })

  it('puts every curried argument on its own line with a trailing arrow', () => {
    expect(formatFSharpSignature('val capture:\n        cancellationToken: CancellationToken -> depth: SnapshotDepth -> server: LibTmux.Server -> Task<LibTmux.Server>')).toBe(
      `val capture:
    cancellationToken: CancellationToken ->
    depth: SnapshotDepth ->
    server: LibTmux.Server ->
        Task<LibTmux.Server>`)
  })

  it('keeps the arguments together when they fit under the name, and the whole signature when it fits', () => {
    expect(formatFSharpSignature("val sessions: server: LibTmux.Server -> Query<LibTmux.Session>")).toBe(
      'val sessions:\n    server: LibTmux.Server -> Query<LibTmux.Session>')
    expect(formatFSharpSignature('val name: Field<LibTmux.Session, string>')).toBe('val name: Field<LibTmux.Session, string>')
    expect(formatFSharpSignature('val cleanupFailure: error: exn -> exn option')).toBe('val cleanupFailure: error: exn -> exn option')
  })

  it('treats exactly 60 columns as fitting and 61 as too wide', () => {
    const fits = `val f: a: int -> ${'R'.repeat(60 - 'val f: a: int -> '.length)}`
    expect(fits).toHaveLength(60)
    expect(formatFSharpSignature(fits)).toBe(fits)
    expect(formatFSharpSignature(`${fits}R`).split('\n')).toHaveLength(2)
  })

  it('places a constraint after the chain, or under it when the chain is broken', () => {
    expect(formatFSharpSignature("val value: value: CapturedValue<'T> -> CaptureState<'T> when 'T: not struct")).toBe(
      "val value:\n    value: CapturedValue<'T> -> CaptureState<'T>\n        when 'T: not struct")
    expect(formatFSharpSignature("val relate: left: Relation<'P, 'C> -> right: Filter<'C> -> Filter<'P> when 'P: equality and 'C: comparison")).toBe(
      `val relate:
    left: Relation<'P, 'C> ->
    right: Filter<'C> ->
        Filter<'P>
        when 'P: equality and 'C: comparison`)
  })

  it('indents what follows a tupled argument and keeps tupled members together', () => {
    expect(formatFSharpSignature('member Create: server: LibTmux.Server * target: QueryTarget * session: SessionId option -> options: QueryOptions -> Query<unit>')).toBe(
      `member Create:
    server: LibTmux.Server *
    target: QueryTarget *
    session: SessionId option ->
        options: QueryOptions ->
            Query<unit>`)
  })

  it('does not copy the authored 120-column continuation layout', () => {
    const authored = symbolById('LibTmux.FSharp.Server.capture').signatures[0]!.raw!
    expect(Math.max(...lineWidths(authored))).toBeGreaterThan(60)
    expect(Math.max(...lineWidths(formatFSharpSignature(authored)))).toBeLessThanOrEqual(60)
  })
})

describe('F# model signatures', () => {
  const fixtures = new Map(fantomas.cases.filter((entry) => entry.origin === 'model' && entry.width === 60)
    .map((entry) => [entry.source.join('\n'), entry.formatted.join('\n')]))
  const signatures = model.symbols.flatMap((symbol) => symbol.signatures.map((signature) => ({ symbol, signature })))

  it('formats every val and member as Fantomas does at the shared width', async () => {
    const supported = model.symbols.filter((symbol) => supportsFSharpSignatures(symbol, 'fsharp'))
    expect(supported.length).toBeGreaterThan(0)
    const missing: string[] = []
    const differing: { id: string; expected: string; actual: string }[] = []
    for (const symbol of supported) {
      const layouts = await apiSignatureLayouts(symbol, 'fsharp')
      expect(layouts.size).toBe(symbol.signatures.length)
      for (const signature of symbol.signatures) {
        const expected = fixtures.get(fantomasSource(signature.raw!))
        if (expected === undefined) { missing.push(signature.raw!); continue }
        const actual = layouts.get(signature)!.text
        // The extractor's missing parenthesis is part of the stored declaration, not of the layout.
        if (actual !== (signature.raw!.startsWith('val |') ? expected.replace('val (|', 'val |') : expected)) differing.push({ id: symbol.id, expected, actual })
      }
    }
    expect(missing).toEqual([])
    expect(differing).toEqual([])
  })

  it('keeps every line within the API budget, or reports the line', async () => {
    for (const symbol of model.symbols) {
      for (const [signature, layout] of await apiSignatureLayouts(symbol, 'fsharp')) {
        const over = lineWidths(layout.text).flatMap((columns, index) => columns > 60 ? [{ line: index + 1, columns, limit: 60 }] : [])
        expect(layout.limit).toBe(60)
        expect(layout.failures, symbol.id).toEqual(over)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        // Only whitespace differs from the declaration the extractor wrote.
        expect(layout.text.replace(/\s+/g, ''), symbol.id).toBe(signature.raw!.replace(/\s+/g, ''))
      }
    }
  })

  it('leaves other declarations native, and each of them fits the budget as written', async () => {
    for (const { symbol, signature } of signatures) {
      if (supportsFSharpSignatures(symbol, 'fsharp')) continue
      expect((await apiSignatureLayouts(symbol, 'fsharp')).size).toBe(0)
      expect(Math.max(...lineWidths(signature.raw!)), symbol.id).toBeLessThanOrEqual(60)
    }
  })

  it('leaves the declarations of other ports to their own layouts', async () => {
    expect((await apiSignatureLayouts(symbolById('LibTmux.FSharp.Server.capture'), 'csharp')).size).toBe(0)
    expect((await apiSignatureLayouts(symbolById('LibTmux.FSharp.Server.capture'), undefined)).size).toBe(0)
  })
})

describe('F# width failures', () => {
  it('reports a name that cannot be broken, and passes the control', async () => {
    const name = 'aVeryLongFunctionNameThatCannotBeBrokenAtAnyBoundaryInsideTheIdentifier'
    const long = await layoutOf(callable(`val ${name}: x: int -> unit`, [{ name: 'x', type: 'int' }]))
    expect(long.text).toBe(`val ${name}:\n    x: int -> unit`)
    expect(long.failures).toEqual([{ line: 1, columns: `val ${name}:`.length, limit: 60 }])
    const control = await layoutOf(callable('val sendKeys: x: int -> unit', [{ name: 'x', type: 'int' }]))
    expect(control.failures).toEqual([])
  })

  it('reports an argument name that cannot be broken', async () => {
    const argument = 'aVeryLongArgumentNameThatCannotBeBrokenAtAnyBoundaryInsideTheName'
    const layout = await layoutOf(callable(`val f: ${argument}: int -> unit`, [{ name: argument, type: 'int' }]))
    expect(layout.failures).toEqual([{ line: 2, columns: `    ${argument}:`.length, limit: 60 }])
    expect(layout.text.split('\n')[1]).toBe(`    ${argument}:`)
  })

  it('reports a closing bracket that Fantomas leaves past the budget', async () => {
    const type = 'SomeTypeConstructorWithAnExceptionallyLongNameForTesting'
    const layout = await layoutOf(callable(`val f: x: int -> y: ${type}<int> -> unit`, [{ name: 'x' }, { name: 'y' }]))
    expect(layout.text).toContain(`        ${type}<\n            int\n         > ->`)
    expect(layout.failures).toEqual([{ line: 4, columns: `        ${type}<`.length, limit: 60 }])
  })
})

describe('F# syntax roles and links', () => {
  const capture = symbolById('LibTmux.FSharp.Server.capture')
  const signature = capture.signatures[0]!
  const index = createApiIndex(API_MODELS.fsharp, (entry) => `/en/fsharp/latest/reference/${entry.slug}/`)
  const links = (spans: { text: string; link?: { href: string } }[]) => spans.filter((span) => span.link).map((span) => [span.text, span.link!.href])

  it('keeps every type and keyword reference of the authored declaration', async () => {
    const layout = await layoutOf(capture)
    const spans = signatureSpans(layout, index, capture, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    const authored = index.linkType(signature.raw!, capture, signature)
    const references = (items: { text: string; link?: { href: string } }[]) => links(items.filter((item) => !('declaration' in item && item.declaration)))
    expect(references(spans)).toEqual(references(authored))
    expect(references(spans).map(([text]) => text)).toEqual(['CancellationToken', 'SnapshotDepth', 'LibTmux.Server', 'Task', 'LibTmux.Server'])
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(['val'])
    expect(spans.find((span) => span.text === 'val')?.help?.title).toBe('F# value signatures')
  })

  it('links the name and each named argument to its anchor', async () => {
    const layout = await layoutOf(capture)
    const spans = signatureSpans(layout, index, capture, signature)
    expect(spans.find((span) => span.declarationName)?.text).toBe('capture')
    expect(spans.filter((span) => span.declaration && span.link).map((span) => [span.text, span.link!.href])).toEqual(
      ['cancellationToken', 'depth', 'server'].map((name) => [name, `#LibTmux.FSharp.Server.capture.parameter.${name}`]))
    expect(layout.syntax!.map((range) => layout.text.slice(range.start, range.end))).toEqual(['capture', 'cancellationToken', 'depth', 'server'])
  })

  it('distinguishes a declared name from an argument of the same name', async () => {
    const value = symbolById('LibTmux.FSharp.Snapshot.value')
    const layout = await layoutOf(value)
    expect(layout.syntax).toEqual([{ start: 4, end: 9, kind: 'name' }, { start: 15, end: 20, kind: 'parameter', parameter: 0 }])
    const spans = signatureSpans(layout, index, value, value.signatures[0]!)
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(['val', 'when'])
  })

  it('anchors an optional argument by its name without the question mark', async () => {
    const symbol = callable('val connect: ?timeout: TimeSpan -> ?cancellationToken: CancellationToken -> server: LibTmux.Server -> Task', [
      { name: 'timeout', type: 'TimeSpan', default: 'None' }, { name: 'cancellationToken', type: 'CancellationToken', default: 'None' },
      { name: 'server', type: 'LibTmux.Server' }])
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe('val connect:\n    ?timeout: TimeSpan ->\n    ?cancellationToken: CancellationToken ->\n    server: LibTmux.Server ->\n        Task')
    expect(layout.syntax!.map((range) => layout.text.slice(range.start, range.end))).toEqual(['connect', 'timeout', 'cancellationToken', 'server'])
  })

  it('has no argument anchors for a tupled or unnamed argument', async () => {
    const tupled = await layoutOf(callable("val create: server: LibTmux.Server * target: QueryTarget -> Query<'T>", [{ name: 'arg1' }]))
    expect(tupled.syntax).toEqual([{ start: 4, end: 10, kind: 'name' }])
    const unit = await layoutOf({ ...callable('member ToString: unit -> string', [{ name: 'arg1', type: 'unit' }]), kind: 'method' })
    expect(unit.text).toBe('member ToString: unit -> string')
    expect(unit.syntax).toEqual([{ start: 7, end: 15, kind: 'name' }])
  })

  it('rejects a binding the model does not describe', async () => {
    await expect(apiSignatureLayouts(callable('val f: x: int -> unit', [{ name: 'y' }]), 'fsharp')).rejects.toThrow('binding disagrees with the model')
    await expect(apiSignatureLayouts(callable('val f: x: int -> unit', []), 'fsharp')).rejects.toThrow('binding disagrees with the model')
  })

  it('keeps an active-pattern name as the extractor wrote it', async () => {
    const symbol = model.symbols.find((entry) => entry.signatures[0]?.raw === 'val |NotSent|_|): error: exn -> LibTmuxException option')!
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe(symbol.signatures[0]!.raw)
    expect(layout.text.slice(layout.syntax![0]!.start, layout.syntax![0]!.end)).toBe('|NotSent|_|)')
  })
})

describe('F# copied text', () => {
  it('shares the formatted text with the Markdown export', async () => {
    const symbol = symbolById('LibTmux.FSharp.Server.capture')
    const layout = await layoutOf(symbol)
    const code = (markdown: string) => {
      const block = fromMarkdown(markdown).children.find((node) => node.type === 'code')
      return block?.type === 'code' ? block.value : undefined
    }
    expect(code(await symbolMarkdownWithLayout({ model, symbol }))).toBe(layout.text)
    // Without prepared layouts the export keeps the declaration as authored.
    expect(code(symbolMarkdown({ model, symbol }))).toBe(symbol.signatures[0]!.raw)
    expect(layout.text).not.toBe(symbol.signatures[0]!.raw)
  })

  it('shares the layout across overloads of one declaration', async () => {
    const symbol = callable('val f: x: int -> unit', [{ name: 'x', type: 'int' }])
    const second: Signature = { raw: 'val f: y: string -> unit', params: [{ name: 'y', type: 'string' }] }
    const layouts = await apiSignatureLayouts({ ...symbol, signatures: [...symbol.signatures, second] }, 'fsharp')
    expect([...layouts.values()].map((layout) => layout.text)).toEqual(['val f: x: int -> unit', 'val f: y: string -> unit'])
  })
})

describe('Unsupported F# signature syntax', () => {
  it.each([
    ['a comment', 'val f: x: int (* note *) -> unit'],
    ['a line comment', 'val f: x: int -> unit // note'],
    ['a struct tuple', 'val f: struct (int * int) -> unit'],
    ['an explicit type parameter', "val f<'T>: x: 'T -> unit"],
    ['a modifier', 'val inline f: x: int -> unit'],
    ['an anonymous record', 'val f: {| A: int |} -> unit'],
    ['a type that is not a signature', 'type Filter<\'T>'],
    ['an unfinished type', 'val f: x: int ->'],
    ['a trailing token', 'val f: x: int -> unit )'],
  ])('refuses %s instead of changing it', (_, raw) => {
    expect(() => formatFSharpSignature(raw)).toThrow(/Unsupported F# signature/)
  })
})
