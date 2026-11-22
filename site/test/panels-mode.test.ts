/**
 * Panel mode: the opt-in that turns any page into the main panel of a workspace. These tests mount the real workspace
 * in a DOM and read the real stylesheets, so each one fails if the behaviour it names stops.
 */
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPanelMode } from '../src/components/api/panels/mode-workspace'
import { leaves } from '../src/lib/panels/layout'
import { readEquivalents, readLinked, readPagePorts } from '../src/lib/panels/linked'
import { MODE_ATTRIBUTE, MODE_KEY, MODE_PARAM, READY_ATTRIBUTE, applyPanelMode, exitUrl, pagePath, panelHref, watchPanelMode } from '../src/lib/panels/mode'
import { LAYOUT_KEY, parseLayout } from '../src/lib/panels/mode-layout'
import type { PanelStorage } from '../src/lib/panels/persist'
import { parseRules } from './css-rules'

const ORIGIN = 'https://libtmux.org'
const BASE = '/en/go/latest/'

const picker = `<details data-page-port-switcher><div>
  <a class="doc-picker-option" href="/en/go/latest/guides/capturing-output/" data-port="go" data-port-name="Go" aria-current="page"><span>Go</span></a>
  <a class="doc-picker-option" href="/en/py/v0.46.2/guides/capturing-output/" data-port="py" data-port-name="Python"><span>Python</span></a>
  <a class="doc-picker-option" href="/en/rs/latest/guides/capturing-output/" data-port="rs" data-port-name="Rust"><span>Rust<small class="doc-picker-api" data-qn="pane::Pane::capture"><span>pane::Pane::capture</span></small><small class="doc-picker-differences" data-picker-differences><span class="sr-only">Differs: </span>async · owned</small></span></a>
  <a class="doc-picker-option" href="/en/ts/latest/guides/capturing-output/" data-port="ts" data-port-name="TypeScript"><span>TypeScript</span></a>
  <div class="doc-picker-option doc-picker-option--unmatched" data-port="java"><span>Java<small>No matching page</small></span></div>
</div></details>`

const table = `<div data-eq-group><p class="api-eq-why">Source-verified mappings for <b>Read a pane</b>.</p><table><tbody>
  <tr aria-current="true" data-port="go"><th scope="row">Go</th><td class="api-elsewhere-value"><a href="/en/go/latest/reference/tmux-pane-capture/" aria-current="page"><code>tmux<wbr>.Pane<wbr>.Capture</code></a></td><td><span class="api-eq-muted">This page</span></td></tr>
  <tr data-port="py" data-differs><th scope="row">Python</th><td class="api-elsewhere-value"><a href="/en/py/v0.46.2/reference/libtmux-pane-capture_pane/"><span class="api-nav__kind api-badge--kind-method"><span>m</span></span><code>libtmux.Pane.capture_pane</code></a><div class="api-eq-sum">Capture text.</div></td><td><span class="api-eq-chips"><span class="api-eq-diff">3 overloads</span></span><div class="api-eq-note">Returns a list.</div></td></tr>
  <tr data-port="rs"><th scope="row">Rust</th><td class="api-elsewhere-value"><a href="/en/rs/latest/reference/pane-capture/"><code>pane.Pane.capture</code></a></td><td><span class="api-eq-muted">None recorded</span></td></tr>
</tbody></table></div>`

const pageHtml = (inner: string, title = 'Capturing output') => `<!doctype html><html data-shell-base="${BASE}"${' data-panels'}><head><title>${title} | Go</title></head><body>
  <header class="site-header"><a href="/en/go/latest/topics/">Topics</a></header>
  <div class="context">${picker}</div>
  <div data-pagefind-filter="port:Go"><aside class="sidebar">Sidebar</aside>
    <main id="content"><h1>${title}</h1>${inner}</main></div>
  <footer data-site-footer>Footer</footer></body></html>`

