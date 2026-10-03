/**
 * The reference tree's behaviour: Fluent UI Tree's keyboard model on Learn's
 * markup, branches loaded from tree.json when first opened, and the phone
 * drawer.
 *
 * Keys, as `@fluentui/react-tree` binds them: Up and Down move between
 * visible rows, Home and End to the first and last, Right opens a branch or
 * steps into it, Left closes one or steps out, Enter follows a row's link,
 * and a printable character moves to the next row starting with it. One row
 * holds the tree's Tab stop.
 */
import { wordBreak } from '../../lib/word-break'
import { kindMark } from '../../lib/api-labels'
import { searchApi, type ApiTreeBucket as JsonBucket, type ApiTreeJson as TreeJson } from '../../lib/api-search'

const ITEM = '[role="treeitem"]'
const EASING = 'cubic-bezier(0.8, 0, 0.2, 1)'
const requests = new Map<string, Promise<TreeJson>>()
let seq = 0
let controller: AbortController | undefined

/** Search the same port inventory used for lazy branches. */
function initSearch(nav: HTMLElement, tree: HTMLElement, signal: AbortSignal) {
  const input = nav.querySelector<HTMLInputElement>('#api-symbol-search')
  const results = nav.querySelector<HTMLElement>('[data-api-search-results]')
  const status = nav.querySelector<HTMLElement>('[data-api-search-status]')
  const retry = nav.querySelector<HTMLButtonElement>('[data-api-search-retry]')
  const filters = [...nav.querySelectorAll<HTMLButtonElement>('[data-api-search-kind]')]
  if (!input || !results || !status) return
  let kind = 'all'
  let generation = 0
  input.disabled = false
  for (const button of filters) button.disabled = false
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as Element
    if (target.closest('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])') ||
        document.querySelector('dialog[open]')) return
    event.preventDefault()
    if (nav.inert) document.querySelector<HTMLButtonElement>('[data-api-nav-toggle]')?.click()
    input.focus({ preventScroll: true })
  }, { signal })
  const render = async () => {
    const ownGeneration = ++generation
    const query = input.value.trim()
    const active = Boolean(query) || kind !== 'all'
    tree.hidden = active
    results.hidden = !active
    results.replaceChildren()
    if (retry) retry.hidden = true
    status.textContent = active ? 'Loading API names…' : ''
    if (!active) return
    try {
      const json = await load(nav.dataset.src ?? '')
      if (signal.aborted || generation !== ownGeneration) return
      const found = searchApi(json, query, kind)
      status.textContent = found.length > 100 ? `Showing 100 of ${found.length} results. Refine your search.`
        : `${found.length} ${found.length === 1 ? 'result' : 'results'}`
      for (const record of found.slice(0, 100)) {
        const li = document.createElement('li')
        const link = document.createElement('a')
        link.href = `${nav.dataset.base}${record.slug}/`
        const name = document.createElement('strong')
        name.textContent = record.name
        const mark = kindBadge(record.kind)
        if (mark) name.prepend(mark, ' ')
        link.setAttribute('aria-description', record.kind)
        const path = document.createElement('small')
        path.textContent = `${record.kind} · ${record.qualifiedName}`
        link.append(name, path)
        li.append(link)
        results.append(li)
      }
    } catch {
      if (generation === ownGeneration && !signal.aborted) {
        status.textContent = 'API names could not load. Try again.'
        if (retry) retry.hidden = false
      }
    }
  }
  input.addEventListener('input', () => void render(), { signal })
  retry?.addEventListener('click', () => void render(), { signal })
  for (const button of filters) button.addEventListener('click', () => {
    kind = button.dataset.apiSearchKind ?? 'all'
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter === button))
    void render()
  }, { signal })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      results.querySelector<HTMLAnchorElement>('a')?.focus()
      event.preventDefault()
    } else if (event.key === 'Escape' && (input.value || kind !== 'all')) {
      event.stopPropagation()
      input.value = ''
      filters[0]?.click()
    }
  }, { signal })
  results.addEventListener('keydown', (event) => {
    const links = [...results.querySelectorAll<HTMLAnchorElement>('a')]
    const current = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (event.key === 'Escape') {
      input.focus()
      return
    }
    const next = event.key === 'ArrowDown' ? current + 1 : event.key === 'ArrowUp' ? current - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    if (next < 0) input.focus()
    else links[Math.min(next, links.length - 1)]?.focus()
  }, { signal })
}

