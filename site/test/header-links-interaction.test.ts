import { Window, type HTMLAnchorElement, type HTMLDetailsElement, type HTMLElement, type HTMLInputElement } from 'happy-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDocumentationNavigation } from '../src/components/docs/documentation-navigation'
import { loadHeaderTemplates, renderPage, type HeaderTemplates } from './header-page'

let templates: HeaderTemplates
const headers = new Map<string, string>()
beforeAll(async () => {
  templates = await loadHeaderTemplates()
  for (const slug of ['rs', 'ts', 'lua', 'swift']) {
    const html = await renderPage(templates.baseLayout, `/en/${slug}/latest/`, { pagePath: '', portSlug: slug })
    headers.set(slug, html.match(/<header\b[\s\S]*?<\/header>/)![0])
  }
})

let win: Window
function mount(slug: string) {
  win = new Window({ url: `https://libtmux.org/en/${slug}/latest/` })
  for (const name of ['window', 'document', 'location', 'HTMLElement', 'HTMLAnchorElement', 'HTMLDetailsElement', 'Element', 'Node', 'AbortController', 'Event']) {
    vi.stubGlobal(name, name === 'window' ? win : name === 'document' ? win.document : name === 'location' ? win.location : win[name as keyof Window])
  }
  vi.spyOn(win.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(900, 10, 90, 28))
  vi.spyOn(win.HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]) as ReturnType<HTMLElement['getClientRects']>
  })
  win.document.body.innerHTML = headers.get(slug)!
}
beforeEach(() => mount('rs'))
afterEach(async () => {
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const picker = (placement = 'bar') =>
  win.document.querySelector<HTMLDetailsElement>(`details[data-header-picker="destinations"][data-placement="${placement}"]`)!
const open = (element: HTMLDetailsElement) => {
  element.open = true
  element.dispatchEvent(new win.Event('toggle'))
}
const visibleRows = (element: HTMLDetailsElement) => [...element.querySelectorAll<HTMLElement>('[data-picker-option]')]
  .filter((row) => !row.hidden).map((row) => `${row.closest('[data-picker-group]')!.getAttribute('data-group')}:${row.querySelector('.header-picker__name')!.textContent}`)
const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new win.Event('input'))
}
const search = (element: HTMLDetailsElement) => element.querySelector<HTMLInputElement>('[data-picker-search]')!

