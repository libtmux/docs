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
  expect(nav.querySelectorAll('.api-nav__section')).toHaveLength(2)
  for (const row of nav.querySelectorAll('.api-nav__tree .api-nav__row')) {
    expect(row.querySelector(':scope > .api-nav__kind'), row.textContent ?? '').not.toBeNull()
  }
  expect(nav.querySelector('[data-lazy="type:session"]')?.getAttribute('aria-level')).toBe('1')
  expect(nav.querySelector('[data-lazy="type:companion"]')?.getAttribute('aria-level')).toBe('2')
  ;(nav.querySelector('[data-api-collapse]') as HTMLButtonElement).click()
  expect(nav.querySelector('[aria-expanded="true"]')).toBeNull()
  ;(nav.querySelector('[data-api-reveal]') as HTMLButtonElement).click()
  expect(nav.querySelector('[data-lazy="type:companion"]')?.getAttribute('aria-expanded')).toBe('true')
  await setApiSidebar(nav, 'grouped', 'create')
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/pr/42/kotlin/latest/reference/create/')
  expect(nav.querySelector('[data-api-owner-back]')?.textContent).toContain('Session')
  expect(nav.dataset.stateScope).toBe('grouped:companion')
  ;(nav.querySelector('[aria-current="page"]') as HTMLElement).focus()
  await setApiSidebar(nav, 'focus', 'empty')
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
  expect(nav.querySelector('[role="group"] .api-nav__kind')).toBeNull()
  expect(nav.querySelector('[role="group"] [role="treeitem"]')?.getAttribute('aria-description')).toBe('method')
})