function load(src: string): Promise<TreeJson> {
  let request = requests.get(src)
  if (!request) {
    request = fetch(src).then((response) => {
      if (!response.ok) throw new Error(`${src}: ${response.status}`)
      return response.json() as Promise<TreeJson>
    })
    // A failed request is not cached, so the next expand tries again.
    request.catch(() => requests.delete(src))
    requests.set(src, request)
  }
  return request
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A row is visible when every branch above it is expanded. */
function shown(item: HTMLElement): boolean {
  for (let group = item.parentElement?.closest('[role="group"]'); group; group = group.parentElement?.closest('[role="group"]')) {
    if (group.closest(ITEM)?.getAttribute('aria-expanded') !== 'true') return false
  }
  return true
}

const rows = (tree: HTMLElement) => [...tree.querySelectorAll<HTMLElement>(ITEM)].filter(shown)
const isBranch = (item: HTMLElement) => item.hasAttribute('aria-expanded')
const isOpen = (item: HTMLElement) => item.getAttribute('aria-expanded') === 'true'
const labelOf = (item: HTMLElement) =>
  (item.matches('a') ? item.querySelector('.api-nav__label') : item.querySelector(':scope > .api-nav__row > .api-nav__label'))?.textContent?.trim().toLowerCase() ?? ''

function focusRow(tree: HTMLElement, item: HTMLElement | undefined | null) {
  if (!item) return
  const previous = tree.querySelector<HTMLElement>(`${ITEM}[tabindex="0"]`)
  if (previous && previous !== item) previous.tabIndex = -1
  item.tabIndex = 0
  item.focus({ preventScroll: true })
  // The tree scrolls, never the page: scrollIntoView would move every
  // scrolling ancestor, the document included.
  const row = (item.matches('a') ? item : item.querySelector<HTMLElement>(':scope > .api-nav__row'))?.getBoundingClientRect()
  const box = tree.getBoundingClientRect()
  if (!row) return
  if (row.top < box.top) tree.scrollTop -= box.top - row.top
  else if (row.bottom > box.bottom) tree.scrollTop += row.bottom - box.bottom
}

function label(name: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'api-nav__label'
  wordBreak(name).forEach((part, i) => {
    if (i > 0) span.append(document.createElement('wbr'))
    span.append(part)
  })
  return span
}

function kindBadge(kind?: string): HTMLSpanElement | undefined {
  const mark = kind && kindMark(kind)
  if (!mark) return undefined
  const badge = document.createElement('span')
  badge.className = `api-nav__kind api-badge--kind-${kind}`
  badge.title = kind!
  badge.setAttribute('aria-hidden', 'true')
  badge.textContent = mark
  return badge
}

function leaf(name: string, href: string, level: number, kind?: string): HTMLLIElement {
  const li = document.createElement('li')
  li.setAttribute('role', 'none')
  const a = document.createElement('a')
  a.setAttribute('role', 'treeitem')
  a.className = 'api-nav__row api-nav__leaf'
  a.href = href
  a.tabIndex = -1
  a.style.setProperty('--level', String(level))
  a.setAttribute('aria-level', String(level))
  if (kind) a.setAttribute('aria-description', kind)
  if (new URL(href, location.href).pathname === location.pathname) a.setAttribute('aria-current', 'page')
  const mark = kindBadge(kind)
  if (mark) a.append(mark)
  a.append(label(name))
  li.append(a)
  return li
}

function branch(name: string, href: string | undefined, level: number, lazy: string, count?: number, kind?: string): HTMLLIElement {
  const id = `api-nav-c${++seq}`
  const li = document.createElement('li')
  li.setAttribute('role', 'treeitem')
  li.className = 'api-nav__item'
  li.tabIndex = -1
  li.dataset.lazy = lazy
  li.setAttribute('aria-level', String(level))
  if (kind) li.setAttribute('aria-description', kind)
  li.setAttribute('aria-expanded', 'false')
  li.setAttribute('aria-labelledby', count === undefined ? id : `${id} ${id}-count`)
  const row = document.createElement('div')
  row.className = 'api-nav__row'
  row.style.setProperty('--level', String(level))
  const chevron = document.createElement('span')
  chevron.className = 'api-nav__chevron'
  chevron.setAttribute('aria-hidden', 'true')
  row.append(chevron)
  const mark = kindBadge(kind)
  if (mark) row.append(mark)
  if (href) {
    const a = document.createElement('a')
    a.className = 'api-nav__label'
    a.id = id
    a.href = href
    a.tabIndex = -1
    wordBreak(name).forEach((part, i) => {
      if (i > 0) a.append(document.createElement('wbr'))
      a.append(part)
    })
    row.append(a)
  } else {
    const span = label(name)
    span.id = id
    row.append(span)
  }
  if (count !== undefined) {
    const badge = document.createElement('span')
    badge.className = 'api-nav__count'
    badge.id = `${id}-count`
    badge.textContent = String(count)
    row.append(badge)
  }
  li.append(row)
  return li
}

function findBucket(buckets: JsonBucket[], id: string): JsonBucket | undefined {
  for (const b of buckets) {
    if (b.id === id) return b
    const child = findBucket(b.children, id)
    if (child) return child
  }
  return undefined
}

async function build(nav: HTMLElement, item: HTMLElement): Promise<HTMLElement | undefined> {
  const json = await load(nav.dataset.src ?? '')
  const base = nav.dataset.base ?? '/'
  const [kind, ...rest] = (item.dataset.lazy ?? '').split(':')
  const id = rest.join(':')
  const level = Number(item.getAttribute('aria-level')) + 1
  const children: HTMLLIElement[] = []
  if (kind === 'bucket') {
    const bucket = findBucket(json.buckets, id)
    if (!bucket) return undefined
    for (const t of bucket.types) {
      children.push(t.m ? branch(t.name, `${base}${t.slug}/`, level, `type:${t.id}`, undefined, t.kind) : leaf(t.name, `${base}${t.slug}/`, level, t.kind))
    }
    for (const c of bucket.children) {
      children.push(branch(c.label, c.slug ? `${base}${c.slug}/` : undefined, level, `bucket:${c.id}`, c.types.length))
    }
  } else {
    for (const [name, slug, , kind] of json.members[id] ?? []) children.push(leaf(name, `${base}${slug}/`, level, kind))
  }
  const group = document.createElement('ul')
  group.setAttribute('role', 'group')
  group.className = 'api-nav__group'
  children.forEach((li, i) => {
    const row = li.matches(ITEM) ? li : li.querySelector<HTMLElement>(ITEM)
    row?.setAttribute('aria-setsize', String(children.length))
    row?.setAttribute('aria-posinset', String(i + 1))
    group.append(li)
  })
  item.append(group)
  return group
}

/** Fluent's Collapse: max-height and opacity over 200ms, and none for reduced motion. */
function animate(group: HTMLElement, open: boolean) {
  if (reducedMotion()) {
    delete group.dataset.closing
    return
  }
  const height = `${group.scrollHeight}px`
  group.style.overflow = 'hidden'
  const animation = group.animate(
    open ? [{ maxHeight: '0px', opacity: 0 }, { maxHeight: height, opacity: 1 }] : [{ maxHeight: height, opacity: 1 }, { maxHeight: '0px', opacity: 0 }],
    { duration: 200, easing: EASING },
  )
  const done = () => {
    group.style.overflow = ''
    delete group.dataset.closing
  }
  animation.onfinish = done
  animation.oncancel = done
}

async function toggle(nav: HTMLElement, item: HTMLElement, open: boolean) {
  if (!isBranch(item) || isOpen(item) === open || item.getAttribute('aria-busy') === 'true') return
  let group = item.querySelector<HTMLElement>(':scope > [role="group"]')
  if (open && !group && item.dataset.lazy) {
    item.setAttribute('aria-busy', 'true')
    try {
      group = (await build(nav, item)) ?? null
    } catch {
      group = null
    } finally {
      item.removeAttribute('aria-busy')
    }
    if (!group) return
  }
  if (!open && group) group.dataset.closing = ''
  item.setAttribute('aria-expanded', String(open))
  if (group) animate(group, open)
  // Focus inside a closing branch would be left on a row no one can see.
  if (!open && item.contains(document.activeElement) && document.activeElement !== item) focusRow(item.closest<HTMLElement>('[role="tree"]')!, item)
}

function initTree(nav: HTMLElement, tree: HTMLElement, signal: AbortSignal) {
  tree.addEventListener(
    'keydown',
    (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM)
      if (!item || event.altKey || event.ctrlKey || event.metaKey) return
      const list = rows(tree)
      const index = list.indexOf(item)
      switch (event.key) {
        case 'ArrowDown':
          focusRow(tree, list[index + 1])
          break
        case 'ArrowUp':
          focusRow(tree, list[index - 1])
          break
        case 'Home':
          focusRow(tree, list[0])
          break
        case 'End':
          focusRow(tree, list.at(-1))
          break
        case 'ArrowRight':
          if (!isBranch(item)) return
          if (isOpen(item)) focusRow(tree, item.querySelector<HTMLElement>(`:scope > [role="group"] ${ITEM}`))
          else void toggle(nav, item, true)
          break
        case 'ArrowLeft':
          if (isBranch(item) && isOpen(item)) void toggle(nav, item, false)
          else focusRow(tree, item.parentElement?.closest<HTMLElement>(ITEM))
          break
        case 'Enter': {
          // A leaf is a link, and Enter on a link already follows it.
          if (item.matches('a')) return
          const link = item.querySelector<HTMLAnchorElement>(':scope > .api-nav__row > a')
          if (link) link.click()
          else void toggle(nav, item, !isOpen(item))
          break
        }
        default: {
          if (event.key.length !== 1 || event.key === ' ') return
          const key = event.key.toLowerCase()
          const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)]
          const match = ordered.find((row) => labelOf(row).startsWith(key))
          if (!match) return
          focusRow(tree, match)
        }
      }
      event.preventDefault()
    },
    { signal },
  )

  tree.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement
      if (target.closest('a')) return
      const row = target.closest<HTMLElement>('.api-nav__row')
      const item = row?.parentElement
      if (!item || !isBranch(item)) return
      void toggle(nav, item, !isOpen(item))
      focusRow(tree, item)
    },
    { signal },
  )

  tree.addEventListener(
    'focusin',
    (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM)
      if (!item || item.tabIndex === 0) return
      tree.querySelector<HTMLElement>(`${ITEM}[tabindex="0"]`)?.setAttribute('tabindex', '-1')
      item.tabIndex = 0
    },
    { signal },
  )
}