const BODY = `<p>Text.</p><a id="topics" href="/en/go/latest/topics/">Topics</a><a id="hash" href="#setup">Setup</a><h2 id="setup">Setup</h2>
  <a id="out" href="https://elsewhere.test/x/">Out</a><a id="other" href="/en/py/v0.46.2/guides/x/">Python guide</a>`

const memory = () => {
  const data = new Map<string, string>()
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
}
const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('blocked') } }

let windows: Window[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const win of windows) win.happyDOM.abort()
  windows = []
})

/** A page in its own window, which the workspace's modules see as the global document. */
function open(html: string, url = `${ORIGIN}${BASE}guides/capturing-output/`, storage: PanelStorage = memory()) {
  const win = new Window({ url })
  windows.push(win)
  win.document.write(html)
  Object.defineProperty(win, 'localStorage', { value: storage, configurable: true })
  for (const [name, value] of Object.entries({ document: win.document, window: win, location: win.location, history: win.history, localStorage: storage })) vi.stubGlobal(name, value)
  return win
}
const doc = (win: Window) => win.document as unknown as Document
const fire = (el: unknown, event: unknown) => (el as EventTarget).dispatchEvent(event as Event)
const $ = (win: Window, selector: string) => win.document.querySelector(selector) as unknown as HTMLElement
const regions = (win: Window) => [...win.document.querySelectorAll('[data-region]')].map((el) => el.getAttribute('data-region'))
const click = (win: Window, el: unknown, init: Record<string, unknown> = {}) => {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  fire(el, event)
  return event
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('turning the mode on and off', () => {
  const apply = (win: Window) => applyPanelMode(doc(win), MODE_KEY, MODE_PARAM, MODE_ATTRIBUTE)
  const bare = '<!doctype html><html><head></head><body></body></html>'

  it('is off for a reader who never asked, and leaves storage and the address alone', () => {
    const storage = memory()
    const win = open(bare, `${ORIGIN}${BASE}guides/`, storage)
    expect(apply(win)).toBe(false)
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(false)
    expect(storage.data.size).toBe(0)
    expect(win.location.href).toBe(`${ORIGIN}${BASE}guides/`)
  })

  it('turns on with ?panels=1, remembers it, and takes the parameter out of the address', () => {
    const storage = memory()
    const win = open(bare, `${ORIGIN}${BASE}guides/?panels=1&x=2#top`, storage)
    expect(apply(win)).toBe(true)
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(true)
    expect(storage.data.get(MODE_KEY)).toBe('1')
    expect(win.location.href).toBe(`${ORIGIN}${BASE}guides/?x=2#top`)
  })

  it('stays on for later pages with no parameter, and stays on after a router swap replaced the root\'s attributes', () => {
    const storage = memory()
    storage.data.set(MODE_KEY, '1')
    const win = open(bare, `${ORIGIN}${BASE}reference/`, storage)
    expect(apply(win)).toBe(true)
    win.document.documentElement.removeAttribute(MODE_ATTRIBUTE)
    expect(apply(win)).toBe(true)
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(true)
  })

  it('turns off with ?panels=0, forgets the choice and takes the parameter out of the address', () => {
    const storage = memory()
    storage.data.set(MODE_KEY, '1')
    const win = open(bare, `${ORIGIN}${BASE}guides/?panels=0`, storage)
    expect(apply(win)).toBe(false)
    expect(storage.data.get(MODE_KEY)).toBe('0')
    expect(win.location.search).toBe('')
    expect(apply(open(bare, `${ORIGIN}${BASE}guides/`, storage))).toBe(false)
  })

  it('takes only 1 and 0 as a choice: any other value leaves the stored choice and the address as they were', () => {
    for (const value of ['yes', 'true', '', '2', '01']) {
      const storage = memory()
      storage.data.set(MODE_KEY, '1')
      const win = open(bare, `${ORIGIN}${BASE}guides/?panels=${value}`, storage)
      expect(apply(win), value).toBe(true)
      expect(storage.data.get(MODE_KEY), value).toBe('1')
      expect(win.location.search, value).toBe(`?panels=${value}`)
    }
  })

  it('works for the page when storage is blocked: ?panels=1 keeps its place in the address, and nothing else turns the mode on', () => {
    const on = open(bare, `${ORIGIN}${BASE}guides/?panels=1`, blocked)
    expect(apply(on)).toBe(true)
    expect(on.location.search).toBe('?panels=1')
    const off = open(bare, `${ORIGIN}${BASE}guides/?panels=0`, blocked)
    expect(apply(off)).toBe(false)
    expect(off.location.search).toBe('')
    expect(apply(open(bare, `${ORIGIN}${BASE}guides/`, blocked))).toBe(false)
  })

  it('serializes into the page\'s head: the function alone, with no module around it, makes the same choice', () => {
    const storage = memory()
    const win = open(bare, `${ORIGIN}${BASE}guides/?panels=1`, storage)
    const inline = new Function(`return (${applyPanelMode.toString()})`)() as typeof applyPanelMode
    expect(inline(doc(win), MODE_KEY, MODE_PARAM, MODE_ATTRIBUTE)).toBe(true)
    expect(storage.data.get(MODE_KEY)).toBe('1')
  })

  it('turns off from the workspace\'s own address: the page with ?panels=0', () => {
    expect(exitUrl(`${ORIGIN}${BASE}reference/x/?a=1#m`, ORIGIN)).toBe(`${BASE}reference/x/?a=1&panels=0#m`)
    const storage = memory()
    storage.data.set(MODE_KEY, '1')
    const win = open(bare, `${ORIGIN}${exitUrl(`${ORIGIN}${BASE}reference/x/`, ORIGIN)}`, storage)
    expect(apply(win)).toBe(false)
  })
})

describe('what loads, and when', () => {
  it('loads the workspace only for a page the mode is on for, once the page is ready, and again after a swap', async () => {
    const win = open('<!doctype html><html><head></head><body></body></html>', `${ORIGIN}${BASE}guides/`)
    const mount = vi.fn()
    const load = vi.fn(async () => ({ mountPanelMode: mount }))
    watchPanelMode(doc(win), load)
    await settle()
    expect(load).not.toHaveBeenCalled()
    // A router swap replaces the root's attributes; the choice is read again, and the page-load that follows mounts.
    win.localStorage.setItem(MODE_KEY, '1')
    fire(win.document, new win.Event('astro:after-swap'))
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(true)
    fire(win.document, new win.Event('astro:page-load'))
    await settle()
    expect(mount).toHaveBeenCalledTimes(1)
  })

  it('leaves a page whose workspace failed to load as it was, with the mode attributes gone', async () => {
    const win = open('<!doctype html><html data-panels data-panels-ready><head></head><body></body></html>')
    watchPanelMode(doc(win), async () => { throw new Error('chunk') })
    await settle()
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(false)
    expect(win.document.documentElement.hasAttribute(READY_ATTRIBUTE)).toBe(false)
  })

  it('changes nothing in a page when the mode is off', async () => {
    const win = open(pageHtml(BODY).replace(' data-panels', ''))
    const before = win.document.documentElement.outerHTML
    const load = vi.fn()
    watchPanelMode(doc(win), load as never)
    fire(win.document, new win.Event('astro:page-load'))
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(win.document.documentElement.outerHTML).toBe(before)
  })

  it('keeps every site rule that mentions the mode behind the attribute, so a page without it matches none of them', () => {
    const rules = parseRules(readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8'))
      .filter((rule) => rule.selectors.some((selector) => /data-panels/.test(selector)))
    expect(rules.length).toBe(2)
    for (const rule of rules) for (const selector of rule.selectors) expect(selector, selector).toMatch(/^html\[data-panels\]/)
  })
})

describe('the workspace', () => {
  function mount(html = pageHtml(BODY), storage: PanelStorage = memory(), url?: string) {
    const win = open(html, url, storage)
    const navigate = vi.fn()
    const handle = mountPanelMode(doc(win), { storage, navigate })!
    return { win, handle, navigate, storage }
  }
  const alt = (win: Window, id: string, key: string) => {
    const head = $(win, `[data-head="${id}"]`)
    head.focus()
    const e = new win.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true })
    fire(head, e)
    return e
  }

  it('lifts the page\'s own article into the main panel, beside the panels the page links to, and stands in for the body and footer', () => {
    const { win, handle } = mount()
    const article = $(win, 'main#content')
    expect($(win, '[data-region="main"] [data-body]').contains(article)).toBe(true)
    expect(article.querySelector('h1')?.textContent).toBe('Capturing output')
    expect(regions(win)).toEqual(['main', 'link:py', 'link:rs'])
    expect(win.document.documentElement.hasAttribute(READY_ATTRIBUTE)).toBe(true)
    // The root sits where the page body was; what the page drew around its article is left in the document, hidden by the stylesheet.
    expect(handle.root.nextElementSibling?.getAttribute('data-pagefind-filter')).toBe('port:Go')
    expect($(win, '[data-region="main"] .pw__title').textContent).toBe('Capturing output')
    expect($(win, '[data-region="main"] .pw__loc').textContent).toBe('guides/capturing-output')
  })

  it('reads an API page\'s linked panels from its "In other ports" rows, and every other page\'s from the language picker', () => {
    const api = mount(pageHtml(BODY + table, 'Pane.Capture'), memory(), `${ORIGIN}${BASE}reference/tmux-pane-capture/`)
    expect(regions(api.win)).toEqual(['main', 'link:py', 'link:rs'])
    expect($(api.win, '[data-region="link:py"] .pw__lede').textContent).toBe('Capture text.')
    expect([...api.win.document.querySelectorAll('[data-region="link:py"] .pw__diff')].map((e) => e.textContent)).toEqual(['3 overloads'])
    const guide = mount(pageHtml(BODY))
    expect(regions(guide.win)).toEqual(['main', 'link:py', 'link:rs'])
    expect($(guide.win, '[data-region="link:rs"] .pw__loc').textContent).toBe('pane::Pane::capture')
  })

  it('moves a panel with Alt and an arrow key, keeps the layout for the browser, and finds it again on the next page and visit', () => {
    const storage = memory()
    const first = mount(undefined, storage)
    expect(storage.data.has(LAYOUT_KEY)).toBe(false)
    expect(alt(first.win, 'main', 'ArrowRight').defaultPrevented).toBe(true)
    expect(regions(first.win)).toEqual(['link:py', 'main', 'link:rs'])
    expect(leaves(parseLayout(JSON.parse(storage.data.get(LAYOUT_KEY)!))!.tree)).toEqual(['link:py', 'main', 'link:rs'])
    first.handle.destroy()
    expect(regions(mount(undefined, storage).win)).toEqual(['link:py', 'main', 'link:rs'])
  })

  it('remembers a panel the reader closed, lists it under Panels, and brings it back from there', () => {
    const storage = memory()
    const first = mount(undefined, storage)
    click(first.win, $(first.win, '[data-act="close:link:rs"]'))
    expect(regions(first.win)).toEqual(['main', 'link:py'])
    expect($(first.win, '[data-panels-summary]').textContent).toBe('Panels (2 closed)')
    expect(parseLayout(JSON.parse(storage.data.get(LAYOUT_KEY)!))!.closed).toEqual(['link:rs'])
    const second = mount(undefined, storage)
    expect(regions(second.win)).toEqual(['main', 'link:py'])
    click(second.win, $(second.win, '[data-act="toggle:link:rs"]'))
    // It opens beside the active panel, which is the page.
    expect(regions(second.win)).toEqual(['main', 'link:rs', 'link:py'])
  })

  it('resets to the page\'s own layout: the saved arrangement is forgotten, every closed panel returns, and the next visit starts there', () => {
    const storage = memory()
    const w = mount(undefined, storage)
    alt(w.win, 'main', 'ArrowRight')
    click(w.win, $(w.win, '[data-act="close:link:rs"]'))
    expect(storage.data.has(LAYOUT_KEY)).toBe(true)
    click(w.win, $(w.win, '[data-act="reset"]'))
    expect(regions(w.win)).toEqual(['main', 'link:py', 'link:rs'])
    expect($(w.win, '[data-live]').textContent).toBe('Layout reset')
    expect(storage.data.has(LAYOUT_KEY)).toBe(false)
    expect(regions(mount(undefined, storage).win)).toEqual(['main', 'link:py', 'link:rs'])
  })

  it('replaces the saved arrangement with the default where storage cannot forget it', () => {
    const data = new Map<string, string>()
    const noRemove = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const w = mount(undefined, noRemove)
    alt(w.win, 'main', 'ArrowRight')
    click(w.win, $(w.win, '[data-act="reset"]'))
    expect(leaves(parseLayout(JSON.parse(data.get(LAYOUT_KEY)!))!.tree)).toEqual(['main', 'link:py', 'link:rs'])
  })

  it('works for the visit when storage throws, and starts from the default for a saved layout that is not whole', () => {
    const w = mount(undefined, blocked)
    expect(alt(w.win, 'main', 'ArrowRight').defaultPrevented).toBe(true)
    expect(regions(w.win)).toEqual(['link:py', 'main', 'link:rs'])
    click(w.win, $(w.win, '[data-act="reset"]'))
    expect(regions(w.win)).toEqual(['main', 'link:py', 'link:rs'])
    const bad = memory()
    for (const value of ['{nope', JSON.stringify({ v: 1, tree: { p: 'ghost' }, closed: [] }), JSON.stringify({ v: 9 })]) {
      bad.data.set(LAYOUT_KEY, value)
      expect(regions(mount(undefined, bad).win), value).toEqual(['main', 'link:py', 'link:rs'])
    }
  })

  it('leaves the workspace for the page itself, with the mode off, from Exit panels', () => {
    const { navigate } = (() => { const w = mount(); click(w.win, $(w.win, '[data-act="exit"]')); return w })()
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate.mock.calls[0]![0]).toBe(`${BASE}guides/capturing-output/?panels=0`)
  })

  it('leaves a page without an article as it was, and the mode attribute off for it', () => {
    const win = open('<!doctype html><html data-panels><head></head><body><div data-pagefind-filter="port:Go"><p>No main here.</p></div></body></html>')
    expect(mountPanelMode(doc(win), { storage: memory() })).toBeUndefined()
    expect(win.document.documentElement.hasAttribute(MODE_ATTRIBUTE)).toBe(false)
    expect(win.document.querySelector('[data-panels-root]')).toBeNull()
  })

  it('mounts once however often the router asks', () => {
    const w = mount()
    expect(mountPanelMode(doc(w.win), { storage: memory() })).toBeUndefined()
    expect(w.win.document.querySelectorAll('[data-panels-root]').length).toBe(1)
  })
})

