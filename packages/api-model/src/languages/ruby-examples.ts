import { basename } from 'node:path'
import type { ApiSymbol, DocBlock } from '../model.ts'

interface RubyProgram {
  path: string
  gem: string
  api?: { symbols: string[]; description: string; output: string }
}

interface RubyExamples {
  manifest?: { programs?: RubyProgram[] }
  files?: { path: string; content: string }[]
}

/**
 * Programs the port's manifest selects whose pages must not show them yet,
 * by path, each with why it is held and what brings it back.
 *
 * A page that tells readers to save a program that fails, or states a tmux
 * floor the library refuses, is wrong text. A held program attaches to none
 * of its symbols. An entry the manifest no longer lists fails the build, so
 * remove it when the pinned revision carries the fix it names.
 */
export const HELD_RUBY_PROGRAMS: Readonly<Record<string, string>> = {
  'examples/api/workspace_apply.rb':
    'Saved alone in an empty directory it stops with Workspace::ConfigError: it loads ../workspace.yaml, '
    + 'which no page shows. Returns once libtmux-ruby writes the document inside the program.',
  'examples/api/control.rb':
    'The intro states tmux 3.3a or newer, but the library refuses a control client below tmux 3.7 (capability '
    + 'control-mode). The manifest has no field for a program\'s tmux floor and the model states 3.7 only in '
    + 'prose, so no floor is read. Returns once the manifest declares it and this generator uses it.',
  'examples/api/async_control.rb':
    'The intro states tmux 3.3a or newer, but the library refuses a control client below tmux 3.7 (capability '
    + 'control-mode). The manifest has no field for a program\'s tmux floor and the model states 3.7 only in '
    + 'prose, so no floor is read. Returns once the manifest declares it and this generator uses it.',
}

/**
 * Native export metadata selects whole programs; ordinary recipe helpers stay unlisted.
 *
 * Readers install the gem from RubyGems at the version the documented revision
 * declares. The port bumps that version only in its release commits, so it
 * names a published release, and Bundler needs it spelled out while the gems
 * are prereleases.
 *
 * `held` names programs to leave off their pages, each with a reason; one the
 * manifest does not select is an error, so a hold cannot outlive its program.
 */
export function attachCompleteRubyExamples(
  symbols: ApiSymbol[],
  input: unknown,
  source: { repository: string; revision: string },
  packages: { name: string; version: string }[] = [],
  held: Readonly<Record<string, string>> = {},
): void {
  const bundle = input as RubyExamples | undefined
  const programs = bundle?.manifest?.programs
  if (programs === undefined) return
  if (!Array.isArray(programs)) throw new Error('Invalid Ruby example programs')
  const listed = programs.filter((program) => Object.hasOwn(program, 'api'))
  for (const [path, reason] of Object.entries(held)) {
    if (!listed.some((program) => program.path === path)) throw new Error(`Held Ruby example is not in the manifest: ${path}`)
    if (!reason.trim()) throw new Error(`Held Ruby example has no reason: ${path}`)
  }
  const selected = listed.filter((program) => !Object.hasOwn(held, program.path))
  if (!selected.length) return
  if (!/^[0-9a-f]{40}$/.test(source.revision)) throw new Error('Ruby examples require a full source revision')
  if (!/^[\w][\w.-]*\/[\w][\w.-]*$/.test(source.repository)) throw new Error('Invalid Ruby example repository')
  if (!Array.isArray(bundle?.files)) throw new Error('Missing Ruby example files')
  const files = new Map<string, string>()
  for (const file of bundle.files) {
    if (files.has(file.path)) throw new Error(`Duplicate Ruby example file: ${file.path}`)
    if (typeof file.content !== 'string') throw new Error(`Invalid Ruby example file: ${file.path}`)
    files.set(file.path, file.content)
  }
  const targets = new Set<string>()
  for (const program of selected) {
    const api = program.api
    if (!/^examples\/(?:[\w-]+\/)*[\w-]+\.rb$/.test(program.path) ||
        !/^libtmux(?:-[a-z]+)*$/.test(program.gem) ||
        !api || !Array.isArray(api.symbols) || !api.symbols.length ||
        !api.symbols.every((id) => typeof id === 'string' && id.length && !/\s/.test(id)) ||
        typeof api.description !== 'string' || !api.description.trim() ||
        typeof api.output !== 'string' || !api.output.trim() || !api.output.endsWith('\n')) {
      throw new Error(`Invalid Ruby API example metadata: ${program.path}`)
    }
    const code = files.get(program.path)
    if (!code?.trim()) throw new Error(`Missing complete Ruby example: ${program.path}`)
    const version = packages.find((entry) => entry.name === program.gem)?.version
    if (!version || !/^\d+\.\d+\.\d+(?:\.[0-9A-Za-z]+)*$/.test(version)) {
      throw new Error(`Ruby example gem has no release version: ${program.gem}`)
    }
    const filename = basename(program.path)
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'ruby',
        intro: `${api.description.replace(/\n/g, ' ')} Use Ruby 3.3 or newer with Bundler, and tmux 3.3a or newer, on Unix with \`/bin/cat\` and \`/bin/sh\` available. In an empty directory, save this \`Gemfile\`:`,
        code: `source "https://rubygems.org"\n\ngem "${program.gem}", "${version}"\n`,
      },
      {
        lang: 'ruby',
        intro: `Save this complete program as \`${filename}\`. Its \`Server.start\` block owns a private tmux server and stops it on exit, including after an error.`,
        sourceUrl: `https://github.com/${source.repository}/blob/${source.revision}/${program.path}`,
        code,
      },
      {
        lang: 'console',
        intro: 'Install the gem and run the program. An operation or cleanup error makes it exit unsuccessfully:',
        code: `$ bundle install && \\\n  bundle exec ruby ${filename}\n`,
      },
      { lang: 'text', intro: 'Expected output:', code: api.output },
    ]
    for (const id of api.symbols) {
      if (targets.has(id)) throw new Error(`Duplicate Ruby example target: ${id}`)
      const matches = symbols.filter((symbol) => symbol.id === id)
      if (matches.length !== 1) throw new Error(`Ruby example target must resolve once: ${id}`)
      const symbol = matches[0]
      if (symbol.package !== program.gem) throw new Error(`Ruby example package differs: ${id}`)
      targets.add(id)
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
