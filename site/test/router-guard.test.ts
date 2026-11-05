import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guardTreeNavigation } from '../src/lib/router-guard'

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
