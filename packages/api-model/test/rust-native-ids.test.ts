import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attachNativeRustIdStructs } from '../src/languages/rust-id-structs.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const model = JSON.parse(readFileSync(new URL('../../../site/src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
const hrefFor = (symbol: ApiSymbol) => `/en/rs/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'rs')

describe('native Rust ID declarations', () => {
  it.each([
    ['SessionId', 'session', 125], ['WindowId', 'window', 143], ['PaneId', 'pane', 162],
  ] as const)('retains the authored %s declaration and invocation documentation', (name, noun, line) => {
    const owner = model.symbols.find((symbol) => symbol.id === `target.${name}`)
    expect(owner, `missing native declaration: ${name}`).toBeDefined()
    expect(owner).toMatchObject({ name, kind: 'struct', publicId: `target.${name}`,
      product: 'core', modifiers: [], signatures: [],
      source: { file: 'crates/libtmux/src/target.rs', line, repo: 'libtmux/libtmux-rs', revision: model.revision },
    })
    expect(owner!.doc?.summary).toContain(`A native tmux ${noun} ID`)
    expect(owner!.doc?.body).toContain('Leading zeroes are accepted but canonicalized to the numeric tmux ID.')
    expect(owner!.doc?.examples?.[0].code).toContain(`use libtmux::${name};`)
    expect(model.symbols.filter((symbol) => symbol.parent === owner!.id)).toEqual([])
    expect(index.resolve(name)?.href).toBe(hrefFor(owner!))
  })

  it('links the actual Event and Subscription ID types to their declarations', () => {
    for (const [id, name] of [
      ['control.Event.Output', 'PaneId'], ['control.Event.Output.pane', 'PaneId'],
      ['control.Event.pane', 'PaneId'], ['control.Event.window', 'WindowId'],
      ['control.Subscription.Pane', 'PaneId'], ['control.Subscription.Pane.0', 'PaneId'],
      ['control.Subscription.Window', 'WindowId'], ['control.Subscription.Window.0', 'WindowId'],
    ]) {
      const context = model.symbols.find((symbol) => symbol.id === id)!
      expect(context, `missing existing payload or method: ${id}`).toBeDefined()
      const signature = context.signatures[0]
      const text = context.type ?? signature?.raw ?? signature?.returns
      expect(text).toContain(name)
      const spans = index.linkType(text!, context, signature)
      expect(spans.map((span) => span.text).join('')).toBe(text)
      expect(spans.find((span) => span.text === name)?.link?.symbol?.id, id).toBe(`target.${name}`)
    }
  })
})

const target = 'crates/libtmux/src/target.rs'
const entry = 'crates/libtmux/src/lib.rs'
const inventory = 'crates/libtmux/docs/public-api.txt'
const source = { repo: 'libtmux/libtmux-rs', revision: 'a'.repeat(40) }

function fixture() {
  const files: Record<string, string> = {
    [target]: `/// Macro documentation is not owner documentation.
