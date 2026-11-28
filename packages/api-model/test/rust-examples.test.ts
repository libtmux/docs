import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ApiSymbol } from '../src/model.ts'
import { attachCompleteRustExamples } from '../src/languages/rust-examples.ts'

const source = { repo: 'libtmux/libtmux-rs', revision: 'a'.repeat(40) }
const socketCommand = readFileSync(new URL('./fixtures/rust-mixed-run-command.sh', import.meta.url), 'utf8').trimEnd()
const symbol = (id: string, kind: ApiSymbol['kind'], parent?: string): ApiSymbol => ({
  id, name: id.split('.').at(-1)!, slug: id.toLowerCase().replaceAll('.', '-'), kind,
  signatures: [], modifiers: [], ...(parent ? { parent } : {}),
  source: { file: 'crates/libtmux/src/server.rs' },
  doc: { summary: 'Existing prose.', examples: [{ lang: 'rust', code: 'old();\n' }] },
})
function fixture() {
  const symbols = [symbol('server.Server', 'struct'),
    symbol('server.Server.builder', 'method', 'server.Server'),
    symbol('options.OptionScope.Server', 'constant', 'options.OptionScope'),
    symbol('query.QueryIteratorExt', 'trait'),
    symbol('query.QueryIteratorExt.exactly_one', 'method', 'query.QueryIteratorExt')]
  const manifest = {
    schemaVersion: 1, language: 'rust', nativeInventory: 'crates/libtmux/docs/public-api.txt',
    setupFiles: [
      { sourceFile: 'crates/libtmux/examples/api/consumer.toml', name: 'Cargo.toml' },
      { sourceFile: 'rust-toolchain.toml', name: 'rust-toolchain.toml' },
    ], programFileName: 'src/main.rs', runCommand: 'cargo run --quiet',
    examples: [{ id: 'rust-construction', title: 'Construct a server', description: 'Use a private socket.',
      sourceFile: 'crates/libtmux/examples/api_construction.rs', cargoExample: 'api_construction',
      targets: ['libtmux::Server', 'libtmux::Server::builder', 'libtmux::query::QueryIteratorExt::exactly_one'],
      expectedOutput: 'done' }],
  }
  const files: Record<string, string> = {
    'crates/libtmux/docs/public-api.txt': 'struct libtmux::Server\n' +
      'function libtmux::Server::builder: fn() -> libtmux::ServerBuilder\n' +
      'trait libtmux::query::QueryIteratorExt\n' +
      'function libtmux::query::QueryIteratorExt::exactly_one: fn(mut self) -> Result<Self::Item, ExactlyOneError>\n',
    'crates/libtmux/examples/api/consumer.toml': '[package]\nname = "libtmux-api-example"\n' +
      'edition = "2024"\npublish = false\n[workspace]\nexclude = ["libtmux-source"]\n' +
      '[dependencies]\nlibtmux = { path = "libtmux-source/crates/libtmux" }\n' +
      'tempfile = "3.20"\ntokio = { version = "1.40", features = ["macros", "rt", "time"] }\n',
    'rust-toolchain.toml': '[toolchain]\nchannel = "1.97.1"\n',
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n[workspace.package]\nversion = "0.1.0-alpha.17"\nedition = "2024"\nrust-version = "1.85"\n',
    'crates/libtmux/examples/api_construction.rs': 'use libtmux::Server;\n#[tokio::main(flavor = "current_thread")]\nasync fn main() {}\n',
  }
  const read = (file: string) => file === 'crates/libtmux/examples/api/manifest.json'
    ? JSON.stringify(manifest) : files[file]
  return { symbols, manifest, files, read }
}

