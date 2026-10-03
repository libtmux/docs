import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import lua from '../src/data/api/lua.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = lua as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'lua')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('verified complete Lua API programs', () => {
  it('attaches seven source programs to eleven native API targets', () => {
    expect(examples).toHaveLength(11)
    expect(new Set(examples.map((example) => example.sourceFile)).size).toBe(7)
    expect(new Set(examples.map((example) => example.symbol)).size).toBe(examples.length)
    expect(model.symbols.filter((symbol) => symbol.doc?.examples?.length)
      .map((symbol) => symbol.id).sort()).toEqual(examples.map((example) => example.symbol).sort())
  })

  it.each(examples)('preserves the executed $symbol files and setup', (example) => {
    const symbols = model.symbols.filter((symbol) => symbol.id === example.symbol)
    expect(symbols).toHaveLength(1)
    const symbol = symbols[0]
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(model.repo).toBe(example.sourceRepository)
    expect(example.page).toBe(`ports/lua/reference/${symbol.slug}`)
    expect(blocks).toHaveLength(4)
    expect(example.consoleBlocks).toEqual([0, 3])
    for (const file of example.files) {
      if (!('clipboardSha256' in file) || !('sourceFile' in file)) {
        throw new Error(`${example.symbol}/${file.name}: Lua source receipt is incomplete`)
      }
      const block = blocks[file.block]
      expect(block.code.endsWith('\n') && !block.code.endsWith('\n\n')).toBe(true)
      expect(block.code).not.toContain('\r')
      expect(hash(block.code), `${example.symbol}/${file.name}`).toBe(file.sha256)
      expect(hash(block.code.slice(0, -1))).toBe(file.clipboardSha256)
      expect(exported.some((entry) => hash(entry.value + '\n') === file.sha256),
        `${example.symbol}/${file.name} Markdown`).toBe(true)
      expect(block.sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${file.sourceFile}`)
      expect(markdown).toContain(`[Source example](${block.sourceUrl}).`)
      expect(block.intro).toContain(file.name)
      for (const line of block.code.split('\n').filter((line) => /^\s*(?:--|#)/.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    }
    expect(blocks.filter((block) => block.lang === 'console')
      .map((block) => block.code.replace(/^\$ /gm, '').trim())).toEqual(example.shellRecipe)
    for (const index of example.consoleBlocks ?? []) {
      expect(exported.some((entry) => entry.value + '\n' === blocks[index].code)).toBe(true)
    }
    expect(blocks[2].code).toContain('require("libtmux.runtime.luv")')
    expect(blocks[2].code).toContain('adapter.run(function(runtime)')
    expect(blocks[2].code).toContain('server:close():await()')
  })
})
