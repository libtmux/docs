import { readFileSync } from 'node:fs'
import { Window, type HTMLAnchorElement, type HTMLElement } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'

const component = readFileSync(new URL('../src/components/api/ApiPageContents.astro', import.meta.url), 'utf8')
const script = component.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)![1]
const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const anchorCss = readFileSync(new URL('../public/_shell/anchors.css', import.meta.url), 'utf8')
let win: Window
afterEach(async () => { await win?.happyDOM.abort(); vi.restoreAllMocks() })

function mount({ header = 53, row = 48, members = 180, hash = '', scripting = true, fontSize = 16, width = 1440, height = 900 } = {}) {
  win = new Window({ url: `https://libtmux.org/en/scala/latest/reference/window/${hash}` })
  win.happyDOM.setWindowSize({ width, height })
  win.document.documentElement.style.fontSize = `${fontSize}px`
  win.document.head.innerHTML = `<style>.site-header { position: sticky; top: 0; }${css}</style>`
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
  if (scripting) win.eval(script)
  return { geometry, flush, resize: () => observers.forEach((callback) => callback([], {} as ResizeObserver)),
    current: () => win.document.querySelector('.api-section-links [aria-current="location"]')?.getAttribute('href') }
}

function mountMembers({ kind = 'grouped', scripting = true, fieldsFirst = false, ...options }: Parameters<typeof mount>[0] & { kind?: 'grouped' | 'single' | 'scalar' | 'empty'; fieldsFirst?: boolean } = {}) {
  const page = mount({ ...options, scripting: false })
  const grouped = kind === 'grouped'
  const sections = ['collections', 'operations', 'other']
  win.document.getElementById('api-members')!.outerHTML = kind === 'empty' ? '' : `${fieldsFirst ? `<div class="api-field-table"><h2 id="api-fields" class="api-section-heading">Fields<span class="api-section-count">2</span></h2><table><tbody><tr id="member-field"><td>a</td></tr></tbody></table></div>` : ''}<div class="api-members">
    <h2 id="api-members" class="api-section-heading">${kind === 'scalar' ? 'Fields' : 'Members'}<span class="api-section-count">3</span><a class="api-heading-link" href="#api-members" aria-label="Link to members">#</a></h2>
    ${kind === 'scalar' ? '<table><tbody><tr id="member-value"><td>Up</td><td>U</td></tr></tbody></table>'
      : sections.slice(0, grouped ? 3 : 1).map((id) => `<section class="api-member-group" data-group="${id}" ${grouped ? '' : `id="api-${id}"`}>
        ${grouped ? `<h3 id="api-${id}">${id}<span class="api-section-count">1</span><a class="api-heading-link" href="#api-${id}" aria-label="Link to ${id}">#</a></h3>` : ''}
        <ul><li id="member-${id}"><a href="./${id}/">member</a></li></ul></section>`).join('')}
    </div>`
  if (grouped) win.document.querySelector('api-page-contents')!.innerHTML += sections.map((id) =>
    `<a href="#api-${id}" data-api-section-link>${id}</a>`).join('')
  const geometry = {
    ownerHeight: 40.2, groupHeight: 35.2, top: 180, end: 1800,
    collections: { top: 240, bottom: 600 }, operations: { top: 640, bottom: 1000 }, other: { top: 1040, bottom: 1800 },
    value: 350,
  }
  const members = win.document.querySelector<HTMLElement>('.api-members')
  const heading = members?.querySelector('h2')
  if (members && heading) {
    vi.spyOn(members, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, geometry.top, 350, geometry.end - geometry.top))
    const stickyTop = (element: HTMLElement, prefix: string, top: number, bottom: number, height: number) => members.hasAttribute('data-api-sticky-members')
      ? Math.max(top, Math.min(Number.parseFloat(element.style.getPropertyValue(`--api-${prefix}-heading-top`)) || 0, bottom - height)) : top
    vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0,
      stickyTop(members, 'member', geometry.top, geometry.end, geometry.ownerHeight), 350, geometry.ownerHeight))
    for (const id of sections) {
      const group = members.querySelector<HTMLElement>(`[data-group="${id}"]`)
      if (!group) continue
      const bounds = geometry[id as keyof Pick<typeof geometry, 'collections' | 'operations' | 'other'>]
      vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, bounds.top, 350, bounds.bottom - bounds.top))
      const label = group.querySelector('h3')
      if (label) vi.spyOn(label, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0,
        stickyTop(group, 'group', bounds.top, bounds.bottom, geometry.groupHeight), 350, geometry.groupHeight))
      vi.spyOn(group.querySelector('li')!, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, geometry.value, 350, 30))
    }
    const value = members.querySelector('tr')
    if (value) vi.spyOn(value, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, geometry.value, 350, 30))
  }
  if (scripting) win.eval(script)
  return { ...page, stack: geometry, members, heading,
    group: (id: string) => members!.querySelector<HTMLElement>(`[data-group="${id}"]`)! }
}

