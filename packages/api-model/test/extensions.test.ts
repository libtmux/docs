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
