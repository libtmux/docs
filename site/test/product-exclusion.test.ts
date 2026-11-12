import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sourceGuideRedirects } from '../src/lib/docs-paths'
import { documentationAreas, sourceGuideRedirectsFor, sourceGuidesFor } from '../src/lib/port-documentation'
import { INVENTORY } from '../src/lib/port-inventory'
import { DOC_PRODUCTS, PORT_BY_SLUG, PORTS, productAvailable, productIncluded, type DocProduct, type Port } from '../src/lib/ports'

/**
 * The ports whose repository ships no server (MCP) or loader (workspace). A
 * scaffold directory with no executable, protocol catalog or loader is not a
 * product: the site builds no page for it and links to none. Ports that wrap
 * another library ship neither and are excluded through `parentLibrary`.
 */
const WITHOUT: Record<DocProduct, readonly string[]> = {
  mcp: ['lua', 'powershell', 'erlang', 'elixir', 'haskell', 'lisp', 'ocaml', 'perl'],
  workspace: ['lua', 'elixir', 'haskell'],
}

/** Product roots that were public before their port stopped claiming the product. */
const RETIRED: Record<string, readonly DocProduct[]> = { lua: ['mcp', 'workspace'], elixir: ['mcp', 'workspace'], haskell: ['workspace'] }

const absent = PORTS.flatMap((port) => (Object.keys(DOC_PRODUCTS) as DocProduct[])
  .filter((product) => port.parentLibrary || WITHOUT[product].includes(port.slug))
  .map((product) => [port.slug, product] as const))

const contentDirectory = (slug: string, product: DocProduct) =>
  new URL(`../src/content/docs/ports/${slug}/${product}`, import.meta.url)

describe('excluded companion products', () => {
  it('does not advertise an excluded MCP implementation as available', () => {
    const port = { ...PORT_BY_SLUG.elixir, productAvailability: { mcp: 'excluded' } } as unknown as Port
    expect(productAvailable(port, 'mcp')).toBe(false)
    expect(productIncluded(port, 'mcp')).toBe(false)
    const unpublished = { ...port, productAvailability: { mcp: 'unpublished' as const } }
    expect(productAvailable(unpublished, 'mcp')).toBe(false)
    expect(productIncluded(unpublished, 'mcp')).toBe(true)
  })
})

describe('products a port does not ship', () => {
  it.each(PORTS.map((port) => [port.slug] as const))('%s includes exactly the products its repository ships', (slug) => {
    const port = PORT_BY_SLUG[slug]!
    for (const product of Object.keys(DOC_PRODUCTS) as DocProduct[]) {
      expect(productIncluded(port, product), `${slug} ${product}`).toBe(!port.parentLibrary && !WITHOUT[product].includes(slug))
    }
  })

  it.each(absent)('%s has no %s content page', (slug, product) => {
    expect(existsSync(contentDirectory(slug, product)), `${slug} ${product}`).toBe(false)
  })

  it.each(absent)('%s declares no %s documentation area', (slug, product) => {
    if (PORT_BY_SLUG[slug]!.parentLibrary) return
    expect(documentationAreas(slug).filter((area) => area.product === product), `${slug} ${product}`).toEqual([])
  })

  it('shows no package or source row for a product in the port header', () => {
    for (const port of PORTS) {
      const shown = (INVENTORY[port.slug] ?? []).filter((entry) => entry.status === 'published' || entry.sourceAvailable)
      expect(shown.filter((entry) => entry.product !== 'core' && !productIncluded(port, entry.product)).map((entry) => entry.id), port.slug).toEqual([])
    }
  })

  it('refuses a documentation area or source guide for an excluded product', () => {
    for (const [slug, product, read] of [
      ['erlang', 'workspace', () => documentationAreas('erlang')],
      ['perl', 'workspace', () => sourceGuidesFor('perl')],
    ] as const) {
      const port = PORT_BY_SLUG[slug]!
      const before = port.productAvailability
      expect(read, `${slug} ${product} while included`).not.toThrow()
      try {
        port.productAvailability = { ...before, [product]: 'excluded' }
        expect(read, `${slug} ${product}`).toThrow(/excluded product/)
      } finally { port.productAvailability = before }
    }
  })

  it('answers each retired product URL with a redirect to the language home', () => {
    for (const [slug, products] of Object.entries(RETIRED)) {
      expect(sourceGuideRedirectsFor(slug).filter((entry) => products.includes(entry.path as DocProduct))
        .map((entry) => [entry.path, entry.target]).sort(), slug).toEqual(products.map((product) => [product, '']).sort())
      expect(sourceGuideRedirects(slug).filter((entry) => products.includes(entry.path as DocProduct)).map((entry) => entry.target), slug)
        .toEqual(products.map(() => ''))
      const root = sourceGuideRedirects().filter((entry) => entry.path.startsWith(`${slug}/latest/`) && products.some((product) => entry.path === `${slug}/latest/${product}`))
      expect(root.map((entry) => entry.target), `${slug} root build`).toEqual(products.map(() => `${slug}/latest`))
    }
  })

  it('redirects a product root only for a product the port does not ship', () => {
    for (const port of PORTS.filter((entry) => !entry.parentLibrary)) {
      for (const product of Object.keys(DOC_PRODUCTS) as DocProduct[]) {
        if (!sourceGuideRedirectsFor(port.slug).some((entry) => entry.path === product)) continue
        expect(productIncluded(port, product), `${port.slug} ${product}`).toBe(false)
      }
    }
  })
})
