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
import { waitForAppearance, layoutBeforeAppearance } from '../../lib/page-readiness'
import { wordBreak } from '../../lib/word-break'
import { kindMark, markClass } from '../../lib/api-labels'
import { apiTreeHref, searchApi, type ApiTreeBucket as JsonBucket, type ApiTreeJson as TreeJson } from '../../lib/api-search'
import { apiTreePath, captureApiTree, initializeApiTree, type ApiTreeSelection, type ApiTreeState } from './api-tree-state'
import { SIDEBAR_PRESENTATIONS, SIDEBAR_PREFERENCE_KEY, sidebarCatalog, sidebarInventory, sidebarName, sidebarNodes, quietSidebarKinds, type SidebarNode, type SidebarPresentation } from '../../lib/api-sidebar'
import { initApiOwnerPicker } from './api-owner-picker'

const ITEM = '[role="treeitem"]'
const EASING = 'cubic-bezier(0.8, 0, 0.2, 1)'
const requests = new Map<string, Promise<TreeJson>>()
let seq = 0
let controller: AbortController | undefined

const stateKey = (nav: HTMLElement) => `libtmux:api-tree:${nav.dataset.base}${nav.dataset.stateScope ? `:${nav.dataset.stateScope}` : ''}`
const configurations = new WeakMap<HTMLElement, AbortController>()

/** Capture the outgoing tree before Astro replaces it, also for full loads. */
export function saveApiTreeState(event?: Event) {
  for (const nav of document.querySelectorAll<HTMLElement>('.api-nav')) {
    const tree = nav.querySelector<HTMLElement>('[role="tree"]')
    if (!tree || nav.dataset.restoring === 'true') continue
    try { window.sessionStorage.setItem(stateKey(nav), JSON.stringify(captureApiTree(nav, tree))) } catch { /* Storage is optional. */ }
  }
  const transition = event as (Event & { newDocument?: Document; to?: URL; sourceElement?: HTMLElement; navigationType?: string }) | undefined
  if (!transition?.newDocument || !transition.to || transition.navigationType === 'traverse') return
  const link = transition.sourceElement?.closest<HTMLAnchorElement>('.api-nav__tree a[data-api-shortcut]')
  const nav = link?.closest<HTMLElement>('.api-nav')
  const tree = nav?.querySelector<HTMLElement>('[role="tree"]')
  for (const incoming of transition.newDocument.querySelectorAll<HTMLElement>('.api-nav')) {
    const selection: ApiTreeSelection | null = link && nav && tree &&
      incoming.dataset.base === nav.dataset.base && incoming.dataset.version === nav.dataset.version &&
      link.origin === transition.to.origin && link.pathname + link.search === transition.to.pathname + transition.to.search
      ? { base: nav.dataset.base!, version: nav.dataset.version!, href: link.pathname + link.search,
        path: apiTreePath(link, tree), top: tree.scrollTop } : null
    incoming.dataset.apiTreeArrival = JSON.stringify(selection)
  }
}

