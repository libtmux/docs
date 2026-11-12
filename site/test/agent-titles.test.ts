import { afterEach, expect, it, vi } from 'vitest'
import type { CollectionEntry } from 'astro:content'

const entries = vi.hoisted(() => [] as unknown[])
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => entries), render: vi.fn(async () => ({ headings: [] })) }))
import { llmsPages } from '../src/lib/llms'
import { markdownDocument } from '../src/lib/markdown-twins'
import { GET as manifest } from '../src/pages/docs.json'

afterEach(() => vi.unstubAllEnvs())

const page = (id: string, data: Record<string, unknown>) => ({
  id, filePath: `src/content/docs/${id}/index.md`, body: 'Body.', data: { description: 'About.', ...data },
}) as unknown as CollectionEntry<'docs'>

// `machine-readable.test.ts` asserts the same of the assembled site, which only CI builds.
it('titles a page in the manifest as its Markdown twin titles it', async () => {
  entries.splice(0, entries.length,
    page('ports/rs/workspace', {
      port: 'rs', product: 'workspace', title: 'tmux workspace manager, forged in Rust', shortTitle: 'Rust-based tmux workspace manager',
    }),
    page('ports/rs/mcp', { port: 'rs', product: 'mcp', title: 'tmux MCP, built in Rust' }))
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'rs')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  const origin = 'https://libtmux.org'
  const json = await (await manifest({ site: new URL(origin) } as Parameters<typeof manifest>[0])).json() as { pages: { title: string; url: string }[] }
  const twins = new Map((await llmsPages(origin, import.meta.env.BASE_URL)).map((entry) => [entry.url, markdownDocument(entry).split('\n')[0]!.replace(/^# /, '')]))
  const checked = json.pages.filter((entry) => twins.has(entry.url) && /\/(workspace|mcp)\/$/.test(new URL(entry.url).pathname))
  expect(checked, 'the two pages the test describes').toHaveLength(2)
  for (const entry of checked) expect(entry.title, entry.url).toBe(twins.get(entry.url))
  expect(checked.map((entry) => entry.title)).toEqual(['Rust-based tmux workspace manager', 'tmux MCP, built in Rust'])
})

it('lists no product or documentation area for a product a port does not ship', async () => {
  entries.splice(0, entries.length)
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  for (const scope of ['', 'lisp', 'lua']) {
    vi.stubEnv('LIBTMUX_DOCS_PORT', scope)
    const json = await (await manifest({ site: new URL('https://libtmux.org') } as Parameters<typeof manifest>[0])).json()
    if (scope) expect(json.ports.map((port: { slug: string }) => port.slug)).toEqual([scope])
    if (scope !== 'lua') {
      const lisp = json.ports.find((port: { slug: string }) => port.slug === 'lisp')
      expect(lisp.products.map((product: { slug: string }) => product.slug)).toEqual(['workspace'])
      expect(lisp.products[0]).toMatchObject({ availability: 'available', inDevelopment: true })
      expect(lisp.products[0].url).toMatch(/\/lisp\/latest\/workspace\/$/)
    }
    if (scope !== 'lisp') {
      const lua = json.ports.find((port: { slug: string }) => port.slug === 'lua')
      expect(lua.products).toEqual([])
      const areas = lua.documentation.map((area: { id: string }) => area.id)
      expect(areas).not.toContain('mcp')
      expect(areas).not.toContain('workspace')
    }
  }
})

it('lists no product for Erlang in the agent manifest', async () => {
  entries.splice(0, entries.length)
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'erlang')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'master')
  const json = await (await manifest({ site: new URL('https://libtmux.org') } as Parameters<typeof manifest>[0])).json()
  expect(json.ports).toHaveLength(1)
  expect(json.ports[0].slug).toBe('erlang')
  expect(json.ports[0].products).toEqual([])
  expect(json.ports[0].documentation.map((entry: { id: string }) => entry.id)).toEqual(['core'])
  expect(json.pages.some((entry: { url: string }) => /\/(mcp|workspace)\//.test(new URL(entry.url).pathname))).toBe(false)
})
