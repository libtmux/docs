import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { CSHARP } from '../src/languages/specs.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function extract(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'csharp-api-'))
  directories.push(directory)
  const file = join(directory, 'Result.cs')
  writeFileSync(file, source)
  return extractWithSpec(CSHARP, file, 'LibTmux')
}

describe('C# positional records', () => {
  it.each(['record', 'record class', 'record struct', 'readonly record struct'])(
    'extracts %s properties, constructor and parameter documentation',
    async (declaration) => {
      const symbols = await extract(`namespace LibTmux;
/// <summary>A command result.</summary>
/// <param name="ExitStatus">The exit status, or null before completion.</param>
/// <param name="Output">Rendered lines, including <c>stderr</c>.</param>
public ${declaration} Result(
    int? ExitStatus,
    IReadOnlyList<string> Output);
`)
      const owner = symbols.find((symbol) => symbol.id === 'LibTmux.Result')!
      expect(owner.doc?.summary).toBe('A command result.')
      expect(owner.signatures[0]?.params).toEqual([
        { name: 'ExitStatus', type: 'int?', doc: 'The exit status, or null before completion.' },
        { name: 'Output', type: 'IReadOnlyList<string>', doc: 'Rendered lines, including <c>stderr</c>.' },
      ])
      expect(
        symbols
          .filter((symbol) => symbol.parent === owner.id)
          .map((symbol) => ({
            name: symbol.name,
            type: symbol.type,
            kind: symbol.kind,
            line: symbol.source.line,
            summary: symbol.doc?.summary,
          })),
      ).toEqual([
        {
          name: 'ExitStatus',
          type: 'int?',
          kind: 'property',
          line: 6,
          summary: 'The exit status, or null before completion.',
        },
        {
          name: 'Output',
          type: 'IReadOnlyList<string>',
          kind: 'property',
          line: 7,
          summary: 'Rendered lines, including <c>stderr</c>.',
        },
      ])
    },
  )

  it('keeps explicitly declared properties and their documentation', async () => {
    const symbols = await extract(`public record Result(string Name) {
    /// <summary>The normalized name.</summary>
    public string Name { get; init; } = Name.Trim();
}`)
    const properties = symbols.filter((symbol) => symbol.id === 'LibTmux.Result.Name')
    expect(properties).toHaveLength(1)
    expect(properties[0].doc?.summary).toBe('The normalized name.')
    expect(properties[0].source.line).toBe(3)
  })

  it('preserves optional constructor and method parameters', async () => {
    const symbols = await extract(`public record Result(
    string? Output = null,
    bool LinesMissed = false,
    bool Started = true,
    int Count = -1,
    string Label = "pending",
    System.StringComparison Comparison = System.StringComparison.Ordinal) {
    public void Read(int count = 4, bool follow = false) {}
}`)
    expect(
      symbols.find((symbol) => symbol.id === 'LibTmux.Result')!.signatures[0].params.map((param) => param.default),
    ).toEqual(['null', 'false', 'true', '-1', '"pending"', 'System.StringComparison.Ordinal'])
    expect(
      symbols.find((symbol) => symbol.id === 'LibTmux.Result.Read')!.signatures[0].params.map((param) => param.default),
    ).toEqual(['4', 'false'])
  })

  it('does not turn ordinary class parameters or private records into public properties', async () => {
    const symbols = await extract('public class Result(int Value) {}\ninternal record Hidden(int Secret);')
    expect(symbols.map((symbol) => symbol.id)).toEqual(['LibTmux.Result'])
  })
})
