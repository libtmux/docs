import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builtinHref, TYPESCRIPT_UTILITY_TYPES } from '../src/builtins.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

describe('standard types in product signatures', () => {
  it('links Scala Using.resource without losing the callee owner or expression', () => {
    const model = JSON.parse(readFileSync(new URL('../../../site/src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
    const context = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.scaladsl.Server')!
    const index = new SymbolIndex(model.symbols, (symbol) => `#${symbol.id}`, 'scala')
    const target = 'https://www.scala-lang.org/api/3.9.0/scala/util/Using$.html#resource-fffffb81'
    for (const callee of ['Using.resource', 'scala.util.Using.resource']) {
      const expression = `${callee}(server) { ... }`
      const spans = index.linkType(expression, context)
      expect(spans.map((span) => span.text).join('')).toBe(expression)
      expect(spans.filter((span) => span.link).map((span) => [span.text, span.link!.href])).toEqual([[callee, target]])
    }
    expect(index.resolve('ResourceOwner.resource', 'any', { ...context, imports: { ResourceOwner: 'scala.util.Using' } })?.href).toBe(target)
    expect(index.resolve('resource', 'any', context)?.symbol?.id).toBe('io.github.libtmux.scaladsl.cats.Server.resource')
    expect(index.resolve('Using.missing', 'any', context)).toBeUndefined()
    for (const expression of ['"Using.resource(server)"', '/* Using.resource(server) */', '// Using.resource(server)']) {
      expect(index.linkType(expression, context).some((span) => span.link)).toBe(false)
    }
    expect(new SymbolIndex([], () => '#', 'java').resolve('Using.resource')).toBeUndefined()
  })

  it('keeps local and imported Scala Using bindings ahead of the prose fallback', () => {
    const owner: ApiSymbol = { id: 'example.Using', name: 'Using', kind: 'module', modifiers: [], signatures: [], source: { file: 'Example.scala' } }
    const member: ApiSymbol = { ...owner, id: 'example.Using.resource', name: 'resource', kind: 'method', parent: owner.id }
    const index = new SymbolIndex([owner, member], (symbol) => `#${symbol.id}`, 'scala')
    expect(index.resolve('Using.resource')).toMatchObject({ href: '#example.Using.resource', external: false })
    expect(index.resolve('Using.resource', 'any', { ...owner, imports: { Using: 'unrelated.Using' } })).toBeUndefined()
    expect(new SymbolIndex([owner], (symbol) => `#${symbol.id}`, 'scala').resolve('Using.resource')).toBeUndefined()
    const ambiguous = new SymbolIndex([owner, member, { ...member, id: 'other.Using.resource' }], (symbol) => `#${symbol.id}`, 'scala')
    expect(ambiguous.resolve('Using.resource')).toBeUndefined()
    expect(new SymbolIndex([], () => '#', 'scala').resolve('Using.resource', 'any', {
      ...owner, id: 'example.operation', name: 'operation', signatures: [{ params: [{ name: 'Using', type: 'CustomOwner' }] }],
    })).toBeUndefined()
  })

  it('links standard PowerShell commands without claiming LibTmux members or other ports', () => {
    const commands = {
      'Get-Member': 'microsoft.powershell.utility',
      'Where-Object': 'microsoft.powershell.core',
      'Invoke-WebRequest': 'microsoft.powershell.utility',
      'Start-ThreadJob': 'threadjob',
      'Receive-Job': 'microsoft.powershell.core',
      'Set-Content': 'microsoft.powershell.management',
    }
    for (const [name, module] of Object.entries(commands)) {
      expect(builtinHref('powershell', name)).toBe(`https://learn.microsoft.com/powershell/module/${module}/${name.toLowerCase()}?view=powershell-7.4`)
      expect(builtinHref('csharp', name)).toBeUndefined()
    }
    for (const name of ['Get-InventedCommand', 'Stop', 'Boolean', 'Name', 'CaptureResult']) {
      expect(builtinHref('powershell', name)).toBeUndefined()
    }
    expect(builtinHref('powershell', 'FileInfo')).toBe('https://learn.microsoft.com/dotnet/api/system.io.fileinfo')
    expect(builtinHref('powershell', 'ApplicationInfo')).toBe('https://learn.microsoft.com/dotnet/api/system.management.automation.applicationinfo?view=powershellsdk-7.4.0')
  })

  it('resolves compiler utility types without claiming local declarations', () => {
    const utilities = new SymbolIndex([], () => '#', 'ts')
    for (const [name, target] of Object.entries(TYPESCRIPT_UTILITY_TYPES)) {
      expect(utilities.resolve(name)).toMatchObject({ href: target, external: true })
      expect(new URL(target).pathname).toBe('/docs/handbook/utility-types.html')
      expect(new URL(target).hash).not.toBe('')
      expect(builtinHref('go', name)).toBeUndefined()
    }
    const local: ApiSymbol = {
      id: 'example.Record', name: 'Record', kind: 'typealias', modifiers: [],
      signatures: [], source: { file: 'example.ts' },
    }
    const index = new SymbolIndex([local], () => '/reference/example-record/', 'ts')
    expect(index.resolve('Record')).toMatchObject({ href: '/reference/example-record/', external: false })
  })

  it.each([
    ['kotlin', 'suspend', 'https://kotlinlang.org/docs/coroutines-basics.html#suspending-functions'],
    ['scala', 'def', 'https://docs.scala-lang.org/tour/basics.html#methods'],
    ['scala', 'extension', 'https://docs.scala-lang.org/scala3/reference/contextual/extension-methods.html'],
    ['fsharp', 'val', 'https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/signature-files'],
  ])('offers %s %s language help without making it an API link', (port, word, href) => {
    const span = new SymbolIndex([], () => '#', port).linkType(word)[0]
    expect(span).toMatchObject({ text: word, keyword: true, help: { href } })
    expect(span.link).toBeUndefined()
    expect(new SymbolIndex([], () => '#', 'java').linkType(word)[0].help).toBeUndefined()
  })

  it('does not inherit object properties as keyword help', () => {
    expect(new SymbolIndex([], () => '#', 'kotlin').linkType('constructor')[0])
      .toEqual({ text: 'constructor', keyword: true })
  })

  it('offers C++ nodiscard help only for the attribute', () => {
    const index = new SymbolIndex([], () => '#', 'cxx')
    for (const declaration of ['[[nodiscard]] bool valid();', '[[nodiscard("check the result")]] bool valid();']) {
      const spans = index.linkType(declaration)
      expect(spans.map((span) => span.text).join('')).toBe(declaration)
      expect(spans.find((span) => span.text === 'nodiscard')).toMatchObject({
        keyword: true, help: { href: 'https://eel.is/c++draft/dcl.attr.nodiscard' },
      })
    }
    for (const declaration of [
      'nodiscard', 'void nodiscard();', '/* [[nodiscard]] */', '"[[nodiscard]]"',
      `void f(const char* value = "don't [[nodiscard]]");`,
      String.raw`void f(const char* value = "say \"[[nodiscard]]\"");`,
      'void f(const char* value = R"tag(say "[[nodiscard]]")tag");',
      'void f(const char* value = u8R"("[[nodiscard]]")");',
    ]) {
      const spans = index.linkType(declaration)
      expect(spans.some((span) => span.help)).toBe(false)
      expect(spans.map((span) => span.text).join('')).toBe(declaration)
    }
    expect(new SymbolIndex([], () => '#', 'java').linkType('[[nodiscard]]').some((span) => span.help)).toBe(false)
  })

  it.each([
    ['kotlin', 'List<String>', 'List', 'https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.collections/-list/'],
    ['scala', 'Option[String]', 'Option', 'https://www.scala-lang.org/api/3.x/scala/Option.html'],
    ['fsharp', "Result<'T, 'Error>", 'Result', 'https://fsharp.github.io/fsharp-core-docs/reference/fsharp-core-fsharpresult-2.html'],
    ['rs', 'Option<OsString>', 'OsString', 'https://doc.rust-lang.org/std/ffi/struct.OsString.html'],
    ['csharp', 'IProgress<T>?', 'IProgress', 'https://learn.microsoft.com/dotnet/api/system.iprogress-1'],
    ['csharp', 'ReadOnlyMemory<byte>', 'ReadOnlyMemory', 'https://learn.microsoft.com/dotnet/api/system.readonlymemory-1'],
    ['csharp', 'IEnumerator<T>', 'IEnumerator', 'https://learn.microsoft.com/dotnet/api/system.collections.generic.ienumerator-1'],
    ['csharp', 'IReadOnlyCollection<Pane>', 'IReadOnlyCollection', 'https://learn.microsoft.com/dotnet/api/system.collections.generic.ireadonlycollection-1'],
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
    for (const port of ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift']) {
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
    ['System.IO.IOException', 'system.io.ioexception'],
    ['System.Text.RegularExpressions.RegexMatchTimeoutException', 'system.text.regularexpressions.regexmatchtimeoutexception'],
    ['System.Text.Json.JsonException', 'system.text.json.jsonexception'],
    ['System.Threading.Tasks.TaskCanceledException', 'system.threading.tasks.taskcanceledexception'],
  ] as const

  it.each(['fsharp', 'csharp'])('links verified qualified and imported exception names in %s', (port) => {
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
    for (const port of ['fsharp', 'csharp']) {
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

  it.each(['fsharp', 'csharp'])('retains a local exception definition before a short builtin in %s', (port) => {
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
