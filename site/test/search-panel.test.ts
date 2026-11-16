import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSearchPanel, type PagefindApi, type PagefindResultData, type SearchPanelOptions } from '../src/lib/search-panel'
import { readSnapshot, ROOT_PORT, withSnapshot, type SearchSnapshot } from '../src/lib/search-state'

let window: Window
afterEach(() => {
  vi.unstubAllGlobals()
  window?.close()
})

interface FixtureOptions {
  /** The page address, to start from `?q=&scope=` or any other state. */
  url?: string
  settings?: Partial<SearchPanelOptions>
  /** What `history.state` already holds, as after Back. */
  state?: unknown
  /** Mount inside a dialog, as the Cmd-K panel is. */
  dialog?: boolean
  total?: number
}

function fixture(initialPort?: string, options: FixtureOptions = {}) {
  window = new Window({ url: options.url ?? 'https://libtmux.org/en/go/latest/search/' })
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('Event', window.Event)
  vi.stubGlobal('CustomEvent', window.CustomEvent)
  vi.stubGlobal('location', window.location)
  vi.stubGlobal('history', window.history)
  if (options.state) window.history.replaceState(options.state, '')
  const panel = `<div class="search-panel">
    <input class="search-panel__input">
    <div class="search-panel__scope"><button data-scope="port"></button><button data-scope="reference"></button><button data-scope="all"></button></div>
    <aside class="search-panel__filters" hidden>
      <div class="search-panel__facet search-panel__facet--section" hidden><div class="search-panel__filter-list search-panel__section-list"></div></div>
      <div class="search-panel__facet search-panel__facet--kind" hidden><div class="search-panel__filter-list search-panel__kind-list"></div></div>
      <div class="search-panel__facet search-panel__facet--port"><div class="search-panel__filter-list"></div></div>
    </aside>
    <div class="search-panel__results"></div>
  </div>`
  window.document.body.innerHTML = options.dialog ? `<dialog open>${panel}</dialog>` : panel
  // Happy DOM implements the browser API with its own element types.
  const root = window.document.querySelector('.search-panel')! as unknown as HTMLElement
  const input = root.querySelector<HTMLInputElement>('input')!
  const pages = ['Go', 'Rust'].map((port) => ({ port, data: {
    url: `/en/${port === 'Go' ? 'go' : 'rs'}/latest/topics/capture/`,
    excerpt: `${port} capture`, meta: { title: `${port} capture` },
  } }))
  // A tmux page belongs to no port: it is indexed under the root, `All languages`.
  const manual = { port: ROOT_PORT, data: { url: '/en/tmux/latest/manual/new-session/', excerpt: 'new-session', meta: { title: 'tmux new-session' } } }
  // A long list for paging and restoring: `total` rows of the Go port, each a method of Pane.
  const long = Array.from({ length: options.total ?? 0 }, (_, i) => ({
    id: `m${i}`, data: async () => ({ url: `/en/go/latest/reference/m${i}/`, excerpt: `row ${i}`, meta: { title: `Pane.m${i}`, owner: 'Pane', kind: 'method' } }),
  }))
  const search = vi.fn<PagefindApi['search']>(async (query, searchOptions): ReturnType<PagefindApi['search']> => {
    const f = searchOptions?.filters as { port?: string[] | { any: string[] }; section?: string[]; kind?: string[] } | undefined
    const ports = Array.isArray(f?.port) ? f.port : f?.port?.any
    if (query === 'long') {
      return { results: long, totalFilters: { port: { Go: long.length } }, filters: { section: { reference: long.length, guides: 2 }, kind: { method: long.length } } }
    }
    const known = query === 'capture' ? pages : query === 'new-session' ? [manual] : []
    const hits = known.filter((page) => !ports || ports.includes(page.port))
    const counts: Record<string, number> = query === 'capture' ? { Go: 1, Rust: 1 } : {}
    return {
      results: hits.map((page) => ({ id: page.port, data: async () => page.data })),
      totalFilters: { port: counts },
      filters: query === 'capture' ? { section: { topics: hits.length } } : undefined,
    }
  })
  const filters = vi.fn<PagefindApi['filters']>(async () => ({ port: { Go: 1, Rust: 1 } }))
  const handle = mountSearchPanel(root, '/en/pagefind/', {
    initialPort, initialQuery: 'capture', mock: { search, filters }, ...options.settings,
  })
  const query = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const results = () => [...root.querySelectorAll<HTMLAnchorElement>('.search-panel__result')].map((link) => link.getAttribute('href'))
  const filter = (port: string) => root.querySelector<HTMLInputElement>(`.search-panel__facet--port input[value="${port}"]`)!
  const scope = (value: string) => root.querySelector<HTMLButtonElement>(`button[data-scope="${value}"]`)!.click()
  const dialog = root.closest('dialog') as unknown as HTMLDialogElement | null
  return { root, input, search, filters, handle, query, results, filter, scope, dialog }
}

