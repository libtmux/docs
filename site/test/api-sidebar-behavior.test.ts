import { Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApiTreeJson } from '../src/lib/api-search'

let win: Window
afterEach(async () => { await win?.happyDOM.abort(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps selection across modes, reveals collapsed ancestry, and switches to an empty owner', async () => {
  win = new Window({ url: 'https://libtmux.org/pr/42/demo/sidebar/' })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, CustomEvent: win.CustomEvent })) vi.stubGlobal(name, value)
  const json: ApiTreeJson = { port: 'sample', buckets: [{ id: 'objects', label: 'Objects', count: 2, slug: 'session', children: [], types: [
    { id: 'session', name: 'Session', slug: 'session', m: 1, kind: 'class', category: 'types' },
    { id: 'empty', name: 'Empty', slug: 'empty', m: 0, kind: 'class', category: 'types' },
  ] }], members: { session: [['Companion', 'companion', 'companion', 'module', 'types']], companion: [['create', 'create', 'create', 'method']] } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => json })))
  win.document.body.innerHTML = `<div class="api-nav" data-base="/pr/42/kotlin/latest/reference/" data-src="/tree.json" data-version="v1" data-presentation="outline" data-symbol="create">
    <select data-api-owner></select><a data-api-owner-back></a><button data-api-reveal>Reveal current</button><button data-api-collapse>Collapse all</button><details data-api-actions><summary>Sidebar actions</summary><button data-api-presentation="outline" role="radio" aria-checked="true">Outline</button><button data-api-presentation="focus" role="radio" aria-checked="false">Focus</button><button data-api-presentation="grouped" role="radio" aria-checked="false">Grouped</button></details><ul class="api-nav__tree" role="tree"></ul></div>`
  vi.resetModules()
  const { initApiTree, setApiSidebar } = await import('../src/components/api/api-tree')
  initApiTree()
  const nav = win.document.querySelector('.api-nav')! as unknown as HTMLElement
  await setApiSidebar(nav, 'outline', 'create')
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain('create')
  expect(nav.querySelector('[data-lazy="bucket:objects"]')?.getAttribute('aria-expanded')).toBe('true')
  for (const row of nav.querySelectorAll('.api-nav__tree [aria-description] > .api-nav__row, .api-nav__leaf[aria-description]')) {
    expect(row.querySelector(':scope > .api-nav__kind'), row.textContent ?? '').not.toBeNull()
  }
  expect(nav.querySelector('[data-lazy="type:session"]')?.getAttribute('aria-level')).toBe('2')
  expect(nav.querySelector('[data-lazy="type:companion"]')?.getAttribute('aria-level')).toBe('3')
  ;(nav.querySelector('[data-api-collapse]') as HTMLButtonElement).click()
  expect(nav.querySelector('[aria-expanded="true"]')).toBeNull()
  ;(nav.querySelector('[data-api-reveal]') as HTMLButtonElement).click()
  expect(nav.querySelector('[data-lazy="type:companion"]')?.getAttribute('aria-expanded')).toBe('true')
  await setApiSidebar(nav, 'grouped', 'create')
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/pr/42/kotlin/latest/reference/create/')
  expect(nav.querySelector('[data-api-owner-back]')?.getAttribute('aria-label')).toBe('Up to Companion')
  expect(nav.querySelector('[data-api-owner-back]')?.getAttribute('href')).toBe('/pr/42/kotlin/latest/reference/companion/')
  expect(nav.dataset.stateScope).toBe('grouped:companion')
  ;(nav.querySelector('[aria-current="page"]') as HTMLElement).focus()
  await setApiSidebar(nav, 'focus', 'empty')
  expect(nav.querySelector('[data-api-owner-back]')?.getAttribute('href')).toBe('/pr/42/kotlin/latest/reference/')
  expect(nav.querySelectorAll('[role="treeitem"]')).toHaveLength(1)
  expect(nav.querySelector('[aria-current="page"] .api-nav__label')?.textContent).toBe('Empty')
  expect(nav.querySelector('[aria-current="page"] .api-nav__count')?.textContent).toBe('0')
  expect(nav.querySelectorAll('.api-nav__tree [tabindex="0"]')).toHaveLength(1)
  expect(nav.querySelector('[aria-current="page"]') === win.document.activeElement as unknown).toBe(true)
  const changed = new Promise((resolve) => nav.addEventListener('api-sidebar:change', resolve, { once: true }))
  ;(nav.querySelector('[data-api-actions]') as HTMLDetailsElement).open = true
  ;(nav.querySelector('[data-api-presentation="grouped"]') as HTMLButtonElement).click()
  expect(win.localStorage.getItem('libtmux:sidebar-presentation')).toBe('grouped')
  await changed
  expect(nav.dataset.presentation).toBe('grouped')
  expect(nav.dataset.symbol).toBe('empty')
  expect(nav.querySelector('[data-api-presentation="grouped"]')?.getAttribute('aria-checked')).toBe('true')
  expect((nav.querySelector('[data-api-actions]') as HTMLDetailsElement).open).toBe(false)
  await setApiSidebar(nav, 'outline', 'create')
  expect(nav.dataset.stateScope).toBe('outline')
  await setApiSidebar(nav, 'outline', 'empty')
  expect(nav.dataset.stateScope).toBe('outline')
  expect(nav.querySelector('[data-lazy="type:session"]')?.getAttribute('aria-expanded')).toBe('true')
  nav.dataset.marks = 'mixed'
  await setApiSidebar(nav, 'grouped', 'create')
  expect(nav.querySelector('[data-lazy="group:companion:method"] .api-nav__kind')).toBeNull()
  expect(nav.querySelector('[data-lazy="group:companion:method"] [role="treeitem"]')?.getAttribute('aria-description')).toBe('method')
  win.localStorage.setItem('libtmux:sidebar-presentation', 'focus')
  const restored = new Promise((resolve) => nav.addEventListener('api-sidebar:change', resolve, { once: true }))
  initApiTree()
  await restored
  expect(nav.dataset.presentation).toBe('focus')
  expect(nav.dataset.symbol).toBe('create')
})

