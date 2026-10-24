import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parameterId, qualifiedNameOf, SymbolIndex, type Param, type Signature } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { signatureParameterText } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures } from '../src/lib/code-layout'
import { pythonSignatureLayout, type PythonLayout } from '../src/lib/python-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

interface Stub { stub: string; formatted: string }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/python-ruff-margin-60.json', import.meta.url), 'utf8')) as {
  formatter: { package: string; version: string; options: { 'line-length': number } }
  shapes: (Stub & { name: string })[]
  divergences: (Stub & { name: string })[]
  corpus: Stub[]
}
const model = API_MODELS.py
// A def line carries `def ` before the name and `: ...` after the last bracket.
const RESERVE = { head: 4, tail: 5 }

/** Split at a separator outside brackets and strings. */
function top(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = '' }
    else if (char === '"' || char === "'") quote = char
    else if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (!depth && text.startsWith(separator, i)) { parts.push(text.slice(start, i)); start = i + separator.length; i += separator.length - 1 }
  }
  return [...parts, text.slice(start)].map((part) => part.trim())
}

/** Read the extracted pieces back out of a formatter stub. */
function parseStub(stub: string): { name: string; signature: Signature } {
  const open = stub.indexOf('(')
  let depth = 0
  let close = open
  for (let i = open; i < stub.length; i++) {
    if ('([{'.includes(stub[i]!)) depth++
    else if (')]}'.includes(stub[i]!) && !--depth) { close = i; break }
  }
  const returns = /^ -> (.*): \.\.\.$/.exec(stub.slice(close + 1))?.[1]
  const params: Param[] = top(stub.slice(open + 1, close), ',').filter(Boolean).map((text) => {
    const variadic = text.startsWith('**') ? 'keyword' : /^\*\w/.test(text) ? 'positional' : undefined
    const [declaration = '', ...rest] = top(text.replace(/^\*\*?(?=\w)/, ''), ' = ')
    const [name = '', ...annotation] = top(declaration, ': ')
    return { name, ...(annotation.length ? { type: annotation.join(': ') } : {}), ...(rest.length ? { default: rest.join(' = ') } : {}),
      ...(variadic ? { variadic } : {}) } as Param
  })
  return { name: stub.slice(4, open), signature: { params, ...(returns ? { returns } : {}) } }
}

const expectedText = (formatted: string) => formatted.replace(/^def /, '').replace(/: \.\.\.$/, '')
const lines = (text: string) => text.split('\n')
/** Whitespace and added trailing commas are the only differences a layout may make. */
const tokens = (text: string) => text.replace(/\s/g, '').replace(/,(?=[)\]}])/g, '')

function flatText(signature: Signature, name: string): string {
  return `${name}(${signature.params.map((param) => signatureParameterText(param, 'py')).join(', ')})${signature.returns ? ` -> ${signature.returns}` : ''}`
}

