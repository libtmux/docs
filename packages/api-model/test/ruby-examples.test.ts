import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../src/model.ts'
import { attachCompleteRubyExamples } from '../src/languages/ruby-examples.ts'

const source = { repository: 'libtmux/libtmux-ruby', revision: 'a'.repeat(40) }
const file = 'examples/api/server.rb'
const code = '# frozen_string_literal: true\n\nrequire "libtmux"\n\nputs "ready"\n'
const program = () => ({
  path: file, gem: 'libtmux',
  api: { symbols: ['LibTmux::Server.new'], description: 'Connect to a server.', output: 'ready\n' },
})
const bundle = () => ({ manifest: { programs: [program()] }, files: [{ path: file, content: code }] })
const symbol = (): ApiSymbol => ({
  id: 'LibTmux::Server.new', publicId: 'LibTmux::Server.new', name: 'new', kind: 'method',
  modifiers: ['static'], parent: 'LibTmux::Server', package: 'libtmux', signatures: [],
  source: { file: 'gems/libtmux/lib/libtmux/server.rb', line: 45 },
  doc: { summary: 'Connect to an endpoint.', examples: [{ lang: 'ruby', code: 'existing' }] },
})

describe('complete native Ruby examples', () => {
  it('preserves whole file bytes, existing documentation, and exact setup/output', () => {
    const target = symbol()
    attachCompleteRubyExamples([target], bundle(), source)
    expect(target.id).toBe('LibTmux::Server.new')
    expect(target.doc?.summary).toBe('Connect to an endpoint.')
    const blocks = target.doc!.examples!
    expect(blocks.map((block) => block.lang)).toEqual(['ruby', 'console', 'ruby', 'ruby', 'console', 'text'])
    expect(blocks[0].code).toBe('existing')
    expect(blocks[1].code).toBe(`$ git clone https://github.com/libtmux/libtmux-ruby.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`)
    expect(blocks[2].code).toBe('source "https://rubygems.org"\n\ngem "libtmux", path: "libtmux-source/gems/libtmux"\n')
    expect(blocks[3].code).toBe(code)
    expect(blocks[3].sourceUrl).toBe(`https://github.com/${source.repository}/blob/${source.revision}/${file}`)
    expect(blocks[3].intro).toContain('server.rb')
    expect(blocks[4].code).toBe('$ bundle config set --local path vendor/bundle && \\\n  bundle install --jobs 2 && \\\n  bundle exec ruby server.rb\n')
    expect(blocks[5].code).toBe('ready\n')
  })

  it('ignores ordinary recipes without opt-in API metadata', () => {
    const target = symbol()
    const before = structuredClone(target)
    attachCompleteRubyExamples([target], { manifest: { programs: [{ path: file, gem: 'libtmux' }] } }, source)
    attachCompleteRubyExamples([target], { manifest: {}, files: [] }, source)
    expect(target).toEqual(before)
  })

  it.each([
    ['missing file', { manifest: { programs: [program()] }, files: [] }, /Missing complete/],
    ['duplicate file', { ...bundle(), files: [{ path: file, content: code }, { path: file, content: code }] }, /Duplicate.*file/],
    ['empty file', { ...bundle(), files: [{ path: file, content: ' ' }] }, /Missing complete/],
    ['missing API metadata', { ...bundle(), manifest: { programs: [{ ...program(), api: null }] } }, /metadata/],
    ['empty targets', { ...bundle(), manifest: { programs: [{ ...program(), api: { ...program().api, symbols: [] } }] } }, /metadata/],
    ['missing output newline', { ...bundle(), manifest: { programs: [{ ...program(), api: { ...program().api, output: 'ready' } }] } }, /metadata/],
    ['empty description', { ...bundle(), manifest: { programs: [{ ...program(), api: { ...program().api, description: ' ' } }] } }, /metadata/],
    ['escaping path', { ...bundle(), manifest: { programs: [{ ...program(), path: 'examples/../server.rb' }] } }, /metadata/],
  ])('rejects %s', (_name, input, message) => {
    expect(() => attachCompleteRubyExamples([symbol()], input, source)).toThrow(message)
  })

  it('rejects unknown, duplicate, and wrong-package declaration targets', () => {
    expect(() => attachCompleteRubyExamples([], bundle(), source)).toThrow(/resolve once/)
    expect(() => attachCompleteRubyExamples([symbol(), symbol()], bundle(), source)).toThrow(/resolve once/)
    expect(() => attachCompleteRubyExamples([{ ...symbol(), package: 'libtmux-async' }], bundle(), source))
      .toThrow(/package differs/)
    const duplicate = bundle()
    duplicate.manifest.programs.push(program())
    expect(() => attachCompleteRubyExamples([symbol()], duplicate, source)).toThrow(/Duplicate.*target/)
  })

  it('rejects mutable revisions and invalid repository citations', () => {
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), { ...source, revision: 'master' }))
      .toThrow(/full source revision/)
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), { ...source, repository: '../libtmux-ruby' }))
      .toThrow(/repository/)
  })
})