describe('port search defaults', () => {
  it('searches the port first, offers the wider scope on no results, and keeps the port when reopened', async () => {
    const { root, search, handle, query, results } = fixture('Go')
    await vi.waitFor(() => expect(results()).toEqual(['/en/go/latest/topics/capture/']))
    expect(search).toHaveBeenNthCalledWith(1, 'capture', { filters: { port: { any: ['Go', ROOT_PORT] } } })
    query('absent')
    await vi.waitFor(() => expect(results()).toEqual([]))
    expect(root.querySelector('.search-panel__widen')?.textContent).toBe('Search all languages')
    handle.clear()
    query('capture')
    await vi.waitFor(() => expect(results()).toEqual(['/en/go/latest/topics/capture/']))
  })

  it('includes the root tmux pages in the port scope and leaves them out of the API scope', async () => {
    const { results, scope, query } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    query('new-session')
    await vi.waitFor(() => expect(results()).toEqual(['/en/tmux/latest/manual/new-session/']))
    scope('reference')
    await vi.waitFor(() => expect(results()).toEqual([]))
  })

  it('lets a reader broaden to all languages, then pick ports, without the initial port returning', async () => {
    const { query, results, filter, scope } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    scope('all')
    await vi.waitFor(() => expect(results()).toHaveLength(2))
    filter('Rust').checked = true
    filter('Rust').dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(results()).toEqual(['/en/rs/latest/topics/capture/']))
    query('absent')
    await vi.waitFor(() => expect(results()).toEqual([]))
    expect(filter('Rust').checked).toBe(true)
  })

  it('leaves the root search across all ports', async () => {
    const { search, results, filter } = fixture()
    await vi.waitFor(() => expect(results()).toHaveLength(2))
    expect(search).toHaveBeenCalledWith('capture', { filters: undefined })
    expect(filter('Go').checked).toBe(false)
    expect(filter('Rust').checked).toBe(false)
  })

  it('keeps query counts when an older idle filter inventory finishes', async () => {
    const { root, filters, handle, query, results } = fixture()
    await vi.waitFor(() => expect(results()).toHaveLength(2))
    let release: (counts: Record<string, Record<string, number>>) => void = () => {}
    filters.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    handle.clear()
    await vi.waitFor(() => expect(filters).toHaveBeenCalledTimes(2))
    query('capture')
    await vi.waitFor(() => expect(results()).toHaveLength(2))
    const counts = () => [...root.querySelectorAll('.search-panel__facet--port .search-panel__filter-count')].map((count) => count.textContent)
    expect(counts()).toEqual(['1', '1'])
    release({ port: { Go: 100, Rust: 200 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(counts()).toEqual(['1', '1'])
    expect(results()).toHaveLength(2)
  })

  it('does not paint an old result after the reader changes the query', async () => {
    const { search, query, results, root } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    let release: (data: PagefindResultData) => void = () => {}
    const data = vi.fn(() => new Promise<PagefindResultData>((resolve) => { release = resolve }))
    search.mockResolvedValueOnce({ results: [{ id: 'slow', data }] })
    query('slow')
    await vi.waitFor(() => expect(data).toHaveBeenCalled())
    query('absent')
    await vi.waitFor(() => expect(root.textContent).toContain('No results for absent.'))
    release({ url: '/en/rs/latest/', excerpt: 'Stale', meta: { title: 'Stale' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(results()).toEqual([])
    expect(root.textContent).toContain('No results for absent.')
  })
})

describe('URL state and Back', () => {
  const snapshot = (over: Partial<SearchSnapshot> = {}): SearchSnapshot => ({
    q: 'long', scope: 'port', ports: [], shown: 24, selected: 11, scroll: 300, open: false, ...over,
  })

  it('reads ?q=&scope=&section=&kind= on the search page and writes them back as the reader changes them', async () => {
    const { results, scope, query, search } = fixture('Go', {
      url: 'https://libtmux.org/en/go/latest/search/?q=capture&scope=all&section=topics',
      settings: { url: true },
    })
    await vi.waitFor(() => expect(results()).toHaveLength(2))
    expect(search).toHaveBeenNthCalledWith(1, 'capture', { filters: { section: ['topics'] } })
    expect(window.location.search).toBe('?q=capture&scope=all&section=topics')
    scope('port')
    await vi.waitFor(() => expect(window.location.search).toBe('?q=capture&section=topics'))
    query('long')
    await vi.waitFor(() => expect(window.location.search).toBe('?q=long&section=topics'))
  })

  it('leaves the address alone in a dialog and keeps the router entry beside the snapshot', async () => {
    const { results } = fixture('Go', { dialog: true, state: { index: 4, scrollY: 90 } })
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    expect(window.location.search).toBe('')
    expect(window.history.state).toMatchObject({ index: 4, scrollY: 90 })
    expect(readSnapshot(window.history.state)).toMatchObject({ q: 'capture', scope: 'port', open: true })
  })

  it('restores the query, scope, shown count, chosen row and scroll after Back', async () => {
    const { root, results, input } = fixture('Go', {
      dialog: true, total: 40, state: withSnapshot({ index: 2 }, snapshot({ open: true })),
    })
    await vi.waitFor(() => expect(results()).toHaveLength(24))
    expect(input.value).toBe('long')
    const rows = [...root.querySelectorAll('.search-panel__result')]
    expect(rows[11]?.getAttribute('aria-selected')).toBe('true')
    expect((root.querySelector('.search-panel__results') as HTMLElement).scrollTop).toBe(300)
    expect(root.querySelector('.search-panel__status')?.textContent).toBe('40 results in Go docs and API · showing 24')
  })

  it('does not restore a dialog that was closed when the reader left', async () => {
    const { results, input } = fixture('Go', { dialog: true, total: 40, state: withSnapshot({}, snapshot({ open: false })) })
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    expect(input.value).toBe('capture')
  })

  it('stores the chosen row before a result opens', async () => {
    const { root, results } = fixture('Go', { dialog: true, total: 40, settings: { initialQuery: 'long' } })
    await vi.waitFor(() => expect(results()).toHaveLength(8))
    const rows = root.querySelectorAll<HTMLAnchorElement>('.search-panel__result')
    rows[5]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event)
    expect(readSnapshot(window.history.state)).toMatchObject({ q: 'long', selected: 5, shown: 8, open: true })
  })

  it('offers the Section and Kind facets with counts and clears them together', async () => {
    const { root, results, input } = fixture('Go', { total: 40, settings: { initialQuery: 'long' } })
    await vi.waitFor(() => expect(results()).toHaveLength(8))
    const sections = () => [...root.querySelectorAll('.search-panel__section-list .search-panel__filter')].map((row) => row.textContent)
    expect(sections()).toEqual(['Guides2', 'API reference40'])
    const pick = root.querySelector<HTMLInputElement>('.search-panel__section-list input[value="reference"]')!
    pick.checked = true
    pick.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(root.querySelector('.search-panel__clear')?.textContent).toBe('Clear 1 filter'))
    ;(root.querySelector('.search-panel__clear') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(root.querySelector('.search-panel__clear')).toBeNull())
    expect(input.value).toBe('long')
  })
})

describe('the dialog keeps its query on close', () => {
  it('undoes the field\'s own clearing on Escape, so the query is there when the dialog reopens', async () => {
    const { root, input, results } = fixture('Go', { dialog: true })
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    // What Chromium does to a search field on Escape: empty it and say so.
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event)
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(input.value).toBe('capture')
    expect(results()).toHaveLength(1)
    expect(root.querySelector('.search-panel__status')?.textContent).toContain('1 result')
  })

  it('leaves the field and results as they were when the dialog closes', async () => {
    const { root, input, results, dialog } = fixture('Go', { dialog: true })
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    dialog!.close()
    expect(input.value).toBe('capture')
    expect(results()).toHaveLength(1)
    expect(root.querySelector('.search-panel__status')?.textContent).toContain('1 result')
    // Closing records the dialog as shut, so Back does not reopen it.
    expect(readSnapshot(window.history.state)).toMatchObject({ q: 'capture', open: false })
  })
})
