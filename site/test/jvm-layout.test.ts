import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parserFor, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { extractJvm } from '../../packages/api-model/src/languages/jvm'

const kotlinModel = JSON.parse(readFileSync(new URL('../src/data/api/kotlin.json', import.meta.url), 'utf8')) as ApiModel

const fixtures = [
  ['scala', 'io.github.libtmux.scaladsl.Server.sessions', [
    `extension (self: Server)
  def sessions(
      expression: io.github.libtmux.scaladsl.query.Expr[
        io.github.libtmux.Session
      ]
  ): Vector[Session]`,
    'extension (self: Server) def sessions(): Vector[Session]',
  ]],
  ['kotlin', 'io.github.libtmux.kotlin.Server.sessions', [
    'public suspend fun Server.sessions(): List<Session>',
    `public suspend fun Server.sessions(
    expression: FilterExpr<io.github.libtmux.Session>
): List<Session>`,
  ]],
] as const

const method = (raw: string, params: Signature['params'] = [], typeParams?: string[]): ApiSymbol => ({
  id: 'Probe.method', name: 'method', kind: 'method', modifiers: [],
  signatures: [{ raw, params, typeParams }], source: { file: 'probe' },
})

describe('Scala and Kotlin callable layouts', () => {
  it.fails.each([
    ['withServer', 'policy: ExecutionPolicy =\n        ExecutionPolicy.default(config),'],
    ['withControl', 'timeout: Duration =\n        server.config.defaultTimeout().toKotlinDuration(),'],
    ['Server.control', 'timeout: Duration =\n        config.defaultTimeout().toKotlinDuration(),'],
    ['Server.Companion.open', 'policy: ExecutionPolicy =\n        ExecutionPolicy.default(config),'],
    ['Server.Companion.fromJava', 'policy: ExecutionPolicy =\n        ExecutionPolicy.default(server.config()),'],
    ['Client.fetchAttachment', 'Client.fetchAttachment():\n    ClientAttachment?'],
    ['Server.liveState', 'attachTimeout: Duration =\n        config.defaultTimeout().toKotlinDuration(),'],
    ['Server.withLiveState', 'attachTimeout: Duration =\n        config.defaultTimeout().toKotlinDuration(),'],
  ])('fits the extracted native Kotlin %s header without changing its tokens', async (suffix, continuation) => {
    const symbol = kotlinModel.symbols.find((entry) => entry.id === `io.github.libtmux.kotlin.${suffix}`)!
    const original = symbol.signatures[0]!
    const root = mkdtempSync(join(tmpdir(), 'libtmux-kotlin-width-'))
    try {
      const imports = Object.entries(symbol.imports ?? {}).map(([name, target]) =>
        `import ${target}${target.split('.').at(-1) === name ? '' : ` as ${name}`}`).join('\n')
      const header = `${original.raw} = TODO()`
      const source = suffix.startsWith('Server.Companion.') ? `class Server {\ncompanion object {\n${header}\n}\n}`
        : suffix === 'Server.control' ? `class Server {\n${header}\n}` : header
      writeFileSync(join(root, 'Native.kt'), `package io.github.libtmux.kotlin\n${imports}\n${source}\n`)
      const extracted = (await extractJvm('kotlin', [root])).symbols.find((entry) => entry.id === symbol.id)!
      const signature = extracted.signatures[0]!
      expect(signature.raw).toBe(original.raw)
      expect(signature.params).toEqual(original.params.map(({ doc: _doc, ...param }) => param))
      expect(signature.returns).toBe(original.returns)
      expect(extracted.imports).toEqual(symbol.imports)
      const native = { ...symbol, signatures: extracted.signatures }
      const layout = (await apiSignatureLayouts(native, 'kotlin')).get(signature)!
      expect(layout.failures).toEqual([])
      expect(layout.text).toContain(continuation)
      const index = new SymbolIndex(kotlinModel.symbols, (entry) => `/${entry.id}/`, 'kotlin')
      const spans = signatureSpans(layout, index, native, signature)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual([symbol.name])
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
        .toEqual(signature.params.map((param) => `#${symbol.id}.parameter.${param.name}`))
      const again = { ...native, signatures: [{ ...signature, raw: layout.text }] }
      expect([...(await apiSignatureLayouts(again, 'kotlin')).values()][0]!.text).toBe(layout.text)
      const markdown = fromMarkdown(await symbolMarkdownWithLayout({ model: kotlinModel, symbol: native }))
      const code = markdown.children.find((node) => node.type === 'code')
      expect(code?.type === 'code' && code.value).toBe(layout.text)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each([
    ['scala', 'def method(\n  // Target parameter explanation\n  value: Target\n): Target'],
    ['scala', 'def method(value: Target // Target trailing explanation\n): Target'],
    ['scala', 'def method(value: Target // x\n): Target'],
    ['scala', 'def method(value: Target // Target before comma\n, other: Target): Target'],
    ['scala', 'extension (self: Receiver) // x\n  def method(value: Target): Target'],
    ['kotlin', 'fun method(\n  // Target parameter explanation\n  value: Target\n): Target'],
    ['kotlin', 'fun method(value: Target // Target trailing explanation\n): Target'],
    ['kotlin', 'fun method(value: Target // x\n): Target'],
    ['kotlin', 'fun method(value: Target // Target before comma\n, other: Target): Target'],
  ] as const)('preserves %s line-comment boundaries in %s', async (port, raw) => {
    const symbol = method(raw, [{ name: 'value' }, ...(raw.includes('other:') ? [{ name: 'other' }] : [])])
    const parser = await parserFor(port)
    try {
      const before = parser.parse(raw)!
      expect(before.rootNode.hasError).toBe(false)
      const layout = (await apiSignatureLayouts(symbol, port)).get(symbol.signatures[0]!)!
      const after = parser.parse(layout.text)!
      expect(after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
      expect(layout.text.match(/\/\/[^\n]*/g)).toEqual(raw.match(/\/\/[^\n]*/g))
      expect(layout.failures).toEqual([])
      const target: ApiSymbol = { id: 'Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe' } }
      const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, port)
      const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.link?.href === '/Target/')).toHaveLength(symbol.signatures[0]!.params.length + 1)
      expect(spans.filter((span) => span.link?.href.startsWith('#Probe.method.parameter.')).map((span) => span.text))
        .toEqual(symbol.signatures[0]!.params.map((param) => param.name))
      before.delete()
      after.delete()
    } finally { parser.delete() }
  })

  it.each(fixtures)('matches the native %s formatter study for complete sessions overloads', async (port, id, expected) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const layouts = await apiSignatureLayouts(symbol, port)
    expect([...layouts.values()].map((layout) => layout.text)).toEqual(expected)
    expect([...layouts.values()].flatMap((layout) => layout.failures)).toEqual([])
    const document = await symbolMarkdownWithLayout({ model, symbol })
    const signature = fromMarkdown(document).children.find((node) => node.type === 'code')
    expect(signature?.type === 'code' && signature.value).toBe(expected.join('\n\n'))
  })

  it.each([
    ['scala', 'extension [F[_]](self: Server[F])(using F: Async[F])\ndef method[T <: Target](value: Map[String, Vector[T]])(using context: Context): F[Vector[T]]'],
    ['kotlin', 'public suspend fun <T : Target> Server.method(value: Map<String, List<T>>, select: suspend (T) -> List<T>): List<T>'],
  ] as const)('keeps %s receivers, constraints and nested types in native grammar', async (port, raw) => {
    const symbol = method(raw, [{ name: 'value' }, { name: port === 'scala' ? 'context' : 'select' }], ['T'])
    const layout = (await apiSignatureLayouts(symbol, port)).get(symbol.signatures[0]!)!
    expect(layout).toBeDefined()
    expect(layout.text).toContain(port === 'scala' ? 'extension [F[_]]' : 'public suspend fun <T : Target>')
    expect(layout.text).toContain(port === 'scala' ? 'T <: Target' : '(T) -> List<T>')
    const parser = await parserFor(port)
    try {
      const before = parser.parse(raw)!
      const after = parser.parse(layout.text)!
      expect(after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
      before.delete()
      after.delete()
    } finally { parser.delete() }
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it.each(['scala', 'kotlin'] as const)('preserves %s multiline literals and reports indivisible width failures', async (port) => {
    const literal = '"""first\n  Target stays indented\nlast"""'
    const raw = `${port === 'scala' ? 'def' : 'public fun'} method(value: String = ${literal}): ${'Target'.repeat(14)}`
    const symbol = method(raw, [{ name: 'value' }])
    const layout = (await apiSignatureLayouts(symbol, port)).get(symbol.signatures[0]!)!
    expect(layout).toBeDefined()
    expect(layout.text).toContain(literal)
    expect(layout.text).toContain('Target'.repeat(14))
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
  })

  it.each(['scala', 'kotlin'] as const)('rejects invalid %s headers without claiming a layout', async (port) => {
    const symbol = method(`${port === 'scala' ? 'def' : 'public fun'} method(value: Broken<`)
    await expect(apiSignatureLayouts(symbol, port)).rejects.toThrow(/grammar/)
  })

  it('retains Kotlin nullable punctuation that is not represented by grammar children', async () => {
    const symbol = method('override fun method(other: Any?): String?', [{ name: 'other' }])
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    expect(layout.text).toBe(symbol.signatures[0]!.raw)
  })

  it.each([
    'public fun Server?.method(): Session',
    'public fun method(): Session?',
    'public fun method(value: Map<String, List<Session?>?>?): List<Pane?>?',
    'public fun Server?.method(select: (Session?) -> List<Pane?>): List<Pane?>?',
  ])('preserves nullable receiver, return and function-type grammar in %s', async (raw) => {
    const symbol = method(raw, [{ name: raw.includes('select:') ? 'select' : 'value' }])
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    expect(layout.text.match(/\?/g)).toEqual(raw.match(/\?/g))
    const parser = await parserFor('kotlin')
    try {
      const before = parser.parse(raw)!
      const after = parser.parse(layout.text)!
      expect(after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
      before.delete()
      after.delete()
    } finally { parser.delete() }
  })
})
