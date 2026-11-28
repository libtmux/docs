import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractRustWorkspace, rustWorkspaceLayout } from '../src/languages/rust-workspace.ts'
import { SymbolIndex } from '../src/link.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const files: Record<string, string> = {}
  for (const name of ['libtmux', 'libtmux-core', 'libtmux-blocking', 'libtmux-tokio']) {
    files[`crates/${name}/Cargo.toml`] = `[package]\nname = "${name}"\nversion = "0.1.2"\n`
    files[`crates/${name}/src/lib.rs`] = ''
    files[`crates/${name}/docs/public-api.txt`] = ''
  }
  files['crates/libtmux-core/src/lib.rs'] = 'mod receipt;\npub use receipt::CreatedSession;\n'
  files['crates/libtmux-core/src/receipt.rs'] = 'pub struct CreatedSession;\nimpl CreatedSession { pub fn pane(&self) {} }\n'
  files['crates/libtmux-core/docs/public-api.txt'] = 'struct libtmux_core::CreatedSession\nfunction libtmux_core::CreatedSession::pane: fn(&self)\n'
  files['crates/libtmux-tokio/src/lib.rs'] = 'mod server;\npub use server::Server;\npub use libtmux_core::CreatedSession;\n'
  files['crates/libtmux-tokio/src/server.rs'] = 'pub struct Server;\nimpl Server { pub fn capture(&self, receipt: CreatedSession) {} }\n'
  files['crates/libtmux-tokio/docs/public-api.txt'] = 'struct libtmux_tokio::Server\nfunction libtmux_tokio::Server::capture: fn(&self)\nstruct libtmux_tokio::CreatedSession\n'
  files['crates/libtmux-blocking/src/lib.rs'] = 'pub struct Server;\nimpl Server { pub fn new_session(&self) {} }\n'
  files['crates/libtmux-blocking/docs/public-api.txt'] = 'struct libtmux_blocking::Server\nfunction libtmux_blocking::Server::new_session: fn(&self)\n'
  return { files, read: (file: string) => files[file] }
}

async function extract(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'rust-workspace-'))
  dirs.push(root)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), contents)
  }
  return extractRustWorkspace({ root, revision: 'a'.repeat(40), options: { inheritedMembers: false } })
}

