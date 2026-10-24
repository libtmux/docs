// Outer: compares both source inventories with an installed native compiler.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { supportsCSignatures } from '../src/lib/code-layout'
import { formatCDeclaration, formatCEnumDeclaration } from '../src/lib/cxx-code-layout'
import { tmuxSourceModel } from '../src/lib/tmux-reference'

const VERSIONS = ['3.2a', '3.7c'] as const

/** The formatter the fixtures pin, when this machine has it. */
function clangFormat(): ((texts: string[], limit: number) => string[]) | undefined {
  try {
    if (!/clang-format version 21\./.test(execFileSync('clang-format', ['--version'], { encoding: 'utf8' }))) return undefined
  } catch { return undefined }
  const style = (limit: number) => `{BasedOnStyle: LLVM, ColumnLimit: ${limit}, PointerAlignment: Right, AlignAfterOpenBracket: Align, BinPackParameters: true, ContinuationIndentWidth: 4, IndentWidth: 2}`
  return (texts, limit) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-clang-'))
    try {
      const files = texts.map((text, index) => {
        const path = join(directory, `${index}.c`)
        writeFileSync(path, `${text}\n`)
        return path
      })
      // Separate files preserve each declaration's original formatting context.
      execFileSync('clang-format', ['-i', `--style=${style(limit)}`, ...files])
      return files.map((path) => readFileSync(path, 'utf8').trimEnd())
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}
const clang = clangFormat()

describe.skipIf(!clang)('C layouts agree with the clang-format on this machine', () => {
  it('formats a sample of the declarations in both tmux versions as clang-format does', () => {
    const raws = new Map<string, string>()
    for (const version of VERSIONS) {
      for (const symbol of tmuxSourceModel(version).symbols) {
        if (!supportsCSignatures(symbol, 'c') || symbol.kind === 'enum') continue
        for (const signature of symbol.signatures) raws.set(signature.raw!, symbol.id)
      }
    }
    const sample = [...raws.keys()].filter((_, at) => at % 20 === 0)
    expect(sample.length).toBeGreaterThan(100)
    const strip = (text: string) => text.endsWith(';') ? text.slice(0, -1) : text
    const disagreements: unknown[] = []
    const terminated = sample.map((raw) => raw.trimEnd().endsWith(';') ? raw : `${raw};`)
    const at60 = clang!(terminated, 60)
    const at61 = clang!(terminated, 61)
    for (const [index, raw] of sample.entries()) {
      const actual = formatCDeclaration(raw, 60)
      if (raw.trimEnd().endsWith(';')) {
        if (actual !== at60[index]) disagreements.push({ raw, expected: at60[index], actual })
        continue
      }
      // The page never prints the `;` clang-format needs, so it takes no column. Where clang-format
      // with the `;` in the last column keeps every line within 60, the two agree exactly; where it
      // does not, the last line is at the limit or clang-format with the `;` inside 60 agrees.
      const outside = strip(at61[index]!)
      const inside = strip(at60[index]!)
      const exact = outside.split('\n').every((line) => line.length <= 60)
      if (exact ? actual !== outside : actual !== inside && actual.split('\n').at(-1)!.length !== 60) disagreements.push({ raw, outside, inside, actual })
    }
    expect(disagreements).toEqual([])
  }, 60_000)

  it('formats enums as clang-format does', () => {
    const raws = new Set<string>()
    for (const version of VERSIONS) {
      for (const symbol of tmuxSourceModel(version).symbols) {
        if (symbol.kind === 'enum' && supportsCSignatures(symbol, 'c')) for (const signature of symbol.signatures) raws.add(signature.raw!)
      }
    }
    expect(raws.size).toBeGreaterThan(50)
    const disagreements: unknown[] = []
    const sample = [...raws]
    const terminated = sample.map((raw) => raw.trimEnd().endsWith(';') ? raw : `${raw};`)
    const at60 = clang!(terminated, 60)
    const at61 = clang!(terminated, 61)
    for (const [index, raw] of sample.entries()) {
      const terminated = raw.trimEnd().endsWith(';')
      const expected = terminated ? at60[index]! : at61[index]!.slice(0, -1)
      if (expected.split('\n').some((line) => line.length > 60)) continue
      const actual = formatCEnumDeclaration(raw, 60)
      if (actual !== expected) disagreements.push({ raw, expected, actual })
    }
    expect(disagreements).toEqual([])
  }, 60_000)
})