/** Restore expanded branches before scroll, then reveal the actual destination. */
async function restoreTree(nav: HTMLElement, tree: HTMLElement, signal: AbortSignal) {
  const selection = initializeApiTree(nav, false)
  let saved: ApiTreeState | undefined
  try {
    const value = JSON.parse(window.sessionStorage.getItem(stateKey(nav)) ?? 'null')
    if (Number.isFinite(value?.top) && value.top >= 0 && value.branches && typeof value.branches === 'object') saved = value
  } catch { /* A fresh or storage-restricted page still reveals its current row. */ }
  nav.dataset.restoring = 'true'
  let interacted = nav.dataset.apiTreeInteracted === 'true'
  for (const event of ['wheel', 'pointerdown', 'keydown']) {
    tree.addEventListener(event, () => { interacted = true }, { signal, once: true })
  }
  if (saved || selection) {
    const restore = async (root: HTMLElement) => {
      for (const item of root.querySelectorAll<HTMLElement>(':scope > [role="treeitem"][data-lazy]')) {
        if (signal.aborted || interacted) return
        const current = Boolean(item.querySelector('[aria-current="page"]'))
        const open = current || selection?.path.includes(item.dataset.lazy!) || saved?.branches[item.dataset.lazy!] === true
        let group = item.querySelector<HTMLElement>(':scope > [role="group"]')
        if (open && !group) {
          group = await build(nav, item) ?? null
        }
        if (signal.aborted || interacted) return
        if (group || !open) item.setAttribute('aria-expanded', String(open))
        if (group && open) await restore(group)
      }
    }
    await restore(tree)
  }
  if (signal.aborted || !tree.isConnected) return
  initializeApiTree(nav, false)
  const currentShortcut = tree.querySelector<HTMLElement>('a[data-api-shortcut][aria-current="page"]')
  const selectedTop = currentShortcut && selection && JSON.stringify(apiTreePath(currentShortcut, tree)) === JSON.stringify(selection.path)
    ? selection.top : undefined
  if (!interacted && (selectedTop !== undefined || saved)) tree.scrollTop = selectedTop ?? saved!.top
  const reveal = () => {
    if (signal.aborted || !tree.isConnected || interacted) return
    const current = tree.querySelector<HTMLElement>('[aria-current="page"]')
    const row = current?.closest<HTMLElement>('.api-nav__row') ?? current
    if (!row || !tree.clientHeight) return
    for (let owner = row.closest<HTMLElement>('[aria-expanded]'); owner; owner = owner.parentElement?.closest<HTMLElement>('[aria-expanded]') ?? null) {
      owner.setAttribute('aria-expanded', 'true')
    }
    const box = tree.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight)
    // Keep a visible selection in place. A new/deep destination is centered
    // within the tree, without scrolling the document or changing focus.
    if ((!saved && selectedTop === undefined) || rect.top < box.top || rect.bottom > bottom) {
      tree.scrollTop += rect.top - box.top - (bottom - box.top - rect.height) / 2
    }
  }
  reveal()
  layoutBeforeAppearance(reveal)
  delete nav.dataset.restoring
}

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
  for (const button of filters) button.disabled = button.hasAttribute('data-api-search-empty')
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
      // A result set of one kind needs no mark in a tree whose groups name their kind: the filter or the query already did.
      const quiet = nav.dataset.marks === 'mixed' && new Set(found.map((record) => record.kind)).size <= 1
      for (const record of found.slice(0, 100)) {
        const li = document.createElement('li')
        const link = document.createElement('a')
        link.href = apiTreeHref(nav.dataset.base ?? '/', record, json.hrefs)
        const name = document.createElement('strong')
        name.textContent = nav.dataset.presentation ? sidebarName(record.name, json.port) : record.name
        const mark = quiet ? undefined : kindBadge(record.kind)
        if (mark) name.prepend(mark, ' ')
        // The word trails the name: a result is a menu row, and a menu cannot be hovered for it.
        if (!quiet) {
          const word = document.createElement('span')
          word.className = 'api-kind-word'
          word.textContent = record.kind.replace(/-/g, ' ')
          name.append(word)
        }
        link.setAttribute('aria-description', record.kind)
        const path = document.createElement('small')
        path.textContent = nav.dataset.presentation ? sidebarName(record.qualifiedName, json.port) : record.qualifiedName
        link.append(name, path)
        li.append(link)
        results.append(li)
      }
      // The tree is hidden while searching, so the glossary stays reachable as the last result.
      if (nav.dataset.glossaryHref) {
        const li = document.createElement('li')
        const link = document.createElement('a')
        link.href = nav.dataset.glossaryHref
        link.dataset.apiGlossary = ''
        link.textContent = nav.dataset.glossaryLabel ?? ''
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
  nav.addEventListener('api-sidebar:clear-search', () => {
    input.value = ''
    filters[0]?.click()
  }, { signal })
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
  const label = document.createElement('span')
  label.className = 'api-badge__label'
  label.textContent = mark
  label.dataset.mark = markClass(mark)
  badge.append(label)
  return badge
}

function leaf(name: string, href: string, level: number, kind?: string, shortcut = false, quiet = false): HTMLLIElement {
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
  if (shortcut) a.setAttribute('data-api-shortcut', '')
  if (!shortcut && new URL(href, location.href).pathname === location.pathname) a.setAttribute('aria-current', 'page')
  const mark = quiet ? undefined : kindBadge(kind)
  if (mark) a.append(mark)
  a.append(label(name))
  li.append(a)
  return li
}