describe('complete Rust API programs', () => {
  it('preserves old docs and exact source bytes, and binds native kinds and trait owners', () => {
    const f = fixture()
    attachCompleteRustExamples(f.symbols, f.read, source)
    for (const index of [0, 1, 4]) {
      const blocks = f.symbols[index].doc!.examples!
      expect(f.symbols[index].doc!.summary).toBe('Existing prose.')
      expect(blocks[0].code).toBe('old();\n')
      expect(blocks).toHaveLength(5)
      expect(blocks[1].code).toBe('$ cargo init --name libtmux-api-example &&\n' +
        '  cargo add libtmux@0.1.0-alpha.17 tempfile@3.20 &&\n' +
        '  cargo add tokio@1.40 --features macros,rt,time\n')
      expect(blocks[1].intro).toContain('Rust 1.85 or newer')
      expect(blocks[1].intro).not.toMatch(/git|clone|1\.97/i)
      expect(blocks[2].code).toBe(f.files[f.manifest.examples[0].sourceFile])
      expect(blocks[2].sourceUrl).toBe(`https://github.com/${source.repo}/blob/${source.revision}/${f.manifest.examples[0].sourceFile}`)
      expect(blocks[2].intro).toContain('`src/main.rs`')
      expect(blocks[3].code).toBe('$ cargo run --quiet\n')
      expect(blocks[4].code).toBe('done\n')
    }
    expect(f.symbols[2].doc!.examples).toHaveLength(1)
    expect(f.symbols[3].doc!.examples).toHaveLength(1)
  })

  it('leaves source revisions without a manifest unchanged', () => {
    const f = fixture()
    const before = structuredClone(f.symbols)
    attachCompleteRustExamples(f.symbols, () => undefined, source)
    expect(f.symbols).toEqual(before)
  })

  it.each([
    ['missing native target', (f: ReturnType<typeof fixture>) => { f.manifest.examples[0].targets.push('libtmux::Unknown') }],
    ['duplicate native target', (f: ReturnType<typeof fixture>) => { f.manifest.examples[0].targets.push('libtmux::Server') }],
    ['ambiguous inventory', (f: ReturnType<typeof fixture>) => { f.files[f.manifest.nativeInventory] += 'enum libtmux::Server\n' }],
    ['missing model target', (f: ReturnType<typeof fixture>) => { f.symbols.splice(1, 1) }],
    ['ambiguous model target', (f: ReturnType<typeof fixture>) => { f.symbols.push(symbol('other.Server', 'struct')) }],
    ['wrong kind', (f: ReturnType<typeof fixture>) => { f.symbols[0].kind = 'enum' }],
    ['wrong method owner', (f: ReturnType<typeof fixture>) => { f.symbols[4].parent = 'query.Other' }],
    ['wrong source crate', (f: ReturnType<typeof fixture>) => { f.symbols[0].source.file = 'crates/tmux-workspace/src/server.rs' }],
    ['wrong product', (f: ReturnType<typeof fixture>) => { f.symbols[0].product = 'workspace' }],
    ['duplicate program', (f: ReturnType<typeof fixture>) => { f.manifest.examples.push(f.manifest.examples[0]) }],
    ['missing Cargo setup', (f: ReturnType<typeof fixture>) => { delete f.files[f.manifest.setupFiles[0].sourceFile] }],
    ['missing workspace manifest', (f: ReturnType<typeof fixture>) => { delete f.files['Cargo.toml'] }],
    ['malformed TOML', (f: ReturnType<typeof fixture>) => { f.files['Cargo.toml'] += '[broken\n' }],
    ['unversioned workspace', (f: ReturnType<typeof fixture>) => { f.files['Cargo.toml'] = f.files['Cargo.toml'].replace('version = "0.1.0-alpha.17"\n', '') }],
    ['missing minimum Rust', (f: ReturnType<typeof fixture>) => { f.files['Cargo.toml'] = f.files['Cargo.toml'].replace('rust-version = "1.85"\n', '') }],
    ['wrong dependency path', (f: ReturnType<typeof fixture>) => { const file = f.manifest.setupFiles[0].sourceFile; f.files[file] = f.files[file].replace('libtmux-source/crates/libtmux', '../hidden') }],
    ['missing runtime dependency', (f: ReturnType<typeof fixture>) => { const file = f.manifest.setupFiles[0].sourceFile; f.files[file] = f.files[file].replace('"macros", ', '') }],
    ['duplicate setup file', (f: ReturnType<typeof fixture>) => { f.manifest.setupFiles[1] = f.manifest.setupFiles[0] }],
    ['unsafe program path', (f: ReturnType<typeof fixture>) => { f.manifest.examples[0].sourceFile = '../main.rs' }],
    ['unexpected run command', (f: ReturnType<typeof fixture>) => { f.manifest.runCommand = 'cargo run --features test-support' }],
    ['missing program', (f: ReturnType<typeof fixture>) => { delete f.files[f.manifest.examples[0].sourceFile] }],
    ['partial file', (f: ReturnType<typeof fixture>) => { const file = f.manifest.examples[0].sourceFile; f.files[file] = f.files[file].trimEnd() }],
    ['hidden helper', (f: ReturnType<typeof fixture>) => { f.files[f.manifest.examples[0].sourceFile] += 'mod helper;\n' }],
    ['missing entrypoint', (f: ReturnType<typeof fixture>) => { f.files[f.manifest.examples[0].sourceFile] = 'fn example() {}\n' }],
    ['empty output', (f: ReturnType<typeof fixture>) => { f.manifest.examples[0].expectedOutput = '' }],
  ])('rejects %s without partially changing documentation', (_name, change) => {
    const f = fixture()
    change(f)
    const before = structuredClone(f.symbols)
    expect(() => attachCompleteRustExamples(f.symbols, f.read, source)).toThrow()
    expect(f.symbols).toEqual(before)
  })

  it('rejects an unpinned revision or foreign repository', () => {
    const f = fixture()
    expect(() => attachCompleteRustExamples(f.symbols, f.read, { ...source, revision: 'master' })).toThrow('full revision')
    expect(() => attachCompleteRustExamples(f.symbols, f.read, { ...source, repo: 'other/repo' })).toThrow('Rust repository')
  })
})