it.each([
  { width: 1440, height: 900, fontSize: 16 },
  { width: 1440, height: 900, fontSize: 32 },
  { width: 1036, height: 897, fontSize: 32 },
  { width: 390, height: 844, fontSize: 32 },
  { width: 960, height: 400, fontSize: 32 },
])('keeps unmeasured navigation in ordinary flow at $width × $height with $fontSize px text', (viewport) => {
  mount({ ...viewport, scripting: false })
  const root = win.document.documentElement
  expect(win.getComputedStyle(win.document.querySelector('.site-header')!).position).toBe('static')
  expect(win.getComputedStyle(win.document.querySelector('.api-section-links')!).position).toBe('static')
  expect(win.getComputedStyle(root).getPropertyValue('--api-header-height')).toBe('0px')
  expect(win.getComputedStyle(root).getPropertyValue('--api-sections-height')).toBe('0px')
  expect(root.hasAttribute('data-api-sections-measured')).toBe(false)
  for (const link of win.document.querySelectorAll<HTMLAnchorElement>('[data-api-section-link]')) {
    expect(win.document.getElementById(link.hash.slice(1))).not.toBeNull()
    expect(link.getAttribute('href')).toBe(link.hash)
  }
})

it('preserves the site header outside API symbol pages', () => {
  mount({ scripting: false })
  win.document.querySelector('.api-reference-layout')!.remove()
  expect(win.getComputedStyle(win.document.querySelector('.site-header')!).position).toBe('sticky')
})

