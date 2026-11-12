import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sourceGuideRedirects } from '../src/lib/docs-paths'
import { documentationAreas, SOURCE_GUIDE_PORTS, sourceGuideRedirectsFor, sourceGuidesFor } from '../src/lib/port-documentation'
import { INVENTORY } from '../src/lib/port-inventory'
import { DOC_PRODUCTS, PORT_BY_SLUG, PORTS, productAvailable, productExcluded, type DocProduct } from '../src/lib/ports'

/**
 * The ports whose repository publishes no server (MCP) or loader (workspace).
 * A scaffold directory, a guide to another port's server, or a tool built only
 * from source is not a published product: the site builds no page for it and
 * links to none. Ports that wrap another library ship neither and are excluded
 * through `parentLibrary`.
 */
const WITHOUT: Record<DocProduct, readonly string[]> = {
  mcp: ['lua', 'powershell', 'erlang', 'elixir', 'haskell', 'lisp', 'ocaml', 'perl'],
  workspace: ['lua', 'elixir', 'haskell', 'erlang'],
}

/** Product roots that were public before their port stopped claiming the product. */
const RETIRED: Record<string, readonly DocProduct[]> = {
  lua: ['mcp', 'workspace'], elixir: ['mcp', 'workspace'], haskell: ['workspace'], erlang: ['workspace'], powershell: ['mcp'],
}

const products = Object.keys(DOC_PRODUCTS) as DocProduct[]
const absent = PORTS.flatMap((port) => products
  .filter((product) => port.parentLibrary || WITHOUT[product].includes(port.slug))
  .map((product) => [port.slug, product] as const))

const contentDirectory = (slug: string, product: DocProduct) =>
  new URL(`../src/content/docs/ports/${slug}/${product}`, import.meta.url)

describe('excluded companion products', () => {
  it('does not advertise an excluded product as available', () => {
    const port = { ...PORT_BY_SLUG.elixir!, productAvailability: { mcp: 'excluded' as const } }
    expect(productAvailable(port, 'mcp')).toBe(false)
    expect(productExcluded(port, 'mcp')).toBe(true)
    expect(productAvailable(port, 'workspace')).toBe(true)
  })

  it('has no state between shipped and excluded', () => {
    for (const port of PORTS) {
      for (const state of Object.values(port.productAvailability ?? {})) expect(['available', 'excluded'], port.slug).toContain(state)
    }
  })
})

describe('products a port does not ship', () => {
  it.each(PORTS.map((port) => [port.slug] as const))('%s lists exactly the products its repository publishes', (slug) => {
    const port = PORT_BY_SLUG[slug]!
    for (const product of products) {
      expect(productAvailable(port, product), `${slug} ${product}`).toBe(!port.parentLibrary && !WITHOUT[product].includes(slug))
    }
  })

  it.each(absent)('%s has no %s content page', (slug, product) => {
    expect(existsSync(contentDirectory(slug, product)), `${slug} ${product}`).toBe(false)
  })

  it.each(absent)('%s declares no %s documentation area', (slug, product) => {
    if (PORT_BY_SLUG[slug]!.parentLibrary) return
    expect(documentationAreas(slug).filter((area) => area.product === product), `${slug} ${product}`).toEqual([])
  })

  it('stages no guide at the root of a product the port does not ship', () => {
    for (const slug of SOURCE_GUIDE_PORTS) {
      for (const product of products.filter((entry) => !productAvailable(PORT_BY_SLUG[slug]!, entry))) {
        const claimed = sourceGuidesFor(slug).flatMap((guide) => [guide.route, ...guide.aliases])
          .filter((route) => route === product || route.startsWith(`${product}/`) || route === `guides/${product}`)
        expect(claimed, `${slug} ${product}`).toEqual([])
      }
    }
  })

  it('shows no package or source row for a product in the port header', () => {
    for (const port of PORTS) {
      const shown = (INVENTORY[port.slug] ?? []).filter((entry) => entry.status === 'published' || entry.sourceAvailable)
      expect(shown.filter((entry) => entry.product !== 'core' && !productAvailable(port, entry.product)).map((entry) => entry.id), port.slug).toEqual([])
    }
  })

  it('refuses a documentation area or source guide for an excluded product', () => {
    for (const [slug, product, read] of [
      ['perl', 'workspace', () => documentationAreas('perl')],
      ['perl', 'workspace', () => sourceGuidesFor('perl')],
    ] as const) {
      const port = PORT_BY_SLUG[slug]!
      const before = port.productAvailability
      expect(read, `${slug} ${product} while shipped`).not.toThrow()
      try {
        port.productAvailability = { ...before, [product]: 'excluded' }
        expect(read, `${slug} ${product}`).toThrow(/excluded product/)
      } finally { port.productAvailability = before }
    }
  })

  it('answers each retired product URL with a redirect to the language home', () => {
    for (const [slug, retired] of Object.entries(RETIRED)) {
      expect(sourceGuideRedirectsFor(slug).filter((entry) => retired.includes(entry.path as DocProduct))
        .map((entry) => [entry.path, entry.target]).sort(), slug).toEqual(retired.map((product) => [product, '']).sort())
      expect(sourceGuideRedirects(slug).filter((entry) => retired.includes(entry.path as DocProduct)).map((entry) => entry.target), slug)
        .toEqual(retired.map(() => ''))
      const root = sourceGuideRedirects().filter((entry) => retired.some((product) => entry.path === `${slug}/latest/${product}`))
      expect(root.map((entry) => entry.target), `${slug} root build`).toEqual(retired.map(() => `${slug}/latest`))
    }
  })

  it('sends the former PowerShell MCP guide to the PowerShell home', () => {
    expect(sourceGuideRedirects('powershell')).toContainEqual({ path: 'guides/mcp', target: '' })
    expect(sourceGuideRedirects().find((entry) => entry.path === 'powershell/latest/guides/mcp')?.target).toBe('powershell/latest')
  })

  it('sends the former Erlang workspace loader guide to the Erlang home', () => {
    // docs/workspaces.md left libtmux-erlang with its unpublished Workspace application.
    expect(sourceGuidesFor('erlang').map((guide) => guide.sourcePath)).not.toContain('docs/workspaces.md')
    expect(sourceGuideRedirects('erlang')).toContainEqual({ path: 'guides/workspace-json', target: '' })
    expect(sourceGuideRedirects().find((entry) => entry.path === 'erlang/latest/guides/workspace-json')?.target).toBe('erlang/latest')
  })

  it('redirects a product root only for a product the port does not ship', () => {
    for (const port of PORTS.filter((entry) => !entry.parentLibrary)) {
      for (const product of products) {
        if (!sourceGuideRedirectsFor(port.slug).some((entry) => entry.path === product)) continue
        expect(productAvailable(port, product), `${port.slug} ${product}`).toBe(false)
      }
    }
  })
})