describe('Rust workspace declaration identities', () => {
  it('keeps driver owners and methods distinct and resolves canonical defining crates', async () => {
    const f = fixture()
    const model = await extract(f.files)
    const tokio = model.symbols.find((symbol) => symbol.publicId === 'libtmux_tokio.Server')!
    const blocking = model.symbols.find((symbol) => symbol.publicId === 'libtmux_blocking.Server')!
    expect(tokio).toMatchObject({ id: 'libtmux_tokio.server.Server', namespace: 'libtmux_tokio' })
    expect(blocking).toMatchObject({ id: 'libtmux_blocking.Server', namespace: 'libtmux_blocking' })
    expect(model.symbols.filter((symbol) => symbol.parent === tokio.id).map((symbol) => symbol.name)).toEqual(['capture'])
    expect(model.symbols.filter((symbol) => symbol.parent === blocking.id).map((symbol) => symbol.name)).toEqual(['new_session'])
    const receipt = model.symbols.find((symbol) => symbol.publicId === 'libtmux_core.CreatedSession')!
    expect(receipt).toBeDefined()
    expect(model.symbols.filter((symbol) => symbol.name === 'CreatedSession')).toHaveLength(1)
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.publicId}/`, 'rs')
    expect(index.resolve('libtmux_tokio.Server.capture')?.symbol?.parent).toBe(tokio.id)
    expect(index.resolve('libtmux_blocking.Server.new_session')?.symbol?.parent).toBe(blocking.id)
    expect(index.resolve('server.Server.capture')?.symbol?.parent).toBe(tokio.id)
    const capture = model.symbols.find((symbol) => symbol.publicId === 'libtmux_tokio.Server.capture')!
    expect(index.resolve('CreatedSession', 'any', capture)?.symbol?.id).toBe(receipt.id)
  })

  it('folds helper impl blocks within their own crate even when another crate has the same owner', async () => {
    const f = fixture()
    f.files['crates/libtmux-tokio/src/extra.rs'] = 'impl Server { pub fn observe_pane(&self) {} }\n'
    f.files['crates/libtmux-tokio/docs/public-api.txt'] += 'function libtmux_tokio::Server::observe_pane: fn(&self)\n'
    const model = await extract(f.files)
    expect(model.symbols.find((symbol) => symbol.name === 'observe_pane')).toMatchObject({
      parent: 'libtmux_tokio.server.Server', publicId: 'libtmux_tokio.Server.observe_pane',
    })
  })

  it('uses canonical paths for root functions whose inventory has a signature separator', async () => {
    const f = fixture()
    f.files['crates/libtmux-core/src/lib.rs'] += 'mod helpers; pub use helpers::escape_format;\n'
    f.files['crates/libtmux-core/src/helpers.rs'] = 'pub fn escape_format(value: &str) {}\n'
    f.files['crates/libtmux-core/docs/public-api.txt'] += 'function libtmux_core::escape_format: fn(value: &str)\n'
    const model = await extract(f.files)
    expect(model.symbols.find((symbol) => symbol.name === 'escape_format')).toMatchObject({
      id: 'libtmux_core.helpers.escape_format', publicId: 'libtmux_core.escape_format',
    })
  })

  it('maps native rustdoc type_alias records to canonical alias pages', async () => {
    const f = fixture()
    f.files['crates/libtmux-core/src/lib.rs'] += 'mod keys; pub use keys::PaneKey;\n'
    f.files['crates/libtmux-core/src/keys.rs'] = 'pub type PaneKey = String;\n'
    f.files['crates/libtmux-core/docs/public-api.txt'] += 'type_alias libtmux_core::PaneKey = String\n'
    const model = await extract(f.files)
    expect(model.symbols.find((symbol) => symbol.name === 'PaneKey')).toMatchObject({
      id: 'libtmux_core.keys.PaneKey', publicId: 'libtmux_core.PaneKey',
    })
  })

  it('keeps a visible alias and signature type from a hidden module out of helper search entries', async () => {
    const f = fixture()
    f.files['crates/libtmux-core/src/lib.rs'] += '#[doc(hidden)] pub mod implementation; pub use implementation::VisibleSnapshot;\n'
    f.files['crates/libtmux-core/src/implementation.rs'] = `pub struct VisibleSnapshot;
      impl VisibleSnapshot { pub fn value(&self) -> ReturnValue { loop {} } }
      pub struct ReturnValue;
      pub struct HiddenOnlyHelper;
      impl HiddenOnlyHelper { pub fn inspect(&self) {} }
    `
    f.files['crates/libtmux-core/docs/public-api.txt'] += `struct libtmux_core::VisibleSnapshot
function libtmux_core::VisibleSnapshot::value: fn(&self) -> libtmux_core::implementation::ReturnValue
struct libtmux_core::implementation::ReturnValue
`
    const model = await extract(f.files)
    expect(model.symbols.find((symbol) => symbol.publicId === 'libtmux_core.VisibleSnapshot.value')).toBeDefined()
    expect(model.symbols.find((symbol) => symbol.publicId === 'libtmux_core.implementation.ReturnValue')).toBeDefined()
    expect(model.symbols.some((symbol) => symbol.id.includes('HiddenOnlyHelper'))).toBe(false)
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.publicId}/`, 'rs')
    expect(index.resolve('HiddenOnlyHelper')).toBeUndefined()
    expect(index.resolve('libtmux_core.VisibleSnapshot')?.symbol?.name).toBe('VisibleSnapshot')
  })

  it('preserves the historical file-based IDs when the pinned source predates the split', async () => {
    const model = await extract({
      'crates/libtmux/Cargo.toml': '[package]\nname = "libtmux"\n',
      'crates/libtmux/src/server.rs': 'pub struct Server; impl Server { pub fn capture(&self) {} }\n',
    })
    expect(model.symbols.map((symbol) => symbol.id)).toEqual(['server.Server', 'server.Server.capture'])
    expect(model.symbols.map((symbol) => symbol.publicId)).toEqual(['server.Server', 'server.Server.capture'])
  })

  it('rejects an incomplete split instead of silently reverting to release layout', () => {
    const f = fixture()
    delete f.files['crates/libtmux-core/Cargo.toml']
    expect(() => rustWorkspaceLayout(f.read)).toThrow('Incomplete Rust driver layout')
  })
})
