import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
import { API_MODELS, createApiIndex } from '../src/lib/api-models'
import registry from '../src/data/registry.json'
import { apiComponents } from './api-components'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { extractSourceWithSpec } from '../../packages/api-model/src/languages/spec'
import { RUST } from '../../packages/api-model/src/languages/specs'

const method = (raw: string, params: Signature['params'] = [], name = 'method'): ApiSymbol => ({
  id: `server.Server.${name}`, name, kind: 'method', parent: 'server.Server', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'server.rs' },
})

const layoutFor = async (symbol: ApiSymbol) => {
  const layout = (await apiSignatureLayouts(symbol, 'rs')).get(symbol.signatures[0]!)
  expect(layout).toBeDefined()
  return layout!
}

describe('Rust callable layouts', () => {
  it('breaks the pinned must-use attribute without changing its literal or member links', async () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'command.Command.new')!
    const signature = symbol.signatures[0]!
    const raw = signature.raw
    const source = { ...signature.source }
    const layout = await layoutFor(symbol)
    expect(layout.failures).toEqual([])
    expect(layout.text).toBe('#[must_use =\n    "a command has no effect until it is dispatched"\n]\npub fn new(subcommand: impl Into<OsString>) -> Self')
    expect(signature.raw).toBe(raw)
    expect(signature.source).toEqual(source)
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['new'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
      .toEqual(['#command.Command.new.parameter.subcommand'])
    // The attribute is its punctuation, its path and its string, none of them a reference.
    expect(spans.filter((span) => span.role).map((span) => [span.text, span.role, span.nonReference])).toEqual([
      ['#[', 'delimiter', true], ['must_use', 'attribute', true], ['=', 'delimiter', true],
      ['"a command has no effect until it is dispatched"', 'string', true], [']', 'delimiter', true],
    ])
    const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(layout.text)
    const parser = await parserFor('rust')
    const before = parser.parse(`${raw} {}`)!
    const after = parser.parse(`${layout.text} {}`)!
    try {
      expect(after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
    } finally { before.delete(); after.delete(); parser.delete() }
    const again = { ...signature, raw: layout.text }
    expect((await apiSignatureLayouts({ ...symbol, signatures: [again] }, 'rs')).get(again)!.text).toBe(layout.text)
  })

  it.each([
    '"Target retains all words and  exact spaces here."',
    'r#"Target retains all words and  exact spaces here."#',
  ])('keeps string attribute contents opaque while breaking %s', async (literal) => {
    const symbols = await extractSourceWithSpec(RUST, `pub struct Target;\n#[must_use = ${literal}]\npub fn method(value: Target) -> Target {}`, 'probe.rs', 'probe')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    const layout = await layoutFor(symbol)
    expect(layout.failures).toEqual([])
    expect(layout.text).toContain(`#[must_use =\n    ${literal}\n]`)
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href === '/probe.Target/')).toHaveLength(2)
    const attribute = spans.find((span) => span.text.includes(literal))
    expect(attribute).toMatchObject({ nonReference: true })
    expect(attribute?.link).toBeUndefined()
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
  })

  it('prepares both pinned specialized Slot contexts without displayed bodies or invented punctuation', async () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'plan.Slot.pane')!
    const layouts = await apiSignatureLayouts(symbol, 'rs')
    const expected = ['SessionSlot', 'WindowSlot'].map((owner) =>
      `impl Slot<${owner}>\n#[must_use]\npub const fn pane(self) -> Slot<PaneSlot>`)
    expect([...layouts.values()].map((layout) => layout.text)).toEqual(expected)
    expect(symbol.signatures.map((signature) => signature.source?.line)).toEqual([414, 422])
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'rs')
    for (const signature of symbol.signatures) {
      const layout = layouts.get(signature)!
      const spans = signatureSpans(layout, index, symbol, signature)
      expect(spans.filter((span) => span.enclosingContext).map((span) => span.text).join(''))
        .toBe(`${signature.enclosingDeclaration}\n`)
      expect(spans.some((span) => span.enclosingContext && span.link?.href === '/plan.Slot/')).toBe(true)
      expect(layout.failures).toEqual([])
    }
    const markdown = await symbolMarkdownWithLayout({ model, symbol })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(expected.join('\n\n'))
  })

  it('wraps a native async hook header at 60 columns with shared Markdown and parameter links, leaving the receiver plain', async () => {
    const symbol = method('pub async fn set_hook(&self, name: &str, command: impl Into<OsString>) -> Result<(), Error>', [
      { name: '&self' }, { name: 'name', type: '&str' }, { name: 'command', type: 'impl Into<OsString>' },
    ], 'set_hook')
    const layout = await layoutFor(symbol)
    const expected = 'pub async fn set_hook(\n    &self,\n    name: &str,\n    command: impl Into<OsString>\n) -> Result<(), Error>'
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual([])
    expect(layout.limit).toBe(60)
    expect(usesNativeSignatures(symbol, 'rs')).toBe(true)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.map((span) => span.text).join('')).toBe(expected)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(['set_hook'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href])).toEqual([
      ['name', '#server.Server.set_hook.parameter.name'],
      ['command', '#server.Server.set_hook.parameter.command'],
    ])
    expect(apiEntryFields(symbol, 'rs').params.map((param) => param.name)).toEqual(['name', 'command'])
    const document = await symbolMarkdownWithLayout({ model: { port: 'rs', extractor: 'fixture', symbols: [symbol] }, symbol, index })
    const signature = fromMarkdown(document).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(expected)
    expect(CODE_COLUMNS).toEqual({ api: 60, example: 80 })
    expect(await codeWidthFailures(expected, 'api')).toEqual([])
    const parser = await parserFor('rust')
    const input = parser.parse(`${symbol.signatures[0]!.raw} {}`)!
    const output = parser.parse(`${layout.text} {}`)!
    try {
      expect(output.rootNode.hasError).toBe(false)
      expect(output.rootNode.toString()).toBe(input.rootNode.toString())
    } finally { input.delete(); output.delete(); parser.delete() }
  })

  it.each(['mut self', '&self', '&mut self', "&'a self"])('leaves an undocumented `%s` receiver plain, like `self`', async (receiver) => {
    const symbol = method(`pub fn kill(${receiver}, reason: &str) -> Result<(), Error>`, [
      { name: receiver }, { name: 'reason', type: '&str' },
    ], 'kill')
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(apiEntryFields(symbol, 'rs').params.map((param) => param.name)).toEqual(['reason'])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
      .toEqual(['#server.Server.kill.parameter.reason'])
    expect(spans.find((span) => span.text === receiver)).toMatchObject({ keyword: true })
  })

  it('links only the parameters the entry lists, leaving an undocumented self receiver plain', async () => {
    const symbol = method('pub fn kill(self, reason: &str) -> Result<(), Error>', [
      { name: 'self' }, { name: 'reason', type: '&str' },
    ], 'kill')
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    const anchors = spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href)
    expect(apiEntryFields(symbol, 'rs').params.map((param) => param.name)).toEqual(['reason'])
    expect(anchors).toEqual(['#server.Server.kill.parameter.reason'])
  })
})

