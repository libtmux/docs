import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parameterId, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans, supportsLuaSignatures } from '../src/lib/code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, renderSignatures } from './signature-fragment'

interface Fixture {
  tools: Record<string, string>
  stylua: { cases: { declaration: string; formatted: string }[] }
  cases: { id: string; name: string; flat: string; formatted: string; warns?: string[] }[]
  rejected: { id: string; flat: string; wrapped: string }[]
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/lua-luacats-layout/layout.json', import.meta.url), 'utf8')) as Fixture
const model = JSON.parse(readFileSync(new URL('../src/data/api/lua.json', import.meta.url), 'utf8')) as ApiModel

const callable = (name: string, signature: Signature, kind: ApiSymbol['kind'] = 'method'): ApiSymbol =>
  ({ id: `libtmux.Probe:${name}`, name, kind, modifiers: [], signatures: [signature], source: { file: 'probe.lua' } })
const typed = (name: string, raw: string, params: Signature['params'] = []) => callable(name, { raw, params })
async function layoutOf(symbol: ApiSymbol) {
  const result = await apiSignatureLayouts(symbol, 'lua')
  expect(result.size).toBe(symbol.signatures.length)
  return symbol.signatures.map((signature) => result.get(signature)!)
}
const withoutTrailingCommas = (text: string) => text.replace(/\s+/g, '').replace(/,(?=[)}\]])/g, '')

