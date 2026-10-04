import { describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { buildDocumentationSurfaces, currentDocumentation } from '../src/lib/documentation-navigation'
import { PORTS, portPageUrl, type DocProduct } from '../src/lib/ports'
import type { SidebarItem } from '../src/lib/sidebar'

const link = (label: string, href: string): SidebarItem => ({ type: 'link', label, href })
const menus = (port: typeof PORTS[number], version: string) => Object.fromEntries(['core', 'mcp', 'workspace'].map((surface) => {
  const base = (path = '') => portPageUrl(port, version, [surface === 'core' ? '' : surface, path].filter(Boolean).join('/'))
  return [surface, [link('Overview', base()), link('Guides', base('guides')), link('Examples', base('examples')),
    link('API', base('reference')),
    ...(surface === 'workspace' ? [link('CLI reference', base('cli')), link('Load', base('cli/load')),
      link('Installation', base('guides/installation')), link('Internal guides', base('internals/guides')),
      link('Exit codes', base('reference/exit-codes')), link('Output', base('reference/output'))] : []),
    ...(surface === 'mcp' ? [link('Tools', base('tools'))] : []),
  ]]
})) as Record<'core' | DocProduct, SidebarItem[]>

describe('documentation surface navigation', () => {
  it.each(PORTS)('keeps $slug nested app selection and destinations inside the current version', (port) => {
    const version = 'v1.2.3'
    const surfaces = buildDocumentationSurfaces(port.slug, version, menus(port, version))
    for (const surface of surfaces) {
      for (const section of surface.sections) {
        expect(section.href).toMatch(`/` + port.slug + `/${version}/`)
      }
      expect(surface.sections.map((section) => section.id)).not.toContain('tutorials')
      if (surface.id === 'core') continue
      const selected = currentDocumentation(surfaces, `${surface.href}guides/installation/`)
      expect(selected.surface.id).toBe(surface.id)
      expect(selected.section.id).toBe('guides')
      expect(selected.section.items.every((item) => item.type !== 'link' || !item.href.includes('/internals/'))).toBe(true)
      expect(currentDocumentation(surfaces, `${surface.href}reference/example/`).section.id).toBe('reference')
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

  it('omits unavailable Lua apps even when their availability pages exist', () => {
    const port = PORTS.find((entry) => entry.slug === 'lua')!
    const surfaces = buildDocumentationSurfaces('lua', 'latest', { core: [],
      mcp: [link('Availability', portPageUrl(port, 'latest', 'mcp'))],
      workspace: [link('Availability', portPageUrl(port, 'latest', 'workspace'))],
    })
    expect(surfaces.map((surface) => surface.id)).toEqual(['core'])
  })

  it('offers a section when a real child exists, without requiring an overview or adding empty sections', () => {
    const surfaces = buildDocumentationSurfaces('dotnet', 'latest', { core: [
      link('First session', '/dotnet/latest/tutorials/first-session/'),
      link('Installation', '/dotnet/latest/guides/installation/'),
    ] })
    const core = surfaces.find((surface) => surface.id === 'core')!
    expect(core.sections.map((section) => [section.id, section.href])).toEqual([
      ['home', '/dotnet/latest/'],
      ['guides', '/dotnet/latest/guides/installation/'],
      ['tutorials', '/dotnet/latest/tutorials/first-session/'],
      ['reference', '/dotnet/latest/reference/'],
    ])
    expect(core.sections[0].items.map((item) => item.label)).toEqual(['Overview', 'Guides', 'Tutorials', 'Reference'])
  })

  it('separates CLI and protocol references from the language API', () => {
    const port = PORTS.find((entry) => entry.slug === 'go')!
    const surfaces = buildDocumentationSurfaces('go', 'latest', menus(port, 'latest'))
    const workspace = currentDocumentation(surfaces, portPageUrl(port, 'latest', 'workspace/cli/load'))
    expect(workspace.surface.id).toBe('workspace')
    expect(workspace.section.id).toBe('reference')
    expect(workspace.section.items.map((item) => item.label)).toContain('CLI reference')
    expect(workspace.section.items.map((item) => item.label)).toContain('Language API')
    const contracts = workspace.section.items.find((item) => item.label === 'CLI contracts')!
    expect(contracts.type === 'group' && contracts.items.map((item) => item.label)).toEqual(['Exit codes', 'Output'])
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
    expect(currentDocumentation(surfaces, '/py/latest/api/libtmux.server/').section.id).toBe('reference')
  })
})
