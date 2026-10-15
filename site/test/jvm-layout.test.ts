import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parserFor, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, codeWidthFailures } from '../src/lib/code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

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
