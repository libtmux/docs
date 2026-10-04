import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSearchPanel, type PagefindApi, type PagefindResultData } from '../src/lib/search-panel'

let window: Window
afterEach(() => {
  vi.unstubAllGlobals()
  window?.close()
})

function fixture(initialPort?: string) {
  window = new Window({ url: 'https://libtmux.org/en/go/latest/search/' })
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('Event', window.Event)
  window.document.body.innerHTML = `<div class="search-panel">
    <input class="search-panel__input">
    <aside class="search-panel__filters" hidden><div class="search-panel__filter-list"></div></aside>
    <div class="search-panel__results"></div>
  </div>`
  // Happy DOM implements the browser API with its own element types.
  const root = window.document.querySelector('.search-panel')! as unknown as HTMLElement
  const input = root.querySelector<HTMLInputElement>('input')!
  const pages = ['Go', 'Rust'].map((port) => ({
    port,
    data: {
      url: `/en/${port === 'Go' ? 'go' : 'rs'}/latest/topics/capture/`,
      excerpt: `${port} capture`,
      meta: { title: `${port} capture` },
    },
  }))
  const search = vi.fn<PagefindApi['search']>(async (query, options) => {
    const ports = (options?.filters as { port?: string[] } | undefined)?.port
    const hits = query === 'capture' ? pages.filter((page) => !ports || ports.includes(page.port)) : []
    const counts: Record<string, number> = query === 'capture' ? { Go: 1, Rust: 1 } : {}
    return {
      results: hits.map((page) => ({ id: page.port, data: async () => page.data })),
      totalFilters: { port: counts },
    }
  })
  const filters = vi.fn<PagefindApi['filters']>(async () => ({ port: { Go: 1, Rust: 1 } }))
  const handle = mountSearchPanel(root, '/en/pagefind/', {
    initialPort,
    initialQuery: 'capture',
    mock: { search, filters },
  })
  const query = (value: string) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const results = () =>
    [...root.querySelectorAll<HTMLAnchorElement>('.search-panel__result')].map((link) => link.getAttribute('href'))
  const filter = (port: string) => root.querySelector<HTMLInputElement>(`input[value="${port}"]`)!
  return { root, search, filters, handle, query, results, filter }
}

describe('port search defaults', () => {
  it('filters the first query, keeps a selected port with zero hits, and preserves it when reopened', async () => {
    const { search, handle, query, results, filter } = fixture('Go')
    await vi.waitFor(() => expect(results()).toEqual(['/en/go/latest/topics/capture/']))
    expect(search).toHaveBeenNthCalledWith(1, 'capture', { filters: { port: ['Go'] } })
    expect(filter('Go').checked).toBe(true)
    query('absent')
    await vi.waitFor(() => expect(results()).toEqual([]))
    expect(filter('Go').checked).toBe(true)
    handle.clear()
    query('capture')
    await vi.waitFor(() => expect(results()).toEqual(['/en/go/latest/topics/capture/']))
  })

  it('lets a reader broaden or change the scope without restoring the initial port', async () => {
    const { query, results, filter } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    filter('Go').checked = false
    filter('Go').dispatchEvent(new Event('change'))
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
    const { root, filters, handle, query, results, filter } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    let release: (counts: Record<string, Record<string, number>>) => void = () => {}
    filters.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    handle.clear()
    await vi.waitFor(() => expect(filters).toHaveBeenCalledOnce())
    query('capture')
    await vi.waitFor(() => expect(results()).toEqual(['/en/go/latest/topics/capture/']))
    const counts = () => [...root.querySelectorAll('.search-panel__filter-count')].map((count) => count.textContent)
    expect(counts()).toEqual(['1', '1'])
    release({ port: { Go: 100, Rust: 200 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(counts()).toEqual(['1', '1'])
    expect(filter('Go').checked).toBe(true)
    expect(results()).toEqual(['/en/go/latest/topics/capture/'])
  })

  it('does not paint an old result after the reader changes the query', async () => {
    const { search, query, results, root } = fixture('Go')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    let release: (data: PagefindResultData) => void = () => {}
    const data = vi.fn(
      () =>
        new Promise<PagefindResultData>((resolve) => {
          release = resolve
        }),
    )
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
