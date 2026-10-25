import { describe, expect, it } from 'vitest'
import { attachCompleteCSharpExamples } from '../src/languages/csharp-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const source = { repo: 'libtmux/libtmux-dotnet', revision: 'a'.repeat(40) }
const fixture = () => {
  const program = {
    id: 'csharp-ServerConstruction', profile: 'csharp', title: 'Connect to a server',
    description: 'Discover a live server through a configured endpoint.',
    sourceFile: 'examples/LibTmux.Examples/Programs/ServerConstruction.cs',
    targets: ['M:LibTmux.Server.ConnectAsync(LibTmux.ServerConnectionOptions,System.Threading.CancellationToken)',
      'M:LibTmux.Server.ConnectAsync(System.Threading.CancellationToken)', 'T:LibTmux.Server'],
    output: 'connected\n',
  }
  const manifest = {
    schemaVersion: 1,
    profiles: { csharp: { package: 'LibTmux', projectFile: 'examples/api/csharp/Example.csproj', entrypoint: 'Program.cs' } },
    setupFiles: ['global.json', 'examples/api/NuGet.config'], examples: [program],
  }
  const files = new Map([
    ['global.json', '{"sdk":{"version":"10.0.302"}}\n'],
    ['examples/api/NuGet.config', '<?xml version="1.0"?>\n<configuration />\n'],
    ['examples/api/csharp/Example.csproj', '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="LibTmux" Version="[0.0.0-alpha.24]" />\n  </ItemGroup>\n</Project>\n'],
    [program.sourceFile, '\n// Complete file, including every blank line.\nusing System;\nConsole.WriteLine("connected");\n\n'],
  ])
  const symbols: ApiSymbol[] = [
    { id: 'LibTmux.Server.ConnectAsync', name: 'ConnectAsync', kind: 'method', modifiers: ['overload'],
      signatures: [{ params: [{ name: 'options', type: 'ServerConnectionOptions?' },
        { name: 'cancellationToken', type: 'CancellationToken' }] },
      { params: [{ name: 'cancellationToken', type: 'CancellationToken' }] }],
      source: { file: 'Server.Identity.cs' }, slug: 'server-connectasync',
      doc: { summary: 'Native method documentation.', examples: [{ lang: 'csharp', code: 'existing inline example' }] } },
    { id: 'LibTmux.Server', name: 'Server', kind: 'class', modifiers: [], signatures: [],
      source: { file: 'Server.cs' }, slug: 'server', doc: { summary: 'Native type documentation.' } },
  ]
  const read = (path: string) => path === 'examples/api/manifest.json' ? JSON.stringify(manifest) : files.get(path)
  return { manifest, files, symbols, read }
}

