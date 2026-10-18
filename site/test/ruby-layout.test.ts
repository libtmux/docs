import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parameterId, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans, supportsRubySignatures } from '../src/lib/code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, renderSignatures } from './signature-fragment'

interface Reference { tools: Record<string, string>; width: number; cases: { id: string; name: string; static: boolean; raw: string; reference: string; stock?: string | null }[] }
const reference = JSON.parse(readFileSync(new URL('./fixtures/ruby-rbs-layout/reference.json', import.meta.url), 'utf8')) as Reference
const model = JSON.parse(readFileSync(new URL('../src/data/api/ruby.json', import.meta.url), 'utf8')) as ApiModel

const method = (name: string, raw: string[], options: { static?: boolean; params?: Signature['params'] } = {}): ApiSymbol => ({
  id: `Probe#${name}`, name, kind: 'method', modifiers: options.static ? ['static'] : [],
  signatures: raw.map((text) => ({ raw: text, params: options.params ?? [] })), source: { file: 'probe.rb' },
})
async function layouts(symbol: ApiSymbol) {
  const result = await apiSignatureLayouts(symbol, 'ruby')
  expect(result.size).toBe(symbol.signatures.length)
  return symbol.signatures.map((signature) => result.get(signature)!)
}
/** Tokens survive layout; only the whitespace between them is the layout's. */
const compact = (text: string) => text.replace(/\s+/g, '')
const signatureText = (symbol: ApiSymbol, signature: Signature) => `def ${symbol.modifiers.includes('static') ? 'self.' : ''}${symbol.name}: ${signature.raw}`