it.each([
  { header: 97, row: 96, fontSize: 16 },
  { header: 105, row: 293.75, fontSize: 32 },
  { header: 265.5, row: 96.875, fontSize: 32 },
])('enables sticky navigation after measuring $header px header and $row px row', (geometry) => {
  const page = mount({ ...geometry, members: Math.ceil(geometry.header) + Math.ceil(geometry.row) + geometry.fontSize * 0.75 })
  page.flush()
  expect(win.document.documentElement.style.getPropertyValue('--api-header-height')).toBe(`${Math.ceil(geometry.header)}px`)
  expect(win.document.documentElement.style.getPropertyValue('--api-sections-height')).toBe(`${Math.ceil(geometry.row)}px`)
  expect(win.document.documentElement.hasAttribute('data-api-sections-measured')).toBe(true)
  expect(win.getComputedStyle(win.document.querySelector('.site-header')!).position).toBe('sticky')
  expect(win.getComputedStyle(win.document.querySelector('.api-section-links')!).position).toBe('sticky')
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
  expect(win.document.documentElement.hasAttribute('data-api-sections-measured')).toBe(false)
  expect(win.getComputedStyle(win.document.querySelector('.api-section-links')!).position).toBe('static')
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

it.each(['font', 'width'])('keeps a selected heading pinned when %s changes reflow preceding content', (change) => {
  const page = mount({ hash: '#member-parameter', members: 113 })
  page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  page.geometry.members = 1500
  if (change === 'font') win.document.documentElement.style.fontSize = '32px'
  else win.happyDOM.setWindowSize({ width: 1036, height: 900 })
  page.resize(); page.flush()
  expect(scroll).toHaveBeenCalledWith({ top: 1500 - (change === 'font' ? 125 : 113), behavior: 'instant' })
})

it.each([350, -200])('preserves a reading position away from the pinned heading at %s px during reflow', (members) => {
  const page = mount({ hash: '#member-parameter', members })
  page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  page.geometry.members = 1500
  win.document.documentElement.style.fontSize = '32px'
  page.resize(); page.flush()
  expect(scroll).not.toHaveBeenCalled()
})

it('preserves a reader scroll that precedes the next resize observation', () => {
  const page = mount({ hash: '#member-parameter', members: 113 })
  page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  Object.defineProperty(win, 'scrollY', { value: 180, configurable: true })
  page.geometry.members = 1500
  win.document.documentElement.style.fontSize = '32px'
  page.resize(); page.flush()
  expect(scroll).not.toHaveBeenCalled()
})

it('does not pin an old fragment while the destination changes during reflow', () => {
  const page = mount({ hash: '#member-parameter', members: 113 })
  page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  win.location.hash = '#api-related-types'
  win.document.documentElement.style.fontSize = '32px'
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

it('stacks measured Members and group bars below the occupied header without changing the headings', () => {
  const page = mountMembers()
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
  expect(page.members!.style.getPropertyValue('--api-member-heading-top')).toBe('113px')
  expect(page.members!.style.getPropertyValue('--api-member-heading-height')).toBe('41px')
  expect(page.group('collections').getAttribute('style')).toContain('--api-group-heading-top: 154px')
  expect(page.group('collections').getAttribute('style')).toContain('--api-group-heading-height: 36px')
  expect(page.heading!.tagName).toBe('H2')
  expect([...page.members!.querySelectorAll('h3')].map((heading) => heading.id)).toEqual(['api-collections', 'api-operations', 'api-other'])
  expect([...page.members!.querySelectorAll('.api-section-count')].map((count) => count.textContent)).toEqual(['3', '1', '1', '1'])
  const permalink = page.members!.querySelector<HTMLAnchorElement>('h3 a')!
  expect(permalink.getAttribute('aria-label')).toBe('Link to collections')
  permalink.focus()
  expect(win.document.activeElement).toBe(permalink)
})

it('tracks the active group by its source boundary while successive labels occupy the same sticky position', () => {
  const page = mountMembers()
  page.stack.top = -600
  page.stack.collections.top = -400
  page.stack.operations.top = 153
  page.stack.collections.bottom = 599
  page.resize(); page.flush()
  const first = page.group('collections').querySelector('h3')!
  const next = page.group('operations').querySelector('h3')!
  expect(first.getBoundingClientRect().top).toBe(next.getBoundingClientRect().top)
  expect(win.document.querySelector('api-page-contents [aria-current="location"]')?.getAttribute('href')).toBe('#api-operations')
})

it('clips a yielding group before it can paint over the owner bar', () => {
  const page = mountMembers()
  page.stack.top = -500
  page.stack.collections.top = -300
  page.stack.collections.bottom = 170
  page.resize(); page.flush()
  const clip = Number.parseFloat(page.group('collections').style.getPropertyValue('--api-group-heading-clip'))
  expect(clip).toBeGreaterThan(0)
  expect(page.group('collections').querySelector('h3')!.getBoundingClientRect().top + clip).toBeCloseTo(page.heading!.getBoundingClientRect().bottom)
  expect(page.members!.style.getPropertyValue('--api-member-heading-clip')).toBe('0px')
})

it('releases the last group and owner together before the content ends', () => {
  const page = mountMembers()
  page.stack.top = -1500
  page.stack.other.top = -500
  page.stack.other.bottom = page.stack.end = 173
  page.resize(); page.flush()
  expect(page.members!.style.getPropertyValue('--api-member-heading-top')).toBe('96px')
  expect(page.group('other').getAttribute('style')).toContain('--api-group-heading-top: 137px')
  const owner = page.heading!.getBoundingClientRect()
  const group = page.group('other').querySelector('h3')!.getBoundingClientRect()
  expect(owner.bottom).toBeLessThanOrEqual(group.top)
  expect(group.bottom).toBeLessThanOrEqual(page.stack.end)
  expect(Number.parseFloat(page.members!.style.getPropertyValue('--api-member-heading-clip'))).toBeGreaterThan(0)
})

it.each(['single', 'scalar'] as const)('keeps a %s member section to one real owner heading', (kind) => {
  const page = mountMembers({ kind })
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
  expect(page.members!.querySelectorAll('h2, h3')).toHaveLength(1)
  expect(page.heading!.textContent).toContain(kind === 'scalar' ? 'Fields' : 'Members')
  expect(page.members!.querySelector('[style*="--api-group-heading"]')).toBeNull()
})

it('binds sticky member headings to the Members block when a Fields block precedes it', () => {
  const page = mountMembers({ fieldsFirst: true })
  const fields = win.document.querySelector('.api-field-table')!
  expect(win.document.querySelectorAll('.api-members')).toHaveLength(1)
  expect(fields.nextElementSibling).toBe(page.members)
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
  expect(fields.hasAttribute('data-api-sticky-members')).toBe(false)
  expect(page.heading!.textContent).toContain('Members')
  expect(page.members!.querySelectorAll('h3')).toHaveLength(3)
  expect(fields.querySelector('[style*="--api-"]')).toBeNull()
})

it('does not create member headings for an empty owner', () => {
  mountMembers({ kind: 'empty' })
  expect(win.document.querySelector('.api-members')).toBeNull()
})

it.each(['#api-members', '#api-collections', '#member-collections'])(
  'uses only the bars above %s when a wrapped heading changes fragment clearance', (hash) => {
    const page = mountMembers({ hash })
    page.stack.top = hash === '#api-members' ? 113 : -500
    page.stack.collections.top = hash === '#api-collections' ? 154 : -300
    page.stack.value = 190
    page.resize(); page.flush()
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    page.stack.ownerHeight = 60
    page.stack.groupHeight = 55
    page.resize(); page.flush()
    if (hash === '#api-members') expect(scroll).not.toHaveBeenCalled()
    else expect(scroll).toHaveBeenCalledWith({ top: hash === '#api-collections' ? -19 : -38, behavior: 'instant' })
  },
)

it('does not recenter an old group fragment after its heading has become sticky and the reader has moved on', () => {
  const page = mountMembers({ hash: '#api-collections' })
  page.stack.top = -500
  page.stack.collections.top = -300
  page.resize(); page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  page.stack.ownerHeight = 60
  page.stack.collections.top = 1500
  page.resize(); page.flush()
  expect(scroll).not.toHaveBeenCalled()
})

it.each([['#api-members', -613], ['#api-collections', -454]] as const)(
  'returns a newly requested sticky %s to its source boundary', (hash, top) => {
    const page = mountMembers()
    page.stack.top = -500
    page.stack.collections.top = -300
    page.resize(); page.flush()
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    const link = win.document.querySelector<HTMLAnchorElement>(`api-page-contents a[href="${hash}"]`)!
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    // The browser updates the URL after the click handlers return.
    win.history.replaceState(null, '', hash)
    page.flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ top, behavior: 'instant' })
  },
)

it('keeps a link request pending until the browser updates the URL to its fragment', () => {
  const page = mountMembers()
  page.stack.top = -500
  page.stack.collections.top = -300
  page.resize(); page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  const link = win.document.querySelector<HTMLAnchorElement>('api-page-contents a[href="#api-collections"]')!
  // Happy DOM navigates during the click; hold that default action back like such a browser does.
  win.document.addEventListener('click', (event) => event.preventDefault(), { once: true })
  link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  page.flush()
  expect(scroll).not.toHaveBeenCalled()
  win.history.replaceState(null, '', '#api-collections')
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: -454, behavior: 'instant' })
})

