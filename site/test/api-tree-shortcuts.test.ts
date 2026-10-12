import { type HTMLElement, Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { type ApiTreeSelection, initializeApiTree } from '../src/components/api/api-tree-state'

let win: Window
afterEach(async () => {
  await win?.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Happy DOM intentionally exposes history.state as object | null. */
function shortcutHistoryState(): { libtmuxApiTree: ApiTreeSelection } {
  const state = win.history.state
  expect(state).toHaveProperty('libtmuxApiTree')
  const typed = state as { libtmuxApiTree: ApiTreeSelection }
  const selection = typed.libtmuxApiTree
  expect([selection.base, selection.version, selection.href].every((part) => typeof part === 'string')).toBe(true)
  expect(Array.isArray(selection.path)).toBe(true)
  expect(selection.path.every((part) => typeof part === 'string')).toBe(true)
  expect(typeof selection.top).toBe('number')
  return typed
}

async function fixture(base = '/en/julia/latest/reference/') {
  win = new Window({ url: `https://libtmux.org${base}server/` })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('location', win.location)
  const media = win.matchMedia.bind(win)
  vi.spyOn(win, 'matchMedia').mockImplementation((query) => {
    const value = media(query)
    Object.defineProperty(value, 'matches', { value: query === '(prefers-reduced-motion: reduce)' })
    return value
  })
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      port: 'julia',
      members: {},
      buckets: [
        {
          id: 'server',
          label: 'Server',
          count: 2,
          children: [],
          types: [
            { id: 'Server', name: 'Server', slug: 'server', kind: 'struct', m: 0 },
            { id: 'snapshot', name: 'snapshot', slug: 'snapshot', kind: 'function', m: 0, shortcut: true },
          ],
        },
        {
          id: 'snapshots',
          label: 'Snapshots',
          count: 1,
          children: [],
          types: [{ id: 'snapshot', name: 'snapshot', slug: 'snapshot', kind: 'function', m: 0 }],
        },
      ],
    }),
  }))
  vi.stubGlobal('fetch', fetch)
  const leaf = (slug: string, current = false, shortcut = false) =>
    `<li role="none"><a role="treeitem" class="api-nav__row api-nav__leaf" href="${base}${slug}/" tabindex="${current ? 0 : -1}" ${current ? 'aria-current="page"' : ''} ${shortcut ? 'data-api-shortcut' : ''}><span class="api-nav__label">${slug}</span></a></li>`
  const markup = (
    page: 'server' | 'snapshot',
  ) => `<div class="api-nav" data-base="${base}" data-src="${base}tree.json" data-version="model-v1"><ul role="tree" class="api-nav__tree">
    <li role="treeitem" data-lazy="bucket:server" aria-level="1" aria-expanded="${page === 'server'}" tabindex="-1"><div class="api-nav__row"><span class="api-nav__label">Server</span></div>${page === 'server' ? `<ul role="group">${leaf('server', true)}${leaf('snapshot', false, true)}</ul>` : ''}</li>
    <li role="treeitem" data-lazy="bucket:snapshots" aria-level="1" aria-expanded="${page === 'snapshot'}" tabindex="-1"><div class="api-nav__row"><span class="api-nav__label">Snapshots</span></div>${page === 'snapshot' ? `<ul role="group">${leaf('snapshot', true)}</ul>` : ''}</li>
  </ul></div>`
  win.document.body.innerHTML = markup('server')
  win.history.replaceState({ index: 0, scrollX: 0, scrollY: 0, other: 'preserved' }, '')
  vi.resetModules()
  const runtime = await import('../src/components/api/api-tree')
  runtime.initApiTree()
  const tree = () => win.document.querySelector<HTMLElement>('[role="tree"]')!
  const current = () => [...tree().querySelectorAll('[aria-current="page"]')]
  const inline = () => win.eval(`(${initializeApiTree.toString()})(document.querySelector('.api-nav'))`)
  const swap = (page: 'server' | 'snapshot', link?: HTMLElement, traverse = false) => {
    const next = win.document.implementation.createHTMLDocument()
    next.body.innerHTML = markup(page)
    runtime.saveApiTreeState(
      Object.assign(new win.Event('astro:before-swap'), {
        newDocument: next,
        to: new URL(`${base}${page}/`, win.location.href),
        sourceElement: link,
        navigationType: traverse ? 'traverse' : 'push',
      }) as unknown as Event,
    )
    if (!traverse) win.history.pushState({ index: 1, scrollX: 0, scrollY: 0, other: 'next' }, '', `${base}${page}/`)
    win.document.body.innerHTML = next.body.innerHTML
    inline()
    runtime.initApiTree()
  }
  return { base, markup, runtime, fetch, tree, current, inline, swap }
}

