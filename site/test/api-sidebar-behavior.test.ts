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
    <select data-api-owner></select><a data-api-owner-back></a><button data-api-reveal>Reveal current</button><button data-api-collapse>Collapse all</button><p data-api-owner-status></p><ul class="api-nav__tree" role="tree"></ul></div>`
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
  expect(nav.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  expect(nav.querySelector('[aria-current="page"]') === win.document.activeElement as unknown).toBe(true)
})
