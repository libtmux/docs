import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { usesNativeSignatures } from '../src/lib/api-sections'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
const method = (raw: string, params: Signature['params'] = [], name = 'method'): ApiSymbol => ({
  id: `Probe.${name}`, name, kind: 'method', modifiers: [],
  signatures: [{ raw, params }], source: { file: 'Probe.java' },
})
const target = (name: string): ApiSymbol => ({
  id: name, name, kind: 'class', modifiers: [], signatures: [], source: { file: 'Probe.java' },
})
const layoutFor = async (symbol: ApiSymbol) => {
  const layout = (await apiSignatureLayouts(symbol, 'java')).get(symbol.signatures[0]!)
  expect(layout).toBeDefined()
  return layout!
}

async function sameGrammar(before: string, after: string) {
  const parser = await parserFor('java')
  const wrap = (text: string) => `class Probe {\n${text}\n${text.trimEnd().endsWith(';') ? '' : '{}'}\n}`
  const input = parser.parse(wrap(before))!
  const output = parser.parse(wrap(after))!
  try {
    expect(input.rootNode.hasError).toBe(false)
    expect(output.rootNode.hasError).toBe(false)
    expect(output.rootNode.toString()).toBe(input.rootNode.toString())
  } finally { input.delete(); output.delete(); parser.delete() }
}

