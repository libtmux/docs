import { describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { buildDocumentationSurfaces, currentDocumentation, getDocumentationSurfaces, withLanguageHome } from '../src/lib/documentation-navigation'
import { PORTS, portPageUrl, productStatus, releaseMaturity, type DocProduct, type ProductStatus } from '../src/lib/ports'
import { REGISTRY } from '../src/lib/registry'
import { sharesOneKind, type SidebarItem, type SidebarLinkItem } from '../src/lib/sidebar'
import { mcpObjectGroup, mcpObjects, mcpSectionGroups, MCP_REFERENCE } from '../src/lib/mcp-reference'

const link = (label: string, href: string): SidebarItem => ({ type: 'link', label, href })
const leaves = (items: SidebarItem[]): SidebarLinkItem[] => items.flatMap((item) => item.type === 'link' ? [item] : leaves(item.items))
const menus = (port: typeof PORTS[number], version: string) => Object.fromEntries(['core', 'mcp', 'workspace'].map((surface) => {
  const base = (path = '') => portPageUrl(port, version, [surface === 'core' ? '' : surface, path].filter(Boolean).join('/'))
  return [surface, [link('Overview', base()), link('Guides', base('guides')), link('Examples', base('examples')),
    link('API', base('reference')), link('Third-party notices', base('meta/third-party-notices')),
    ...(surface === 'workspace' ? [link('CLI Manual', base('cli')), link('Load', base('cli/load')),
      link('Installation', base('guides/installation')), link('Internal guides', base('internals/guides')),
      link('Exit codes', base('reference/exit-codes')), link('Output', base('reference/output'))] : []),
    ...(surface === 'mcp' ? [link('Tools', base('tools')), link('Prompts', base('prompts')), link('Resources', base('resources'))] : []),
  ]]
})) as Record<'core' | DocProduct, SidebarItem[]>

describe('documentation surface navigation', () => {
  it.each(PORTS)('marks only available non-Python companions as concept examples for $slug', (port) => {
    const surfaces = buildDocumentationSurfaces(port.slug, 'latest', menus(port, 'latest'))
    for (const surface of surfaces) {
      expect(Boolean(surface.concept)).toBe(port.slug !== 'py' && surface.id !== 'core')
    }
    if (port.parentLibrary || port.slug === 'lua') expect(surfaces.map((surface) => surface.id)).toEqual(['core'])
    if (port.slug === 'ruby') expect(surfaces.find((surface) => surface.id === 'workspace')?.concept).toBe(true)
  })

  it.each(PORTS)('badges every product row of $slug with its status', (port) => {
    const surfaces = buildDocumentationSurfaces(port.slug, 'latest', menus(port, 'latest'))
    for (const surface of surfaces) {
      const expected: ProductStatus | undefined = surface.id === 'core' ? releaseMaturity(REGISTRY.ports[port.slug]!)
        : port.slug === 'py' ? releaseMaturity(REGISTRY.ports.py!.packages![surface.id === 'mcp' ? 'libtmux-mcp' : 'tmuxp']!) : 'concept'
      expect(surface.status, `${port.slug} ${surface.id}`).toBe(expected)
      expect(surface.status, `${port.slug} ${surface.id}`).toBe(productStatus(port, surface.id as 'core' | DocProduct, REGISTRY))
      // Concept is a support scope that leads a companion's release stage; the flag and the badge agree.
      expect(surface.status === 'concept', `${port.slug} ${surface.id}`).toBe(Boolean(surface.concept))
    }
  })

  it('builds Julia’s surfaces and badges the library 0.x from its final tag alone', () => {
    const julia = PORTS.find((port) => port.slug === 'julia')!
    const recorded = REGISTRY.ports.julia!
    // What the deploy's resolver wrote once v0.1.0 was tagged and General did not carry it.
    REGISTRY.ports.julia = { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }
    try {
      const surfaces = buildDocumentationSurfaces('julia', 'latest', menus(julia, 'latest'))
      expect(Object.fromEntries(surfaces.map((surface) => [surface.id, surface.status])))
        .toEqual({ core: '0.x', mcp: 'concept', workspace: 'concept' })
    } finally {
      REGISTRY.ports.julia = recorded
    }
  })

  it('shows Python the stage its PyPI projects declare and every other port a concept companion', () => {
    const status = (slug: string) => Object.fromEntries(buildDocumentationSurfaces(slug, 'latest', menus(PORTS.find((port) => port.slug === slug)!, 'latest'))
      .map((surface) => [surface.id, surface.status]))
    expect(status('py')).toEqual({ core: '0.x', mcp: 'pre-alpha', workspace: '1.x' })
    expect(status('go')).toEqual({ core: '0.x', mcp: 'concept', workspace: 'concept' })
    expect(status('java')).toEqual({ core: '0.x', mcp: 'concept', workspace: 'concept' })
  })

  it('offers the tmux area without inventing a library port or empty prose sections', async () => {
    const surfaces = await getDocumentationSurfaces(undefined, 'latest')
    expect(surfaces.map((surface) => surface.id)).toEqual(['tmux'])
    expect(surfaces[0].sections.map((section) => section.id)).toEqual(['home', 'manual', 'catalog', 'reference'])
    expect(currentDocumentation(surfaces, '/tmux/latest/manual/capture-pane/').section.id).toBe('manual')
    expect(currentDocumentation(surfaces, '/tmux/latest/catalog/options/status-left/').section.id).toBe('catalog')
    expect(currentDocumentation(surfaces, '/tmux/latest/reference/c-struct-session/').section.id).toBe('reference')
    expect(PORTS.some((port) => port.slug === 'tmux')).toBe(false)
  })

  it('links the CLI Manual, the catalog and the C source reference from the tmux sidebar', async () => {
    const { getSidebar } = await import('../src/lib/sidebar')
    expect((await getSidebar(undefined, '3.2a')).map((item) => [item.label, 'href' in item ? item.href : undefined])).toEqual([
      ['CLI Manual', expect.stringMatching(/\/tmux\/3\.2a\/manual\/$/)],
      ['Options, hooks and formats', expect.stringMatching(/\/tmux\/3\.2a\/catalog\/$/)],
      ['C source reference', expect.stringMatching(/\/tmux\/3\.2a\/reference\/$/)],
    ])
  })

  it('selects shared sections inside the tmux hub', () => {
    const surfaces = [{ id: 'tmux', label: 'tmux', href: '/tmux/', sections: [
      { id: 'home', label: 'Home', href: '/tmux/', items: [] },
      { id: 'guides', label: 'Guides', href: '/tmux/guides/', items: [] },
    ] }]
    expect(currentDocumentation(surfaces, '/tmux/guides/getting-started/').section.id).toBe('guides')
  })

  it('offers a current-docs exit instead of implying versioned prose on older manuals', async () => {
    const surfaces = await getDocumentationSurfaces(undefined, '3.2a')
    expect(surfaces[0].sections.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: 'Current docs →', href: '/tmux/' },
      { label: 'CLI Manual', href: '/tmux/3.2a/manual/' },
      { label: 'Options, hooks and formats', href: '/tmux/3.2a/catalog/' },
      { label: 'C source reference', href: '/tmux/3.2a/reference/' },
    ])
    expect(currentDocumentation(surfaces, '/tmux/3.2a/manual/capture-pane/').section.id).toBe('manual')
  })

  it.each(PORTS)('keeps $slug nested app selection and destinations inside the current version', (port) => {
    const version = 'v1.2.3'
    const surfaces = buildDocumentationSurfaces(port.slug, version, menus(port, version))
    for (const surface of surfaces) {
      for (const section of surface.sections) {
        expect(section.href).toMatch(`/` + port.slug + `/${version}/`)
      }
      expect(surface.sections.map((section) => section.id)).not.toContain('tutorials')
      expect(surface.sections.map((section) => section.id)).not.toContain('meta')
      if (surface.id === 'core') continue
      const selected = currentDocumentation(surfaces, `${surface.href}guides/installation/`)
      expect(selected.surface.id).toBe(surface.id)
      expect(selected.section.id).toBe('guides')
      expect(selected.section.items.every((item) => item.type !== 'link' || !item.href.includes('/internals/'))).toBe(true)
      expect(currentDocumentation(surfaces, `${surface.href}reference/example/`).section.id).toBe('reference')
      if (surface.id === 'workspace') {
        const manual = currentDocumentation(surfaces, `${surface.href}cli/load/`).section
        expect(manual.label).toBe('CLI Manual')
        expect(manual.href).toBe(`${surface.href}cli/`)
      }
    }
  })

  it('does not inherit parent apps into Kotlin, Scala or F# or invent Tutorials links', () => {
    for (const port of PORTS.filter((entry) => entry.parentLibrary)) {
      const surfaces = buildDocumentationSurfaces(port.slug, 'latest', menus(port, 'latest'))
      expect(surfaces.map((surface) => surface.id)).toEqual(['core'])
      expect(surfaces[0].sections.map((section) => section.id)).not.toContain('tutorials')
      expect(surfaces[0].sections.map((section) => section.id)).not.toContain('topics')
    }
  })

  it('places Ruby package guides inside Guides while preserving their reader URLs', () => {
    const ruby = PORTS.find((port) => port.slug === 'ruby')!
    const version = 'v0.1.0'
    const inventory = menus(ruby, version)
    for (const [product, title] of [['mcp', 'MCP server guide'], ['workspace', 'Workspace guide']] as const) {
      const href = portPageUrl(ruby, version, `${product}/source-guide`)
      inventory[product].push(link(title, href))
      const surfaces = buildDocumentationSurfaces('ruby', version, inventory)
      const current = currentDocumentation(surfaces, href)
      expect(current.surface.id).toBe(product)
      expect(current.section.id).toBe('guides')
      expect(current.section.href).toBe(portPageUrl(ruby, version, `${product}/guides`))
      expect(current.section.items).toContainEqual(link(title, href))
      expect(current.surface.sections.map((section) => section.id)).not.toContain('source-guide')
    }
  })

  it('uses Julia’s existing MCP setup guide when no Guides overview exists', () => {
    const setup = '/julia/latest/mcp/source-guide/'
    const surfaces = buildDocumentationSurfaces('julia', 'latest', { mcp: [link('MCP server guide', setup)] })
    const section = surfaces.find((surface) => surface.id === 'mcp')!.sections.find((section) => section.id === 'guides')!
    expect(section.href).toBe(setup)
    expect(section.items).toEqual([link('MCP server guide', setup)])
    expect(currentDocumentation(surfaces, setup).section).toBe(section)
  })

  it('omits unavailable Lua apps even when their availability pages exist', () => {
    const port = PORTS.find((entry) => entry.slug === 'lua')!
    const surfaces = buildDocumentationSurfaces('lua', 'latest', { core: [],
      mcp: [link('Availability', portPageUrl(port, 'latest', 'mcp'))],
      workspace: [link('Availability', portPageUrl(port, 'latest', 'workspace'))],
    })
    expect(surfaces.map((surface) => surface.id)).toEqual(['core'])
  })

  it('offers a section when a real child exists, without requiring an overview or adding empty sections', () => {
    const surfaces = buildDocumentationSurfaces('csharp', 'latest', { core: [
      link('First session', '/csharp/latest/tutorials/first-session/'),
      link('Installation', '/csharp/latest/guides/installation/'),
    ] })
    const core = surfaces.find((surface) => surface.id === 'core')!
    expect(core.sections.map((section) => [section.id, section.href])).toEqual([
      ['home', '/csharp/latest/core/'],
      ['guides', '/csharp/latest/guides/installation/'],
      ['tutorials', '/csharp/latest/tutorials/first-session/'],
      ['reference', '/csharp/latest/reference/'],
    ])
    expect(core.sections[0].items.map((item) => item.label)).toEqual(['Overview', 'Guides', 'Tutorials', 'API Reference'])
  })

  it.each(PORTS)('sends the $slug Core Library home to core/ and keeps its sibling pages in the surface', (port) => {
    const surfaces = buildDocumentationSurfaces(port.slug, 'latest', menus(port, 'latest'))
    const core = surfaces.find((surface) => surface.id === 'core')!
    const home = portPageUrl(port, 'latest', 'core')
    expect(core.href).toBe(home)
    expect(core.sections.find((section) => section.id === 'home')).toMatchObject({ href: home })
    expect(core.sections[0].items[0]).toEqual({ type: 'link', label: 'Overview', href: home })
    for (const path of ['', 'core/', 'guides/', 'reference/']) {
      expect(currentDocumentation(surfaces, `${portPageUrl(port, 'latest')}${path}`).surface.id, path).toBe('core')
    }
    expect(currentDocumentation(surfaces, home).section.id).toBe('home')
    expect(currentDocumentation(surfaces, `${portPageUrl(port, 'latest')}guides/`).section.id).toBe('guides')
  })

  it.each(PORTS)('puts the $slug language Home above Core Library and selects it only on the language page', (port) => {
    const products = buildDocumentationSurfaces(port.slug, 'latest', menus(port, 'latest'))
    const surfaces = withLanguageHome(port.slug, 'latest', products)
    const root = portPageUrl(port, 'latest')
    expect(surfaces.map((surface) => surface.id)).toEqual(['home', ...products.map((surface) => surface.id)])
    expect(surfaces[0]).toMatchObject({ label: port.name, href: root })
    expect(surfaces[1].id).toBe('core')
    const here = currentDocumentation(surfaces, root)
    expect(here.surface.id).toBe('home')
    expect(here.section.label).toBe('Home')
    // The language sidebar links every product home, then the shared areas.
    const labels = here.section.items.map((item) => item.label)
    expect(labels.slice(0, products.length)).toEqual(products.map((surface) => surface.label))
    expect(labels.at(-1)).toBe('Documentation')
    for (const path of ['core/', 'guides/', 'reference/', 'mcp/', 'workspace/']) {
      expect(currentDocumentation(surfaces, `${root}${path}`).surface.id, path).not.toBe('home')
    }
    expect(currentDocumentation(surfaces, `${root}core/`).section.id).toBe('home')
    expect(currentDocumentation(surfaces, `${root}core/`).surface.id).toBe('core')
  })

  it.each(['cxx', 'julia', 'powershell', 'ruby'])('keeps %s product glossaries inside their API navigation', (slug) => {
    const port = PORTS.find((entry) => entry.slug === slug)!
    const surfaces = buildDocumentationSurfaces(slug, 'latest', menus(port, 'latest'))
    for (const surface of surfaces.filter((entry) => entry.id !== 'core')) {
      const reference = surface.sections.find((section) => section.id === 'reference')!
      const glossary = `${reference.href}glossary/`
      const group = reference.items.find((item) => item.label === 'Language API')!
      if (group.type !== 'group') throw new Error('Expected language API tree')
      expect(group.items.length).toBeGreaterThan(1)
      expect(group.items.filter((item) => item.href === glossary)).toEqual([{ type: 'link', label: 'API glossary', href: glossary }])
      const selected = currentDocumentation(surfaces, glossary)
      expect(selected.surface.id).toBe(surface.id)
      expect(selected.section).toBe(reference)
    }
  })

  it('separates CLI and protocol references from the language API', () => {
    const port = PORTS.find((entry) => entry.slug === 'go')!
    const surfaces = buildDocumentationSurfaces('go', 'latest', menus(port, 'latest'))
    const workspace = currentDocumentation(surfaces, portPageUrl(port, 'latest', 'workspace/cli/load'))
    expect(workspace.surface.id).toBe('workspace')
    expect(workspace.section.id).toBe('manual')
    expect(workspace.section.label).toBe('CLI Manual')
    expect(workspace.section.href).toBe('/go/latest/workspace/cli/')
    expect(workspace.section.items.map((item) => item.label)).toEqual(['CLI Manual', 'Load', 'Exit codes', 'Output'])
    expect(currentDocumentation(surfaces, '/go/latest/workspace/reference/output/').section.id).toBe('manual')
    const api = currentDocumentation(surfaces, '/go/latest/workspace/reference/')
    expect(api.section.id).toBe('reference')
    expect(api.section.items.map((item) => item.label)).toEqual(['Language API'])
    const languageApi = api.section.items[0]
    expect(languageApi.href).toBe('/go/latest/workspace/reference/')
    if (languageApi.type !== 'group') throw new Error('Expected language API group')
    expect(languageApi.items.some((item) => item.href === languageApi.href)).toBe(false)
    const mcp = currentDocumentation(surfaces, portPageUrl(port, 'latest', 'mcp/tools/list_sessions'))
    expect(mcp.surface.id).toBe('mcp')
    expect(mcp.section.id).toBe('tools')
    expect(mcp.section.items[0].label).toBe('Tools')
    expect(leaves(mcp.section.items.slice(1)).map((item) => item.label).sort()).toEqual(MCP_REFERENCE.go.registrations.map((tool) => tool.wireName).sort())
    expect(currentDocumentation(surfaces, '/go/latest/mcp/reference/').section.items.map((item) => item.label)).toEqual(['Language API'])
  })

  it.each(Object.keys(MCP_REFERENCE))('exposes all three protocol sections for %s with only its advertised objects', (slug) => {
    const port = PORTS.find((entry) => entry.slug === slug)!
    const surfaces = buildDocumentationSurfaces(slug, 'next', menus(port, 'next'))
    const mcp = surfaces.find((surface) => surface.id === 'mcp')!
    expect(mcp.sections.map((section) => section.id)).toEqual(['home', 'guides', 'examples', 'tools', 'prompts', 'resources', 'reference'])
    for (const id of ['tools', 'prompts', 'resources']) {
      const section = mcp.sections.find((section) => section.id === id)!
      const objects = mcpObjects(slug).filter((object) => object.section === id)
      expect(section.disabled).toBe(objects.length === 0)
      const homeLink = mcp.sections.find((section) => section.id === 'home')!.items
        .find((item) => item.type === 'link' && item.href === section.href)
      expect(homeLink?.type === 'link' && Boolean(homeLink.disabled)).toBe(objects.length === 0)
      expect(section.href).toBe(`/${slug}/next/mcp/${id}/`)
      // The section's objects nest under their groups, in the order the index page lists them. A group names its kind, so its rows draw no mark and keep the kind for assistive technology.
      const groups = section.items.slice(1)
      expect(groups.every((item) => item.type === 'group'), `${slug} ${id} groups`).toBe(true)
      expect(groups.map((group) => group.label), `${slug} ${id} group order`).toEqual(mcpSectionGroups(slug, id as 'tools').map((group) => group.label))
      for (const group of groups) {
        if (group.type !== 'group') continue
        expect(group.href, `${slug} ${group.label} anchor`).toMatch(new RegExp(`^/${slug}/next/mcp/${id}/#${id}-`))
        expect(group.items.every((item) => item.type === 'link' && item.quiet === true && item.kind), `${slug} ${group.label} rows`).toBe(true)
        for (const item of leaves(group.items)) expect(mcpObjectGroup(objects.find((object) => `/${slug}/next/${object.path}/` === item.href)!), `${slug} ${item.label} group`).toBe(group.label)
      }
      expect(leaves(groups).map((item) => item.href).sort()).toEqual(objects.map((object) => `/${slug}/next/${object.path}/`).sort())
      for (const object of objects) expect(currentDocumentation(surfaces, `/${slug}/next/${object.path}/`).section.id).toBe(id)
    }
  })

  it('quiets a protocol group of one kind and marks a group that mixes kinds', () => {
    // No advertised registration set mixes kinds in one group today, so the rule is held on its own, and the real groups on the data.
    expect(sharesOneKind(['tool', 'tool', 'tool'])).toBe(true)
    expect(sharesOneKind([])).toBe(true)
    expect(sharesOneKind(['resource', 'resource-template'])).toBe(false)
    expect(sharesOneKind(['tool', 'prompt'])).toBe(false)
    const quieted = Object.keys(MCP_REFERENCE).flatMap((slug) => ['tools', 'prompts', 'resources']
      .filter((id) => mcpObjects(slug).some((object) => object.section === id)).map((id) => ({ slug, id })))
    expect(quieted.length).toBeGreaterThan(0)
    for (const { slug, id } of quieted) {
      const port = PORTS.find((entry) => entry.slug === slug)!
      const section = buildDocumentationSurfaces(slug, 'next', menus(port, 'next')).find((surface) => surface.id === 'mcp')!.sections.find((entry) => entry.id === id)!
      for (const link of leaves(section.items.slice(1))) expect(link.quiet && link.kind, `${slug} ${id}`).toBeTruthy()
    }
  })

  it('selects the protocol section from an object page, whatever group the object is in', () => {
    const port = PORTS.find((entry) => entry.slug === 'py')!
    const surfaces = buildDocumentationSurfaces('py', 'next', menus(port, 'next'))
    const object = mcpObjects('py').find((entry) => entry.kind === 'resource-template')!
    const selected = currentDocumentation(surfaces, `/py/next/${object.path}/`)
    expect(selected.surface.id).toBe('mcp')
    expect(selected.section.id).toBe('resources')
    const group = selected.section.items.find((item) => item.type === 'group' && leaves(item.items).some((entry) => entry.href === `/py/next/${object.path}/`))
    expect(group?.label).toBe('Resource templates')
  })

  it('keeps ecosystem and upstream references reachable from the picker above the core API tree', () => {
    const core: SidebarItem[] = [link('API reference', '/py/latest/reference/'),
      link('Upstream reference', '/py/latest/api/'),
      { type: 'link', label: 'docs.rs', href: 'https://docs.rs/libtmux', external: true }]
    const surfaces = buildDocumentationSurfaces('py', 'latest', { core })
    const { section } = currentDocumentation(surfaces, '/py/latest/reference/libtmux-server/')
    expect(section.alternatives?.map((item) => item.href)).toEqual(['/py/latest/api/', 'https://docs.rs/libtmux'])
    for (const path of ['/py/latest/api/', '/py/latest/api/libtmux.server/']) {
      const selected = currentDocumentation(surfaces, path)
      expect(selected.section.id).toBe('reference')
      expect(selected.alternative?.label).toBe('Upstream reference')
      expect(selected.alternative?.href).toBe('/py/latest/api/')
    }
    expect(currentDocumentation(surfaces, '/py/latest/reference/libtmux-server/').alternative).toBeUndefined()
    expect(currentDocumentation(surfaces, '/py/latest/guides/').alternative).toBeUndefined()
  })
})
