import { describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { buildDocumentationSurfaces, currentDocumentation, withLanguageHome } from '../src/lib/documentation-navigation'
import { PORT_BY_SLUG, PORTS, portPageUrl, type DocProduct } from '../src/lib/ports'
import { hasInstaller, pageCount, portRows, productRows, rowsFor, sidebarHead } from '../src/lib/sidebar-head'
import { pageBreadcrumbs, type SidebarItem } from '../src/lib/sidebar'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { parseHtml } from './header-page'

/**
 * The port ladder (design system record 0021): Port, Product, Section, Page.
 * The column's head names the level its rows list and goes exactly one level
 * higher, so a reader climbs to the port home and to every language without
 * the Back button.
 */
const link = (label: string, href: string): SidebarItem => ({ type: 'link', label, href })
function menus(slug: string, version = 'latest') {
  const port = PORT_BY_SLUG[slug]!
  return Object.fromEntries(['core', 'mcp', 'workspace'].map((surface) => {
    const base = (path = '') => portPageUrl(port, version, [surface === 'core' ? '' : surface, path].filter(Boolean).join('/'))
    return [surface, [link('Overview', base()), link('Guides', base('guides')), link('Capturing output', base('guides/capturing-output')),
      link('Sending keys', base('guides/sending-keys')), link('Examples', base('examples')),
      link('API', base('reference')),
      ...(surface === 'workspace' ? [link('CLI manual', base('cli')), link('Load', base('cli/load'))] : []),
      ...(surface === 'mcp' ? [link('Tools', base('tools')), link('Prompts', base('prompts')), link('Resources', base('resources'))] : []),
    ]]
  })) as Record<'core' | DocProduct, SidebarItem[]>
}
const surfacesOf = (slug: string) => withLanguageHome(slug, 'latest', buildDocumentationSurfaces(slug, 'latest', menus(slug)))
const at = (slug: string, path: string) => {
  const surfaces = surfacesOf(slug)
  const selected = currentDocumentation(surfaces, path)
  return { surfaces, selected, head: sidebarHead(slug, 'latest', selected) }
}

describe('the head of each level', () => {
  it('goes from the port home to every language, with the core maturity beside the language', () => {
    const { head } = at('go', '/go/latest/')
    expect(head.level).toBe('port')
    expect(head.up).toEqual({ label: 'All languages', href: '/' })
    expect(head.title).toMatchObject({ label: 'Go', href: '/go/latest/', status: '0.x' })
  })

  it('goes from a product home to its language, so the Core home reaches the port home', () => {
    for (const slug of ['lisp', 'go', 'julia']) {
      const { head } = at(slug, `/${slug}/latest/core/`)
      expect(head.level).toBe('product')
      expect(head.up).toEqual({ label: PORT_BY_SLUG[slug]!.name, href: `/${slug}/latest/` })
      expect(head.title.label).toBe('Core Library')
    }
    const mcp = at('go', '/go/latest/mcp/').head
    expect(mcp.up.href).toBe('/go/latest/')
    expect(mcp.title).toMatchObject({ label: 'MCP', status: 'concept' })
  })

  it('goes from a section or a page in it to the product, and carries no badge of its own', () => {
    const guide = at('go', '/go/latest/guides/capturing-output/').head
    expect(guide.level).toBe('section')
    expect(guide.up).toEqual({ label: 'Core Library', href: '/go/latest/core/' })
    expect(guide.title).toEqual({ label: 'Guides', href: '/go/latest/guides/' })
    const tools = at('go', '/go/latest/mcp/tools/').head
    expect(tools.up).toEqual({ label: 'MCP', href: '/go/latest/mcp/' })
    expect(tools.title.label).toBe('Tools')
    expect(at('go', '/go/latest/mcp/reference/').head.up.label).toBe('MCP')
  })

  it('is exactly one level higher: the up target is never the scope itself, and each level has its own', () => {
    for (const slug of ['go', 'rs', 'ts', 'lisp']) {
      const levels = ['/', '/core/', '/mcp/', '/workspace/', '/guides/capturing-output/', '/mcp/tools/', '/reference/'].map((path) => at(slug, `/${slug}/latest${path}`).head)
      for (const head of levels) expect(head.up.href, `${slug} ${head.title.label}`).not.toBe(head.title.href)
      expect(new Set(levels.filter((head) => head.level === 'port').map((head) => head.up.href))).toEqual(new Set(['/']))
    }
  })
})

describe('the rows of each level', () => {
  it('lists Install second on a product home, with the section counts muted beside their rows', () => {
    const { surfaces } = at('go', '/go/latest/core/')
    const core = surfaces.find((surface) => surface.id === 'core')!
    const rows = productRows('go', core)
    expect(rows.map((row) => row.label).slice(0, 2)).toEqual(['Overview', 'Install'])
    expect(rows[1]).toMatchObject({ install: true, href: '/go/latest/core/#install' })
    // Two guide pages beside the section's own overview.
    expect(rows.find((row) => row.label === 'Guides')).toMatchObject({ count: 2 })
    // A reference holds declarations, not pages.
    expect(rows.find((row) => row.label === 'API reference')).not.toHaveProperty('count')
  })

  it('shows an empty section without a count, never "0"', () => {
    const { surfaces } = at('go', '/go/latest/mcp/')
    const mcp = surfaces.find((surface) => surface.id === 'mcp')!
    for (const row of productRows('go', mcp)) if (row.type === 'link' && row.count !== undefined) expect(row.count).toBeGreaterThan(0)
    const prompts = mcp.sections.find((section) => section.id === 'prompts')!
    expect(pageCount(prompts)).toBeUndefined()
  })

  it('lists Install second on the home of every product a port publishes, and nowhere for a product it does not', () => {
    for (const port of PORTS) {
      const surfaces = surfacesOf(port.slug).filter((surface) => surface.id !== 'home')
      expect(surfaces.map((surface) => surface.id), port.slug).toContain('core')
      for (const surface of surfaces) {
        const rows = productRows(port.slug, surface)
        expect(rows[1], `${port.slug} ${surface.id}`).toMatchObject({ label: 'Install', install: true, href: `${surface.href}#install` })
      }
    }
    // A port with no MCP server has no MCP surface to install, and `hasInstaller` does not invent one.
    expect(surfacesOf('lisp').map((surface) => surface.id)).not.toContain('mcp')
    expect(hasInstaller('lisp', 'tools')).toBe(false)
  })

  it('opens a port home on each product as a disclosure of its overview and sections', () => {
    const { surfaces } = at('go', '/go/latest/')
    const rows = portRows(surfaces)
    expect(rows.map((row) => row.label)).toEqual(['Core Library', 'MCP', 'Workspace Manager'])
    for (const row of rows) {
      expect(row).toMatchObject({ type: 'group', open: true })
      if (row.type === 'group') expect(row.items[0]).toMatchObject({ label: 'Overview' })
    }
  })

  it('keeps a section\'s own pages for a section, and groups the tools by tmux object as labels over rows', () => {
    const { surfaces, selected, head } = at('go', '/go/latest/mcp/tools/')
    const items = selected.section.items
    expect(rowsFor('go', head, surfaces, selected, items)).toBe(items)
    for (const group of items.filter((item) => item.type === 'group')) expect(group).toMatchObject({ overline: true })
  })
})

describe('the breadcrumb', () => {
  it('names the Core Library between the port and its sections', async () => {
    const crumbs = await pageBreadcrumbs('Capturing output', 'guides/capturing-output', 'latest', 'go')
    expect(crumbs.map((crumb) => crumb.name).slice(0, 2)).toEqual(['Go', 'Core Library'])
    expect(crumbs[1]!.url).toBe('/go/latest/core/')
  })

  it('leaves the Core Home, a product page and a root page as they were', async () => {
    expect((await pageBreadcrumbs('Core', 'core', 'latest', 'go')).map((crumb) => crumb.name)).toEqual(['Go', 'Core Library'])
    expect((await pageBreadcrumbs('Tools', 'mcp/tools', 'latest', 'go')).map((crumb) => crumb.name)).not.toContain('Core Library')
    expect((await pageBreadcrumbs('Servers', 'concepts/servers', 'latest')).map((crumb) => crumb.name)).not.toContain('Core Library')
  })
})

describe('SidebarHead markup', () => {
  async function render(props: Record<string, unknown>) {
    const head = await loadAstroTemplate('components/docs/SidebarHead.astro', { real: ['components/StatusBadge.astro'] })
    return parseHtml(await renderAstroTemplate(head, { props })).document
  }

  it('is plain links, so the way up works without a script', async () => {
    const doc = await render({ up: { label: 'Common Lisp', href: '/en/lisp/latest/' }, title: { label: 'Core Library', href: '/en/lisp/latest/core/', status: 'unreleased' } })
    const up = doc.querySelector('a[data-sidebar-head-up]')!
    expect(up.getAttribute('href')).toBe('/en/lisp/latest/')
    expect(up.getAttribute('aria-label')).toBe('Up to Common Lisp')
    expect(up.textContent!.trim()).toBe('Common Lisp')
    expect(doc.querySelector('a[data-sidebar-head-title]')!.getAttribute('href')).toBe('/en/lisp/latest/core/')
    expect(doc.querySelector('[data-status="unreleased"]')!.textContent).toBe('unreleased')
    expect(doc.querySelector('button, script')).toBeNull()
  })

  it('carries no badge on a section', async () => {
    const doc = await render({ up: { label: 'Core Library', href: '/core/' }, title: { label: 'Guides', href: '/guides/' } })
    expect(doc.querySelector('.status-badge')).toBeNull()
  })
})