it('follows visible manual sections on scroll without changing the URL', async () => {
  win = new Window({ url: 'https://libtmux.org/en/tmux/latest/manual/#clients' })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, CustomEvent: win.CustomEvent })) vi.stubGlobal(name, value)
  const json: ApiTreeJson = { port: 'tmux', buckets: [{ id: 'manual', label: 'Commands', count: 3, slug: null, children: [], types:
    ['clients', 'options', 'last'].map((id) => ({ id, name: id, slug: '', m: 0, kind: 'section' })),
  }], members: {}, hrefs: { clients: '/en/tmux/latest/manual/#clients', options: '/en/tmux/latest/manual/#options', last: '/en/tmux/latest/manual/#last' } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => json })))
  win.document.body.innerHTML = '<div class="api-nav" data-base="/en/tmux/latest/manual/" data-src="/manual/tree.json" data-presentation="outline" data-symbol="clients"><ul class="api-nav__tree" role="tree"></ul></div><h2 id="clients">Clients</h2><h2 id="options">Options</h2><h2 id="last">Last</h2>'
  Object.defineProperty(win.document.documentElement, 'scrollHeight', { value: 3000 })
  for (const [id, top] of [['clients', 100], ['options', 1200], ['last', 2900]] as const) {
    const element = win.document.getElementById(id)!
    vi.spyOn(element, 'getClientRects').mockReturnValue([new win.DOMRect(0, top, 100, 32)] as never)
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new win.DOMRect(0, top - win.scrollY, 100, 32))
  }
  vi.resetModules()
  const { initApiTree } = await import('../src/components/api/api-tree')
  const nav = win.document.querySelector('.api-nav')!
  const arrived = new Promise((resolve) => nav.addEventListener('api-sidebar:change', resolve, { once: true }))
  initApiTree()
  await arrived
  await win.happyDOM.whenAsyncComplete()
  const scrolled = new Promise((resolve) => nav.addEventListener('api-sidebar:change', resolve, { once: true }))
  win.scrollTo({ top: 1250 })
  win.dispatchEvent(new win.Event('scroll'))
  await scrolled
  expect(nav.getAttribute('data-symbol')).toBe('options')
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/en/tmux/latest/manual/#options')
  expect(win.location.hash).toBe('#clients')
  // At the end of the page the last section is the one being read, though its heading is still below the top.
  const bottom = new Promise((resolve) => nav.addEventListener('api-sidebar:change', resolve, { once: true }))
  win.scrollTo({ top: 3000 - win.innerHeight })
  win.dispatchEvent(new win.Event('scroll'))
  await bottom
  expect(nav.getAttribute('data-symbol')).toBe('last')
})

