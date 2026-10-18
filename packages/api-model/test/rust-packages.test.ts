import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachRustPackageExports } from '../src/languages/rust-packages.ts'
import { SymbolIndex } from '../src/link.ts'
import { extractProject } from '../src/project.ts'
import { Resolver } from '../src/resolver.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

async function fixture(change?: (files: Record<string, string>) => void) {
  const files: Record<string, string> = {
    'crates/libtmux/src/lib.rs': 'mod server;\nmod extras;\npub use server::Server;\npub mod query;\n',
    'crates/libtmux/src/server.rs': '/// Blocking server.\npub struct Server;\nimpl Server { pub fn run(&self) -> Result<(), Error> { Ok(()) } }\npub enum Error { Failed }\n',
    'crates/libtmux/src/extras.rs': 'impl Server { pub fn close(&self) {} }\n',
    'crates/libtmux/src/query.rs': 'pub trait QueryIteratorExt { fn exactly_one(self); }\npub struct Filter;\n',
    'crates/libtmux/docs/public-api.txt': 'struct libtmux::Server\nfunction libtmux::Server::run: fn(&self)\nfunction libtmux::Server::close: fn(&self)\ntrait libtmux::query::QueryIteratorExt\nfunction libtmux::query::QueryIteratorExt::exactly_one: fn(self)\nstruct libtmux::query::Filter\n',
    'crates/libtmux-tokio/src/lib.rs': 'mod server;\nmod extras;\npub use server::Server;\npub mod query;\n',
    'crates/libtmux-tokio/src/server.rs': '/// Async server.\npub struct Server;\nimpl Server { pub async fn run(&self) -> Result<(), Error> { Ok(()) } }\npub enum Error { Failed }\n',
    'crates/libtmux-tokio/src/extras.rs': 'impl Server { pub async fn close(&self) {} }\n',
    'crates/libtmux-tokio/src/query.rs': 'pub use libtmux::query::*;\n',
    'crates/libtmux-tokio/docs/public-api.txt': 'struct libtmux_tokio::Server\nfunction libtmux_tokio::Server::run: async fn(&self)\nfunction libtmux_tokio::Server::close: async fn(&self)\ntrait libtmux_tokio::query::QueryIteratorExt\nfunction libtmux_tokio::query::QueryIteratorExt::exactly_one: fn(self)\nstruct libtmux_tokio::query::Filter\n',
  }
  change?.(files)
  const directory = mkdtempSync(join(tmpdir(), 'rust-crates-'))
  directories.push(directory)
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), code)
  }
  const roots = ['libtmux', 'libtmux-tokio'].map((name) => join(directory, `crates/${name}/src`))
  const model = await extractProject({ port: 'rs', root: roots[0], roots })
  const read = (path: string) => { try { return readFileSync(join(directory, path), 'utf8') } catch { return undefined } }
  await attachRustPackageExports(model, read)
  return model
}

