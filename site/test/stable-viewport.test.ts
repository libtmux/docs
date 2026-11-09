import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'

const component = readFileSync(new URL('../src/components/api/ApiPageContents.astro', import.meta.url), 'utf8')
const script = component.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)![1]
const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
let win: Window
afterEach(async () => { await win?.happyDOM.abort(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function frames(target: Window) {
  const queue = new Map<number, FrameRequestCallback>()
  let next = 0
  Object.defineProperties(target, {
    requestAnimationFrame: { value: (callback: FrameRequestCallback) => { queue.set(++next, callback); return next } },
    cancelAnimationFrame: { value: (id: number) => { queue.delete(id) } },
  })
  const flush = () => { for (let round = 0; round < 3; round++) for (const [id, callback] of [...queue]) { queue.delete(id); callback(0) } }
  return flush
}

/** Chrome on iOS resizes its frame, and so innerHeight, while the keyboard is up. */
function keyboard(height: number) {
  win.happyDOM.setWindowSize({ width: win.innerWidth, height })
  win.dispatchEvent(new win.Event('resize'))
}

it('keeps the sidebar height while the keyboard shrinks the viewport, and recovers on blur', async () => {
  win = new Window({ url: 'https://libtmux.org/en/elixir/latest/reference/libtmux-selection/' })
  win.happyDOM.setWindowSize({ width: 1210, height: 696 })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, CustomEvent: win.CustomEvent, getComputedStyle: win.getComputedStyle.bind(win) })) vi.stubGlobal(name, value)
  const flush = frames(win)
  Object.defineProperty(win, 'matchMedia', { value: () => ({ matches: true, addEventListener() {} }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  win.document.body.innerHTML = `<div class="api-nav-column"><nav class="api-nav" data-base="/b/" data-src="/t.json" data-version="v1"><ul role="tree"></ul></nav><input id="filter"></div>`
  vi.spyOn(win.document.querySelector('.api-nav-column')!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, 0, 256, 5000))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ port: 'p', buckets: [], members: {} }) })))
  vi.resetModules()
  const { initApiTree } = await import('../src/components/api/api-tree')
  initApiTree()
  flush()
  const nav = win.document.querySelector('.api-nav') as unknown as HTMLElement
  const filter = win.document.getElementById('filter') as unknown as HTMLInputElement
  expect(nav.style.getPropertyValue('--api-nav-height')).toBe('696px')
  filter.focus()
  keyboard(342)
  flush()
  expect(nav.style.getPropertyValue('--api-nav-height')).toBe('696px')
  filter.blur()
  keyboard(696)
  flush()
  expect(nav.style.getPropertyValue('--api-nav-height')).toBe('696px')
  keyboard(500)
  flush()
  expect(nav.style.getPropertyValue('--api-nav-height')).toBe('500px')
})

it('keeps member bars sticky while the keyboard shrinks the viewport', () => {
  win = new Window({ url: 'https://libtmux.org/en/elixir/latest/reference/libtmux-selection/' })
  win.happyDOM.setWindowSize({ width: 1210, height: 696 })
  win.document.head.innerHTML = `<style>${css}</style>`
  win.document.body.innerHTML = `<header class="site-header"></header><main class="api-reference-layout api-reference-layout--symbol"><div class="api-reference-content">
    <nav class="api-section-links"><a href="#api-members" data-api-section-link>Members</a></nav>
    <section class="api-members"><h2 id="api-members">Members</h2><div class="api-member-group"><h3 id="g">Common</h3></div></section>
    <input id="filter"></div><api-page-contents></api-page-contents></main>`
  const rect = (selector: string, height: number, top: number) => vi.spyOn(win.document.querySelector(selector)!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, top, 350, height))
  rect('.site-header', 53, 0); rect('.api-section-links', 48, 53); rect('.api-members > h2', 48, 300); rect('.api-member-group > h3', 45, 370); rect('.api-member-group', 400, 370)
  const flush = frames(win)
  Object.defineProperty(win, 'ResizeObserver', { value: class { observe() {} disconnect() {} } })
  win.eval(script)
  flush()
  const members = win.document.querySelector('.api-members')!
  expect(members.hasAttribute('data-api-sticky-members')).toBe(true)
  ;(win.document.getElementById('filter') as unknown as HTMLInputElement).focus()
  keyboard(200)
  flush()
  expect(members.hasAttribute('data-api-sticky-members')).toBe(true)
  ;(win.document.getElementById('filter') as unknown as HTMLInputElement).blur()
  flush()
  keyboard(200)
  flush()
  expect(members.hasAttribute('data-api-sticky-members')).toBe(false)
})
