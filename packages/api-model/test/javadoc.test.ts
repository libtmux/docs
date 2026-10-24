import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { javadocToMarkdown, parseJavadoc } from '../src/doc/javadoc.ts'
import { javadocSymbols } from '../src/javadoc.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { JAVA } from '../src/languages/specs.ts'

describe('Javadoc search-index URLs', () => {
  it('preserves module ownership, nested classes and authoritative fragments', () => {
    const symbols = javadocSymbols([
      { l: 'java.lang', m: 'java.base' }, { l: 'java.net.http', m: 'java.net.http' },
      { l: 'java.util', m: 'java.base' }, { l: 'java.util.logging', m: 'java.logging' },
    ], [
      { p: 'java.lang', l: 'AutoCloseable' }, { p: 'java.net.http', l: 'HttpClient' },
      { p: 'java.util', l: 'Map.Entry' }, { p: 'java.util.logging', l: 'Logger', m: 'java.logging' },
      { l: 'All Classes', u: 'allclasses-index.html' },
    ], [
      { p: 'java.lang', c: 'AutoCloseable', l: 'close()' },
      { p: 'java.util', c: 'Map.Entry', l: 'getKey()' },
      { p: 'java.util', c: 'ArrayList', l: 'ArrayList(int)', u: '%3Cinit%3E(int)' },
      { p: 'java.util.logging', c: 'Logger', l: 'log(Level, String)', u: 'log(java.util.logging.Level,java.lang.String)' },
      { p: 'java.lang', c: 'System', l: 'getenv()' },
      { p: 'java.lang', c: 'System', l: 'getenv(String)', u: 'getenv(java.lang.String)' },
    ])
    const uri = (name: string) => symbols.find((symbol) => symbol.id === name)?.uri
    expect(uri('AutoCloseable')).toBe('java.base/java/lang/AutoCloseable.html')
    expect(uri('java.net.http.HttpClient')).toBe('java.net.http/java/net/http/HttpClient.html')
    expect(uri('Map.Entry')).toBe('java.base/java/util/Map.Entry.html')
    expect(uri('Logger')).toBe('java.logging/java/util/logging/Logger.html')
    expect(uri('AutoCloseable.close')).toBe('java.base/java/lang/AutoCloseable.html#close()')
    expect(uri('java.lang.AutoCloseable.close')).toBe('java.base/java/lang/AutoCloseable.html#close()')
    expect(uri('Map.Entry.getKey')).toBe('java.base/java/util/Map.Entry.html#getKey()')
    expect(uri('ArrayList.ArrayList')).toBe('java.base/java/util/ArrayList.html#%3Cinit%3E(int)')
    expect(uri('Logger.log')).toBe('java.logging/java/util/logging/Logger.html#log(java.util.logging.Level,java.lang.String)')
  })

  it('gives each name one entry and the nullary overload its own', () => {
    const symbols = javadocSymbols([{ l: 'java.lang', m: 'java.base' }], [], [
      { p: 'java.lang', c: 'System', l: 'getenv()' },
      { p: 'java.lang', c: 'System', l: 'getenv(String)', u: 'getenv(java.lang.String)' },
    ])
    const ids = symbols.map((symbol) => symbol.id)
    expect(new Set(ids).size, 'a name is listed once').toBe(ids.length)
    const uri = (name: string) => symbols.find((symbol) => symbol.id === name)?.uri
    expect(uri('System.getenv()')).toBe('java.base/java/lang/System.html#getenv()')
    expect(uri('java.lang.System.getenv()')).toBe('java.base/java/lang/System.html#getenv()')
    expect(uri('System.getenv')).toBe('java.base/java/lang/System.html#getenv(java.lang.String)')
    expect(uri('System.getenv(String)')).toBeUndefined()
  })

  it('requires unambiguous authoritative package ownership', () => {
    const type = [{ p: 'example.shared', l: 'Type' }]
    const packages = [{ l: 'example.shared', m: 'one' }, { l: 'example.shared', m: 'two' }]
    expect(() => javadocSymbols([], type, [])).toThrow('missing or ambiguous module')
    expect(() => javadocSymbols(packages, type, [])).toThrow('missing or ambiguous module')
    expect(() => javadocSymbols(packages, [{ ...type[0], m: 'missing' }], [])).toThrow('unknown module missing')
    expect(javadocSymbols(packages, [{ ...type[0], m: 'two' }], [])[0].uri).toBe('two/example/shared/Type.html')
  })
})

describe('Javadoc <pre> blocks keep their own indentation', () => {
  const code = 'try (Server server = Server.open(config)) {\n    Session mine = server.sessions().stream()\n            .filter(session -> session.id().equals(id))\n            .findFirst();\n}'

  it('removes only the comment margin and the block\'s common indent', () => {
    expect(parseJavadoc(`Summary.\n\n<pre>{@code\n${code}\n}</pre>`).doc.examples).toEqual([{ lang: 'java', code, intro: undefined }])
    // The same block indented as a whole loses that shared indent and nothing else.
    const shared = code.split('\n').map((line) => `   ${line}`).join('\n')
    expect(parseJavadoc(`Summary.\n\n<pre>{@code\n${shared}\n}</pre>`).doc.examples?.[0]?.code).toBe(code)
  })

  it('keeps the indentation of a first line that is indented and of blank lines between statements', () => {
    expect(parseJavadoc('Summary.\n\n<pre>{@code\n    first();\n\n        nested();\n    last();\n}</pre>').doc.examples?.[0]?.code)
      .toBe('first();\n\n    nested();\nlast();')
    expect(javadocToMarkdown('<pre>{@code\n  a\n\n  b\n}</pre>')).toContain('```java\na\n\nb\n```')
  })

  it('still reflows prose and leaves an unindented block as it was', () => {
    const doc = parseJavadoc('First line of the summary\nwraps here.\n\n<p>A second paragraph\nthat wraps.\n\n<pre>{@code\nplain();\n}</pre>').doc
    expect(doc.summary).toBe('First line of the summary wraps here.')
    expect(doc.body).toBe('A second paragraph\nthat wraps.')
    expect(doc.examples?.[0]?.code).toBe('plain();')
  })

  it('carries the indentation from a source comment through extraction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'javadoc-indentation-'))
    try {
      const file = join(dir, 'Env.java')
      writeFileSync(file, `package example;
/**
 * Where a process runs.
 *
 * <pre>{@code
 * TmuxEnvironment here = TmuxEnvironment.current().orElseThrow();
 *
 * try (Server server = Server.open(here.config())) {
 *     Session mine = server.sessions().stream()
 *             .filter(session -> session.id().equals(here.session()))
 *             .findFirst()
 *             .orElseThrow();
 * }
 * }</pre>
 */
public final class Env {}
`)
      const [symbol] = await extractWithSpec(JAVA, file, 'example')
      expect(symbol.doc?.examples?.[0]?.code).toBe(`TmuxEnvironment here = TmuxEnvironment.current().orElseThrow();

try (Server server = Server.open(here.config())) {
    Session mine = server.sessions().stream()
            .filter(session -> session.id().equals(here.session()))
            .findFirst()
            .orElseThrow();
}`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