describe('Java callable layouts', () => {
  it.fails('prints both native sessions overloads under the API cap in HTML and Markdown preparation', async () => {
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.Server.Server.sessions')!
    expect(usesNativeSignatures(symbol, 'java')).toBe(true)
    const layouts = await apiSignatureLayouts(symbol, 'java')
    const expected = [
      '@ReadOnly\n@Operation(Kind.READ)\npublic List<Session> sessions(\n        FilterExpr<Session> expression)',
      '@ReadOnly\n@Operation(Kind.READ)\npublic List<Session> sessions()',
    ]
    expect([...layouts.values()].map((layout) => layout.text)).toEqual(expected)
    expect([...layouts.values()].flatMap((layout) => layout.failures)).toEqual([])
    const document = await symbolMarkdownWithLayout({ model, symbol })
    const signature = fromMarkdown(document).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(expected.join('\n\n'))
  })

  it.fails('retains the real varargs overload and each parameter destination', async () => {
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.batch.Batch.Batch.add')!
    const layouts = await apiSignatureLayouts(symbol, 'java')
    expect([...layouts.values()].map((layout) => layout.text)).toEqual([
      '@Operation(Kind.CAPTURED)\npublic Batch add(String... argv)',
      '@Operation(Kind.CAPTURED)\npublic Batch add(List<String> argv)',
    ])
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, 'java')
    for (const signature of symbol.signatures) {
      const spans = signatureSpans(layouts.get(signature)!, index, symbol, signature)
      expect(spans.filter((span) => span.text === 'add')).toEqual([{ text: 'add', declaration: true, declarationName: true }])
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
        .toEqual([['argv', '#io.github.libtmux.batch.Batch.Batch.add.parameter.argv']])
    }
  })

  it.fails.each([
    'public <T extends Target & Comparable<T>> Map<String, List<? super T[]>> method(final List<T> values, Target... rest) throws java.io.IOException, IllegalArgumentException',
    'public Probe(@Marker Target value, String... rest)',
    'abstract Target method(Target value[])[];',
  ])('preserves native tokens and grammar in %s', async (raw) => {
    const constructor = raw.includes('Probe(')
    const symbol = method(raw, [{ name: raw.includes('values') ? 'values' : 'value' }, ...(raw.includes('rest') ? [{ name: 'rest' }] : [])], constructor ? 'Probe' : 'method')
    const layout = await layoutFor(symbol)
    await sameGrammar(raw, layout.text)
    const again = await layoutFor(method(layout.text, symbol.signatures[0]!.params, symbol.name))
    expect(again.text).toBe(layout.text)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it.fails.each([
    'public Target method(\n// Target explains value\nTarget value)',
    'public Target method(Target value // Target before close\n)',
    'public Target method(Target value) /* Target after header */',
    'public Target method(Target value) // Target after header',
    'public Target method(Target value) throws /* Target comment */ IOException, OtherException',
    'public Target method(Target value) throws IOException, // Target comment\n OtherException',
    'public Target method(Target value); // Target after abstract',
    '@Marker("Target  stays  literal") public Target method(Target value)',
    '@Marker("""\n  Target stays indented\n  """) public Target method(Target value)',
  ])('protects comment and literal contents and links in %s', async (raw) => {
    const symbol = method(raw, [{ name: 'value' }])
    const layout = await layoutFor(symbol)
    await sameGrammar(raw, layout.text)
    const index = new SymbolIndex([symbol, target('Target'), target('Marker')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.link?.href === '/Target/')).toHaveLength(2)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['value'])
    if (raw.includes('  ')) expect(layout.text).toContain(raw.includes('"""') ? '"""\n  Target stays indented\n  """' : '"Target  stays  literal"')
    expect(layout.failures).toEqual([])
  })

  it.fails('shields locally bound type names while retaining their bound links', async () => {
    const symbol = method('public <Target extends Bound> Target method(List<Target> value)', [{ name: 'value' }])
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol, target('Target'), target('Bound'), target('List')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/Target/')).toEqual([])
    expect(spans.filter((span) => span.link?.href === '/Bound/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href === '/List/')).toHaveLength(1)
  })

  it.fails('reports an indivisible overlong token instead of silently treating it as compliant', async () => {
    const name = 'Indivisible'.repeat(8)
    const symbol = method(`public ${name} method()`)
    const layout = await layoutFor(symbol)
    expect(layout.text).toContain(name)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it.fails('keeps native receiver syntax without adding a callable parameter', async () => {
    const symbol = method('public Target method(Probe this, Target value)', [{ name: 'value' }])
    const layout = await layoutFor(symbol)
    expect(layout.text).toBe(symbol.signatures[0]!.raw)
    const index = new SymbolIndex([symbol, target('Probe'), target('Target')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['value'])
    expect(spans.filter((span) => span.link?.href === '/Probe/')).toHaveLength(1)
  })

  it.fails('respects neighboring surface widths without an unstable or wider fallback', async () => {
    const limits = CODE_COLUMNS as { api: number; example: number }
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.Server.Server.sessions')!
    try {
      for (const width of [58, 59, 60, 61, 62]) {
        limits.api = width
        const layouts = await apiSignatureLayouts(symbol, 'java')
        expect(layouts.size).toBe(2)
        for (const [signature, layout] of layouts) {
          expect(layout.failures).toEqual([])
          expect(Math.max(...layout.text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(width)
          await sameGrammar(signature.raw!, layout.text)
          const again = await apiSignatureLayouts({ ...symbol, signatures: [{ ...signature, raw: layout.text }] }, 'java')
          expect([...again.values()][0]!.text).toBe(layout.text)
        }
      }
    } finally { limits.api = 60 }
  })

  it.fails('does not rename a source declaration or manufacture a parameter binding', async () => {
    await expect(apiSignatureLayouts(method('public Target different()'), 'java')).rejects.toThrow(/declaration/)
    await expect(apiSignatureLayouts(method('public Target method(Target actual)', [{ name: 'invented' }]), 'java')).rejects.toThrow(/parameter/)
    await expect(apiSignatureLayouts(method('public Target method(Target broken<'), 'java')).rejects.toThrow(/grammar/)
    await expect(apiSignatureLayouts(method('public Target method(); }\nclass Extra {'), 'java')).rejects.toThrow(/grammar/)
  })

  it('keeps implicit and mixed accessor families on their existing rendering path', async () => {
    const implicit = { ...method('public Target method()'), signatures: [{ params: [], returns: 'Target' }] }
    const mixed = { ...implicit, signatures: [...implicit.signatures, { raw: 'public Target method(Target value)', params: [{ name: 'value' }] }] }
    for (const symbol of [implicit, mixed]) {
      expect(usesNativeSignatures(symbol, 'java')).toBe(false)
      expect(await apiSignatureLayouts(symbol, 'java')).toEqual(new Map())
    }
    expect(CODE_COLUMNS).toEqual({ api: 60, example: 80 })
  })
})
