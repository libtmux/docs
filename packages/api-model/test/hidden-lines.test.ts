import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMarkdownDocFull } from '../src/doc/markdown.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { RUST, TYPESCRIPT } from '../src/languages/specs.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fenced = (lang: string, ...lines: string[]) => `Summary.\n\n\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``
const codeOf = (doc: string, language: string) => parseMarkdownDocFull(doc, language).doc.examples?.[0]?.code

describe('Rust hidden lines', () => {
  const lines = ['# use libtmux::Server;', '#', 'let server = Server::new();', '    # setup();', '    server.run();', '#[derive(Debug)]', '## literal', '#![allow(unused)]']

  it('hides what rustdoc hides and escapes `##` to `#`', () => {
    expect(codeOf(fenced('rust', ...lines), 'rust')).toBe('let server = Server::new();\n    server.run();\n#[derive(Debug)]\n# literal\n#![allow(unused)]')
  })

  it.each(['', 'no_run', 'should_panic', 'compile_fail', 'ignore', 'edition2021'])('treats a ```%s fence in Rust docs as Rust', (lang) => {
    expect(codeOf(fenced(lang, '# hidden();', 'shown();'), 'rust')).toBe('shown();')
  })

  it('shows every line of a non-Rust block in a Rust comment', () => {
    for (const lang of ['console', 'toml', 'text', 'sh']) {
      expect(codeOf(fenced(lang, '# comment', 'value = 1'), 'rust'), lang).toBe('# comment\nvalue = 1')
    }
  })

  it('reaches the model through extraction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hidden-lines-'))
    dirs.push(dir)
    const file = join(dir, 'lib.rs')
    writeFileSync(file, '/// Run it.\n///\n/// ```\n/// # use libtmux::Server;\n/// let server = Server::new();\n///     server.run();\n/// ```\n///\n/// ```toml\n/// # tuned for tests\n/// timeout = 5\n/// ```\npub fn run() {}\n')
    const [symbol] = await extractWithSpec(RUST, file, 'm')
    expect(symbol.doc?.examples?.map((example) => example.code)).toEqual(['let server = Server::new();\n    server.run();', '# tuned for tests\ntimeout = 5'])
  })
})

describe('comment lines in other languages', () => {
  it.each([
    ['python', ['# Connect first', 'server = Server()', '    # then list', 'server.sessions']],
    ['ruby', ['# Connect first', 'server = Server.new', '  # then list', 'server.sessions']],
    ['sh', ['# install', 'npm i libtmux', '#', '# run', 'node main.js']],
    ['yaml', ['# session', 'name: demo', '  # window', 'windows: []']],
  ])('keeps every line of a %s block', (lang, lines) => {
    for (const language of ['typescript', 'swift', 'kotlin', 'scala', 'java', 'text']) {
      expect(codeOf(fenced(lang, ...lines), language), `${lang} in ${language}`).toBe(lines.join('\n'))
    }
  })

  it('does not apply rustdoc rules to a rust fence outside Rust docs', () => {
    expect(codeOf(fenced('rust', '# note', 'let a = 1;', '## two'), 'typescript')).toBe('# note\nlet a = 1;\n## two')
  })

  it('reaches the model through extraction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hidden-lines-'))
    dirs.push(dir)
    const file = join(dir, 'x.ts')
    writeFileSync(file, '/**\n * Install it.\n *\n * ```sh\n * # install\n * npm i libtmux\n * ```\n *\n * ```python\n * # connect\n * server = Server()\n * ```\n */\nexport function install(): void {}\n')
    const [symbol] = await extractWithSpec(TYPESCRIPT, file, 'm')
    expect(symbol.doc?.examples?.map((example) => example.code)).toEqual(['# install\nnpm i libtmux', '# connect\nserver = Server()'])
  })
})