describe('header disclosure behavior', () => {
  it('enhances the disclosure and reveals its search without removing the no-script fallback', () => {
    const label = picker().querySelector<HTMLElement>('[data-picker-search-label]')!
    expect(label.hidden).toBe(true)
    expect(picker().hasAttribute('data-enhanced')).toBe(false)
    initDocumentationNavigation()
    expect(label.hidden).toBe(false)
    for (const placement of ['bar', 'menu']) {
      expect(picker(placement).hasAttribute('data-enhanced')).toBe(true)
      // Still a native disclosure of ordinary links.
      expect(picker(placement).tagName).toBe('DETAILS')
      expect(picker(placement).querySelectorAll('a[href^="https://"]').length).toBeGreaterThan(0)
    }
  })

  it('leaves the direct links alone: ordinary anchors in the tab order ahead of the disclosure, whatever it does', () => {
    const before = [...win.document.querySelectorAll<HTMLAnchorElement>('.site-header__destinations > a[data-header-action]')].map((link) => link.outerHTML)
    initDocumentationNavigation()
    open(picker())
    expect([...win.document.querySelectorAll<HTMLAnchorElement>('.site-header__destinations > a[data-header-action]')].map((link) => link.outerHTML)).toEqual(before)
    const order = [...win.document.querySelectorAll('.site-header__destinations > a, .site-header__destinations > details > summary')]
      .map((element) => element.tagName === 'A' ? (element as HTMLAnchorElement).dataset.headerAction : 'disclosure')
    expect(order).toEqual(['source', 'package', 'api', 'disclosure'])
    for (const link of win.document.querySelectorAll('.site-header__destinations > a')) {
      expect(link.closest('[data-doc-picker]'), 'no script manages a direct link').toBeNull()
      expect(link.hasAttribute('tabindex')).toBe(false)
    }
    // Closing the disclosure does not take a direct link with it.
    picker().open = false
    picker().dispatchEvent(new win.Event('toggle'))
    expect(win.document.querySelectorAll('.site-header__destinations > a[data-header-action]')).toHaveLength(3)
  })

  it('toggles independently of the Menu panel and keeps one disclosure open at a time', () => {
    initDocumentationNavigation()
    const menu = win.document.querySelector<HTMLDetailsElement>('details.site-header__menu')!
    menu.open = true
    open(picker('menu'))
    expect(picker('menu').open).toBe(true)
    expect(menu.open, 'opening the disclosure inside the Menu leaves the Menu open').toBe(true)
    open(picker('bar'))
    expect(picker('bar').open).toBe(true)
    expect(picker('menu').open, 'one picker open at a time').toBe(false)
    expect(menu.open).toBe(true)
    picker('bar').open = false
    picker('bar').dispatchEvent(new win.Event('toggle'))
    expect(menu.open, 'closing the disclosure leaves the Menu open').toBe(true)
  })

  it('closes on Escape from a row or the search box and returns focus to the trigger', () => {
    initDocumentationNavigation()
    for (const from of ['row', 'search'] as const) {
      const disclosure = picker()
      open(disclosure)
      const summary = disclosure.querySelector('summary')!
      const focus = vi.spyOn(summary, 'focus')
      const target = from === 'row' ? disclosure.querySelector<HTMLElement>('a[data-picker-option]')! : search(disclosure)
      target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(disclosure.open, from).toBe(false)
      expect(focus, from).toHaveBeenCalledWith({ preventScroll: true })
    }
    // Control: another key leaves it open.
    open(picker())
    search(picker()).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(picker().open).toBe(true)
  })

  it('closes on a click outside and on focus moving outside, and not on a click inside', () => {
    initDocumentationNavigation()
    open(picker())
    win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    expect(picker().open).toBe(false)
    open(picker())
    win.document.body.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }))
    expect(picker().open).toBe(false)
    // The control: a click inside its own panel leaves it open.
    open(picker())
    picker().querySelector('.doc-picker-title')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    expect(picker().open).toBe(true)
  })

  it('moves focus to the search box on opening, so a reader can type at once', () => {
    initDocumentationNavigation()
    open(picker())
    expect(win.document.activeElement).toBe(search(picker()))
  })

  it('filters rows by label, coordinate, import alias and repository, and hides a group with no match', () => {
    initDocumentationNavigation()
    const disclosure = picker()
    open(disclosure)
    const input = search(disclosure)
    expect(visibleRows(disclosure)).toHaveLength(13)
    type(input, 'macros')
    expect(visibleRows(disclosure)).toEqual(['source:libtmux-macros', 'package:libtmux-macros', 'api:libtmux-macros'])
    // The import spelling, which differs from the crate name.
    type(input, 'libtmux_macros')
    expect(visibleRows(disclosure)).toEqual(['source:libtmux-macros', 'package:libtmux-macros', 'api:libtmux-macros'])
    expect(disclosure.querySelector('[data-picker-status]')!.textContent).toBe('3 matching entries')
    // Every word must match; a host and a name narrow to one group.
    type(input, 'crates.io mcp')
    expect(visibleRows(disclosure)).toEqual(['package:tmux-mcp'])
    const groups = [...disclosure.querySelectorAll<HTMLElement>('[data-picker-group]')]
    expect(groups.map((group) => group.hidden)).toEqual([true, false, true])
    // A reader types the kind of destination.
    type(input, 'api reference')
    expect(visibleRows(disclosure).every((row) => row.startsWith('api:'))).toBe(true)
    // A repository path finds the directory.
    type(input, 'crates/tmux-workspace')
    expect(visibleRows(disclosure)).toEqual(['source:tmux-workspace'])
  })

  it('shows an empty state, restores the list when cleared and resets on close', () => {
    initDocumentationNavigation()
    const disclosure = picker()
    open(disclosure)
    const input = search(disclosure)
    const empty = disclosure.querySelector<HTMLElement>('[data-picker-empty]')!
    expect(empty.hidden).toBe(true)
    type(input, 'no such destination')
    expect(visibleRows(disclosure)).toEqual([])
    expect(empty.hidden).toBe(false)
    expect(empty.textContent).toBe('No matching destinations.')
    expect(disclosure.querySelector('[data-picker-status]')!.textContent).toBe('0 matching entries')
    type(input, '')
    expect(empty.hidden).toBe(true)
    expect(visibleRows(disclosure)).toHaveLength(13)
    type(input, 'docs.rs')
    expect(visibleRows(disclosure)).toHaveLength(4)
    disclosure.open = false
    disclosure.dispatchEvent(new win.Event('toggle'))
    expect(input.value).toBe('')
    expect(visibleRows(disclosure)).toHaveLength(13)
  })

  it('moves between rows with the arrow keys and follows the first match with Enter', () => {
    initDocumentationNavigation()
    const disclosure = picker()
    open(disclosure)
    const input = search(disclosure)
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const rows = [...disclosure.querySelectorAll<HTMLElement>('a[data-picker-option]')]
    expect(win.document.activeElement).toBe(rows[0])
    rows[0]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(win.document.activeElement).toBe(rows[1])
    rows[1]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(win.document.activeElement).toBe(rows.at(-1))
    rows.at(-1)!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(win.document.activeElement).toBe(rows[0])
    type(input, 'macros')
    let clicked = ''
    for (const row of rows) row.addEventListener('click', (event) => { event.preventDefault(); clicked = row.getAttribute('href')! })
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(clicked).toBe('https://github.com/libtmux/libtmux-rs/tree/master/crates/libtmux-macros')
  })

  it('finds a TypeScript package by its executable and an import path', () => {
    mount('ts')
    initDocumentationNavigation()
    const disclosure = picker()
    open(disclosure)
    const input = search(disclosure)
    type(input, 'tmux-workspace')
    expect(visibleRows(disclosure)).toEqual(['source:@libtmux/workspace-cli', 'package:@libtmux/workspace-cli'])
    type(input, '@libtmux/workspace/config')
    expect(visibleRows(disclosure)).toEqual(['source:@libtmux/workspace', 'package:@libtmux/workspace'])
    type(input, 'libtmux/testing')
    expect(visibleRows(disclosure)).toEqual(['source:libtmux', 'package:libtmux'])
  })

  it('finds a Swift product by its import, though it shares its package’s page', () => {
    mount('swift')
    initDocumentationNavigation()
    const disclosure = picker()
    open(disclosure)
    type(search(disclosure), 'import TmuxFixture')
    expect(visibleRows(disclosure)).toEqual(['source:TmuxFixture', 'package:libtmux-swift'])
  })

  it('has no disclosure where the direct links already reach everything', () => {
    mount('lua')
    initDocumentationNavigation()
    expect(win.document.querySelector('[data-header-picker]')).toBeNull()
    expect(win.document.querySelectorAll('.site-header__destinations > a[data-header-action]')).toHaveLength(2)
  })
})