describe('Python declaration layouts', () => {
  it('records the formatter and options the fixtures were generated with', () => {
    expect(fixture.formatter).toMatchObject({ package: 'ruff', version: '0.16.10', options: { 'line-length': CODE_COLUMNS.api } })
  })

  it.each(fixture.shapes.map((shape) => [shape.name, shape] as const))('matches ruff format for %s', async (_name, shape) => {
    const { name, signature } = parseStub(shape.stub)
    const layout = await pythonSignatureLayout(signature, { name, reserve: RESERVE })
    expect(layout.text).toBe(expectedText(shape.formatted))
    expect(layout.limit).toBe(CODE_COLUMNS.api)
  })

  it('matches ruff format for every wrapped declaration in the inventory', async () => {
    expect(fixture.corpus.length).toBeGreaterThan(300)
    for (const { stub, formatted } of fixture.corpus) {
      const { name, signature } = parseStub(stub)
      expect((await pythonSignatureLayout(signature, { name, reserve: RESERVE })).text, stub).toBe(expectedText(formatted))
    }
  })

  it('does not parenthesize a long union return, which would add punctuation', async () => {
    const [shape] = fixture.divergences
    const { name, signature } = parseStub(shape!.stub)
    expect(shape!.formatted).toContain(') -> (\n')
    const layout = await pythonSignatureLayout(signature, { name, reserve: RESERVE })
    expect(layout.text).toBe('either(\n    self, a: int\n) -> aaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbbbb | ccccccccccccccccccc | dddddddddddd')
    expect(layout.failures).toEqual([{ line: 3, columns: 83, limit: 60 }])
  })

  it('lays out the displayed bar without the columns a def line would spend', async () => {
    // `def ` and `: ...` are not displayed, so a header that ruff wraps can still fit.
    const { name, signature } = parseStub('def lock_client(self, target_client: str | None = None) -> None: ...')
    const flat = flatText(signature, name)
    expect(flat.length).toBe(CODE_COLUMNS.api - 1)
    expect((await pythonSignatureLayout(signature, { name })).text).toBe(flat)
    expect((await pythonSignatureLayout(signature, { name, reserve: RESERVE })).text).not.toBe(flat)
  })

  it('records indivisible tokens as failures instead of shrinking or splitting names', async () => {
    const { name, signature } = parseStub('def label(self, value: str = "a very long default string that cannot be split anywhere", other: int = 1) -> None: ...')
    const layout = await pythonSignatureLayout(signature, { name })
    expect(layout.failures).toEqual([{ line: 3, columns: 76, limit: 60 }])
    expect(lines(layout.text)[2]).toBe('    value: str = "a very long default string that cannot be split anywhere",')
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    expect((await pythonSignatureLayout(parseStub('def f(x: int) -> None: ...').signature, { name: 'f' })).failures).toEqual([])
  })
})

describe('Python layouts across the inventory', () => {
  const signatures = model.symbols.filter((symbol) => symbol.signatures.length).flatMap((symbol) =>
    symbol.signatures.map((signature) => ({ symbol, signature })))

  it('wraps every displayed declaration within the API budget except named indivisible tokens', async () => {
    const unresolved: string[] = []
    let wrapped = 0
    for (const { symbol, signature } of signatures) {
      const layout = await pythonSignatureLayout(signature, { name: symbol.name })
      expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
      if (layout.failures.length) unresolved.push(symbol.id)
      if (layout.text.includes('\n')) wrapped++
      // Wrapping neither adds nor drops a token, and fitting declarations are untouched.
      const flat = flatText(signature, symbol.name)
      expect(tokens(layout.text), symbol.id).toBe(tokens(flat))
      if (flat.length <= CODE_COLUMNS.api) expect(layout.text).toBe(flat)
      else expect(layout.text, symbol.id).toContain('\n')
      expect(layout.parameters, symbol.id).toHaveLength(signature.params.length)
    }
    expect(unresolved).toEqual(['libtmux_mcp.tools.pane_tools.search.search_panes'])
    expect(wrapped).toBeGreaterThan(300)
    expect(wrapped).toBeLessThan(signatures.length)
  })

  it('shows what the unwrapped inventory would have reported, so the budget check can fail', async () => {
    const overwide = signatures.filter(({ symbol, signature }) => flatText(signature, symbol.name).length > CODE_COLUMNS.api)
    expect(overwide.length).toBeGreaterThan(300)
    expect(await codeWidthFailures(flatText(overwide[0]!.signature, overwide[0]!.symbol.name), 'api')).not.toEqual([])
  })

  it('exports each declaration with its qualified name at the same budget', async () => {
    let wrapped = 0
    for (const symbol of model.symbols.filter((entry) => entry.signatures.length)) {
      const layouts = await apiSignatureLayouts(symbol, 'py')
      expect(layouts.size, symbol.id).toBe(symbol.signatures.length)
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        expect(layout.text.startsWith(`${qualifiedNameOf(symbol)}(`), symbol.id).toBe(true)
        expect(tokens(layout.text), symbol.id).toBe(tokens(flatText(signature, qualifiedNameOf(symbol))))
        expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
        if (layout.text.includes('\n')) wrapped++
        // Only a name that is itself too wide, or the one unbreakable default, leaves a long row.
        for (const failure of layout.failures) {
          const row = lines(layout.text)[failure.line - 1]!
          expect(row.startsWith(`${qualifiedNameOf(symbol)}(`) || row === '    max_matched_lines_per_pane: int = SEARCH_DEFAULT_MAX_LINES_PER_PANE,', `${symbol.id}: ${row}`).toBe(true)
        }
      }
    }
    expect(wrapped).toBeGreaterThan(400)
  })

  it('prints the same declaration block in the Markdown export', async () => {
    for (const id of ['libtmux.hooks.HooksMixin.show_hook', 'libtmux.server.Server.show_prompt_history', 'libtmux_mcp.tools.pane_tools.layout.select_pane']) {
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const layouts = await apiSignatureLayouts(symbol, 'py')
      const markdown = await symbolMarkdownWithLayout({ model, symbol, index: new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'py') })
      const block = fromMarkdown(markdown).children.find((node) => node.type === 'code')
      expect(block, id).toMatchObject({ value: symbol.signatures.map((signature) => layouts.get(signature)!.text).join('\n\n') })
      expect(block && 'value' in block ? block.value : '', id).toContain('\n    ')
    }
  })
})

