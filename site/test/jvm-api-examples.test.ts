import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import java from '../src/data/api/java.json'
import kotlin from '../src/data/api/kotlin.json'
import scala from '../src/data/api/scala.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const models: Record<string, ApiModel> = { java, kotlin, scala } as unknown as Record<string, ApiModel>
const examples = receipt.examples.filter((example) => ['java', 'kotlin', 'scala'].includes(example.port))
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('verified complete Java-family API programs', () => {
  it('covers every declared attachment, including both programs on shared sessions pages', () => {
    expect(examples).toHaveLength(57)
    expect(new Set(examples.map((example) => 'sourceProgramId' in example && example.sourceProgramId)).size).toBe(32)
    expect(new Set(examples.map((example) => example.page)).size).toBe(53)
    for (const port of ['java', 'kotlin', 'scala']) {
      const covered = models[port].symbols.filter((symbol) => symbol.doc?.examples?.some(
        (block) => block.sourceUrl?.includes('/examples/src/main/'))).map((symbol) => symbol.id)
      expect([...new Set(examples.filter((example) => example.port === port).map((example) => example.symbol))].sort())
        .toEqual(covered.sort())
      expect(examples.filter((example) => example.port === port)).toHaveLength({ java: 14, kotlin: 15, scala: 28 }[port]!)
    }
  })

  it.each(examples)('preserves $sourceProgramId on $symbol', (example) => {
    if (!('sourceProgramId' in example) || typeof example.sourceProgramId !== 'string' ||
        !('consoleBlocks' in example) || !example.consoleBlocks) {
      throw new Error(`${example.symbol}: missing complete program selection`)
    }
    const model = models[example.port]
    const symbols = model.symbols.filter((symbol) => symbol.id === example.symbol)
    expect(symbols).toHaveLength(1)
    const symbol = symbols[0]
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(example.page).toBe(`ports/${example.port}/reference/${symbol.slug}`)
    expect(example.files).toHaveLength(5)
    for (const file of example.files) {
      if (!('clipboardSha256' in file) || !('sourceFile' in file) || !('path' in file)) {
        throw new Error(`${example.symbol}/${file.name}: incomplete source file receipt`)
      }
      const block = blocks[file.block]
      expect(hash(block.code), `${example.symbol}/${file.path}`).toBe(file.sha256)
      expect(hash(block.code.replace(/\n$/, ''))).toBe(file.clipboardSha256)
      expect(exported.some((entry) => hash(entry.value + '\n') === file.sha256)).toBe(true)
      expect(block.sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${file.sourceFile}`)
      expect(markdown).toContain(`[Source example](${block.sourceUrl}).`)
      expect(block.intro).toContain(file.path)
      for (const line of block.code.split('\n').filter((line) => /^\s*(?:\/\/|#)/.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    }
    expect(example.consoleBlocks.map((index) => blocks[index].code.replace(/^\$ /gm, '').trim()))
      .toEqual(example.shellRecipe)
    expect(blocks[example.consoleBlocks[1] + 1].code.trimEnd().split('\n')).toEqual(example.expectedOutputs[1])
    for (const index of example.consoleBlocks) {
      expect(blocks[index].lang).toBe('console')
      expect(exported.some((entry) => entry.value + '\n' === blocks[index].code)).toBe(true)
    }
    const program = blocks[example.files[4].block]
    expect(program.lang).toBe(example.port)
    if (example.sourceProgramId.startsWith('scala-cats-')) expect(program.code).toContain('extends IOApp')
    if (example.sourceProgramId.startsWith('scala-direct-')) expect(program.code).toContain('Using.resource')
    if (example.port === 'java') expect(program.code).toContain('try (Server server = Server.open(')
    if (example.port === 'kotlin') expect(program.code).toContain('withServer(')
  })
})
