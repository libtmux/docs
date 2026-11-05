import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../src/model.ts'
import { attachCompleteRubyExamples, HELD_RUBY_PROGRAMS } from '../src/languages/ruby-examples.ts'

const source = { repository: 'libtmux/libtmux-ruby', revision: 'a'.repeat(40) }
const packages = [{ name: 'libtmux', version: '0.1.0.alpha.3' }, { name: 'libtmux-async', version: '0.1.0.alpha.3' }]
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
    attachCompleteRubyExamples([target], bundle(), source, packages)
    expect(target.id).toBe('LibTmux::Server.new')
    expect(target.doc?.summary).toBe('Connect to an endpoint.')
    const blocks = target.doc!.examples!
    expect(blocks.map((block) => block.lang)).toEqual(['ruby', 'ruby', 'ruby', 'console', 'text'])
    expect(blocks[0].code).toBe('existing')
    expect(blocks[1].code).toBe('source "https://rubygems.org"\n\ngem "libtmux", "0.1.0.alpha.3"\n')
    expect(blocks[1].intro).not.toMatch(/git|clone/i)
    expect(blocks[2].code).toBe(code)
    expect(blocks[2].sourceUrl).toBe(`https://github.com/${source.repository}/blob/${source.revision}/${file}`)
    expect(blocks[2].intro).toContain('`server.rb`')
    expect(blocks[3].code).toBe('$ bundle install && \\\n  bundle exec ruby server.rb\n')
    expect(blocks[4].code).toBe('ready\n')
  })

  it('ignores ordinary recipes without opt-in API metadata', () => {
    const target = symbol()
    const before = structuredClone(target)
    attachCompleteRubyExamples([target], { manifest: { programs: [{ path: file, gem: 'libtmux' }] } }, source, packages)
    attachCompleteRubyExamples([target], { manifest: {}, files: [] }, source, packages)
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
    expect(() => attachCompleteRubyExamples([symbol()], input, source, packages)).toThrow(message)
  })

  it('rejects unknown, duplicate, and wrong-package declaration targets', () => {
    expect(() => attachCompleteRubyExamples([], bundle(), source, packages)).toThrow(/resolve once/)
    expect(() => attachCompleteRubyExamples([symbol(), symbol()], bundle(), source, packages)).toThrow(/resolve once/)
    expect(() => attachCompleteRubyExamples([{ ...symbol(), package: 'libtmux-async' }], bundle(), source, packages))
      .toThrow(/package differs/)
    const duplicate = bundle()
    duplicate.manifest.programs.push(program())
    expect(() => attachCompleteRubyExamples([symbol()], duplicate, source, packages)).toThrow(/Duplicate.*target/)
  })

  it('installs the release the documented revision declares, and refuses a gem without one', () => {
    const target = { ...symbol(), package: 'libtmux-async' }
    const asyncBundle = { ...bundle(), manifest: { programs: [{ ...program(), gem: 'libtmux-async' }] } }
    attachCompleteRubyExamples([target], asyncBundle, source, packages)
    expect(target.doc!.examples![1].code).toBe('source "https://rubygems.org"\n\ngem "libtmux-async", "0.1.0.alpha.3"\n')
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), source, [])).toThrow(/no release version: libtmux/)
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), source, [{ name: 'libtmux', version: 'master' }]))
      .toThrow(/no release version/)
  })

  describe('a held program', () => {
    const held = { [file]: 'Fails alone in an empty directory.' }

    it('attaches to none of its symbols, and attaches once released', () => {
      const target = symbol()
      attachCompleteRubyExamples([target], bundle(), source, packages, held)
      expect(target.doc!.examples).toEqual([{ lang: 'ruby', code: 'existing' }])
      attachCompleteRubyExamples([target], bundle(), source, packages, {})
      expect(target.doc!.examples).toHaveLength(5)
    })

    it('leaves the programs beside it attached', () => {
      const other = { ...program(), path: 'examples/api/other.rb', api: { ...program().api, symbols: ['LibTmux::Server.other'] } }
      const input = { manifest: { programs: [program(), other] }, files: [{ path: file, content: code }, { path: other.path, content: code }] }
      const second = { ...symbol(), id: 'LibTmux::Server.other', publicId: 'LibTmux::Server.other', name: 'other' }
      const targets = [symbol(), second]
      attachCompleteRubyExamples(targets, input, source, packages, held)
      expect(targets.map((target) => target.doc!.examples!.length)).toEqual([1, 5])
    })

    it('is refused when the manifest does not select it', () => {
      const elsewhere = { 'examples/api/gone.rb': 'Fails alone.' }
      expect(() => attachCompleteRubyExamples([symbol()], bundle(), source, packages, elsewhere)).toThrow(/Held Ruby example is not in the manifest: examples\/api\/gone\.rb/)
      const unselected = { manifest: { programs: [{ path: file, gem: 'libtmux' }] } }
      expect(() => attachCompleteRubyExamples([symbol()], unselected, source, packages, held)).toThrow(/not in the manifest/)
    })

    it('is refused without a reason', () => {
      expect(() => attachCompleteRubyExamples([symbol()], bundle(), source, packages, { [file]: ' ' })).toThrow(/has no reason: examples\/api\/server\.rb/)
    })
  })

  it('lists each held program by its path, with a reason', () => {
    for (const [path, reason] of Object.entries(HELD_RUBY_PROGRAMS)) {
      expect(path, 'a program path').toMatch(/^examples\/(?:[\w-]+\/)*[\w-]+\.rb$/)
      expect(reason.trim(), path).not.toBe('')
    }
  })

  describe('the tmux release a page states', () => {
    const current = (release: unknown, path = file) => ({ ...bundle(), tmux_releases: { [path]: release } })
    const stated = (input: unknown) => {
      const target = symbol()
      attachCompleteRubyExamples([target], input, source, packages)
      return target.doc!.examples![1].intro!
    }

    it('is the release the bundle gives the program', () => {
      for (const release of ['3.3a', '3.7', '3.7c', '3.10']) {
        expect(stated(current(release))).toContain(`and tmux ${release} or newer, on Unix`)
      }
      expect(stated(current('3.7'))).not.toContain('3.3a')
    })

    it('is 3.3a for a bundle that carries no releases, an export of an earlier Ruby release', () => {
      expect(stated(bundle())).toContain('and tmux 3.3a or newer, on Unix')
    })

    it.each([
      ['an empty release', ''],
      ['a branch', 'master'],
      ['a patch release', '3.7.1'],
      ['a prerelease', 'next-3.8'],
      ['a padded release', ' 3.7'],
      ['a number', 3.7],
      ['null', null],
    ])('rejects %s', (_name, release) => {
      expect(() => stated(current(release))).toThrow(/tmux release/)
    })

    it('rejects a program the releases leave out, and releases that are not a map', () => {
      expect(() => stated({ ...bundle(), tmux_releases: {} })).toThrow(/no tmux release: examples\/api\/server\.rb/)
      expect(() => stated(current('3.7', 'examples/api/other.rb'))).toThrow(/no tmux release: examples\/api\/server\.rb/)
      for (const releases of [[], null, '3.7']) {
        expect(() => stated({ ...bundle(), tmux_releases: releases })).toThrow(/Invalid Ruby example tmux releases/)
      }
    })
  })

  describe('the programs held for an export of an earlier release', () => {
    const [applyPath, controlPath, asyncPath] = ['workspace_apply', 'control', 'async_control'].map((name) => `examples/api/${name}.rb`)
    const names = [applyPath, controlPath, asyncPath, file]
    const gems = ['libtmux-workspace', 'libtmux', 'libtmux-async', 'libtmux']
    const ids = ['LibTmux::Workspace.load', 'LibTmux::Server#open_control', 'LibTmux::Async::Server#open_control', 'LibTmux::Server.new']
    const everyVersion = [...packages, { name: 'libtmux-workspace', version: '0.1.0.alpha.3' }]
    const targets = () => ids.map((id, index): ApiSymbol => ({ ...symbol(), id, publicId: id, name: id, package: gems[index] }))
    const input = (releases?: Record<string, string>) => ({
      manifest: {
        programs: names.map((path, index) => ({
          path, gem: gems[index], api: { ...program().api, symbols: [ids[index]] },
        })),
      },
      files: names.map((path) => ({ path, content: code })),
      ...(releases ? { tmux_releases: releases } : {}),
    })
    const attach = (releases?: Record<string, string>) => {
      const symbols = targets()
      attachCompleteRubyExamples(symbols, input(releases), source, everyVersion, HELD_RUBY_PROGRAMS)
      return symbols
    }
    const intros = (symbols: ApiSymbol[]) => symbols.map((entry) => entry.doc!.examples!.length > 1 ? entry.doc!.examples![1].intro : undefined)

    it('names the three programs whose pages mislead readers', () => {
      expect(Object.keys(HELD_RUBY_PROGRAMS).sort()).toEqual([applyPath, controlPath, asyncPath].sort())
    })

    it('stay off their pages for a bundle with no releases, while the program beside them states 3.3a', () => {
      const symbols = attach()
      expect(symbols.map((entry) => entry.doc!.examples!.length)).toEqual([1, 1, 1, 5])
      expect(intros(symbols).at(-1)).toContain('and tmux 3.3a or newer, on Unix')
    })

    it('appear on their pages for a bundle that carries releases, each stating its own', () => {
      const symbols = attach({ [applyPath]: '3.3a', [controlPath]: '3.7', [asyncPath]: '3.7', [file]: '3.3a' })
      expect(symbols.map((entry) => entry.doc!.examples!.length)).toEqual([5, 5, 5, 5])
      const [apply, control, async, other] = intros(symbols)
      expect(control).toContain('and tmux 3.7 or newer, on Unix')
      expect(async).toContain('and tmux 3.7 or newer, on Unix')
      expect(apply).toContain('and tmux 3.3a or newer, on Unix')
      expect(other).toContain('and tmux 3.3a or newer, on Unix')
    })

    it('are not required in the manifest of a bundle that carries releases', () => {
      const releases = { [file]: '3.3a' }
      const only = { manifest: { programs: [program()] }, files: [{ path: file, content: code }], tmux_releases: releases }
      const target = symbol()
      expect(() => attachCompleteRubyExamples([target], only, source, packages, HELD_RUBY_PROGRAMS)).not.toThrow()
      expect(target.doc!.examples).toHaveLength(5)
      const legacy = { manifest: only.manifest, files: only.files }
      expect(() => attachCompleteRubyExamples([symbol()], legacy, source, packages, HELD_RUBY_PROGRAMS))
        .toThrow(/Held Ruby example is not in the manifest: examples\/api\/workspace_apply\.rb/)
    })
  })

  it('rejects mutable revisions and invalid repository citations', () => {
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), { ...source, revision: 'master' }, packages))
      .toThrow(/full source revision/)
    expect(() => attachCompleteRubyExamples([symbol()], bundle(), { ...source, repository: '../libtmux-ruby' }, packages))
      .toThrow(/repository/)
  })
})