/** A sidebar mounted as the reference pages do, with the owner picker and Up that Outline shares. */
async function mount(json: ApiTreeJson, url: string, symbol: string, presentation = 'outline') {
  win = new Window({ url })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, CustomEvent: win.CustomEvent })) vi.stubGlobal(name, value)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => json })))
  win.document.body.innerHTML = `<div class="api-nav" data-base="/en/sample/latest/reference/" data-src="/tree.json" data-version="v1" ${presentation ? `data-presentation="${presentation}" ` : ''}data-symbol="${symbol}">
    <div data-api-owner-picker>
      <button type="button" data-api-owner disabled aria-expanded="false"><span data-api-owner-mark></span><span data-api-owner-label>Choose type</span></button>
      <div data-api-owner-popup hidden><input data-api-owner-search role="combobox"><div role="listbox"></div><p data-api-owner-empty hidden></p></div>
    </div>
    <a data-api-owner-back></a><ul class="api-nav__tree" role="tree"></ul></div>`
  vi.resetModules()
  const { initApiTree, setApiSidebar } = await import('../src/components/api/api-tree')
  initApiTree()
  return { nav: win.document.querySelector('.api-nav')! as unknown as HTMLElement, setApiSidebar }
}

const owners: ApiTreeJson = { port: 'sample', ownerLabel: 'type', ownerPlural: 'types', buckets: [{ id: 'objects', label: 'Objects', count: 2, slug: 'session', children: [], types: [
  { id: 'session', name: 'Session', slug: 'session', m: 1, kind: 'class', category: 'types' },
  { id: 'window', name: 'Window', qualifiedName: 'sample.Window', slug: 'window', m: 1, kind: 'class', category: 'types' },
] }], members: {
  session: [['Companion', 'companion', 'companion', 'module', 'types', '', 'sample::Session::Companion', 'Session::Companion'], ['name', 'session-name', 'session-name', 'property']],
  companion: [['create', 'create', 'create', 'method']],
  window: [['title', 'window-title', 'window-title', 'property']],
} }

