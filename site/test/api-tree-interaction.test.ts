import { type HTMLButtonElement, type HTMLElement, type HTMLInputElement, Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApiTreeJson } from '../src/lib/api-search'
import { initializeApiTree } from '../src/components/api/api-tree-state'
import { markClass } from '../src/lib/api-labels'

let win: Window
afterEach(async () => {
  await win?.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function navigation(options: { json?: ApiTreeJson; base?: string; search?: boolean } = {}) {
  const base = options.base ?? '/en/tmux/3.7c/reference/'
  win = new Window({ url: `https://libtmux.org${base}entry/` })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('location', win.location)
  const matchMedia = win.matchMedia.bind(win)
  vi.spyOn(win, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query)
    Object.defineProperty(media, 'matches', { value: query === '(prefers-reduced-motion: reduce)' })
    return media
  })
  const json: ApiTreeJson = options.json ?? {
    port: 'tmux',
    buckets: [{ id: 'args', label: 'Arguments', count: 1, slug: 'args-entry', children: [],
      types: [{ id: 'c:args_entry', name: 'args_entry', slug: 'args-entry', kind: 'struct', m: 1 }] }],
    members: {
      'c:args_entry': [
        ['entry', 'entry', 'c:args_entry:entry', 'struct'],
        ['value', 'value', 'c:args_entry:value', 'attribute'],
        ['empty', 'empty', 'c:empty', 'union'],
        ['legacy', 'legacy'],
      ],
      'c:args_entry:entry': [['rbe_left', 'rbe-left', 'c:args_entry:entry:rbe_left', 'attribute']],
      'c:empty': [],
    },
  }
  const fetch = vi.fn(async () => ({ ok: true, json: async () => json }))
  vi.stubGlobal('fetch', fetch)
  win.document.body.innerHTML = `<div class="api-nav" data-src="${base}tree.json" data-base="${base}">
    ${options.search ? `<input id="api-symbol-search" type="search"><button data-api-search-kind="all">All</button><button data-api-search-kind="types">Types</button><button data-api-search-kind="members">Members</button><p data-api-search-status></p><ul data-api-search-results hidden></ul><button data-api-search-retry hidden>Retry</button>` : ''}
    <ul role="tree"><li role="treeitem" tabindex="0" aria-expanded="false" aria-level="1" data-lazy="bucket:args">
      <div class="api-nav__row"><span class="api-nav__label">Arguments</span></div>
    </li></ul></div>`
  vi.resetModules()
  const { initApiTree, saveApiTreeState } = await import('../src/components/api/api-tree')
  initApiTree()
  const tree = win.document.querySelector<HTMLElement>('[role="tree"]')!
  const bucket = tree.firstElementChild as HTMLElement
  const key = async (item: HTMLElement, name: string) => {
    item.focus()
    item.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(item.hasAttribute('aria-busy')).toBe(false))
  }
  const children = (item: HTMLElement) => [...item.querySelectorAll<HTMLElement>(':scope > [role="group"] > [role="treeitem"], :scope > [role="group"] > [role="none"] > [role="treeitem"]')]
  return { tree, bucket, key, children, fetch, initApiTree, saveApiTreeState }
}