const extract = (source: string) => extractSourceWithSpec(RUST, source, 'probe.rs', 'probe')

describe('Rust attributes in a signature', () => {
  const roles = (spans: ReturnType<typeof signatureSpans>) => spans.filter((span) => span.role).map((span) => [span.text, span.role])
  const spansOf = async (raw: string, declared: ApiSymbol[] = [], params: Signature['params'] = []) => {
    const symbol = method(raw, params)
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol, ...declared], (entry) => `/${entry.id}/`, 'rs')
    return { symbol, layout, spans: signatureSpans(layout, index, symbol, symbol.signatures[0]!), index }
  }

  it('reads `#[must_use]` as punctuation around an attribute', async () => {
    const { layout, spans } = await spansOf('#[must_use]\npub fn method()')
    expect(roles(spans)).toEqual([['#[', 'delimiter'], ['must_use', 'attribute'], [']', 'delimiter']])
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
  })

  it('reads a cfg predicate as an attribute, a quiet name and operator, and a string', async () => {
    const { layout, spans } = await spansOf('#[cfg(feature = "control-mode")]\npub fn method()')
    expect(layout.text).toBe('#[cfg(feature = "control-mode")]\npub fn method()')
    expect(roles(spans)).toEqual([
      ['#[', 'delimiter'], ['cfg', 'attribute'], ['(', 'delimiter'], ['=', 'delimiter'], ['"control-mode"', 'string'], [')]', 'delimiter'],
    ])
    // `feature` is a word of the predicate, not a role of its own, and the rest of the line keeps its keywords.
    expect(spans.find((span) => span.text === 'feature')).toMatchObject({ nonReference: true })
    expect(spans.find((span) => span.text === 'feature')?.role).toBeUndefined()
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(['pub', 'fn'])
  })

  it('takes the whole path of a scoped attribute and every string of its arguments', async () => {
    const { spans } = await spansOf('#[tool_router(router = contract_router, vis = "pub(super)")]\n#[clippy::must_use]\n#[doc = r#"raw"#]\npub fn method()')
    expect(roles(spans)).toEqual([
      ['#[', 'delimiter'], ['tool_router', 'attribute'], ['(', 'delimiter'], ['=', 'delimiter'], [',', 'delimiter'], ['=', 'delimiter'],
      ['"pub(super)"', 'string'], [')]', 'delimiter'],
      ['#[', 'delimiter'], ['clippy::must_use', 'attribute'], [']', 'delimiter'],
      ['#[', 'delimiter'], ['doc', 'attribute'], ['=', 'delimiter'], ['r#"raw"#', 'string'], [']', 'delimiter'],
    ])
  })

  it('links nothing inside an attribute, whatever its words name', async () => {
    const pane = { ...method('pub struct Pane', [], 'Pane'), id: 'server.Pane', name: 'Pane', kind: 'struct' as const, signatures: [] }
    const { spans } = await spansOf('#[tool(description = "Pane", meta = Pane, other = crate::Pane)]\npub fn method(pane: Pane)', [pane], [{ name: 'pane', type: 'Pane' }])
    const attribute = spans.slice(0, spans.findIndex((span) => span.text === 'pub'))
    expect(attribute.filter((span) => span.link)).toEqual([])
    expect(spans.filter((span) => span.link?.href === '/server.Pane/')).toHaveLength(1)
  })

  it('keeps the copy text and the Markdown signature as they were', async () => {
    const raw = '#[cfg(feature = "control-mode")]\n#[must_use = "use the returned builder to retain the limits"]\npub fn method(value: u8) -> u8'
    const symbol = method(raw, [{ name: 'value', type: 'u8' }])
    const layout = await layoutFor(symbol)
    const model = { port: 'rs', extractor: 'test', symbols: [symbol] } as ApiModel
    const markdown = await symbolMarkdownWithLayout({ model, symbol })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(layout.text)
    expect(layout.text).toBe('#[cfg(feature = "control-mode")]\n#[must_use =\n    "use the returned builder to retain the limits"\n]\npub fn method(value: u8) -> u8')
  })

  it('draws each role in its own class, none of them a plain name the type-link check would count', async () => {
    const { symbol, layout, index } = await spansOf('#[cfg(feature = "control-mode")]\npub fn method()')
    const { type } = await apiComponents()
    const win = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      win.document.body.innerHTML = await container.renderToString(type, { props: { type: layout.text, index, context: symbol, signature: symbol.signatures[0], layout } })
      const drawn = [...win.document.querySelectorAll('.api-type > span')].filter((node) => /\bapi-(delimiter|attribute|string)\b/.test(node.className))
        .map((node) => [node.textContent, node.className, node.getAttribute('data-api-role')])
      expect(drawn).toEqual([
        ['#[', 'api-delimiter', 'syntax'], ['cfg', 'api-attribute', 'syntax'], ['(', 'api-delimiter', 'syntax'], ['=', 'api-delimiter', 'syntax'],
        ['"control-mode"', 'api-string', 'syntax'], [')]', 'api-delimiter', 'syntax'],
      ])
      expect(win.document.querySelector('.api-type')?.textContent).toBe(layout.text)
    } finally { await win.happyDOM.abort() }
  })
})

