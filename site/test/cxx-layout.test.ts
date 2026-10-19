import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, type CodeLayout } from '../src/lib/code-layout'
import { usesNativeSignatures } from '../src/lib/api-sections'
import { formatCxxDeclaration } from '../src/lib/cxx-code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = JSON.parse(readFileSync(new URL('../src/data/api/cxx.json', import.meta.url), 'utf8')) as ApiModel
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cxx-clang-format.json', import.meta.url), 'utf8')) as {
  cases: { group: string; columns: number; raw: string; text: string }[]
}
const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, 'cxx')

const callable = (raw: string, params: Signature['params'] = [], name = 'method'): ApiSymbol => ({
  id: `libtmux::Target::${name}`, name, kind: 'method', parent: 'libtmux::Target', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'probe.hpp' },
})
const layoutOf = async (symbol: ApiSymbol, overload = 0): Promise<CodeLayout> => {
  const layout = (await apiSignatureLayouts(symbol, 'cxx')).get(symbol.signatures[overload]!)
  expect(layout).toBeDefined()
  return layout!
}
const modelSymbol = (id: string) => model.symbols.find((entry) => entry.id === id)!

describe('C++ layouts reproduce pinned clang-format output', () => {
  it.each([...new Set(fixture.cases.map((entry) => `${entry.group}@${entry.columns}`))])('matches the %s cases', (selection) => {
    const [group, columns] = selection.split('@')
    const cases = fixture.cases.filter((entry) => entry.group === group && entry.columns === Number(columns))
    expect(cases.length).toBeGreaterThan(0)
    const failed = cases.flatMap((entry) => {
      const text = formatCxxDeclaration(entry.raw, entry.columns)
      return text === entry.text ? [] : [{ raw: entry.raw, expected: entry.text, actual: text }]
    })
    expect(failed).toEqual([])
  })

  it('is sensitive to the budget, so the fixture exercises the search', () => {
    const wrapped = fixture.cases.filter((entry) => entry.columns === 60 && entry.text.includes('\n'))
    expect(wrapped.length).toBeGreaterThan(fixture.cases.filter((entry) => entry.columns === 60).length / 2)
    for (const entry of wrapped.slice(0, 20)) expect(formatCxxDeclaration(entry.raw, 200)).not.toBe(entry.text)
  })
})

