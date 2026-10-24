import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { parameterId, SymbolIndex, type ApiModel, type ApiSymbol, type Param } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, typeLayout, type CodeLayout, type SpanLayout } from '../src/lib/code-layout'
import { nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { formatSwiftHead, swiftTypeLayout } from '../src/lib/swift-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { referenceTree } from '../src/lib/api-tree'
import { symbolPreview } from '../src/lib/link-preview'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
afterEach(() => vi.unstubAllGlobals())

/** Run the entry's own choice between native and parameter-list rendering. */
async function rendersNatively(symbol: ApiSymbol, language: string): Promise<boolean> {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf('const signatureLayouts = await apiSignatureLayouts(symbol, language)')
  const end = source.indexOf('\n', source.indexOf('const nativeSignatures', start))
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
/** A Swift selector spells its labels, which the parameter list spells again; the declaration keeps the base name alone. */
const baseName = (symbol: ApiSymbol) => {
  const at = symbol.name.indexOf('(', 1)
  return at < 0 ? symbol.name : symbol.name.slice(0, at)
}
const flat = (symbol: ApiSymbol, signature: ApiSymbol['signatures'][number]) =>
  `${baseName(symbol)}(${signature.params.map((param) => `${param.name}: ${param.type}`).join(', ')})${signature.returns ? ` -> ${signature.returns}` : ''}`

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
        // Only the base name and its opening parenthesis cannot be broken; everything after them can.
        const nameFits = baseName(symbol).length + 1 <= CODE_COLUMNS.api
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
        expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id).toEqual([baseName(symbol)])
        // Every parameter is listed, so each parameter name links to its own anchor.
        const anchors = new Set(signature.params.map((param) => `#${encodeURIComponent(parameterId(symbol, param.name))}`))
        const local = spans.filter((span) => span.link?.href.startsWith('#'))
        expect(local.length, symbol.id).toBe(signature.params.length)
        expect(local.every((span) => anchors.has(span.link!.href)), symbol.id).toBe(true)
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

  /** What the grammar marks, as `kind:text` for each keyword and literal. */
  const roles = (layout: SpanLayout) => (layout.syntax ?? []).flatMap((range) =>
    range.kind === 'keyword' || range.kind === 'literal' ? [`${range.kind}:${layout.text.slice(range.start, range.end)}`] : [])

  it('marks the words Swift owns in a type and leaves the type names to the links', async () => {
    const symbol = callable('run(_:_:)', [
      { name: 'body', type: '@escaping (inout Self, any Hashable) async throws -> Self.Element' },
      { name: 'other', type: 'some Hashable' },
    ], 'Self')
    const layout = await layoutOf(symbol)
    expect(roles(layout)).toEqual(['keyword:@escaping', 'keyword:inout', 'literal:Self', 'keyword:any', 'keyword:async', 'keyword:throws', 'literal:Self.Element', 'keyword:some', 'literal:Self'])
    const spans = signatureSpans(layout, new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'swift'), symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.nonReference).map((span) => span.text)).toEqual(['@escaping', 'inout', 'Self', 'any', 'async', 'throws', 'Self.Element', 'some', 'Self'])
    // Hashable is a type, so it stays a reference to resolve.
    expect(spans.filter((span) => span.text === 'Hashable').every((span) => !span.nonReference)).toBe(true)
  })

  it('keeps a member of Self whole until a break separates its parts', async () => {
    const symbol = callable('apply(_:)', [{ name: 'arrayLiteral', type: 'Self.Element...' }])
    const flat = await layoutOf(symbol)
    expect(flat.text).toBe('apply(arrayLiteral: Self.Element...)')
    expect(roles(flat)).toEqual(['literal:Self.Element'])
    const original = CODE_COLUMNS.api
    try {
      Object.assign(CODE_COLUMNS, { api: 30 })
      const wrapped = await layoutOf(callable('apply(_:)', [{ name: 'arrayLiteral', type: 'Self.Element...' }]), 0)
      expect(wrapped.text).toContain('Self\n')
      expect(roles(wrapped)).toEqual(['literal:Self', 'literal:.Element'])
    } finally { Object.assign(CODE_COLUMNS, { api: original }) }
  })

  it('reads a type on its own with the roles it has in a declaration', async () => {
    const lone = swiftTypeLayout('@escaping (Self) async throws -> Result')!
    expect(lone.text).toBe('@escaping (Self) async throws -> Result')
    expect(roles(lone)).toEqual(['keyword:@escaping', 'literal:Self', 'keyword:async', 'keyword:throws'])
    expect(roles(swiftTypeLayout('Self.Element...')!)).toEqual(['literal:Self.Element'])
    expect(await typeLayout('inout Self', 'swift')).toEqual(swiftTypeLayout('inout Self'))
    // A type name alone carries no role; the reference is for the links to resolve.
    expect(roles(swiftTypeLayout('Hasher')!)).toEqual([])
    // It prints the way the declaration above it does, and text it could not keep whole has no layout.
    expect(swiftTypeLayout('[String : String]?')!.text).toBe('[String: String]?')
    expect(swiftTypeLayout('repeat each Element where Element: Sendable')).toBeUndefined()
    expect(swiftTypeLayout('`Self`')).toBeUndefined()
    expect(await typeLayout('inout Self', 'go')).toBeUndefined()
  })

  it('gives every listed parameter type the roles its declaration gives the same tokens', async () => {
    let checked = 0
    for (const symbol of model.symbols) {
      if (!symbol.signatures.length) continue
      const prepared = await apiSignatureLayouts(symbol, 'swift')
      for (const signature of symbol.signatures) {
        // A member type broken at its dot is two ranges in the declaration and one in the list.
        const whole = (layout: SpanLayout) => roles(layout).flatMap((role) => {
          const [kind, text] = role.replace(/\s+/g, '').split(':') as [string, string]
          return text.split(/(?=\.)/).map((part) => `${kind}:${part}`)
        })
        const available = new Map<string, number>()
        for (const role of whole(prepared.get(signature)!)) available.set(role, (available.get(role) ?? 0) + 1)
        for (const param of signature.params) {
          const lone = swiftTypeLayout(param.type!)
          if (!lone) continue
          expect(lone.text.replace(/\s+/g, ''), `${symbol.id} ${param.name}`).toBe(param.type!.replace(/\s+/g, ''))
          for (const role of whole(lone)) {
            available.set(role, (available.get(role) ?? 0) - 1)
            expect(available.get(role), `${symbol.id} ${param.name}: ${role}`).toBeGreaterThanOrEqual(0)
          }
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each([
    ['Server.setBuffer(_:named:)', 'setBuffer(contents: String, named: String?) -> ()'],
    ['Server.capture(_:since:limit:)', 'capture(pane: Pane, since: CaptureCursor?, limit: Int)\n    -> IncrementalCapture'],
    ['Server.connected(attachingTo:_:)', 'connected(\n    attachingTo: String,\n    body:\n        @escaping (Server, ControlSession) async throws ->\n        Result\n) -> Result'],
    ['Server.newSession(named:startDirectory:windowName:width:height:environment:shell:)', 'newSession(\n    named: String, startDirectory: String?,\n    windowName: String?, width: Int?, height: Int?,\n    environment: [String: String], shell: String?\n) -> Session'],
    ['Server.captureRange(_:startingAt:endingAt:joiningWrappedLines:maximumLines:)', 'captureRange(\n    pane: Pane, startingAt: Int?, endingAt: Int?,\n    joiningWrappedLines: Bool, maximumLines: Int\n) -> PaneCapture'],
    ['Server.init(socketName:tmuxExecutable:configurationFile:)', 'init(\n    socketName: String, tmuxExecutable: String,\n    configurationFile: String?)'],
  ])('lays out %s', async (id, expected) => {
    const symbol = modelSymbol(id)
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe(expected)
    // The shorter base name leaves every line of a long labelled declaration inside the budget.
    expect(layout.failures).toEqual([])
    expect(layout.text.split('\n').every((line) => line.length <= CODE_COLUMNS.api)).toBe(true)
  })

  it.each([
    ['Server.panes()', 'panes() -> [Pane]'],
    ['Server.windows()', 'windows() -> [Window]'],
    ['Server.windows(named:)', 'windows(named: String) -> [Window]'],
    ['Server.buffer(named:)', 'buffer(named: String?) -> String?'],
    ['Server.==(_:_:)', '==(lhs: Server, rhs: Server) -> Bool'],
    ['Server.!=(_:_:)', '!=(lhs: Self, rhs: Self) -> Bool'],
  ])('declares %s with its parentheses once', async (id, expected) => {
    const symbol = modelSymbol(id)
    const layout = await layoutOf(symbol)
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual([])
    // The name range is the base name, so the page marks `panes` and not `panes()`.
    const name = layout.syntax?.find((range) => range.kind === 'name')
    expect(layout.text.slice(name!.start, name!.end)).toBe(baseName(symbol))
  })

  it('never spells a selector inside a declaration, for every callable in the model', async () => {
    const doubled: string[] = []
    for (const symbol of model.symbols) {
      if (!symbol.signatures.length) continue
      const layouts = await apiSignatureLayouts(symbol, 'swift')
      for (const signature of symbol.signatures) {
        const text = layouts.get(signature)!.text
        // A selector is a parenthesis of bare labels, as in `(named:)`, or one parameter list straight after another.
        if (/\)\(|\((?:[A-Za-z_]\w*:)+\)/.test(text)) doubled.push(`${symbol.id}: ${text.split('\n')[0]}`)
      }
    }
    expect(doubled).toEqual([])
  })

  it('keeps the selector where it tells overloads apart', async () => {
    const plain = modelSymbol('Server.windows()')
    const labelled = modelSymbol('Server.windows(named:)')
    const panes = modelSymbol('Server.panes()')
    // The record, its address and its search and navigation rows are unchanged.
    expect([plain.name, labelled.name, panes.name]).toEqual(['windows()', 'windows(named:)', 'panes()'])
    expect([plain.slug, labelled.slug, panes.slug]).toEqual(['server-windows()', 'server-windows(named-)', 'server-panes()'])
    expect(index.resolve(panes.id)?.href).toBe('/server-panes()/')
    expect(index.resolve(plain.id)?.href).not.toBe(index.resolve(labelled.id)?.href)
    const members = referenceTree('swift').members.Server!
    expect(members.filter(([name]) => ['panes()', 'windows()', 'windows(named:)'].includes(name)).map(([name, slug, id]) => [name, slug, id]))
      .toEqual(expect.arrayContaining([
        ['panes()', 'server-panes()', 'Server.panes()'],
        ['windows()', 'server-windows()', 'Server.windows()'],
        ['windows(named:)', 'server-windows(named-)', 'Server.windows(named:)'],
      ]))
    // The hover card names the symbol by its qualified selector and carries no declaration to repeat.
    expect(symbolPreview(model, panes, 'latest')).toMatchObject({ title: 'Server.panes()', signature: undefined })
    // The two overloads stay distinct as declarations too.
    expect((await layoutOf(plain)).text).not.toBe((await layoutOf(labelled)).text)
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
