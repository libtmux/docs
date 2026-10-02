import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import ruby from '../src/data/api/ruby.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = ruby as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'ruby')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('verified complete Ruby API programs', () => {
  it('covers every declared example target without changing public identities', () => {
    const targets = model.symbols.filter((symbol) => symbol.doc?.examples?.length)
    expect(examples.map((example) => example.symbol).sort()).toEqual(targets.map((symbol) => symbol.id).sort())
    expect(new Set(examples.map((example) => example.sourceFile)).size).toBe(8)
  })

  it.each(examples)('preserves the executed $symbol files, setup, and expected output', (example) => {
    const symbols = model.symbols.filter((symbol) => symbol.id === example.symbol)
    expect(symbols).toHaveLength(1)
    const symbol = symbols[0]
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(symbol.publicId).toBe(example.symbol)
    expect(example.page).toBe(`ports/ruby/reference/${symbol.slug}`)
    expect(blocks).toHaveLength(5)
    for (const file of example.files) {
      if (!('clipboardSha256' in file)) {
        throw new Error(`Missing Ruby clipboard hash: ${example.symbol}/${file.name}`)
      }
      const code = blocks[file.block].code
      expect(hash(code), `${example.symbol}/${file.name}`).toBe(file.sha256)
      expect(exported.some((block) => hash(block.value + '\n') === file.sha256),
        `${example.symbol}/${file.name} Markdown`).toBe(true)
      expect(hash(code.replace(/\n$/, ''))).toBe(file.clipboardSha256)
    }
    expect(blocks.filter((block) => block.lang === 'console')
      .map((block) => block.code.replace(/^\$ /gm, '').trim())).toEqual(example.shellRecipe)
    expect(blocks[2].sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${example.sourceFile}`)
    expect(markdown).toContain(`[Source example](${blocks[2].sourceUrl}).`)
    expect(blocks[2].code).toContain('require "libtmux"')
    expect(blocks[2].code).toContain('LibTmux::Server.start do')
    expect(blocks[2].code).toContain('rescue StandardError => error')
    expect(blocks[2].code).not.toContain('require_relative')
    expect(blocks[4].code.split('\n').slice(0, -1)).toEqual(example.expectedOutputs[1])
    for (const line of blocks[2].code.split('\n').filter((line) => /^\s*#/.test(line))) {
      expect(line.length).toBeLessThanOrEqual(100)
    }
  })
})
