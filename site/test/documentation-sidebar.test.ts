import { Window, type HTMLElement as HappyElement } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initializeDocumentationSidebar } from '../src/components/docs/documentation-sidebar'

let win: Window
let frames: FrameRequestCallback[]
let finishFonts: () => void
const scope = '/en/cxx/latest/mcp/reference/'
const key = (value = scope) => `libtmux:section-nav:${value}`

beforeEach(() => {
  win = new Window({ url: `https://libtmux.org${scope}glossary/#attribute` })
  for (const name of ['window', 'document', 'AbortController']) {
    vi.stubGlobal(name, name === 'window' ? win : name === 'document' ? win.document : win.AbortController)
  }
  frames = []
  const requestFrame = win.requestAnimationFrame.bind(win)
  vi.spyOn(win, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return requestFrame(() => {})
  })
  Object.defineProperty(win.document, 'fonts', {
    value: {
      ready: new Promise<void>((resolve) => {
        finishFonts = resolve
      }),
    },
    configurable: true,
  })
})
afterEach(async () => {
  win.document.dispatchEvent(new win.Event('astro:before-swap'))
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount({ section = scope, rowOffset = 900, inert = false, hidden = false, desktop = false } = {}) {
  const scroll = win.document.createElement('aside')
  scroll.setAttribute('data-documentation-scroll', desktop ? 'desktop' : 'mobile')
  if (inert) scroll.setAttribute('inert', '')
  scroll.hidden = hidden
  scroll.innerHTML = `<div data-section-navigation data-section-scope="${section}">
    <label data-section-search-label hidden><input data-section-search type="search"></label>
    <nav class="sidebar-nav">
      <details id="language" open><summary><a href="${section}" data-sidebar-label="Language API">Language API</a></summary>
        <details id="secondary"><summary><span data-sidebar-label="Other">Other</span></summary>
          <a href="${section}other/" data-sidebar-label="Other member">Other member</a>
        </details>
        <a id="active" href="${section}glossary/" aria-current="page" data-sidebar-label="Glossary">Glossary</a>
      </details>
    </nav><p data-section-empty hidden>No matching pages</p>
  </div>`
  win.document.body.append(scroll)
  const nav = scroll.querySelector<HappyElement>('[data-section-navigation]')!
  const current = nav.querySelector<HappyElement>('#active')!
  const geometry = { rowOffset }
  vi.spyOn(scroll, 'getClientRects').mockImplementation(
    () => (scroll.hidden ? [] : [scroll.getBoundingClientRect()]) as ReturnType<HappyElement['getClientRects']>,
  )
  vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(20, 100, 240, 400))
  vi.spyOn(current, 'getBoundingClientRect').mockImplementation(
    () => new win.DOMRect(30, 100 + geometry.rowOffset - scroll.scrollTop, 220, 30),
  )
  const start = () => initializeDocumentationSidebar(nav as unknown as HTMLElement)
  const language = nav.querySelector('details')!
  const secondary = nav.querySelectorAll('details')[1]
  return { scroll, nav, current, geometry, start, language, secondary }
}
function flushFrames() {
  const pending = frames.splice(0)
  pending.forEach((callback) => callback(0))
}
function saveState(top: number, branches = {}, section = scope) {
  win.sessionStorage.setItem(key(section), JSON.stringify({ top, branches }))
}
function readState(section = scope) {
  return JSON.parse(win.sessionStorage.getItem(key(section)) ?? 'null')
}

it('reveals an off-screen active entry using only its real scroller', () => {
  const { start, scroll, current } = mount()
  const outside = win.document.createElement('button')
  win.document.body.append(outside)
  outside.focus()
  win.scrollTo(0, 600)
  start()
  expect(scroll.scrollTop).toBe(715)
  expect(current.getBoundingClientRect().top).toBe(285)
  expect(win.scrollY).toBe(600)
  expect(win.document.activeElement).toBe(outside)
})

it('keeps an already visible destination at the saved reading position', () => {
  saveState(700)
  const { start, scroll } = mount()
  start()
  flushFrames()
  expect(scroll.scrollTop).toBe(700)
})

it('opens the current ancestry while retaining other saved branch choices', () => {
  saveState(700, { [JSON.stringify([scope])]: false, [JSON.stringify([scope, 'Other'])]: true })
  const { start, language, secondary } = mount()
  start()
  expect(language.open).toBe(true)
  expect(secondary.open).toBe(true)
})

it('saves current position before navigation and restores it in the same scope', () => {
  const first = mount({ rowOffset: 100 })
  first.start()
  first.scroll.dispatchEvent(new win.Event('wheel'))
  first.scroll.scrollTop = 670
  first.secondary.open = true
  win.document.dispatchEvent(new win.Event('astro:before-swap'))
  first.scroll.remove()
  const second = mount()
  second.start()
  flushFrames()
  expect(second.scroll.scrollTop).toBe(670)
  expect(second.secondary.open).toBe(true)
})

it.each([
  '/en/julia/latest/mcp/reference/',
  '/en/cxx/latest/workspace/reference/',
  '/en/cxx/stable/mcp/reference/',
  '/fr/cxx/latest/mcp/reference/',
])('does not inherit state in %s', (section) => {
  saveState(700, { [JSON.stringify([scope, 'Other'])]: true })
  const { start, scroll, secondary } = mount({ section, rowOffset: 100 })
  start()
  expect(scroll.scrollTop).toBe(0)
  expect(secondary.open).toBe(false)
})

it.each(['wheel', 'pointerdown', 'keydown'])(
  'does not override reader %s after font or frame completion',
  async (event) => {
    const { start, scroll, geometry } = mount()
    start()
    scroll.dispatchEvent(new win.Event(event))
    scroll.scrollTop = 500
    geometry.rowOffset = 1200
    finishFonts()
    await Promise.resolve()
    flushFrames()
    win.dispatchEvent(new win.Event('resize'))
    flushFrames()
    expect(scroll.scrollTop).toBe(500)
  },
)

it('adjusts for delayed font layout before the reader interacts', async () => {
  const { start, scroll, geometry } = mount()
  start()
  geometry.rowOffset = 1200
  finishFonts()
  await Promise.resolve()
  flushFrames()
  expect(scroll.scrollTop).toBe(1015)
})

it('restores an inert mobile drawer on its first opening without a hidden copy overwriting state', () => {
  saveState(700)
  const mobile = mount({ inert: true })
  const desktop = mount({ hidden: true })
  mobile.start()
  desktop.start()
  flushFrames()
  win.dispatchEvent(new win.Event('pagehide'))
  expect(readState().top).toBe(700)
  expect(mobile.scroll.scrollTop).toBe(0)
  mobile.scroll.removeAttribute('inert')
  win.document.dispatchEvent(new win.Event('libtmux:drawer-open'))
  flushFrames()
  expect(mobile.scroll.scrollTop).toBe(700)
  mobile.scroll.dispatchEvent(new win.Event('wheel'))
  mobile.scroll.scrollTop = 560
  mobile.scroll.setAttribute('inert', '')
  mobile.scroll.removeAttribute('inert')
  win.document.dispatchEvent(new win.Event('libtmux:drawer-open'))
  flushFrames()
  expect(mobile.scroll.scrollTop).toBe(560)
})

it('captures drawer position before a navigation handler makes it inert', () => {
  const { start, scroll, current } = mount()
  start()
  scroll.scrollTop = 650
  current.addEventListener('click', (event) => {
    event.preventDefault()
    scroll.setAttribute('inert', '')
  })
  current.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }))
  expect(readState().top).toBe(650)
})