function splitFixture() {
  const legacy = fixture()
  const files = { ...legacy.files }
  for (const name of ['libtmux', 'libtmux-core', 'libtmux-blocking', 'libtmux-tokio']) {
    files[`crates/${name}/Cargo.toml`] = `[package]\nname = "${name}"\nversion = "0.1.2"\n`
  }
  const tokio = structuredClone(legacy.manifest)
  tokio.nativeInventory = 'crates/libtmux-tokio/docs/public-api.txt'
  tokio.setupFiles[0].sourceFile = 'crates/libtmux-tokio/examples/api/consumer.toml'
  tokio.examples[0].sourceFile = 'crates/libtmux-tokio/examples/api_construction.rs'
  tokio.examples[0].targets = ['libtmux_tokio::Server', 'libtmux_tokio::Server::builder']
  const mixed = structuredClone(legacy.manifest)
  mixed.examples[0] = { ...mixed.examples[0], id: 'rust-mixed', cargoExample: 'api_mixed',
    sourceFile: 'crates/libtmux/examples/api_mixed.rs',
    targets: ['libtmux_blocking::Server::new_session', 'libtmux_core::CreatedSession::pane'] }
  files[tokio.nativeInventory] = 'struct libtmux_tokio::Server\nfunction libtmux_tokio::Server::builder: fn()\n'
  files['crates/libtmux-blocking/docs/public-api.txt'] = 'struct libtmux_blocking::Server\nfunction libtmux_blocking::Server::new_session: fn(&self)\n'
  files['crates/libtmux-core/docs/public-api.txt'] = 'struct libtmux_core::CreatedSession\nfunction libtmux_core::CreatedSession::pane: fn(&self)\n'
  files[mixed.nativeInventory] = ''
  files[tokio.setupFiles[0].sourceFile] = legacy.files[legacy.manifest.setupFiles[0].sourceFile]
    .replace('libtmux = { path = "libtmux-source/crates/libtmux" }',
      'libtmux-tokio = { path = "libtmux-source/crates/libtmux-tokio" }')
  files[mixed.setupFiles[0].sourceFile] = legacy.files[legacy.manifest.setupFiles[0].sourceFile]
    .replace('libtmux-source/crates/libtmux" }',
      'libtmux-source/crates/libtmux", default-features = false, features = ["blocking", "tokio", "test-support"] }')
  files[tokio.examples[0].sourceFile] = 'use libtmux_tokio::Server;\n#[tokio::main(flavor = "current_thread")]\nasync fn main() {}\n'
  files[mixed.examples[0].sourceFile] = 'fn main() { let runtime = tokio::runtime::Builder::new_current_thread(); }\n'
  files['Cargo.toml'] = files['Cargo.toml'].replace('0.1.0-alpha.17', '0.1.2')
  const symbols = [
    symbol('libtmux_tokio.server.Server', 'struct'),
    symbol('libtmux_tokio.server.Server.builder', 'method', 'libtmux_tokio.server.Server'),
    symbol('libtmux_blocking.Server', 'struct'),
    symbol('libtmux_blocking.Server.new_session', 'method', 'libtmux_blocking.Server'),
    symbol('libtmux_core.receipt.CreatedSession', 'struct'),
    symbol('libtmux_core.receipt.CreatedSession.pane', 'method', 'libtmux_core.receipt.CreatedSession'),
  ]
  for (const entry of symbols) {
    const namespace = entry.id.split('.')[0]
    entry.namespace = namespace
    entry.publicId = entry.id.replace('.server.', '.').replace('.receipt.', '.')
    entry.source.file = `crates/${namespace.replaceAll('_', '-')}/src/lib.rs`
  }
  const read = (file: string) => file === 'crates/libtmux-tokio/examples/api/manifest.json' ? JSON.stringify(tokio)
    : file === 'crates/libtmux/examples/api/manifest.json' ? JSON.stringify(mixed) : files[file]
  return { files, tokio, mixed, symbols, read }
}