it.each([['#api-members', true], ['#api-members', false], ['#api-collections', true], ['#api-collections', false]] as const)(
  'leaves a %s arrival to the anchor handler and the browser (startup marked: %s)', (hash, marked) => {
    const page = mountMembers({ hash, scripting: false })
    if (marked) win.document.documentElement.setAttribute('data-anchor-startup', win.location.href)
    page.stack.top = -500
    page.stack.collections.top = -300
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    win.eval(script)
    page.resize(); page.flush()
    expect(scroll).not.toHaveBeenCalled()
  },
)

it.each([['#api-members', -613], ['#api-collections', -454]] as const)(
  'honors a repeated permalink to %s without changing native history', (hash, top) => {
    const page = mountMembers()
    page.stack.top = -500
    page.stack.collections.top = -300
    page.resize(); page.flush()
    win.history.replaceState({ index: 1, scrollY: 800 }, '', hash)
    const href = win.location.href
    const length = win.history.length
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    const link = page.members!.querySelector<HTMLAnchorElement>(`.api-heading-link[href="${hash}"]`)!
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); page.flush()
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ top, behavior: 'instant' })
    expect(win.location.href).toBe(href)
    expect(win.history.length).toBe(length)
  },
)

it.each([['a saved position', { index: 2, scrollX: 0, scrollY: 800 }], ['a stateless entry', null]] as const)(
  'leaves the position the browser restored for %s when history changes the fragment', (_, state) => {
    const page = mountMembers()
    page.stack.top = -500
    page.stack.collections.top = -300
    page.resize(); page.flush()
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    win.history.replaceState(state, '', '#api-collections')
    win.dispatchEvent(new win.PopStateEvent('popstate', { state }))
    win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
    expect(scroll).not.toHaveBeenCalled()
  },
)

