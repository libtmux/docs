import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parserFor, parentInventory, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { apiSignatureLayouts, codeWidthFailures, signatureSpans } from '../src/lib/code-layout'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { extractJvm } from '../../packages/api-model/src/languages/jvm'

const kotlinModel = JSON.parse(readFileSync(new URL('../src/data/api/kotlin.json', import.meta.url), 'utf8')) as ApiModel

const scalaModel = JSON.parse(readFileSync(new URL('../src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
const javaModel = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
const scalaParameterLayouts = [
  ['io.github.libtmux.scaladsl.cats.Pane.capture', 1, `extension [F[_]](self: Pane[F])(using
    F: _root_.cats.effect.Async[F]
)
  def capture(
      configure:
          io.github.libtmux.CaptureSpec.Builder => Unit
  ): F[Vector[String]]`],
  ['io.github.libtmux.scaladsl.cats.Server.newSession', 1, `extension [F[_]](self: Server[F])(using
    F: _root_.cats.effect.Async[F]
)
  def newSession(
      configure:
          io.github.libtmux.SessionSpec.Builder => Unit
  ): F[Session[F]]`],
  ['io.github.libtmux.scaladsl.cats.Server.isAlive', 1, `extension [F[_]](self: Server[F])(using
    F: _root_.cats.effect.Async[F]
)
  def isAlive(
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): F[Boolean]`],
  ['io.github.libtmux.scaladsl.cats.Server.killServer', 1, `extension [F[_]](self: Server[F])(using
    F: _root_.cats.effect.Async[F]
)
  def killServer(
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): F[Unit]`],
  ['io.github.libtmux.scaladsl.cats.Server.cmd', 2, `extension [F[_]](self: Server[F])(using
    F: _root_.cats.effect.Async[F]
)
  def cmd(
      argv: Vector[String],
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): F[io.github.libtmux.transport.CommandResult]`],
  ['io.github.libtmux.scaladsl.cats.Session.newWindow', 1, `extension [F[_]](self: Session[F])(using
    F: _root_.cats.effect.Async[F]
)
  def newWindow(
      configure:
          io.github.libtmux.WindowSpec.Builder => Unit
  ): F[Window[F]]`],
  ['io.github.libtmux.scaladsl.Pane.capture', 1, `extension (self: Pane)
  def capture(
      configure:
          io.github.libtmux.CaptureSpec.Builder => Unit
  ): Vector[String]`],
  ['io.github.libtmux.scaladsl.Server.newSession', 1, `extension (self: Server)
  def newSession(
      configure:
          io.github.libtmux.SessionSpec.Builder => Unit
  ): Session`],
  ['io.github.libtmux.scaladsl.Server.isAlive', 1, `extension (self: Server)
  def isAlive(
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): Boolean`],
  ['io.github.libtmux.scaladsl.Server.killServer', 1, `extension (self: Server)
  def killServer(
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): Unit`],
  ['io.github.libtmux.scaladsl.Server.cmd', 2, `extension (self: Server)
  def cmd(
      argv: Vector[String],
      timeout:
          _root_.scala.concurrent.duration.FiniteDuration
  ): io.github.libtmux.transport.CommandResult`],
  ['io.github.libtmux.scaladsl.Session.newWindow', 1, `extension (self: Session)
  def newWindow(
      configure:
          io.github.libtmux.WindowSpec.Builder => Unit
  ): Window`],
] as const

const scalaReturnLayouts = [
  ['io.github.libtmux.scaladsl.generated.PaneFields.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.command', 0, `def command:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.active', 0, `def active:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.title', 0, `def title:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.path', 0, `def path:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.atTop', 0, `def atTop:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.atBottom', 0, `def atBottom:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.atLeft', 0, `def atLeft:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.PaneFields.atRight', 0, `def atRight:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.SessionFields.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.generated.SessionFields.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.generated.SessionFields.attached', 0, `def attached:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.generated.SessionFields.windows', 0, `def windows:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToManyRef[
    JavaSession,
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.active', 0, `def active:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.linked', 0, `def linked:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.panes', 0, `def panes:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToManyRef[
    JavaWindow,
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.generated.WindowFields.session', 0, `def session:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToOneRef[
    JavaWindow,
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.generated.ClientFields.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaClient
  ]`],
  ['io.github.libtmux.scaladsl.generated.ClientFields.session', 0, `def session:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToOneRef[
    JavaClient,
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.Client.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaClient
  ]`],
  ['io.github.libtmux.scaladsl.Client.session', 0, `def session:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToOneRef[
    JavaClient,
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.Pane.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.command', 0, `def command:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.active', 0, `def active:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.title', 0, `def title:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.path', 0, `def path:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.atTop', 0, `def atTop:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.atBottom', 0, `def atBottom:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.atLeft', 0, `def atLeft:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Pane.atRight', 0, `def atRight:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Session.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.Session.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.Session.attached', 0, `def attached:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaSession
  ]`],
  ['io.github.libtmux.scaladsl.Session.windows', 0, `def windows:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToManyRef[
    JavaSession,
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.Window.id', 0, `def id:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.Window.name', 0, `def name:
  _root_.io.github.libtmux.scaladsl.query.Fields.TextField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.Window.active', 0, `def active:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.Window.linked', 0, `def linked:
  _root_.io.github.libtmux.scaladsl.query.Fields.FlagField[
    JavaWindow
  ]`],
  ['io.github.libtmux.scaladsl.Window.panes', 0, `def panes:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToManyRef[
    JavaWindow,
    JavaPane
  ]`],
  ['io.github.libtmux.scaladsl.Window.session', 0, `def session:
  _root_.io.github.libtmux.scaladsl.query.Fields.ToOneRef[
    JavaWindow,
    JavaSession
  ]`],
] as const

const scalaUnresolvedReturns = [
  ['io.github.libtmux.scaladsl.generated.PaneFields.index', 0],
  ['io.github.libtmux.scaladsl.generated.PaneFields.width', 0],
  ['io.github.libtmux.scaladsl.generated.PaneFields.height', 0],
  ['io.github.libtmux.scaladsl.generated.PaneFields.left', 0],
  ['io.github.libtmux.scaladsl.generated.PaneFields.top', 0],
  ['io.github.libtmux.scaladsl.generated.SessionFields.windowCount', 0],
  ['io.github.libtmux.scaladsl.generated.WindowFields.index', 0],
  ['io.github.libtmux.scaladsl.generated.WindowFields.width', 0],
  ['io.github.libtmux.scaladsl.generated.WindowFields.height', 0],
  ['io.github.libtmux.scaladsl.generated.WindowFields.paneCount', 0],
  ['io.github.libtmux.scaladsl.Pane.index', 0],
  ['io.github.libtmux.scaladsl.Pane.width', 0],
  ['io.github.libtmux.scaladsl.Pane.height', 0],
  ['io.github.libtmux.scaladsl.Pane.left', 0],
  ['io.github.libtmux.scaladsl.Pane.top', 0],
  ['io.github.libtmux.scaladsl.Session.windowCount', 0],
  ['io.github.libtmux.scaladsl.Window.index', 0],
  ['io.github.libtmux.scaladsl.Window.width', 0],
  ['io.github.libtmux.scaladsl.Window.height', 0],
  ['io.github.libtmux.scaladsl.Window.paneCount', 0],
] as const

let scalaExtraction: Promise<ApiModel> | undefined
async function extractedScala() {
  return scalaExtraction ??= (async () => {
    const root = mkdtempSync(join(tmpdir(), 'libtmux-scala-width-'))
    try {
      for (const [i, source] of Object.values(scalaModel.generatedSources!).entries()) {
        const directory = join(root, String(i))
        mkdirSync(directory)
        writeFileSync(join(directory, 'Native.scala'), source)
      }
      return await extractJvm('scala', [root], scalaModel.revision)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })()
}

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
  it.each(scalaUnresolvedReturns)('reports the remaining Scala return width in %s', async (id, ordinal) => {
    const symbol = scalaModel.symbols.find((entry) => entry.id === id)!
    const signature = symbol.signatures[ordinal]!
    const layout = (await apiSignatureLayouts(symbol, 'scala')).get(signature)!
    expect(layout.failures).toEqual([{ line: 2, columns: 61, limit: 60 }])
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    const qualified = signature.returns!.split('[')[0]!
    expect(layout.text).toContain(`\n  ${qualified}[`)
    const index = new SymbolIndex(scalaModel.symbols, (entry) => `/${entry.id}/`, 'scala')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(layout.text)
    expect(spans.filter((span) => span.text === qualified).map((span) => span.link?.href))
      .toEqual(['/io.github.libtmux.scaladsl.query.Fields.NumberField/'])
    const again = { ...symbol, signatures: [{ ...signature, raw: layout.text }] }
    expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(layout.text)
  })

  it.each([59, 60, 61, 62])('retains the Scala return boundary at %s columns', async (columns) => {
    const type = `Target${'X'.repeat(columns - 'def method: Target'.length)}`
    const raw = `def method: ${type}`
    const symbol = method(raw)
    const layout = (await apiSignatureLayouts(symbol, 'scala')).get(symbol.signatures[0]!)!
    expect(layout.text).toBe(columns <= 60 ? raw : `def method:\n  ${type}`)
    expect(layout.failures).toEqual([])
  })

  it.each([
    'TargetWithUnusuallyLongButSingleName',
    'Vector[TargetWithUnusuallyLongButSingleName]',
    'Map[Target, TargetWithUnusuallyLongButSingleName]',
    '() => TargetWithUnusuallyLongButSingleName',
    '(Target, TargetWithUnusuallyLongButSingleName) => Target',
    'Target & TargetWithUnusuallyLongButSingleName',
    'Target | TargetWithUnusuallyLongButSingleName',
    'TargetWithUnusuallyLongButSingleName @unchecked',
    '/* Target: exact  spaces */ TargetWithUnusuallyLongButSingleName',
    '// Target: exact  spaces\nTargetWithUnusuallyLongButSingleName',
  ])('preserves extracted Scala return grammar and literals in %s', async (type) => {
    const name = 'methodWithAnExplicitNameForReturnType'
    const raw = `def ${name}: ${type}`
    const root = mkdtempSync(join(tmpdir(), 'libtmux-scala-return-'))
    try {
      writeFileSync(join(root, 'Probe.scala'), `package probe\nclass Target\nclass TargetWithUnusuallyLongButSingleName\nobject Probe {\n${raw} = ???\n}`)
      const model = await extractJvm('scala', [root])
      const symbol = model.symbols.find((entry) => entry.id === `probe.Probe.${name}`)!
      const signature = symbol.signatures[0]!
      expect(signature.raw).toBe(raw)
      const layout = (await apiSignatureLayouts(symbol, 'scala')).get(signature)!
      const parser = await parserFor('scala')
      const before = parser.parse(raw)!
      const after = parser.parse(layout.text)!
      try {
        expect(before.rootNode.hasError || after.rootNode.hasError).toBe(false)
        expect(after.rootNode.toString()).toBe(before.rootNode.toString())
        const literals = ['comment', 'block_comment', 'string', 'interpolated_string_expression']
        expect(after.rootNode.descendantsOfType(literals).map((node) => [node!.type, node!.text]))
          .toEqual(before.rootNode.descendantsOfType(literals).map((node) => [node!.type, node!.text]))
      } finally { before.delete(); after.delete(); parser.delete() }
      expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
      const spans = signatureSpans(layout, new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'scala'), symbol, signature)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.link?.href.startsWith('#'))).toEqual([])
      const again = { ...symbol, signatures: [{ ...signature, raw: layout.text }] }
      expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(layout.text)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each(scalaReturnLayouts)('fits the extracted Scala return continuation in %s', async (id, ordinal, expected) => {
    const symbol = scalaModel.symbols.find((entry) => entry.id === id)!
    const source = (await extractedScala()).symbols.find((entry) => entry.id === (symbol.exportedFrom ?? id))!
    const signature = symbol.signatures[ordinal]!
    expect(signature).toEqual(source.signatures[0])
    const before = JSON.stringify(symbol)
    const layouts = await apiSignatureLayouts(symbol, 'scala')
    const layout = layouts.get(signature)!
    expect(layout.failures).toEqual([])
    expect(layout.text).toBe(expected)
    expect(JSON.stringify(symbol)).toBe(before)
    const parser = await parserFor('scala')
    const input = parser.parse(signature.raw!)!
    const output = parser.parse(layout.text)!
    try {
      expect(input.rootNode.hasError || output.rootNode.hasError).toBe(false)
      expect(output.rootNode.toString()).toBe(input.rootNode.toString())
    } finally { input.delete(); output.delete(); parser.delete() }
    const index = new SymbolIndex(scalaModel.symbols, (entry) => `/en/scala/latest/reference/${entry.slug}/`, 'scala')
    index.addInventory('', parentInventory(javaModel, (entry) => `/en/java/latest/reference/${entry.slug}/`), ['scala'], 'libtmux Java')
    const spans = signatureSpans(layout, index, symbol, signature)
    expect(spans.map((span) => span.text).join('')).toBe(expected)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual([symbol.name])
    expect(spans.filter((span) => span.link?.href.startsWith('#'))).toEqual([])
    const qualified = signature.returns!.split('[')[0]!
    const nativeType = scalaModel.symbols.find((entry) => entry.id === qualified.replace(/^_root_\./, ''))!
    expect(spans.filter((span) => span.text === qualified).map((span) => span.link?.href))
      .toEqual([`/en/scala/latest/reference/${nativeType.slug}/`])
    for (const name of signature.returns!.match(/\[([^\]]+)\]/)![1]!.split(', ')) {
      const native = javaModel.symbols.find((entry) => entry.kind === 'class' && entry.qualifiedName === `io.github.libtmux.${name.replace(/^Java/, '')}`)!
      expect(spans.filter((span) => span.text === name).map((span) => span.link?.href))
        .toEqual([`/en/java/latest/reference/${native.slug}/`])
    }
    const again = { ...symbol, signatures: [{ ...signature, raw: layout.text }] }
    expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(expected)
    const markdown = fromMarkdown(await symbolMarkdownWithLayout({ model: scalaModel, symbol }))
    const code = markdown.children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe([...layouts.values()].map((item) => item.text).join('\n\n'))
  })

  it.each([
    'io.github.example.QualifiedTarget',
    '=> io.github.example.QualifiedTarget',
    'io.github.example.QualifiedTarget*',
    '(Target, Target) => Target',
    'Target & io.github.example.QualifiedTarget',
    'Target | io.github.example.QualifiedTarget',
    'Map[String, Vector[Target]]',
    '/* Target: keep */ Target',
    '// Target: keep\nTarget',
    'Target = "Target: keep  spaces"',
    'Target = """first\n  Target: keep spaces\nlast"""',
    'Target = s"Target: ${Target()}"',
  ])('preserves extracted Scala parameter syntax and literals in %s', async (type) => {
    const raw = `def method(configurationValueForAnOperation: ${type}): Target`
    const root = mkdtempSync(join(tmpdir(), 'libtmux-scala-parameter-'))
    try {
      writeFileSync(join(root, 'Probe.scala'), `package probe\nclass Target\nobject Probe {\n${raw} = ???\n}`)
      const model = await extractJvm('scala', [root])
      const symbol = model.symbols.find((entry) => entry.id === 'probe.Probe.method')!
      const signature = symbol.signatures[0]!
      expect(signature.raw).toBe(raw)
      expect(signature.params.map((param) => param.name)).toEqual(['configurationValueForAnOperation'])
      const layout = (await apiSignatureLayouts(symbol, 'scala')).get(signature)!
      const parser = await parserFor('scala')
      const before = parser.parse(raw)!
      const after = parser.parse(layout.text)!
      try {
        expect(before.rootNode.hasError || after.rootNode.hasError).toBe(false)
        expect(after.rootNode.toString()).toBe(before.rootNode.toString())
        const literals = ['comment', 'block_comment', 'string', 'interpolated_string_expression']
        expect(after.rootNode.descendantsOfType(literals).map((node) => [node!.type, node!.text]))
          .toEqual(before.rootNode.descendantsOfType(literals).map((node) => [node!.type, node!.text]))
      } finally { before.delete(); after.delete(); parser.delete() }
      expect(layout.failures).toEqual([])
      const spans = signatureSpans(layout, new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'scala'), symbol, signature)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
        .toEqual(['#probe.Probe.method.parameter.configurationValueForAnOperation'])
      const again = { ...symbol, signatures: [{ ...signature, raw: layout.text }] }
      expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(layout.text)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each([59, 60, 61, 62])('wraps Scala parameter types only beyond the %s-column boundary', async (columns) => {
    const type = `Target${'X'.repeat(columns - '    value: Target'.length)}`
    const symbol = method(`def method(value: ${type}): Target`, [{ name: 'value', type }])
    const layout = (await apiSignatureLayouts(symbol, 'scala')).get(symbol.signatures[0]!)!
    expect(layout.text).toBe(columns <= 60
      ? `def method(\n    value: ${type}\n): Target`
      : `def method(\n    value:\n        ${type}\n): Target`)
    expect(layout.failures).toEqual([])
  })

  it('keeps extracted Scala receiver, context and backtick parameter ownership', async () => {
    const raw = `extension [F[_]](self: Receiver[F])(using F: Async[F])
def method[T <: Target](\`a parameter.with spaces\`: Vector[T], timeout: _root_.scala.concurrent.duration.FiniteDuration)(using trace: Trace[F]): F[T]`
    const root = mkdtempSync(join(tmpdir(), 'libtmux-scala-context-'))
    try {
      writeFileSync(join(root, 'Probe.scala'), `package probe\nclass Receiver[F[_]]\nclass Target\nclass T\n${raw} = ???`)
      const model = await extractJvm('scala', [root])
      const symbol = model.symbols.find((entry) => entry.id === 'probe.Receiver.method')!
      const signature = symbol.signatures[0]!
      expect(signature.raw).toBe(raw)
      expect(signature.receiver).toEqual({ name: 'self', type: 'Receiver[F]' })
      expect(signature.params.map((param) => param.name)).toEqual(['`a parameter.with spaces`', 'timeout', 'trace'])
      const layout = (await apiSignatureLayouts(symbol, 'scala')).get(signature)!
      expect(layout.failures).toEqual([])
      expect(layout.text).toContain('timeout:\n          _root_.scala.concurrent.duration.FiniteDuration')
      const spans = signatureSpans(layout, new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'scala'), symbol, signature)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
        .toEqual(signature.params.map((param) => [param.name, `#${encodeURIComponent(`${symbol.id}.parameter.${param.name}`)}`]))
      expect(spans.filter((span) => span.link?.href === '/probe.T/')).toEqual([])
      expect(spans.find((span) => span.text === 'self')?.link).toBeUndefined()
      // The extension's own F is a type parameter of the extracted method.
      const parameter = `/probe.Receiver.method/#${encodeURIComponent('probe.Receiver.method.type-parameter.F')}`
      // The `F` in `using F: Async[F]` names a value; the five references to the type all link.
      expect(spans.filter((span) => span.text === 'F' && span.link).map((span) => span.link!.href)).toEqual(Array(5).fill(parameter))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each([
    'Indivisible'.repeat(9),
    `String = "${'indivisible '.repeat(9)}"`,
    `/* ${'indivisible '.repeat(9)}*/ Target`,
  ])('retains explicit Scala width failures for an indivisible %s', async (type) => {
    const symbol = method(`def method(configurationValueForAnOperation: ${type}): Target`, [{ name: 'configurationValueForAnOperation' }])
    const layout = (await apiSignatureLayouts(symbol, 'scala')).get(symbol.signatures[0]!)!
    expect(layout.text).toContain(type)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    const again = { ...symbol, signatures: [{ ...symbol.signatures[0]!, raw: layout.text }] }
    expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(layout.text)
  })

  it.each(scalaParameterLayouts)('fits the extracted Scala parameter continuation in %s', async (id, ordinal, expected) => {
    const symbol = scalaModel.symbols.find((entry) => entry.id === id)!
    const extracted = (await extractedScala()).symbols.find((entry) => entry.id === id)!
    expect(extracted.signatures).toEqual(symbol.signatures)
    const native = { ...symbol, signatures: extracted.signatures }
    const signature = native.signatures[ordinal]!
    const layouts = await apiSignatureLayouts(native, 'scala')
    const layout = layouts.get(signature)!
    expect(layout.failures).toEqual([])
    expect(layout.text).toBe(expected)
    const index = new SymbolIndex(scalaModel.symbols, (entry) => `/${entry.id}/`, 'scala')
    index.addInventory('', parentInventory(javaModel, (entry) => `/java/${entry.id}/`), ['scala'], 'libtmux Java')
    const spans = signatureSpans(layout, index, native, signature)
    expect(spans.map((span) => span.text).join('')).toBe(expected)
    expect(spans.filter((span) => span.declarationName).map((span) => span.text)).toEqual([symbol.name])
    expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => [span.text, span.link!.href]))
      .toEqual(signature.params.map((param) => [param.name, `#${id}.parameter.${param.name}`]))
    const parameterType = signature.params.at(-1)!.type!
    const qualifiedType = parameterType.replace(/ => Unit$/, '')
    const target = qualifiedType.startsWith('_root_.scala.')
      ? 'https://www.scala-lang.org/api/3.x/scala/concurrent/duration/FiniteDuration.html'
      : `/java/${javaModel.symbols.find((entry) => entry.qualifiedName === qualifiedType && entry.kind === 'class')!.id}/`
    expect(spans.filter((span) => span.text === qualifiedType).map((span) => span.link?.href)).toEqual([target])
    const again = { ...native, signatures: [{ ...signature, raw: layout.text }] }
    expect([...(await apiSignatureLayouts(again, 'scala')).values()][0]!.text).toBe(expected)
    const markdown = fromMarkdown(await symbolMarkdownWithLayout({ model: scalaModel, symbol: native }))
    const code = markdown.children.find((node) => node.type === 'code')
    expect(code?.type === 'code' && code.value).toBe([...layouts.values()].map((item) => item.text).join('\n\n'))
  })

  it.each([
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
    ['String', '"Target = exact:  spaces"', 1],
    ['Target', '/* Target = note */ Target()', 3],
    ['Target', '// Target = note\n Target()', 3],
    ['Target', 'Target() /* Target note */', 3],
    ['String', '"""first\n  Target = exact: spaces\nlast"""', 1],
    ['String', '"Target = ${Target()}"', 2],
  ] as const)('preserves Kotlin default tokens and links for %s = %s', async (type, value, links) => {
    const name = 'configurationValueWithAnExplicitDefault'
    const raw = `public fun method(${name}: ${type} = ${value}): Target`
    const symbol = method(raw, [{ name, type, default: value }])
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    const parser = await parserFor('kotlin')
    const before = parser.parse(raw)!
    const after = parser.parse(layout.text)!
    try {
      expect(before.rootNode.hasError || after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
      const literalKinds = ['string_literal', 'line_comment', 'multiline_comment']
      expect(after.rootNode.descendantsOfType(literalKinds).map((node) => node && [node.type, node.text]))
        .toEqual(before.rootNode.descendantsOfType(literalKinds).map((node) => node && [node.type, node.text]))
      expect(layout.failures).toEqual([])
      const target: ApiSymbol = { id: 'Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe' } }
      const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'kotlin')
      const spans = signatureSpans(layout, index, symbol, symbol.signatures[0]!)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      expect(spans.filter((span) => span.link?.href === '/Target/')).toHaveLength(links)
      expect(spans.filter((span) => span.link?.href.startsWith('#')).map((span) => span.link!.href))
        .toEqual([`#Probe.method.parameter.${name}`])
    } finally { before.delete(); after.delete(); parser.delete() }
  })

  it.each([
    'Map<String, List<Target?>?>?',
    '((Target?) -> List<Target?>)?',
    '/* Target */ Target?',
    '// Target\n Target?',
  ])('retains Kotlin return grammar while wrapping %s', async (returns) => {
    const raw = `public suspend fun ReceiverWithARealName.method(): ${returns}`
    const symbol = method(raw)
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    const parser = await parserFor('kotlin')
    const before = parser.parse(raw)!
    const after = parser.parse(layout.text)!
    try {
      expect(before.rootNode.hasError || after.rootNode.hasError).toBe(false)
      expect(after.rootNode.toString()).toBe(before.rootNode.toString())
      expect(layout.text.match(/\?/g)).toEqual(raw.match(/\?/g))
      expect(layout.failures).toEqual([])
      const again = method(layout.text)
      expect([...(await apiSignatureLayouts(again, 'kotlin')).values()][0]!.text).toBe(layout.text)
    } finally { before.delete(); after.delete(); parser.delete() }
  })

  it.each([58, 59, 60, 61, 62])('keeps compact Kotlin headers at the %s-column boundary', async (columns) => {
    const name = `method${'X'.repeat(columns - 'public fun method(): Target'.length)}`
    const raw = `public fun ${name}(): Target`
    const symbol = { ...method(raw), name }
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    expect(raw.length).toBe(columns)
    expect(layout.text).toBe(columns <= 60 ? raw : `public fun ${name}():\n    Target`)
    expect(layout.failures).toEqual([])
  })

  it.each([
    `${'Indivisible'.repeat(9)}()`,
    `"${'indivisible '.repeat(9)}"`,
    `/* ${'indivisible '.repeat(9)}*/ Target()`,
  ])('reports indivisible Kotlin default width without altering %s', async (value) => {
    const name = 'configurationValueWithAnExplicitDefault'
    const raw = `public fun method(${name}: Target = ${value}): Target`
    const symbol = method(raw, [{ name }])
    const layout = (await apiSignatureLayouts(symbol, 'kotlin')).get(symbol.signatures[0]!)!
    expect(layout.text).toContain(value)
    expect(layout.failures.length).toBeGreaterThan(0)
    expect(layout.failures).toEqual(await codeWidthFailures(layout.text, 'api'))
    const again = method(layout.text, [{ name }])
    expect([...(await apiSignatureLayouts(again, 'kotlin')).values()][0]!.text).toBe(layout.text)
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
