import { describe, expect, it } from 'vitest'
import { attachCompleteFSharpExamples } from '../src/languages/fsharp-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const source = { repo: 'libtmux/libtmux-dotnet', revision: 'a'.repeat(40) }
const fixture = () => {
  const program = {
    id: 'fsharp-SnapshotAccess',
    profile: 'fsharp',
    title: 'Read captured state',
    description: 'Read captured state without confusing it with an uncaptured relation.',
    sourceFile: 'examples/LibTmux.FSharp.Examples/Programs/SnapshotAccess.fs',
    targets: [
      'M:LibTmux.FSharp.Snapshot.relation``1(LibTmux.CapturedRelation{``0})',
      'T:LibTmux.FSharp.CaptureState`1',
    ],
    output: 'captured\n',
  }
  const manifest = {
    schemaVersion: 1,
    profiles: {
      fsharp: {
        package: 'LibTmux.FSharp',
        projectFile: 'examples/api/fsharp/Example.fsproj',
        entrypoint: 'Program.fs',
      },
    },
    setupFiles: ['global.json', 'examples/api/NuGet.config'],
    examples: [program],
  }
  const files = new Map([
    ['global.json', '{"sdk":{"version":"10.0.302"}}\n'],
    ['examples/api/NuGet.config', '<?xml version="1.0"?>\n<configuration />\n'],
    ['examples/api/fsharp/Example.fsproj', '<Project Sdk="Microsoft.NET.Sdk" />\n'],
    [program.sourceFile, '\n// Complete source file, including every blank line.\nopen LibTmux.FSharp\n\n'],
  ])
  const symbols: ApiSymbol[] = [
    {
      id: 'LibTmux.FSharp.Snapshot.relation',
      name: 'relation',
      kind: 'function',
      modifiers: [],
      signatures: [],
      source: { file: 'Library.fsi' },
      slug: 'snapshot-relation',
      doc: {
        summary: 'Native function documentation.',
        examples: [{ lang: 'fsharp', code: 'existing inline example' }],
      },
    },
    {
      id: 'LibTmux.FSharp.CaptureState',
      name: 'CaptureState',
      kind: 'enum',
      modifiers: [],
      signatures: [],
      source: { file: 'Library.fsi' },
      slug: 'capturestate',
      doc: { summary: 'Native type documentation.' },
    },
  ]
  const read = (path: string) => (path === 'examples/api/manifest.json' ? JSON.stringify(manifest) : files.get(path))
  return { manifest, files, symbols, read }
}

