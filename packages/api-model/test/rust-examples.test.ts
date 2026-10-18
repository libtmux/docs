import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../src/model.ts'
import { attachCompleteRustExamples } from '../src/languages/rust-examples.ts'

const source = { repo: 'libtmux/libtmux-rs', revision: 'a'.repeat(40) }
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
    'crates/libtmux/examples/api_construction.rs': 'use libtmux::Server;\n#[tokio::main(flavor = "current_thread")]\nasync fn main() {}\n',
  }
  const read = (file: string) => file === 'crates/libtmux/examples/api/manifest.json'
    ? JSON.stringify(manifest) : files[file]
  return { symbols, manifest, files, read }
}

function splitFixture(crate: 'libtmux' | 'libtmux-tokio') {
  const original = fixture()
  const namespace = crate.replaceAll('-', '_')
  const replace = (text: string) => text.replaceAll('crates/libtmux', `crates/${crate}`)
    .replaceAll('libtmux::', `${namespace}::`).replaceAll('libtmux-api-example', `${crate}-api-example`)
    .replace('\nlibtmux = ', `\n${crate} = `)
  const manifest = JSON.parse(replace(JSON.stringify(original.manifest))) as typeof original.manifest
  const files = Object.fromEntries(Object.entries(original.files).map(([path, code]) => [replace(path), replace(code)]))
  const symbols = original.symbols.map((symbol) => ({ ...symbol, package: crate,
    source: { file: replace(symbol.source.file) },
    id: crate === 'libtmux' ? symbol.id : `${namespace}.${symbol.id}`,
    parent: symbol.parent && (crate === 'libtmux' ? symbol.parent : `${namespace}.${symbol.parent}`),
  }))
  if (crate === 'libtmux') {
    files[manifest.setupFiles[0].sourceFile] = files[manifest.setupFiles[0].sourceFile].replace(/^tokio = .*\n/m, '')
    files[manifest.examples[0].sourceFile] = 'use libtmux::Server;\nfn main() {}\n'
  }
  files[`crates/${crate}/examples/api/manifest.json`] = JSON.stringify(manifest)
  return { files, symbols, manifest }
}

describe('complete Rust API programs', () => {
  it('preserves old docs and exact source bytes, and binds native kinds and trait owners', () => {
    const f = fixture()
    attachCompleteRustExamples(f.symbols, f.read, source)
    for (const index of [0, 1, 4]) {
      const blocks = f.symbols[index].doc!.examples!
      expect(f.symbols[index].doc!.summary).toBe('Existing prose.')
      expect(blocks[0].code).toBe('old();\n')
      expect(blocks).toHaveLength(7)
      expect(blocks[2].code).toBe(f.files['crates/libtmux/examples/api/consumer.toml'])
      expect(blocks[3].code).toBe(f.files['rust-toolchain.toml'])
      expect(blocks[4].code).toBe(f.files[f.manifest.examples[0].sourceFile])
      expect(blocks[4].sourceUrl).toBe(`https://github.com/${source.repo}/blob/${source.revision}/${f.manifest.examples[0].sourceFile}`)
      expect(blocks[1].code).toContain(`checkout --detach ${source.revision}`)
      expect(blocks[5].code).toContain('mkdir -p src &&\n')
      expect(blocks[5].code).toContain('cargo run --quiet\n')
      expect(blocks[6].code).toBe('done\n')
    }
    expect(f.symbols[2].doc!.examples).toHaveLength(1)
    expect(f.symbols[3].doc!.examples).toHaveLength(1)
  })

  it('attaches both clients to their own pages with exact runtime-specific setup', () => {
    const blocking = splitFixture('libtmux')
    const native = splitFixture('libtmux-tokio')
    const files = { ...blocking.files, ...native.files }
    const symbols = [...blocking.symbols, ...native.symbols]
    attachCompleteRustExamples(symbols, (path) => files[path], source)
    for (const client of [blocking, native]) {
      const blocks = client.symbols[0].doc!.examples!
      expect(blocks[2].code).toBe(client.files[client.manifest.setupFiles[0].sourceFile])
      expect(blocks[4].code).toBe(client.files[client.manifest.examples[0].sourceFile])
      expect(blocks[5].code).toContain(client.manifest.setupFiles[0].sourceFile)
    }
    expect(blocking.symbols[0].doc!.examples![2].code).not.toContain('tokio')
    expect(native.symbols[0].doc!.examples![2].code).toContain('libtmux-tokio = ')
  })

  it('rejects a Tokio entrypoint with blocking setup without changing either crate', () => {
    const blocking = splitFixture('libtmux')
    const native = splitFixture('libtmux-tokio')
    native.files[native.manifest.setupFiles[0].sourceFile] = native.files[native.manifest.setupFiles[0].sourceFile].replace(/^tokio = .*\n/m, '')
    const files = { ...blocking.files, ...native.files }
    const symbols = [...blocking.symbols, ...native.symbols]
    const before = structuredClone(symbols)
    expect(() => attachCompleteRustExamples(symbols, (path) => files[path], source)).toThrow('dependencies')
    expect(symbols).toEqual(before)
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
    ['missing toolchain', (f: ReturnType<typeof fixture>) => { delete f.files['rust-toolchain.toml'] }],
    ['malformed TOML', (f: ReturnType<typeof fixture>) => { f.files['rust-toolchain.toml'] += '[broken\n' }],
    ['unpinned toolchain', (f: ReturnType<typeof fixture>) => { f.files['rust-toolchain.toml'] = '[toolchain]\nchannel = "stable"\n' }],
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
