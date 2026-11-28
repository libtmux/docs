import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectRustExampleProof, verifyArchiveRecord } from '../../../scripts/verify-rust-examples.mjs'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const hash = (code: string) => createHash('sha256').update(code).digest('hex')
const revision = 'a'.repeat(40)
const source = 'fn main() { println!("mixed runtime"); }\n'
const setup = `$ cargo init --name example &&\n  cargo add --git https://github.com/libtmux/libtmux-rs --rev ${revision} libtmux\n`
const copy = (text: string) => text.replace(/\n$/, '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('\n', '&#127;')

function fixture(split = true) {
  const root = mkdtempSync(join(tmpdir(), 'rust-copy-proof-'))
  dirs.push(root)
  const sourceRoot = join(root, 'source')
  const renderedRoot = join(root, 'rendered')
  const write = (file: string, contents: string) => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  for (const name of split ? ['libtmux', 'libtmux-core', 'libtmux-blocking', 'libtmux-tokio'] : ['libtmux']) {
    write(join(sourceRoot, `crates/${name}/Cargo.toml`), `[package]\nname = "${name}"\n`)
  }
  const symbols: any[] = []
  const programs = split ? [['libtmux-tokio', 'construction', 'libtmux_tokio.Server'], ['libtmux', 'mixed', 'libtmux_core.CreatedSession.pane']]
    : [['libtmux', 'construction', 'server.Server']]
  for (const [name, task, target] of programs) {
    const file = `crates/${name}/examples/api_${task}.rs`
    const url = `https://github.com/libtmux/libtmux-rs/blob/${revision}/${file}`
    write(join(sourceRoot, file), source)
    write(join(sourceRoot, `crates/${name}/examples/api/manifest.json`), JSON.stringify({
      schemaVersion: 1, examples: [{ id: `rust-${task}`, cargoExample: `api_${task}`, sourceFile: file,
        targets: [split ? target.replaceAll('.', '::') : 'libtmux::Server'], expectedOutput: 'mixed runtime' }],
    }) + '\n')
    const slug = target.toLowerCase().replaceAll('.', '-')
    const blocks = [{ lang: 'console', code: split ? setup : '$ cargo init --name example &&\n  cargo add libtmux@0.1.2\n' }, { lang: 'rust', code: source, sourceUrl: url },
      { lang: 'console', code: '$ cargo run --quiet\n' }, { lang: 'text', code: 'mixed runtime\n' }]
    const symbol = { id: `${target}.defined`, publicId: target, slug, source: { revision }, doc: { examples: blocks } }
    symbols.push(symbol)
    const html = `<section id="${target}.examples">${blocks.map((block) =>
      `<p class="gp-sphinx-api-example-intro">${block.sourceUrl ? `<a href="${block.sourceUrl}">View source</a>` : ''}</p>` +
      `<div class="gp-sphinx-api-example"><button data-code="${copy(block.lang === 'console' ? block.code.replace(/^\$ /gm, '').trim() : block.code)}"></button></div>`).join('')}</section>`
    write(join(renderedRoot, `reference/${slug}/index.html`), html)
    write(join(renderedRoot, `reference/${slug}.md`), blocks.map((block) =>
      `${block.sourceUrl ? `[Source example](${block.sourceUrl}).\n` : ''}\n\`\`\`${block.lang}\n${block.code}\`\`\`\n`).join('\n'))
  }
  return { sourceRoot, renderedRoot, model: { port: 'rs', repo: 'libtmux/libtmux-rs', revision, symbols }, write }
}

describe('rendered Rust installed-reader proof', () => {
  it('checks both manifests and preserves native program, recipe and output bytes in both exports', () => {
    const f = fixture()
    const proof = collectRustExampleProof(f)
    expect(proof.examples.map((entry: any) => entry.sourceProgramId)).toEqual(['rust-construction', 'rust-mixed'])
    expect(proof.pages).toHaveLength(2)
    expect(proof.examples[1].files[0].sha256).toBe(hash(source))
    expect(proof.examples[1].shellRecipe[0]).toContain(`--rev ${revision}`)
  })

  it('verifies a pre-split 0.1.2 export with its original registry recipe and no mixed example', () => {
    const proof = collectRustExampleProof(fixture(false))
    expect(proof.examples.map((entry: any) => entry.sourceProgramId)).toEqual(['rust-construction'])
    expect(proof.examples[0].shellRecipe[0]).toContain('cargo add libtmux@0.1.2')
    expect(proof.expectedArchivePackages).toEqual(['libtmux'])
  })

  it.each(['html', 'markdown', 'native'])('refuses changed %s program bytes', (which) => {
    const f = fixture()
    const file = which === 'native' ? join(f.sourceRoot, 'crates/libtmux/examples/api_mixed.rs')
      : join(f.renderedRoot, `reference/libtmux_core-createdsession-pane${which === 'html' ? '/index.html' : '.md'}`)
    f.write(file, readFileSync(file, 'utf8').replace('println!', 'eprintln!'))
    expect(() => collectRustExampleProof(f)).toThrow()
  })

  it('refuses a wrong source citation and a missing target page', () => {
    const f = fixture()
    const file = join(f.renderedRoot, 'reference/libtmux_core-createdsession-pane/index.html')
    f.write(file, readFileSync(file, 'utf8').replace(`/blob/${revision}/`, '/blob/master/'))
    expect(() => collectRustExampleProof(f)).toThrow('exact pinned source')
    rmSync(file)
    expect(() => collectRustExampleProof(f)).toThrow()
  })

  it('requires the rendered owners to match the selected native target set', () => {
    const f = fixture()
    const path = join(f.sourceRoot, 'crates/libtmux/examples/api/manifest.json')
    f.write(path, readFileSync(path, 'utf8').replace('libtmux_core::CreatedSession::pane', 'libtmux_core::CreatedSession::window'))
    expect(() => collectRustExampleProof(f)).toThrow('native target owners')
  })

  it('does not accept expected output copied into an unrelated Markdown fence', () => {
    const f = fixture()
    const file = join(f.renderedRoot, 'reference/libtmux_core-createdsession-pane.md')
    f.write(file, readFileSync(file, 'utf8').replace('```text\nmixed runtime', '```text\nwrong output') + '\n```text\nmixed runtime\n```\n')
    expect(() => collectRustExampleProof(f)).toThrow('Markdown expected-output bytes')
  })

  it('requires staged archive identity and native bytes alongside the copied program hash', () => {
    const f = fixture()
    const proof = collectRustExampleProof(f)
    const archiveRoot = join(f.sourceRoot, 'archives')
    mkdirSync(archiveRoot)
    const archives = ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux'].map((packageName) => {
      const bytes = `staged ${packageName} archive`
      writeFileSync(join(archiveRoot, `${packageName}-0.1.2.crate`), bytes)
      return { package: packageName, version: '0.1.2', sha256: hash(bytes) }
    })
    const stdoutHex = Buffer.from('mixed runtime\n').toString('hex')
    const record = { sourceRevision: revision, sourceDirty: false, passed: true, archives,
      recorder: { repository: 'https://github.com/libtmux/docs', revision: 'b'.repeat(40), sha256: proof.recorderSha256 },
      mixed: { programSha256: hash(source), stdoutHex,
        cleanup: { required: true, passed: true }, profile: 'raw-stdout-native-capture',
        native: { pane: '%7', generation: { pid: 123, started: 456 }, beforeHex: stdoutHex, afterHex: stdoutHex } } }
    expect(() => verifyArchiveRecord(proof, record, archiveRoot)).not.toThrow()
    expect(() => verifyArchiveRecord(proof, record)).toThrow('physical staged archives are required')
    expect(() => verifyArchiveRecord(proof, { ...record, sourceDirty: true }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, sourceRevision: 'c'.repeat(40) }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, recorder: { ...record.recorder, sha256: 'c'.repeat(64) } }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, mixed: { ...record.mixed, programSha256: 'c'.repeat(64) } }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, mixed: { ...record.mixed, cleanup: { required: true, passed: false } } }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, mixed: { ...record.mixed, native: { ...record.mixed.native, afterHex: '' } } }, archiveRoot)).toThrow()
    expect(() => verifyArchiveRecord(proof, { ...record, archives: record.archives.slice(1) }, archiveRoot)).toThrow()
    writeFileSync(join(archiveRoot, 'libtmux-core-0.1.2.crate'), 'changed normalized archive bytes')
    expect(() => verifyArchiveRecord(proof, record, archiveRoot)).toThrow('physical archive digest')
  })
})
