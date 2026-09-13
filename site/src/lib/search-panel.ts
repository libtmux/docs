/**
 * Pagefind, rendered by us.
 *
 * The default UI shows a title and an excerpt. On a reference of twelve
 * thousand symbols that is not enough to pick between two hits — `test.scaled`
 * and `test.RetryTimeout` differ by the package and the file they came from,
 * and neither is in a title. Reference pages tag those as Pagefind metadata
 * (`data-pagefind-meta`), so this renders them under each result.
 */

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
  focus: () => void
  clear: () => void
}

export function mountSearchPanel(root: HTMLElement, bundlePath: string, settings: SearchPanelOptions = {}): SearchPanelHandle {
  const input = root.querySelector<HTMLInputElement>('.search-panel__input')!
  const results = root.querySelector<HTMLElement>('.search-panel__results')!
  const filtersBox = root.querySelector<HTMLElement>('.search-panel__filters')!
  const filterList = root.querySelector<HTMLElement>('.search-panel__filter-list')!

  let api: PagefindApi | null = null
  let loading: Promise<PagefindApi | null> | null = null
  let shown = PAGE_SIZE
  let all: { id: string; data: () => Promise<PagefindResultData> }[] = []
  let selected = -1
  let token = 0

  const status = (text: string) => {
    results.innerHTML = ''
    const p = document.createElement('p')
    p.className = 'search-panel__status'
    p.textContent = text
    results.append(p)
  }

  async function pagefind(): Promise<PagefindApi | null> {
    if (settings.mock) return settings.mock
    if (api) return api
    if (!loading) {
      loading = (async () => {
        try {
          const head = await fetch(`${bundlePath}pagefind.js`, { method: 'HEAD' })
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
          return null
        }
      })()
    }
    return loading
  }

  const activeFilters = () => {
    const checked = [...filterList.querySelectorAll<HTMLInputElement>('input:checked')].map(
      (i) => i.value,
    )
    return checked.length ? { port: checked } : undefined
  }

  async function renderFilters(counts: Record<string, number> | undefined) {
    if (!counts || Object.keys(counts).length === 0) {
      filtersBox.hidden = true
      return
    }
    // Open, not collapsed. The filter is how a reader narrows twelve thousand
    // symbols to one port, and behind a closed disclosure it went unused.
    filtersBox.hidden = false
    const previous = new Set(
      [...filterList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value),
    )
    filterList.innerHTML = ''
    for (const [value, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const label = document.createElement('label')
      label.className = 'search-panel__filter'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.value = value
      box.checked = previous.has(value)
      box.addEventListener('change', () => void run(input.value))
      const text = document.createElement('span')
      text.textContent = value
      const n = document.createElement('span')
      n.className = 'search-panel__result-count search-panel__filter-count'
      n.textContent = String(count)
      label.append(box, text, n)
      filterList.append(label)
    }
  }

  function metaOf(data: PagefindResultData) {
    const bits: string[] = [displayUrl(data.url)]
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

  async function paint() {
    const slice = all.slice(0, shown)
    const rendered = await Promise.all(slice.map((r) => r.data()))
    results.innerHTML = ''

    const count = document.createElement('p')
    count.className = 'search-panel__status'
    count.textContent = `${all.length} result${all.length === 1 ? '' : 's'}`
    results.append(count)

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

      const title = document.createElement('div')
      title.className = 'search-panel__result-title'
      title.textContent = data.meta.title ?? displayUrl(data.url)

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

      a.append(title, excerpt, meta)
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
        shown += PAGE_SIZE
        void paint()
      })
      results.append(more)
    }
  }

  async function run(query: string) {
    const mine = ++token
    const q = query.trim()
    if (!q) {
      all = []
      selected = -1
      status('Type to search.')
      const idle = await pagefind()
      if (idle && mine === token) await renderFilters((await idle.filters()).port)
      return
    }

    const pf = await pagefind()
    if (!pf) {
      status('No search index in this build. Run a full build to generate one.')
      return
    }
    const res = await pf.search(q, { filters: activeFilters() })
    if (mine !== token) return

    await renderFilters(res.totalFilters?.port ?? res.filters?.port)
    all = res.results
    shown = PAGE_SIZE
    selected = -1
    if (all.length === 0) {
      status(`No results for ${q}.`)
      return
    }
    await paint()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  input.addEventListener('input', () => {
    clearTimeout(timer)
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

  if (settings.initialQuery) {
    input.value = settings.initialQuery
    void run(settings.initialQuery)
  } else {
    void run('')
  }

  return {
    focus: () => input.focus(),
    clear: () => {
      input.value = ''
      void run('')
    },
  }
}