macro_rules! define_id {
    ($(#[$attribute:meta])* $name:ident, $sigil:literal) => {
        $(#[$attribute])*
        ///
        /// A body sentence preserves the literal $name.
        #[derive(Clone, Eq, PartialEq)]
        pub struct $name { number: u32, rendered: Box<str> }
        impl $name {
            /// Do not publish the private helper.
            pub(crate) fn number(&self) -> u32 { self.number }
            pub fn later_method(&self) -> &str { "$name is literal" }
        }
    };
}
define_id!(
    /// A differently named native ID.
    ///
    /// It preserves $name in authored prose.
    //// This is not Rust documentation.
    ExampleId, '%'
);
define_id!(
    /// The second ID.
    OtherId, '@'
);
`,
    [entry]: 'mod target;\npub use target::{ExampleId, OtherId};\n',
    [inventory]: 'struct libtmux::ExampleId\nstruct libtmux::OtherId\n',
  }
  const model: ApiModel = { port: 'rs', extractor: 'test', symbols: [{
    id: 'target.Existing', name: 'Existing', kind: 'struct', modifiers: [], signatures: [],
    source: { file: target, line: 1 }, doc: { summary: 'Keep me.' },
  }] }
  return { files, model, source: { ...source }, read: (path: string) => files[path] }
}
type Fixture = ReturnType<typeof fixture>

describe('bounded Rust ID macro projection', () => {
  it('derives arbitrary names from native calls, retaining owner docs and excluding generated methods', async () => {
    const f = fixture()
    const before = structuredClone(f.model.symbols)
    const added = await attachNativeRustIdStructs(f.model, f.read, f.source)
    expect(f.model.symbols.slice(0, 1)).toEqual(before)
    expect(added.map((symbol) => symbol.id)).toEqual(['target.ExampleId', 'target.OtherId'])
    expect(added[0].doc).toEqual({
      summary: 'A differently named native ID.',
      body: 'It preserves $name in authored prose.\n\nA body sentence preserves the literal $name.',
    })
    expect(added.map((symbol) => [symbol.kind, symbol.modifiers, symbol.signatures, symbol.source.line]))
      .toEqual([['struct', [], [], 21], ['struct', [], [], 25]])
    expect(added.every((symbol) => symbol.source.repo === source.repo && symbol.source.revision === source.revision &&
      symbol.source.extractedRevision === source.revision)).toBe(true)
    expect(f.model.symbols).toHaveLength(3)
    expect(f.model.nativeProvenance?.files).toEqual([target, entry, inventory].map((path) => ({
      path, sha256: createHash('sha256').update(f.files[path]).digest('hex'),
    })))
    expect(f.model.nativeProvenance?.exporter.rustIdStructs).toMatchObject({
      source, macro: 'define_id', definitionLine: 2, scope: 'struct-owners',
      declarations: [
        { id: 'target.ExampleId', native: 'libtmux::ExampleId', invocationLine: 16, nameLine: 21 },
        { id: 'target.OtherId', native: 'libtmux::OtherId', invocationLine: 23, nameLine: 25 },
      ],
    })
  })

  it('preserves unrelated native provenance', async () => {
    const f = fixture()
    f.model.nativeProvenance = { files: [{ path: 'existing.rs', sha256: 'b'.repeat(64) }], exporter: { existing: 'producer' } }
    await attachNativeRustIdStructs(f.model, f.read, f.source)
    expect(f.model.nativeProvenance.files[0]).toEqual({ path: 'existing.rs', sha256: 'b'.repeat(64) })
    expect(f.model.nativeProvenance.exporter.existing).toBe('producer')
  })

  const invalid: [string, (f: Fixture) => void][] = [
    ['lookalike macro', (f) => { f.files[target] = f.files[target].replaceAll('define_id', 'define_identifier') }],
    ['scoped external macro call', (f) => { f.files[target] = f.files[target].replaceAll('define_id!(', 'other::define_id!(') }],
    ['private struct', (f) => { f.files[target] = f.files[target].replace('pub struct $name', 'struct $name') }],
    ['restricted struct', (f) => { f.files[target] = f.files[target].replace('pub struct $name', 'pub(crate) struct $name') }],
    ['conditional owner', (f) => { f.files[target] = f.files[target].replace('pub struct $name', '#[cfg(feature = "extra")] pub struct $name') }],
    ['hidden owner', (f) => { f.files[target] = f.files[target].replace('pub struct $name', '#[doc(hidden)] pub struct $name') }],
    ['conditional definition', (f) => { f.files[target] = f.files[target].replace('macro_rules!', '#[cfg(feature = "extra")] macro_rules!') }],
    ['conditional invocation', (f) => { f.files[target] = f.files[target].replace('define_id!(', '#[cfg(feature = "extra")] define_id!(') }],
    ['conditional forwarded attribute', (f) => { f.files[target] = f.files[target].replace('ExampleId,', '#[cfg(feature = "extra")] ExampleId,') }],
    ['conditional module', (f) => { f.files[entry] = '#[cfg(feature = "extra")]\n' + f.files[entry] }],
    ['conditional reexport', (f) => { f.files[entry] = f.files[entry].replace('pub use', '#[cfg(feature = "extra")] pub use') }],
    ['private reexport', (f) => { f.files[entry] = f.files[entry].replace('pub use', 'use') }],
    ['wrong module reexport', (f) => { f.files[entry] = f.files[entry].replace('use target', 'use other') }],
    ['aliased reexport', (f) => { f.files[entry] = f.files[entry].replace('ExampleId,', 'ExampleId as Alias,') }],
    ['shadowed macro definition', (f) => { f.files[target] += 'macro_rules! define_id { () => {} }\n' }],
    ['nested call', (f) => { f.files[target] = f.files[target].replaceAll('define_id!(\n', 'fn nested() { define_id!(\n').replaceAll(');\n', '); }\n') }],
    ['different matcher', (f) => { f.files[target] = f.files[target].replace('$name:ident', '$name:path') }],
    ['unsupported repetition', (f) => { f.files[target] = f.files[target].replace('pub struct $name', '$(pub struct $name)*') }],
    ['extra public field', (f) => { f.files[target] = f.files[target].replace('number: u32', 'pub number: u32') }],
    ['extra item', (f) => { f.files[target] = f.files[target].replace('impl $name', 'pub struct Extra; impl $name') }],
    ['wrong native kind', (f) => { f.files[inventory] = f.files[inventory].replace('struct libtmux::OtherId', 'enum libtmux::OtherId') }],
    ['duplicate native entry', (f) => { f.files[inventory] += 'struct libtmux::OtherId\n' }],
    ['missing native entry', (f) => { f.files[inventory] = f.files[inventory].replace('struct libtmux::OtherId\n', '') }],
    ['conflicting existing declaration', (f) => { f.model.symbols[0].id = 'target.OtherId' }],
    ['hidden source module', (f) => { f.files[target] = '#![doc(hidden)]\n' + f.files[target] }],
    ['conditional source module', (f) => { f.files[target] = '#![cfg(feature="extra")]\n' + f.files[target] }],
    ['explicit doc attribute', (f) => { f.files[target] = f.files[target].replace('ExampleId,', '#[doc="not silently lost"] ExampleId,') }],
    ['block doc attribute', (f) => { f.files[target] = f.files[target].replace('/// The second ID.', '/** The second ID. */') }],
    ['missing pinned input', (f) => { delete f.files[entry] }],
    ['foreign revision', (f) => { f.source.revision = 'main' }],
    ['foreign repository', (f) => { f.source.repo = 'other/repo' }],
    ['conflicting source hash', (f) => { f.model.nativeProvenance = { files: [{ path: target, sha256: 'b'.repeat(64) }], exporter: {} } }],
  ]
  it.each(invalid)('rejects %s without publishing partial owners', async (_name, change) => {
    const f = fixture()
    change(f)
    const before = structuredClone(f.model)
    await expect(attachNativeRustIdStructs(f.model, f.read, f.source)).rejects.toThrow('Unsupported Rust define_id contract')
    expect(f.model).toEqual(before)
  })
})