function branch(name: string, href: string | undefined, level: number, lazy: string, count?: number, kind?: string, shortcut = false, quiet = false): HTMLLIElement {
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
  const mark = quiet ? undefined : kindBadge(kind)
  if (mark) row.append(mark)
  if (href) {
    const a = document.createElement('a')
    a.className = 'api-nav__label'
    a.id = id
    a.href = href
    a.tabIndex = -1
    if (shortcut) a.setAttribute('data-api-shortcut', '')
    if (!shortcut && !lazy.startsWith('bucket:') && new URL(href, location.href).pathname === location.pathname) a.setAttribute('aria-current', 'page')
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

/**
 * A tree whose groups name their kind (MCP) shows a mark only where a group mixes kinds.
 * The API tree keeps its gutter of marks, so it never quietens a group.
 */
function kindsAgree(nav: HTMLElement, kinds: (string | undefined)[]): boolean {
  return nav.dataset.marks === 'mixed' && new Set(kinds.filter(Boolean)).size <= 1
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
  const json = sidebarInventory(await load(nav.dataset.src ?? ''))
  // Restoration and a reader's toggle can await the same request.
  const existing = item.querySelector<HTMLElement>(':scope > [role="group"]')
  if (existing) return existing
  const base = nav.dataset.base ?? '/'
  const [kind, ...rest] = (item.dataset.lazy ?? '').split(':')
  const id = rest.join(':')
  const level = Number(item.getAttribute('aria-level')) + 1
  const children: HTMLLIElement[] = []
  if (nav.dataset.presentation) {
    const nodes = sidebarNodes(json, base, nav.dataset.presentation as SidebarPresentation, nav.dataset.symbol ?? '', false,
      { lazy: item.dataset.lazy ?? '', level })
    if (nav.dataset.marks === 'mixed') quietSidebarKinds(nodes)
    children.push(...presentationRows(nodes))
  } else if (kind === 'bucket') {
    const bucket = findBucket(json.buckets, id)
    if (!bucket) return undefined
    const quiet = kindsAgree(nav, bucket.types.map((t) => t.kind))
    for (const t of bucket.types) {
      const href = apiTreeHref(base, t, json.hrefs)
      children.push(t.m ? branch(t.name, href, level, `type:${t.id}`, undefined, t.kind, t.shortcut, quiet) : leaf(t.name, href, level, t.kind, t.shortcut, quiet))
    }
    for (const c of bucket.children) {
      children.push(branch(c.label, c.slug ? `${base}${c.slug}/` : undefined, level, `bucket:${c.id}`, c.types.length))
    }
  } else {
    const members = json.members[id] ?? []
    const quiet = kindsAgree(nav, members.map((member) => member[3]))
    for (const [name, slug, memberId, kind] of members) {
      const href = apiTreeHref(base, { id: memberId, slug }, json.hrefs)
      const display = nav.dataset.presentation ? sidebarName(name, json.port) : name
      children.push(memberId && json.members[memberId]?.length
        ? branch(display, href, level, `type:${memberId}`, nav.dataset.presentation ? json.members[memberId].length : undefined, kind, false, quiet)
        : leaf(display, href, level, kind, false, quiet))
    }
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
  selectPresentation(nav)
  initializeApiTree(nav, false)
  return group
}

/** The demo can select a declaration while its URL stays in the gallery. */
function selectPresentation(nav: HTMLElement) {
  if (!nav.dataset.currentHref) return
  for (const link of nav.querySelectorAll<HTMLAnchorElement>('.api-nav__tree a')) {
    if (!link.hasAttribute('data-api-shortcut') && !link.matches('[data-lazy^="bucket:"] > .api-nav__row > a') && link.getAttribute('href') === nav.dataset.currentHref) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

function presentationRows(nodes: SidebarNode[]): HTMLLIElement[] {
  const items = nodes.filter((node) => !node.section)
  return nodes.map((node) => {
    if (node.section) {
      const heading = document.createElement('li')
      heading.setAttribute('role', 'none')
      heading.className = 'api-nav__section'
      for (const text of [node.label, `${node.count} ${node.section}`]) {
        const span = document.createElement('span')
        span.textContent = text
        heading.append(span)
      }
      return heading
    }
    const li = node.expanded !== undefined
      ? branch(node.label, node.href, node.level, node.lazy ?? '', node.count, node.kind, node.shortcut, node.quiet)
      : leaf(node.label, node.href ?? '', node.level, node.kind, node.shortcut, node.quiet)
    const row = li.matches(ITEM) ? li : li.querySelector<HTMLElement>(ITEM)!
    row.setAttribute('aria-setsize', String(items.length))
    row.setAttribute('aria-posinset', String(items.indexOf(node) + 1))
    if (node.expanded !== undefined) row.setAttribute('aria-expanded', String(node.expanded))
    if (node.children) {
      const group = document.createElement('ul')
      group.className = 'api-nav__group'
      group.setAttribute('role', 'group')
      group.append(...presentationRows(node.children))
      li.append(group)
    }
    if (node.count !== undefined && node.expanded === undefined) {
      const count = document.createElement('span')
      count.className = 'api-nav__count'
      count.textContent = String(node.count)
      row.append(count)
    }
    return li
  })
}

/** Shared preference seam: callers supply a mode and declaration identity. */
export async function setApiSidebar(nav: HTMLElement, mode: SidebarPresentation, symbol: string, options: { notify?: boolean; allTypes?: boolean } = {}) {
  const hadTreeFocus = document.hasFocus() && Boolean(nav.querySelector('.api-nav__tree')?.contains(document.activeElement)
    || nav.querySelector('[data-api-search-results]')?.contains(document.activeElement))
  configurations.get(nav)?.abort()
  const pending = new AbortController()
  configurations.set(nav, pending)
  const json = await load(nav.dataset.src ?? '')
  if (pending.signal.aborted || !nav.isConnected) return
  const catalog = sidebarCatalog(json)
  const record = catalog.symbols.get(symbol)
  const tree = nav.querySelector<HTMLElement>('[role="tree"]')
  if (!tree) return
  if (nav.dataset.presentationReady) saveApiTreeState()
  const selected = record?.id ?? ''
  const owner = catalog.ownerOf(selected)
  nav.dataset.presentation = mode
  nav.dataset.symbol = selected
  nav.dataset.stateScope = mode === 'outline' ? mode : `${mode}:${options.allTypes ? 'all-types' : owner?.id ?? ''}`
  if (options.allTypes) nav.dataset.ownerOverview = 'true'
  else delete nav.dataset.ownerOverview
  nav.dataset.currentHref = record ? apiTreeHref(nav.dataset.base ?? '/', record, json.hrefs) : location.pathname
  delete nav.dataset.apiTreeInteracted
  const nodes = sidebarNodes(json, nav.dataset.base ?? '/', mode, selected, options.allTypes)
  if (nav.dataset.marks === 'mixed') quietSidebarKinds(nodes)
  if (nav.dataset.glossaryHref) nodes.push({ id: 'api-nav-glossary', label: nav.dataset.glossaryLabel ?? '', href: nav.dataset.glossaryHref, level: 1 })
  tree.replaceChildren(...presentationRows(nodes))
  selectPresentation(nav)
  const tab = tree.querySelector<HTMLElement>('[aria-current="page"]')?.closest<HTMLElement>(ITEM) ?? rows(tree)[0]
  if (tab) tab.tabIndex = 0
  const picker = nav.querySelector<HTMLButtonElement>('[data-api-owner]')
  if (picker) {
    const options = nav.querySelector('[role="listbox"]')
    if (options && !options.querySelector('[role="option"]')) {
      options.replaceChildren(...catalog.owners.map((record, index) => {
        const option = document.createElement('div')
        option.id = `api-owner-option-${index}`
        option.className = 'api-nav__owner-option'
        option.setAttribute('role', 'option')
        option.dataset.ownerId = record.id
        option.dataset.qualifiedName = record.qualifiedName
        const mark = kindBadge(record.kind)
        const name = document.createElement('span')
        name.className = 'api-nav__owner-name'
        name.textContent = sidebarName(record.symbolName, json.port)
        const qualified = document.createElement('small')
        qualified.textContent = record.qualifiedName !== record.symbolName ? record.qualifiedName : ''
        name.append(qualified)
        const kind = document.createElement('span')
        kind.className = 'api-kind-word'
        kind.textContent = record.kind
        option.append(...(mark ? [mark] : []), name, kind)
        return option
      }))
    }
    picker.disabled = false
    picker.dataset.symbol = owner?.id ?? ''
    const ownerLabel = picker.querySelector('[data-api-owner-label]')
    const enclosing = catalog.symbols.get(catalog.parent.get(owner?.id ?? '') ?? '')
    if (ownerLabel) ownerLabel.textContent = owner ? sidebarName(owner.shortName ?? `${enclosing ? `${enclosing.symbolName}.` : ''}${owner.symbolName}`, json.port) : `Choose ${catalog.ownerLabel}`
    const mark = owner && kindBadge(owner.kind)
    nav.querySelector('[data-api-owner-mark]')?.replaceChildren(...(mark ? [mark] : []))
    for (const option of nav.querySelectorAll<HTMLElement>('[data-owner-id]')) option.setAttribute('aria-selected', String(option.dataset.ownerId === owner?.id))
    nav.dispatchEvent(new CustomEvent('api-owner:sync'))
  }
  const all = nav.querySelector<HTMLButtonElement>('[data-api-owner-all]')
  if (all) {
    all.hidden = mode === 'outline'
    all.textContent = options.allTypes ? `Back to ${owner?.name ?? 'members'}` : `All ${catalog.ownerPlural}`
  }
  const parent = catalog.symbols.get(catalog.parent.get(selected) ?? '')
  const back = nav.querySelector<HTMLAnchorElement>('[data-api-owner-back]')
  if (back) {
    back.hidden = !parent && location.pathname.replace(/\/?$/, '/') === nav.dataset.base
    back.setAttribute('aria-label', parent ? `Up to ${parent.name}` : 'Up to reference root')
    back.title = back.getAttribute('aria-label')!
    back.dataset.symbol = parent?.id ?? ''
    back.href = parent ? apiTreeHref(nav.dataset.base ?? '/', parent, json.hrefs) : nav.dataset.base ?? '/'
  }
  for (const choice of nav.querySelectorAll<HTMLButtonElement>('[data-api-presentation]')) {
    const checked = choice.dataset.apiPresentation === mode
    choice.setAttribute('aria-checked', String(checked))
    choice.tabIndex = checked ? 0 : -1
  }
  await restoreTree(nav, tree, pending.signal)
  if (pending.signal.aborted) return
  if (hadTreeFocus && !nav.inert) focusRow(tree, tab)
  nav.dataset.presentationReady = 'true'
  if (options.notify !== false) nav.dispatchEvent(new CustomEvent('api-sidebar:change', { bubbles: true, detail: { symbol: selected, presentation: mode } }))
  return record
}

function initPresentation(nav: HTMLElement, tree: HTMLElement, signal: AbortSignal) {
  if (!nav.dataset.presentation) return
  const present = (work: Promise<unknown>) => waitForAppearance(work.catch(() => {
    const status = nav.querySelector<HTMLElement>('[data-api-search-status]')
    if (status) status.textContent = 'Sidebar could not load. Try again from its menu.'
  }))
  initApiOwnerPicker(nav, signal)
  const actions = nav.querySelector<HTMLDetailsElement>('[data-api-actions]')
  if (actions) {
    actions.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !actions.open) return
      event.preventDefault()
      event.stopPropagation()
      actions.open = false
      actions.querySelector('summary')?.focus()
    }, { signal })
    actions.addEventListener('focusout', (event) => {
      if (!actions.contains(event.relatedTarget as Node | null)) actions.open = false
    }, { signal })
    actions.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button')) actions.open = false
    }, { signal })
    document.addEventListener('pointerdown', (event) => {
      if (!actions.contains(event.target as Node)) actions.open = false
    }, { signal })
  }
  const update = (symbol: string) => present(setApiSidebar(nav, nav.dataset.presentation as SidebarPresentation, symbol))
  const choose = async (symbol: string) => {
    if (nav.hasAttribute('data-controlled')) { update(symbol); return }
    const json = await load(nav.dataset.src ?? '')
    const record = sidebarCatalog(json).symbols.get(symbol)
    if (record) window.location.assign(apiTreeHref(nav.dataset.base ?? '/', record, json.hrefs))
  }
  const choices = [...nav.querySelectorAll<HTMLButtonElement>('[data-api-presentation]')]
  const changeMode = (choice: HTMLButtonElement) => {
    const mode = choice.dataset.apiPresentation as SidebarPresentation
    if (!SIDEBAR_PRESENTATIONS.includes(mode)) return
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, mode) } catch { /* Preference storage is optional. */ }
    present(setApiSidebar(nav, mode, nav.dataset.symbol ?? ''))
  }
  for (const choice of choices) {
    choice.addEventListener('click', () => {
      changeMode(choice)
      actions?.querySelector('summary')?.focus({ preventScroll: true })
    }, { signal })
    choice.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (choices.indexOf(choice) + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + choices.length) % choices.length
      const next = choices[index]!
      next.focus()
      changeMode(next)
    }, { signal })
  }
  nav.querySelector<HTMLButtonElement>('[data-api-owner]')?.addEventListener('change', (event) => present(choose((event.target as HTMLButtonElement).dataset.symbol ?? '')), { signal })
  nav.querySelector('[data-api-owner-all]')?.addEventListener('click', () => {
    present(setApiSidebar(nav, nav.dataset.presentation as SidebarPresentation, nav.dataset.symbol ?? '', { allTypes: !nav.dataset.ownerOverview }))
    actions?.querySelector('summary')?.focus({ preventScroll: true })
  }, { signal })
  nav.querySelector<HTMLAnchorElement>('[data-api-owner-back]')?.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!nav.hasAttribute('data-controlled') || !(event.currentTarget as HTMLElement).dataset.symbol) return
    event.preventDefault()
    update((event.currentTarget as HTMLElement).dataset.symbol ?? '')
    if (actions) actions.open = false
    actions?.querySelector('summary')?.focus({ preventScroll: true })
  }, { signal })
  nav.querySelector('[data-api-reveal]')?.addEventListener('click', () => {
    nav.dispatchEvent(new CustomEvent('api-sidebar:clear-search'))
    const current = tree.querySelector<HTMLElement>('[aria-current="page"]')?.closest<HTMLElement>(ITEM)
    for (let item = current; item && tree.contains(item); item = item.parentElement?.closest<HTMLElement>(ITEM) ?? null) {
      if (item.hasAttribute('aria-expanded')) item.setAttribute('aria-expanded', 'true')
    }
    focusRow(tree, current ?? undefined)
  }, { signal })
  nav.querySelector('[data-api-collapse]')?.addEventListener('click', () => {
    nav.dispatchEvent(new CustomEvent('api-sidebar:clear-search'))
    for (const item of tree.querySelectorAll<HTMLElement>('[aria-expanded]')) item.setAttribute('aria-expanded', 'false')
    focusRow(tree, rows(tree)[0])
  }, { signal })
  signal.addEventListener('abort', () => configurations.get(nav)?.abort(), { once: true })
  if (!nav.hasAttribute('data-controlled')) {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) as SidebarPresentation
      if (SIDEBAR_PRESENTATIONS.includes(saved)) nav.dataset.presentation = saved
    } catch { /* Keep the initial layout without storage. */ }
    const arrive = async () => {
      const json = await load(nav.dataset.src ?? '')
      const path = `${location.pathname}${location.hash}`
      const record = sidebarCatalog(json).records.find((entry) => apiTreeHref(nav.dataset.base ?? '/', entry, json.hrefs) === path)
      return setApiSidebar(nav, nav.dataset.presentation as SidebarPresentation, record?.id ?? nav.dataset.symbol ?? '')
    }
    window.addEventListener('hashchange', () => present(arrive()), { signal })
    present(arrive().then(async () => {
      const json = await load(nav.dataset.src ?? '')
      if (!signal.aborted) trackSections(nav, json, signal)
    }))
  }
}