describe('Ruby RBS layouts', () => {
  it('reproduces the syntax_tree-rbs layout of every recorded definition', async () => {
    expect(reference.width).toBe(60)
    const mismatches: string[] = []
    for (const entry of reference.cases) {
      const symbol = method(entry.name, [entry.raw], { static: entry.static })
      const [layout] = await layouts(symbol)
      if (layout!.text !== entry.reference) mismatches.push(`${entry.id}\n${layout!.text}\n--- expected\n${entry.reference}`)
    }
    expect(mismatches).toEqual([])
    expect(reference.cases.some((entry) => entry.reference.includes('\n'))).toBe(true)
  })

  it('differs from stock syntax_tree-rbs only in whitespace, parentheses, record keys and bounds', () => {
    // Stock drops `()`, adds parentheses to nested results, spells `key0:` as `:key0 =>` and loses `< Bound`.
    const significant = (text: string) => compact(text.replace(/:(\w+)\s*=>/g, '$1:').replace(/ < [^,\]]+/g, '')).replace(/[()]/g, '')
    const differing = reference.cases.filter((entry) => entry.stock !== undefined && entry.stock !== null)
    expect(differing.length).toBeGreaterThan(0)
    expect(differing.filter((entry) => significant(entry.stock!) !== significant(entry.reference)).map((entry) => entry.id)).toEqual([])
  })

  it('keeps parameters, blocks, records and brackets on separate lines when the definition does not fit', async () => {
    const [params] = await layouts(method('capture', ['(::String, ?timeout: ::Numeric, ?cancel: untyped, ?literal: bool, ?escape: bool) -> ::LibTmux::CommandResult']))
    expect(params!.text).toBe('def capture: (\n  ::String,\n  ?timeout: ::Numeric,\n  ?cancel: untyped,\n  ?literal: bool,\n  ?escape: bool\n) -> ::LibTmux::CommandResult')
    const [block] = await layouts(method('open', ['[T] (server: ::LibTmux::Server, ?parent: untyped, **untyped) { (::LibTmux::Async::Scope) -> T } -> T'], { static: true }))
    expect(block!.text).toBe('def self.open: [T] (\n  server: ::LibTmux::Server,\n  ?parent: untyped,\n  **untyped\n) {\n  (::LibTmux::Async::Scope) -> T\n} -> T')
    const [record] = await layouts(method('stats', ['() -> { total: ::Integer, windows: { active: ::Integer, hidden: ::Integer }, names: ::Array[::String] }']))
    expect(record!.text).toBe('def stats: () -> {\n  total: ::Integer,\n  windows: { active: ::Integer, hidden: ::Integer },\n  names: ::Array[::String]\n}')
    const [bracket] = await layouts(method('windows', ['() -> ::LibTmux::Selection[::LibTmux::VeryLongSnapshotNameForWindows]']))
    expect(bracket!.text).toBe('def windows: () -> ::LibTmux::Selection[\n  ::LibTmux::VeryLongSnapshotNameForWindows\n]')
    const [union] = await layouts(method('kind', ['() -> (:session | :window | :pane | :window_link | :server | :client | :buffer)']))
    expect(union!.text).toBe('def kind: () -> (\n  :session\n  | :window\n  | :pane\n  | :window_link\n  | :server\n  | :client\n  | :buffer\n)')
  })

  it('keeps an empty parameter list, keyword names and operator names as written', async () => {
    const texts = [
      [method('closed?', ['() -> bool']), 'def closed?: () -> bool'],
      [method('class', ['() -> ::Class']), 'def `class`: () -> ::Class'],
      [method('==', ['(untyped) -> bool']), 'def ==: (untyped) -> bool'],
      [method('new', ['(?) -> void'], { static: true }), 'def self.new: (?) -> void'],
      [method('call', ['-> void']), 'def call: -> void'],
    ] as const
    for (const [symbol, expected] of texts) expect((await layouts(symbol))[0]!.text).toBe(expected)
  })

  it('does not depend on the whitespace of the exported text', async () => {
    const spread = '[T]\n(\n  server: ::LibTmux::Server,\n  ?parent: untyped,\n  **untyped\n)\n{ (::LibTmux::Async::Scope) -> T }\n-> T'
    const compactForm = '[T] (server: ::LibTmux::Server, ?parent: untyped, **untyped) { (::LibTmux::Async::Scope) -> T } -> T'
    expect((await layouts(method('open', [spread], { static: true })))[0]!.text).toBe((await layouts(method('open', [compactForm], { static: true })))[0]!.text)
  })

  it('records a line that has no break left instead of splitting a name', async () => {
    const name = `::LibTmux::${'AnExtremelyLongNamespace'.repeat(3)}`
    const [layout] = await layouts(method('windows', [`(${name}) -> void`]))
    expect(layout!.text).toBe(`def windows: (\n  ${name}\n) -> void`)
    expect(layout!.failures).toEqual([{ line: 2, columns: name.length + 2, limit: 60 }])
    expect(layout!.failures).toEqual(await codeWidthFailures(layout!.text, 'api'))
  })

  it('rejects text that is not an RBS method type', async () => {
    for (const raw of ['() ->', '(::String', '() -> ::String | ::Symbol', '() { } -> void', '[T () -> T', '(::String,, ::Integer) -> void']) {
      await expect(apiSignatureLayouts(method('probe', [raw]), 'ruby'), raw).rejects.toThrow(/Invalid RBS method type grammar|Ruby/)
    }
  })

  describe('the exported API model', () => {
    const symbols = model.symbols.filter((symbol) => symbol.kind === 'method')

    it('lays out every method definition inside the API width with its tokens intact', async () => {
      const unrecorded: string[] = []
      const symbolIndex = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'ruby')
      for (const symbol of symbols) {
        expect(supportsRubySignatures(symbol, 'ruby')).toBe(true)
        expect(usesNativeSignatures(symbol, 'ruby')).toBe(true)
        const results = await layouts(symbol)
        results.forEach((layout, index) => {
          expect(layout.limit).toBe(60)
          expect(compact(layout.text), symbol.id).toBe(compact(signatureText(symbol, symbol.signatures[index]!)))
          expect(signatureSpans(layout, symbolIndex, symbol, symbol.signatures[index]!).map((span) => span.text).join(''), symbol.id).toBe(layout.text)
          const over = layout.text.split('\n').flatMap((line, row) => line.length > 60 ? [row + 1] : [])
          if (over.join() !== layout.failures.map((failure) => failure.line).join()) unrecorded.push(`${symbol.id}: ${over}`)
        })
      }
      expect(unrecorded).toEqual([])
    })

    it('shares one layout between the page, the Markdown export and a second layout pass', async () => {
      const multi = symbols.filter((symbol) => layoutsHaveBreaks(symbol)).slice(0, 12)
      expect(multi.length).toBeGreaterThan(0)
      for (const symbol of multi) {
        const texts = (await layouts(symbol)).map((layout) => layout.text)
        const markdown = await symbolMarkdownWithLayout({ model, symbol })
        const fenced = fromMarkdown(markdown).children.find((node) => node.type === 'code')
        expect(fenced?.type === 'code' && fenced.value, symbol.id).toBe(texts.join('\n\n'))
        const again = method(symbol.name, symbol.signatures.map((signature) => texts[symbol.signatures.indexOf(signature)]!.replace(/^def (?:self\.)?\S+?: /, '')),
          { static: symbol.modifiers.includes('static') })
        expect((await layouts(again)).map((layout) => layout.text)).toEqual(texts)
      }
    })

    function layoutsHaveBreaks(symbol: ApiSymbol): boolean {
      return symbol.signatures.some((signature) => (signature.raw?.length ?? 0) > 70)
    }

    it('tags the declaration, keyword names and type variables and links classes', async () => {
      const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'ruby')
      const symbol = model.symbols.find((entry) => entry.id === 'LibTmux::Async::Server#new_session')!
      const [layout] = await layouts(symbol)
      const spans = signatureSpans(layout!, index, symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(layout!.text)
      expect(spans[0]).toMatchObject({ text: 'def', keyword: true, nonReference: true })
      expect(spans.find((span) => 'declarationName' in span)?.text).toBe('new_session')
      const names = spans.filter((span) => 'nonReference' in span && span.nonReference && !('keyword' in span)).map((span) => span.text)
      expect(names).toContain('name')
      expect(names).toContain('cancel')
      expect(spans.filter((span) => span.link?.href === '/LibTmux::CreationReceipt/').map((span) => span.text)).toEqual(['LibTmux::CreationReceipt'])
      expect(spans.some((span) => span.link?.href.startsWith('#'))).toBe(false)
      const generic = model.symbols.find((entry) => entry.id === 'LibTmux::Selection#filter')!
      const type = signatureSpans((await layouts(generic))[0]!, index, generic, generic.signatures[0]!)
      expect(type.filter((span) => span.text === 'Elem').every((span) => 'nonReference' in span && span.nonReference)).toBe(true)
    })

    it('links a documented keyword parameter to its anchor and no other', async () => {
      const symbol = method('capture', ['(?start: ::Integer, ?finish: ::Integer) -> ::String'], {
        params: [{ name: 'start', type: '::Integer', doc: 'First row.' }, { name: 'finish', type: '::Integer' }],
      })
      const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'ruby')
      const spans = signatureSpans((await layouts(symbol))[0]!, index, symbol, symbol.signatures[0]!)
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
        .toEqual([['start', `#${encodeURIComponent(parameterId(symbol, 'start'))}`]])
      expect(apiEntryFields(symbol, 'ruby').params.map((param) => param.name)).toEqual(['start'])
    })

    it('renders the page declaration and the Markdown export from one layout', async () => {
      const symbol = model.symbols.find((entry) => entry.id === 'LibTmux::Async::Server#new_session')!
      expect(symbol.signatures).toHaveLength(2)
      const index = new SymbolIndex(model.symbols, (entry) => `/en/ruby/latest/reference/${entry.slug}/`, 'ruby')
      const { signatures, window, layouts: prepared } = await renderSignatures(symbol, 'ruby', index)
      try {
        const expected = symbol.signatures.map((signature) => prepared.get(signature)!.text)
        expect(signatures.map(displayedSignature)).toEqual(expected)
        expect(signatures.map((element) => element.getAttribute('data-code-columns'))).toEqual(['60', '60'])
        expect(signatures.map((element) => element.getAttribute('data-code-width-status'))).toEqual(['fits', 'fits'])
        expect(signatures[1]!.querySelector('a[href="/en/ruby/latest/reference/' + model.symbols.find((entry) => entry.id === 'LibTmux::Session')!.slug + '/"]')?.textContent).toBe('LibTmux::Session')
        expect([...window.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
        const markdown = await symbolMarkdownWithLayout({ model, symbol })
        const fenced = fromMarkdown(markdown).children.find((node) => node.type === 'code')
        expect(fenced?.type === 'code' && fenced.value).toBe(expected.join('\n\n'))
      } finally { await window.happyDOM.abort() }
    })
  })

  it('leaves the classes and modules of the model to the generic declaration', () => {
    const owner = model.symbols.find((entry) => entry.kind === 'class')!
    expect(usesNativeSignatures(owner, 'ruby')).toBe(false)
    expect(supportsRubySignatures(owner, 'ruby')).toBe(false)
  })
})