describe('a Cargo feature named in a Rust attribute', () => {
  const sources = [{ product: 'core' as const, package: 'libtmux', repo: 'libtmux/libtmux-rs', features: ['control-mode', 'query', '_internal'] }]
  const feature = (name: string) => `https://docs.rs/crate/libtmux/latest/features#${name}`
  const spansOf = async (raw: string) => {
    const symbol = { ...method(raw), product: 'core' as const }
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    index.addCargoFeatures(sources, () => 'latest')
    return { layout, spans: signatureSpans(layout, index, symbol, symbol.signatures[0]!) }
  }
  /** The text and destination of each span that links to docs.rs. */
  const links = (spans: Awaited<ReturnType<typeof spansOf>>['spans']) => spans.filter((span) => span.link?.href.startsWith('https://docs.rs/')).map((span) => [span.text, span.link!.href])

  it('links the name inside its quotes to the crate\'s features page, and leaves the quotes a string', async () => {
    const { layout, spans } = await spansOf('#[cfg(feature = "control-mode")]\npub fn method()')
    expect(links(spans)).toEqual([['control-mode', feature('control-mode')]])
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.role === 'string').map((span) => span.text)).toEqual(['"', 'control-mode', '"'])
    expect(spans.find((span) => span.text === 'control-mode')).toMatchObject({ nonReference: true, link: { external: true } })
  })

  it('links every feature of a predicate and one nested in doc(cfg(...))', async () => {
    const { spans } = await spansOf('#[cfg(all(feature = "control-mode", not(feature = "query")))]\n#[cfg_attr(docsrs, doc(cfg(feature = "query")))]\npub fn method()')
    expect(links(spans)).toEqual([['control-mode', feature('control-mode')], ['query', feature('query')], ['query', feature('query')]])
  })

  it.each([
    ['a feature the crate does not declare', '#[cfg(feature = "native")]'],
    ['a private feature the list holds, which docs.rs shows no anchor for', '#[cfg(feature = "_internal")]'],
    ['a name that is not behind feature =', '#[cfg(target_os = "query")]'],
    ['a feature outside a cfg', '#[tool(feature = "query")]'],
    ['a raw string', '#[cfg(feature = r#"query"#)]'],
    ['an escaped string', '#[cfg(feature = "qu\\u{65}ry")]'],
    ['an attribute value', '#[must_use = "query"]'],
  ])('links nothing for %s', async (_, attribute) => {
    const { layout, spans } = await spansOf(`${attribute}\npub fn method()`)
    expect(links(spans)).toEqual([])
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
  })

  it('draws the link as a docs.rs link in the string, outside the type-link count', async () => {
    const symbol = { ...method('#[cfg(feature = "control-mode")]\npub fn method()'), product: 'core' as const }
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'rs')
    index.addCargoFeatures(sources, () => 'latest')
    const { type } = await apiComponents()
    const win = new Window()
    try {
      const container = await experimental_AstroContainer.create()
      win.document.body.innerHTML = await container.renderToString(type, { props: { type: layout.text, index, context: symbol, signature: symbol.signatures[0], layout } })
      const link = win.document.querySelector('a')!
      expect([link.textContent, link.getAttribute('href'), link.getAttribute('rel'), link.getAttribute('title')]).toEqual(
        ['control-mode', feature('control-mode'), 'nofollow noopener', 'control-mode (docs.rs features)'])
      // Two classes: scripts/check-type-links.mjs counts an anchor with `api-type-link` alone as a resolved type.
      expect(link.className.split(/\s+/).sort()).toEqual(['api-string', 'api-type-link'])
      expect(win.document.querySelector('.api-type')?.textContent).toBe(layout.text)
    } finally { await win.happyDOM.abort() }
  })

  describe('in the port\'s index', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const model = API_MODELS.rs
    const source = (product: 'core' | 'workspace') => model.sources!.find((entry) => entry.product === product)!
    const [core, workspace] = [source('core'), source('workspace')]
    const stream = model.symbols.find((entry) => entry.id === 'pane.Pane.stream_output_with_limits')!
    const inWorkspace = model.symbols.find((entry) => entry.product === 'workspace')!
    // A feature each crate declares, whichever its manifest holds first.
    const [coreFeature, workspaceFeature] = [core.features![0]!, workspace.features![0]!]
    const page = (crate: string, version: string, name: string) => `https://docs.rs/crate/${crate}/${version}/features#${name}`
    const featureOf = (name: string, symbol = stream, from = model) => createApiIndex(from, (entry) => `/${entry.id}/`).cargoFeature(name, symbol)?.href
    /** The Rust model with each crate's version replaced. */
    const versioned = (versions: Partial<Record<'core' | 'workspace', string>>) =>
      ({ ...model, sources: model.sources!.map((entry) => ({ ...entry, version: versions[entry.product as 'core' | 'workspace'] ?? entry.version })) })
    const build = (version: string, kind: string) => {
      vi.stubEnv('LIBTMUX_DOCS_VERSION', version)
      vi.stubEnv('LIBTMUX_DOCS_VERSION_KIND', kind)
    }

    it('takes the crates\' features from the model and links to latest on a trunk build', () => {
      expect(featureOf(coreFeature)).toBe(page(core.package, 'latest', coreFeature))
      expect(featureOf('not-a-feature')).toBeUndefined()
      expect(featureOf(workspaceFeature, inWorkspace)).toBe(page(workspace.package, 'latest', workspaceFeature))
    })

    it('names the version each crate declares on a release build, as the crates of one repository carry their own', () => {
      build('v0.1.0-alpha.15', 'tag')
      const apart = versioned({ core: '1.2.3', workspace: '4.5.6' })
      expect(featureOf(coreFeature, stream, apart)).toBe(page(core.package, '1.2.3', coreFeature))
      expect(featureOf(workspaceFeature, inWorkspace, apart)).toBe(page(workspace.package, '4.5.6', workspaceFeature))
      // The docs slug names neither: the crate's own version is what docs.rs carries.
      expect(featureOf(coreFeature)).toBe(page(core.package, core.version!, coreFeature))
    })

    it('names the version `next` resolves to only when the registry carries it', () => {
      const published = registry.ports.rs!.version!
      build('next', 'alias')
      expect(featureOf(coreFeature, stream, versioned({ core: published }))).toBe(page(core.package, published, coreFeature))
      expect(featureOf(coreFeature, stream, versioned({ core: '99.0.0-alpha.1' }))).toBe(page(core.package, 'latest', coreFeature))
      // A crate the registry lists no package for has no published version to match.
      expect(featureOf(workspaceFeature, inWorkspace, versioned({ workspace: published }))).toBe(page(workspace.package, 'latest', workspaceFeature))
    })

    it.each([['latest', 'trunk'], ['v0.x', 'branch'], ['pr-12', 'pr']])('names the registry\'s newest on the %s build (%s), whatever the crate declares', (version, kind) => {
      build(version, kind)
      expect(featureOf(coreFeature, stream, versioned({ core: registry.ports.rs!.version! }))).toBe(page(core.package, 'latest', coreFeature))
    })

    it('has no features to link for a port whose crates do not declare any', () => {
      const go = API_MODELS.go
      expect(createApiIndex(go, (entry) => `/${entry.id}/`).cargoFeature('control-mode', go.symbols[0]!)).toBeUndefined()
    })

    it('finds every feature the Rust signatures name among its crate\'s own, so a name never stays plain for want of a list', () => {
      const declared = new Map(model.sources!.map((source) => [source.product, new Set(source.features)]))
      const named = model.symbols.flatMap((entry) => entry.signatures.flatMap((signature) => [signature.raw, signature.enclosingDeclaration])
        .flatMap((text) => [...(text ?? '').matchAll(/#\[cfg(?:_attr)?\([^\n]*?feature\s*=\s*"([^"\\]+)"/g)].map((match) => [entry.product, match[1]!, entry.id])))
      expect(named.length).toBeGreaterThan(10)
      expect(named.filter(([product, name]) => !declared.get(product as never)?.has(name!)).map(([, name, id]) => `${id}: ${name}`)).toEqual([])
    })
  })
})

describe('Rust source grammar edge cases', () => {
  it('resolves owner references before callable-local generic bindings enter scope', async () => {
    const symbols = await extract('pub struct T;\npub struct Probe<U>(U);\nimpl Probe<T> {\n    pub fn method<T>(value: T) {}\n}')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    const layout = await layoutFor(symbol)
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.enclosingContext && span.text === 'T').map((span) => span.link?.href)).toEqual(['/probe.T/'])
    // The method's own `T` shadows the struct `T` the impl names, and links to the method's declaration.
    const anchor = '/probe.Probe.method/#probe.Probe.method.type-parameter.T'
    expect(spans.filter((span) => !span.enclosingContext && span.text === 'T').map((span) => span.link?.href)).toEqual([anchor, anchor])
    expect(index.linkType('T', symbol, signature).find((span) => span.text === 'T')?.link?.href).toBe(anchor)
  })

  it('retains grammar keyword roles and links named raw type identifiers', async () => {
    const symbols = await extract('pub struct r#type; pub trait Trait {} pub async unsafe extern "C" fn method(value: impl Trait, other: r#type) -> r#type {}')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    const layout = await layoutFor(symbol)
    const words = layout.syntax?.filter((range) => range.kind === 'keyword').map((range) => layout.text.slice(range.start, range.end))
    expect(words).toEqual(['pub', 'async', 'unsafe', 'extern', 'fn', 'impl'])
    const index = new SymbolIndex(symbols, (entry) => `/${encodeURIComponent(entry.id)}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.keyword).map((span) => span.text)).toEqual(words)
    expect(spans.filter((span) => span.link?.symbol?.id === 'probe.r#type')).toHaveLength(2)
    expect(spans.filter((span) => span.text.includes('"C"')).some((span) => span.link)).toBe(false)
  })

  it('keeps method and impl binders distinct in headers and parameter type links', async () => {
    const symbols = await extract(`pub struct T; pub struct U; pub struct V; pub struct N;
pub struct Bound; pub struct label; pub struct Probe<T>;
impl<U: Bound> Probe<U> {
    #[must_use = "T U V N label retain  spaces and {braces}"]
    pub unsafe extern "C" fn method<'a, V: Bound, const N: usize>(
        &'a mut self, local: V, inherited: U, global: T,
        callback: fn(label: T), bytes: [u8; N],
    ) -> Result<T, Error> where V: Clone {}
}`)
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    expect(signature.typeParamNames).toEqual(["'a", 'V', 'N'])
    expect(signature.enclosingTypeParamNames).toEqual(['U'])
    expect(signature.typeParams).toEqual(["'a", 'V: Bound', 'const N: usize'])
    expect(signature.enclosingDeclaration).toBe('impl<U: Bound> Probe<U>')
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    const layout = await layoutFor(symbol)
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.link?.href === '/probe.T/')).toHaveLength(3)
    for (const name of ['U', 'V', 'N', 'label']) expect(spans.some((span) => span.link?.href === `/probe.${name}/`)).toBe(false)
    expect(spans.filter((span) => span.link?.href === '/probe.Bound/')).toHaveLength(2)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text))
      .toEqual(signature.params.slice(1).map((param) => param.name))
    expect(signature.params[0]!.name).toBe("&'a mut self")
    for (const name of ['local', 'inherited', 'bytes']) {
      const type = signature.params.find((param) => param.name === name)!.type!
      expect(index.linkType(type, symbol, signature).some((span) => span.link?.href === `/probe.${type}/`)).toBe(false)
      expect(index.linkType(type, symbol).some((span) => span.link?.href === `/probe.${type}/`)).toBe(false)
    }
    expect(index.linkType('T', symbol, signature).find((span) => span.text === 'T')?.link?.href).toBe('/probe.T/')
    expect(index.linkType("&'a T", symbol, signature).find((span) => span.text === 'a')?.link).toBeUndefined()
    const again = { ...signature, raw: layout.text.slice(layout.contextEnd) }
    expect((await apiSignatureLayouts({ ...symbol, signatures: [again] }, 'rs')).get(again)!.text).toBe(layout.text)
  })

  it('selects each overload lexical scope without inheriting the struct binder spelling', async () => {
    const symbols = await extract(`pub struct T; pub struct Probe<T>;
impl<U> Probe<U> { pub fn method(value: T) {} }
impl<T> Probe<T> { pub fn method(value: T) {} }`)
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    expect(symbol.signatures.map((signature) => signature.enclosingTypeParamNames)).toEqual([['U'], ['T']])
    expect(index.linkType('T', symbol, symbol.signatures[0]).find((span) => span.text === 'T')?.link?.href).toBe('/probe.T/')
    // The second impl spells the struct's parameter `T`, so there it is that parameter and not the unit struct.
    const parameter = '/probe.Probe/#probe.Probe.type-parameter.T'
    expect(index.linkType('T', symbol, symbol.signatures[1]).find((span) => span.text === 'T')?.link?.href).toBe(parameter)
    expect(index.linkType('T', symbol).find((span) => span.text === 'T')?.link?.href).toBe(parameter)
    const layouts = await apiSignatureLayouts(symbol, 'rs')
    expect([...layouts.values()].map((layout) => layout.text)).toEqual([
      'impl<U> Probe<U>\npub fn method(value: T)',
      'impl<T> Probe<T>\npub fn method(value: T)',
    ])
  })

  it('retains trait defaults and native required-method punctuation', async () => {
    const symbols = await extract('pub struct Bound; pub struct Global; pub struct T; pub trait Probe<T: Bound = Global> { fn method(&self, value: T) -> T; }')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    expect(signature.raw).toBe('fn method(&self, value: T) -> T;')
    expect(signature.enclosingTypeParamNames).toEqual(['T'])
    expect(signature.typeParamNames).toBeUndefined()
    const layout = await layoutFor(symbol)
    expect(layout.text).toBe('pub trait Probe<T: Bound = Global>\nfn method(&self, value: T) -> T;')
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href === '/probe.Global/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href === '/probe.Bound/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href === '/probe.T/')).toHaveLength(0)
    expect(layout.failures).toEqual([])
  })

  it('retains literal and comment text while exposing overlong source attributes', async () => {
    const literal = 'r##"first\n  T: exact  spaces, { braces }\nlast"##'
    const raw = `#[must_use = ${literal}]\n#[cfg(feature = "native")]\npub fn method(value: /* T exact  comment */ T) -> T`
    const symbol = method(raw, [{ name: 'value', type: 'T' }])
    const layout = await layoutFor(symbol)
    expect(layout.text).toContain(literal)
    expect(layout.failures).toEqual([])
    const index = new SymbolIndex([{ ...symbol, id: 'T', name: 'T', kind: 'struct', signatures: [] }, symbol], (entry) => `/${entry.id}/`, 'rs')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/T/')).toHaveLength(2)
    expect(spans.find((span) => span.text.includes('exact  spaces'))?.link).toBeUndefined()
    const long = method(`#[must_use = "${'value '.repeat(13)}"]\npub fn method()`)
    const unresolved = await layoutFor(long)
    expect(unresolved.text).toBe(long.signatures[0]!.raw)
    expect(unresolved.failures).toEqual([{ line: 1, columns: 94, limit: 60 }])
  })

  it.each([58, 59, 60, 61, 62])('keeps the native empty-parameter boundary at %s columns', async (columns) => {
    const type = 'T'.repeat(columns - 'pub fn method() -> '.length)
    const raw = `pub fn method() -> ${type}`
    const layout = await layoutFor(method(raw))
    expect(layout.text).toBe(columns <= 60 ? raw : `pub fn method(\n) -> ${type}`)
    expect(layout.failures).toEqual([])
  })

  it.each(['', ','])('preserves source trailing commas %s rather than normalizing them', async (trailing) => {
    const raw = `pub fn method(value: Result<AnExtremelyLongNativeTypeName, AnotherNativeTypeName>${trailing})`
    const symbol = method(raw, [{ name: 'value', type: 'Result<AnExtremelyLongNativeTypeName, AnotherNativeTypeName>' }])
    const layout = await layoutFor(symbol)
    expect(layout.text.match(/,/g)?.length).toBe(raw.match(/,/g)?.length)
    expect(layout.failures).toEqual([])
    const again = { ...symbol.signatures[0]!, raw: layout.text }
    expect((await apiSignatureLayouts({ ...symbol, signatures: [again] }, 'rs')).get(again)!.text).toBe(layout.text)
  })

  it('retains structured parameter identity and literal contents', async () => {
    const symbols = await extract(`pub fn method(
      Arguments(Request { first, second }): Arguments<Request>,
      callback: fn(label: Target),
    ) -> Target {}`)
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const layout = await layoutFor(symbol)
    const signature = symbol.signatures[0]!
    expect(layout.text).toContain(signature.params[0]!.name)
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    expect(signatureSpans(layout, index, symbol, signature).filter((span) => span.link?.href.startsWith('#')).map((span) => span.text))
      .toEqual(signature.params.map((param) => param.name))
    expect(layout.failures).toEqual([])
  })

  it('rejects inconsistent headers, body fragments and extra declarations', async () => {
    await expect(apiSignatureLayouts(method('pub fn other()'), 'rs')).rejects.toThrow(/declaration name/)
    await expect(apiSignatureLayouts(method('pub fn method(actual: T)', [{ name: 'invented' }]), 'rs')).rejects.toThrow(/parameter/)
    for (const raw of ['pub fn method(value: Broken<', 'pub fn method() {}', 'pub fn method(); pub fn extra();']) {
      await expect(apiSignatureLayouts(method(raw), 'rs')).rejects.toThrow(/grammar/)
    }
    const invalid = method('pub fn method()')
    invalid.signatures[0]!.enclosingDeclaration = 'impl Probe { pub fn extra() {} }'
    await expect(apiSignatureLayouts(invalid, 'rs')).rejects.toThrow(/grammar/)
  })

  it('reports unavailable native Rust headers before fallback reconstruction', async () => {
    const implicit = { ...method('pub fn method()'), signatures: [{ params: [] }] }
    const mixed = { ...implicit, signatures: [...implicit.signatures, { raw: 'pub fn method()', params: [] }] }
    for (const symbol of [implicit, mixed]) {
      expect(usesNativeSignatures(symbol, 'rs')).toBe(false)
      await expect(apiSignatureLayouts(symbol, 'rs')).rejects.toThrow(/unavailable.*Rust|Rust.*unavailable/i)
      await expect(symbolMarkdownWithLayout({ model: { port: 'rs', extractor: 'fixture', symbols: [symbol] }, symbol }))
        .rejects.toThrow(/unavailable.*Rust|Rust.*unavailable/i)
    }
  })
})