describe('Rust package ownership', () => {
  it('keeps identical handles and extension methods in their declaring crate', async () => {
    const model = await fixture()
    for (const [prefix, packageName, async] of [['', 'libtmux', false], ['libtmux_tokio.', 'libtmux-tokio', true]] as const) {
      const server = model.symbols.find((symbol) => symbol.id === `${prefix}server.Server`)!
      expect(server).toMatchObject({ kind: 'struct', package: packageName, qualifiedName: `${packageName.replaceAll('-', '_')}.Server` })
      expect(server.source.file).toContain(`/crates/${packageName}/src/server.rs`)
      for (const method of ['run', 'close']) {
        const member = model.symbols.find((symbol) => symbol.id === `${server.id}.${method}`)!
        expect(member.parent).toBe(server.id)
        expect(member.signatures).toHaveLength(1)
        expect(member.modifiers.includes('async')).toBe(async)
        expect(member.source.file).toContain(`/crates/${packageName}/src/`)
      }
    }
    expect(new Set(model.symbols.map((symbol) => symbol.id)).size).toBe(model.symbols.length)
  })

  it('projects verified shared exports with their actual declaration and owner', async () => {
    const model = await fixture()
    const trait = model.symbols.find((symbol) => symbol.id === 'libtmux_tokio.query.QueryIteratorExt')!
    expect(trait).toMatchObject({ kind: 'trait', package: 'libtmux-tokio', publicOwner: 'query.QueryIteratorExt' })
    expect(trait.source.file).toContain('/crates/libtmux/src/query.rs')
    expect(model.symbols.find((symbol) => symbol.id === `${trait.id}.exactly_one`)).toMatchObject({ parent: trait.id,
      publicOwner: 'query.QueryIteratorExt.exactly_one' })
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.id}`, 'rs')
    const asyncServer = model.symbols.find((symbol) => symbol.id === 'libtmux_tokio.server.Server')!
    expect(index.resolve('Server', 'class', asyncServer)?.symbol?.id).toBe(asyncServer.id)
    expect(index.resolve('Server', 'class')?.symbol?.id).toBe('server.Server')
    expect(new Resolver([model]).resolve('rs', 'libtmux_tokio::Server')).toMatchObject({ symbol: { id: asyncServer.id } })
    expect(new Resolver([model]).resolve('rs', 'Server')).toMatchObject({ symbol: { id: 'server.Server' } })
  })

  it('qualifies generic root exports and projects generic shared types and members', async () => {
    const model = await fixture((files) => {
      files['crates/libtmux/src/query.rs'] += [
        'pub struct FilterExpr<T>(T);',
        'impl<T> FilterExpr<T> { pub fn and(self, other: Self) -> Self { self } }',
        'pub trait Matcher<T> { fn matches(&self, candidate: &T) -> bool; }',
        'pub struct IntegerField<T, N>(T, N);',
        'impl<T, N> IntegerField<T, N> { pub fn eq(self, value: N) -> FilterExpr<T> { todo!() } }',
      ].join('\n')
      for (const crate of ['libtmux', 'libtmux-tokio']) {
        const namespace = crate.replaceAll('-', '_')
        files[`crates/${crate}/src/lib.rs`] += 'pub use extras::{GenericRoot, RootAlias};\n'
        files[`crates/${crate}/src/extras.rs`] += 'pub struct GenericRoot<T>(T);\npub type RootAlias = u32;\n'
        files[`crates/${crate}/docs/public-api.txt`] += [
          `struct ${namespace}::GenericRoot<T>`,
          `type_alias ${namespace}::RootAlias = u32`,
          `struct ${namespace}::query::FilterExpr<T>`,
          `function ${namespace}::query::FilterExpr::and: fn(self, other: Self) -> Self`,
          `trait ${namespace}::query::Matcher<T>`,
          `function ${namespace}::query::Matcher::matches: fn(&self, candidate: &T) -> bool`,
          `struct ${namespace}::query::IntegerField<T, N>`,
          `function ${namespace}::query::IntegerField::eq: fn(self, value: N) -> FilterExpr<T>`,
          '',
        ].join('\n')
      }
    })
    for (const [prefix, namespace] of [['', 'libtmux'], ['libtmux_tokio.', 'libtmux_tokio']]) {
      expect(model.symbols.find((symbol) => symbol.id === `${prefix}extras.GenericRoot`)).toMatchObject({
        qualifiedName: `${namespace}.GenericRoot`,
      })
      expect(model.symbols.find((symbol) => symbol.id === `${prefix}extras.RootAlias`)).toMatchObject({
        qualifiedName: `${namespace}.RootAlias`,
      })
    }
    for (const [name, method] of [['FilterExpr', 'and'], ['Matcher', 'matches'], ['IntegerField', 'eq']]) {
      const id = `libtmux_tokio.query.${name}`
      const alias = model.symbols.find((symbol) => symbol.id === id)!
      expect(alias).toMatchObject({ package: 'libtmux-tokio', qualifiedName: id, publicOwner: `query.${name}` })
      expect(alias.source.file).toContain('/crates/libtmux/src/query.rs')
      expect(model.symbols.find((symbol) => symbol.id === `${id}.${method}`)).toMatchObject({
        parent: id, publicOwner: `query.${name}.${method}`,
      })
      expect(new Resolver([model]).resolve('rs', `libtmux_tokio::query::${name}`)).toMatchObject({ symbol: { id } })
      expect(new Resolver([model]).resolve('rs', `libtmux_tokio::query::${name}::${method}`)).toMatchObject({
        symbol: { id: `${id}.${method}`, package: 'libtmux-tokio' },
      })
    }
  })

  it('preserves the control event route when its declaration moves behind a public export', async () => {
    const model = await fixture((files) => {
      files['crates/libtmux/src/lib.rs'] += 'mod primitives;\npub use primitives::control as protocol;\npub mod control;\n'
      files['crates/libtmux/src/primitives/mod.rs'] = 'pub mod control;\n'
      files['crates/libtmux/src/primitives/control.rs'] = 'pub enum Event { Output { bytes: Vec<u8> } }\n'
      files['crates/libtmux/src/control.rs'] = 'pub use crate::protocol::Event;\n'
      files['crates/libtmux/docs/public-api.txt'] += 'enum libtmux::control::Event\nconstant libtmux::control::Event::Output\nfield libtmux::control::Event::Output::bytes\n'
      files['crates/libtmux-tokio/src/lib.rs'] += 'pub mod control;\n'
      files['crates/libtmux-tokio/src/control.rs'] = 'pub use libtmux::control::Event;\n'
      files['crates/libtmux-tokio/docs/public-api.txt'] += 'enum libtmux_tokio::control::Event\nconstant libtmux_tokio::control::Event::Output\nfield libtmux_tokio::control::Event::Output::bytes\n'
    })
    expect(model.symbols.find((symbol) => symbol.id === 'control.Event.Output')).toMatchObject({
      parent: 'control.Event', qualifiedName: 'libtmux.control.Event.Output',
    })
    const event = model.symbols.find((symbol) => symbol.id === 'control.Event')!
    expect(event.source.file).toContain('/crates/libtmux/src/primitives/control.rs')
    expect(model.symbols.find((symbol) => symbol.id === 'libtmux_tokio.control.Event')).toMatchObject({ publicOwner: event.id })
  })

  it('leaves a missing client type unresolved instead of borrowing another crate’s handle', async () => {
    const model = await fixture()
    const context = model.symbols.find((symbol) => symbol.id === 'query.Filter')!
    const symbols = model.symbols.filter((symbol) => symbol.id !== 'server.Server')
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}`, 'rs')
    expect(index.resolve('Server', 'class', context)).toBeUndefined()
    expect(index.resolve('libtmux_tokio::Server', 'class', context)?.symbol?.id).toBe('libtmux_tokio.server.Server')
  })

  it('refuses an absent explicitly qualified crate export while preserving source-relative links', async () => {
    const model = await fixture((files) => {
      files['crates/libtmux-tokio/docs/public-api.txt'] = 'struct libtmux_tokio::Server\n'
    })
    const resolver = new Resolver([model])
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.id}`, 'rs')
    for (const name of ['QueryIteratorExt', 'QueryIteratorExt::exactly_one', 'Filter']) {
      expect(resolver.resolve('rs', `libtmux_tokio::query::${name}`)).toEqual({ how: 'no-symbol' })
      expect(index.resolve(`libtmux_tokio::query::${name}`)).toBeUndefined()
    }
    expect(resolver.resolve('rs', 'libtmux::query::QueryIteratorExt')).toMatchObject({
      symbol: { id: 'query.QueryIteratorExt', package: 'libtmux' },
    })
    const exported = await fixture()
    const alias = exported.symbols.find((symbol) => symbol.id === 'libtmux_tokio.query.QueryIteratorExt')!
    const exportedIndex = new SymbolIndex(exported.symbols, (symbol) => `/reference/${symbol.id}`, 'rs')
    expect(exportedIndex.resolve('crate::query::QueryIteratorExt', 'class', alias)?.symbol).toMatchObject({
      id: 'query.QueryIteratorExt', package: 'libtmux',
    })
    const legacy = structuredClone(model)
    legacy.symbols = legacy.symbols.filter((symbol) => symbol.package === 'libtmux')
    for (const symbol of legacy.symbols) delete symbol.qualifiedName
    expect(new Resolver([legacy]).resolve('rs', 'libtmux::Server')).toMatchObject({
      symbol: { id: 'server.Server' },
    })
  })

  it('excludes private inline declarations but preserves their public aliased reexports', async () => {
    const model = await fixture((files) => {
      files['crates/libtmux/src/lib.rs'] += [
        'mod sealed {',
        '  pub trait Sealed { fn hidden(&self); }',
        '  pub struct Exposed<T>(T);',
        '}',
        'pub use sealed::Exposed as PublicValue;',
        '',
      ].join('\n')
      files['crates/libtmux/docs/public-api.txt'] += 'struct libtmux::PublicValue<T>\n'
      files['crates/libtmux-tokio/src/lib.rs'] += 'pub use libtmux::PublicValue;\n'
      files['crates/libtmux-tokio/docs/public-api.txt'] += 'struct libtmux_tokio::PublicValue<T>\n'
    })
    expect(model.symbols.some((symbol) => symbol.name === 'Sealed' || symbol.name === 'hidden')).toBe(false)
    const declaration = model.symbols.find((symbol) => symbol.name === 'Exposed' && symbol.package === 'libtmux')!
    expect(declaration).toMatchObject({ qualifiedName: 'libtmux.PublicValue' })
    expect(model.symbols.find((symbol) => symbol.id === 'libtmux_tokio.PublicValue')).toMatchObject({
      package: 'libtmux-tokio', qualifiedName: 'libtmux_tokio.PublicValue', publicOwner: declaration.id,
    })
  })

  it.each(['private import', 'missing compiler export', 'wrong external crate'])('does not invent a reexport for %s', async (fault) => {
    const model = await fixture((files) => {
      if (fault === 'private import') files['crates/libtmux-tokio/src/query.rs'] = 'use libtmux::query::*;\n'
      if (fault === 'wrong external crate') files['crates/libtmux-tokio/src/query.rs'] = 'pub use other::query::*;\n'
      if (fault === 'missing compiler export') files['crates/libtmux-tokio/docs/public-api.txt'] = 'struct libtmux_tokio::Server\n'
    })
    expect(model.symbols.some((symbol) => symbol.id === 'libtmux_tokio.query.QueryIteratorExt')).toBe(false)
  })
})
