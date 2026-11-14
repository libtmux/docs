/**
 * Pagefind, rendered by us.
 *
 * The default UI shows a title and an excerpt. On a reference of twelve
 * thousand symbols that is not enough to pick between two hits — `test.scaled`
 * and `test.RetryTimeout` differ by the package and the file they came from,
 * and neither is in a title. Reference pages tag those as Pagefind metadata
 * (`data-pagefind-meta`), so this renders them under each result.
 */

import {
  countLine,
  filterCount,
  filtersFor,
  needsMoreResults,
  orderedSections,
  parseSearchState,
  readSnapshot,
  scopeLabel,
  searchStateQuery,
  sectionLabel,
  withSnapshot,
  type SearchScope,
  type SearchSnapshot,
  type SearchState,
} from './search-state'

export interface PagefindResultData {
  url: string
  excerpt: string
  meta: Record<string, string | undefined>
  sub_results?: { title: string; url: string; excerpt: string }[]
}

export interface PagefindApi {
  init?: () => Promise<void>
  options?: (o: Record<string, unknown>) => Promise<void>
  search: (
    q: string | null,
    o?: Record<string, unknown>,
  ) => Promise<{
    results: { id: string; data: () => Promise<PagefindResultData> }[]
    filters?: Record<string, Record<string, number>>
    totalFilters?: Record<string, Record<string, number>>
  }>
  filters: () => Promise<Record<string, Record<string, number>>>
}

/**
 * How a page's matching sections show under it, after social-embed's search.
 *
 * `inline` lists the first three under an arrow, `toggle` folds them behind a
 * count, and `breadcrumbs` shows the page's path above its title instead of
 * any sections.
 */
export type SubResultsDisplay = 'inline' | 'toggle' | 'breadcrumbs'

export interface SearchPanelOptions {
  /** Omitted, results show no sections, as the search page always has. */
  subResults?: SubResultsDisplay
  /** A query to run as soon as the panel mounts. */
  initialQuery?: string
  /** The current port's name: the first query searches it, and the scope control names it. */
  initialPort?: string
  /**
   * Keep the state in the page URL as `?q=&scope=&section=&kind=`. The search
   * page does; the dialog leaves the address alone.
   */
  url?: boolean
  /** Links the index-failure message offers, such as the API index and the guides. */
  fallbackLinks?: { label: string; href: string }[]
  /** An index to search instead of Pagefind's. */
  mock?: PagefindApi
  /** Names for path segments in a breadcrumb, such as `py` for Python. */
  segmentNames?: Record<string, string>
}

type Section = NonNullable<PagefindResultData['sub_results']>[number]

const PAGE_SIZE = 8

/** Sections `inline` lists under a result before it counts the rest. */
const INLINE_SECTIONS = 3

const SEGMENT_NAMES: Record<string, string> = { api: 'API', mcp: 'MCP' }

/** Strips the site base so a result reads as a path rather than a URL. */
const displayUrl = (url: string) => url.replace(/index\.html$/, '').replace(/\.html$/, '')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export interface SearchPanelHandle {
  /** Initial filters and any requested results have finished rendering. */
  ready: Promise<void>
  focus: () => void
  clear: () => void
}

/** Where the panel hands its state to the page: the dialog's link to the search page follows it. */
export const SEARCH_STATE_EVENT = 'search-panel:state'

