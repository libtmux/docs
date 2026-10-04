import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import swift from '../src/data/api/swift.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = swift as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'swift')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('complete Swift API programs', () => {
  it('covers construction, listing, creation, query, input and capture', () => {
    expect(examples).toHaveLength(21)
    expect(new Set(examples.map((example) => example.sourceFile)).size).toBe(9)
    for (const id of [
      'Server',
      'Server.sessions()',
      'Server.windows()',
      'Server.panes()',
      'Server.panes(where:)',
      'Server.sendKeys(_:to:literally:)',
      'Server.capture(_:includingHistory:)',
    ]) {
      expect(
        examples.some((example) => example.symbol === id),
        id,
      ).toBe(true)
    }
  })

  it.each(examples)('exports the verified $symbol files and setup', (example) => {
    const symbol = model.symbols.find((symbol) => symbol.id === example.symbol)!
    expect(symbol).toBeDefined()
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(example.page).toBe(`ports/swift/reference/${symbol.slug}`)
    expect(example.publicId).toBe(symbol.publicId ?? symbol.id)
    expect(example.sourceRepository).toBe(model.repo)
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    for (const file of example.files) {
      const block = blocks[file.block]
      expect(hash(block.code), file.name).toBe(file.sha256)
      expect(file).toHaveProperty('clipboardSha256', hash(block.code.replace(/\n$/, '')))
      expect(
        exported.some((block) => hash(block.value + '\n') === file.sha256),
        `${file.name} Markdown`,
      ).toBe(true)
      expect(block.sourceUrl).toBe(
        `https://github.com/${model.repo}/blob/${example.sourceRevision}/${
          file.name === 'Package.swift' ? 'Examples/Standalone/Package.swift' : example.sourceFile
        }`,
      )
      for (const line of block.code.split('\n').filter((line) => /^\s*\/\//.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    }
    const program = blocks[example.files[1].block]
    expect(program.code).toContain('import LibTmux')
    expect(program.code).toContain('import TmuxFixture')
    expect(program.code).toContain('@main')
    expect(program.intro).toContain('`Server`')
    expect(
      blocks.filter((block) => block.lang === 'console').map((block) => block.code.replace(/^\$ /gm, '').trim()),
    ).toEqual(example.shellRecipe)
    expect(example.consoleBlocks?.map((index) => blocks[index].code.replace(/^\$ /gm, '').trim())).toEqual(
      example.shellRecipe,
    )
    expect(example.expectedOutputs.at(-1)).toEqual(blocks.at(-1)!.code.trimEnd().split('\n'))
  })
})
