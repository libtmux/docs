import { Window, type Element as HappyElement, type HTMLDetailsElement, type HTMLElement } from 'happy-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDocumentationNavigation } from '../src/components/docs/documentation-navigation'
import { PANEL_QUERIES } from '../src/lib/breakpoints'
import { loadHeaderTemplates, renderPage } from './header-page'

/** The header Menu (records 0071 and 0077): Escape closes it and returns focus, focus enters it on open, and it opens by display. */
let header = ''
beforeAll(async () => {
  const templates = await loadHeaderTemplates()
  const html = await renderPage(templates.baseLayout, '/en/rs/latest/', { pagePath: '', portSlug: 'rs' })
  header = html.match(/<header\b[\s\S]*?<\/header>/)![0]
})

let win: Window
beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/rs/latest/' })
  for (const name of ['window', 'document', 'location', 'HTMLElement', 'HTMLAnchorElement', 'HTMLDetailsElement', 'Element', 'Node', 'AbortController', 'Event']) {
    vi.stubGlobal(name, name === 'window' ? win : name === 'document' ? win.document : name === 'location' ? win.location : win[name as keyof Window])
  }
  vi.spyOn(win.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(600, 10, 40, 28))
  vi.spyOn(win.HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]) as ReturnType<HTMLElement['getClientRects']>
  })
  win.document.body.innerHTML = header
  initDocumentationNavigation()
})
afterEach(async () => {
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const menu = () => win.document.querySelector<HTMLDetailsElement>('details[data-header-menu]')!
const toggle = (element: HTMLDetailsElement, open: boolean) => {
  element.open = open
  element.dispatchEvent(new win.Event('toggle'))
}
const escape = (target: HappyElement) => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

describe('the header Menu', () => {
  it('moves focus into its panel when it opens', () => {
    expect(menu().hasAttribute('data-enhanced')).toBe(true)
    toggle(menu(), true)
    const active = win.document.activeElement!
    expect(menu().querySelector('.site-header__panel')!.contains(active)).toBe(true)
    expect(active.tagName).toBe('A')
  })

  it('closes on Escape and returns focus to its button', () => {
    toggle(menu(), true)
    // happy-dom does not give summary its browser-native focusability.
    const focus = vi.spyOn(menu().querySelector('summary')!, 'focus')
    expect(escape(win.document.activeElement!)).toBe(false)
    expect(menu().open).toBe(false)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('leaves the Menu open when Escape closes a picker inside it', () => {
    toggle(menu(), true)
    const picker = menu().querySelector<HTMLDetailsElement>('[data-doc-picker]')!
    toggle(picker, true)
    escape(picker.querySelector('summary')!)
    expect(picker.open).toBe(false)
    expect(menu().open).toBe(true)
  })

  it('closes when focus leaves it', () => {
    toggle(menu(), true)
    const outside = win.document.createElement('button')
    win.document.body.append(outside)
    outside.dispatchEvent(new win.Event('focusin', { bubbles: true }))
    expect(menu().open).toBe(false)
  })

  describe('by display (record 0071)', () => {
    const display = (query: string | undefined) =>
      vi.spyOn(win, 'matchMedia').mockImplementation((asked: string) => ({ matches: asked === query, media: asked } as unknown as ReturnType<typeof win.matchMedia>))
    const html = () => win.document.documentElement

    it('is a popover where neither sheet query matches', () => {
      display(undefined)
      toggle(menu(), true)
      expect(menu().dataset.panelMode).toBe('popover')
      expect(html().hasAttribute('data-sheet-open')).toBe(false)
    })

    it('is a bottom sheet that locks the page on a phone, and releases it when closed', () => {
      display(PANEL_QUERIES.sheet)
      toggle(menu(), true)
      expect(menu().dataset.panelMode).toBe('sheet')
      expect(html().hasAttribute('data-sheet-open')).toBe(true)
      toggle(menu(), false)
      expect(html().hasAttribute('data-sheet-open')).toBe(false)
    })

    it('is a side sheet, from the trigger\'s edge, on a short landscape screen', () => {
      display(PANEL_QUERIES.side)
      vi.spyOn(win.document.documentElement, 'clientWidth', 'get').mockReturnValue(700)
      toggle(menu(), true)
      expect(menu().dataset.panelMode).toBe('side')
      expect(menu().dataset.panelSide).toBe('end')
    })
  })
})
