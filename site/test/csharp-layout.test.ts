import { readFileSync } from 'node:fs'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import { parameterId, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { apiEntryFields, nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, supportsCSharpSignatures } from '../src/lib/code-layout'
import { csharpDeclaration, formatCSharpDeclaration } from '../src/lib/csharp-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, signatureComponent } from './signature-component'

interface Fixture {
  formatter: { name: string; version: string }
  corpus: { width: number; cases: { kind: string; id: string; input: string; expected: string }[] }
  shapes: { widths: number[]; cases: { kind: string; input: string; expected: Record<string, string> }[] }
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/csharpier-layout.json', import.meta.url), 'utf8')) as Fixture
const model = JSON.parse(readFileSync(new URL('../src/data/api/csharp.json', import.meta.url), 'utf8')) as ApiModel
const find = (id: string): ApiSymbol => model.symbols.find((entry) => entry.id === id)!
const hrefFor = (entry: ApiSymbol) => `/en/csharp/latest/reference/${entry.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'csharp')

async function withWidth<T>(width: number, run: () => Promise<T>): Promise<T> {
  const original = CODE_COLUMNS.api
  try {
    Object.assign(CODE_COLUMNS, { api: width })
    return await run()
  } finally { Object.assign(CODE_COLUMNS, { api: original }) }
}

describe('CSharpier fidelity', () => {
  it('records the formatter that produced the fixtures', () => {
    expect(fixture.formatter).toMatchObject({ name: 'CSharpier', version: '1.3.0' })
    expect(fixture.corpus.width).toBe(CODE_COLUMNS.api)
  })

  it('reproduces the formatter for each declaration shape in the extracted model', async () => {
    const mismatches = []
    for (const { id, input, expected } of fixture.corpus.cases) {
      const { text } = await formatCSharpDeclaration(input, undefined, false)
      if (text !== expected) mismatches.push({ id, text, expected })
    }
    expect(mismatches).toEqual([])
    expect(fixture.corpus.cases.some((entry) => entry.kind === 'record')).toBe(true)
    expect(fixture.corpus.cases.some((entry) => entry.kind === 'member')).toBe(true)
  })

  it.each([40, 60, 80, 100])('reproduces the formatter for generics, constraints, attributes and defaults at %i columns', async (width) => {
    expect(fixture.shapes.widths).toContain(width)
    const mismatches = await withWidth(width, async () => {
      const found = []
      for (const { input, expected } of fixture.shapes.cases) {
        const { text } = await formatCSharpDeclaration(input, undefined, false)
        if (text !== expected[width]) found.push({ input, text, expected: expected[width] })
      }
      return found
    })
    expect(mismatches).toEqual([])
  })

  it('breaks a base list before its colon and a parameter list before its closing parenthesis', async () => {
    const wide = await formatCSharpDeclaration('public sealed record TmuxPaneGoneEvent(PaneId PaneId) : TmuxEvent;')
    expect(wide.text).toBe('public sealed record TmuxPaneGoneEvent(PaneId PaneId)\n    : TmuxEvent;')
    const narrow = await formatCSharpDeclaration('public sealed record TmuxOutputEvent(PaneId PaneId, string Data) : TmuxEvent;')
    expect(narrow.text).toBe('public sealed record TmuxOutputEvent(\n    PaneId PaneId,\n    string Data\n) : TmuxEvent;')
  })
})

describe('C# width budget', () => {
  it('keeps an indivisible token whole and records the overflow', async () => {
    const name = 'ThisIsAVeryLongMethodNameWithoutAnyParametersAtAllSoItCannotBreak'
    const layout = await formatCSharpDeclaration(`static string ${name}()`)
    expect(layout.text).toContain(`${name}()`)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    // Without a gain in compliance the layout stays what the formatter prints.
    expect(layout.text).toBe((await formatCSharpDeclaration(`static string ${name}()`, undefined, false)).text)
    expect(layout.syntax!.filter((range) => range.kind === 'name').map((range) => layout.text.slice(range.start, range.end))).toEqual([name])
  })

  it('moves the method name below an unbreakable return type only when that fits the budget', async () => {
    const source = 'async Task<SessionCreationResult> CreateSessionWithReceiptAsync(NewSessionRequest? request = null, CancellationToken cancellationToken = default)'
    const faithful = await formatCSharpDeclaration(source, undefined, false)
    expect(faithful.text.split('\n')[0]).toBe('async Task<SessionCreationResult> CreateSessionWithReceiptAsync(')
    expect(faithful.failures).toEqual([{ line: 1, columns: 64, limit: 60 }])
    const layout = await formatCSharpDeclaration(source)
    expect(layout.text).toBe(`async Task<SessionCreationResult>
    CreateSessionWithReceiptAsync(
        NewSessionRequest? request = null,
        CancellationToken cancellationToken = default
    )`)
    expect(layout.failures).toEqual([])
  })

  it('formats every supported declaration in the extracted model within the budget', async () => {
    const supported = model.symbols.filter((symbol) => supportsCSharpSignatures(symbol, 'csharp'))
    const unresolved: string[] = []
    let formatted = 0
    let broken = 0
    for (const symbol of supported) {
      const layouts = await apiSignatureLayouts(symbol, 'csharp')
      expect([...layouts.keys()], symbol.id).toEqual(symbol.signatures)
      for (const layout of layouts.values()) {
        formatted++
        if (layout.text.includes('\n')) broken++
        expect(layout.limit).toBe(60)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        if (layout.failures.length) unresolved.push(symbol.id)
        // A recorded failure is a line with nowhere left to break.
        for (const failure of layout.failures) expect(layout.text.split('\n')[failure.line - 1]!.trim(), symbol.id).not.toMatch(/\s/)
      }
    }
    expect(unresolved).toEqual([])
    expect(formatted).toBeGreaterThan(500)
    expect(broken).toBeGreaterThan(100)
    // Every extracted callable is declared; none falls back to the generic parameter list.
    expect(model.symbols.filter((symbol) => symbol.kind === 'method' && !supportsCSharpSignatures(symbol, 'csharp')).map((symbol) => symbol.id)).toEqual([])
  })

  it('formats nothing outside records and extracted callables', () => {
    expect(supportsCSharpSignatures(find('LibTmux.ClientAttachment'), 'csharp')).toBe(true)
    expect(supportsCSharpSignatures(find('LibTmux.TmuxBuffers.SetAsync'), 'csharp')).toBe(true)
    expect(supportsCSharpSignatures(find('LibTmux.TmuxBuffers.SetAsync'), 'fsharp')).toBe(false)
    expect(model.symbols.filter((symbol) => ['property', 'enum', 'constant', 'interface'].includes(symbol.kind))
      .some((symbol) => supportsCSharpSignatures(symbol, 'csharp'))).toBe(false)
    expect(model.symbols.filter((symbol) => symbol.kind === 'class' && symbol.signatures.length === 0)
      .some((symbol) => supportsCSharpSignatures(symbol, 'csharp'))).toBe(false)
    expect(usesNativeSignatures(find('LibTmux.ClientAttachment'), 'csharp')).toBe(true)
    expect(usesNativeSignatures(find('LibTmux.TmuxChain.Then'), 'csharp')).toBe(true)
    const unreadable: ApiSymbol = { ...find('LibTmux.TmuxChain.Then'), signatures: [{ params: [{ name: 'name', type: 'string' }, { name: 'arguments' }] }] }
    expect(supportsCSharpSignatures(unreadable, 'csharp')).toBe(false)
  })
})

describe('C# declarations', () => {
  it('projects an extracted callable without inventing modifiers', () => {
    const symbol = find('LibTmux.TmuxWait.UntilAsync')
    expect(csharpDeclaration(symbol, symbol.signatures.find((signature) => signature.typeParams?.length)!)).toBe(
      'static async Task<T> UntilAsync<T>(Func<CancellationToken, Task<T>> probe, Func<T, bool> predicate, TimeSpan timeout, TimeSpan interval, CancellationToken cancellationToken = default)')
    const constructor = find('LibTmux.TmuxCommand.TmuxCommand')
    expect(csharpDeclaration(constructor, constructor.signatures[0]!)).toBe('TmuxCommand(string Name, IReadOnlyList<string> Arguments)')
    const record = find('LibTmux.ClientAttachment')
    expect(csharpDeclaration(record, record.signatures[0]!)).toBe(record.signatures[0]!.raw)
  })

  it('declares an extracted params array under its own name and anchor', async () => {
    const symbol = find('LibTmux.TmuxCommand.Create')
    const signature = symbol.signatures[0]!
    expect(signature.params.map((param) => param.name)).toEqual(['name', 'string[]', 'arguments'])
    expect(csharpDeclaration(symbol, signature)).toBe('static TmuxCommand Create(string name, params string[] arguments)')
    const layout = (await apiSignatureLayouts(symbol, 'csharp')).get(signature)!
    expect(layout.text).toBe('static TmuxCommand Create(\n    string name,\n    params string[] arguments\n)')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href])).toEqual([
      ['name', `#${encodeURIComponent(parameterId(symbol, 'name'))}`], ['arguments', `#${encodeURIComponent(parameterId(symbol, 'arguments'))}`]])
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(['static', 'params'])
    // The nameless array entry is not a parameter of its own.
    expect(apiEntryFields(symbol, 'csharp').params.map((param) => param.name)).toEqual(['name', 'arguments'])
  })

  it('formats the nullable components of a sealed record', async () => {
    const symbol = find('LibTmux.ClientAttachment')
    const layout = (await apiSignatureLayouts(symbol, 'csharp')).get(symbol.signatures[0]!)!
    expect(layout.text).toBe('public sealed record ClientAttachment(\n    Session? Session,\n    Window? Window,\n    Pane? Pane\n);')
    const mcp = find('LibTmux.Mcp.PaneInfo')
    const attributed = (await apiSignatureLayouts(mcp, 'csharp')).get(mcp.signatures[0]!)!
    expect(attributed.text.split('\n').slice(0, 3)).toEqual(['[UnsupportedOSPlatform("windows")]', 'public sealed record PaneInfo(', '    string PaneId,'])
    expect(attributed.syntax!.filter((range) => range.kind === 'literal').map((range) => attributed.text.slice(range.start, range.end))).toContain('"windows"')
  })

  it.each([
    ['public sealed record R(int A) // comment', /comments are unsupported/],
    ['public sealed record R(int A', /Expected|end/],
    ['public sealed record R(int A) : B<>;', /Expected a name/],
  ])('rejects the unsupported or invalid declaration %s', async (source, message) => {
    await expect(formatCSharpDeclaration(source)).rejects.toThrow(message)
  })

  it('rejects names that disagree with the extracted parameters', async () => {
    await expect(formatCSharpDeclaration('Task M(int a, int b)', [{ name: 'a', index: 0 }, { name: 'c', index: 1 }])).rejects.toThrow(/binding disagrees/)
  })
})

