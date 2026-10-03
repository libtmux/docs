import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readInventory, writeInventory } from '../src/inventory.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { RUST } from '../src/languages/specs.ts'
import { SymbolIndex } from '../src/link.ts'
import { parentInventory } from '../src/parent-inventory.ts'
import { extractProject } from '../src/project.ts'
import { pageSlug } from '../src/prose.ts'
import { Resolver } from '../src/resolver.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sourceRoot(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rust-api-'))
  dirs.push(dir)
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
  return dir
}

async function extract(source: string, privateMembers = false) {
  const root = sourceRoot({ 'query.rs': source })
  return extractWithSpec(RUST, join(root, 'query.rs'), 'query', { privateMembers })
}

describe('Rust trait member visibility', () => {
  it('keeps required and default methods with their docs, signatures and owner', async () => {
    const symbols = await extract(`
      pub trait QueryIteratorExt: Iterator {
        /// Return at most one item.
        fn one_or_none(self) -> Result<Option<Self::Item>, MultipleItemsError>;
        /// Keep matching items.
        fn matching<P>(self, predicate: P) -> Vec<Self::Item> {
          fn hidden_helper() {}
          Vec::new()
        }
      }
    `)
    expect(symbols.map(({ id, kind, parent }) => ({ id, kind, parent }))).toEqual([
      { id: 'query.QueryIteratorExt', kind: 'trait', parent: undefined },
      {
        id: 'query.QueryIteratorExt.one_or_none', kind: 'method',
        parent: 'query.QueryIteratorExt',
      },
      {
        id: 'query.QueryIteratorExt.matching', kind: 'method',
        parent: 'query.QueryIteratorExt',
      },
    ])
    expect(symbols[1]).toMatchObject({
      doc: { summary: 'Return at most one item.' },
      signatures: [{ returns: 'Result<Option<Self::Item>, MultipleItemsError>' }],
      source: { line: 4 },
    })
    expect(symbols[2]).toMatchObject({
      doc: { summary: 'Keep matching items.' },
      signatures: [{
        params: [{ name: 'self' }, { name: 'predicate', type: 'P' }],
        typeParams: ['P'], returns: 'Vec<Self::Item>',
      }],
      source: { line: 6 },
    })
  })

  it('does not grant trait visibility to private owners or inherent/free functions', async () => {
    const source = `
      trait Internal { fn hidden(); fn default_hidden() {} }
      pub(crate) trait CrateInternal { fn hidden(); }
      pub(super) trait ParentInternal { fn hidden() {} }
      pub struct Server;
      impl Server {
        pub fn visible() {}
        fn hidden() {}
        pub(crate) fn crate_hidden() {}
      }
      fn private_free() {}
      pub fn public_free() {}
    `
    const symbols = await extract(source)
    expect(symbols.map((symbol) => symbol.id)).toEqual([
      'query.Server', 'query.Server.visible', 'query.public_free',
    ])
    const all = await extract(source, true)
    for (const id of [
      'query.Internal.hidden', 'query.Internal.default_hidden',
      'query.CrateInternal.hidden', 'query.ParentInternal.hidden',
      'query.Server.hidden', 'query.Server.crate_hidden', 'query.private_free',
    ]) expect(all.some((symbol) => symbol.id === id)).toBe(true)
  })

  it('omits explicitly hidden trait hooks without hiding adjacent documented methods', async () => {
    const source = `
      pub trait Contract {
        #[doc(hidden)]
        #[must_use]
        // Required implementation hook.
        fn hidden_required();
        #[doc ( hidden )]
        fn hidden_default() {}
        #[doc(hidden, alias = "hook")]
        fn hidden_combined();
        #[doc(alias = "hook", /* metadata */ hidden)]
        fn hidden_last() {}
        /// This prose mentions #[doc(hidden)] as text.
        #[must_use]
        fn visible_required();
        #[doc(alias = "hidden")]
        fn visible_default() {}
      }
      #[doc(hidden)]
      pub trait HiddenOwner { fn required(); fn provided() {} }
      #[doc(alias = "hidden owner", hidden)]
      pub trait HiddenCombinedOwner { fn required(); }
    `
    expect((await extract(source)).map((symbol) => symbol.id)).toEqual([
      'query.Contract', 'query.Contract.visible_required', 'query.Contract.visible_default',
    ])
    expect((await extract(source, true)).filter((symbol) => symbol.parent === 'query.Contract')
      .map((symbol) => symbol.name)).toEqual([
      'hidden_required', 'hidden_default', 'hidden_combined', 'hidden_last',
      'visible_required', 'visible_default',
    ])
  })

  it('preserves native receivers on required, default and inherent methods', async () => {
    const symbols = await extract(`
      pub trait QueryIteratorExt: Iterator + Sized {
        fn exactly_one(mut self) -> Result<Self::Item, ExactlyOneError> { todo!() }
        fn one_or_none(mut self) -> Result<Option<Self::Item>, MultipleItemsError>;
        fn borrowed(&self);
        fn mutable(&mut self) {}
        fn lifetime<'a>(&'a mut self);
        fn typed(self: Box<Self>);
      }
      pub struct Server;
      impl Server { pub fn consume(mut self) {} pub fn borrow(&mut self) {} }
    `)
    const params = (name: string) => symbols.find((symbol) => symbol.name === name)?.signatures[0].params
    expect(params('exactly_one')).toEqual([{ name: 'mut self' }])
    expect(params('one_or_none')).toEqual([{ name: 'mut self' }])
    expect(params('borrowed')).toEqual([{ name: '&self' }])
    expect(params('mutable')).toEqual([{ name: '&mut self' }])
    expect(params('lifetime')).toEqual([{ name: "&'a mut self" }])
    expect(params('typed')).toEqual([{ name: 'self', type: 'Box<Self>', default: undefined }])
    expect(params('consume')).toEqual([{ name: 'mut self' }])
    expect(params('borrow')).toEqual([{ name: '&mut self' }])
    expect(symbols.find((symbol) => symbol.name === 'exactly_one')?.signatures[0].returns)
      .toBe('Result<Self::Item, ExactlyOneError>')
    expect(symbols.find((symbol) => symbol.name === 'one_or_none')?.signatures[0].returns)
      .toBe('Result<Option<Self::Item>, MultipleItemsError>')
  })

  it('keeps fully qualified trait method identities and public links distinct', async () => {
    const root = sourceRoot({
      'query.rs': 'pub trait QueryIteratorExt { fn matching(&self); fn exactly_one(self) {} }',
      'other.rs': 'pub trait QueryIteratorExt { fn matching(&self); }',
      'server.rs': 'pub struct Server; impl Server { pub fn builder() {} }',
      'options.rs': 'pub enum OptionScope { Server, Window }',
    })
    const model = await extractProject({ port: 'rs', root, revision: 'fixture-revision' })
    expect(model.revision).toBe('fixture-revision')
    const hrefFor = (symbol: typeof model.symbols[number]) =>
      `/reference/${pageSlug(symbol.publicId ?? symbol.id)}/#${symbol.publicId}`
    const resolver = new Resolver([model])
    const index = new SymbolIndex(model.symbols, hrefFor, 'rs')
    const parents = parentInventory(model, hrefFor)
    const inventory = readInventory(writeInventory(model, {
      project: 'rs', version: 'test', uriFor: hrefFor,
    }))
    for (const id of [
      'query.QueryIteratorExt.matching', 'query.QueryIteratorExt.exactly_one',
      'other.QueryIteratorExt.matching',
    ]) {
      const symbol = model.symbols.find((candidate) => candidate.id === id)
      expect(symbol).toMatchObject({
        id, publicId: id, parent: id.slice(0, id.lastIndexOf('.')), kind: 'method',
      })
      expect(resolver.resolve('rs', id.replaceAll('.', '::'))?.symbol.id).toBe(id)
      expect(index.resolve(id)?.symbol?.id).toBe(id)
      expect(index.linkText('[`crate::' + id.replaceAll('.', '::') + '`]')[0].link?.href)
        .toBe(hrefFor(symbol!))
      expect(parents.find((entry) => entry.name === id)?.uri).toBe(hrefFor(symbol!).slice(1))
      expect(inventory.entries.find((entry) => entry.name === id)?.uri).toBe(hrefFor(symbol!))
    }
    expect(resolver.resolve('rs', 'Server')?.symbol.id).toBe('server.Server')
    expect(index.resolve('Server', 'class')?.symbol?.id).toBe('server.Server')
    expect(parents.find((entry) => entry.name === 'Server')?.uri)
      .toBe('reference/server-server/#server.Server')
    expect(model.symbols.find((symbol) => symbol.id === 'server.Server.builder'))
      .toMatchObject({ parent: 'server.Server', kind: 'method' })
    expect(model.symbols.find((symbol) => symbol.id === 'options.OptionScope.Server'))
      .toMatchObject({ parent: 'options.OptionScope', kind: 'constant' })
  })
})
