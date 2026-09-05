/**
 * Pagefind, rendered by us.
 *
 * The default UI shows a title and an excerpt. On a reference of twelve
 * thousand symbols that is not enough to pick between two hits — `test.scaled`
 * and `test.RetryTimeout` differ by the package and the file they came from,
 * and neither is in a title. Reference pages tag those as Pagefind metadata
 * (`data-pagefind-meta`), so this renders them under each result.
 */

interface PagefindResultData {
  url: string
  excerpt: string
  meta: Record<string, string | undefined>
  sub_results?: { title: string; url: string; excerpt: string }[]
}

interface PagefindApi {
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

const PAGE_SIZE = 8

/** Strips the site base so a result reads as a path rather than a URL. */
const displayUrl = (url: string) => url.replace(/index\.html$/, '').replace(/\.html$/, '')

export interface SearchPanelHandle {
  focus: () => void
  clear: () => void
}

export function mountSearchPanel(root: HTMLElement, bundlePath: string): SearchPanelHandle {
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

  async function paint() {
    const slice = all.slice(0, shown)
    const rendered = await Promise.all(slice.map((r) => r.data()))
    results.innerHTML = ''

    const count = document.createElement('p')
    count.className = 'search-panel__status'
    count.textContent = `${all.length} result${all.length === 1 ? '' : 's'}`
    results.append(count)

    rendered.forEach((data, i) => {
      const a = document.createElement('a')
      a.className = 'search-panel__result'
      a.href = data.url
      a.setAttribute('role', 'option')
      a.setAttribute('aria-selected', String(i === selected))

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
      results.append(a)
    })

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
    const options = [...results.querySelectorAll<HTMLAnchorElement>('.search-panel__result')]
    if (options.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      options.forEach((o, i) => o.setAttribute('aria-selected', String(i === selected)))
      options[selected]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && selected >= 0) {
      e.preventDefault()
      options[selected]?.click()
    }
  })

  void run('')

  return {
    focus: () => input.focus(),
    clear: () => {
      input.value = ''
      void run('')
    },
  }
}