it('retains a clicked shortcut before paint, with one current row and unchanged canonical href', async () => {
  const f = await fixture()
  const link = f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!
  f.tree().scrollTop = 73
  f.swap('snapshot', link)
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].closest('[data-lazy]')?.getAttribute('data-lazy')).toBe('bucket:server')
  expect(f.current()[0].getAttribute('href')).toBe(`${f.base}snapshot/`)
  expect(f.tree().querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
  expect(f.tree().scrollTop).toBe(73)
  expect(win.location.pathname).toBe(`${f.base}snapshot/`)
  expect(win.history.state).toMatchObject({
    index: 1,
    other: 'next',
    libtmuxApiTree: { base: f.base, path: ['bucket:server'], top: 73 },
  })
  expect(f.fetch).not.toHaveBeenCalled()
})

it('retains the shortcut and reading position on reload and indexed Back/Forward', async () => {
  const f = await fixture()
  const serverState = win.history.state
  f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
  await vi.waitFor(() => expect(win.document.querySelector('.api-nav')?.hasAttribute('data-restoring')).toBe(false))
  f.tree().scrollTop = 119
  f.tree().dispatchEvent(new win.Event('scroll'))
  const snapshotState = shortcutHistoryState()
  expect(snapshotState.libtmuxApiTree.top).toBe(119)
  win.document.body.innerHTML = f.markup('snapshot')
  f.inline()
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true)
  expect(f.tree().scrollTop).toBe(119)
  win.history.replaceState(serverState, '', `${f.base}server/`)
  f.swap('server', undefined, true)
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].getAttribute('href')).toBe(`${f.base}server/`)
  win.history.replaceState(snapshotState, '', `${f.base}snapshot/`)
  f.swap('snapshot', undefined, true)
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true)
  expect(f.tree().scrollTop).toBe(119)
})

it('retains a branch shortcut activated through the tree keyboard model', async () => {
  const f = await fixture()
  const original = f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!
  original.parentElement!.outerHTML = `<li role="treeitem" data-lazy="type:snapshot" aria-level="2" aria-expanded="false" tabindex="-1"><div class="api-nav__row"><a class="api-nav__label" data-api-shortcut href="${f.base}snapshot/" tabindex="-1">snapshot</a></div></li>`
  const branch = f.tree().querySelector<HTMLElement>('[data-lazy="type:snapshot"]')!
  win.document.addEventListener(
    'click',
    (event) => {
      event.preventDefault()
      f.swap('snapshot', event.target as HTMLElement)
    },
    { once: true },
  )
  branch.focus()
  branch.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true)
  expect(shortcutHistoryState().libtmuxApiTree.path).toEqual(['bucket:server', 'type:snapshot'])
  expect(f.tree().querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1)
})

it('selects canonical rows for a new direct visit or an ordinary canonical link', async () => {
  const f = await fixture()
  f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
  win.history.pushState({ index: 2 }, '', `${f.base}snapshot/`)
  win.document.body.innerHTML = f.markup('snapshot')
  f.inline()
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].closest('[data-lazy]')?.getAttribute('data-lazy')).toBe('bucket:snapshots')
  f.swap('snapshot', f.current()[0] as HTMLElement)
  expect(win.history.state).not.toHaveProperty('libtmuxApiTree')
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(false)
})

it.each(['/en/julia/latest/reference/', '/pr-24/ja/julia/v1.2.3/mcp/reference/'])(
  'scopes shortcut context to exact base and renderer version: %s',
  async (base) => {
    const f = await fixture(base)
    f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
    const selection = shortcutHistoryState().libtmuxApiTree
    expect(selection.base).toBe(base)
    for (const override of [
      { version: 'model-v2' },
      { base: '/en/powershell/latest/reference/' },
      { href: `${base}other/` },
    ]) {
      win.history.replaceState({ index: 2, libtmuxApiTree: { ...selection, ...override } }, '')
      win.document.body.innerHTML = f.markup('snapshot')
      f.inline()
      expect(f.current()).toHaveLength(1)
      expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(false)
    }
  },
)

