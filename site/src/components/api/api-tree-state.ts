interface SavedRow {
  label: string[]
  href?: string
  kind?: string
  mark?: string
  lazy?: string
  count?: string
  shortcut?: boolean
}

/** A navigation choice, not a second declaration or a different destination. */
export interface ApiTreeSelection {
  base: string
  version: string
  href: string
  path: string[]
  top: number
}

export function apiTreePath(link: HTMLElement, tree: HTMLElement): string[] {
  const path: string[] = []
  for (let node = link.parentElement; node && node !== tree; node = node.parentElement) {
    if (node.dataset.lazy) path.unshift(node.dataset.lazy)
  }
  return path
}

export interface ApiTreeState {
  top: number
  branches: Record<string, boolean>
  version?: string
  groups?: Record<string, SavedRow[]>
}

/** Cache only rows the reader has already opened, alongside their expansion state. */
export function captureApiTree(nav: HTMLElement, tree: HTMLElement): ApiTreeState {
  const branches: Record<string, boolean> = {}
  const groups: Record<string, SavedRow[]> = {}
  for (const item of tree.querySelectorAll<HTMLElement>('[data-lazy]')) {
    const lazy = item.dataset.lazy!
    branches[lazy] = item.getAttribute('aria-expanded') === 'true'
    const group = item.querySelector<HTMLElement>(':scope > [role="group"]')
    if (!group || !branches[lazy]) continue
    groups[lazy] = [...group.children].map((entry) => {
      const row = entry.querySelector<HTMLElement>(':scope > .api-nav__row')!
      const label = row.querySelector<HTMLElement>('.api-nav__label')!
      const text = ['']
      for (const node of label.childNodes) {
        if (node.nodeName === 'WBR') text.push('')
        else text[text.length - 1] += node.textContent ?? ''
      }
      const link = row.matches('a') ? row : row.querySelector('a')
      const mark = row.querySelector<HTMLElement>('.api-nav__kind')
      return { label: text, href: link?.getAttribute('href') ?? undefined,
        kind: entry.getAttribute('aria-description') ?? row.getAttribute('aria-description') ?? undefined,
        mark: mark?.textContent?.trim(), lazy: (entry as HTMLElement).dataset.lazy,
        count: row.querySelector('.api-nav__count')?.textContent?.trim(),
        ...(link?.hasAttribute('data-api-shortcut') ? { shortcut: true } : {}) }
    })
  }
  return { top: tree.scrollTop, branches, version: nav.dataset.version, groups }
}

/**
 * Runs inline before first paint and on document swaps. Keep this function
 * self-contained: ApiTree serializes it into its small startup script.
 */
