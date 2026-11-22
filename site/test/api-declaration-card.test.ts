import { readFileSync } from 'node:fs'
import type { Element } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { closeWindows, entry, go, symbolOf } from './api-page-fixtures'
import { parseRules } from './css-rules'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)
// The first test of a cold run compiles the real templates and loads the API models.
vi.setConfig({ testTimeout: 60_000 })

/**
 * The declaration card against the design system (Signature; adoption steps 2 and 36).
 */
describe('the declaration card (Signature, adoption steps 2 and 36)', () => {
  it('draws the kind chip once in the card, in a corner tab beside the Source badge, and no `[source]` or pilcrow', async () => {
    const document = await entry(symbolOf(go, 'tmux.Pane.Capture'))
    const head = document.querySelector('dt.gp-sphinx-api-header')!
    const tab = head.querySelector('.api-corner')!
    expect(tab, 'the tab exists').not.toBeNull()
    expect(head.querySelectorAll('.api-leg:not(.api-leg--action)'), 'one kind chip in the whole card').toHaveLength(1)
    expect(tab.querySelectorAll('.api-leg:not(.api-leg--action)'), 'and it is in the tab').toHaveLength(1)
    const source = [...tab.querySelectorAll('a.api-leg--action')].map((link) => [link.textContent?.trim(), link.getAttribute('href')])
    expect(source).toEqual([['source', expect.stringContaining('github.com/libtmux/libtmux-go/blob/')]])
    // The kind chip leads, Source follows: the order the design draws.
    expect([...tab.children].map((child) => child.classList.contains('api-leg--action'))).toEqual([false, true])
    expect(head.querySelector('a.heading-link'), 'the page is the entry, so its URL is the permalink').toBeNull()
    expect(head.querySelector('.viewcode-link, .gp-sphinx-api-source-link, .gp-sphinx-api-slot')).toBeNull()
    expect(head.textContent).not.toContain('[source]')
    // The tab is flush on the card: it is the header's own corner, not a row of the layout that holds the signature.
    expect(head.querySelector('.gp-sphinx-api-layout-left .api-corner')).toBeNull()
  })

  it('stands the tab on the card\'s top edge and reserves nothing for it in the header (record 0082)', () => {
    const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
    const rules = parseRules(css)
    const tab = rules.find((rule) => rule.selectors.includes('dl.gp-sphinx-api-container > dt.gp-sphinx-api-header > .gp-sphinx-api-layout > .api-corner'))!
    expect(tab.declarations.position).toBe('absolute')
    expect(tab.declarations.bottom, 'the chips rest on the card\'s top border, outside the header').toBe('calc(100% + 1px)')
    expect(tab.declarations.right).toBe('0.75rem')
    expect(tab.declarations.gap, 'four pixels between chips').toBe('0.25rem')
    // The card that carries a tab leaves a gap above it that holds the tab, and a larger one on touch for the whole target.
    const gap = rules.filter((rule) => rule.selectors.some((selector) => selector.includes(':has(> dt.gp-sphinx-api-header > .gp-sphinx-api-layout > .api-corner)') && selector.startsWith('dl.')) && rule.declarations['margin-block-start'])
    expect(gap.map((rule) => [rule.media.some((media) => media.includes('pointer: coarse')), rule.declarations['margin-block-start']]))
      .toEqual([[false, 'var(--tab-gap)'], [true, 'var(--tab-gap-touch)']])
    // A link chip's touch target reaches upward only: its top is a touch target above the floor, and its bottom stops at the floor.
    const target = rules.find((rule) => rule.media.some((media) => media.includes('pointer: coarse')) && rule.selectors.includes('.api-corner > a:is(.api-badge, .mcp-tier)::before'))!
    expect(target.declarations.inset).toBe('calc(var(--tab-height) - var(--touch-target) - 1px) calc(-0.125rem - 1px) -1px')
    // Nothing is reserved under the signature, and no band is added below the container breakpoint.
    expect(css).not.toMatch(/gp-sphinx-api-layout-left:not\(:has\(\.api-native-signature--formatted\)\)/)
    expect(rules.filter((rule) => rule.selectors.some((selector) => /gp-sphinx-api-(layout|header)/.test(selector)) && 'padding-block-end' in rule.declarations)).toEqual([])
  })

  it('keeps every modifier in the tab, before Source', async () => {
    const symbol = { ...symbolOf(go, 'tmux.Pane.Capture'), modifiers: ['async', 'static'] } as ApiSymbol
    const tab = (await entry(symbol)).querySelector('.api-corner')!
    const word = (child: Element) => child.querySelector('.api-leg__wl, .api-badge__label')?.textContent?.trim()
    expect([...tab.children].map(word)).toEqual(['method', 'async', 'static', 'source'])
  })

  it('wraps by columns, not by a ten-parameter fold: a long signature is never hidden behind a summary', async () => {
    const python = API_MODELS.py
    const symbol = symbolOf(python, 'libtmux.pane.Pane.capture_pane')
    expect(symbol.signatures.some((signature) => signature.params.length >= 10), 'the fixture is long enough to have folded').toBe(true)
    const index = new SymbolIndex(python.symbols, (entry) => `/en/py/latest/reference/${entry.slug}/`, 'py')
    const document = await entry(symbol, { index, port: 'py' })
    expect(document.querySelector('details.gp-sphinx-api-fold')).toBeNull()
    expect(document.querySelector('[data-has-fold]')).toBeNull()
    expect(document.querySelector('.gp-sphinx-api-signature')?.textContent).toContain('escape_sequences')
  }, 60_000)

  it('names a stub\'s run of repeated flags once and lists the implementation\'s in full', async () => {
    const python = API_MODELS.py
    const symbol = symbolOf(python, 'libtmux.pane.Pane.capture_pane')
    const index = new SymbolIndex(python.symbols, (entry) => `/en/py/latest/reference/${entry.slug}/`, 'py')
    const document = await entry(symbol, { index, port: 'py' })
    const summaries = [...document.querySelectorAll('.api-signature-summary')].map((node) => node.textContent)
    // Two overload stubs and the implementation: the stubs summarise their `= ...` flags, the implementation does not.
    expect(summaries).toHaveLength(2)
    for (const text of summaries) expect(text).toMatch(/^… \d+ more keyword flags, all bool = \.\.\. \(listed under Parameters\)$/)
    const implementation = [...document.querySelectorAll('.gp-sphinx-api-signature .api-signature-parameters')].at(-1)!
    expect(implementation.querySelector('.api-signature-summary')).toBeNull()
    expect(implementation.querySelectorAll('a.api-parameter-name').length).toBeGreaterThanOrEqual(15)
    // The parameters a summary stands for are still listed, each with its own anchor.
    expect(document.querySelectorAll('.gp-sphinx-api-parameters .api-parameters > li').length).toBeGreaterThanOrEqual(15)
  }, 60_000)
})


