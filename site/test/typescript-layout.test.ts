import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ApiModel, ApiSymbol, Signature } from '@libtmux/api-model'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, typescriptSignatureLayout } from '../src/lib/code-layout'
import { usesNativeSignatures } from '../src/lib/api-sections'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = JSON.parse(readFileSync(new URL('../src/data/api/ts.json', import.meta.url), 'utf8')) as ApiModel
const setHook = model.symbols.find((symbol) => symbol.id === 'server.Server.setHook')!
const setHookText = `setHook(
  name: string,
  command: string,
  options?: SetHookOptions,
): Promise<void>`
const method = (signature: Signature, overrides: Partial<ApiSymbol> = {}): ApiSymbol => ({
  id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures: [signature], source: { file: 'probe.ts' }, ...overrides,
})

function parseHeader(text: string) {
  const source = ts.createSourceFile('header.ts', `class Probe { ${text} {} }`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = (source.statements[0] as ts.ClassDeclaration).members[0] as ts.MethodDeclaration
  expect(declaration.body).toBeDefined()
  return declaration
}

describe('documentation-owned code widths', () => {
  it('shares distinct API and example caps without language exemptions', async () => {
    expect(CODE_COLUMNS).toEqual({ api: 60, example: 80 })
    expect(await codeWidthFailures('x'.repeat(61), 'api')).toEqual([{ line: 1, columns: 61, limit: 60 }])
    expect(await codeWidthFailures('x'.repeat(61), 'example')).toEqual([])
    expect(await codeWidthFailures('x'.repeat(81), 'example')).toEqual([{ line: 1, columns: 81, limit: 80 }])
  })

  it('measures tabs, wide characters and combining marks as printed columns', async () => {
    const text = '\t' + '界'.repeat(27) + '\n' + 'e\u0301'.repeat(60)
    expect(await codeWidthFailures(text, 'api')).toEqual([{ line: 1, columns: 62, limit: 60 }])
  })
})

describe('TypeScript callable layouts', () => {
  it('renders the actual setHook fixture using native parameter lines at 60 columns', async () => {
    expect(usesNativeSignatures(setHook, 'ts')).toBe(true)
    const layout = (await apiSignatureLayouts(setHook, 'ts')).get(setHook.signatures[0]!)!
    expect(layout.text).toBe(setHookText)
    expect(layout.failures).toEqual([])
    expect(layout.text).not.toContain('async')
    const declaration = parseHeader(layout.text)
    expect(declaration.parameters.map((parameter) => parameter.name.getText())).toEqual(['name', 'command', 'options'])
    expect(declaration.parameters[2]!.questionToken).toBeDefined()
    expect(declaration.type!.getText()).toBe('Promise<void>')
  })

  it('keeps complete overloads and the Markdown twin identical to the HTML layout inputs', async () => {
    const overloaded = { ...setHook, signatures: [{ params: [], returns: 'Promise<void>' }, ...setHook.signatures] }
    const layouts = await apiSignatureLayouts(overloaded, 'ts')
    expect([...layouts.values()].map((layout) => layout.text)).toEqual(['setHook(): Promise<void>', setHookText])
    const document = await symbolMarkdownWithLayout({ model, symbol: overloaded })
    const signature = fromMarkdown(document).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(`setHook(): Promise<void>\n\n${setHookText}`)
  })

  it('formats nested types and constraints while retaining literal punctuation', async () => {
    const signature: Signature = {
      typeParams: ['T extends Readonly<Record<string, readonly (Session | Window)[]>>'],
      params: [{ name: 'value', type: 'T' }, { name: 'select', type: '(item: T, hint: "comma, paren) and brace}") => Promise<ReadonlyMap<string, T>>' }],
      returns: 'Promise<ReadonlyArray<{ readonly value: T; readonly kind: "a,b" | "c>d" }>>',
    }
    const layout = await typescriptSignatureLayout(method(signature), signature)
    expect(layout.failures).toEqual([])
    expect(layout.text).toContain('"comma, paren) and brace}"')
    expect(layout.text).toContain('"c>d"')
    const declaration = parseHeader(layout.text)
    expect(declaration.typeParameters).toHaveLength(1)
    expect(declaration.parameters).toHaveLength(2)
    expect(declaration.type!.kind).toBe(ts.SyntaxKind.TypeReference)
  })

  it('retains source-owned modifiers, defaults and rest parameters', async () => {
    const signature: Signature = { params: [{ name: 'message', type: 'string', default: '"{}"' }, { name: 'items', type: 'readonly string[]', variadic: 'positional' }], returns: 'Promise<void>' }
    const symbol = method(signature, { modifiers: ['static', 'async'] })
    const layout = await typescriptSignatureLayout(symbol, signature)
    expect(layout.text).toContain('static async method(')
    expect(layout.text).toContain('message: string = "{}"')
    expect(layout.text).toContain('...items: readonly string[]')
    expect(layout.text.endsWith(': Promise<void>')).toBe(true)
    expect(layout.failures).toEqual([])
  })

  it('preserves multiline literal contents while removing the synthetic class indent', async () => {
    const value = '`first\n  keep these spaces\nlast`'
    const signature: Signature = { params: [{ name: 'value', type: 'string', default: value }], returns: 'void' }
    const layout = await typescriptSignatureLayout(method(signature), signature)
    const declaration = parseHeader(layout.text)
    expect((declaration.parameters[0]!.initializer as ts.NoSubstitutionTemplateLiteral).text).toBe('first\n  keep these spaces\nlast')
  })

  it('reports indivisible overlong tokens and strings without truncating or relabeling them', async () => {
    const name = 'A'.repeat(75)
    const signature: Signature = { params: [{ name: 'value', type: `"${'x'.repeat(90)}"` }], returns: name }
    const layout = await typescriptSignatureLayout(method(signature), signature)
    expect(layout.text).toContain(name)
    expect(layout.text).toContain('x'.repeat(90))
    expect(layout.failures.map((failure) => failure.columns)).toEqual([102, 78])
    expect(layout.failures.every((failure) => failure.limit === 60)).toBe(true)
  })

  it('does not route other ports or TypeScript aliases through this adapter', async () => {
    expect(await apiSignatureLayouts(setHook, 'scala')).toEqual(new Map())
    expect(await apiSignatureLayouts({ ...setHook, kind: 'typealias', signatures: [] }, 'ts')).toEqual(new Map())
  })

  it('rejects invalid TypeScript grammar and caches the same invalid input', async () => {
    const signature: Signature = { params: [{ name: 'value', type: 'Map<Broken' }], returns: 'void' }
    const symbol = method(signature)
    const first = typescriptSignatureLayout(symbol, signature)
    expect(typescriptSignatureLayout(symbol, signature)).toBe(first)
    await expect(first).rejects.toThrow()
  })
})
