import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import data from '../src/data/api/dotnet.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = data as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'dotnet')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

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
    expect(example.page).toBe(`ports/dotnet/reference/${symbol.slug}`)
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
      for (const line of block.code.split('\n').filter((line) => /^\s*\/\//.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
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
})