it.each(['ctrl', 'middle', 'blank', 'download', 'prevented', 'other-page', 'other-query'])(
  'leaves %s link activation to its native navigation handler', (mode) => {
    const page = mountMembers()
    page.stack.top = -500
    page.stack.collections.top = -300
    page.resize(); page.flush()
    win.history.replaceState(null, '', '#api-collections')
    const link = page.group('collections').querySelector<HTMLAnchorElement>('a')!
    if (mode === 'blank') link.target = '_blank'
    if (mode === 'download') link.setAttribute('download', '')
    if (mode === 'prevented') link.addEventListener('click', (event) => event.preventDefault())
    if (mode === 'other-page') link.href = '../other/#api-collections'
    if (mode === 'other-query') link.href = '?q=other#api-collections'
    const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    link.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true,
      button: mode === 'middle' ? 1 : 0, ctrlKey: mode === 'ctrl' })); page.flush()
    expect(scroll).not.toHaveBeenCalled()
  },
)

it('returns a clipped permalink heading to its source box while it owns keyboard focus', () => {
  const page = mountMembers()
  page.stack.top = -500
  page.stack.collections.top = -300
  page.stack.collections.bottom = 140
  page.resize(); page.flush()
  expect(page.group('collections').style.getPropertyValue('--api-group-heading-clip')).toBe('36px')
  const heading = page.group('collections').querySelector('h3')!
  // Happy DOM does not match :has(:focus-visible). An attribute of equal specificity
  // stands in for it, so the real rule still has to win the cascade.
  const style = win.document.head.querySelector('style')!
  style.textContent = style.textContent!.replaceAll(':has(:focus-visible)', '[data-keyboard-focus]')
  expect(style.textContent).toContain('> h3[data-keyboard-focus]')
  expect(win.getComputedStyle(heading).position).toBe('sticky')
  expect(win.getComputedStyle(heading).clipPath).toBe('inset(36px 0 0)')
  heading.querySelector<HTMLAnchorElement>('a')!.focus()
  heading.setAttribute('data-keyboard-focus', '')
  // In flow, but still positioned, so its z-index keeps it above the gap cover.
  expect(win.getComputedStyle(heading).position).toBe('relative')
  expect(win.getComputedStyle(heading).top).toBe('auto')
  expect(win.getComputedStyle(heading).zIndex).toBe('17')
  expect(win.getComputedStyle(heading).clipPath).toBe('none')
})

it('tints a member bar for the anchor arrival cue instead of replacing its opaque surface', () => {
  const page = mountMembers()
  const style = win.document.head.querySelector('style')!
  style.textContent += anchorCss
  const bars = [page.heading!, page.group('collections').querySelector('h3')!]
  for (const bar of bars) {
    bar.setAttribute('data-anchor-arrival', '')
    expect(win.getComputedStyle(bar).animationName).toBe('api-member-bar-arrival')
  }
  const keyframes = css.match(/@keyframes api-member-bar-arrival \{([\s\S]*?)\n\}/)![1]
  expect(keyframes.match(/background-color: [^;]*var\(--api-member-bar\)/g)).toHaveLength(2)
  expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*(?:\.api-field-table > h2\[data-anchor-arrival\],\s*)?\.api-members > h2\[data-anchor-arrival\][^{]*\{\s*background-color: [^;]*var\(--api-member-bar\)\) !important/)
  // The same heading outside the owner section keeps the shared cue.
  const outside = win.document.createElement('h3')
  outside.setAttribute('data-anchor-arrival', '')
  win.document.body.append(outside)
  expect(win.getComputedStyle(outside).animationName).toBe('libtmux-heading-arrival')
})

