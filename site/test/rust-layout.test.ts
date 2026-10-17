import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
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
    expect(spans.find((span) => span.text.startsWith('#[must_use'))).toMatchObject({ nonReference: true })
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

  it('wraps a native async hook header at 60 columns with shared Markdown and parameter links', async () => {
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
      ['&self', '#server.Server.set_hook.parameter.%26self'],
      ['name', '#server.Server.set_hook.parameter.name'],
      ['command', '#server.Server.set_hook.parameter.command'],
    ])
    expect(apiEntryFields(symbol, 'rs').params.map((param) => param.name)).toEqual(['&self', 'name', 'command'])
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
})

const extract = (source: string) => extractSourceWithSpec(RUST, source, 'probe.rs', 'probe')

describe('Rust source grammar edge cases', () => {
  it('resolves owner references before callable-local generic bindings enter scope', async () => {
    const symbols = await extract('pub struct T;\npub struct Probe<U>(U);\nimpl Probe<T> {\n    pub fn method<T>(value: T) {}\n}')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'rs')
    const layout = await layoutFor(symbol)
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.enclosingContext && span.text === 'T').map((span) => span.link?.href)).toEqual(['/probe.T/'])
    expect(spans.filter((span) => !span.enclosingContext && span.text === 'T').map((span) => span.link)).toEqual([undefined, undefined])
    expect(index.linkType('T', symbol, signature).find((span) => span.text === 'T')?.link).toBeUndefined()
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
      .toEqual(signature.params.map((param) => param.name))
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
    expect(index.linkType('T', symbol, symbol.signatures[1]).find((span) => span.text === 'T')?.link).toBeUndefined()
    expect(index.linkType('T', symbol).find((span) => span.text === 'T')?.link).toBeUndefined()
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
