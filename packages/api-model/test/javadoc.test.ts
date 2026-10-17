import { describe, expect, it } from 'vitest'
import { javadocSymbols } from '../src/javadoc.ts'

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

  it('requires unambiguous authoritative package ownership', () => {
    const type = [{ p: 'example.shared', l: 'Type' }]
    const packages = [{ l: 'example.shared', m: 'one' }, { l: 'example.shared', m: 'two' }]
    expect(() => javadocSymbols([], type, [])).toThrow('missing or ambiguous module')
    expect(() => javadocSymbols(packages, type, [])).toThrow('missing or ambiguous module')
    expect(() => javadocSymbols(packages, [{ ...type[0], m: 'missing' }], [])).toThrow('unknown module missing')
    expect(javadocSymbols(packages, [{ ...type[0], m: 'two' }], [])[0].uri).toBe('two/example/shared/Type.html')
  })
})