describe('LuaCATS function layouts', () => {
  it('reproduces the recorded layouts that lua-language-server reads as the one-line types', async () => {
    const mismatches: string[] = []
    for (const entry of fixture.cases) {
      const [layout] = await layoutOf(typed(entry.name, entry.flat))
      if (layout!.text !== entry.formatted) mismatches.push(`${entry.id}\n${layout!.text}\n--- expected\n${entry.formatted}`)
      expect(layout!.failures, entry.id).toEqual(await codeWidthFailures(entry.formatted, 'api'))
    }
    expect(mismatches).toEqual([])
    expect(fixture.cases.some((entry) => entry.formatted.includes('\n'))).toBe(true)
  })

  it('breaks only where the recorded refusals do not apply', async () => {
    // Every list that breaks ends in a comma before its own-line delimiter; a union, a generic
    // argument list and an argument name never end a line. The server refuses each of those.
    expect(fixture.rejected.length).toBeGreaterThan(0)
    const symbols = model.symbols.filter((symbol) => supportsLuaSignatures(symbol, 'lua'))
    for (const entry of [...fixture.cases.map((item) => item.formatted), ...(await Promise.all(symbols.flatMap((symbol) => layoutOf(symbol)))).flat().map((layout) => layout.text)]) {
      const lines = entry.split('\n')
      lines.forEach((line, index) => {
        if (/^[)}\]]/.test(line)) expect(lines[index - 1], entry).toMatch(/[,([{]$/)
        expect(line, entry).not.toMatch(/^\s*[|>]/)
        expect(line, entry).not.toMatch(/(?:[<|]|[A-Za-z_]:)$/)
      })
    }
  })

  it('puts one parameter on each line in declaration order, as StyLua does at the same width', async () => {
    for (const entry of fixture.stylua.cases.filter((item) => item.formatted.includes('\n'))) {
      const parameters = entry.formatted.split('\n').slice(1, -2).map((line) => line.trim().replace(/,$/, ''))
      const types = parameters.map((name, index) => `${name}${index ? '?' : ''}: libtmux.Parameter${index}Options`).join(', ')
      const [layout] = await layoutOf(typed('probe', `fun(${types}):libtmux.Request<boolean>`))
      const lines = layout!.text.split('\n')
      expect(lines[0]).toBe('probe: fun(')
      expect(lines.slice(1, -1).map((line) => line.split(/\??:/)[0]!.trim())).toEqual(parameters)
      expect(lines.slice(1, -1).every((line) => line.startsWith('  ') && !line.startsWith('   '))).toBe(true)
      expect(lines.at(-1)).toMatch(/^\)/)
    }
  })

  it('keeps a short function type on one line', async () => {
    const texts = ['fun()', 'fun(self: libtmux.Pane)', 'fun(self: libtmux.Runtime):table<string, integer>']
    for (const text of texts) expect((await layoutOf(typed('m', text)))[0]!.text).toBe(`m: ${text}`)
  })

  it('breaks a long result list after the colon, one result to a line', async () => {
    const [layout] = await layoutOf(typed('pair', 'fun(self: libtmux.Server):libtmux.VeryLongResultNameOne?, libtmux.VeryLongResultNameTwo?, libtmux.Error?'))
    expect(layout!.text).toBe('pair: fun(\n  self: libtmux.Server,\n):\n  libtmux.VeryLongResultNameOne?,\n  libtmux.VeryLongResultNameTwo?,\n  libtmux.Error?')
  })

  it('breaks nested function and table types the same way', async () => {
    const [layout] = await layoutOf(typed('watch', 'fun(self: libtmux.Watch, callback: fun(value?: libtmux.VeryLongValueType, err?: libtmux.VeryLongErrorType, extra?: string), options?: { timeout: number, nested: { deadline: number, retries: integer, backoff: number } }):boolean'))
    expect(layout!.text).toBe([
      'watch: fun(',
      '  self: libtmux.Watch,',
      '  callback: fun(',
      '    value?: libtmux.VeryLongValueType,',
      '    err?: libtmux.VeryLongErrorType,',
      '    extra?: string,',
      '  ),',
      '  options?: {',
      '    timeout: number,',
      '    nested: {',
      '      deadline: number,',
      '      retries: integer,',
      '      backoff: number,',
      '    },',
      '  },',
      '):boolean',
    ].join('\n'))
    expect(layout!.failures).toEqual([])
  })

  it('records a union or a name it cannot split instead of breaking it', async () => {
    const union = 'boolean|string|number|libtmux.HookProgram|libtmux.OptionArrayInput'
    const [layout] = await layoutOf(typed('set_option', `fun(self: libtmux.Pane, value: ${union}):boolean`))
    expect(layout!.text).toBe(`set_option: fun(\n  self: libtmux.Pane,\n  value: ${union},\n):boolean`)
    expect(layout!.failures).toEqual([{ line: 3, columns: union.length + 10, limit: 60 }])
  })

  it('writes a module function as a function type from its documented parameters', async () => {
    const symbol = callable('where', { raw: 'function', params: [
      { name: 'rows', type: '<T>[]|libtmux.Selection<T>' },
      { name: 'criteria', type: 'libtmux.CompiledQuery|libtmux.Where' },
      { name: 'schema', type: 'libtmux.QuerySchema?', default: 'nil' },
    ], returns: 'libtmux.Selection<T>' }, 'function')
    expect((await layoutOf(symbol))[0]!.text).toBe([
      'where: fun(',
      '  rows: <T>[]|libtmux.Selection<T>,',
      '  criteria: libtmux.CompiledQuery|libtmux.Where,',
      '  schema: libtmux.QuerySchema?,',
      '):libtmux.Selection<T>',
    ].join('\n'))
  })

  it('rejects text that is not a LuaCATS function type', async () => {
    for (const raw of ['fun(', 'fun(self: libtmux.Pane', 'string', 'fun(: string)', 'fun(self: {)', 'fun(self: string) extra']) {
      await expect(apiSignatureLayouts(typed('probe', raw), 'lua'), raw).rejects.toThrow(/Invalid LuaCATS function type grammar|Unsupported Lua callable type/)
    }
  })

  describe('the exported API model', () => {
    const symbols = model.symbols.filter((symbol) => supportsLuaSignatures(symbol, 'lua'))

    it('lays out every method and function inside the API width with its tokens intact', async () => {
      expect(symbols.length).toBeGreaterThan(0)
      const unrecorded: string[] = []
      const symbolIndex = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'lua')
      for (const symbol of symbols) {
        expect(usesNativeSignatures(symbol, 'lua')).toBe(true)
        const results = await layoutOf(symbol)
        results.forEach((layout, index) => {
          const signature = symbol.signatures[index]!
          expect(layout.limit).toBe(60)
          expect(signatureSpans(layout, symbolIndex, symbol, signature).map((span) => span.text).join(''), symbol.id).toBe(layout.text)
          if (signature.raw!.startsWith('fun(')) expect(withoutTrailingCommas(layout.text), symbol.id).toBe(withoutTrailingCommas(`${symbol.name}:${signature.raw}`))
          const over = layout.text.split('\n').flatMap((line, row) => line.length > 60 ? [row + 1] : [])
          if (over.join() !== layout.failures.map((failure) => failure.line).join()) unrecorded.push(`${symbol.id}: ${over}`)
        })
      }
      expect(unrecorded).toEqual([])
    })

    it('shares one layout between the page and the Markdown export', async () => {
      const wrapped = symbols.filter((symbol) => symbol.signatures.some((signature) => (signature.raw?.length ?? 0) > 60)).slice(0, 12)
      expect(wrapped.length).toBeGreaterThan(0)
      for (const symbol of [...wrapped, model.symbols.find((entry) => entry.id === 'libtmux.Server:handle')!]) {
        const texts = (await layoutOf(symbol)).map((layout) => layout.text)
        const fenced = fromMarkdown(await symbolMarkdownWithLayout({ model, symbol })).children.find((node) => node.type === 'code')
        expect(fenced?.type === 'code' && fenced.value, symbol.id).toBe(texts.join('\n\n'))
      }
    })

    it('tags the declaration, keyword, labels and generics and links the classes', async () => {
      const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'lua')
      const symbol = model.symbols.find((entry) => entry.id === 'libtmux.Runtime:spawn')!
      const [layout] = await layoutOf(symbol)
      const spans = signatureSpans(layout!, index, symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(layout!.text)
      expect(spans.find((span) => 'declarationName' in span)?.text).toBe('spawn')
      expect(spans.filter((span) => 'keyword' in span && span.keyword).map((span) => span.text)).toEqual(['fun', 'fun'])
      const literals = spans.filter((span) => 'nonReference' in span && span.nonReference && !('keyword' in span)).map((span) => span.text)
      // `body` is a parameter now; the unlisted receiver `self` stays plain.
      expect(literals).toEqual(['self', 'runtime', 'T', 'T'])
      expect(spans.filter((span) => span.link?.href === '/libtmux.Runtime/').map((span) => span.text)).toEqual(['libtmux.Runtime', 'libtmux.Runtime'])
      expect(spans.filter((span) => span.link?.href === '/libtmux.Error/').map((span) => span.text)).toEqual(['libtmux.Error'])
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['body'])
    })

    it('lists and links every parameter, documented or not', async () => {
      const symbol = model.symbols.find((entry) => entry.id === 'libtmux.Pane:move_to')!
      const documented = symbol.signatures[0]!.params.filter((param) => param.doc).map((param) => param.name)
      expect(documented).toEqual(['other'])
      const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'lua')
      const spans = signatureSpans((await layoutOf(symbol))[0]!, index, symbol, symbol.signatures[0]!)
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
        .toEqual(['other', 'options'].map((name) => [name, `#${encodeURIComponent(parameterId(symbol, name))}`]))
      expect(apiEntryFields(symbol, 'lua').params.map((param) => param.name)).toEqual(['other', 'options'])
    })

    it('renders the page declaration, with every overload, from the Markdown layout', async () => {
      const index = new SymbolIndex(model.symbols, (entry) => `/en/lua/latest/reference/${entry.slug}/`, 'lua')
      for (const id of ['libtmux.Window:set_option', 'libtmux.Server:handle']) {
        const symbol = model.symbols.find((entry) => entry.id === id)!
        const { signatures, window, layouts: prepared } = await renderSignatures(symbol, 'lua', index)
        try {
          const expected = symbol.signatures.map((signature) => prepared.get(signature)!.text)
          expect(signatures.map(displayedSignature)).toEqual(expected)
          expect(signatures.map((element) => element.getAttribute('data-code-width-status')))
            .toEqual(expected.map((text) => text.split('\n').some((line) => line.length > 60) ? 'unresolved' : 'fits'))
          expect([...window.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
          const fenced = fromMarkdown(await symbolMarkdownWithLayout({ model, symbol })).children.find((node) => node.type === 'code')
          expect(fenced?.type === 'code' && fenced.value).toBe(expected.join('\n\n'))
        } finally { await window.happyDOM.abort() }
      }
    })
  })

  it('leaves classes and fields to the generic declaration', () => {
    for (const kind of ['class', 'attribute'] as const) {
      const symbol = model.symbols.find((entry) => entry.kind === kind)!
      expect(usesNativeSignatures(symbol, 'lua')).toBe(false)
    }
  })
})
