import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractJvm } from '../src/languages/jvm.ts'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true })))
function fixture(file: string, code: string) {
  const dir = mkdtempSync(join(tmpdir(), 'libtmux-api-jvm-'))
  directories.push(dir)
  writeFileSync(join(dir, file), code)
  return dir
}

describe('native JVM declarations', () => {
  it('collects Kotlin constructor properties, companion members and generated extensions', async () => {
    const root = fixture('Pane.kt', `package example

/** A pane in one server. */
public class Pane internal constructor(internal val java: JavaPane, public val server: Server) {
    public companion object {
        /** Open a pane. */
        public fun open(name: String = "work"): Pane = TODO()
    }
    internal fun implementation(): Unit = TODO()
}

/** Read the visible screen.
 * @param trim remove trailing spaces
 * @return the captured rows
 */
public suspend fun Pane.capture(trim: Boolean = true): List<String> = TODO()

/** Read scrollback too. */
public suspend fun Pane.capture(start: Int): List<String> = TODO()
`)
    writeFileSync(join(root, 'Fields.kt'), `package example.query
import example.Pane as KotlinPane

/** The pane id. */
public val KotlinPane.Companion.id: TextField<JavaPane>
    get() = TODO()
`)
    const { symbols } = await extractJvm('kotlin', [root])
    expect(symbols.map((s) => s.id)).toEqual(expect.arrayContaining([
      'example.Pane', 'example.Pane.server', 'example.Pane.Companion',
      'example.Pane.Companion.open', 'example.Pane.Companion.id', 'example.Pane.capture',
    ]))
    expect(symbols.some((s) => /\.java$|\.implementation$/.test(s.id))).toBe(false)
    expect(symbols.find((s) => s.id === 'example.Pane')!.signatures[0]).toMatchObject({ raw: 'public class Pane', params: [] })
    const capture = symbols.find((s) => s.id === 'example.Pane.capture')!
    expect(capture.parent).toBe('example.Pane')
    expect(capture.modifiers).toEqual(['async', 'overload'])
    expect(capture.signatures).toHaveLength(2)
    expect(capture.signatures[0]).toMatchObject({
      raw: 'public suspend fun Pane.capture(trim: Boolean = true): List<String>',
      params: [{ name: 'trim', type: 'Boolean', default: 'true', doc: 'remove trailing spaces' }],
      returns: 'List<String>', returnsDoc: 'the captured rows',
    })
    expect(symbols.find((s) => s.id === 'example.Pane.Companion.id')!.parent).toBe('example.Pane.Companion')
  })

  it('retains Scala 3 opaque companions, extension receivers, givens and enum cases', async () => {
    const root = fixture('Pane.scala', `package example

/** A pane handle. */
opaque type Pane = JavaPane

object Pane {
  export example.Fields.*
  private[example] def wrap(java: JavaPane): Pane = java
  given CanEqual[Pane, Pane] = CanEqual.derived
  extension (self: Pane) {
    /** The captured id. */
    def id: String = self.id()
  }
}

extension (self: Pane) {
  /** Capture output. */
  def capture(trim: Boolean = true): List[String] = Nil
}

enum Missing {
  case NoMatch
  case Several(count: Int)
}

class Box[T] private[example] (private val value: T) {
  def get: T = value
}

object Fields {
  /** The command field used to build a predicate. */
  def command: TextField[JavaPane] = TODO
}
`)
    const { symbols } = await extractJvm('scala', [root])
    const pane = symbols.find((s) => s.id === 'example.Pane')!
    expect(pane.kind).toBe('typealias')
    expect(pane.signatures.map((sig) => sig.raw)).toEqual(['opaque type Pane = JavaPane', 'object Pane'])
    expect(pane.modifiers).not.toContain('overload')
    expect(symbols.some((s) => s.name === 'wrap')).toBe(false)
    expect(symbols.find((s) => s.id === 'example.Pane.id')!.signatures[0]).toMatchObject({
      raw: 'extension (self: Pane)\ndef id: String', returns: 'String',
    })
    expect(symbols.find((s) => s.id === 'example.Pane.capture')!.parent).toBe('example.Pane')
    expect(symbols.map((s) => s.id)).toEqual(expect.arrayContaining([
      'example.Pane.given_CanEqual_Pane_Pane', 'example.Missing.NoMatch', 'example.Missing.Several',
    ]))
    expect(symbols.find((s) => s.id === 'example.Missing.Several')!.signatures[0].params)
      .toEqual([{ name: 'count', type: 'Int', doc: undefined }])
    expect(symbols.find((s) => s.id === 'example.Box')!.signatures[0])
      .toMatchObject({ raw: 'class Box[T]', params: [] })
    expect(symbols.some((s) => s.id === 'example.Box.get')).toBe(true)
    expect(symbols.find((s) => s.id === 'example.Pane.command'))
      .toMatchObject({ parent: 'example.Pane', exportedFrom: 'example.Fields.command',
        signatures: [{ raw: 'def command: TextField[JavaPane]', returns: 'TextField[JavaPane]' }] })
  })

  it('keeps a Scala using clause separate from the extension receiver', async () => {
    const root = fixture('Handle.scala', `package example
class Handle[F[_]]
extension [F[_]](self: Handle[F])(using F: Effect[F]) {
  def capture: F[String] = TODO
}
`)
    const { symbols } = await extractJvm('scala', [root])
    expect(symbols.find((symbol) => symbol.id === 'example.Handle.capture'))
      .toMatchObject({ parent: 'example.Handle', signatures: [{
        raw: 'extension [F[_]](self: Handle[F])(using F: Effect[F])\ndef capture: F[String]',
      }] })
  })

  it.each(['kotlin', 'scala'] as const)('rejects broken public %s syntax', async (port) => {
    const root = fixture(port === 'kotlin' ? 'Broken.kt' : 'Broken.scala', 'package example\nclass Missing(\n')
    await expect(extractJvm(port, [root])).rejects.toThrow(/unparsed public/)
  })
})