it.each(['blocked', 'malformed', 'negative', 'array'])('reveals the active entry with %s storage', (mode) => {
  if (mode === 'blocked')
    vi.spyOn(win.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
  else
    win.sessionStorage.setItem(
      key(),
      mode === 'malformed' ? '{' : mode === 'negative' ? '{"top":-1,"branches":{}}' : '{"top":700,"branches":[]}',
    )
  const { start, scroll } = mount()
  start()
  expect(scroll.scrollTop).toBe(715)
})

it('retains search, qualified matching and branch choices when clearing or navigating', () => {
  const { start, nav, secondary } = mount()
  start()
  const input = nav.querySelector('input')!
  expect(nav.querySelector<HappyElement>('[data-section-search-label]')!.hidden).toBe(false)
  input.value = 'Other.member'
  input.dispatchEvent(new win.Event('input'))
  expect(nav.querySelector<HappyElement>('#active')!.hidden).toBe(true)
  input.value = 'Language API.Other'
  input.dispatchEvent(new win.Event('input'))
  expect(secondary.open).toBe(true)
  expect(secondary.querySelector<HappyElement>('a')!.hidden).toBe(false)
  win.dispatchEvent(new win.Event('pagehide'))
  expect(readState().branches[JSON.stringify([scope, 'Other'])]).toBe(false)
  input.value = ''
  input.dispatchEvent(new win.Event('input'))
  expect(secondary.open).toBe(false)
  expect(nav.querySelector<HappyElement>('#active')!.hidden).toBe(false)
})

it('runs as a self-contained inline function before the bundled scripts', () => {
  const { nav, scroll } = mount()
  win.eval(`(${initializeDocumentationSidebar.toString()})(document.querySelector('[data-section-navigation]'))`)
  expect(scroll.scrollTop).toBe(715)
  expect(nav.querySelector<HappyElement>('[data-section-search-label]')!.hidden).toBe(false)
})

it('ignores pending font and resize work after an Astro document swap', async () => {
  const { start, scroll, geometry } = mount()
  start()
  win.document.dispatchEvent(new win.Event('astro:before-swap'))
  geometry.rowOffset = 1400
  finishFonts()
  await Promise.resolve()
  flushFrames()
  win.dispatchEvent(new win.Event('resize'))
  flushFrames()
  expect(scroll.scrollTop).toBe(715)
})

it('keeps the last row reachable when the full header places the sidebar below its sticky offset', () => {
  Object.defineProperty(win, 'innerHeight', { value: 842, configurable: true })
  const { start, scroll, current } = mount({ rowOffset: 1400, desktop: true })
  const contentHeight = 1430
  let top = 0
  const height = () => {
    const inset = Number(scroll.style.maxHeight.match(/- ([\d.]+)px/)?.[1] ?? 80)
    return win.innerHeight - inset - 16
  }
  vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(20, 167, 240, height()))
  vi.spyOn(current, 'getBoundingClientRect').mockImplementation(
    () => new win.DOMRect(30, 1567 - scroll.scrollTop, 220, 30),
  )
  Object.defineProperty(scroll, 'scrollTop', {
    get: () => Math.min(top, contentHeight - height()),
    set: (value: number) => {
      top = Math.max(0, Math.min(value, contentHeight - height()))
    },
  })
  start()
  flushFrames()
  expect(scroll.getBoundingClientRect().bottom).toBe(826)
  expect(current.getBoundingClientRect().bottom).toBeLessThanOrEqual(826)
  expect(win.scrollY).toBe(0)
})

it('fits a moving desktop sidebar without overriding the reader position', () => {
  const { start, scroll } = mount({ desktop: true })
  let top = 167
  vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(20, top, 240, 400))
  start()
  expect(scroll.style.maxHeight).toBe('calc(100dvh - 167px - 1rem)')
  scroll.dispatchEvent(new win.Event('wheel'))
  scroll.scrollTop = 200
  top = 80
  win.dispatchEvent(new win.Event('scroll'))
  flushFrames()
  expect(scroll.style.maxHeight).toBe('calc(100dvh - 80px - 1rem)')
  expect(scroll.scrollTop).toBe(200)
  win.document.dispatchEvent(new win.Event('astro:before-swap'))
  top = 120
  win.dispatchEvent(new win.Event('resize'))
  flushFrames()
  expect(scroll.style.maxHeight).toBe('calc(100dvh - 80px - 1rem)')
})

it('leaves the mobile drawer height with its own layout', () => {
  const { start, scroll } = mount()
  start()
  flushFrames()
  expect(scroll.style.maxHeight).toBe('')
})
