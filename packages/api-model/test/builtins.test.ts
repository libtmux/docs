import { describe, expect, it } from 'vitest'
import { builtinHref } from '../src/builtins.ts'
import { SymbolIndex } from '../src/link.ts'

describe('standard types in product signatures', () => {
  it.each([
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
    for (const port of ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']) {
      for (const name of ['T', 'Self', 'Integer', 'tools', 'err', 'ILogger', 'IServiceCollection', 'McpServer']) {
        expect(builtinHref(port, name), `${port}:${name}`).toBeUndefined()
      }
    }
    expect(builtinHref('go', 'OsString')).toBeUndefined()
    expect(builtinHref('rs', 'Data')).toBeUndefined()
  })
})
