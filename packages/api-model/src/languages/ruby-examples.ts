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
  /** The tmux release each program's page states, by path. Only an export of manifest version 2 carries it. */
  tmux_releases?: unknown
}

/** The release every page stated before the manifest declared one. */
const LEGACY_TMUX_RELEASE = '3.3a'

/**
 * Programs an export of an earlier Ruby release selects whose pages must not
 * show them, by path, each with why it is held.
 *
 * A page that tells readers to save a program that fails, or states a tmux
 * floor the library refuses, is wrong text. Those releases export a version 1
 * manifest: a program loads a file no page shows, or needs tmux 3.7 while the
 * page states 3.3a, and the export names no release to state instead. A held
 * program attaches to none of its symbols.
 *
 * A hold applies only to an export that carries no `tmux_releases`. A release
 * that does carries programs that run saved alone and states each program's
 * release, so nothing in it is held. Remove the list once the site builds no
 * Ruby release older than that.
 */
export const HELD_RUBY_PROGRAMS: Readonly<Record<string, string>> = {
  'examples/api/workspace_apply.rb':
    'Saved alone in an empty directory it stops with Workspace::ConfigError: it loads ../workspace.yaml, '
    + 'which no page shows. A release with tmux_releases writes the document inside the program.',
  'examples/api/control.rb':
    'The intro states tmux 3.3a or newer, but the library refuses a control client below tmux 3.7 (capability '
    + 'control-mode), and a manifest of version 1 declares no floor. A release with tmux_releases names it.',
  'examples/api/async_control.rb':
    'The intro states tmux 3.3a or newer, but the library refuses a control client below tmux 3.7 (capability '
    + 'control-mode), and a manifest of version 1 declares no floor. A release with tmux_releases names it.',
}

/**
 * Native export metadata selects whole programs; ordinary recipe helpers stay unlisted.
 *
 * Readers install the gem from RubyGems at the version the documented revision
 * declares. The port bumps that version only in its release commits, so it
 * names a published release, and Bundler needs it spelled out while the gems
 * are prereleases.
 *
 * Each page states the tmux release the export gives its program in
 * `tmux_releases`. An export without it (a release before manifest version 2)
 * states 3.3a and applies `held`: programs to leave off their pages, each with
 * a reason. A hold the manifest does not select is an error, so a hold cannot
 * outlive its program. An export with `tmux_releases` ignores `held`.
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
  const releases = bundle?.tmux_releases
  if (releases !== undefined && (typeof releases !== 'object' || releases === null || Array.isArray(releases))) {
    throw new Error('Invalid Ruby example tmux releases')
  }
  const holds = releases === undefined ? held : {}
  for (const [path, reason] of Object.entries(holds)) {
    if (!listed.some((program) => program.path === path)) throw new Error(`Held Ruby example is not in the manifest: ${path}`)
    if (!reason.trim()) throw new Error(`Held Ruby example has no reason: ${path}`)
  }
  const selected = listed.filter((program) => !Object.hasOwn(holds, program.path))
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
    const release = releases === undefined ? LEGACY_TMUX_RELEASE : (releases as Record<string, unknown>)[program.path]
    if (release === undefined) throw new Error(`Ruby example has no tmux release: ${program.path}`)
    if (typeof release !== 'string' || !/^\d+\.\d+[a-z]?$/.test(release)) {
      throw new Error(`Invalid Ruby example tmux release: ${program.path}`)
    }
    const filename = basename(program.path)
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'ruby',
        intro: `${api.description.replace(/\n/g, ' ')} Use Ruby 3.3 or newer with Bundler, and tmux ${release} or newer, on Unix with \`/bin/cat\` and \`/bin/sh\` available. In an empty directory, save this \`Gemfile\`:`,
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
