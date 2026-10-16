import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { apiEntryFields, usesNativeSignatures } from '../src/lib/api-sections'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { extractSourceWithSpec } from '../../packages/api-model/src/languages/spec'
import { JAVA } from '../../packages/api-model/src/languages/specs'

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
  it.each([
    'public <@Mark T> T method(T value)',
    'public <@Mark T extends Bound> T method(T value)',
    'public <@Mark /* binder */ T extends Bound> T method(T value)',
    'public <@Mark T> T method(Probe this, T value)',
    'public abstract <@Mark T extends Bound> T method(@Mark Probe this, T value);',
  ])('preserves extracted annotated binders and receiver ownership in %s', async (raw) => {
    const source = `public abstract class Probe { ${raw}${raw.endsWith(';') ? '' : ' { throw new RuntimeException(); }'} }`
    const symbols = await extractSourceWithSpec(JAVA, source, 'Probe.java', 'edge')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    expect(signature.params).toEqual([{ name: 'value', type: 'T' }])
    const layout = await layoutFor(symbol)
    await sameGrammar(raw, layout.text)
    const globals = ['T', 'Bound', 'Mark'].map((name) => ({ ...target(name), id: `global.${name}` }))
    const index = new SymbolIndex([...symbols, ...globals], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.link?.href === '/global.T/')).toEqual([])
    expect(spans.filter((span) => span.link?.href === '/global.Mark/')).toHaveLength(raw.includes('@Mark Probe') ? 2 : 1)
    expect(spans.filter((span) => span.link?.href === '/global.Bound/')).toHaveLength(raw.includes('extends Bound') ? 1 : 0)
    expect(spans.filter((span) => span.link?.href === '/edge.Probe/')).toHaveLength(raw.includes('Probe this') ? 1 : 0)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
      .toEqual([['value', '#edge.Probe.method.parameter.value']])
    expect(apiEntryFields(symbol, 'java').params.map((param) => param.name)).toEqual(['value'])
    expect(layout.failures).toEqual([])
  })

  it.each(['/* String retains */', '// String retains\n'])('keeps extracted varargs metadata and comment text through %s', async (comment) => {
    const raw = `public void method(@Mark ${comment} String... values)`
    const symbols = await extractSourceWithSpec(JAVA, `public class Probe { ${raw} {} }`, 'Probe.java', 'edge')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    expect(signature.params).toEqual([{ name: 'values', type: 'String', variadic: 'positional' }])
    const layout = await layoutFor(symbol)
    await sameGrammar(raw, layout.text)
    expect(layout.text).toContain(comment.trimEnd())
    const index = new SymbolIndex([...symbols, target('String'), target('Mark')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href === '/String/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['values'])
    expect(apiEntryFields(symbol, 'java').params).toMatchObject([{ name: 'values', type: 'String', variadic: 'positional' }])
    expect(layout.failures).toEqual([])
  })

  it('lays out an extracted inner constructor receiver without inventing an argument', async () => {
    const raw = 'public Inner(Probe Probe.this, String value)'
    const symbols = await extractSourceWithSpec(JAVA, `public class Probe { public class Inner { ${raw} {} } }`, 'Probe.java', 'edge')
    const symbol = symbols.find((entry) => entry.id === 'edge.Probe.Inner.Inner')!
    expect(symbol.signatures[0]!.params).toEqual([{ name: 'value', type: 'String' }])
    const layout = await layoutFor(symbol)
    expect(layout.text).toBe(raw)
    const index = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/edge.Probe/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
      .toEqual([['value', '#edge.Probe.Inner.Inner.parameter.value']])
    expect(apiEntryFields(symbol, 'java').params.map((param) => param.name)).toEqual(['value'])
  })

  it('retains annotated ordinary arguments whose names resemble receivers', async () => {
    const raw = 'public void method(@Mark Probe thisValue, @Mark Probe receiver)'
    const symbols = await extractSourceWithSpec(JAVA, `public class Probe { ${raw} {} }`, 'Probe.java', 'edge')
    const symbol = symbols.find((entry) => entry.name === 'method')!
    const signature = symbol.signatures[0]!
    expect(signature.params).toEqual([{ name: 'thisValue', type: 'Probe' }, { name: 'receiver', type: 'Probe' }])
    const layout = await layoutFor(symbol)
    await sameGrammar(raw, layout.text)
    const index = new SymbolIndex([...symbols, target('Mark')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
      .toEqual(['#edge.Probe.method.parameter.thisValue', '#edge.Probe.method.parameter.receiver'])
    expect(spans.filter((span) => span.link?.href === '/edge.Probe/')).toHaveLength(2)
    expect(spans.filter((span) => span.link?.href === '/Mark/')).toHaveLength(2)
    expect(apiEntryFields(symbol, 'java').params.map((param) => param.name)).toEqual(['thisValue', 'receiver'])
    expect(layout.failures).toEqual([])
  })

  it('prints both native sessions overloads under the API cap in HTML and Markdown preparation', async () => {
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

  it('retains the real varargs overload and each parameter destination', async () => {
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.batch.Batch.Batch.add')!
    const layouts = await apiSignatureLayouts(symbol, 'java')
    expect([...layouts.values()].map((layout) => layout.text)).toEqual([
      '@Operation(Kind.CAPTURED)\npublic Batch add(String... argv)',
      '@Operation(Kind.CAPTURED)\npublic Batch add(List<String> argv)',
    ])
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, 'java')
    const inventory = JSON.parse(readFileSync(new URL('../src/data/inventories/jdk.entries.json', import.meta.url), 'utf8')) as { e: [string, string][] }
    index.addInventory('https://docs.oracle.com/en/java/javase/21/docs/api/', inventory.e.map(([name, uri]) => ({
      name, uri, type: 'std:label', priority: 1, dispname: '-',
    })), ['java'], 'Java SE')
    for (const signature of symbol.signatures) {
      const spans = signatureSpans(layouts.get(signature)!, index, symbol, signature)
      expect(spans.filter((span) => span.text === 'add')).toEqual([{ text: 'add', declaration: true, declarationName: true }])
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
        .toEqual([['argv', '#io.github.libtmux.batch.Batch.Batch.add.parameter.argv']])
      expect(spans.filter((span) => span.text === 'String').map((span) => span.link?.href))
        .toEqual(['https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html'])
    }
  })

  it.each([
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

  it.each([
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

  it('shields locally bound type names while retaining their bound links', async () => {
    const symbol = method('public <Target extends Bound> Target method(List<Target> value)', [{ name: 'value' }])
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex([symbol, target('Target'), target('Bound'), target('List')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href === '/Target/')).toEqual([])
    expect(spans.filter((span) => span.link?.href === '/Bound/')).toHaveLength(1)
    expect(spans.filter((span) => span.link?.href === '/List/')).toHaveLength(1)
  })

  it('reports an indivisible overlong token instead of silently treating it as compliant', async () => {
    const name = 'Indivisible'.repeat(8)
    const symbol = method(`public ${name} method()`)
    const layout = await layoutFor(symbol)
    expect(layout.text).toContain(name)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it('keeps native receiver syntax without adding a callable parameter', async () => {
    const symbol = method('public Target method(Probe this, Target value)', [{ name: 'value' }])
    const layout = await layoutFor(symbol)
    expect(layout.text).toBe(symbol.signatures[0]!.raw)
    const index = new SymbolIndex([symbol, target('Probe'), target('Target')], (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.text)).toEqual(['value'])
    expect(spans.filter((span) => span.link?.href === '/Probe/')).toHaveLength(1)
  })

  it('respects neighboring surface widths without an unstable or wider fallback', async () => {
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

  it('does not rename a source declaration or manufacture a parameter binding', async () => {
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


describe('Java grammar roles and annotation headers', () => {
  it.fails('marks native modifier and constraint tokens without hiding real types', async () => {
    const raw = 'public static synchronized <T extends Bound> T method(Target value) throws Failure'
    const symbol = method(raw, [{ name: 'value', type: 'Target' }])
    const layout = await layoutFor(symbol)
    const index = new SymbolIndex(['Target', 'Bound', 'Failure', 'public', 'static', 'synchronized', 'extends', 'throws'].map(target), (entry) => `/${entry.id}/`, 'java')
    const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
    expect(spans.filter((span) => span.nonReference).map((span) => span.text)).toEqual(['public', 'static', 'synchronized', 'T', 'extends', 'T', 'throws'])
    expect(spans.filter((span) => span.link && !span.link.href.startsWith('#')).map((span) => span.text)).toEqual(['Bound', 'Target', 'Failure'])
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
  })

  it.fails('renders extracted annotation headers and defaults using native grammar', async () => {
    const symbols = await extractSourceWithSpec(JAVA, `public @interface Operation { String text() default "Unknown  text"; Class<?>[] owners() default {Target.class}; }`, 'Operation.java', 'edge')
    expect(symbols.map((entry) => entry.name)).toEqual(['Operation', 'text', 'owners'])
    const index = new SymbolIndex([...symbols, target('Target'), target('String'), target('Class')], (entry) => `/${entry.id}/`, 'java')
    for (const [i, expected] of ['public @interface Operation', 'String text() default "Unknown  text";', 'Class<?>[] owners() default {Target.class};'].entries()) {
      const symbol = symbols[i]!
      const layout = await layoutFor(symbol)
      expect(layout.text).toBe(expected)
      expect(layout.failures).toEqual([])
      const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(expected)
      expect(spans.some((span) => span.link?.href === '/Unknown/')).toBe(false)
      const markdown = await symbolMarkdownWithLayout({ model: { port: 'java', extractor: 'test', symbols }, symbol })
      expect(markdown).toContain(expected)
    }
    const owners = symbols[2]!
    expect(signatureSpans(await layoutFor(owners), index, owners, owners.signatures[0]!).filter((span) => span.link).map((span) => span.text)).toEqual(['Class', 'Target'])
  })
})