/** Index pages follow the section being read without changing the URL. */
function trackSections(nav: HTMLElement, json: TreeJson, signal: AbortSignal) {
  const targets = sidebarCatalog(json).records.flatMap((record) => {
    const url = new URL(apiTreeHref(nav.dataset.base ?? '/', record, json.hrefs), location.href)
    if (url.pathname !== location.pathname || !url.hash) return []
    const element = document.getElementById(decodeURIComponent(url.hash.slice(1)))
    return element ? [{ id: record.id, element }] : []
  }).sort((a, b) => a.element.compareDocumentPosition(b.element) & 4 ? -1 : 1)
  if (!targets.length) return
  let frame = 0
  const update = () => {
    if (signal.aborted || nav.contains(document.activeElement)) return
    const top = Math.max(0, document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0) + 24
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
    const visible = targets.filter((target) => target.element.getClientRects().length)
    const current = atBottom ? visible.at(-1) : visible.findLast((target) => target.element.getBoundingClientRect().top <= top) ?? visible[0]
    if (current && current.id !== nav.dataset.symbol) void setApiSidebar(nav, nav.dataset.presentation as SidebarPresentation, current.id)
  }
  const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update) }
  window.addEventListener('scroll', schedule, { passive: true, signal })
  window.addEventListener('resize', schedule, { signal })
  nav.addEventListener('focusout', schedule, { signal })
  signal.addEventListener('abort', () => window.cancelAnimationFrame(frame), { once: true })
}