export function mountSearchPanel(root: HTMLElement, bundlePath: string, settings: SearchPanelOptions = {}): SearchPanelHandle {
  const input = root.querySelector<HTMLInputElement>('.search-panel__input')!
  const results = root.querySelector<HTMLElement>('.search-panel__results')!
  const filtersBox = root.querySelector<HTMLElement>('.search-panel__filters')!
  const filterList = root.querySelector<HTMLElement>('.search-panel__filter-list:not(.search-panel__section-list):not(.search-panel__kind-list)')!
  // The scope control, the Section and Kind facets are optional markup: a
  // panel without them is a plain port-or-all search.
  const scopeBox = root.querySelector<HTMLElement>('.search-panel__scope')
  const portGroup = root.querySelector<HTMLElement>('.search-panel__facet--port')
  const sectionGroup = root.querySelector<HTMLElement>('.search-panel__facet--section')
  const sectionList = root.querySelector<HTMLElement>('.search-panel__section-list')
  const kindGroup = root.querySelector<HTMLElement>('.search-panel__facet--kind')
  const kindList = root.querySelector<HTMLElement>('.search-panel__kind-list')
  const dialog = root.closest('dialog')

  // A port page searches its port; the root search starts across all of them.
  const defaultScope: SearchScope = settings.initialPort ? 'port' : 'all'
  const fromUrl = settings.url ? parseSearchState(location.search, defaultScope) : undefined
  const restored = readSnapshot(history.state)
  // Back returns to the view that was left; the URL names it for a shared link.
  const restore = restored && (settings.url ? restored.q === fromUrl?.q : dialog ? restored.open : false) ? restored : undefined
  const start: SearchState = restore ?? fromUrl ?? { q: settings.initialQuery ?? '', scope: defaultScope }

  let state: SearchState = { q: start.q, scope: settings.initialPort ? start.scope : 'all', section: start.section, kind: start.kind }
  const selectedPorts = new Set(restore?.ports ?? [])

  let api: PagefindApi | null = null
  let loading: Promise<PagefindApi | null> | null = null
  let failed = false
  let shown = restore && needsMoreResults(restore, PAGE_SIZE) ? restore.shown : PAGE_SIZE
  let all: { id: string; data: () => Promise<PagefindResultData> }[] = []
  let selected = -1
  let token = 0
  let pending = restore

  const portName = settings.initialPort
  const scopeText = () => scopeLabel(state.scope, portName)

  const status = (text: string, widen = false) => {
    results.innerHTML = ''
    const p = document.createElement('p')
    p.className = 'search-panel__status'
    p.setAttribute('role', 'status')
    p.textContent = text
    results.append(p)
    if (widen && portName && state.scope !== 'all') {
      const wider = document.createElement('button')
      wider.type = 'button'
      wider.className = 'search-panel__widen'
      wider.textContent = 'Search all languages'
      wider.addEventListener('click', () => setScope('all'))
      results.append(wider)
    }
  }

  /** The index did not load: say so, keep the query, and offer a way on. */
  function failure() {
    results.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'search-panel__failure'
    box.setAttribute('role', 'alert')
    const lead = document.createElement('strong')
    lead.textContent = 'The search index did not load.'
    const body = document.createElement('p')
    body.textContent = 'The query is kept. Browse instead, or try again.'
    const row = document.createElement('div')
    row.className = 'search-panel__failure-actions'
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Try again'
    retry.addEventListener('click', () => {
      failed = false
      loading = null
      void run(input.value)
    })
    row.append(retry)
    for (const link of settings.fallbackLinks ?? []) {
      const a = document.createElement('a')
      a.href = link.href
      a.textContent = link.label
      row.append(a)
    }
    box.append(lead, body, row)
    results.append(box)
  }

  /** Write the state where Back and a shared link can find it. */
  function remember(open = false) {
    const query = searchStateQuery(state, defaultScope)
    root.dispatchEvent(new CustomEvent(SEARCH_STATE_EVENT, { bubbles: true, detail: { query } }))
    if (!settings.url && !dialog) return
    const snapshot: SearchSnapshot = {
      ...state, ports: [...selectedPorts], shown, selected, scroll: results.scrollTop, open: open || Boolean(dialog?.open),
    }
    const href = settings.url ? `${location.pathname}${query}${location.hash}` : undefined
    history.replaceState(withSnapshot(history.state, snapshot), '', href)
  }

  async function pagefind(): Promise<PagefindApi | null> {
    if (settings.mock) return settings.mock
    if (api) return api
    if (!loading) {
      loading = (async () => {
        try {
          const head = await fetch(`${bundlePath}pagefind.js`, { method: 'HEAD' })
          // A build without an index answers with its 404 page, not script.
          if (!head.ok || !(head.headers.get('content-type') ?? '').includes('javascript')) {
            return null
          }
          /* @vite-ignore — the bundle is emitted by Pagefind after the build,
             so it cannot be resolved at build time. */
          const mod = (await import(/* @vite-ignore */ `${bundlePath}pagefind.js`)) as PagefindApi
          await mod.options?.({ excerptLength: 22 })
          await mod.init?.()
          api = mod
          return mod
        } catch {
          failed = true
          return null
        }
      })()
    }
    return loading
  }

  interface FilterCounts {
    port?: Record<string, number>
    section?: Record<string, number>
    kind?: Record<string, number>
  }

  /** One facet: a title's worth of checkboxes, each with its count. */
  function facetRows(
    list: HTMLElement,
    entries: [string, number][],
    isOn: (value: string) => boolean,
    label: (value: string) => string,
    toggle: (value: string, on: boolean) => void,
  ) {
    list.innerHTML = ''
    for (const [value, count] of entries) {
      const row = document.createElement('label')
      row.className = 'search-panel__filter'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.value = value
      box.checked = isOn(value)
      box.addEventListener('change', () => toggle(value, box.checked))
      const text = document.createElement('span')
      text.textContent = label(value)
      const n = document.createElement('span')
      n.className = 'search-panel__result-count search-panel__filter-count'
      n.textContent = String(count)
      row.append(box, text, n)
      list.append(row)
    }
  }

  /** The scope buttons say which one is on; a root search has none. */
  function paintScope() {
    if (!scopeBox) return
    for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('button[data-scope]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === state.scope))
    }
  }

  /** A narrower or wider search starts from the first page of its own results. */
  function setState(next: Partial<SearchState>) {
    state = { ...state, ...next }
    void run(input.value)
  }

  function setScope(scope: SearchScope) {
    if (scope === state.scope) return
    // The API scope is the reference section; leaving it must not leave it fixed.
    setState({ scope, section: scope === 'reference' ? undefined : state.section, kind: scope === 'all' && !state.section ? undefined : state.kind })
  }

  scopeBox?.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button[data-scope]')
    if (button) setScope(button.dataset.scope as SearchScope)
  })

  const activeFilters = () => filtersFor(state, portName, [...selectedPorts]) as Record<string, unknown> | undefined

  async function renderFilters(counts: FilterCounts) {
    paintScope()
    // Hidden, not removed: a facet the data does not have stays out of the way.
    const ports = state.scope === 'all' ? { ...Object.fromEntries([...selectedPorts].map((port) => [port, 0])), ...counts.port } : {}
    const sections = state.scope === 'reference' ? {} : { ...(state.section ? { [state.section]: 0 } : {}), ...counts.section }
    // Kinds belong to reference pages, so the facet shows once the search is among them.
    const kinds = state.scope === 'reference' || state.section === 'reference' ? { ...(state.kind ? { [state.kind]: 0 } : {}), ...counts.kind } : {}
    const hasPorts = Object.keys(ports).length > 0
    const hasSections = Boolean(sectionList) && Object.keys(sections).length > 0
    const hasKinds = Boolean(kindList) && Object.keys(kinds).length > 0
    if (portGroup) portGroup.hidden = !hasPorts
    if (sectionGroup) sectionGroup.hidden = !hasSections
    if (kindGroup) kindGroup.hidden = !hasKinds
    if (!hasPorts && !hasSections && !hasKinds) {
      filtersBox.hidden = true
      return
    }
    // Open, not collapsed. The filter is how a reader narrows twelve thousand
    // symbols to one port, and behind a closed disclosure it went unused.
    filtersBox.hidden = false
    facetRows(
      filterList,
      Object.entries(ports).sort((a, b) => b[1] - a[1]),
      (value) => selectedPorts.has(value),
      (value) => value,
      (value, on) => {
        if (on) selectedPorts.add(value)
        else selectedPorts.delete(value)
        void run(input.value)
      },
    )
    if (sectionList) {
      facetRows(sectionList, orderedSections(sections), (value) => state.section === value, sectionLabel, (value, on) =>
        // One section at a time: the facet narrows, it does not combine.
        setState({ section: on ? value : undefined, kind: on && value === 'reference' ? state.kind : undefined }))
    }
    if (kindList) {
      facetRows(kindList, Object.entries(kinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), (value) => state.kind === value, (value) => value, (value, on) =>
        setState({ kind: on ? value : undefined }))
    }
  }

  function metaOf(data: PagefindResultData) {
    const bits: string[] = []
    if (data.meta.kind) bits.push(data.meta.kind)
    bits.push(displayUrl(data.url))
    if (data.meta.package) bits.push(data.meta.package)
    if (data.meta.file) bits.push(data.meta.file)
    return bits
  }

  /** A page's path under the site root, such as `Python › Stable › Workspace`. */
  function breadcrumb(url: string): string {
    const siteRoot = bundlePath.replace(/pagefind\/$/, '')
    const path = new URL(url, window.location.href).pathname
    const segments = (path.startsWith(siteRoot) ? path.slice(siteRoot.length) : path)
      .replace(/(index)?\.html$/, '')
      .split('/')
      .filter(Boolean)
    if (segments.length === 0) return 'Home'
    return segments
      .map(
        (segment) =>
          settings.segmentNames?.[segment] ??
          SEGMENT_NAMES[segment] ??
          segment
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '),
      )
      .join(' › ')
  }

  function sectionLink(section: Section, arrow: boolean): HTMLAnchorElement {
    const a = document.createElement('a')
    a.className = 'search-panel__sub'
    a.href = section.url
    a.setAttribute('role', 'option')
    a.setAttribute('aria-selected', 'false')
    if (arrow) {
      const mark = document.createElement('span')
      mark.className = 'search-panel__sub-arrow'
      mark.setAttribute('aria-hidden', 'true')
      mark.textContent = '⤷'
      a.append(mark)
    }
    const body = document.createElement('span')
    body.className = 'search-panel__sub-body'
    const title = document.createElement('span')
    title.className = 'search-panel__sub-title'
    title.textContent = section.title
    const excerpt = document.createElement('span')
    excerpt.className = 'search-panel__sub-excerpt'
    excerpt.innerHTML = section.excerpt
    body.append(title, excerpt)
    a.append(body)
    return a
  }

  /** What goes under a result for its sections, in the panel's mode. */
  function sectionsFor(data: PagefindResultData): HTMLElement[] {
    const mode = settings.subResults
    // Pagefind lists the page itself among its sections; the result already is.
    const sections = (data.sub_results ?? []).filter((section) => section.url !== data.url)
    if ((mode !== 'inline' && mode !== 'toggle') || sections.length === 0) return []

    const list = document.createElement('ul')
    list.className = 'search-panel__subs'
    for (const section of mode === 'inline' ? sections.slice(0, INLINE_SECTIONS) : sections) {
      const item = document.createElement('li')
      item.append(sectionLink(section, mode === 'inline'))
      list.append(item)
    }

    if (mode === 'inline') {
      if (sections.length > INLINE_SECTIONS) {
        const more = document.createElement('li')
        more.className = 'search-panel__more-subs'
        more.textContent = `+${plural(sections.length - INLINE_SECTIONS, 'more section')}`
        list.append(more)
      }
      return [list]
    }

    list.hidden = true
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'search-panel__toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 5 7 7-7 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    toggle.append(plural(sections.length, 'section'))
    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden
      toggle.setAttribute('aria-expanded', String(!list.hidden))
      selected = -1
      highlight()
    })
    return [toggle, list]
  }

  /** Results and the sections a reader can see, in the order arrow keys visit them. */
  const choices = () =>
    [...results.querySelectorAll<HTMLAnchorElement>('.search-panel__result, .search-panel__subs:not([hidden]) .search-panel__sub')]

  function highlight() {
    choices().forEach((choice, i) => choice.setAttribute('aria-selected', String(i === selected)))
  }

  /** A symbol's owner reads muted before its name: `Pane.` then `Capture`. */
  function titleOf(data: PagefindResultData): HTMLElement {
    const title = document.createElement('div')
    title.className = 'search-panel__result-title'
    const name = data.meta.title ?? displayUrl(data.url)
    const owner = data.meta.owner
    if (!owner) {
      title.textContent = name
      return title
    }
    const prefix = document.createElement('span')
    prefix.className = 'search-panel__owner'
    prefix.textContent = `${owner}.`
    title.append(prefix, name.startsWith(`${owner}.`) ? name.slice(owner.length + 1) : name)
    return title
  }

  /** The status line: both numbers, the scope, and a way to drop the filters. */
  function statusLine(): HTMLElement {
    const line = document.createElement('p')
    line.className = 'search-panel__status'
    line.setAttribute('role', 'status')
    line.append(countLine(all.length, Math.min(shown, all.length), scopeText()))
    const extra = filterCount(state, [...selectedPorts])
    if (extra > 0) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'search-panel__clear'
      clear.textContent = `Clear ${extra} filter${extra === 1 ? '' : 's'}`
      clear.addEventListener('click', () => {
        selectedPorts.clear()
        setState({ section: undefined, kind: undefined })
      })
      line.append(' ', clear)
    }
    return line
  }

  async function paint(focusFrom?: number) {
    const mine = token
    const slice = all.slice(0, shown)
    const rendered = await Promise.all(slice.map((r) => r.data()))
    if (mine !== token) return
    results.innerHTML = ''
    results.append(statusLine())

    rendered.forEach((data) => {
      const item = document.createElement('div')
      item.className = 'search-panel__item'

      const a = document.createElement('a')
      a.className = 'search-panel__result'
      a.href = data.url
      a.setAttribute('role', 'option')

      if (settings.subResults === 'breadcrumbs') {
        const crumb = document.createElement('div')
        crumb.className = 'search-panel__breadcrumb'
        crumb.textContent = breadcrumb(data.url)
        a.append(crumb)
      }

      const excerpt = document.createElement('p')
      excerpt.className = 'search-panel__result-excerpt'
      excerpt.innerHTML = data.excerpt

      const meta = document.createElement('div')
      meta.className = 'search-panel__result-meta'
      for (const bit of metaOf(data)) {
        const span = document.createElement('span')
        span.textContent = bit
        meta.append(span)
      }

      a.append(titleOf(data), excerpt, meta)
      item.append(a, ...sectionsFor(data))
      results.append(item)
    })
    highlight()

    if (all.length > shown) {
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'search-panel__more'
      more.textContent = `Show ${Math.min(PAGE_SIZE, all.length - shown)} more`
      more.addEventListener('click', () => {
        const from = shown
        shown += PAGE_SIZE
        void paint(from)
      })
      results.append(more)
    }

    if (pending) {
      // Back: the row that was chosen, the list where it was scrolled.
      const view = pending
      pending = undefined
      const rows = choices()
      selected = view.selected < rows.length ? view.selected : -1
      highlight()
      results.scrollTop = view.scroll
      if (selected >= 0) rows[selected]?.focus({ preventScroll: true })
    } else if (focusFrom !== undefined) {
      // "Show more" moves focus to the first row it added.
      results.querySelectorAll<HTMLElement>('.search-panel__result')[focusFrom]?.focus({ preventScroll: false })
    }
    remember()
  }

  async function run(query: string) {
    const mine = ++token
    const q = query.trim()
    state = { ...state, q }
    if (!q) {
      all = []
      selected = -1
      status('Type to search.')
      const idle = await pagefind()
      if (idle && mine === token) {
        const counts = await idle.filters()
        if (mine === token) await renderFilters(counts)
      }
      remember()
      return
    }

    const pf = await pagefind()
    if (!pf) {
      if (failed) failure()
      else status('No search index in this build. Run a full build to generate one.')
      return
    }
    const res = await pf.search(q, { filters: activeFilters() })
    if (mine !== token) return

    await renderFilters({
      port: res.totalFilters?.port ?? res.filters?.port,
      section: res.filters?.section ?? res.totalFilters?.section,
      kind: res.filters?.kind ?? res.totalFilters?.kind,
    })
    all = res.results
    shown = pending ? Math.max(PAGE_SIZE, pending.shown) : PAGE_SIZE
    selected = -1
    if (all.length === 0) {
      status(`No results for ${q}.`, true)
      remember()
      return
    }
    await paint()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  input.addEventListener('input', () => {
    clearTimeout(timer)
    pending = undefined
    timer = setTimeout(() => void run(input.value), 120)
  })

  root.addEventListener('keydown', (e) => {
    const list = choices()
    if (list.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault()
      selected = e.key === 'Home' ? 0 : list.length - 1
    } else if (e.key === 'Enter' && selected >= 0) {
      e.preventDefault()
      list[selected]?.click()
      return
    } else {
      return
    }
    highlight()
    list[selected]?.scrollIntoView({ block: 'nearest' })
  })

  // A result opens a new entry; the one it leaves keeps what Back needs.
  root.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('.search-panel__result, .search-panel__sub')
    if (!link) return
    const rows = choices()
    const at = rows.indexOf(link as HTMLAnchorElement)
    if (at >= 0) selected = at
    remember(true)
  }, true)

  // The dialog keeps its query when it closes and opens on it again; the query
  // goes only when the page changes and a new dialog arrives with it. Closing
  // does record that the dialog is shut, so Back does not reopen it.
  dialog?.addEventListener('close', () => remember())

  input.value = state.q
  paintScope()
  const ready = run(state.q)

  return {
    ready,
    focus: () => input.focus(),
    clear: () => {
      input.value = ''
      pending = undefined
      void run('')
    },
  }
}