it('restores expanded branches and scroll after a document swap', async () => {
  const n = await navigation()
  const markup = win.document.body.innerHTML
  await n.key(n.bucket, 'ArrowRight')
  await n.key(n.children(n.bucket)[0], 'ArrowRight')
  n.tree.scrollTop = 240
  n.saveApiTreeState()
  win.document.body.innerHTML = markup
  const tree = win.document.querySelector<HTMLElement>('[role="tree"]')!
  for (const item of tree.querySelectorAll('[aria-expanded]')) item.setAttribute('aria-expanded', 'false')
  n.initApiTree()
  await vi.waitFor(() => expect(tree.scrollTop).toBe(240))
  expect(tree.querySelector('[data-lazy="bucket:args"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(tree.querySelector('[data-lazy="type:c:args_entry"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(n.tree.isConnected).toBe(false)
})

it('restores cached expanded rows synchronously before the module or tree request runs', async () => {
  const n = await navigation()
  const nav = win.document.querySelector<HTMLElement>('.api-nav')!
  nav.dataset.version = 'model-a'
  const markup = win.document.body.innerHTML
  await n.key(n.bucket, 'ArrowRight')
  await n.key(n.children(n.bucket)[0], 'ArrowRight')
  n.tree.scrollTop = 240
  n.saveApiTreeState()
  n.fetch.mockClear()
  win.document.body.innerHTML = markup
  const restored = win.document.querySelector<HTMLElement>('.api-nav')!
  // Exercise the serialized startup script, not an asynchronous initializer.
  win.eval(`(${initializeApiTree.toString()})(document.querySelector('.api-nav'))`)
  const tree = restored.querySelector<HTMLElement>('[role="tree"]')!
  expect(tree.scrollTop).toBe(240)
  expect(tree.querySelector('[data-lazy="bucket:args"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(tree.querySelector('[data-lazy="type:c:args_entry"]')?.getAttribute('aria-expanded')).toBe('true')
  expect(tree.querySelector('a[href="/en/tmux/3.7c/reference/value/"]')?.textContent).toContain('value')
  expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  // A restored mark is classed like a rendered one, so it centres the same way.
  const labels = [...tree.querySelectorAll<HTMLElement>('.api-nav__kind > .api-badge__label')]
  expect(labels.length).toBeGreaterThan(0)
  for (const label of labels) expect(label.dataset.mark, label.textContent ?? '').toBe(markClass(label.textContent ?? ''))
  expect(n.fetch).not.toHaveBeenCalled()
})

it('discards stale cached rows and treats cached labels as text', async () => {
  await navigation()
  const nav = win.document.querySelector<HTMLElement>('.api-nav')!
  nav.dataset.version = 'model-b'
  const key = 'libtmux:api-tree:/en/tmux/3.7c/reference/'
  const value = { top: 0, branches: { 'bucket:args': true }, version: 'model-a',
    groups: { 'bucket:args': [{ label: ['<img src=x onerror=alert(1)>'], href: 'javascript:alert(1)' }] } }
  win.sessionStorage.setItem(key, JSON.stringify(value))
  win.eval(`(${initializeApiTree.toString()})(document.querySelector('.api-nav'))`)
  expect(nav.querySelector('[role="group"]')).toBeNull()
  value.version = 'model-b'
  win.sessionStorage.setItem(key, JSON.stringify(value))
  win.eval(`(${initializeApiTree.toString()})(document.querySelector('.api-nav'))`)
  expect(nav.querySelector('[role="group"]')?.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(nav.querySelector('img, [href^="javascript:"]')).toBeNull()
})

it('keeps dependency destinations in lazy branches and filtered search under a localized preview root', async () => {
  const base = '/pr-138/ja/powershell/latest/reference/'
  const dependencyBase = '/pr-138/ja/csharp/latest/reference/'
  const json: ApiTreeJson = {
    port: 'powershell',
    buckets: [{ id: 'args', label: 'Server', count: 2, slug: 'libtmux-get-tmuxserver', children: [], types: [
      { id: 'LibTmux.Server', name: 'Server (.NET)', symbolName: 'Server', slug: 'libtmux-server', kind: 'class', category: 'types', m: 1 },
      { id: 'LibTmux\\Get-TmuxServer', name: 'Get-TmuxServer', slug: 'libtmux-get-tmuxserver', kind: 'function', category: 'members', m: 0 },
    ] }],
    members: { 'LibTmux.Server': [['Sessions', 'libtmux-server-sessions', 'LibTmux.Server.Sessions', 'property', 'members', '', 'LibTmux.Server.Sessions']] },
    hrefs: { 'LibTmux.Server': `${dependencyBase}libtmux-server/`, 'LibTmux.Server.Sessions': `${dependencyBase}libtmux-server-sessions/` },
  }
  const n = await navigation({ base, json, search: true })
  await n.key(n.bucket, 'ArrowRight')
  const [owner, command] = n.children(n.bucket)
  expect(owner.querySelector('a')?.getAttribute('href')).toBe(`${dependencyBase}libtmux-server/`)
  expect(command.getAttribute('href')).toBe(`${base}libtmux-get-tmuxserver/`)
  await n.key(owner, 'ArrowRight')
  expect(n.children(owner)[0].getAttribute('href')).toBe(`${dependencyBase}libtmux-server-sessions/`)
  const input = win.document.querySelector<HTMLInputElement>('input')!
  input.value = 'Server'
  win.document.querySelector<HTMLButtonElement>('[data-api-search-kind="types"]')!.click()
  await vi.waitFor(() => expect(win.document.querySelectorAll('[data-api-search-results] a')).toHaveLength(1))
  expect(win.document.querySelector('[data-api-search-results] a')?.getAttribute('href')).toBe(`${dependencyBase}libtmux-server/`)
  input.value = 'Server.Sessions'
  win.document.querySelector<HTMLButtonElement>('[data-api-search-kind="members"]')!.click()
  await vi.waitFor(() => expect(win.document.querySelector('[data-api-search-results] a')?.getAttribute('href')).toBe(`${dependencyBase}libtmux-server-sessions/`))
  expect(n.fetch).toHaveBeenCalledExactlyOnceWith(`${base}tree.json`)
})

it('builds a lazy branch once when the reader opens it during restoration', async () => {
  const n = await navigation()
  const originalFetch = n.fetch.getMockImplementation()!
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  n.fetch.mockImplementationOnce(async () => {
    await pending
    return originalFetch()
  })
  win.sessionStorage.setItem('libtmux:api-tree:/en/tmux/3.7c/reference/', JSON.stringify({
    top: 240, branches: { 'bucket:args': true },
  }))
  n.initApiTree()
  expect(n.fetch).toHaveBeenCalledTimes(1)
  const row = n.bucket.querySelector<HTMLElement>('.api-nav__row')!
  row.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }))
  row.click()
  release()
  await vi.waitFor(() => expect(n.bucket.getAttribute('aria-expanded')).toBe('true'))
  expect(n.bucket.querySelectorAll(':scope > [role="group"]')).toHaveLength(1)
  expect(n.children(n.bucket)).toHaveLength(1)
  expect(n.fetch).toHaveBeenCalledTimes(1)
  expect(n.tree.scrollTop).toBe(0)
  row.click()
  expect(n.bucket.getAttribute('aria-expanded')).toBe('false')
})

it('links contextual shortcuts without marking a second current declaration', async () => {
  const json: ApiTreeJson = {
    port: 'julia', members: {},
    buckets: [{ id: 'args', label: 'Server', count: 2, slug: 'entry', children: [], types: [
      { id: 'LibTmux.sessions', name: 'sessions', slug: 'entry', kind: 'function', m: 0, shortcut: true },
      { id: 'LibTmux.sessions', name: 'sessions', slug: 'entry', kind: 'function', m: 0 },
    ] }],
  }
  const n = await navigation({ json, base: '/en/julia/latest/reference/' })
  await n.key(n.bucket, 'ArrowRight')
  const [shortcut, canonical] = n.children(n.bucket)
  expect(shortcut.getAttribute('href')).toBe('/en/julia/latest/reference/entry/')
  expect(shortcut.hasAttribute('aria-current')).toBe(false)
  expect(canonical.getAttribute('aria-current')).toBe('page')
})

it('keeps a visible destination at the saved scroll position', async () => {
  const n = await navigation()
  n.tree.innerHTML = '<li role="none"><a role="treeitem" class="api-nav__row" aria-current="page" href="/entry/">Entry</a></li>'
  Object.defineProperty(n.tree, 'clientHeight', { value: 300 })
  const row = n.tree.querySelector<HTMLElement>('a')!
  vi.spyOn(n.tree, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(0, 100, 100, 300))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, 380 - n.tree.scrollTop, 100, 32))
  n.tree.scrollTop = 240
  n.saveApiTreeState()
  n.tree.scrollTop = 0
  n.initApiTree()
  await vi.waitFor(() => expect(n.tree.scrollTop).toBe(240))
})

it('does not restore a different reference tree and centers within the visible viewport', async () => {
  const n = await navigation()
  n.tree.scrollTop = 240
  n.saveApiTreeState()
  n.tree.closest('.api-nav')!.setAttribute('data-base', '/en/julia/latest/reference/')
  n.tree.innerHTML = '<li role="none"><a role="treeitem" class="api-nav__row" aria-current="page" href="/entry/">Entry</a></li>'
  Object.defineProperty(n.tree, 'clientHeight', { value: 600 })
  Object.defineProperty(win, 'innerHeight', { value: 500 })
  const row = n.tree.querySelector<HTMLElement>('a')!
  vi.spyOn(n.tree, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(0, 100, 100, 600))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, 1100 - n.tree.scrollTop, 100, 32))
  n.tree.scrollTop = 0
  n.initApiTree()
  expect(n.tree.scrollTop).toBe(816)
  expect(row.getBoundingClientRect().top).toBe(284)
})

