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

/** Native export metadata selects whole programs; ordinary recipe helpers stay unlisted. */
export function attachCompleteRubyExamples(
  symbols: ApiSymbol[],
  input: unknown,
  source: { repository: string; revision: string },
): void {
  const bundle = input as RubyExamples | undefined
  const programs = bundle?.manifest?.programs
  if (programs === undefined) return
  if (!Array.isArray(programs)) throw new Error('Invalid Ruby example programs')
  const selected = programs.filter((program) => Object.hasOwn(program, 'api'))
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
    if (
      !/^examples\/(?:[\w-]+\/)*[\w-]+\.rb$/.test(program.path) ||
      !/^libtmux(?:-[a-z]+)*$/.test(program.gem) ||
      !api ||
      !Array.isArray(api.symbols) ||
      !api.symbols.length ||
      !api.symbols.every((id) => typeof id === 'string' && id.length && !/\s/.test(id)) ||
      typeof api.description !== 'string' ||
      !api.description.trim() ||
      typeof api.output !== 'string' ||
      !api.output.trim() ||
      !api.output.endsWith('\n')
    ) {
      throw new Error(`Invalid Ruby API example metadata: ${program.path}`)
    }
    const code = files.get(program.path)
    if (!code?.trim()) throw new Error(`Missing complete Ruby example: ${program.path}`)
    const filename = basename(program.path)
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${api.description.replace(/\n/g, ' ')} Use Ruby 4.0.7, Bundler, Git and tmux 3.2a or newer on Unix, with /bin/cat and /bin/sh available. In an empty directory, fetch the documented library revision:`,
        code: `$ git clone https://github.com/${source.repository}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      },
      {
        lang: 'ruby',
        intro: 'Save this dependency file as Gemfile:',
        code: `source "https://rubygems.org"\n\ngem "${program.gem}", path: "libtmux-source/gems/${program.gem}"\n`,
      },
      {
        lang: 'ruby',
        intro: `Save this complete program as ${filename}. Its Server.start block owns a private tmux server and stops it on exit, including after an error.`,
        sourceUrl: `https://github.com/${source.repository}/blob/${source.revision}/${program.path}`,
        code,
      },
      {
        lang: 'console',
        intro:
          'Install the runtime dependencies and run the saved program. An operation or cleanup error makes it exit unsuccessfully:',
        code: `$ bundle config set --local path vendor/bundle && \\\n  bundle install --jobs 2 && \\\n  bundle exec ruby ${filename}\n`,
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
