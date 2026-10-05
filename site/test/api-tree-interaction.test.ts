import { type HTMLElement, Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApiTreeJson } from '../src/lib/api-search'

let win: Window
afterEach(async () => {
  await win?.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function navigation() {
  win = new Window({ url: 'https://libtmux.org/en/tmux/3.7c/reference/entry/' })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.stubGlobal('location', win.location)
  const matchMedia = win.matchMedia.bind(win)
  vi.spyOn(win, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query)
    Object.defineProperty(media, 'matches', { value: query === '(prefers-reduced-motion: reduce)' })
    return media
  })
  const json: ApiTreeJson = {
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
  win.document.body.innerHTML = `<div class="api-nav" data-src="/en/tmux/3.7c/reference/tree.json" data-base="/en/tmux/3.7c/reference/">
    <ul role="tree"><li role="treeitem" tabindex="0" aria-expanded="false" aria-level="1" data-lazy="bucket:args">
      <div class="api-nav__row"><span class="api-nav__label">Arguments</span></div>
    </li></ul></div>`
  vi.resetModules()
  const { initApiTree } = await import('../src/components/api/api-tree')
  initApiTree()
  const tree = win.document.querySelector<HTMLElement>('[role="tree"]')!
  const bucket = tree.firstElementChild as HTMLElement
  const key = async (item: HTMLElement, name: string) => {
    item.focus()
    item.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(item.hasAttribute('aria-busy')).toBe(false))
  }
  const children = (item: HTMLElement) => [...item.querySelectorAll<HTMLElement>(':scope > [role="group"] > [role="treeitem"], :scope > [role="group"] > [role="none"] > [role="treeitem"]')]
  return { tree, bucket, key, children, fetch }
}

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
