import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import data from '../src/data/api/rs.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = data as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'rs')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('complete Rust API examples', () => {
  it('covers all 31 native targets across seven complete task programs', () => {
    expect(examples).toHaveLength(31)
    expect(new Set(examples.map((example) => example.sourceFile)).size).toBe(7)
    expect(new Set(examples.map((example) => example.page)).size).toBe(31)
    const attached = model.symbols.filter((symbol) => symbol.doc?.examples?.some(
      (block) => block.sourceUrl?.includes('/crates/libtmux/examples/api_'))).map((symbol) => symbol.id)
    expect(examples.map((example) => example.symbol).sort()).toEqual(attached.sort())
    for (const id of ['server.Server', 'server.Server.sessions', 'server.Server.windows',
      'server.Server.panes', 'server.Server.new_session', 'session.Session.new_window',
      'pane.Pane.split', 'query.QueryIteratorExt.matching', 'query.QueryIteratorExt.exactly_one',
      'query.QueryIteratorExt.one_or_none', 'pane.Pane.send_keys', 'pane.Pane.capture']) {
      expect(attached).toContain(id)
    }
    expect(attached).not.toContain('options.OptionScope.Server')
    expect(model.sources?.every((source) => source.revision === model.revision &&
      source.extractedRevision === model.revision)).toBe(true)
  })

  it.each(examples)('preserves whole file and recipe bytes for $symbol in Markdown and copy payloads', (example) => {
    const symbol = model.symbols.find((symbol) => symbol.id === example.symbol)!
    expect(symbol).toBeDefined()
    expect(symbol.product).toBe('core')
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(example.sourceRevision).toBe(model.revision)
    expect(example.page).toBe(`ports/rs/reference/${symbol.slug}`)
    expect(example.sourceRepository).toBe(model.repo)
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    expect(example.files).toHaveLength(3)
    for (const file of example.files) {
      const label = `${example.symbol}/${file.name}`
      if (!('sourceFile' in file) || typeof file.sourceFile !== 'string' ||
          !('clipboardSha256' in file) || !('path' in file)) throw new Error(`${label}: missing receipt`)
      const block = blocks[file.block]
      expect(hash(block.code), label).toBe(file.sha256)
      expect(hash(block.code.replace(/\n$/, ''))).toBe(file.clipboardSha256)
      expect(exported.some((entry) => hash(entry.value + '\n') === file.sha256), label).toBe(true)
      expect(block.sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${file.sourceFile}`)
      expect(markdown).toContain(`[Source example](${block.sourceUrl}).`)
      expect(block.intro).toContain(file.path)
      for (const line of block.code.split('\n').filter((line) => /^\s*\/\//.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    }
    expect(example.consoleBlocks?.map((index) => blocks[index].code.replace(/^\$ /gm, '').trim()))
      .toEqual(example.shellRecipe)
    for (const command of example.shellRecipe) {
      expect(exported.some((entry) => entry.value.replace(/^\$ /gm, '').trim() === command)).toBe(true)
    }
    expect(example.shellRecipe[1]).toContain('mkdir -p src &&\n')
    expect(example.shellRecipe[1]).toContain('cargo run --quiet')
    expect(blocks.at(-1)?.code).toBe(`${example.expectedOutputs[1].join('\n')}\n`)
    const program = blocks[example.files[2].block]
    expect(program.code).toContain('async fn main()')
    expect(program.code).toContain('#[tokio::main')
    expect(program.code).toContain('server.kill().await')
    expect(program.code).toContain('server.shutdown().await')
    expect(program.code).not.toMatch(/^\s*mod\s+\w+\s*;/m)
  })
})
