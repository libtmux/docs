import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import go from '../src/data/api/go.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = go as unknown as ApiModel
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('verified complete API programs', () => {
  it.each(receipt.examples.filter((example) => example.port === 'go'))(
    'preserves the executed $symbol files and setup',
    (example) => {
      const symbols = model.symbols.filter((symbol) => symbol.id === example.symbol)
      expect(symbols).toHaveLength(1)
      const symbol = symbols[0]
      const blocks = symbol.doc?.examples ?? []
      const markdown = symbolMarkdown({ model, symbol })
      const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
      expect(symbol.source.revision).toBe(example.sourceRevision)
      expect(example.page).toBe(`ports/go/reference/${symbol.slug}`)
      for (const file of example.files) {
        expect(hash(blocks[file.block].code), `${example.symbol}/${file.name}`).toBe(file.sha256)
        expect(
          exported.some((block) => hash(block.value + '\n') === file.sha256),
          `${example.symbol}/${file.name} Markdown`,
        ).toBe(true)
      }
      expect(
        blocks.filter((block) => block.lang === 'console').map((block) => block.code.replace(/^\$ /gm, '').trim()),
      ).toEqual(example.shellRecipe)
      expect(blocks[2].sourceUrl).toBe(
        `https://github.com/${model.repo}/blob/${example.sourceRevision}/${example.sourceFile}`,
      )
      expect(blocks[2].intro).not.toContain('[source example](')
      expect(markdown).toContain(`[Source example](${blocks[2].sourceUrl}).`)
      expect(blocks[2].code).toMatch(/^package tmux_test\n/)
      expect(blocks[2].code).toMatch(/func Example\w+_complete\(\)/)
      expect(blocks[2].code).toContain('// Output:')
      for (const line of blocks[2].code.split('\n').filter((line) => /^\s*\/\//.test(line))) {
        expect(line.replaceAll('\t', '    ').length).toBeLessThanOrEqual(100)
      }
    },
  )
})