describe('complete F# API programs', () => {
  it('maps source-verified XML IDs to stable source identities and appends exact complete files', () => {
    const { manifest, files, symbols, read } = fixture()
    const before = structuredClone(symbols)
    attachCompleteFSharpExamples(symbols, read, source)
    for (const [index, symbol] of symbols.entries()) {
      const original = before[index].doc?.examples ?? []
      expect({ ...symbol, doc: before[index].doc }).toEqual(before[index])
      const all = symbol.doc!.examples!
      expect(all.slice(0, original.length)).toEqual(original)
      const blocks = all.slice(original.length)
      expect(blocks).toHaveLength(7)
      expect(blocks[0].code).toContain(`checkout --detach ${source.revision}`)
      expect(blocks[0].intro).toContain('.NET SDK 10.0.302')
      for (const [i, path] of [
        'global.json',
        'examples/api/NuGet.config',
        'examples/api/fsharp/Example.fsproj',
        manifest.examples[0].sourceFile,
      ].entries()) {
        expect(blocks[i + 1].code).toBe(files.get(path))
        expect(blocks[i + 1].sourceUrl).toBe(`https://github.com/${source.repo}/blob/${source.revision}/${path}`)
      }
      expect(blocks[4].lang).toBe('fsharp')
      expect(blocks[4].intro).toContain('Program.fs')
      expect(blocks[5].code).toContain('dotnet restore Example.fsproj --configfile NuGet.config')
      expect(blocks[5].code).toContain('dotnet bin/Release/net8.0/Example.dll && \\\n')
      expect(blocks[5].code).toContain('dotnet bin/Release/net10.0/Example.dll\n')
      expect(blocks[6].code).toBe(manifest.examples[0].output)
    }
  })

  it('preserves a second complete program on the same API page', () => {
    const { manifest, files, symbols, read } = fixture()
    const first = manifest.examples[0]
    const second = {
      ...first,
      id: 'fsharp-LookupFailures',
      sourceFile: first.sourceFile.replace('SnapshotAccess', 'LookupFailures'),
      targets: [first.targets[0]],
      output: 'failure kept\n',
    }
    files.set(second.sourceFile, 'printfn "failure kept"\n')
    manifest.examples.push(second)
    attachCompleteFSharpExamples(symbols, read, source)
    const blocks = symbols[0].doc!.examples!
    expect(blocks).toHaveLength(15)
    expect(blocks[5].code).toBe(files.get(first.sourceFile))
    expect(blocks[12].code).toBe(files.get(second.sourceFile))
    expect(blocks[14].code).toBe('failure kept\n')
    expect(symbols[1].doc!.examples).toHaveLength(7)
  })

  it('leaves historical source without an opt-in manifest unchanged', () => {
    const { symbols } = fixture()
    const before = structuredClone(symbols)
    attachCompleteFSharpExamples(symbols, () => undefined, source)
    expect(symbols).toEqual(before)
  })

  it('rejects missing, ambiguous and wrong-kind targets instead of attaching by short name', () => {
    for (const target of ['M:LibTmux.FSharp.Other.relation(System.String)', 'T:LibTmux.FSharp.Snapshot.relation']) {
      const { manifest, symbols, read } = fixture()
      manifest.examples[0].targets = [target]
      expect(() => attachCompleteFSharpExamples(symbols, read, source)).toThrow(
        'must resolve once with its native kind',
      )
    }
    const ambiguous = fixture()
    ambiguous.symbols.push(structuredClone(ambiguous.symbols[0]))
    expect(() => attachCompleteFSharpExamples(ambiguous.symbols, ambiguous.read, source)).toThrow('must resolve once')
  })

  it('rejects repeated targets, including two compiler signatures mapping to one source name', () => {
    for (const target of [
      fixture().manifest.examples[0].targets[0],
      'M:LibTmux.FSharp.Snapshot.relation(System.String)',
    ]) {
      const { manifest, symbols, read } = fixture()
      manifest.examples[0].targets.push(target)
      expect(() => attachCompleteFSharpExamples(symbols, read, source)).toThrow('Duplicate F# example target')
    }
  })

  it('rejects incomplete source files and unsafe paths without trimming or repairing the program', () => {
    for (const bytes of ['', 'no final newline', 'windows\r\n']) {
      const { manifest, files, symbols, read } = fixture()
      files.set(manifest.examples[0].sourceFile, bytes)
      expect(() => attachCompleteFSharpExamples(symbols, read, source)).toThrow('complete LF-terminated')
    }
    const invalid = fixture()
    invalid.manifest.examples[0].sourceFile = 'examples/../private.fs'
    expect(() => attachCompleteFSharpExamples(invalid.symbols, invalid.read, source)).toThrow(
      'Invalid F# example metadata',
    )
  })

  it('requires the exact source revision, SDK and setup contract', () => {
    const invalid = fixture()
    expect(() => attachCompleteFSharpExamples(invalid.symbols, invalid.read, { ...source, revision: 'main' })).toThrow(
      'full source revision',
    )
    invalid.manifest.setupFiles.pop()
    expect(() => attachCompleteFSharpExamples(invalid.symbols, invalid.read, source)).toThrow(
      'Invalid F# example manifest',
    )
    const sdk = fixture()
    sdk.files.set('global.json', '{"sdk":{"version":"latest"}}\n')
    expect(() => attachCompleteFSharpExamples(sdk.symbols, sdk.read, source)).toThrow('pinned SDK')
  })
})
