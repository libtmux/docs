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

describe('Rust enum payload fields', () => {
  it('retains named payload fields with native types, docs and source lines', async () => {
    const symbols = await extract(`pub enum Event {
    /// A pane produced output.
    Output {
        /// The pane that produced it.
        pane: PaneId,
        /// The output bytes.
        bytes: Vec<u8>,
    },
    /// The session list changed.
    SessionsChanged,
}`)
    const variant = symbols.find((symbol) => symbol.id === 'query.Event.Output')!
    expect(variant).toMatchObject({ kind: 'constant', variant: 'struct', parent: 'query.Event',
      signatures: [{ raw: 'Output {\n    pane: PaneId,\n    bytes: Vec<u8>,\n}', params: [] }],
      doc: { summary: 'A pane produced output.' }, source: { line: 3 } })
    expect(variant.value).toBeUndefined()
    expect(symbols.filter((symbol) => symbol.parent === variant.id)).toMatchObject([
      { id: 'query.Event.Output.pane', name: 'pane', kind: 'attribute', type: 'PaneId', signatures: [],
        doc: { summary: 'The pane that produced it.' }, source: { line: 5 } },
      { id: 'query.Event.Output.bytes', name: 'bytes', kind: 'attribute', type: 'Vec<u8>', signatures: [],
        doc: { summary: 'The output bytes.' }, source: { line: 7 } },
    ])
    expect(symbols.find((symbol) => symbol.name === 'SessionsChanged')).toMatchObject({
      variant: 'unit', signatures: [{ raw: 'SessionsChanged', params: [] }],
    })
  })

  it('distinguishes tuple positions, empty shapes and explicit unevaluated discriminants', async () => {
    const symbols = await extract(`#[repr(u8)] pub enum Payload {
    Tuple(
        /// The first item.
        Vec<(u8, u8)>,
        String,
    ),
    EmptyTuple(),
    EmptyStruct {},
    Unit,
    Number = 1 << 3,
}`)
    const tuple = symbols.find((symbol) => symbol.name === 'Tuple')!
    expect(tuple).toMatchObject({ variant: 'tuple', signatures: [{
      raw: 'Tuple(\n    Vec<(u8, u8)>,\n    String,\n)', params: [],
    }] })
    expect(symbols.filter((symbol) => symbol.parent === tuple.id)).toMatchObject([
      { id: 'query.Payload.Tuple.0', name: '0', type: 'Vec<(u8, u8)>', doc: { summary: 'The first item.' }, source: { line: 4 } },
      { id: 'query.Payload.Tuple.1', name: '1', type: 'String', source: { line: 5 } },
    ])
    expect(symbols.find((symbol) => symbol.name === '1')?.doc).toBeUndefined()
    for (const [name, variant, raw] of [['EmptyTuple', 'tuple', 'EmptyTuple()'], ['EmptyStruct', 'struct', 'EmptyStruct {}'], ['Unit', 'unit', 'Unit']]) {
      const entry = symbols.find((symbol) => symbol.name === name)!
      expect(entry).toMatchObject({ variant, signatures: [{ raw, params: [] }] })
      expect(entry.value).toBeUndefined()
      expect(symbols.filter((symbol) => symbol.parent === entry.id)).toEqual([])
    }
    expect(symbols.find((symbol) => symbol.name === 'Number')).toMatchObject({
      value: '1 << 3', signatures: [{ raw: 'Number = 1 << 3', params: [] }],
    })
  })

  it('links actual fields and payload types without borrowing generic names from other declarations', async () => {
    const symbols = await extract(`pub struct T; pub struct PaneId; pub enum Event<T: Clone> {
      Output { pane: PaneId, value: T }, Tuple(T),
    }`)
    const variant = symbols.find((symbol) => symbol.name === 'Output')!
    const field = symbols.find((symbol) => symbol.id === 'query.Event.Output.value')!
    expect(field).toBeDefined()
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${pageSlug(symbol.id)}/`, 'rs')
    const spans = index.linkType(variant.signatures[0].raw!, variant, variant.signatures[0])
    expect(spans.find((span) => span.text === 'Output')).toMatchObject({ declaration: true })
    expect(spans.find((span) => span.text === 'pane')?.link?.symbol?.id).toBe('query.Event.Output.pane')
    expect(spans.find((span) => span.text === 'PaneId')?.link?.symbol?.id).toBe('query.PaneId')
    expect(spans.find((span) => span.text === 'T')?.link).toBeUndefined()
    expect(index.linkType(field.type!, field).find((span) => span.text === 'T')?.link).toBeUndefined()
    expect(index.resolve('Output.pane', 'any', symbols.find((symbol) => symbol.name === 'Event'))?.symbol?.id).toBe('query.Event.Output.pane')
    expect(index.resolve('query.Event.Tuple.0')?.symbol?.name).toBe('0')
  })

  it('does not expose private owners or interpret macros and attributed payloads', async () => {
    const symbols = await extract(`enum Private { Output { bytes: Vec<u8> } }
      pub enum Public {
        Conditional { #[cfg(feature = "extra")] value: u8 },
        Hidden { #[doc(hidden)] secret: u8 },
      }
      macro_rules! make { () => { pub enum Generated { Tuple(u8) } } }
    `)
    expect(symbols.some((symbol) => symbol.id.startsWith('query.Private'))).toBe(false)
    expect(symbols.some((symbol) => symbol.parent?.startsWith('query.Public.'))).toBe(false)
    expect(symbols.some((symbol) => symbol.parent === 'query.Generated.Tuple')).toBe(false)
  })

  it('links raw field names without linking nested labels or shadowing field declarations', async () => {
    const symbols = await extract(`pub struct PaneId; pub enum Event<T> {
      Output { r#type: PaneId, pane: PaneId, callback: fn(pane: PaneId), T: T },
    }`)
    const variant = symbols.find((symbol) => symbol.name === 'Output')!
    expect(variant.variant).toBe('struct')
    const index = new SymbolIndex(symbols, (symbol) => `/reference/${pageSlug(symbol.id)}/`, 'rs')
    const spans = index.linkType(variant.signatures[0].raw!, variant, variant.signatures[0])
    expect(spans.map((span) => span.text).join('')).toBe(variant.signatures[0].raw)
    expect({
      raw: spans.find((span) => span.text === 'r#type')?.link?.symbol?.id,
      nested: spans.filter((span) => span.text === 'pane').map((span) => span.link?.symbol?.id),
      bound: spans.filter((span) => span.text === 'T').map((span) => span.link?.symbol?.id),
    }).toEqual({
      raw: 'query.Event.Output.r#type',
      nested: ['query.Event.Output.pane', undefined],
      bound: ['query.Event.Output.T', undefined],
    })
    expect(spans.filter((span) => span.text === 'PaneId').every((span) => span.link?.symbol?.id === 'query.PaneId')).toBe(true)
  })
})

describe('Rust trait member visibility', () => {
  it('keeps async and unsafe declaration modifiers without reading function bodies', async () => {
    const symbols = await extract(`
      pub struct Server;
      impl Server {
        pub async fn set_hook(&self, name: &str, command: impl Into<OsString>) -> Result<(), Error> {}
        pub unsafe fn raw(&mut self) {}
        pub async unsafe fn async_raw(&self) {}
        pub fn synchronous(&self) { let pending = async {}; unsafe {} }
      }
      pub trait Poller {
        async fn poll<T: Send>(&self, value: T) -> Result<T, Error>;
        unsafe fn raw(&self);
      }
    `)
    expect(symbols.find((symbol) => symbol.id === 'query.Server.set_hook')).toMatchObject({
      modifiers: ['async'],
      signatures: [{ params: [{ name: '&self' }, { name: 'name', type: '&str' },
        { name: 'command', type: 'impl Into<OsString>' }], returns: 'Result<(), Error>' }],
    })
    expect(symbols.find((symbol) => symbol.id === 'query.Server.raw')?.modifiers).toEqual(['unsafe'])
    expect(symbols.find((symbol) => symbol.id === 'query.Server.async_raw')?.modifiers).toEqual(['async', 'unsafe'])
    expect(symbols.find((symbol) => symbol.id === 'query.Server.synchronous')?.modifiers).toEqual([])
    expect(symbols.find((symbol) => symbol.id === 'query.Poller.poll')).toMatchObject({
      modifiers: ['async'], signatures: [{ typeParams: ['T: Send'], params: [{ name: '&self' }, { name: 'value', type: 'T' }] }],
    })
    expect(symbols.find((symbol) => symbol.id === 'query.Poller.raw')?.modifiers).toEqual(['unsafe'])
  })

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
