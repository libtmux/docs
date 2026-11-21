import { Window } from 'happy-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { go, options, symbolOf } from './api-page-fixtures'
import { buildIndex, type FixtureIndex, type FixturePage } from './search-fixture'
import { normalizedNativePages } from './native-fixture'
import { mountSearchPanel } from '../src/lib/search-panel'
import type { ApiTreeJson } from '../src/lib/api-search'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
vi.setConfig({ testTimeout: 60_000 })

/**
 * What the build hands to Pagefind, indexed by Pagefind and searched with its own client (adoption
 * steps 3 and 5): the filters the Section facet and the scopes read, the text an excerpt opens with,
 * and the order of the results.
 */
const SOURCE = { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/index.astro' }

const env = () => {
  vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
}

describe('the filters of a page through the real layout', () => {
  let index: FixtureIndex

  beforeAll(async () => {
    env()
    const layout = await loadAstroTemplate('layouts/BaseLayout.astro')
    const page = async (path: string, props: Record<string, unknown>, body: string) => ({
      url: `/en/${path}/`,
      html: await renderAstroTemplate(layout, {
        url: `https://libtmux.org/en/${path}/`,
        props: { title: path, pageSource: SOURCE, ...props },
        slots: { default: `<main><h1>${path}</h1><p>${body}</p></main>` },
      }),
    })
    index = await buildIndex([
      await page('go/latest/guides/capturing-output', { pagePath: 'guides/capturing-output', portSlug: 'go' }, 'Read the lines of a pane with capture.'),
      await page('go/latest/reference/tmux-pane-capture', { pagePath: 'reference/tmux-pane-capture', portSlug: 'go' }, 'Capture reads a pane.'),
      await page('go/latest/examples/capture-pane-output', { pagePath: 'examples/capture-pane-output', portSlug: 'go' }, 'A runnable capture.'),
      await page('tmux/latest/manual/new-session', { pagePath: 'tmux/latest/manual/new-session' }, 'Create a session, then capture its panes.'),
      // Pages that fit none of the site's seven sections, which the facet once listed by their folder (record 0075).
      await page('go/latest/core/programs', { pagePath: 'core/programs', portSlug: 'go' }, 'Programs for the core library.'),
      await page('search', { pagePath: 'search' }, 'Find pages.'),
    ])
  })
  afterAll(async () => {
    await index?.close()
    vi.unstubAllEnvs()
  })

  it('indexes the section of each page, so the Section facet and the API scope have data', async () => {
    const found = Object.fromEntries((await index.pages()).map((page) => [page.url, page.filters.section]))
    expect(found).toEqual({
      '/en/go/latest/guides/capturing-output/': ['guides'],
      '/en/go/latest/reference/tmux-pane-capture/': ['reference'],
      '/en/go/latest/examples/capture-pane-output/': ['examples'],
      // No marker at all for a page that fits none of the seven: the tmux manual, a Core directory, the search page.
      '/en/tmux/latest/manual/new-session/': undefined,
      '/en/go/latest/core/programs/': undefined,
      '/en/search/': undefined,
    })
    expect((await index.api.filters()).section, 'the facet holds the seven sections and nothing else').toEqual({ guides: 1, reference: 1, examples: 1 })
  })

  it('finds the Go API pages through the API scope and the root pages through the port scope', async () => {
    const urls = async (filters: Record<string, unknown>) => {
      const { results } = await index.api.search('capture', { filters })
      return (await Promise.all(results.map((result) => result.data()))).map((data) => data.url).sort()
    }
    expect(await urls({ port: ['Go'], section: ['reference'] })).toEqual(['/en/go/latest/reference/tmux-pane-capture/'])
    expect(await urls({ port: { any: ['Go', 'All languages'] } })).toHaveLength(4)
    expect(await urls({ port: ['Go'] })).toHaveLength(3)
  })

  it('adds no text for the section marker to the page', async () => {
    const guide = (await index.pages()).find((page) => page.url.includes('/guides/'))
    expect(guide?.content).toBe('go/latest/guides/capturing-output. Read the lines of a pane with capture.')
  })
})

/**
 * Python's Sphinx pages reach the index through the native normalizer, not the Astro layout. A reader who
 * sets the Section facet must get them with the section the layout would have written.
 */
describe('the filters of a native Python page', () => {
  let index: FixtureIndex
  let native: Awaited<ReturnType<typeof normalizedNativePages>>

  beforeAll(async () => {
    env()
    const layout = await loadAstroTemplate('layouts/BaseLayout.astro')
    native = await normalizedNativePages(['api/pane/', 'quickstart/', 'topics/architecture/'])
    index = await buildIndex([
      {
        url: '/en/py/latest/guides/getting-started/',
        html: await renderAstroTemplate(layout, {
          url: 'https://libtmux.org/en/py/latest/guides/getting-started/',
          props: { title: 'Getting started', pagePath: 'guides/getting-started', portSlug: 'py', pageSource: SOURCE },
          slots: { default: '<main><h1>Getting started</h1><p>Install, then capture a pane.</p></main>' },
        }),
      },
      ...Object.entries(native.html).map(([path, html]) => ({ url: native.urls[path]!, html })),
    ])
  })
  afterAll(async () => {
    await index?.close()
    vi.unstubAllEnvs()
  })

  const urls = async (filters: Record<string, unknown>) => {
    const { results } = await index.api.search('capture', { filters })
    return (await Promise.all(results.map((result) => result.data()))).map((data) => data.url).sort()
  }

  it('indexes the section of each native page beside its port', async () => {
    const found = Object.fromEntries((await index.pages()).map((page) => [page.url, [page.filters.port, page.filters.section]]))
    expect(found).toEqual({
      '/en/py/latest/guides/getting-started/': [['Python'], ['guides']],
      '/en/py/latest/api/api/pane/': [['Python'], ['reference']],
      '/en/py/latest/api/quickstart/': [['Python'], ['guides']],
      '/en/py/latest/api/topics/architecture/': [['Python'], ['topics']],
    })
  })

  it('returns the native API page for section=reference with port=Python, and the Python guides for section=guides', async () => {
    expect(await urls({ port: ['Python'], section: ['reference'] })).toEqual(['/en/py/latest/api/api/pane/'])
    expect(await urls({ port: ['Python'], section: ['guides'] })).toEqual(['/en/py/latest/api/quickstart/', '/en/py/latest/guides/getting-started/'])
  })

  it('adds no text for the section marker to a native page', async () => {
    const page = (await index.pages()).find((entry) => entry.url === '/en/py/latest/api/api/pane/')
    expect(page?.content).toBe('api/pane/ Native page text for capture.')
  })
})

/** The first paint of the real reference sidebar: its head, search field, owner picker and actions. */
async function referenceSidebar() {
  const template = await loadAstroTemplate('components/api/ApiTree.astro', {
    real: ['components/api/ApiTreeItems.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/docs/SidebarHead.astro'],
  })
  const inventory: ApiTreeJson = {
    port: 'go',
    buckets: [{ id: 'go', label: 'API reference', count: 1, slug: 'pane', types: [], children: [
      { id: 'tmux', label: 'tmux', count: 1, slug: null, types: [{ id: 'Pane', name: 'Pane', slug: 'tmux-pane', m: 1, kind: 'struct', category: 'types' }], children: [] },
    ] }],
    members: { Pane: [['Capture', 'tmux-pane-capture', 'Pane.Capture', 'method']] },
  }
  return renderAstroTemplate(template, { props: {
    presentation: 'outline', inventory, selectedSymbol: 'Pane.Capture', referenceBase: '/en/go/latest/reference/', portName: 'Go', tree: [], members: [],
    withMembers: new Set(), currentPath: '/en/go/latest/reference/tmux-pane-capture/', version: 'test', treeLabel: 'Go API',
    head: { up: { label: 'Core Library API reference', href: '/en/go/latest/reference/' }, title: { label: 'Go API', href: '/en/go/latest/' } },
  } })
}

describe('the text a result opens with', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('opens an API page with its heading and summary, not the symbol tree beside them', async () => {
    env()
    const layout = await loadAstroTemplate('layouts/BaseLayout.astro')
    const html = await renderAstroTemplate(layout, {
      url: 'https://libtmux.org/en/go/latest/reference/tmux-pane-capture/',
      props: { title: 'Pane.Capture', pagePath: 'reference/tmux-pane-capture', portSlug: 'go', pageSource: SOURCE },
      slots: { default: `<main>${await referenceSidebar()}<div class="api-reference-content"><h1>Pane.Capture</h1><p>Capture captures printed content.</p></div></main>` },
    })
    const index = await buildIndex([{ url: '/en/go/latest/reference/tmux-pane-capture/', html }])
    try {
      const [page] = await index.pages()
      expect(page!.content).toBe('Pane.Capture. Capture captures printed content.')
    } finally { await index.close() }
  })

  it('opens a guide with its title, not the navigation drawer, the sidebar or the contents lists', async () => {
    env()
    const docs = await loadAstroTemplate('layouts/DocsLayout.astro', {
      real: ['layouts/BaseLayout.astro', 'components/MobileToC.astro', 'components/TableOfContents/TableOfContents.astro', 'components/TableOfContents/TableOfContentsList.astro'],
      stubs: { 'components/docs/Sidebar.astro': '<nav class="sidebar-nav"><a href="/en/go/latest/guides/other/">Other guide</a></nav>' },
    })
    const html = await renderAstroTemplate(docs, {
      url: 'https://libtmux.org/en/go/latest/guides/capturing-output/',
      props: {
        title: 'Capturing output', port: 'go', pagePath: 'guides/capturing-output', version: 'latest', locale: 'en', pagePorts: [], pageSource: SOURCE,
        headings: [{ depth: 2, slug: 'choose-a-range', text: 'Choose a range' }],
      },
      slots: { default: '<p>Pane.Capture takes a request.</p>' },
    })
    const index = await buildIndex([{ url: '/en/go/latest/guides/capturing-output/', html }])
    try {
      const [page] = await index.pages()
      expect(page!.content).toBe('Capturing output. Pane.Capture takes a request.')
    } finally { await index.close() }
  })
})

