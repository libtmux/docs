import { describe, expect, it } from 'vitest'
import { CONCEPTS, conceptsFor, conceptTarget } from '../src/concepts.ts'
import type { ApiSymbol } from '../src/model.ts'

const symbol = (id: string, publicId = id): ApiSymbol => ({ id, publicId, name: id.split('.').at(-1)!,
  kind: 'method', modifiers: [], signatures: [], source: { file: 'source.rs', line: 1 } })

describe('source-bound Rust concept destinations', () => {
  it('resolves the defining crate without erasing source identity or guessing another driver', () => {
    const server = symbol('libtmux_tokio.server.Server', 'libtmux_tokio.Server')
    expect(conceptTarget(CONCEPTS.server, 'rs', [server])).toBe('libtmux_tokio.Server')
    expect(conceptsFor('rs', server.publicId!, server.id)).toContain(CONCEPTS.server)
    const other = symbol('unrelated.server.Server', 'unrelated.Server')
    expect(conceptTarget(CONCEPTS.server, 'rs', [other])).toBeUndefined()
    expect(conceptsFor('rs', other.publicId!, other.id)).not.toContain(CONCEPTS.server)
  })

  it('uses WindowLink actions in the new source and preserves Window actions in old releases', () => {
    for (const [concept, method] of [['select-window', 'select'], ['move-window', 'move_to'], ['swap-window', 'swap_with']]) {
      const current = symbol(`libtmux_tokio.window.WindowLink.${method}`, `libtmux_tokio.WindowLink.${method}`)
      const old = symbol(`window.Window.${method}`)
      expect(conceptTarget(CONCEPTS[concept], 'rs', [current])).toBe(current.publicId)
      expect(conceptTarget(CONCEPTS[concept], 'rs', [old])).toBe(old.publicId)
      expect(conceptsFor('rs', current.publicId!, current.id)).toContain(CONCEPTS[concept])
      expect(conceptsFor('rs', old.publicId!, old.id)).toContain(CONCEPTS[concept])
    }
  })

  it('records blocking creation and capture as explicit native variants', () => {
    for (const [concept, publicId] of [['server', 'libtmux_blocking.Server'],
      ['new-session', 'libtmux_blocking.Server.new_session'], ['capture-pane', 'libtmux_blocking.Server.capture']]) {
      expect(conceptTarget(CONCEPTS[concept], 'rs', [symbol(publicId)])).toBe(publicId)
      expect(conceptsFor('rs', publicId)).toContain(CONCEPTS[concept])
    }
  })
})