describe('links in a panel', () => {
  const fetched = (title: string, body: string) => `<!doctype html><html data-shell-base="${BASE}"><head><title>${title} | Go</title></head><body>
    <div class="context">${picker.replaceAll('capturing-output', 'topics')}</div><div data-pagefind-filter="port:Go"><main id="content"><h1>${title}</h1>${body}</main></div></body></html>`

  function mount(respond: (url: string) => Promise<{ ok: boolean; status?: number; text(): Promise<string> }>) {
    const win = open(pageHtml(BODY))
    const fetchStub = vi.fn((url: string) => respond(url))
    Object.assign(win, { fetch: fetchStub })
    const handle = mountPanelMode(doc(win), { storage: memory(), navigate: vi.fn() })!
    return { win, handle, fetchStub }
  }
  const page = (html: string) => async () => ({ ok: true, text: async () => html })

  it('opens a page of this tree in the panel: it fetches the normal page and lifts its article, and the address follows', async () => {
    const { win, fetchStub } = mount(page(fetched('Topics', '<p>The topics.</p>')))
    const event = click(win, $(win, '#topics'))
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(fetchStub.mock.calls[0]![0]).toBe(`${BASE}topics/`)
    expect($(win, '[data-region="main"] h1').textContent).toBe('Topics')
    expect($(win, '[data-region="main"] .pw__title').textContent).toBe('Topics')
    expect($(win, '[data-region="main"] .pw__loc').textContent).toBe('topics')
    expect(win.location.pathname).toBe(`${BASE}topics/`)
    expect(win.document.title).toBe('Topics | Go')
    expect(win.document.querySelectorAll('main#content').length).toBe(1)
  })

  it('has the linked panels follow the page it opened', async () => {
    const { win } = mount(page(fetched('Topics', '<p>The topics.</p>')))
    click(win, $(win, '#topics'))
    await settle()
    expect(regions(win)).toEqual(['main', 'link:py', 'link:rs'])
    expect($(win, '[data-region="link:py"] a[data-panel-load]').getAttribute('href')).toBe('/en/py/v0.46.2/guides/topics/')
  })

  it('leaves the panel as it was, with a note that links to the page, when the page does not load', async () => {
    const { win } = mount(async () => ({ ok: false, status: 404, text: async () => '' }))
    click(win, $(win, '#topics'))
    await settle()
    expect($(win, '[data-region="main"] h1').textContent).toBe('Capturing output')
    expect($(win, '[data-region="main"] .pw__why a').getAttribute('href')).toBe(`${BASE}topics/`)
    expect($(win, '[data-region="main"]').hasAttribute('aria-busy')).toBe(false)
  })

  it('leaves a link to another site, another tree, or a file to the browser, and scrolls to a fragment inside its own panel', () => {
    const { win, fetchStub } = mount(page(''))
    const target = $(win, '#setup')
    const scrolled = vi.fn()
    Object.assign(target, { scrollIntoView: scrolled })
    expect(click(win, $(win, '#out')).defaultPrevented).toBe(false)
    expect(click(win, $(win, '#other')).defaultPrevented).toBe(false)
    expect(click(win, $(win, '#hash')).defaultPrevented).toBe(true)
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('opens a link in a panel of its own with Shift, which lasts for the visit and is not kept', async () => {
    const storage = memory()
    const win = open(pageHtml(BODY), undefined, storage)
    Object.assign(win, { fetch: async () => ({ ok: true, text: async () => fetched('Topics', '<p>t</p>') }) })
    mountPanelMode(doc(win), { storage, navigate: vi.fn() })
    click(win, $(win, '#topics'), { shiftKey: true })
    await settle()
    expect(regions(win)).toEqual(['main', 'page:1', 'link:py', 'link:rs'])
    expect($(win, '[data-region="page:1"] h1').textContent).toBe('Topics')
    expect(win.location.pathname).toBe(`${BASE}guides/capturing-output/`)
    click(win, $(win, '[data-act="close:link:rs"]'))
    expect(JSON.stringify(JSON.parse(storage.getItem(LAYOUT_KEY)!))).not.toContain('page:1')
  })

  it('opens a linked panel\'s page in that panel, from any tree of the site', async () => {
    const { win, fetchStub } = mount(page(fetched('Capturing output', '<p>In Python.</p>')))
    click(win, $(win, '[data-region="link:py"] a[data-panel-load]'))
    await settle()
    expect(fetchStub.mock.calls[0]![0]).toBe('/en/py/v0.46.2/guides/capturing-output/')
    expect($(win, '[data-region="link:py"] [data-body] main#content p').textContent).toBe('In Python.')
    expect($(win, '[data-region="main"] h1').textContent).toBe('Capturing output')
    expect(win.location.pathname).toBe(`${BASE}guides/capturing-output/`)
  })
})

describe('what a page offers beside itself', () => {
  it('reads the rows of an "In other ports" table, in its order, with what the table says and without the page\'s own row', () => {
    const win = new Window()
    win.document.write(`<body>${table}</body>`)
    const { current, groups } = readEquivalents(win.document as unknown as ParentNode)
    expect(current).toBe('go')
    expect(groups[0]!.label).toBe('Read a pane')
    expect(groups[0]!.rows.map((r) => [r.port, r.qualifiedName, r.href, r.kind, r.summary, r.chips, r.note])).toEqual([
      ['go', 'tmux.Pane.Capture', undefined, undefined, undefined, [], undefined],
      ['py', 'libtmux.Pane.capture_pane', '/en/py/v0.46.2/reference/libtmux-pane-capture_pane/', 'method', 'Capture text.', ['3 overloads'], 'Returns a list.'],
      ['rs', 'pane.Pane.capture', '/en/rs/latest/reference/pane-capture/', undefined, undefined, [], undefined],
    ])
    expect(readLinked(win.document as unknown as ParentNode, 'x').map((p) => p.id)).toEqual(['link:py', 'link:rs'])
  })

  it('reads the language picker\'s links, with the symbol and differences a row carries, and skips a port with no matching page', () => {
    const win = new Window()
    win.document.write(`<body>${picker}</body>`)
    const { current, pages } = readPagePorts(win.document as unknown as ParentNode)
    expect(current).toBe('go')
    expect(pages.map((p) => p.port)).toEqual(['go', 'py', 'rs', 'ts'])
    expect(pages.find((p) => p.port === 'rs')!.links).toEqual([{ href: '/en/rs/latest/guides/capturing-output/', api: 'pane::Pane::capture', differences: ['async', 'owned'] }])
    expect(readLinked(win.document as unknown as ParentNode, 'Capturing output').map((p) => [p.id, p.entries[0]!.label])).toEqual([
      ['link:py', 'Capturing output'], ['link:rs', 'Capturing output'], ['link:ts', 'Capturing output'],
    ])
  })

  it('offers nothing on a page with neither', () => {
    const win = new Window()
    win.document.write('<body><main id="content"></main></body>')
    expect(readLinked(win.document as unknown as ParentNode, 't')).toEqual([])
  })
})

describe('which links stay in the workspace', () => {
  const here = `${BASE}guides/a/`

  it('keeps a page of this tree, takes a page of any tree of the site when asked, and leaves the rest to the browser', () => {
    expect(panelHref(`${ORIGIN}${BASE}reference/b/#m`, ORIGIN, BASE, here)).toBe(`${BASE}reference/b/#m`)
    expect(panelHref('/en/py/latest/reference/b/', ORIGIN, BASE, here)).toBeUndefined()
    expect(panelHref('/en/py/latest/reference/b/', ORIGIN, BASE, here, 'origin')).toBe('/en/py/latest/reference/b/')
    for (const href of ['http://other.test/en/go/latest/x/', `${BASE}reference/b.md`, `${BASE}reference/b`, `${here}#top`]) {
      expect(panelHref(href, ORIGIN, BASE, here, 'origin'), href).toBeUndefined()
    }
  })

  it('never carries the mode\'s own parameter into a page it fetches', () => {
    expect(panelHref(`${BASE}reference/b/?panels=1&x=2`, ORIGIN, BASE, here)).toBe(`${BASE}reference/b/?x=2`)
  })

  it('names a page by its place below its tree, for the readout in a panel header', () => {
    expect(pagePath(`${BASE}reference/tmux-pane-capture/`, BASE)).toBe('reference/tmux-pane-capture')
    expect(pagePath(BASE, BASE)).toBe('index')
  })
})
