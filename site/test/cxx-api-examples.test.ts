import type { ApiModel } from '@libtmux/api-model'
import { createHash } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import cxx from '../src/data/api/cxx.json'
import receipt from './fixtures/api-examples.json'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

const model = cxx as unknown as ApiModel
const examples = receipt.examples.filter((example) => example.port === 'cxx')
const hash = (code: string) => createHash('sha256').update(code).digest('hex')

describe('complete C++ API programs', () => {
  it('covers construction, listing, creation, queries, input and capture', () => {
    expect(examples).toHaveLength(29)
    expect(new Set(examples.map((example) => example.sourceFile)).size).toBe(7)
    for (const id of [
      'libtmux::Server',
      'libtmux::Server::sessions',
      'libtmux::Server::windows',
      'libtmux::Server::panes',
      'libtmux::Server::clients',
      'libtmux::Server::new_session',
      'libtmux::Session::new_window',
      'libtmux::Pane::split',
      'libtmux::matching',
      'libtmux::Pane::send_line',
      'libtmux::Pane::capture',
    ]) {
      expect(
        examples.some((example) => example.symbol === id),
        id,
      ).toBe(true)
    }
    expect(model.symbols.some((symbol) => symbol.id.startsWith('libtmux::workspace::detail::'))).toBe(false)
  })

  it.each(examples)('exports the verified $symbol files and installed-package setup', (example) => {
    const symbol = model.symbols.find((symbol) => symbol.id === example.symbol)!
    expect(symbol).toBeDefined()
    expect(symbol.source.revision).toBe(example.sourceRevision)
    expect(example.page).toBe(`ports/cxx/reference/${symbol.slug}`)
    expect(example.publicId).toBe(symbol.publicId ?? symbol.id)
    expect(example.sourceRepository).toBe(model.repo)
    const blocks = symbol.doc?.examples ?? []
    const markdown = symbolMarkdown({ model, symbol })
    const exported = fromMarkdown(markdown).children.filter((node) => node.type === 'code')
    for (const file of example.files) {
      if (!('sourceFile' in file) || typeof file.sourceFile !== 'string') {
        throw new Error(`${example.symbol}/${file.name}: missing source file receipt`)
      }
      const block = blocks[file.block]
      expect(hash(block.code), file.name).toBe(file.sha256)
      expect(file).toHaveProperty('clipboardSha256', hash(block.code.replace(/\n$/, '')))
      expect(
        exported.some((block) => hash(block.value + '\n') === file.sha256),
        `${file.name} Markdown`,
      ).toBe(true)
      expect(block.sourceUrl).toBe(`https://github.com/${model.repo}/blob/${example.sourceRevision}/${file.sourceFile}`)
      for (const line of block.code.split('\n').filter((line) => /^\s*\/\//.test(line))) {
        expect(line.length).toBeLessThanOrEqual(100)
      }
    }
    const program = blocks[example.files[1].block]
    expect(program.code).toContain('#include <libtmux/libtmux.hpp>')
    expect(program.code).toContain('#include <libtmux/testing/scoped_server.hpp>')
    expect(program.code).toContain('int main()')
    expect(program.intro).toContain('`Server`')
    const commands = blocks
      .filter((block) => block.lang === 'console')
      .map((block) => block.code.replace(/^\$ /gm, '').trim())
    expect(commands).toEqual(example.shellRecipe)
    expect(example.consoleBlocks?.map((index) => blocks[index].code.replace(/^\$ /gm, '').trim())).toEqual(
      example.shellRecipe,
    )
    expect(commands[1]).toContain('-DLIBTMUX_BUILD_TESTING_LIBRARY=ON')
    expect(commands[2]).toContain('-DCMAKE_PREFIX_PATH="$PWD/libtmux-prefix"')
    expect(example.expectedOutputs.at(-1)).toEqual(blocks.at(-1)!.code.trimEnd().split('\n'))
  })
})
