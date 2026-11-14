import { afterEach, describe, expect, it, vi } from 'vitest'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { closeWindows, entry, go, symbolOf } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)

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
    expect(head.querySelector('a.headerlink'), 'the page is the entry, so its URL is the permalink').toBeNull()
    expect(head.querySelector('.viewcode-link, .gp-sphinx-api-source-link, .gp-sphinx-api-slot')).toBeNull()
    expect(head.textContent).not.toContain('[source]')
    // The tab is flush on the card: it is the header's own corner, not a row of the layout that holds the signature.
    expect(head.querySelector('.gp-sphinx-api-layout-left .api-corner')).toBeNull()
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
})


