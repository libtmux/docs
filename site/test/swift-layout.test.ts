import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { SymbolIndex, type ApiModel, type ApiSymbol, type Param } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, type CodeLayout } from '../src/lib/code-layout'
import { nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { formatSwiftHead } from '../src/lib/swift-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
afterEach(() => vi.unstubAllGlobals())

/** Run the entry's own choice between native and parameter-list rendering. */
async function rendersNatively(symbol: ApiSymbol, language: string): Promise<boolean> {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf('const signatureLayouts = await apiSignatureLayouts(symbol, language)')
  const end = source.indexOf('\n\n/**', source.indexOf('const nativeSignatures', start))
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  vi.stubGlobal('__swiftEntryHelpers', { apiSignatureLayouts, nativeSignatureText, usesNativeSignatures })
  const helpers = 'data:text/javascript,export const { apiSignatureLayouts, nativeSignatureText, usesNativeSignatures } = globalThis.__swiftEntryHelpers'
  const wrapper = `---\nimport { apiSignatureLayouts } from '../../lib/code-layout'\nimport { nativeSignatureText as unformattedNativeSignatureText, usesNativeSignatures } from '../../lib/api-sections'\nconst { symbol, language } = Astro.props\n${source.slice(start, end)}\n---\n<span data-native={String(nativeSignatures)} />`
  const result = await transform(wrapper, { filename: 'Probe.astro', internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
  let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
  code = code.replaceAll(JSON.stringify('../../lib/code-layout'), JSON.stringify(helpers)).replaceAll(JSON.stringify('../../lib/api-sections'), JSON.stringify(helpers))
  const component = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
  const html = await (await experimental_AstroContainer.create()).renderToString(component, { props: { symbol, language } })
  return /data-native="true"/.test(html)
}

const model = JSON.parse(readFileSync(new URL('../src/data/api/swift.json', import.meta.url), 'utf8')) as ApiModel
const fixture = JSON.parse(readFileSync(new URL('./fixtures/swift-format-layout.json', import.meta.url), 'utf8')) as {
  cases: { group: string; columns: number; nameWidth: number; parameters: { name: string; type: string }[]; returns?: string; text: string }[]
}
const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, 'swift')

const callable = (name: string, params: Param[], returns?: string): ApiSymbol => ({
  id: `Target.${name}`, name, kind: 'method', parent: 'Target', modifiers: [],
  signatures: [{ params, ...(returns ? { returns } : {}) }], source: { file: 'probe.swift' },
})
const layoutOf = async (symbol: ApiSymbol, overload = 0): Promise<CodeLayout> => {
  const layout = (await apiSignatureLayouts(symbol, 'swift')).get(symbol.signatures[overload]!)
  expect(layout).toBeDefined()
  return layout!
}
const modelSymbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
const flat = (symbol: ApiSymbol, signature: ApiSymbol['signatures'][number]) =>
  `${symbol.name}(${signature.params.map((param) => `${param.name}: ${param.type}`).join(', ')})${signature.returns ? ` -> ${signature.returns}` : ''}`

describe('Swift layouts reproduce pinned swift-format output', () => {
  it.each([...new Set(fixture.cases.map((entry) => `${entry.group}@${entry.columns}`))])('matches the %s cases', (selection) => {
    const [group, columns] = selection.split('@')
    const cases = fixture.cases.filter((entry) => entry.group === group && entry.columns === Number(columns))
    expect(cases.length).toBeGreaterThan(0)
    const failed = cases.flatMap((entry) => {
      const text = formatSwiftHead({
        keyword: 'func', name: 'x'.repeat(entry.nameWidth), parameters: entry.parameters, ...(entry.returns === undefined ? {} : { returns: entry.returns }),
      }, entry.columns)
      return text === entry.text ? [] : [{ parameters: entry.parameters, returns: entry.returns, expected: entry.text, actual: text }]
    })
    expect(failed).toEqual([])
  })

  it('keeps a variadic parameter and its member type together as swift-format does', () => {
    const head = { keyword: 'func', name: 'x'.repeat(19), parameters: [{ name: 'arrayLiteral', type: 'Self.Element...' }] }
    expect(formatSwiftHead(head, 30)).toBe('func xxxxxxxxxxxxxxxxxxx(\n    arrayLiteral: Self\n        .Element...)')
  })

  it('is sensitive to the budget, so the fixture exercises the printer', () => {
    const wrapped = fixture.cases.filter((entry) => entry.columns === 60 && entry.text.includes('\n'))
    expect(wrapped.length).toBeGreaterThan(0)
    for (const entry of wrapped) {
      const head = { keyword: 'func', name: 'x'.repeat(entry.nameWidth), parameters: entry.parameters, ...(entry.returns === undefined ? {} : { returns: entry.returns }) }
      expect(formatSwiftHead(head, 400)).not.toBe(entry.text)
    }
  })
})

describe('Swift callable layouts', () => {
  it('lays out every rendered declaration within the API budget or records the indivisible name', async () => {
    let checked = 0
    const wrapped: string[] = []
    for (const symbol of model.symbols) {
      if (!symbol.signatures.length) continue
      const layouts = await apiSignatureLayouts(symbol, 'swift')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        expect(layout, symbol.id).toBeDefined()
        checked++
        expect(layout.limit).toBe(CODE_COLUMNS.api)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        // Only the name and its opening parenthesis cannot be broken; everything after them can.
        const nameFits = symbol.name.length + 1 <= CODE_COLUMNS.api
        expect(layout.failures.length === 0, symbol.id).toBe(nameFits)
        if (!nameFits) expect(layout.failures.map((failure) => failure.line), symbol.id).toEqual([1])
        // Only whitespace changes, so tokens, punctuation and names stay intact.
        expect(layout.text.replace(/\s+/g, ''), symbol.id).toBe(flat(symbol, signature).replace(/\s+/g, ''))
        if (layout.text.includes('\n')) wrapped.push(symbol.id)
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(wrapped.length).toBeGreaterThan(0)
  })

  it('keeps the declared name and every type reference the page links today', async () => {
    for (const symbol of model.symbols) {
      if (!symbol.signatures.length) continue
      const layouts = await apiSignatureLayouts(symbol, 'swift')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        const spans = signatureSpans(layout, index, symbol, signature)
        expect(spans.map((span) => span.text).join(''), symbol.id).toBe(layout.text)
        expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id).toEqual([symbol.name])
        // Undocumented parameters have no anchor to link to.
        expect(spans.filter((span) => span.link?.href.startsWith('#')), symbol.id).toEqual([])
        const links = (parts: { text: string; link?: { href: string } }[]) => parts.flatMap((part) => part.link ? [`${part.text}|${part.link.href}`] : [])
        const before = links([...signature.params.flatMap((param) => index.linkType(param.type!, symbol, signature)), ...(signature.returns ? index.linkType(signature.returns, symbol, signature) : [])])
        const after = links(spans)
        // A member type broken at its dot links its base and its member separately.
        const parts = new Set(after)
        for (const link of before) {
          const [text, href] = link.split('|') as [string, string]
          expect(parts.has(link) || (text.includes('.') && parts.has(`${text.split('.').at(-1)}|${href}`)), `${symbol.id} ${link}`).toBe(true)
        }
      }
    }
  })

  it.each([
    ['Server.setBuffer(_:named:)', 'setBuffer(_:named:)(contents: String, named: String?) -> ()'],
    ['Server.capture(_:since:limit:)', 'capture(_:since:limit:)(\n    pane: Pane, since: CaptureCursor?, limit: Int\n) -> IncrementalCapture'],
    ['Server.connected(attachingTo:_:)', 'connected(attachingTo:_:)(\n    attachingTo: String,\n    body:\n        @escaping (Server, ControlSession) async throws ->\n        Result\n) -> Result'],
    ['Server.newSession(named:startDirectory:windowName:width:height:environment:shell:)', 'newSession(named:startDirectory:windowName:width:height:environment:shell:)(\n    named: String, startDirectory: String?,\n    windowName: String?, width: Int?, height: Int?,\n    environment: [String: String], shell: String?\n) -> Session'],
  ])('lays out %s', async (id, expected) => {
    const symbol = modelSymbol(id)
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual(layout.text.split('\n').some((line) => line.length > CODE_COLUMNS.api)
      ? [{ line: 1, columns: layout.text.split('\n')[0]!.length, limit: CODE_COLUMNS.api }] : [])
  })

  it('exports the same declarations in Markdown for an overload set', async () => {
    const symbol = model.symbols.find((entry) => entry.signatures.length > 1)!
    const layouts = await apiSignatureLayouts(symbol, 'swift')
    const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(symbol.signatures.map((signature) => layouts.get(signature)!.text).join('\n\n'))
  })

  it('keeps an unparsed type whole and follows the shared budget', async () => {
    const odd = 'repeat each Element where Element: Sendable'
    const symbol = callable('apply(_:)', [{ name: 'value', type: odd }, { name: 'other', type: 'Int' }], 'Void')
    const original = CODE_COLUMNS.api
    try {
      for (const limit of [20, 40, 60, 90]) {
        Object.assign(CODE_COLUMNS, { api: limit })
        const layout = await layoutOf(symbol)
        expect(layout.limit).toBe(limit)
        expect(layout.text).toContain(odd)
        expect(layout.text.replace(/\s+/g, '')).toBe(flat(symbol, symbol.signatures[0]!).replace(/\s+/g, ''))
        expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
      }
    } finally { Object.assign(CODE_COLUMNS, { api: original }) }
  })

  it.each([
    [{ name: 'values', type: 'Int', variadic: 'positional' as const }],
    [{ name: 'count', type: 'Int', default: '1' }],
    [{ name: 'maybe', type: 'Int', optional: true }],
    [{ name: 'untyped' }],
  ])('leaves %j to the unformatted reference rendering', async (param) => {
    const symbol = callable('apply(_:)', [param])
    expect(await apiSignatureLayouts(symbol, 'swift')).toEqual(new Map())
  })

  it('renders a laid out callable natively without changing which parameters the reference lists', async () => {
    const symbol = modelSymbol('Server.capture(_:since:limit:)')
    expect((await apiSignatureLayouts(symbol, 'swift')).size).toBe(1)
    expect(usesNativeSignatures(symbol, 'swift')).toBe(false)
    expect(await rendersNatively(symbol, 'swift')).toBe(true)
    expect(await rendersNatively(modelSymbol('TmuxBuffer.name'), 'swift')).toBe(false)
    expect(await rendersNatively(callable('apply(_:)', [{ name: 'count', type: 'Int', default: '1' }]), 'swift')).toBe(false)
  })

  it('leaves a laid out Python callable on its parameter-list rendering', async () => {
    const python = JSON.parse(readFileSync(new URL('../src/data/api/py.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = python.symbols.find((entry) => entry.id === 'libtmux.server.Server.new_session')!
    expect((await apiSignatureLayouts(symbol, 'py')).size).toBeGreaterThan(0)
    expect(await rendersNatively(symbol, 'py')).toBe(false)
  })
})