it('loads the selected branch from history when session storage is unavailable', async () => {
  const f = await fixture()
  f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
  vi.spyOn(win.sessionStorage, 'getItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  win.document.body.innerHTML = f.markup('snapshot')
  f.inline()
  f.runtime.initApiTree()
  await vi.waitFor(() => expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true))
  expect(f.current()).toHaveLength(1)
  expect(f.fetch).toHaveBeenCalledOnce()
})

it('reconciles a cached shortcut before the swap module yields or its inline script reruns', async () => {
  const f = await fixture()
  const next = win.document.implementation.createHTMLDocument()
  next.body.innerHTML = f.markup('snapshot')
  f.runtime.saveApiTreeState(
    Object.assign(new win.Event('astro:before-swap'), {
      newDocument: next,
      to: new URL(`${f.base}snapshot/`, win.location.href),
      navigationType: 'push',
      sourceElement: f.tree().querySelector('a[data-api-shortcut]'),
    }) as unknown as Event,
  )
  win.history.pushState({ index: 1 }, '', `${f.base}snapshot/`)
  win.document.body.innerHTML = next.body.innerHTML
  f.runtime.initApiTree()
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true)
  expect(f.fetch).not.toHaveBeenCalled()
})

it('restores lazy shortcuts after a missing row cache and keeps selection unique on later expansion', async () => {
  const f = await fixture()
  f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
  const key = `libtmux:api-tree:${f.base}`
  const saved = JSON.parse(win.sessionStorage.getItem(key)!)
  delete saved.groups
  win.sessionStorage.setItem(key, JSON.stringify(saved))
  win.document.body.innerHTML = f.markup('snapshot')
  f.inline()
  f.runtime.initApiTree()
  await vi.waitFor(() => expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(true))
  expect(f.current()).toHaveLength(1)
  expect(f.fetch).toHaveBeenCalledOnce()
  const bucket = f.tree().querySelector<HTMLElement>('[data-lazy="bucket:snapshots"]')!
  bucket.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  expect(f.current()).toHaveLength(1)
})

it('rejects saved rows from the renderer that did not serialize shortcut identity', async () => {
  const { apiTreeVersion } = await import('../src/lib/api-tree')
  const version = apiTreeVersion({ extractor: 'fixture', symbols: [] }, [])
  const oldVersion = `1:${version.split(':')[1]}`
  const f = await fixture()
  win.history.pushState({ index: 1 }, '', `${f.base}snapshot/`)
  win.document.body.innerHTML = f.markup('snapshot')
  win.document.querySelector<HTMLElement>('.api-nav')!.dataset.version = version
  win.sessionStorage.setItem(
    `libtmux:api-tree:${f.base}`,
    JSON.stringify({
      version: oldVersion,
      top: 0,
      branches: { 'bucket:server': true },
      groups: { 'bucket:server': [{ label: ['old unmarked snapshot'], href: `${f.base}snapshot/`, kind: 'function' }] },
    }),
  )
  f.inline()
  expect(f.tree().textContent).not.toContain('old unmarked snapshot')
  f.runtime.initApiTree()
  await vi.waitFor(() => expect(f.tree().querySelector('a[data-api-shortcut]')).not.toBeNull())
  expect(f.fetch).toHaveBeenCalledOnce()
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].hasAttribute('data-api-shortcut')).toBe(false)
  expect(version).not.toBe(oldVersion)
})

it('keeps the canonical page usable when history or storage is unavailable', async () => {
  const f = await fixture()
  vi.spyOn(win.sessionStorage, 'getItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  vi.spyOn(win.history, 'replaceState').mockImplementation(() => {
    throw new Error('unavailable')
  })
  f.swap('snapshot', f.tree().querySelector<HTMLElement>('a[data-api-shortcut]')!)
  expect(f.current()).toHaveLength(1)
  expect(f.current()[0].getAttribute('href')).toBe(`${f.base}snapshot/`)
})