it('builds the picker options on first use, enables the picker, and lets it filter them', async () => {
  const { nav, setApiSidebar } = await mount(owners, 'https://libtmux.org/en/sample/latest/reference/create/', 'create')
  const trigger = nav.querySelector<HTMLButtonElement>('[data-api-owner]')!
  expect(trigger.disabled).toBe(true)
  expect(nav.querySelectorAll('[role="option"]')).toHaveLength(0)
  await setApiSidebar(nav, 'outline', 'create')
  expect(trigger.disabled).toBe(false)
  const options = [...nav.querySelectorAll<HTMLElement>('[role="option"]')]
  // Ordered by qualified name, each carrying its own identity.
  expect(options.map((option) => option.dataset.ownerId)).toEqual(['companion', 'window', 'session'])
  expect(options.map((option) => option.id)).toEqual(options.map((_, index) => `api-owner-option-${index}`))
  const companion = options.find((option) => option.dataset.ownerId === 'companion')!
  expect(companion.dataset.qualifiedName).toBe('sample::Session::Companion')
  expect(companion.getAttribute('aria-selected')).toBe('true')
  expect(options.filter((option) => option.getAttribute('aria-selected') === 'true')).toEqual([companion])
  expect(companion.querySelector('.api-nav__owner-name')?.firstChild?.textContent).toBe('Companion')
  expect(companion.querySelector('.api-nav__owner-name small')?.textContent).toBe('sample::Session::Companion')
  expect(companion.querySelector('.api-kind-word')?.textContent).toBe('module')
  expect(companion.querySelector('.api-nav__kind')).not.toBeNull()
  // The picker reads the options that arrived after it was wired.
  const search = nav.querySelector<HTMLInputElement>('[data-api-owner-search]')!
  trigger.click()
  search.value = 'window'
  search.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event)
  expect(options.filter((option) => !option.hidden).map((option) => option.dataset.ownerId)).toEqual(['window'])
  // A later selection keeps the options it built.
  await setApiSidebar(nav, 'outline', 'window-title')
  expect(nav.querySelectorAll('[role="option"]')).toHaveLength(3)
  expect(nav.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-owner-id')).toBe('window')
})

it('labels the picker with the owner in the language\'s own spelling', async () => {
  const { nav, setApiSidebar } = await mount(owners, 'https://libtmux.org/en/sample/latest/reference/create/', 'create')
  const label = nav.querySelector('[data-api-owner-label]')!
  await setApiSidebar(nav, 'outline', 'create')
  expect(label.textContent).toBe('Session::Companion')
  await setApiSidebar(nav, 'outline', 'session-name')
  expect(label.textContent).toBe('Session')
  // Without a native spelling the label joins the enclosing owner with a dot.
  const plain = structuredClone(owners)
  plain.members.session![0] = ['Companion', 'companion', 'companion', 'module', 'types']
  const remounted = await mount(plain, 'https://libtmux.org/en/sample/latest/reference/create/', 'create')
  await remounted.setApiSidebar(remounted.nav, 'outline', 'create')
  expect(remounted.nav.querySelector('[data-api-owner-label]')?.textContent).toBe('Session.Companion')
})