describe('complete split-crate Rust programs', () => {
  it('shows the complete source-owned borrowed-socket recipe without test support', () => {
    const f = splitFixture()
    f.mixed.runCommand = socketCommand
    const file = f.mixed.setupFiles[0].sourceFile
    f.files[file] = f.files[file].replace(', "test-support"', '')
    attachCompleteRustExamples(f.symbols, f.read, source)
    const blocks = f.symbols[5].doc!.examples!
    expect(blocks[1].code).not.toContain('test-support')
    expect(blocks[3].code).toBe(`$ ${socketCommand}\n`)
    expect(blocks[3].intro).toContain('fixture')
  })

  it('refuses a borrowed-socket recipe without the surviving-session check', () => {
    const f = splitFixture()
    f.mixed.runCommand = socketCommand.replace(/\n  \[ .* = fixture \]/, '')
    expect(() => attachCompleteRustExamples(f.symbols, f.read, source)).toThrow('unexpected consumer setup')
  })

  it('refuses a borrowed-socket consumer that still enables test support', () => {
    const f = splitFixture()
    f.mixed.runCommand = socketCommand
    expect(() => attachCompleteRustExamples(f.symbols, f.read, source)).toThrow('without test support')
  })

  it('attaches both roots and pins the matching source instead of the old published workspace version', () => {
    const f = splitFixture()
    attachCompleteRustExamples(f.symbols, f.read, source)
    for (const index of [0, 1, 3, 5]) {
      const blocks = f.symbols[index].doc!.examples!
      expect(blocks).toHaveLength(5)
      expect(blocks[1].code).toContain('--git https://github.com/libtmux/libtmux-rs')
      expect(blocks[1].code).toContain(`--rev ${source.revision}`)
      expect(blocks[1].code).not.toContain('libtmux@0.1.2')
      expect(blocks[2].sourceUrl).toContain(`/blob/${source.revision}/crates/`)
    }
    expect(f.symbols[3].doc!.examples![1].code).toContain('--features blocking,tokio,test-support')
    expect(f.symbols[5].doc!.examples![2].code).toBe(f.files[f.mixed.examples[0].sourceFile])
  })

  it('does not publish the first root when the second root has an invalid target', () => {
    const f = splitFixture()
    f.mixed.examples[0].targets.push('libtmux_core::Missing')
    const before = structuredClone(f.symbols)
    expect(() => attachCompleteRustExamples(f.symbols, f.read, source)).toThrow()
    expect(f.symbols).toEqual(before)
  })

  it('accepts the synchronous mixed consumer with its actual runtime features and package name', () => {
    const f = splitFixture()
    const file = f.mixed.setupFiles[0].sourceFile
    f.files[file] = f.files[file].replace('libtmux-api-example', 'libtmux-mixed-example')
      .replace('tempfile = "3.20"\n', '').replace('"macros", ', '')
    attachCompleteRustExamples(f.symbols, f.read, source)
    const setup = f.symbols[5].doc!.examples![1].code
    expect(setup).toContain('cargo init --name libtmux-mixed-example')
    expect(setup).toContain('cargo add tokio@1.40 --features rt,time')
    expect(setup).not.toContain('tempfile')
  })

  it('rejects a missing current manifest instead of silently using the historical one', () => {
    const f = splitFixture()
    expect(() => attachCompleteRustExamples(f.symbols,
      (file) => file.includes('libtmux-tokio/examples/api/manifest.json') ? undefined : f.read(file), source)).toThrow('missing current manifest')
  })
})