it.each(['fonts-pending', 'link-hints-pending'])('keeps the member bars in flow while %s holds the page back', (pending) => {
  const page = mountMembers()
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
  win.document.documentElement.classList.add(pending)
  const bars = [page.heading!, page.group('collections').querySelector('h3')!]
  expect(bars.map((bar) => win.getComputedStyle(bar).position)).toEqual(['relative', 'relative'])
  expect(bars.map((bar) => win.getComputedStyle(bar).top)).toEqual(['auto', 'auto'])
  expect(bars.map((bar) => win.getComputedStyle(bar).zIndex)).toEqual(['18', '17'])
  expect(bars.map((bar) => win.getComputedStyle(bar).clipPath)).toEqual(['none', 'none'])
})

it('keeps focus scrolling clear of the bars above each control and follows their measured height', () => {
  const page = mountMembers()
  const margin = (element: HTMLElement) => win.getComputedStyle(element).getPropertyValue('scroll-margin-top')
  const member = page.group('operations').querySelector<HTMLElement>('li a')!
  const permalink = page.group('operations').querySelector<HTMLElement>('h3 a')!
  const owner = page.heading!.querySelector<HTMLElement>('a')!
  // A control in a group clears the Members bar and that group's bar; a heading link only the bars above it.
  expect(margin(member)).toBe('calc(41px + 36px)')
  expect(margin(permalink)).toBe('41px')
  expect(margin(owner)).toBe('0px')
  page.stack.ownerHeight = 60
  page.stack.groupHeight = 55
  page.resize(); page.flush()
  expect(margin(member)).toBe('calc(60px + 55px)')
  expect(margin(permalink)).toBe('60px')
  // Bars that stay in flow take no clearance.
  page.members!.removeAttribute('data-api-sticky-members')
  expect(margin(member)).toBe('')
})

it('covers the gap between the section row and the stuck bars with the page background', () => {
  const cover = css.match(/\.api-members\[data-api-sticky-members\]::before \{([\s\S]*?)\n  \}/)![1]
  const top = cover.match(/top: calc\(var\(--api-header-height\) \+ var\(--api-sections-height\) - (\d+)px\)/)
  const height = cover.match(/height: calc\(0\.75rem \+ (\d+)px\)/)
  // The cover ends where the measured reading top (row bottom plus 0.75rem) begins, and overlaps the row by the same amount it starts above it.
  expect(top?.[1]).toBeDefined()
  expect(height?.[1]).toBe(top![1])
  expect(cover).toContain('margin-bottom: calc(-0.75rem - ' + top![1] + 'px)')
  expect(cover).toMatch(/z-index: 16;/)
  expect(cover).toContain('background: var(--background-color)')
  expect(script).toContain('* 0.75')
})

it.each([['#api-members', 'h2'], ['#api-collections', 'h3']] as const)(
  'keeps a linked %s heading in flow until the browser and anchor handler have aligned it', (hash, tag) => {
    const page = mountMembers()
    page.stack.top = -500
    page.stack.collections.top = -300
    page.resize(); page.flush()
    vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
    const heading = page.members!.querySelector<HTMLElement>(`${tag}[id="${hash.slice(1)}"]`)!
    const sibling = tag === 'h2' ? page.group('collections').querySelector('h3')! : page.heading!
    expect(win.getComputedStyle(heading).position).toBe('sticky')
    win.document.querySelector(`api-page-contents a[href="${hash}"]`)!
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    // The browser aligns the target during the click's default action, so it is in flow by then.
    expect(heading.hasAttribute('data-api-arriving')).toBe(true)
    expect(win.getComputedStyle(heading).position).toBe('relative')
    expect(win.getComputedStyle(heading).clipPath).toBe('none')
    expect(win.getComputedStyle(sibling).position).toBe('sticky')
    page.flush()
    expect(heading.hasAttribute('data-api-arriving')).toBe(true)
    page.flush()
    expect(heading.hasAttribute('data-api-arriving')).toBe(false)
    expect(win.getComputedStyle(heading).position).toBe('sticky')
  },
)

it('counts two frames from the last navigation signal before returning the heading to the bars', () => {
  const page = mountMembers()
  page.stack.top = -500
  page.stack.collections.top = -300
  page.resize(); page.flush()
  vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  const heading = page.group('collections').querySelector('h3')!
  win.document.querySelector('api-page-contents a[href="#api-collections"]')!
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  page.flush()
  // Some browsers update the URL after the first frame.
  win.history.replaceState(null, '', '#api-collections')
  win.dispatchEvent(new win.HashChangeEvent('hashchange'))
  page.flush()
  expect(heading.hasAttribute('data-api-arriving')).toBe(true)
  page.flush()
  expect(heading.hasAttribute('data-api-arriving')).toBe(false)
})

