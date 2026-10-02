import { describe, expect, it } from 'vitest'
import { builtinHref } from '../src/builtins.ts'
import { SymbolIndex } from '../src/link.ts'

describe('standard types in product signatures', () => {
  it.each([
    ['kotlin', 'List<String>', 'List', 'https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.collections/-list/'],
    ['scala', 'Option[String]', 'Option', 'https://www.scala-lang.org/api/3.x/scala/Option.html'],
    ['fsharp', "Result<'T, 'Error>", 'Result', 'https://fsharp.github.io/fsharp-core-docs/reference/fsharp-core-fsharpresult-2.html'],
    ['rs', 'Option<OsString>', 'OsString', 'https://doc.rust-lang.org/std/ffi/struct.OsString.html'],
    ['dotnet', 'IProgress<T>?', 'IProgress', 'https://learn.microsoft.com/dotnet/api/system.iprogress-1'],
    ['dotnet', 'ReadOnlyMemory<byte>', 'ReadOnlyMemory', 'https://learn.microsoft.com/dotnet/api/system.readonlymemory-1'],
    ['cxx', 'std::function<void(double)>', 'double', 'https://en.cppreference.com/w/cpp/language/types'],
    ['swift', 'Data', 'Data', 'https://developer.apple.com/documentation/foundation/data'],
    ['swift', 'AsyncStream<String>', 'AsyncStream', 'https://developer.apple.com/documentation/swift/asyncstream'],
    ['py', 'Unpack[Config]', 'Unpack', 'https://docs.python.org/3/library/typing.html#typing.Unpack'],
  ])('links %s %s to its language documentation', (port, annotation, name, href) => {
    const index = new SymbolIndex([], () => '#', port)
    const linked = index.linkType(annotation).find((span) => span.text === name)?.link
    expect(linked).toMatchObject({ href, external: true })
  })

  it('does not classify placeholders, return labels, or dependency types as builtins', () => {
    for (const port of ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']) {
      for (const name of ['T', 'Self', 'Integer', 'tools', 'err', 'ILogger', 'IServiceCollection', 'McpServer']) {
        expect(builtinHref(port, name), `${port}:${name}`).toBeUndefined()
      }
    }
    expect(builtinHref('go', 'OsString')).toBeUndefined()
    expect(builtinHref('rs', 'Data')).toBeUndefined()
  })

  it('keeps inherited object properties out of documentation URLs', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(builtinHref('scala', name)).toBeUndefined()
      expect(builtinHref(name, 'toString')).toBeUndefined()
    }
    const index = new SymbolIndex([], () => '#', 'scala')
    const signature = index.linkType('override def toString: String')
    expect(signature.find((span) => span.text === 'toString')?.link).toBeUndefined()
    expect(signature.find((span) => span.text === 'String')?.link?.href).toMatch(/^https:\/\//)
  })

  it('uses Scala collections before bare aliases from the JDK inventory', () => {
    const index = new SymbolIndex([], () => '#', 'scala')
    index.addInventory('https://docs.oracle.com/', ['Vector', 'java.util.Vector'].map((name) => ({
      name, type: 'class', priority: 1, uri: 'java/util/Vector.html', dispname: '-',
    })), ['scala'], 'Java SE')
    expect(index.resolve('Vector')?.href).toBe('https://www.scala-lang.org/api/3.x/scala/collection/immutable/Vector.html')
    expect(index.resolve('java.util.Vector')?.href).toBe('https://docs.oracle.com/java/util/Vector.html')
    expect(index.resolve('def')).toBeUndefined()
    expect(index.resolve('extension')).toBeUndefined()
  })
})
