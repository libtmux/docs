import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ApiModel } from '../src/model.ts'
import { attachNativeRustSnapshots } from '../src/languages/rust-snapshots.ts'

const families = ['Session', 'Window', 'Pane', 'Client']
const source = { repo: 'libtmux/libtmux-rs', revision: 'a'.repeat(40) }
const path = 'crates/libtmux-core/src/snapshot.rs'
function fixture() {
  const files: Record<string, string> = {}
  for (const name of ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux']) files[`crates/${name}/Cargo.toml`] = `[package]\nname = "${name}"\n`
  files[path] = `macro_rules! define_snapshot_info {
    ($($args:tt)*) => {
      pub struct $info { field: u32 }
      impl $info {
        pub const fn $baseline_field(&self) -> &snapshot_type!($baseline_decoder) { loop {} }
        pub const fn $field(&self) -> borrowed_type!($decoder, $floor, $empty) { loop {} }
        pub fn get<F: ReadField<Self>>(&self, field: F) -> Availability<F::Value<'_>> { loop {} }
      }
      pub struct $fields<Target> { field: Target }
    };
  }
  macro_rules! define_snapshots { () => {
    ${families.map((name) => `define_snapshot_info!(${name}Snapshot, ${name}Fields, ${name}, ignored);`).join('\n')}
  }; }
  format_catalog!(define_snapshots);
  `
  files['crates/libtmux-core/src/formats/catalog.rs'] = `macro_rules! format_catalog { ($consumer:ident) => { $consumer! {
    ${families.map((name) => `${name}Info {
      target: "${name.toLowerCase()}";
      baseline: (${name.toUpperCase()}_ID, ${name.toLowerCase()}_id, "${name.toLowerCase()}_id", ${name}, ${name}, All, V3_2A, ${name}Id, Required);
      supplements: [(${name.toUpperCase()}_NAME, ${name.toLowerCase()}_name, "${name.toLowerCase()}_name", ${name}, ${name}, All, V3_2A, Text, Available)];
    }`).join('\n')}
  } }; }
  `
  files['crates/libtmux-core/src/lib.rs'] = `mod snapshot;\npub use snapshot::{${families.flatMap((name) => [`${name}Snapshot`, `${name}Fields`]).join(', ')}};\n`
  files['crates/libtmux-core/docs/public-api.txt'] = families.flatMap((name) => [
    `struct libtmux_core::${name}Snapshot`,
    `function libtmux_core::${name}Snapshot::${name.toLowerCase()}_id: const fn(&self) -> &libtmux_core::${name}Id`,
    `function libtmux_core::${name}Snapshot::${name.toLowerCase()}_name: const fn(&self) -> &libtmux_core::TmuxText`,
    `function libtmux_core::${name}Snapshot::get: fn<F: ReadField<Self>>(&self, field: F) -> Availability<F::Value<'_>>`,
    `struct libtmux_core::${name}Fields<Target>`,
    `struct_field libtmux_core::${name}Fields::${name.toLowerCase()}_id: TextField<Target>`,
    `struct_field libtmux_core::${name}Fields::${name.toLowerCase()}_name: TextField<Target>`,
    `function libtmux_core::${name}Fields::for_target: fn(target: &'static str) -> Self`,
  ]).join('\n') + '\n'
  return { files, read: (file: string) => files[file] }
}

const model = (): ApiModel => ({ port: 'rs', revision: source.revision, extractor: 'test', symbols: [] })

describe('bounded native snapshot projection', () => {
  it('recovers all four canonical owners, getters and generic filter field sets with source hashes', async () => {
    const f = fixture()
    const target = model()
    const added = await attachNativeRustSnapshots(target, f.read, source)
    expect(added.filter((symbol) => symbol.kind === 'struct')).toHaveLength(8)
    for (const family of families) {
      const owner = added.find((symbol) => symbol.publicId === `libtmux_core.${family}Snapshot`)!
      expect(owner.kind).toBe('struct')
      expect(added.filter((symbol) => symbol.parent === owner.id).map((symbol) => symbol.name).sort())
        .toEqual(['get', `${family.toLowerCase()}_id`, `${family.toLowerCase()}_name`].sort())
      expect(added.find((symbol) => symbol.publicId === `libtmux_core.${family}Fields.for_target`)).toBeDefined()
      expect(added.every((symbol) => symbol.source.revision === source.revision)).toBe(true)
    }
    expect(target.nativeProvenance?.files).toContainEqual({ path,
      sha256: createHash('sha256').update(f.files[path]).digest('hex') })
    expect(target.nativeProvenance?.exporter.rustSnapshots).toMatchObject({ source, scope: 'snapshot-owners-getters-filter-handles' })
  })

  it.each([
    ['missing native getter', (f: ReturnType<typeof fixture>) => { f.files['crates/libtmux-core/docs/public-api.txt'] = f.files['crates/libtmux-core/docs/public-api.txt'].replace(/^function libtmux_core::PaneSnapshot::pane_name.*\n/m, '') }],
    ['extra native getter', (f: ReturnType<typeof fixture>) => { f.files['crates/libtmux-core/docs/public-api.txt'] += 'function libtmux_core::PaneSnapshot::invented: const fn(&self) -> u32\n' }],
    ['missing catalogue field', (f: ReturnType<typeof fixture>) => { f.files['crates/libtmux-core/src/formats/catalog.rs'] = f.files['crates/libtmux-core/src/formats/catalog.rs'].replace(/\(PANE_NAME[^)]*\)/, '') }],
    ['changed producer', (f: ReturnType<typeof fixture>) => { f.files[path] = f.files[path].replace('pub const fn $field', 'pub fn $field') }],
    ['changed macro family', (f: ReturnType<typeof fixture>) => { f.files[path] = f.files[path].replaceAll('define_snapshot_info', 'other_snapshot_info') }],
    ['missing root export', (f: ReturnType<typeof fixture>) => { f.files['crates/libtmux-core/src/lib.rs'] = f.files['crates/libtmux-core/src/lib.rs'].replace('PaneSnapshot, ', '') }],
  ] as const)('refuses %s without leaving a partial projection', async (_name, mutate) => {
    const f = fixture()
    mutate(f)
    const target = model()
    await expect(attachNativeRustSnapshots(target, f.read, source)).rejects.toThrow('Unsupported Rust snapshot projection')
    expect(target.symbols).toEqual([])
    expect(target.nativeProvenance).toBeUndefined()
  })
})