/** Keep controls pinned while the tree gives space back to the page footer. */
function fitSidebar(nav: HTMLElement, signal: AbortSignal) {
  const column = nav.closest<HTMLElement>('.api-nav-column')
  if (!column || nav.hasAttribute('data-controlled')) return
  const desktop = window.matchMedia('(min-width: 56rem)')
  const header = document.querySelector<HTMLElement>('.site-header')
  let frame = 0
  const update = () => {
    if (signal.aborted || !desktop.matches) return
    const stickyHeader = header && ['sticky', 'fixed'].includes(getComputedStyle(header).position)
    const top = stickyHeader ? Math.max(0, header.getBoundingClientRect().bottom) : 0
    const bounds = column.getBoundingClientRect()
    const height = Math.max(0, Math.min(window.innerHeight, bounds.bottom) - Math.max(top, bounds.top))
    column.style.setProperty('--api-nav-top', `${top}px`)
    nav.style.setProperty('--api-nav-height', `${height}px`)
  }
  const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update) }
  const observer = new ResizeObserver(schedule)
  observer.observe(column)
  if (header) observer.observe(header)
  window.addEventListener('scroll', schedule, { passive: true, signal })
  window.addEventListener('resize', schedule, { signal })
  desktop.addEventListener('change', schedule, { signal })
  signal.addEventListener('abort', () => { observer.disconnect(); window.cancelAnimationFrame(frame) }, { once: true })
  layoutBeforeAppearance(update)
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
  tree.addEventListener('scroll', () => {
    const selection = window.history.state?.libtmuxApiTree as ApiTreeSelection | undefined
    const current = tree.querySelector<HTMLElement>('a[data-api-shortcut][aria-current="page"]')
    if (!selection || !current || selection.base !== nav.dataset.base || selection.version !== nav.dataset.version ||
        selection.href !== location.pathname + location.search || JSON.stringify(selection.path) !== JSON.stringify(apiTreePath(current, tree))) return
    try {
      window.history.replaceState({ ...window.history.state, libtmuxApiTree: { ...selection, top: tree.scrollTop } }, '')
    } catch { /* History state is optional. */ }
  }, { signal })
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
  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !phone.matches || !nav.hasAttribute('data-open')) return
    const stops = [...nav.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex]')]
      .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0)
    const first = stops[0]
    const last = stops.at(-1)
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault()
      first.focus()
    }
  }, { signal })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]') && nav.hasAttribute('data-open')) setOpen(false)
  }, { signal })
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
      if (nav.dataset.apiTreeInitialized !== 'true') initializeApiTree(nav)
      initTree(nav, tree, signal)
      initSearch(nav, tree, signal)
      if (nav.dataset.presentation) initPresentation(nav, tree, signal)
      else waitForAppearance(restoreTree(nav, tree, signal))
    }
    initDrawer(nav, signal)
    fitSidebar(nav, signal)
  })
}
