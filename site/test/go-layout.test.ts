import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { usesNativeSignatures } from '../src/lib/api-sections'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { extractWithSpec } from '../../packages/api-model/src/languages/spec'
import { GO } from '../../packages/api-model/src/languages/specs'

const model = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8')) as ApiModel
const callable = (raw: string, params: Signature['params'] = []): ApiSymbol => ({
  id: 'tmux.Method', name: 'Method', kind: 'function', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'probe.go' },
})
async function layout(symbol: ApiSymbol) {
  const result = (await apiSignatureLayouts(symbol, 'go')).get(symbol.signatures[0]!)
  expect(result).toBeDefined()
  return result!
}

describe('Go callable layouts', () => {
  it.each([
    ['tmux.Server.ListBuffers', 'func (s Server) ListBuffers(\n\tctx context.Context,\n\trequest ListBuffersRequest,\n) ([]string, error)'],
    ['tmux.Server.Sessions', 'func (s Server) Sessions(\n\tctx context.Context,\n) ([]Session, error)'],
    ['tmuxq.Matching', 'func Matching[T any](\n\tvalues []T,\n\tfilter Filter[T],\n) ([]T, error)'],
  ])('shares the native 60-column %s declaration with Markdown', async (id, expected) => {
    const symbol = model.symbols.find((entry) => entry.id === id)!
    expect(usesNativeSignatures(symbol, 'go')).toBe(true)
    const result = await layout(symbol)
    expect(result.text).toBe(expected)
    expect(result.limit).toBe(60)
    expect(result.failures).toEqual([])
    const markdown = await symbolMarkdownWithLayout({ model, symbol })
    const signature = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(expected)
  })

  it('retains grouped names, variadics, nested callable types and source declaration order', async () => {
    const symbol = callable('func Method(first, second string, values ...func(name Target, extra Other) (Target, error)) (Target, error)', [
      { name: 'first', type: 'string' }, { name: 'second', type: 'string' }, { name: 'values', type: 'func(name Target, extra Other) (Target, error)', variadic: 'positional' },
    ])
    const result = await layout(symbol)
    expect(result.text).toContain('\n\tfirst, second string,\n')
    expect(result.text).toContain('values ...func(')
    expect(result.text).toContain('\n\t\tname Target,\n\t\textra Other,\n\t) (Target, error),\n')
    expect(result.failures).toEqual([])
    const parser = await parserFor('go')
    try {
      const input = parser.parse(symbol.signatures[0]!.raw!)!
      const output = parser.parse(result.text)!
      expect(output.rootNode.hasError).toBe(false)
      expect(output.rootNode.toString()).toBe(input.rootNode.toString())
      input.delete(); output.delete()
    } finally { parser.delete() }
  })

  it.each([
    'func Method(\n// Target before parameter\nvalue Target,\n) Target',
    'func Method(value Target, // Target after comma\n) Target',
    'func Method(value /* Target  comment */ Target) Target',
  ])('preserves comments and their line ownership in %s', async (raw) => {
    const symbol = callable(raw, [{ name: 'value', type: 'Target' }])
    const result = await layout(symbol)
    expect(result.text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)).toEqual(raw.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g))
    const target: ApiSymbol = { id: 'tmux.Target', name: 'Target', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
    const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'go')
    const spans = signatureSpans(result, index, symbol, symbol.signatures[0]!)
    expect(spans.map((span) => span.text).join('')).toBe(result.text)
    expect(spans.filter((span) => span.link?.href === '/tmux.Target/')).toHaveLength(2)
    expect(spans.find((span) => span.link?.href === '#tmux.Method.parameter.value')?.text).toBe('value')
  })

  it.each([
    ['func Method(value Target) /* Target  after header */', 1],
    ['func Method(value Target) Target /* Target  after result */', 2],
    ['func Method(value Target) Target /* Target first */ /* Target  second */', 2],
  ])('retains extracted trailing comments in %s', async (raw, typeLinks) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-go-header-comments-'))
    try {
      const file = join(directory, 'probe.go')
      writeFileSync(file, `package tmux\n${raw} { panic(0) }\n`)
      const symbol = (await extractWithSpec(GO, file, 'tmux'))[0]!
      expect(symbol.signatures[0]!.raw).toBe(raw)
      const result = await layout(symbol)
      expect(result.text.match(/\/\*[\s\S]*?\*\//g)).toEqual(raw.match(/\/\*[\s\S]*?\*\//g))
      const target: ApiSymbol = { id: 'tmux.Target', name: 'Target', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
      const spans = signatureSpans(result, new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'go'), symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(result.text)
      expect(spans.filter((span) => span.link?.href === '/tmux.Target/')).toHaveLength(typeLinks)
      expect(spans.find((span) => span.link?.href === '#tmux.Method.parameter.value')?.text).toBe('value')
      expect(result.failures).toEqual(await codeWidthFailures(result.text, 'api'))
      const markdown = await symbolMarkdownWithLayout({ model: { ...model, symbols: [symbol, target] }, symbol })
      const signature = fromMarkdown(markdown).children.find((node) => node.type === 'code')
      expect(signature?.type === 'code' && signature.value).toBe(result.text)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps an inline block comment attached to its following parameter comma', async () => {
    const symbol = callable('func Method(value Target /* Target */, other Target) Target', [{ name: 'value' }, { name: 'other' }])
    const result = await layout(symbol)
    expect(result.text).toContain('value Target /* Target */,')
    expect(result.text).not.toContain('*/ ,')
    const target: ApiSymbol = { id: 'tmux.Target', name: 'Target', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
    const spans = signatureSpans(result, new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'go'), symbol, symbol.signatures[0]!)
    expect(spans.map((span) => span.text).join('')).toBe(result.text)
    expect(spans.filter((span) => span.link?.href === '/tmux.Target/')).toHaveLength(3)
    expect(spans.filter((span) => span.link?.href.startsWith('#tmux.Method.parameter.')).map((span) => span.text)).toEqual(['value', 'other'])
  })

  it('preserves generic constraints and suppresses local generic or nested name collisions', async () => {
    const symbol = callable('func Method[T interface{ ~string | ~[]byte }](Target func(Target T) (Target T), value pkg.T) T', [{ name: 'Target' }, { name: 'value' }])
    const target: ApiSymbol = { id: 'tmux.Target', name: 'Target', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
    const unrelated: ApiSymbol = { ...target, id: 'tmux.T', name: 'T' }
    const external: ApiSymbol = { ...target, id: 'pkg.T', name: 'T', qualifiedName: 'pkg.T' }
    const result = await layout(symbol)
    expect(result.text).toContain('interface{ ~string | ~[]byte }')
    const spans = signatureSpans(result, new SymbolIndex([symbol, target, unrelated, external], (entry) => `/${entry.id}/`, 'go'), symbol, symbol.signatures[0]!)
    expect(spans.some((span) => span.link?.href === '/tmux.Target/' || span.link?.href === '/tmux.T/')).toBe(false)
    expect(spans.find((span) => span.link?.href === '/pkg.T/')?.text).toBe('pkg.T')
    expect(spans.filter((span) => span.link?.href.startsWith('#tmux.Method.parameter.')).map((span) => span.text)).toEqual(['Target', 'value'])
  })

  it('preserves raw string tags and reports indivisible over-width tokens', async () => {
    const tag = '`Target  tag\n unchanged`'
    const token = 'LongTarget'.repeat(9)
    const symbol = callable(`func Method(value struct { Name string ${tag} }) ${token}`, [{ name: 'value' }])
    const result = await layout(symbol)
    expect(result.text).toContain(tag)
    expect(result.text).toContain(token)
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.failures).toEqual(await codeWidthFailures(result.text, 'api'))
    expect(result.syntax!.filter((range) => range.kind === 'literal').map((range) => result.text.slice(range.start, range.end))).toContain(tag)
  })

  it.each([
    ['tmux.SessionOptionValues.PromptCommandCursorStyle', 66],
    ['tmux.WindowOptionValues.PaneScrollbarsPosition', 62],
  ])('reports the remaining native width failure for %s', async (id, columns) => {
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const result = await layout(symbol)
    expect(result.text).toContain(`OptionValue[${symbol.name}]`)
    expect(result.failures).toEqual([{ line: 3, columns, limit: 60 }])
  })

  it('keeps interface method names separate from identically named types', async () => {
    const symbol = callable('func Method(value interface{ Target(Target) Target; Field() Target }) Target', [{ name: 'value' }])
    const target: ApiSymbol = { id: 'tmux.Target', name: 'Target', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
    const result = await layout(symbol)
    const spans = signatureSpans(result, new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'go'), symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/tmux.Target/')).toHaveLength(4)
    expect(result.failures).toEqual(await codeWidthFailures(result.text, 'api'))
  })

  it('distinguishes a receiver type from its locally bound type parameter of the same name', async () => {
    const symbol = callable('func (receiver *T[T]) Method(value T) T', [{ name: 'value' }])
    symbol.kind = 'method'
    const type: ApiSymbol = { id: 'tmux.T', name: 'T', kind: 'struct', modifiers: [], signatures: [], source: { file: 'probe.go' } }
    const result = await layout(symbol)
    const spans = signatureSpans(result, new SymbolIndex([symbol, type], (entry) => `/${entry.id}/`, 'go'), symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/tmux.T/')).toHaveLength(1)
    expect(spans.map((span) => span.text).join('')).toBe(result.text)
  })

  it.each([
    ['func Method(value Broken[', [{ name: 'value' }]],
    ['func Method(value Target) {}', [{ name: 'value' }]],
    ['func Method(value Target)\nfunc Extra()', [{ name: 'value' }]],
    ['func Different(value Target)', [{ name: 'value' }]],
    ['func Method(value Target)', [{ name: 'missing' }]],
  ] as const)('rejects invalid grammar or stale model bindings in %s', async (raw, params) => {
    await expect(apiSignatureLayouts(callable(raw, [...params]), 'go')).rejects.toThrow(/grammar|binding/)
  })

  it('does not manufacture a native header from missing source', async () => {
    const symbol = callable('func Method()')
    delete symbol.signatures[0]!.raw
    expect(usesNativeSignatures(symbol, 'go')).toBe(false)
    expect(await apiSignatureLayouts(symbol, 'go')).toEqual(new Map())
  })
})