describe('C++ callable layouts', () => {
  it('lays out every extracted declaration within the API budget or records the failure', async () => {
    const wrapped: string[] = []
    let checked = 0
    for (const symbol of model.symbols) {
      if (!symbol.signatures.some((signature) => signature.raw)) continue
      const layouts = await apiSignatureLayouts(symbol, 'cxx')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        expect(layout, symbol.id).toBeDefined()
        checked++
        expect(layout.limit).toBe(CODE_COLUMNS.api)
        expect(layout.failures, symbol.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        expect(layout.text.split('\n').every((line) => line.length <= CODE_COLUMNS.api) || layout.failures.length > 0, symbol.id).toBe(true)
        // Only whitespace changes, so tokens, punctuation and names stay intact.
        expect(layout.text.replace(/\s+/g, ''), symbol.id).toBe(signature.raw!.replace(/\s+/g, ''))
        const again = { ...signature, raw: layout.text }
        expect((await apiSignatureLayouts({ ...symbol, signatures: [again] }, 'cxx')).get(again)!.text, symbol.id).toBe(layout.text)
        if (layout.text !== signature.raw) wrapped.push(symbol.id)
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(wrapped.length).toBeGreaterThan(0)
  })

  it('keeps a declaration that was previously over the budget whole and within it', async () => {
    const over = model.symbols.filter((symbol) => symbol.signatures.some((signature) => signature.raw!.split('\n').some((line) => line.length > CODE_COLUMNS.api)))
    expect(over.length).toBeGreaterThan(0)
    for (const symbol of over) {
      const layouts = await apiSignatureLayouts(symbol, 'cxx')
      for (const layout of layouts.values()) expect(layout.failures, symbol.id).toEqual([])
    }
  })

  it('links the same references and keywords as the unformatted declaration', async () => {
    let compared = 0
    for (const symbol of model.symbols) {
      if (!symbol.signatures.some((signature) => signature.raw)) continue
      const layouts = await apiSignatureLayouts(symbol, 'cxx')
      for (const signature of symbol.signatures) {
        const bound = new Set((signature.typeParams ?? []).map((parameter) => /(\w+)\s*(?:=.*)?$/.exec(parameter)?.[1]))
        const references = (spans: { text: string; link?: { href: string }; declaration?: boolean; keyword?: boolean; help?: unknown }[]) =>
          spans.filter((span) => (span.link && !span.declaration) || span.keyword).map((span) => `${span.text}|${span.link?.href ?? ''}|${span.keyword ? 'keyword' : ''}|${span.help ? 'help' : ''}`)
        // The unformatted pass links a destructor's class name and the qualified declared name, and a
        // template parameter to any type of the same name; the layout marks those as declarations.
        let offset = 0
        const before = references(index.linkType(signature.raw!, symbol, signature).filter((span) => {
          const start = offset
          offset += span.text.length
          const declared = span.text.endsWith(`::${symbol.name}`) && signature.raw!.startsWith('(', offset)
          return !(bound.has(span.text) || (symbol.name.startsWith('~') && signature.raw![start - 1] === '~' && span.text === symbol.name.slice(1)) || declared)
        }))
        const after = references(signatureSpans(layouts.get(signature)!, index, symbol, signature))
        expect(after, symbol.id).toEqual(before)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('marks one declaration name and links only the declared runtime parameters', async () => {
    for (const symbol of model.symbols) {
      if (!symbol.signatures.some((signature) => signature.raw)) continue
      const layouts = await apiSignatureLayouts(symbol, 'cxx')
      for (const signature of symbol.signatures) {
        const layout = layouts.get(signature)!
        const spans = signatureSpans(layout, index, symbol, signature)
        expect(spans.map((span) => span.text).join(''), symbol.id).toBe(layout.text)
        expect(spans.filter((span) => span.declarationName).map((span) => span.text), symbol.id).toEqual([symbol.name])
        // Unnamed parameters keep the model's spelling of their type, which is never an identifier.
        expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text), symbol.id)
          .toEqual(signature.params.map((param) => param.name).filter((name) => /^\w+$/.test(name)))
      }
    }
  })

  it('formats a constrained template without turning its parameter into a runtime parameter', async () => {
    const symbol = modelSymbol('libtmux::Server::at_socket_path')
    const signature = symbol.signatures[1]!
    expect(signature.typeParams).toEqual(['typename Path'])
    const layout = await layoutOf(symbol, 1)
    expect(layout.text).toBe(
      'template <typename Path>\n  requires std::same_as<std::remove_cvref_t<Path>,\n                        std::filesystem::path>\n' +
      '[[nodiscard]] static expected<Server, CommandFailure>\nat_socket_path(Path&& path, CommandObserver observer = {},\n               ExecutionPolicy policy = {});')
    expect(layout.failures).toEqual([])
    expect(layout.text.split('\n').map((line) => line.length).every((length) => length <= 60)).toBe(true)
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['path', 'observer', 'policy'])
    // The model also holds an unrelated type called Path; a template parameter must not reach it.
    expect(model.symbols.some((entry) => entry.name === 'Path')).toBe(true)
    const bound = spans.filter((span) => span.text === 'Path')
    expect(bound).toHaveLength(3)
    // They link to the template's own declaration, not to that type, and are not runtime parameters.
    expect(bound.map((span) => span.link?.typeParameter?.parameter.name)).toEqual(['Path', 'Path', 'Path'])
    expect(bound.every((span) => span.link?.typeParameter?.owner.id === symbol.id)).toBe(true)
    expect(spans.find((span) => span.text === 'nodiscard')).toMatchObject({ keyword: true })
    expect(spans.find((span) => span.text === 'expected')?.link?.href).toBe('/libtmux-expected/')
  })

  it.each([
    ['libtmux::EntityId::EntityId', 1, 'constexpr explicit libtmux::EntityId<Kind>::EntityId(\n    std::string_view value) noexcept;', ['EntityId'], ['value']],
    ['libtmux::CommandRuntime::wait_ready', 0, '[[nodiscard]] ReadyStatus wait_ready(\n    std::chrono::steady_clock::time_point deadline =\n        std::chrono::steady_clock::time_point::max());', ['wait_ready'], ['deadline']],
    ['libtmux::NotificationRange::NotificationRange', 0, 'NotificationRange(Connection& connection,\n                  std::chrono::steady_clock::time_point\n                      deadline) noexcept;', ['NotificationRange'], ['connection', 'deadline']],
    ['libtmux::mcp::Arguments::Arguments', 1, 'Arguments(std::initializer_list<\n          std::pair<std::string_view, std::string_view>>\n              values);', ['Arguments'], ['values']],
    ['libtmux::FilterExpr::~FilterExpr', 0, 'libtmux::FilterExpr<Entity>::~FilterExpr() = default;', ['~FilterExpr'], []],
    ['libtmux::capture_lines', 0, 'template <typename Text>\n  requires std::same_as<std::remove_cvref_t<Text>,\n                        std::string> &&\n               (!std::is_lvalue_reference_v<Text>)\nstd::vector<std::string_view>\ncapture_lines(Text&&) = delete;', ['capture_lines'], []],
  ] as const)('formats %s overload %i as clang-format does', async (id, overload, expected, names, parameters) => {
    const symbol = modelSymbol(id)
    const layout = await layoutOf(symbol, overload)
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual([])
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[overload]!)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual(names)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(parameters)
  })

  it('exports the same declarations in Markdown and keeps overloads separate', async () => {
    const symbol = modelSymbol('libtmux::mcp::Arguments::Arguments')
    expect(symbol.signatures).toHaveLength(3)
    expect(usesNativeSignatures(symbol, 'cxx')).toBe(true)
    const layouts = await apiSignatureLayouts(symbol, 'cxx')
    const markdown = await symbolMarkdownWithLayout({ model, symbol, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe(symbol.signatures.map((signature) => layouts.get(signature)!.text).join('\n\n'))
    expect(markdown).toContain('Arguments(std::initializer_list<\n          std::pair<std::string_view, std::string_view>>\n              values);')
  })

  it('records an indivisible over-width token without splitting it', async () => {
    const token = `Long${'Name'.repeat(15)}`
    const symbol = callable(`void method(${token} value, const char* text = "${'x'.repeat(70)}");`, [{ name: 'value' }, { name: 'text' }])
    const layout = await layoutOf(symbol)
    expect(layout.text).toContain(token)
    expect(layout.text).toContain(`"${'x'.repeat(70)}"`)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    expect(layout.text.replace(/\s+/g, '')).toBe(symbol.signatures[0]!.raw!.replace(/\s+/g, ''))
  })

  it('follows the shared budget', async () => {
    const symbol = modelSymbol('libtmux::Connection::wait_for_notifications')
    const original = CODE_COLUMNS.api
    try {
      for (const limit of [40, 60, 90]) {
        Object.assign(CODE_COLUMNS, { api: limit })
        const layout = await layoutOf(symbol)
        expect(layout.limit).toBe(limit)
        expect(layout.failures).toEqual([])
        expect(layout.text).toBe(formatCxxDeclaration(symbol.signatures[0]!.raw!, limit))
      }
    } finally { Object.assign(CODE_COLUMNS, { api: original }) }
  })

  it.each([
    ['bool operator==(const Target& other) const;', [], /operator/],
    ['void method(int values[4]);', [{ name: 'values' }], /array declarator/],
    ['bool method(bool a = 1 < 3);', [{ name: 'a' }], /comparison|operator/],
    ['void method(int value)', [{ name: 'value' }], /semicolon/],
    ['void method(int value;', [{ name: 'value' }], /brackets/],
    ['using Target = int;', [], /parameter list/],
  ] as const)('rejects unsupported grammar in %s', async (raw, params, reason) => {
    await expect(apiSignatureLayouts(callable(raw, [...params]), 'cxx')).rejects.toThrow(reason)
  })

  it.each([
    ['void other(int value);', [{ name: 'value' }], /name does not match/],
    ['void method(int value);', [{ name: 'value' }, { name: 'extra' }], /parameter list does not match/],
  ] as const)('rejects stale model bindings in %s', async (raw, params, reason) => {
    await expect(apiSignatureLayouts(callable(raw, [...params]), 'cxx')).rejects.toThrow(reason)
  })

  it('does not manufacture a native header from missing source', async () => {
    const symbol = callable('void method();')
    delete symbol.signatures[0]!.raw
    expect(usesNativeSignatures(symbol, 'cxx')).toBe(false)
    expect(await apiSignatureLayouts(symbol, 'cxx')).toEqual(new Map())
  })
})