describe('C# links, roles and exports', () => {
  it('links record components to their types and parameter anchors, leaving names and literals bare', async () => {
    const symbol = find('LibTmux.ClientAttachment')
    const signature = symbol.signatures[0]!
    const layout = (await apiSignatureLayouts(symbol, 'csharp')).get(signature)!
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(['public', 'sealed', 'record'])
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['ClientAttachment'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href])).toEqual(
      signature.params.map((param) => [param.name, `#${encodeURIComponent(parameterId(symbol, param.name))}`]))
    expect(spans.filter((span) => span.link && !span.link.href.startsWith('#')).map((span) => [span.text, span.link!.href])).toEqual([
      ['Session', hrefFor(find('LibTmux.Session'))], ['Window', hrefFor(find('LibTmux.Window'))], ['Pane', hrefFor(find('LibTmux.Pane'))],
    ])
  })

  it('keeps bound type parameters, defaults and string literals from linking', async () => {
    const symbol = find('LibTmux.TmuxOptions.GetAsync')
    const signature = symbol.signatures.find((entry) => entry.typeParams?.length)!
    const unrelated: ApiSymbol = { ...find('LibTmux.Pane'), id: 'LibTmux.T', name: 'T', slug: 'libtmux-t' }
    const scoped = new SymbolIndex([...model.symbols, unrelated], hrefFor, 'csharp')
    const layout = (await apiSignatureLayouts(symbol, 'csharp')).get(signature)!
    const spans = signatureSpans(layout, scoped, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.text === 'T').every((span) => span.nonReference && !span.link)).toBe(true)
    expect(spans.filter((span) => span.text === 'T')).toHaveLength(3)
    expect(spans.find((span) => span.text === 'default')).toMatchObject({ nonReference: true })
    expect(spans.find((span) => span.link?.href === hrefFor(find('LibTmux.TmuxOptionKey')))?.text).toBe('TmuxOptionKey')
    const literal = await formatCSharpDeclaration('void M(string tool = "tmux", int count = 1, Mode mode = Mode.Auto)',
      ['tool', 'count', 'mode'].map((name, position) => ({ name, index: position })))
    expect(literal.syntax!.filter((range) => range.kind === 'literal').map((range) => literal.text.slice(range.start, range.end))).toEqual(['"tmux"', '1'])
  })

  it('shares the formatted text with the Markdown export', async () => {
    for (const id of ['LibTmux.ClientAttachment', 'LibTmux.Mcp.PaneInfo', 'LibTmux.TmuxWait.UntilAsync', 'LibTmux.Server.CreateSessionWithReceiptAsync', 'LibTmux.TmuxChain.Then']) {
      const symbol = find(id)
      const layouts = await apiSignatureLayouts(symbol, 'csharp')
      const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
      const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
      expect(code?.type === 'code' && code.value, id).toBe(symbol.signatures.map((signature) => layouts.get(signature)!.text).join('\n\n'))
    }
  })
})

