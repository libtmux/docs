import { HELD_RUBY_PROGRAMS, type ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import ruby from '../src/data/api/ruby.json'
import sources from '../src/data/example-sources.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = ruby as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'ruby')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('verified complete Ruby API programs', () => {
  it('covers every declared example target without changing public identities', () => {
    const targets = model.symbols.filter((symbol) => symbol.doc?.examples?.length)
    expect(examples.map((example) => example.symbol).sort()).toEqual(targets.map((symbol) => symbol.id).sort())
    // Each target's second block links its source file; the receipt must name the same files.
    const sourceFiles = (files: string[]) => [...new Set(files)].sort()
    expect(sourceFiles(examples.map((example) => example.sourceFile)))
      .toEqual(sourceFiles(targets.map((symbol) => symbol.doc!.examples![1]!.sourceUrl!.replace(/^.*\/blob\/[0-9a-f]{40}\//, ''))))
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
    expect(blocks).toHaveLength(4)
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
    expect(blocks[1].sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${example.sourceFile}`)
    expect(markdown).toContain(`[Source example](${blocks[1].sourceUrl}).`)
    expect(blocks[1].code).toContain('require "libtmux"')
    expect(blocks[1].code).toContain('LibTmux::Server.start do')
    expect(blocks[1].code).toContain('rescue StandardError => error')
    expect(blocks[1].code).not.toContain('require_relative')
    expect(blocks[3].code.split('\n').slice(0, -1)).toEqual(example.expectedOutputs.at(-1))
    expect(blocks[0].code).toMatch(/^source "https:\/\/rubygems\.org"\n\ngem "libtmux[\w-]*", "\d[^"]*"\n$/)
    for (const line of blocks[1].code.split('\n').filter((line) => /^\s*#/.test(line))) {
      expect(line.length).toBeLessThanOrEqual(100)
    }
  })
})

describe('the Ruby programs held back from their pages', () => {
  const manifest = (sources as Record<string, { revision: string, content: string }>)['ruby:examples/manifest.json']!
  const selected = (JSON.parse(manifest.content) as { programs: { path: string, api?: { symbols: string[] } }[] }).programs
    .filter((program) => program.api)
  const attached = model.symbols.flatMap((symbol) => (symbol.doc?.examples ?? []).flatMap((block) =>
    block.sourceUrl ? [{ id: symbol.id, path: block.sourceUrl.replace(/^.*\/blob\/[0-9a-f]{40}\//, '') }] : []))

  it('are shown on none of the pages they document', () => {
    expect(attached.filter(({ path }) => Object.hasOwn(HELD_RUBY_PROGRAMS, path))).toEqual([])
  })

  it('name programs the manifest at the model’s revision still selects', () => {
    expect(manifest.revision).toBe(model.revision)
    const missing = Object.keys(HELD_RUBY_PROGRAMS).filter((path) => !selected.some((program) => program.path === path))
    expect(missing, 'a hold for a program that is gone').toEqual([])
  })

  it('still attach every selected program that is not held', () => {
    const wanted = selected.filter((program) => !Object.hasOwn(HELD_RUBY_PROGRAMS, program.path))
      .flatMap((program) => program.api!.symbols.map((id) => `${id} ${program.path}`)).sort()
    expect(attached.map(({ id, path }) => `${id} ${path}`).sort()).toEqual(wanted)
  })
})