it('marks only the declaration as the current page, never the category that links to it', async () => {
  const { nav, setApiSidebar } = await mount(owners, 'https://libtmux.org/en/sample/latest/reference/session/', 'session')
  await setApiSidebar(nav, 'outline', 'session')
  const current = [...nav.querySelectorAll('[aria-current="page"]')]
  expect(current.map((link) => link.getAttribute('href'))).toEqual(['/en/sample/latest/reference/session/'])
  expect(current.map((link) => link.closest('[data-lazy]')?.getAttribute('data-lazy'))).toEqual(['type:session'])
  // The category row links to the same page and must not claim it.
  const bucket = nav.querySelector('[data-lazy="bucket:objects"] > .api-nav__row > a')!
  expect(bucket.getAttribute('href')).toBe('/en/sample/latest/reference/session/')
  expect(bucket.hasAttribute('aria-current')).toBe(false)
  // Rows built later, when a closed category opens, follow the same rule.
  const wide = structuredClone(owners)
  wide.buckets.push({ id: 'more', label: 'More', count: 1, slug: 'other', children: [], types: [
    { id: 'other', name: 'Other', slug: 'other', m: 0, kind: 'class', category: 'types' }] })
  const opened = await mount(wide, 'https://libtmux.org/en/sample/latest/reference/other/', 'other')
  await opened.setApiSidebar(opened.nav, 'outline', 'other')
  ;(opened.nav.querySelector('[data-lazy="bucket:objects"] > .api-nav__row') as HTMLElement).click()
  await vi.waitFor(() => expect(opened.nav.querySelector('[data-lazy="bucket:objects"] > [role="group"]')).not.toBeNull())
  const later = [...opened.nav.querySelectorAll('[aria-current="page"]')]
  expect(later.map((link) => link.matches('.api-nav__leaf') && link.getAttribute('href'))).toEqual(['/en/sample/latest/reference/other/'])
  expect(opened.nav.querySelector('[data-lazy="bucket:more"] > .api-nav__row > a')?.hasAttribute('aria-current')).toBe(false)
  // A tree without layouts has no client selection to correct it, so a row it builds decides for itself.
  const nested: ApiTreeJson = { port: 'sample', members: {}, buckets: [{ id: 'objects', label: 'Objects', count: 2, slug: 'session', types: [
    { id: 'session', name: 'Session', slug: 'session', m: 0, kind: 'class', category: 'types' }], children: [
    { id: 'inner', label: 'Inner', count: 1, slug: 'session', children: [], types: [
      { id: 'inner-type', name: 'InnerType', slug: 'inner-type', m: 0, kind: 'class', category: 'types' }] }] }] }
  const plain = await mount(nested, 'https://libtmux.org/en/sample/latest/reference/session/', 'session', '')
  plain.nav.querySelector('.api-nav__tree')!.innerHTML = '<li role="treeitem" class="api-nav__item" aria-level="1" aria-expanded="false" tabindex="0" data-lazy="bucket:objects"><div class="api-nav__row"><span class="api-nav__chevron"></span><span class="api-nav__label">Objects</span></div></li>'
  ;(plain.nav.querySelector('[data-lazy="bucket:objects"] > .api-nav__row') as HTMLElement).click()
  await vi.waitFor(() => expect(plain.nav.querySelector('[data-lazy="bucket:objects"] > [role="group"]')).not.toBeNull())
  const inner = plain.nav.querySelector('[data-lazy="bucket:inner"] > .api-nav__row > a')!
  expect(inner.getAttribute('href')).toBe('/en/sample/latest/reference/session/')
  expect(inner.hasAttribute('aria-current')).toBe(false)
  expect([...plain.nav.querySelectorAll('[aria-current="page"]')].map((link) => link.matches('.api-nav__leaf'))).toEqual([true])
})

it('opens the members a window folded away in place, one level in', async () => {
  const members = Array.from({ length: 200 }, (_, i): [string, string, string, string] => [`m${i}`, `big-m${i}`, `big.m${i}`, 'method'])
  const big: ApiTreeJson = { port: 'sample', buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'big', children: [], types: [
    { id: 'big', name: 'Big', slug: 'big', m: 1, kind: 'class', category: 'types' }] }], members: { big: members } }
  const { nav, setApiSidebar } = await mount(big, 'https://libtmux.org/en/sample/latest/reference/big-m100/', 'big.m100')
  await setApiSidebar(nav, 'outline', 'big.m100')
  const folded = [...nav.querySelectorAll<HTMLElement>('[data-lazy^="more:"]')]
  expect(folded).toHaveLength(2)
  expect(folded.every((row) => row.getAttribute('aria-expanded') === 'false' && row.getAttribute('aria-level') === '3')).toBe(true)
  const before = nav.querySelectorAll('.api-nav__tree a[href*="big-m"]').length
  expect(before).toBeLessThan(200)
  const last = folded.at(-1)!
  ;(last.querySelector('.api-nav__row') as HTMLElement).click()
  await vi.waitFor(() => expect(last.getAttribute('aria-expanded')).toBe('true'))
  const revealed = [...last.querySelectorAll<HTMLElement>(':scope > [role="group"] a[href]')]
  expect(revealed.map((row) => row.getAttribute('aria-level'))).toEqual(revealed.map(() => '4'))
  expect(revealed.at(-1)?.getAttribute('href')).toBe('/en/sample/latest/reference/big-m199/')
  expect(nav.querySelectorAll('.api-nav__tree a[href*="big-m"]').length).toBe(before + revealed.length)
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
})