/**
 * "capture pane" in the Go scope, over the real Go reference pages for the symbols that mention both words:
 * the request type with its fields, the errors and positions it names, and the methods of Pane.
 */
describe('ranking "capture pane" in the Go scope', () => {
  const SYMBOLS = [
    'tmux.Pane', 'tmux.Pane.Capture', 'tmux.Pane.CaptureBytes', 'tmux.Pane.CaptureTo', 'tmux.Pane.CaptureToFile', 'tmux.Pane.CaptureToBuffer',
    'tmux.Pane.Title', 'tmux.Pane.Width', 'tmux.Pane.Height', 'tmux.Pane.Active',
    'tmux.CapturePaneRequest', ...go.symbols.filter((symbol) => symbol.parent === 'tmux.CapturePaneRequest').map((symbol) => symbol.id),
    'tmux.CaptureRequestError', 'tmux.CaptureRequestError.Field', 'tmux.CaptureRequestError.Reason',
    'tmux.CapturePosition', 'tmux.CaptureBoundary', 'tmux.CaptureLine', 'tmux.ErrInvalidCaptureRequest',
  ]
  let index: FixtureIndex
  let window: Window

  beforeAll(async () => {
    env()
    const reference = await loadAstroTemplate('components/api/ApiReference.astro', options)
    const layout = await loadAstroTemplate('layouts/BaseLayout.astro')
    const sidebar = await referenceSidebar()
    const pages: FixturePage[] = []
    for (const id of SYMBOLS) {
      const owner = symbolOf(go, id)
      const path = `go/latest/reference/${owner.slug}`
      const body = withoutScope(await renderAstroTemplate(reference, { url: `https://libtmux.org/en/${path}/`, props: { model: go, owner } }))
      pages.push({
        url: `/en/${path}/`,
        html: await renderAstroTemplate(layout, {
          url: `https://libtmux.org/en/${path}/`,
          props: { title: owner.name, pagePath: `reference/${owner.slug}`, portSlug: 'go', pageSource: SOURCE },
          slots: { default: `<main>${sidebar}${body}</main>` },
        }),
      })
    }
    index = await buildIndex(pages)
  })
  afterAll(async () => {
    window?.close()
    await index?.close()
    vi.unstubAllEnvs()
  })

  it('puts the request type and its fields above the method a reader meant, in Pagefind\'s own order', async () => {
    const { results } = await index.api.search('capture pane', { filters: { port: ['Go'] } })
    const order = (await Promise.all(results.map((result) => result.data()))).map((data) => data.meta.title)
    expect(order[0]).toMatch(/^Capture/)
    expect(order.indexOf('Pane.Capture')).toBeGreaterThan(0)
  })

  /** The panel on a page at `url`, searching the fixture index with Pagefind's own client. */
  function mount(url: string, settings: Partial<Parameters<typeof mountSearchPanel>[2]> = {}) {
    window?.close()
    window = new Window({ url })
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('Event', window.Event)
    vi.stubGlobal('CustomEvent', window.CustomEvent)
    vi.stubGlobal('location', window.location)
    vi.stubGlobal('history', window.history)
    window.document.body.innerHTML = `<div class="search-panel">
      <input class="search-panel__input">
      <div class="search-panel__scope"><button data-scope="port"></button><button data-scope="reference"></button><button data-scope="all"></button></div>
      <aside class="search-panel__filters" hidden>
        <div class="search-panel__facet search-panel__facet--section" hidden><div class="search-panel__filter-list search-panel__section-list"></div></div>
        <div class="search-panel__facet search-panel__facet--kind" hidden><div class="search-panel__filter-list search-panel__kind-list"></div></div>
        <div class="search-panel__facet search-panel__facet--port"><div class="search-panel__filter-list"></div></div>
      </aside>
      <div class="search-panel__results"></div></div>`
    const root = window.document.querySelector('.search-panel')! as unknown as HTMLElement
    const handle = mountSearchPanel(root, '/en/pagefind/', { initialPort: 'Go', mock: index.api, ...settings })
    const rows = (list: string) => [...root.querySelectorAll(`${list} .search-panel__filter`)].map((row) => row.textContent)
    return { root, handle, rows }
  }

  it('shows Pane.Capture first in the panel, and opens its excerpt with the page, not the tree', async () => {
    const { root } = mount('https://libtmux.org/en/go/latest/search/', { initialQuery: 'capture pane' })
    await vi.waitFor(() => expect(root.querySelector('.search-panel__result')).not.toBeNull())
    const first = root.querySelector('.search-panel__result')!
    expect(first.getAttribute('href')).toBe('/en/go/latest/reference/tmux-pane-capture/')
    expect(first.querySelector('.search-panel__result-excerpt')?.textContent).toMatch(/^Pane\.Capture/)
  })

  it('offers the Section and Kind facets for a search that arrives by URL, with the counts of every group', async () => {
    const port = mount('https://libtmux.org/en/go/latest/search/?q=capture', { url: true })
    await port.handle.ready
    expect(port.rows('.search-panel__section-list')).toEqual([expect.stringMatching(/^API reference\d+$/)])
    const api = mount('https://libtmux.org/en/go/latest/search/?q=capture&scope=reference', { url: true })
    await api.handle.ready
    expect(api.rows('.search-panel__kind-list').length).toBeGreaterThan(1)
    expect(api.root.querySelector('.search-panel__status')?.textContent).toContain('results in Go API only')
  })
})
