import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const model = JSON.parse(readFileSync(new URL('../../../site/src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
const hrefFor = (symbol: ApiSymbol) => `/en/rs/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'rs')

describe('native Rust ID declarations', () => {
  it.fails.each([
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

  it.fails('links the actual Event and Subscription ID types to their declarations', () => {
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
