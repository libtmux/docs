import { afterEach, expect, it, vi } from 'vitest'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []), render: vi.fn(async () => ({ headings: [] })) }))
import { GET as manifest } from '../src/pages/docs.json'

afterEach(() => vi.unstubAllEnvs())

it.each(['', 'haskell'])('keeps excluded products distinct from unpublished overviews in the %s manifest', async (port) => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', port)
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  const json = await (await manifest({ site: new URL('https://libtmux.org') } as Parameters<typeof manifest>[0])).json()
  const haskell = json.ports.find((entry: { slug: string }) => entry.slug === 'haskell')
  expect(haskell.products).toEqual(expect.arrayContaining([
    expect.objectContaining({ slug: 'mcp', availability: 'excluded', url: null, reference: null, protocol: null }),
    expect.objectContaining({ slug: 'workspace', availability: 'unpublished', url: expect.stringMatching(/\/haskell\/latest\/workspace\/$/), reference: null }),
  ]))
  expect(haskell.documentation.map((area: { id: string }) => area.id)).not.toContain('mcp')
  expect(haskell.documentation).toContainEqual(expect.objectContaining({ id: 'workspace', availability: 'unpublished' }))
})
