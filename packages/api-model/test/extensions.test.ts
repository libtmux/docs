import { describe, expect, it } from 'vitest'
import { mergeExtensions } from '../src/project.ts'
import type { ApiSymbol } from '../src/model.ts'

/**
 * Rust writes a type's methods across several files. `impl Window { … }` in
 * `window/navigation.rs` is the same `Window` the struct in `window.rs`
 * declares — `use super::Window` at the top of the file says so — but a
 * per-file extractor gave it an id of its own, so the reference showed
 * `window::Window` with 39 members and two undocumented pages beside it
 * holding 22 more.
 *
 * It is also what stopped `` [`Window`] `` linking: three symbols answered to
 * the name, and a resolver that declines a tie declined.
 */
const sym = (id: string, kind: string): ApiSymbol =>
  ({
    id,
    name: id.split('.').at(-1) ?? id,
    kind,
    modifiers: [],
    signatures: [],
    source: { file: 'x', line: 1 },
  }) as ApiSymbol

const member = (id: string): ApiSymbol => ({
  ...sym(id, 'method'),
  parent: id.split('.').slice(0, -1).join('.'),
})

describe('an extension block belongs to the type it extends', () => {
  it('folds a block onto the declaration, wherever the block is written', () => {
    const merged = mergeExtensions(
      [
        sym('window.Window', 'struct'),
        member('window.Window.rename'),
        sym('window.navigation.Window', 'class'),
        member('window.navigation.Window.panes'),
      ],
      'class',
    )
    expect(merged.filter((s) => s.kind === 'method').map((s) => s.id)).toEqual([
      'window.Window.rename',
      'window.Window.panes',
    ])
    // The block's own container now shares the declaration's id, which is what
    // `mergePartials` folds; both are still present at this point.
    expect(merged.filter((s) => s.name === 'Window' && !s.parent)).toHaveLength(2)
  })

  it('leaves a block alone when the name is ambiguous', () => {
    // Rust lets two modules declare different types called `Error`. Attaching
    // the block to either would be a guess.
    const symbols = [
      sym('a.Error', 'enum'),
      sym('b.Error', 'struct'),
      sym('c.Error', 'class'),
      member('c.Error.code'),
    ]
    expect(mergeExtensions(symbols, 'class').map((s) => s.id)).toEqual(symbols.map((s) => s.id))
  })

  it('leaves a block on a type the port does not export', () => {
    // `impl str { … }` and blocks on unexported types have nothing to fold
    // onto; libtmux-rs has 38 of them.
    const symbols = [sym('formats.text.str', 'class'), member('formats.text.str.width')]
    expect(mergeExtensions(symbols, 'class').map((s) => s.id)).toEqual(symbols.map((s) => s.id))
  })

  it('is a no-op for a language that declares no extension kind', () => {
    const symbols = [sym('a.Thing', 'class'), sym('b.Thing', 'struct')]
    expect(mergeExtensions(symbols, undefined)).toBe(symbols)
  })
})

/**
 * Rust puts `#[derive(Clone)]` and `#[must_use = "…"]` between a doc comment
 * and the item it documents. The walk up from a declaration stopped at the
 * first sibling that was not a comment, so `pub struct Command` — which
 * documents itself with a runnable example — rendered blank, along with 487
 * other symbols and 188 examples.
 */
describe('a doc comment reaches past the attributes under it', () => {
  it('finds the doc behind Rust attributes, and still requires adjacency', async () => {
    const { extractWithSpec } = await import('../src/languages/spec.ts')
    const { RUST } = await import('../src/languages/specs.ts')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')

    const dir = mkdtempSync(join(tmpdir(), 'attrs-'))
    const file = join(dir, 'command.rs')
    writeFileSync(
      file,
      [
        '/// One tmux command, and what it will do.',
        '#[derive(Clone)]',
        '#[must_use = "a command has no effect until it is dispatched"]',
        'pub struct Command {}',
        '',
        '// A section marker, not documentation.',
        '',
        '#[derive(Debug)]',
        'pub struct Unrelated {}',
        '',
      ].join('\n'),
    )
    const symbols = await extractWithSpec(RUST, file, 'command')
    const doc = (n: string) => symbols.find((s) => s.name === n)?.doc?.summary
    expect(doc('Command')).toBe('One tmux command, and what it will do.')
    expect(doc('Unrelated')).toBeUndefined()
  })

  it('reaches past a lint directive, but not past one above the doc', async () => {
    const { extractWithSpec } = await import('../src/languages/spec.ts')
    const { TYPESCRIPT } = await import('../src/languages/specs.ts')
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')

    const dir = mkdtempSync(join(tmpdir(), 'directives-'))
    const file = join(dir, 'pane.ts')
    writeFileSync(
      file,
      [
        '/** One pane on one tmux server. */',
        '// eslint-disable-next-line typescript/no-unsafe-declaration-merging -- reason.',
        'export class Pane {}',
        '',
        '// Not documentation, and nothing above it.',
        '/** Belongs to Window. */',
        'export class Window {}',
        '',
      ].join('\n'),
    )
    const symbols = await extractWithSpec(TYPESCRIPT, file, 'pane')
    const doc = (n: string) => symbols.find((s) => s.name === n && !s.parent)?.doc?.summary
    expect(doc('Pane')).toBe('One pane on one tmux server.')
    // The plain comment sits above the doc block, so it is not part of it.
    expect(doc('Window')).toBe('Belongs to Window.')
  })
})
