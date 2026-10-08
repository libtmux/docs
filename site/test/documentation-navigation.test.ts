import { describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { buildDocumentationSurfaces, currentDocumentation, getDocumentationSurfaces } from '../src/lib/documentation-navigation'
import { PORTS, portPageUrl, type DocProduct } from '../src/lib/ports'
import type { SidebarItem } from '../src/lib/sidebar'

const link = (label: string, href: string): SidebarItem => ({ type: 'link', label, href })
const menus = (port: typeof PORTS[number], version: string) => Object.fromEntries(['core', 'mcp', 'workspace'].map((surface) => {
  const base = (path = '') => portPageUrl(port, version, [surface === 'core' ? '' : surface, path].filter(Boolean).join('/'))
  return [surface, [link('Overview', base()), link('Guides', base('guides')), link('Examples', base('examples')),
    link('API', base('reference')), link('Third-party notices', base('third-party-notices')),
    ...(surface === 'workspace' ? [link('CLI Manual', base('cli')), link('Load', base('cli/load')),
      link('Installation', base('guides/installation')), link('Internal guides', base('internals/guides')),
      link('Exit codes', base('reference/exit-codes')), link('Output', base('reference/output'))] : []),
    ...(surface === 'mcp' ? [link('Tools', base('tools'))] : []),
  ]]
})) as Record<'core' | DocProduct, SidebarItem[]>

describe('documentation surface navigation', () => {
  it('offers the tmux area without inventing a library port or empty prose sections', async () => {
    const surfaces = await getDocumentationSurfaces(undefined, 'latest')
    expect(surfaces.map((surface) => surface.id)).toEqual(['tmux'])
    expect(surfaces[0].sections.map((section) => section.id)).toEqual(['home', 'manual', 'reference'])
    expect(currentDocumentation(surfaces, '/tmux/latest/manual/capture-pane/').section.id).toBe('manual')
    expect(PORTS.some((port) => port.slug === 'tmux')).toBe(false)
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
      expect(surface.sections.map((section) => section.id)).not.toContain('third-party-notices')
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
      ['home', '/csharp/latest/'],
      ['guides', '/csharp/latest/guides/installation/'],
      ['tutorials', '/csharp/latest/tutorials/first-session/'],
      ['reference', '/csharp/latest/reference/'],
    ])
    expect(core.sections[0].items.map((item) => item.label)).toEqual(['Overview', 'Guides', 'Tutorials', 'API Reference'])
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
    const mcp = currentDocumentation(surfaces, portPageUrl(port, 'latest', 'mcp/tools/list_sessions'))
    expect(mcp.surface.id).toBe('mcp')
    expect(mcp.section.items.map((item) => item.label)).toEqual(['Language API', 'Tools'])
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