it('releases an arriving heading when the reference is left', () => {
  const page = mountMembers()
  vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  const heading = page.group('collections').querySelector('h3')!
  win.document.querySelector('api-page-contents a[href="#api-collections"]')!
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  expect(heading.hasAttribute('data-api-arriving')).toBe(true)
  win.document.querySelector('api-page-contents')!.remove()
  expect(heading.hasAttribute('data-api-arriving')).toBe(false)
})

function mountNavigating() {
  const page = mountMembers({ scripting: false })
  const navigation = new win.EventTarget()
  Object.defineProperty(win, 'navigation', { value: navigation, configurable: true })
  win.eval(script)
  page.stack.top = -500
  page.stack.collections.top = -300
  page.resize(); page.flush()
  const scroll = vi.spyOn(win, 'scrollBy').mockImplementation(() => {})
  const navigate = (hash: string, init: Record<string, unknown> = {}) => navigation.dispatchEvent(Object.assign(new win.Event('navigate'), {
    hashChange: true, navigationType: 'push',
    destination: { sameDocument: true, url: `https://libtmux.org/en/scala/latest/reference/window/${hash}` }, ...init,
  }))
  const arriving = () => page.members!.querySelectorAll('[data-api-arriving]').length
  return { ...page, scroll, navigate, arriving }
}

it.each(['#api-members', '#api-collections'])('puts a heading in flow before the browser scrolls to a typed %s', (hash) => {
  const page = mountNavigating()
  page.navigate(hash)
  expect(page.members!.querySelector(`[data-api-arriving][id="${hash.slice(1)}"]`)).not.toBeNull()
  expect(page.arriving()).toBe(1)
})

it.each([
  ['a history traversal', '#api-collections', { navigationType: 'traverse' }],
  ['a replaced entry without a fragment change', '#api-collections', { navigationType: 'replace', hashChange: false }],
  ['another document', '#api-collections', { destination: { sameDocument: false, url: 'https://libtmux.org/en/other/#api-collections' } }],
  ['a fragment that is not a sticky heading', '#member-collections', {}],
] as const)('leaves %s to the browser', (_, hash, init) => {
  const page = mountNavigating()
  page.navigate(hash, init as Record<string, unknown>)
  win.history.replaceState(null, '', hash)
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
  expect(page.arriving()).toBe(0)
  expect(page.scroll).not.toHaveBeenCalled()
})

it('returns a typed sticky group to its source boundary if the browser aligned its stuck bar', () => {
  const page = mountNavigating()
  page.navigate('#api-collections')
  win.history.replaceState(null, '', '#api-collections')
  win.dispatchEvent(new win.HashChangeEvent('hashchange')); page.flush()
  expect(page.scroll).toHaveBeenCalledExactlyOnceWith({ top: -454, behavior: 'instant' })
})

it('leaves the member bars in ordinary flow when a short viewport cannot fit them and the article', () => {
  const page = mountMembers({ height: 400, header: 97, row: 96, fontSize: 32 })
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(false)
  expect(win.getComputedStyle(page.heading!).position).not.toBe('sticky')
  win.happyDOM.setWindowSize({ width: 1440, height: 900 })
  page.resize(); page.flush()
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
})

it('keeps no-script headings in flow and confines sticky member styling to screen media', () => {
  const page = mountMembers({ scripting: false })
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(false)
  expect(win.getComputedStyle(page.heading!).position).not.toBe('sticky')
  expect(css).toMatch(/@media screen\s*\{\s*\.api-members\[data-api-sticky-members\] > h2/)
})

it('cleans member measurements on disconnect and measures the surviving headings again on reconnect', () => {
  const page = mountMembers()
  const controller = win.document.querySelector('api-page-contents')!
  const parent = controller.parentElement!
  controller.remove()
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(false)
  expect(page.members!.getAttribute('style') ?? '').not.toContain('--api-member-heading')
  expect(page.group('collections').getAttribute('style') ?? '').not.toContain('--api-group-heading')
  page.stack.ownerHeight = 58
  parent.append(controller)
  expect(page.members!.hasAttribute('data-api-sticky-members')).toBe(true)
  expect(page.group('collections').getAttribute('style')).toContain('--api-group-heading-top: 171px')
})