/** The phone drawer, on the site's drawer conventions: inert when closed, one drawer at a time. */
function initDrawer(nav: HTMLElement, signal: AbortSignal) {
  const toggleButton = document.querySelector<HTMLButtonElement>('[data-api-nav-toggle]')
  const overlay = document.querySelector<HTMLElement>('[data-api-nav-overlay]')
  const closeButton = nav.querySelector<HTMLButtonElement>('[data-api-nav-close]')
  const phone = window.matchMedia('(width < 56rem)')
  document.body.style.overflow = ''

  const layout = () => {
    nav.inert = phone.matches && !nav.hasAttribute('data-open')
    if (phone.matches) {
      nav.setAttribute('role', 'dialog')
      nav.setAttribute('aria-modal', 'true')
    } else {
      nav.removeAttribute('role')
      nav.removeAttribute('aria-modal')
    }
  }

  const setOpen = (open: boolean) => {
    if (open && !phone.matches) return
    const hadFocus = nav.contains(document.activeElement)
    nav.toggleAttribute('data-open', open)
    overlay?.toggleAttribute('data-open', open)
    document.body.style.overflow = open ? 'hidden' : ''
    toggleButton?.setAttribute('aria-expanded', String(open))
    layout()
    if (open) {
      document.dispatchEvent(new CustomEvent('libtmux:drawer-open', { detail: 'api-nav' }))
      const tab = nav.querySelector<HTMLElement>(`${ITEM}[tabindex="0"]`)
      ;(tab ?? closeButton)?.focus({ preventScroll: true })
    } else if (hadFocus) {
      toggleButton?.focus()
    }
  }

  layout()
  toggleButton?.addEventListener('click', () => setOpen(true), { signal })
  closeButton?.addEventListener('click', () => setOpen(false), { signal })
  overlay?.addEventListener('click', () => setOpen(false), { signal })
  document.addEventListener('keydown', (e) => e.key === 'Escape' && nav.hasAttribute('data-open') && setOpen(false), { signal })
  document.addEventListener('libtmux:drawer-open', (e) => (e as CustomEvent).detail !== 'api-nav' && setOpen(false), { signal })
  phone.addEventListener('change', () => setOpen(false), { signal })
}

export function initApiTree() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  // By class: <html> carries data-api-nav as the drawer's pre-paint flag.
  const navs = document.querySelectorAll<HTMLElement>('.api-nav')
  // ClientRouter replaces the html attributes without rerunning the inline
  // pre-paint script. Restore the enhancement before initializing the drawer.
  document.documentElement.toggleAttribute('data-api-nav', navs.length > 0)
  navs.forEach((nav) => {
    const tree = nav.querySelector<HTMLElement>('[role="tree"]')
    if (tree) {
      initTree(nav, tree, signal)
      initSearch(nav, tree, signal)
    }
    initDrawer(nav, signal)
  })
}
