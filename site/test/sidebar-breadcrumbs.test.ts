import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { API_MODELS, API_NAV } from '../src/lib/api-models'
import { bucketAncestors, referenceBreadcrumbs, type TreeBucket } from '../src/lib/api-tree'
import { pageBreadcrumbs, sidebarBreadcrumbs, withSidebarBreadcrumbs } from '../src/lib/sidebar'
import { referenceUrl, PORT_BY_SLUG } from '../src/lib/ports'
import { tmuxReferenceContext, tmuxSourceModel } from '../src/lib/tmux-reference'

afterEach(() => vi.unstubAllEnvs())

describe('sidebar-derived breadcrumbs', () => {
  it('retains Scala category and declaration ancestors with real index targets', async () => {
    const model = API_MODELS.scala
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.generated.PaneFields.active')!
    const crumbs = await pageBreadcrumbs('PaneFields.active', `reference/${symbol.slug}`, 'latest', 'scala')
    const base = referenceUrl(PORT_BY_SLUG.scala, 'latest')
    expect(crumbs.map((entry) => entry.name)).toEqual(['Scala', 'API reference', 'Queries', 'Fields', 'PaneFields', 'active'])
    expect(crumbs[2].url).toBe(`${base}#section-queries`)
    expect(crumbs[3].url).toBe(`${base}#section-queries-fields`)
    expect(crumbs[4].url).toBe(`${base}io-github-libtmux-scaladsl-generated-panefields/`)
    expect(crumbs.at(-1)?.url).toBe(`${base}${symbol.slug}/`)
  })

  it('uses a cmdlet’s own sidebar placement rather than its unrelated module', async () => {
    const symbol = API_MODELS.powershell.symbols.find((entry) => entry.name === 'Get-TmuxPane')!
    const crumbs = await pageBreadcrumbs(symbol.name, `reference/${symbol.slug}`, 'latest', 'powershell')
    expect(crumbs.map((entry) => entry.name)).toEqual(['PowerShell', 'API reference', 'Pane', 'Get-TmuxPane'])
  })

  it('uses a canonical Julia function placement instead of a contextual shortcut', async () => {
    const symbol = API_MODELS.julia.symbols.find((entry) => entry.id === 'LibTmux.snapshot')!
    const crumbs = await pageBreadcrumbs(symbol.name, `reference/${symbol.slug}`, 'latest', 'julia')
    expect(crumbs.map((entry) => entry.name)).toEqual(['Julia', 'API reference', 'Snapshots', 'snapshot'])
  })

  it('includes the native C reference category and owning declaration', () => {
    const model = tmuxSourceModel('3.2a')
    const symbol = model.symbols.find((entry) => entry.parent === 'c:struct:window_pane')!
    const crumbs = tmuxReferenceContext('3.2a', symbol).breadcrumbs
    expect(crumbs.map((entry) => entry.name)).toEqual(['tmux', 'Reference (3.2a)', 'Pane', 'window_pane', symbol.name])
  })

  it('retains deeper grouping-only ancestors without linking them to an unrelated declaration', () => {
    const original = API_MODELS.scala
    const owner = original.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.generated.PaneFields')!
    const member = original.symbols.find((entry) => entry.parent === owner.id)!
    const model = { ...original, symbols: [owner, member] }
    const tree: TreeBucket[] = [{ id: 'queries', label: 'Queries', collapsed: false, entries: [], children: [
      { id: 'fields', label: 'Fields', collapsed: false, entries: [], children: [
        { id: 'pane', label: 'Pane fields', collapsed: false, children: [], entries: [
          { id: owner.id, name: 'PaneFields', slug: owner.slug!, kind: owner.kind },
        ] },
      ] },
    ] }]
    const nav = { ...API_NAV.scala, placement: { [owner.id]: 'pane' } }
    const crumbs = referenceBreadcrumbs(model, nav, tree, member, '/en/scala/v0.46.2/reference/', (entry) => `/en/scala/v0.46.2/reference/${entry.slug}/`)
    expect(crumbs.map((entry) => entry.name)).toEqual(['Queries', 'Fields', 'Pane fields', 'PaneFields', member.name])
    expect(crumbs.slice(0, 2).every((entry) => entry.url === undefined)).toBe(true)
    expect(crumbs[2].url).toBe('/en/scala/v0.46.2/reference/#section-pane')
    expect(bucketAncestors(tree, 'pane').map((bucket) => bucket.id)).toEqual(['queries', 'fields', 'pane'])
  })

  it('uses actual nested sidebar labels and retains a namespace without a page', () => {
    const items = [{ type: 'group' as const, label: 'Language API', href: '/ja/julia/v0.46.2/mcp/reference/', items: [
      { type: 'group' as const, label: 'ModelContextProtocol', kind: 'module', items: [
        { type: 'group' as const, label: 'Application', kind: 'struct', href: '/ja/julia/v0.46.2/mcp/reference/application/', items: [
          { type: 'link' as const, label: 'close', kind: 'method', href: '/ja/julia/v0.46.2/mcp/reference/application-close/' },
        ] },
      ] },
    ] }]
    const prefix = [{ name: 'Julia', url: '/ja/julia/v0.46.2/' }, { name: 'MCP', url: '/ja/julia/v0.46.2/mcp/' },
      { name: 'API reference', url: '/ja/julia/v0.46.2/mcp/reference/' },
      { name: 'Application.close', url: '/ja/julia/v0.46.2/mcp/reference/application-close/' }]
    const crumbs = withSidebarBreadcrumbs(prefix, items, '/ja/julia/v0.46.2/mcp/reference/application-close/?mode=full#parameter')
    expect(crumbs.map((entry) => entry.name)).toEqual(['Julia', 'MCP', 'API reference', 'ModelContextProtocol', 'Application', 'close'])
    expect(crumbs[3].url).toBeUndefined()
    expect(crumbs.at(-1)?.symbol).toBe(true)
    expect(sidebarBreadcrumbs(items, '/ja/julia/latest/mcp/reference/application-close/')).toEqual([])
    expect(withSidebarBreadcrumbs([], items, '/ja/julia/v0.46.2/mcp/reference/application/')).toEqual([])
  })

  it('does not mistake disabled or external entries for the current page', () => {
    expect(sidebarBreadcrumbs([
      { type: 'link', label: 'Disabled', href: '/reference/member/', disabled: true },
      { type: 'link', label: 'External', href: 'https://libtmux.org/reference/member/', external: true },
      { type: 'link', label: 'Same path, foreign origin', href: 'https://example.com/reference/member/' },
    ], '/reference/member/')).toEqual([])
  })

  it('keeps product identity when its landing sidebar calls the page Overview', () => {
    for (const name of ['MCP', 'Workspace Manager']) {
      const root = name === 'MCP' ? '/en/julia/latest/mcp/' : '/en/julia/latest/workspace/'
      const crumbs = [{ name: 'Julia', url: '/en/julia/latest/' }, { name, url: root }]
      const items = [{ type: 'link' as const, label: 'Overview', href: root }]
      expect(withSidebarBreadcrumbs(crumbs, items, root)).toEqual(crumbs)
    }
  })
})