describe('complete C# API programs', () => {
  it('preserves native declarations and attaches one exact program per overload page', () => {
    const { manifest, files, symbols, read } = fixture()
    const before = structuredClone(symbols)
    attachCompleteCSharpExamples(symbols, read, source)
    for (const [index, symbol] of symbols.entries()) {
      const original = before[index].doc?.examples ?? []
      expect({ ...symbol, doc: before[index].doc }).toEqual(before[index])
      const all = symbol.doc!.examples!
      expect(all.slice(0, original.length)).toEqual(original)
      const blocks = all.slice(original.length)
      expect(blocks).toHaveLength(4)
      for (const [i, path] of ['examples/api/csharp/Example.csproj', manifest.examples[0].sourceFile].entries()) {
        expect(blocks[i].code).toBe(files.get(path))
        expect(blocks[i].sourceUrl).toBe(`https://github.com/${source.repo}/blob/${source.revision}/${path}`)
      }
      expect(blocks[0].intro).toContain('the .NET 10 SDK or newer')
      expect(blocks[0].intro).toContain('0.0.0-alpha.24 release of `LibTmux` on NuGet')
      expect(blocks.some((block) => /git clone|libtmux-source|NuGet\.config|global\.json/.test(block.code))).toBe(false)
      expect(blocks[1].lang).toBe('csharp')
      expect(blocks[1].intro).toContain('`Program.cs`')
      expect(blocks[2].code).toBe('$ dotnet build Example.csproj --configuration Release && \\\n' +
        '  dotnet bin/Release/net8.0/Example.dll && \\\n  dotnet bin/Release/net10.0/Example.dll\n')
      expect(blocks[3].code).toBe(manifest.examples[0].output)
    }
  })

  it('retains separate complete programs sharing a page', () => {
    const { manifest, files, symbols, read } = fixture()
    const first = manifest.examples[0]
    const second = { ...first, id: 'csharp-OtherConnection',
      sourceFile: first.sourceFile.replace('ServerConstruction', 'OtherConnection'), targets: [first.targets[0]], output: 'second\n' }
    files.set(second.sourceFile, 'System.Console.WriteLine("second");\n')
    manifest.examples.push(second)
    attachCompleteCSharpExamples(symbols, read, source)
    const blocks = symbols[0].doc!.examples!
    expect(blocks).toHaveLength(9)
    expect(blocks[2].code).toBe(files.get(first.sourceFile))
    expect(blocks[6].code).toBe(files.get(second.sourceFile))
    expect(blocks[8].code).toBe('second\n')
    expect(symbols[1].doc!.examples).toHaveLength(4)
  })

  it('maps generic owner and method arities while retaining native property and method kinds', () => {
    const { manifest, symbols, read } = fixture()
    manifest.examples[0].targets = ['P:LibTmux.CapturedRelation`1.IsCaptured',
      'M:LibTmux.Query.QueryExtensions.Matching``1(System.Collections.Generic.IEnumerable{``0},LibTmux.Query.QueryDocument)']
    symbols[0].id = 'LibTmux.CapturedRelation.IsCaptured'
    symbols[0].kind = 'property'
    symbols[1].id = 'LibTmux.Query.QueryExtensions.Matching'
    symbols[1].kind = 'method'
    attachCompleteCSharpExamples(symbols, read, source)
    expect(symbols.map((symbol) => symbol.doc!.examples!.length)).toEqual([5, 4])
  })

  it('leaves historical source and an F#-only manifest unchanged', () => {
    const { manifest, symbols, read } = fixture()
    const before = structuredClone(symbols)
    attachCompleteCSharpExamples(symbols, () => undefined, source)
    const old = manifest as unknown as { profiles: Record<string, unknown>; examples: { profile: string }[] }
    old.profiles = { fsharp: {} }
    old.examples[0].profile = 'fsharp'
    attachCompleteCSharpExamples(symbols, read, source)
    expect(symbols).toEqual(before)
  })

  it('rejects unknown source identities, ambiguity and wrong kinds without guessing a short name', () => {
    for (const target of ['M:LibTmux.Other.ConnectAsync(System.Threading.CancellationToken)',
      'P:LibTmux.Server.ConnectAsync', 'T:LibTmux.Server.ConnectAsync', 'F:LibTmux.Server']) {
      const { manifest, symbols, read } = fixture()
      manifest.examples[0].targets = [target]
      expect(() => attachCompleteCSharpExamples(symbols, read, source)).toThrow(/target/)
    }
    const ambiguous = fixture()
    ambiguous.symbols.push(structuredClone(ambiguous.symbols[0]))
    expect(() => attachCompleteCSharpExamples(ambiguous.symbols, ambiguous.read, source)).toThrow('must resolve once')
  })

  it('rejects repeated full compiler IDs before grouping distinct overload targets', () => {
    const { manifest, symbols, read } = fixture()
    manifest.examples[0].targets.push(manifest.examples[0].targets[0])
    expect(() => attachCompleteCSharpExamples(symbols, read, source)).toThrow('Duplicate C# compiler target')
  })

  it('rejects missing source and unsafe paths without trimming or repairing program bytes', () => {
    for (const bytes of ['', 'no final newline', 'windows\r\n']) {
      const { manifest, files, symbols, read } = fixture()
      files.set(manifest.examples[0].sourceFile, bytes)
      expect(() => attachCompleteCSharpExamples(symbols, read, source)).toThrow('complete LF-terminated')
    }
    const invalid = fixture()
    invalid.manifest.examples[0].sourceFile = 'examples/../private.cs'
    expect(() => attachCompleteCSharpExamples(invalid.symbols, invalid.read, source)).toThrow('Invalid C# example metadata')
  })

  it('requires the exact source revision, SDK, package and setup contract', () => {
    const invalid = fixture()
    expect(() => attachCompleteCSharpExamples(invalid.symbols, invalid.read, { ...source, revision: 'main' }))
      .toThrow('full source revision')
    invalid.manifest.setupFiles.pop()
    expect(() => attachCompleteCSharpExamples(invalid.symbols, invalid.read, source)).toThrow('Invalid C# example manifest')
    const sdk = fixture()
    sdk.files.set('global.json', '{"sdk":{"version":"latest"}}\n')
    expect(() => attachCompleteCSharpExamples(sdk.symbols, sdk.read, source)).toThrow('pinned SDK')
    const packageProfile = fixture()
    packageProfile.manifest.profiles.csharp.package = 'LibTmux.FSharp'
    expect(() => attachCompleteCSharpExamples(packageProfile.symbols, packageProfile.read, source)).toThrow('Invalid C# example profile')
  })

  it('refuses a consumer project that does not reference one exact release', () => {
    for (const project of ['<Project Sdk="Microsoft.NET.Sdk" />\n',
      '<Project><ItemGroup><PackageReference Include="LibTmux.Other" Version="[0.0.0-alpha.24]" /></ItemGroup></Project>\n']) {
      const { files, symbols, read } = fixture()
      files.set('examples/api/csharp/Example.csproj', project)
      expect(() => attachCompleteCSharpExamples(symbols, read, source)).toThrow('must reference one exact')
    }
  })
})
