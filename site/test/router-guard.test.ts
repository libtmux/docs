import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardPageNavigation, guardTreeNavigation } from '../src/lib/router-guard'

const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map((win) => win.happyDOM.close())) })

/** A document mounted at `base`, as the router sees it before it prepares a navigation. */
function mounted(base: string) {
  const win = new Window({ url: `https://libtmux.org${base}reference/server/` })
  windows.push(win)
  win.document.documentElement.dataset.shellBase = base
  guardTreeNavigation(win.document as unknown as Document)
  return win
}

/** Run the router's preparation for `to`; `fetched` is the shell base of the page it would fetch. */
async function prepare(win: Window, to: string, fetched: string) {
  const load = vi.fn(async () => {})
  const event = Object.assign(new win.Event('astro:before-preparation', { cancelable: true }), {
    to: new URL(to, win.location.href),
    newDocument: new win.DOMParser().parseFromString(`<html data-shell-base="${fetched}"></html>`, 'text/html'),
    loader: load,
  })
  if (win.document.dispatchEvent(event)) await event.loader()
  return { prevented: event.defaultPrevented, fetched: load.mock.calls.length > 0 }
}

describe('router guard', () => {
  it('lets a page of the same tree swap in', async () => {
    const win = mounted('/en/ts/latest/')
    expect(await prepare(win, '/en/ts/latest/guides/panes/', '/en/ts/latest/')).toEqual({ prevented: false, fetched: true })
  })

  it('sends another tree to the browser without fetching it first', async () => {
    const win = mounted('/en/ts/latest/')
    expect(await prepare(win, '/en/rs/latest/reference/server/', '/en/rs/latest/')).toEqual({ prevented: true, fetched: false })
    expect(await prepare(win, '/en/tmux/manual/', '/en/')).toEqual({ prevented: true, fetched: false })
  })

  it('sends a file to the browser without fetching it first', async () => {
    const win = mounted('/en/ts/latest/')
    for (const file of ['/en/ts/latest/guides/panes.md', '/en/ts/latest/docs.json', '/en/ts/latest/llms.txt']) {
      expect(await prepare(win, file, '/en/ts/latest/'), file).toEqual({ prevented: true, fetched: false })
    }
  })

  it('rejects a page that another tree mounted under this one, once it has been fetched', async () => {
    const win = mounted('/en/')
    expect(await prepare(win, '/en/ts/latest/', '/en/ts/latest/')).toEqual({ prevented: true, fetched: true })
    expect(await prepare(win, '/en/guides/panes/', '/en/')).toEqual({ prevented: false, fetched: true })
  })

  it('judges by the fetched page alone when the build is mounted at the root', async () => {
    const win = mounted('/')
    expect(await prepare(win, '/guides/panes/', '/')).toEqual({ prevented: false, fetched: true })
    expect(await prepare(win, '/other/', '/other/')).toEqual({ prevented: true, fetched: true })
  })
})

describe('page navigation guard', () => {
  /** The home page after its script rewrote the query the router last navigated to. */
  function home() {
    const win = new Window({ url: 'https://libtmux.org/en/?port=fsharp#first' })
    windows.push(win)
    guardPageNavigation(win.document as unknown as Document)
    const router = vi.fn((event: { state: unknown }) => event.state)
    win.addEventListener('popstate', router as never)
    const page = vi.fn()
    win.addEventListener('popstate', page)
    win.history.replaceState(null, '', '/en/?port=go#first')
    return { win, router, page }
  }

  function prepareLink(win: Window, to: string) {
    const event = Object.assign(new win.Event('astro:before-preparation', { cancelable: true }), {
      from: new URL('/en/?port=fsharp#first', win.location.href), to: new URL(to, win.location.href), navigationType: 'push',
    })
    win.document.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('sends a fragment link on this page to the browser, which scrolls without a fetch', () => {
    const { win } = home()
    expect(prepareLink(win, '#second')).toBe(true)
    expect(prepareLink(win, '/en/?port=py#second')).toBe(false)
    expect(prepareLink(win, '/en/?port=go')).toBe(false)
    expect(prepareLink(win, '/en/guides/#second')).toBe(false)
  })

  it('gives a traversal between two of the page\'s entries to its listeners, not the router', () => {
    const { win, router, page } = home()
    const scroll = vi.spyOn(win, 'scrollTo').mockImplementation(() => {})
    win.dispatchEvent(new win.PopStateEvent('popstate', { state: { libtmuxHomeExamples: { errors: true }, scrollX: 0, scrollY: 640 } }))
    expect(router.mock.results.map((result) => result.value)).toEqual([null])
    expect(page).toHaveBeenCalledOnce()
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 640, behavior: 'instant' })
  })

  it('leaves a traversal to another page, and an entry without state, to the router', () => {
    const { win, router, page } = home()
    win.dispatchEvent(new win.PopStateEvent('popstate', { state: null }))
    win.history.replaceState(null, '', '/en/guides/')
    win.dispatchEvent(new win.PopStateEvent('popstate', { state: { index: 2, scrollX: 0, scrollY: 0 } }))
    expect(router.mock.results.map((result) => result.value)).toEqual([null, { index: 2, scrollX: 0, scrollY: 0 }])
    expect(page).toHaveBeenCalledTimes(2)
  })

  it('follows the page a swap brings in', () => {
    const { win, router } = home()
    win.history.replaceState(null, '', '/en/guides/')
    win.document.dispatchEvent(new win.Event('astro:after-swap'))
    win.dispatchEvent(new win.PopStateEvent('popstate', { state: { index: 4, scrollX: 0, scrollY: 0 } }))
    expect(router.mock.results.map((result) => result.value)).toEqual([null])
  })
})
