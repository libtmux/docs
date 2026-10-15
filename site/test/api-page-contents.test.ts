import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'

const component = readFileSync(new URL('../src/components/api/ApiPageContents.astro', import.meta.url), 'utf8')
const script = component.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)![1]
let win: Window
afterEach(async () => { await win?.happyDOM.abort(); vi.restoreAllMocks() })

function mount({ header = 53, row = 48, members = 180, hash = '' } = {}) {
  win = new Window({ url: `https://libtmux.org/en/scala/latest/reference/window/${hash}` })
  win.document.body.innerHTML = `<header class="site-header"></header>
    <main class="api-reference-layout api-reference-layout--symbol">
      <div class="api-reference-content"><header id="api-overview"></header>
        <nav class="api-section-links" aria-label="Reference sections"><a href="#api-overview" data-api-section-link>Overview</a>
          <a href="#api-members" data-api-section-link>Members</a><a href="#api-related-types" data-api-section-link>Related types</a></nav>
        <section id="api-members"><h3 id="member-parameter">Parameter</h3></section>
        <section id="api-related-types"></section></div>
      <api-page-contents><a href="#api-members" data-api-section-link>Members</a></api-page-contents>
    </main>`
  const geometry = { header, row, members }
  vi.spyOn(win.document.querySelector('.site-header')!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, 0, 390, geometry.header))
  vi.spyOn(win.document.querySelector('.api-section-links')!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, geometry.header, 350, geometry.row))
  for (const [id, top] of [['api-overview', -300], ['api-members', members], ['api-related-types', 700]] as const) {
    vi.spyOn(win.document.getElementById(id)!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, id === 'api-members' ? geometry.members : top, 350, 30))
  }
  vi.spyOn(win.document.getElementById('member-parameter')!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, geometry.members, 350, 30))
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  Object.defineProperties(win, {
    requestAnimationFrame: { value: (callback: FrameRequestCallback) => { frames.set(++next, callback); return next } },
    cancelAnimationFrame: { value: (id: number) => { frames.delete(id) } },
  })
  const observers: ResizeObserverCallback[] = []
  Object.defineProperty(win, 'ResizeObserver', { value: class extends win.ResizeObserver {
    constructor(callback: ResizeObserverCallback) { super(); observers.push(callback) }
  } })
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } }
  win.eval(script)
  return { geometry, flush, resize: () => observers.forEach((callback) => callback([], {} as ResizeObserver)),
    current: () => win.document.querySelector('.api-section-links [aria-current="location"]')?.getAttribute('href') }
}

it('uses the actual header and section-row heights for reading clearance', () => {
  const page = mount({ header: 97, row: 96, members: 195 })
  page.flush()
  expect(win.document.documentElement.style.getPropertyValue('--api-header-height')).toBe('97px')
  expect(win.document.documentElement.style.getPropertyValue('--api-sections-height')).toBe('96px')
  expect(page.current()).toBe('#api-members')
})

it('remeasures a wrapping row and resized header and synchronizes both navigation surfaces', () => {
  const page = mount({ members: 170 })
  page.flush()
  expect(page.current()).toBe('#api-overview')
  page.geometry.header = 97
  page.geometry.row = 96
  page.resize(); page.flush()
  expect(page.current()).toBe('#api-members')
  expect(win.document.querySelector('api-page-contents a')?.getAttribute('aria-current')).toBe('location')
})

it('keeps an explicitly selected final or nested section active when scrolling is constrained', () => {
  const page = mount({ hash: '#member-parameter', members: 350 })
  page.flush()
  expect(page.current()).toBe('#api-members')
  win.location.hash = '#api-related-types'
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
  expect(page.current()).toBe('#api-related-types')
})

it('disconnects layout observers and removes page-specific clearance after leaving a reference', () => {
  const page = mount()
  page.flush()
  win.document.querySelector('api-page-contents')!.remove()
  expect(win.document.documentElement.style.getPropertyValue('--api-header-height')).toBe('')
  page.geometry.header = 150
  win.dispatchEvent(new win.Event('resize')); page.flush()
  expect(win.document.documentElement.style.getPropertyValue('--api-header-height')).toBe('')
})

it('keeps a fragment arrival clear when the occupied header grows', () => {
  const page = mount({ hash: '#member-parameter', members: 125 })
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  page.geometry.header = 97
  page.resize(); page.flush()
  expect(scroll).toHaveBeenCalledWith({ top: -32, behavior: 'instant' })
  scroll.mockClear()
  page.geometry.members = -200
  page.geometry.header = 120
  page.resize(); page.flush()
  expect(scroll).not.toHaveBeenCalled()
})

it('reveals a newly active link using only the horizontal section scroller', () => {
  const page = mount({ hash: '#api-members', members: 250 })
  const row = win.document.querySelector('.api-section-links')!
  const link = row.querySelector('a[href="#api-related-types"]')!
  vi.spyOn(link, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(420, 53, 130, 48))
  const position = win.scrollY
  win.location.hash = '#api-related-types'
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
  expect(row.scrollLeft).toBe(200)
  expect(win.scrollY).toBe(position)
})