it('centers an offscreen active row on initialization without moving document focus', async () => {
  const n = await navigation()
  n.tree.innerHTML = '<li role="none"><a role="treeitem" class="api-nav__row" aria-current="page" href="/entry/">Entry</a></li>'
  Object.defineProperty(n.tree, 'clientHeight', { value: 300 })
  const row = n.tree.querySelector<HTMLElement>('a')!
  vi.spyOn(n.tree, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(0, 100, 100, 300))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, 1100 - n.tree.scrollTop, 100, 32))
  const focused = win.document.activeElement
  n.initApiTree()
  expect(n.tree.scrollTop).toBe(866)
  expect(win.document.activeElement).toBe(focused)
})

it('opens nested member owners through two ancestors with the existing keyboard model', async () => {
  const n = await navigation()
  await n.key(n.bucket, 'ArrowRight')
  const owner = n.children(n.bucket)[0]
  await n.key(n.bucket, 'ArrowRight')
  expect(win.document.activeElement).toBe(owner)
  await n.key(owner, 'ArrowRight')
  const nested = n.children(owner)[0]
  expect(nested.getAttribute('data-lazy')).toBe('type:c:args_entry:entry')
  expect(nested.getAttribute('aria-expanded')).toBe('false')
  expect(nested.getAttribute('aria-level')).toBe('3')
  expect(nested.getAttribute('aria-posinset')).toBe('1')
  expect(nested.getAttribute('aria-setsize')).toBe('4')
  expect(nested.querySelector('a')?.getAttribute('href')).toBe('/en/tmux/3.7c/reference/entry/')
  expect(nested.querySelector('a')?.getAttribute('aria-current')).toBe('page')
  await n.key(nested, 'ArrowRight')
  const member = n.children(nested)[0]
  expect(member.textContent).toContain('rbe_left')
  expect(member.getAttribute('aria-level')).toBe('4')
  expect(member.getAttribute('href')).toBe('/en/tmux/3.7c/reference/rbe-left/')
  await n.key(nested, 'ArrowRight')
  expect(win.document.activeElement).toBe(member)
  await n.key(member, 'ArrowLeft')
  expect(win.document.activeElement).toBe(nested)
  await n.key(nested, 'ArrowLeft')
  expect(nested.getAttribute('aria-expanded')).toBe('false')
  await n.key(nested, 'ArrowDown')
  expect(win.document.activeElement).toBe(n.children(owner)[1])
  await n.key(nested, 'ArrowRight')
  expect(nested.querySelectorAll(':scope > [role="group"]')).toHaveLength(1)
  expect(n.fetch).toHaveBeenCalledExactlyOnceWith('/en/tmux/3.7c/reference/tree.json')
  expect(n.tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})

it('keeps terminal, empty-owner and legacy members as ordered leaves', async () => {
  const n = await navigation()
  await n.key(n.bucket, 'ArrowRight')
  const owner = n.children(n.bucket)[0]
  await n.key(owner, 'ArrowRight')
  const leaves = n.children(owner).slice(1)
  expect(leaves.map((item) => item.getAttribute('href'))).toEqual([
    '/en/tmux/3.7c/reference/value/', '/en/tmux/3.7c/reference/empty/', '/en/tmux/3.7c/reference/legacy/',
  ])
  for (const leaf of leaves) {
    expect(leaf.tagName).toBe('A')
    expect(leaf.hasAttribute('aria-expanded')).toBe(false)
    await n.key(leaf, 'ArrowRight')
    expect(leaf.querySelector('[role="group"]')).toBeNull()
  }
})


it('keeps empty protocol filters disabled when search initializes and after a page swap', async () => {
  const n = await navigation({ search: true })
  const empty = win.document.createElement('button')
  empty.dataset.apiSearchKind = 'prompts'
  empty.setAttribute('data-api-search-empty', '')
  empty.disabled = true
  win.document.querySelector('.api-nav')!.prepend(empty)
  const markup = win.document.body.innerHTML
  for (const swap of [false, true]) {
    if (swap) win.document.body.innerHTML = markup
    n.initApiTree()
    const unavailable = win.document.querySelector<HTMLButtonElement>('[data-api-search-kind="prompts"]')!
    const all = win.document.querySelector<HTMLButtonElement>('[data-api-search-kind="all"]')!
    expect(unavailable.disabled).toBe(true)
    expect(all.disabled).toBe(false)
    unavailable.click()
    expect(n.fetch).not.toHaveBeenCalled()
    expect(win.document.querySelector('[data-api-search-results]')!.hasAttribute('hidden')).toBe(true)
  }
})
