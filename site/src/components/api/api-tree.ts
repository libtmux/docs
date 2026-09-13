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

interface JsonType {
  id: string
  name: string
  slug: string
  m: 0 | 1
}

interface JsonBucket {
  id: string
  label: string
  count: number
  slug: string | null
  types: JsonType[]
  children: JsonBucket[]
}

interface TreeJson {
  port: string
  buckets: JsonBucket[]
  members: Record<string, [string, string][]>
}

const ITEM = '[role="treeitem"]'
const EASING = 'cubic-bezier(0.8, 0, 0.2, 1)'
const requests = new Map<string, Promise<TreeJson>>()
let seq = 0
let controller: AbortController | undefined

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
  (item.matches('a') ? item : item.querySelector(':scope > .api-nav__row > .api-nav__label'))?.textContent?.trim().toLowerCase() ?? ''

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

function leaf(name: string, href: string, level: number): HTMLLIElement {
  const li = document.createElement('li')
  li.setAttribute('role', 'none')
  const a = document.createElement('a')
  a.setAttribute('role', 'treeitem')
  a.className = 'api-nav__row api-nav__leaf'
  a.href = href
  a.tabIndex = -1
  a.style.setProperty('--level', String(level))
  a.setAttribute('aria-level', String(level))
  if (new URL(href, location.href).pathname === location.pathname) a.setAttribute('aria-current', 'page')
  a.append(label(name))
  li.append(a)
  return li
}

function branch(name: string, href: string | undefined, level: number, lazy: string, count?: number): HTMLLIElement {
  const id = `api-nav-c${++seq}`
  const li = document.createElement('li')
  li.setAttribute('role', 'treeitem')
  li.className = 'api-nav__item'
  li.tabIndex = -1
  li.dataset.lazy = lazy
  li.setAttribute('aria-level', String(level))
  li.setAttribute('aria-expanded', 'false')
  li.setAttribute('aria-labelledby', count === undefined ? id : `${id} ${id}-count`)
  const row = document.createElement('div')
  row.className = 'api-nav__row'
  row.style.setProperty('--level', String(level))
  const chevron = document.createElement('span')
  chevron.className = 'api-nav__chevron'
  chevron.setAttribute('aria-hidden', 'true')
  row.append(chevron)
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
      children.push(t.m ? branch(t.name, `${base}${t.slug}/`, level, `type:${t.id}`) : leaf(t.name, `${base}${t.slug}/`, level))
    }
    for (const c of bucket.children) {
      children.push(branch(c.label, c.slug ? `${base}${c.slug}/` : undefined, level, `bucket:${c.id}`, c.types.length))
    }
  } else {
    for (const [name, slug] of json.members[id] ?? []) children.push(leaf(name, `${base}${slug}/`, level))
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
  const phone = window.matchMedia('(width < 64rem)')
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
  document.querySelectorAll<HTMLElement>('.api-nav').forEach((nav) => {
    const tree = nav.querySelector<HTMLElement>('[role="tree"]')
    if (tree) initTree(nav, tree, signal)
    initDrawer(nav, signal)
  })
}
