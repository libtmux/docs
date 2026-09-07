import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../public/_shell/shell.js', import.meta.url), 'utf8')
const windows: Window[] = []
const base = '/pr-42/en'
const manifest = {
  schema: 1,
  ports: { py: [{ slug: 'latest', label: 'latest', supported: true }] },
  defaultVersion: { ts: 'stable', rs: 'latest' },
}
const pageLinks = {
  schema: 1,
  indexes: { py: `${base}/reference/py/`, ts: `${base}/reference/ts/` },
  symbols: {
    py: {
      'libtmux.Session': [{ port: 'ts', href: `${base}/reference/ts/session-session/`, label: 'Session' }],
      'libtmux.Session.windows': [{ port: 'ts', href: `${base}/reference/ts/session-session-windows/`, label: 'Session windows' }],
    },
  },
}

async function load(path: string, body = '') {
  const window = new Window({ url: `https://libtmux.org${base}/py/latest/${path}` })
  windows.push(window)
  window.document.body.innerHTML = body
  const requests: string[] = []
  window.fetch = (async (url: unknown) => {
    requests.push(String(url))
    return { ok: true, json: async () => String(url).endsWith('versions.json') ? manifest : pageLinks }
  }) as unknown as typeof window.fetch
  window.eval(source)
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  await window.happyDOM.waitUntilComplete()
  return { window, requests, document: window.document }
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()))
})

describe('native API page switchers', () => {
  it('keeps all port homes and manifest requests inside the locale and preview', async () => {
    const { document, requests } = await load('api/libtmux.session/')
    const nav = document.querySelector('nav[aria-label="Language"]')!
    expect(nav.querySelector('[data-port-home="py"]')?.getAttribute('href')).toBe(`${base}/py/latest/`)
    expect(nav.querySelector('[data-port-home="ts"]')?.getAttribute('href')).toBe(`${base}/ts/stable/`)
    expect(nav.querySelector('[data-port-home="rs"]')?.getAttribute('href')).toBe(`${base}/rs/latest/`)
    expect(requests).toEqual([`${base}/versions.json`, `${base}/page-links.json`])
  })

  it('keeps the page equivalents when following an ordinary section heading', async () => {
    const { window, document } = await load('api/api/libtmux.session/', '<section id="sessions"><dt class="sig" id="libtmux.Session">Session</dt></section>')
    window.location.hash = '#sessions'
    window.dispatchEvent(new window.Event('hashchange'))
    expect(document.querySelector('[data-page-port-switcher] a[href$="session-session/"]')).not.toBeNull()
  })

  it('disables counterparts for an unmapped member instead of linking its class', async () => {
    const { window, document } = await load('api/api/libtmux.session/', '<dt class="sig" id="libtmux.Session">Session</dt><dt class="sig" id="libtmux.Session.unmapped">unmapped</dt>')
    window.location.hash = '#libtmux.Session.unmapped'
    window.dispatchEvent(new window.Event('hashchange'))
    const menu = document.querySelector('[data-page-port-switcher]')!
    expect(menu.querySelector('a[href$="session-session/"]')).toBeNull()
    expect(menu.querySelectorAll('[aria-disabled="true"]').length).toBe(7)
  })

  it('updates semantic equivalents when the reader follows a member anchor', async () => {
    const { window, document } = await load('api/libtmux.session/', '<dt class="sig" id="libtmux.Session">Session</dt>')
    window.location.hash = '#libtmux.Session.windows'
    window.dispatchEvent(new window.Event('hashchange'))
    const menu = document.querySelector('[data-page-port-switcher]')!
    expect(menu.querySelector('a[href$="session-session-windows/"]')).not.toBeNull()
    expect(menu.querySelector('a[href$="session-session/"]')).toBeNull()
  })
})