export function initializeApiTree(nav: HTMLElement | null, restoreState = true): ApiTreeSelection | undefined {
  const tree = nav?.querySelector<HTMLElement>('[role="tree"]')
  if (!nav || !tree) return
  let saved: ApiTreeState | undefined
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`libtmux:api-tree:${nav.dataset.base}`) ?? 'null')
    if (Number.isFinite(value?.top) && value.top >= 0 && value.branches && typeof value.branches === 'object') saved = value
  } catch { /* Navigation remains usable without session storage. */ }
  let selection: ApiTreeSelection | undefined
  try {
    const incoming = nav.hasAttribute('data-api-tree-arrival')
    const value = incoming ? JSON.parse(nav.dataset.apiTreeArrival!) : window.history.state?.libtmuxApiTree
    if (value?.base === nav.dataset.base && value.version === nav.dataset.version &&
        typeof value.version === 'string' && value.href === window.location.pathname + window.location.search &&
        Array.isArray(value.path) && value.path.length <= 32 && value.path.every((part: unknown) => typeof part === 'string') &&
        Number.isFinite(value.top) && value.top >= 0) selection = value
    if (incoming) {
      const state = { ...window.history.state }
      delete state.libtmuxApiTree
      if (selection) state.libtmuxApiTree = selection
      window.history.replaceState(state, '')
      delete nav.dataset.apiTreeArrival
    }
  } catch { /* A direct arrival retains its canonical selection. */ }
  // A new model, nav ordering, or renderer must not resurrect stale links.
  const groups = saved?.version && saved.version === nav.dataset.version ? saved.groups : undefined
  let seq = 0
  const element = (tag: string, className: string) => {
    const node = document.createElement(tag)
    node.className = className
    return node
  }
  const render = (rows: SavedRow[], level: number) => {
    const group = element('ul', 'api-nav__group')
    group.setAttribute('role', 'group')
    for (const [i, entry] of rows.entries()) {
      if (!entry || !Array.isArray(entry.label) || !entry.label.every((part) => typeof part === 'string')) continue
      const li = element('li', entry.lazy ? 'api-nav__item' : '')
      const row = element(entry.lazy ? 'div' : 'a', `api-nav__row${entry.lazy ? '' : ' api-nav__leaf'}`)
      const item = entry.lazy ? li : row
      li.setAttribute('role', entry.lazy ? 'treeitem' : 'none')
      item.setAttribute('role', 'treeitem')
      item.setAttribute('tabindex', '-1')
      item.setAttribute('aria-level', String(level))
      item.setAttribute('aria-setsize', String(rows.length))
      item.setAttribute('aria-posinset', String(i + 1))
      row.style.setProperty('--level', String(level))
      if (entry.lazy) {
        li.dataset.lazy = entry.lazy
        li.setAttribute('aria-expanded', 'false')
        const chevron = element('span', 'api-nav__chevron')
        chevron.setAttribute('aria-hidden', 'true')
        row.append(chevron)
      }
      if (entry.kind && /^[a-z]+(?:-[a-z]+)*$/.test(entry.kind)) {
        item.setAttribute('aria-description', entry.kind)
        if (entry.mark) {
          const badge = element('span', `api-nav__kind api-badge--kind-${entry.kind}`)
          badge.title = entry.kind
          badge.setAttribute('aria-hidden', 'true')
          const label = element('span', 'api-badge__label')
          label.textContent = entry.mark
          badge.append(label)
          row.append(badge)
        }
      }
      // Saved labels are text, never HTML; links remain local HTTP paths.
      const href = typeof entry.href === 'string' && /^\/(?!\/)/.test(entry.href) && !entry.href.includes('\\') ? entry.href : undefined
      const label = element(entry.lazy && href ? 'a' : 'span', 'api-nav__label')
      for (const [j, part] of entry.label.entries()) {
        if (j) label.append(document.createElement('wbr'))
        label.append(part)
      }
      if (href) {
        const link = entry.lazy ? label : row
        link.setAttribute('href', href)
        link.setAttribute('tabindex', '-1')
        if (entry.shortcut === true) link.setAttribute('data-api-shortcut', '')
      }
      if (entry.lazy) {
        label.id = `api-nav-restored-${++seq}`
        li.setAttribute('aria-labelledby', label.id)
      }
      row.append(label)
      if (entry.count && /^\d+$/.test(entry.count)) {
        const count = element('span', 'api-nav__count')
        count.textContent = entry.count
        count.id = `${label.id}-count`
        li.setAttribute('aria-labelledby', `${label.id} ${count.id}`)
        row.append(count)
      }
      li.append(row)
      group.append(li)
    }
    return group
  }
  const restore = (root: HTMLElement, depth = 0) => {
    if (depth > 32) return
    for (const item of root.querySelectorAll<HTMLElement>(':scope > [role="treeitem"][data-lazy]')) {
      const current = Boolean(item.querySelector('[aria-current="page"]'))
      const open = current || selection?.path.includes(item.dataset.lazy!) || saved?.branches[item.dataset.lazy!] === true
      let group = item.querySelector<HTMLElement>(':scope > [role="group"]')
      const cached = groups?.[item.dataset.lazy!]
      if (open && !group && Array.isArray(cached)) {
        group = render(cached, Number(item.getAttribute('aria-level')) + 1)
        item.append(group)
      }
      if (group || !open) item.setAttribute('aria-expanded', String(open))
      if (group && open) restore(group, depth + 1)
    }
  }
  if (restoreState && (saved || selection)) restore(tree)
  const selected = selection && [...tree.querySelectorAll<HTMLElement>('a[data-api-shortcut]')].find((link) => {
    const href = new URL(link.getAttribute('href')!, window.location.href)
    if (href.origin !== window.location.origin || href.pathname + href.search !== selection!.href) return false
    const path: string[] = []
    for (let node = link.parentElement; node && node !== tree; node = node.parentElement) {
      if (node.dataset.lazy) path.unshift(node.dataset.lazy)
    }
    return JSON.stringify(path) === JSON.stringify(selection!.path)
  })
  if (selected) {
    for (const link of tree.querySelectorAll('[aria-current="page"]')) link.removeAttribute('aria-current')
    selected.setAttribute('aria-current', 'page')
    for (const item of tree.querySelectorAll('[role="treeitem"][tabindex="0"]')) item.setAttribute('tabindex', '-1')
    selected.closest<HTMLElement>('[role="treeitem"]')!.tabIndex = 0
    for (let node = selected.parentElement; node && node !== tree; node = node.parentElement) {
      if (node.hasAttribute('aria-expanded')) node.setAttribute('aria-expanded', 'true')
    }
  }
  const top = selected ? selection!.top : undefined
  if (!restoreState) return selection
  if (selected && (saved || selection)) restore(tree)
  if (top !== undefined || saved) tree.scrollTop = top ?? saved!.top
  const current = tree.querySelector<HTMLElement>('[aria-current="page"]')
  if (current && tree.clientHeight) {
    const row = (current.closest('.api-nav__row') ?? current).getBoundingClientRect()
    const box = tree.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight)
    if ((!saved && top === undefined) || row.top < box.top || row.bottom > bottom) {
      tree.scrollTop += row.top - box.top - (bottom - box.top - row.height) / 2
    }
  }
  for (const event of ['wheel', 'pointerdown', 'keydown']) {
    tree.addEventListener(event, () => { nav.dataset.apiTreeInteracted = 'true' }, { once: true })
  }
  nav.dataset.apiTreeInitialized = 'true'
  return selection
}
