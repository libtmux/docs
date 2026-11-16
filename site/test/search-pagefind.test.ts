import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { buildIndex, type FixtureIndex } from './search-fixture'

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
      '/en/tmux/latest/manual/new-session/': ['manual'],
    })
    expect((await index.api.filters()).section).toEqual({ guides: 1, reference: 1, examples: 1, manual: 1 })
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
