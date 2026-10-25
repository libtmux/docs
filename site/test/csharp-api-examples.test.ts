import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import data from '../src/data/api/csharp.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = data as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'csharp')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')
/**
 * The released InputCapture program carries one comment line past the 100-column example limit. The limit
 * is waived for that line, at that length, in that program at that source revision, so a second wide
 * comment or a new pin is checked again.
 */
const WAIVED = {
  programId: 'csharp-InputCapture',
  revision: '0e25b51502c3a3879325aa0dbc1868f5940b233f',
  line: '// PS1 rides on the command because a non-interactive bash default-shell drops it from the environment.',
  length: 103,
}
const commentLines = (code: string) => code.split('\n').filter((line) => /^\s*\/\//.test(line))
/** The comment lines of a displayed program that are wider than an example comment may be. */
const tooWide = (code: string, programId: string, revision: string) => commentLines(code).filter((line) =>
  line.length > 100 && !(programId === WAIVED.programId && revision === WAIVED.revision
    && line === WAIVED.line && line.length === WAIVED.length))

describe('verified complete C# API programs', () => {
  it('covers all native targets while grouping native overloads onto their existing pages', () => {
    expect(examples).toHaveLength(30)
    expect(new Set(examples.map((example) => 'sourceProgramId' in example && example.sourceProgramId)).size).toBe(7)
    expect(new Set(examples.map((example) => example.page)).size).toBe(30)
    const covered = model.symbols.filter((symbol) => symbol.doc?.examples?.some(
      (block) => block.sourceUrl?.includes('/examples/LibTmux.Examples/Programs/'))).map((symbol) => symbol.id)
    expect([...new Set(examples.map((example) => example.symbol))].sort()).toEqual(covered.sort())
    const targets = examples.flatMap((example) => 'sourceCompilerIds' in example ? example.sourceCompilerIds : [])
    expect(targets).toHaveLength(33)
    expect(new Set(targets).size).toBe(33)
  })

  it.each(examples)('keeps complete $sourceProgramId bytes on $symbol in Markdown and copy payloads', (example) => {
    if (!('sourceProgramId' in example) || typeof example.sourceProgramId !== 'string' ||
        !('sourceCompilerIds' in example) || !Array.isArray(example.sourceCompilerIds) ||
        !('consoleBlocks' in example) || !example.consoleBlocks) {
      throw new Error(`${example.symbol}: missing source program receipt`)
    }
    const symbols = model.symbols.filter((symbol) => symbol.id === example.symbol)
    expect(symbols).toHaveLength(1)
    const symbol = symbols[0]
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(example.page).toBe(`ports/csharp/reference/${symbol.slug}`)
    for (const target of example.sourceCompilerIds) {
      expect(target.slice(2).replace(/\(.*$/, '').replace(/`{1,2}\d+/g, '')).toBe(symbol.id)
    }
    expect(example.files).toHaveLength(4)
    for (const file of example.files) {
      const label = `${example.symbol}/${file.name}`
      if (!('clipboardSha256' in file) || !('sourceFile' in file) || !('path' in file)) {
        throw new Error(`${label}: incomplete source file receipt`)
      }
      const block = blocks[file.block]
      expect(hash(block.code), `${example.symbol}/${file.path}`).toBe(file.sha256)
      expect(hash(block.code.replace(/\n$/, ''))).toBe(file.clipboardSha256)
      expect(exported.some((entry) => hash(entry.value + '\n') === file.sha256)).toBe(true)
      expect(block.sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${file.sourceFile}`)
      expect(markdown).toContain(`[Source example](${block.sourceUrl}).`)
      expect(block.intro).toContain(file.path)
      expect(tooWide(block.code, example.sourceProgramId, example.sourceRevision), `${example.symbol}/${file.path}`).toEqual([])
    }
    expect(example.consoleBlocks.map((index) => blocks[index].code.replace(/^\$ /gm, '').trim()))
      .toEqual(example.shellRecipe)
    const output = blocks[example.consoleBlocks[1] + 1].code.trimEnd().split('\n')
    expect(example.expectedOutputs[1]).toEqual([...output, ...output])
    for (const index of example.consoleBlocks) {
      expect(blocks[index].lang).toBe('console')
      expect(exported.some((entry) => entry.value + '\n' === blocks[index].code)).toBe(true)
    }
    const program = blocks[example.files[3].block]
    expect(program.lang).toBe('csharp')
    expect(program.code).toContain('Server.CreateOwnedAsync')
    expect(program.code).toContain('await using')
    expect(program.code).toContain('using System;')
    expect(program.code).toContain('CancellationTokenSource')
  })

  it('waives one released comment line and nothing else', () => {
    const displayed = examples.flatMap((example) => example.files.map((file) => ({
      programId: 'sourceProgramId' in example ? example.sourceProgramId : '',
      revision: example.sourceRevision,
      code: (model.symbols.find((symbol) => symbol.id === example.symbol)?.doc?.examples ?? [])[file.block]?.code ?? '',
    })))
    // The waiver is still needed: that line is displayed, and it is the only one over the limit.
    const wide = displayed.flatMap((entry) => commentLines(entry.code).filter((line) => line.length > 100))
    expect(wide.length).toBeGreaterThan(0)
    expect(new Set(wide)).toEqual(new Set([WAIVED.line]))
    expect(WAIVED.line).toHaveLength(WAIVED.length)

    // A second wide comment in the same program at the same revision fails, as does the waived line
    // anywhere else or at another length.
    const second = `// ${'x'.repeat(98)}`
    expect(second).toHaveLength(101)
    const code = `${WAIVED.line}\n${second}\n`
    expect(tooWide(code, WAIVED.programId, WAIVED.revision)).toEqual([second])
    expect(tooWide(code, 'csharp-ServerQueries', WAIVED.revision)).toEqual([WAIVED.line, second])
    expect(tooWide(code, WAIVED.programId, '1'.repeat(40))).toEqual([WAIVED.line, second])
    expect(tooWide(`${WAIVED.line}.\n`, WAIVED.programId, WAIVED.revision)).toEqual([`${WAIVED.line}.`])
    expect(tooWide(`  ${WAIVED.line}\n`, WAIVED.programId, WAIVED.revision)).toEqual([`  ${WAIVED.line}`])
    // Control: a comment within the limit is not reported.
    expect(tooWide(`// ${'x'.repeat(97)}\n`, 'csharp-ServerQueries', WAIVED.revision)).toEqual([])
  })
})
