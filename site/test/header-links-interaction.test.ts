import { Window, type HTMLDetailsElement, type HTMLElement, type HTMLInputElement } from 'happy-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDocumentationNavigation } from '../src/components/docs/documentation-navigation'
import { loadHeaderTemplates, renderPage, type HeaderTemplates } from './header-page'

let templates: HeaderTemplates
const headers = new Map<string, string>()
beforeAll(async () => {
  templates = await loadHeaderTemplates()
  for (const slug of ['rs', 'ts', 'lua']) {
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

const picker = (kind: string, placement = 'bar') =>
  win.document.querySelector<HTMLDetailsElement>(`details[data-header-picker="${kind}"][data-placement="${placement}"]`)!
const open = (element: HTMLDetailsElement) => {
  element.open = true
  element.dispatchEvent(new win.Event('toggle'))
}
const visibleRows = (element: HTMLDetailsElement) => [...element.querySelectorAll<HTMLElement>('[data-picker-option]')]
  .filter((row) => !row.hidden).map((row) => row.querySelector('.header-picker__name')!.textContent)
const type = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new win.Event('input'))
}

describe('header picker behavior', () => {
  it('enhances every picker and reveals its search without removing the no-script fallback', () => {
    const search = picker('github').querySelector<HTMLElement>('[data-picker-search-label]')!
    expect(search.hidden).toBe(true)
    expect(picker('github').hasAttribute('data-enhanced')).toBe(false)
    initDocumentationNavigation()
    expect(search.hidden).toBe(false)
    for (const kind of ['github', 'packages', 'docs']) {
      expect(picker(kind).hasAttribute('data-enhanced')).toBe(true)
      expect(picker(kind, 'menu').hasAttribute('data-enhanced')).toBe(true)
      // Still a native disclosure of ordinary links.
      expect(picker(kind).tagName).toBe('DETAILS')
      expect(picker(kind).querySelectorAll('a[href^="https://"]').length).toBeGreaterThan(0)
    }
  })

  it('keeps one menu open at a time', () => {
    initDocumentationNavigation()
    open(picker('github'))
    expect(picker('github').open).toBe(true)
    open(picker('packages'))
    expect(picker('packages').open).toBe(true)
    expect(picker('github').open).toBe(false)
    open(picker('docs'))
    expect([picker('github').open, picker('packages').open, picker('docs').open]).toEqual([false, false, true])
  })

  it('closes on Escape and returns focus to the trigger', () => {
    initDocumentationNavigation()
    const github = picker('github')
    open(github)
    const focus = vi.spyOn(github.querySelector('summary')!, 'focus')
    const link = github.querySelector<HTMLElement>('a[data-picker-option]')!
    link.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(github.open).toBe(false)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('closes on a click outside and on focus moving outside', () => {
    initDocumentationNavigation()
    open(picker('docs'))
    win.document.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    expect(picker('docs').open).toBe(false)
    open(picker('docs'))
    win.document.body.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }))
    expect(picker('docs').open).toBe(false)
    // The control: a click inside its own panel leaves it open.
    open(picker('docs'))
    picker('docs').querySelector('.doc-picker-title')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    expect(picker('docs').open).toBe(true)
  })

  it('filters rows by label, coordinate and repository, and hides empty groups', () => {
    initDocumentationNavigation()
    const packages = picker('packages')
    open(packages)
    const input = packages.querySelector<HTMLInputElement>('[data-picker-search]')!
    expect(visibleRows(packages)).toEqual(['libtmux', 'libtmux-macros', 'tmux-mcp', 'tmux-workspace'])
    type(input, 'macros')
    expect(visibleRows(packages)).toEqual(['libtmux-macros'])
    const groups = [...packages.querySelectorAll<HTMLElement>('[data-picker-group]')]
    expect(groups.map((group) => group.hidden)).toEqual([false, true, true])
    expect(packages.querySelector('[data-picker-status]')!.textContent).toBe('1 matching entries')
    // A repository name finds every package built from it.
    type(input, 'libtmux-rs')
    expect(visibleRows(packages)).toEqual(['libtmux', 'libtmux-macros', 'tmux-mcp', 'tmux-workspace'])
    // Every token must match.
    type(input, 'crates mcp')
    expect(visibleRows(packages)).toEqual(['tmux-mcp'])
    // A reader types the group: "workspace manager" finds the workspace package.
    type(input, 'workspace manager')
    expect(visibleRows(packages)).toEqual(['tmux-workspace'])
  })

  it('shows an empty state, restores the list when cleared and resets on close', () => {
    initDocumentationNavigation()
    const github = picker('github')
    open(github)
    const input = github.querySelector<HTMLInputElement>('[data-picker-search]')!
    const empty = github.querySelector<HTMLElement>('[data-picker-empty]')!
    expect(empty.hidden).toBe(true)
    type(input, 'no such repository')
    expect(visibleRows(github)).toEqual([])
    expect(empty.hidden).toBe(false)
    expect(empty.textContent).toBe('No matching repositories.')
    type(input, '')
    expect(empty.hidden).toBe(true)
    expect(visibleRows(github)).toHaveLength(5)
    type(input, 'crates/tmux')
    expect(visibleRows(github)).toEqual(['tmux-mcp', 'tmux-workspace'])
    github.open = false
    github.dispatchEvent(new win.Event('toggle'))
    expect(input.value).toBe('')
    expect(visibleRows(github)).toHaveLength(5)
  })

  it('moves between rows with the arrow keys and activates the first match with Enter', () => {
    initDocumentationNavigation()
    const github = picker('github')
    open(github)
    const input = github.querySelector<HTMLInputElement>('[data-picker-search]')!
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const rows = [...github.querySelectorAll<HTMLElement>('a[data-picker-option]')]
    expect(win.document.activeElement).toBe(rows[0])
    rows[0]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(win.document.activeElement).toBe(rows[1])
    rows[1]!.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(win.document.activeElement).toBe(rows.at(-1))
    type(input, 'macros')
    let clicked = ''
    for (const row of rows) row.addEventListener('click', (event) => { event.preventDefault(); clicked = row.getAttribute('href')! })
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(clicked).toBe('https://github.com/libtmux/libtmux-rs/tree/master/crates/libtmux-macros')
  })

  it('finds a TypeScript package by its executable and an import path', () => {
    mount('ts')
    initDocumentationNavigation()
    const packages = picker('packages')
    open(packages)
    const input = packages.querySelector<HTMLInputElement>('[data-picker-search]')!
    type(input, 'tmux-workspace')
    expect(visibleRows(packages)).toEqual(['@libtmux/workspace-cli'])
    type(input, '@libtmux/mcp')
    expect(visibleRows(packages)).toEqual(['@libtmux/mcp'])
  })

  it('opens a single-destination menu to its one link with no search to focus', () => {
    mount('lua')
    initDocumentationNavigation()
    const packages = picker('packages')
    expect(packages.querySelector('[data-picker-search]')).toBeNull()
    open(packages)
    expect(visibleRows(packages)).toEqual(['libtmux'])
    expect(win.document.activeElement).toBe(packages.querySelector('a[data-picker-option]'))
  })
})
