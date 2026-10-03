import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builtinHref } from '../src/builtins.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

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

  it('keeps Swift existential any as syntax while resolving the error protocol', () => {
    const swift = new SymbolIndex([], () => '#', 'swift')
    const spans = swift.linkType('any Error')
    expect(spans.map((span) => span.text).join('')).toBe('any Error')
    expect(spans.find((span) => span.text === 'any')).toEqual({ text: 'any', keyword: true })
    expect(spans.find((span) => span.text === 'Error')?.link).toMatchObject({
      href: 'https://developer.apple.com/documentation/swift/error', external: true,
    })
    expect(swift.linkType('any MissingError').find((span) => span.text === 'MissingError')).toEqual({
      text: 'MissingError', link: undefined,
    })
    expect(builtinHref('swift', 'any')).toBeUndefined()
    expect(new SymbolIndex([], () => '#', 'go').linkType('any')[0].link?.href).toBe('https://pkg.go.dev/builtin#any')
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

describe('.NET exception references in F# and C#', () => {
  const exceptions = [
    ['System.Exception', 'system.exception'],
    ['System.ArgumentException', 'system.argumentexception'],
    ['System.ArgumentNullException', 'system.argumentnullexception'],
    ['System.ArgumentOutOfRangeException', 'system.argumentoutofrangeexception'],
    ['System.InvalidOperationException', 'system.invalidoperationexception'],
    ['System.NotSupportedException', 'system.notsupportedexception'],
    ['System.ObjectDisposedException', 'system.objectdisposedexception'],
    ['System.TimeoutException', 'system.timeoutexception'],
    ['System.FormatException', 'system.formatexception'],
    ['System.OperationCanceledException', 'system.operationcanceledexception'],
    ['System.IO.InvalidDataException', 'system.io.invaliddataexception'],
    ['System.Text.Json.JsonException', 'system.text.json.jsonexception'],
    ['System.Threading.Tasks.TaskCanceledException', 'system.threading.tasks.taskcanceledexception'],
  ] as const

  it.each(['fsharp', 'dotnet'])('links verified qualified and imported exception names in %s', (port) => {
    const index = new SymbolIndex([], () => '#', port)
    for (const [qualified, page] of exceptions) {
      for (const name of [qualified, qualified.split('.').at(-1)!]) {
        const href = `https://learn.microsoft.com/dotnet/api/${page}`
        expect(builtinHref(port, name), `${port}:${name}`).toBe(href)
        expect(index.linkType(name)).toEqual([{ text: name, link: { href, external: true } }])
      }
    }
  })

  it('links the real F# tryFindClient Raises type without changing its spelling', () => {
    const model = JSON.parse(readFileSync(new URL('../../../site/src/data/api/fsharp.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.FSharp.Server.tryFindClient')!
    expect(symbol.signatures[0].raises).toEqual([
      { type: 'System.ArgumentException', doc: 'The client name is null, empty or whitespace.' },
    ])
    const index = new SymbolIndex(model.symbols, (entry) => `#${entry.id}`, model.port)
    expect(index.linkType(symbol.signatures[0].raises![0].type, symbol)).toEqual([
      { text: 'System.ArgumentException', link: {
        href: 'https://learn.microsoft.com/dotnet/api/system.argumentexception', external: true,
      } },
    ])
  })

  it('leaves unknown namespaces and exceptions plain without borrowing another language', () => {
    for (const port of ['fsharp', 'dotnet']) {
      const index = new SymbolIndex([], () => '#', port)
      for (const name of ['System.MissingException', 'System.IO.ArgumentException',
        'Other.ArgumentException', 'System.Text.Json.OtherException', 'System.Exceptionish',
        'Newtonsoft.Json.JsonException']) {
        expect(builtinHref(port, name)).toBeUndefined()
        expect(index.linkType(name)).toEqual([{ text: name, link: undefined }])
      }
    }
    for (const port of ['java', 'py', 'kotlin', 'scala']) {
      expect(builtinHref(port, 'System.ArgumentException')).toBeUndefined()
    }
  })

  it.each(['fsharp', 'dotnet'])('retains a local exception definition before a short builtin in %s', (port) => {
    const symbol = { id: 'LibTmux.ArgumentException', name: 'ArgumentException', kind: 'class',
      modifiers: [], signatures: [], source: { file: 'example' }, slug: 'argument-exception' } satisfies ApiSymbol
    const index = new SymbolIndex([symbol], () => '/reference/argument-exception/', port)
    expect(index.resolve('ArgumentException')).toMatchObject({
      href: '/reference/argument-exception/', external: false, symbol,
    })
    expect(index.resolve('System.ArgumentException')).toMatchObject({
      href: 'https://learn.microsoft.com/dotnet/api/system.argumentexception', external: true,
    })
  })
})