describe('Python layouts in the rendered declaration', () => {
  const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
  const windows: Window[] = []
  afterEach(async () => {
    for (const win of windows.splice(0)) await win.happyDOM.abort()
    vi.unstubAllGlobals()
  })

  /** Compile the real parameter list and the declaration fragment of the Python branch. */
  async function declaration() {
    const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
    async function compile(relative: string, imports: Record<string, string> = {}, replacement?: string) {
      const file = new URL(relative, import.meta.url)
      const source = (replacement ?? readFileSync(file, 'utf8')).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
      const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
        resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
      expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
      let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
      for (const [specifier, href] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
      return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    }
    const bridge = 'data:text/javascript,export const { parameterId, qualifiedNameOf, signatureMultiline } = globalThis.__pythonDeclaration'
    const preview = await compile('../src/components/LinkPreview.astro', { '../lib/link-preview-card': new URL('../src/lib/link-preview-card.ts', import.meta.url).href })
    const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
    const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
    const type = await compile('../src/components/api/ApiType.astro', {
      './SymbolName.astro': name, './ApiKeyword.astro': keyword,
      '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
      '../../lib/code-layout': new URL('../src/lib/code-layout.ts', import.meta.url).href,
    })
    const parameters = await compile('../src/components/api/ApiSignatureParameters.astro', { '@libtmux/api-model': bridge, '../../lib/api-sections': bridge, './ApiType.astro': type })
    const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
    const start = source.indexOf('</span>) : <>\n') + '</span>) : <>\n'.length
    const end = source.indexOf('          </>}', start)
    expect(start).toBeGreaterThan('</span>) : <>\n'.length)
    expect(end).toBeGreaterThan(start)
    const wrapper = `---
import ApiType from './ApiType.astro'
import ApiSignatureParameters from './ApiSignatureParameters.astro'
const { symbol, index, language, keyword, prename, nameHref, value, pythonLayouts } = Astro.props
const folds = (sig) => sig.params.length >= 10
---
<>
${source.slice(start, end)}
</>`
    return (await import(/* @vite-ignore */ await compile('../src/components/api/ApiEntry.astro', { './ApiType.astro': type, './ApiSignatureParameters.astro': parameters }, wrapper))).default
  }
  let component: ReturnType<typeof declaration> | undefined

  async function render(id: string, heading: boolean) {
    vi.stubGlobal('__pythonDeclaration', { parameterId, qualifiedNameOf, signatureMultiline: () => false })
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const qualified = qualifiedNameOf(symbol)
    const prename = heading ? qualified.slice(0, qualified.length - symbol.name.length) : ''
    const pythonLayouts = new Map<Signature, PythonLayout>(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await pythonSignatureLayout(signature, { name: `${prename}${symbol.name}` })] as const)))
    const win = new Window()
    windows.push(win)
    const container = await experimental_AstroContainer.create()
    win.document.body.innerHTML = `<span class="gp-sphinx-api-signature">${await container.renderToString(await (component ??= declaration()), { props: {
      symbol, language: 'py', keyword: undefined, prename, nameHref: undefined, value: undefined, pythonLayouts,
      index: new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'py'),
    } })}</span>`
    const body = win.document.body
    const returns = body.querySelector('.sig-return-typehint')?.textContent?.trim()
    // Template whitespace between inline spans collapses; only the parameter list and typehint carry layout.
    const text = `${[...body.querySelectorAll('.sig-prename, .sig-name')].map((node) => node.textContent).join('')}${body.querySelector('.api-signature-parameters')!.textContent}${returns ? ` -> ${returns}` : ''}`
    return { symbol, pythonLayouts, text, body, layout: pythonLayouts.get(symbol.signatures[0]!)! }
  }

  /** The first single-signature symbol whose member bar takes the given layout mode. */
  async function example(mode: PythonLayout['mode']) {
    for (const symbol of model.symbols) {
      const [signature] = symbol.signatures
      if (symbol.signatures.length !== 1 || signature!.params.length >= 10 || symbol.name.startsWith('_')) continue
      if ((await pythonSignatureLayout(signature!, { name: symbol.name })).mode === mode && signature!.params.length > 1) return symbol.id
    }
    throw new Error(`No ${mode} example`)
  }

  it.each(['flat', 'hug', 'explode'] as const)('renders a %s layout with the parameters, commas and spans the page keeps', async (mode) => {
    const rendered = await render(await example(mode), false)
    const [signature] = rendered.symbol.signatures
    expect(rendered.layout.mode).toBe(mode)
    expect(rendered.text).toBe(rendered.layout.text)
    expect(rendered.body.querySelectorAll('.sig-name')).toHaveLength(1)
    expect(rendered.body.querySelectorAll('.sig-param')).toHaveLength(signature!.params.length)
    expect([...rendered.body.querySelectorAll('.sig-param .n, .sig-param a.api-parameter-name')].map((node) => node.textContent))
      .toEqual(signature!.params.map((param) => param.name))
    expect(rendered.body.querySelector('.api-signature-parameters--multiline') === null).toBe(mode === 'flat')
    const commas = [...rendered.body.querySelectorAll('.api-signature-parameters > .sig-paren')].filter((node) => node.textContent === ',')
    expect(commas).toHaveLength(mode === 'explode' ? signature!.params.length : signature!.params.length - 1)
    expect(rendered.body.querySelector('.sig-return-typehint')?.textContent?.trim()).toBe(signature!.returns)
  })

  it('keeps a broken union and its default together inside one parameter', async () => {
    const rendered = await render('libtmux.server.Server.show_prompt_history', false)
    expect(rendered.text).toBe('show_prompt_history(\n    self,\n    prompt_type: t.Literal[\n        "command", "search", "target", "window-target"\n    ]\n    | None = None,\n) -> list[str]')
    const parameter = rendered.body.querySelectorAll('.sig-param')[1]!
    expect(parameter.textContent).toBe('prompt_type: t.Literal[\n        "command", "search", "target", "window-target"\n    ]\n    | None = None')
  })

  it('shares the Markdown rows when the heading carries the same qualified name', async () => {
    for (const id of ['libtmux.hooks.HooksMixin.show_hook', 'libtmux.server.Server.show_prompt_history', await example('hug')]) {
      const rendered = await render(id, true)
      const exported = await apiSignatureLayouts(rendered.symbol, 'py')
      const [signature] = rendered.symbol.signatures
      expect(rendered.text, id).toBe(exported.get(signature!)!.text)
      expect(rendered.pythonLayouts.get(signature!)!.text, id).toBe(exported.get(signature!)!.text)
    }
  })

  it('keeps a short declaration on one line with no layout markup', async () => {
    const rendered = await render('libtmux.pane.Pane.get', false)
    expect(rendered.body.querySelector('.api-signature-parameters--multiline')).toBeNull()
    expect(rendered.text).toBe('get(self, key: str, default: t.Any | None = None) -> t.Any')
  })
})