describe('C# HTML export', () => {
  it.each(['LibTmux.Mcp.PaneInfo', 'LibTmux.PaneRunResult', 'LibTmux.TmuxOptions.SetAsync', 'LibTmux.Server.CreateSessionWithReceiptAsync'])(
    'renders %s as the exported text inside the budget, with parameter anchors',
    async (id) => {
      const symbol = find(id)
      const signatureLayouts = await apiSignatureLayouts(symbol, 'csharp')
      const container = await experimental_AstroContainer.create()
      const win = new Window()
      try {
        const component = await signatureComponent()
        win.document.body.innerHTML = (await Promise.all(symbol.signatures.map((sig: Signature) => container.renderToString(component, {
          props: { symbol, sig, port: 'csharp', language: 'csharp', index, signatureLayouts, nativeSignatureText },
        })))).join('')
        const declarations = [...win.document.querySelectorAll('.api-native-signature')]
        expect(declarations.map((element) => element.classList.contains('api-native-signature--formatted'))).toEqual(symbol.signatures.map(() => true))
        expect(declarations.map((element) => element.getAttribute('data-code-width-status'))).toEqual(symbol.signatures.map(() => 'fits'))
        expect(declarations.map((element) => element.getAttribute('data-code-columns'))).toEqual(symbol.signatures.map(() => '60'))
        expect(declarations.map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
        expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')]))
          .toEqual(symbol.signatures.flatMap((signature) => signature.params.map((param) => [param.name, `#${encodeURIComponent(parameterId(symbol, param.name))}`])))
        expect(win.document.querySelector('a a')).toBeNull()
      } finally { await win.happyDOM.abort() }
    })

  it('renders a params array under its declared name', async () => {
    const symbol = find('LibTmux.TmuxCommand.Create')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'csharp')
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(await signatureComponent(), {
        props: { symbol, sig: symbol.signatures[0], port: 'csharp', language: 'csharp', index, signatureLayouts, nativeSignatureText },
      })
      expect(displayedSignature(win.document.querySelector('.api-native-signature')!)).toBe('static TmuxCommand Create(\n    string name,\n    params string[] arguments\n)')
      expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => link.textContent)).toEqual(['name', 'arguments'])
    } finally { await win.happyDOM.abort() }
  })
})
