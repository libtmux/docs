import { afterEach, expect, it, vi } from 'vitest'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []), render: vi.fn(async () => ({ headings: [] })) }))
import { GET as manifest } from '../src/pages/docs.json'
import { DOC_PRODUCTS, PORTS, type DocProduct } from '../src/lib/ports'
import { documentationAreas } from '../src/lib/port-documentation'

afterEach(() => vi.unstubAllEnvs())

it.each(['', ...PORTS.map((port) => port.slug)])('exports declared product availability in the %s manifest', async (port) => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', port)
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  const json = await (await manifest({ site: new URL('https://libtmux.org') } as Parameters<typeof manifest>[0])).json()
  const ports = PORTS.filter((entry) => !port || entry.slug === port)
  expect(json.ports.map((entry: { slug: string }) => entry.slug)).toEqual(ports.map((entry) => entry.slug))
  for (const source of ports) {
    const actual = json.ports.find((entry: { slug: string }) => entry.slug === source.slug)
    const products = Object.keys(source.parentLibrary ? {} : DOC_PRODUCTS) as DocProduct[]
    expect(actual.products.map((entry: { slug: string }) => entry.slug)).toEqual(products)
    const areas = documentationAreas(source.slug).filter((area) => !area.product || source.productAvailability?.[area.product] !== 'excluded')
    expect(actual.documentation).toEqual(areas.map((area) => expect.objectContaining({
      id: area.id, kind: area.kind, availability: area.kind === 'unavailable' ? 'unpublished' : 'available',
    })))
    for (const product of products) {
      const metadata = actual.products.find((entry: { slug: string }) => entry.slug === product)
      const availability = source.productAvailability?.[product] ?? 'available'
      expect(metadata.availability, `${source.slug} ${product}`).toBe(availability)
      expect(metadata.reference).toEqual(availability === 'available' ? expect.any(String) : null)
      if (product === 'mcp') expect(metadata.protocol).toEqual(availability === 'available' ? expect.any(String) : null)
      if (availability === 'excluded') {
        expect(metadata.url).toBeNull()
      } else {
        expect(metadata.url).toMatch(new RegExp(`/${source.slug}/latest/${product}/$`))
      }
    }
  }
})
