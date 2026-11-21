import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Window, type Document, type Element } from 'happy-dom'
import { createComponent, render } from 'astro/compiler-runtime'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { mcpObjects, mcpSectionGroups, MCP_SECTIONS, type McpObject, type McpSection } from '../src/lib/mcp-reference'

/**
 * The protocol reference pages (tools, prompts, resources and each object) render through the
 * documentation layout, so their sidebar is the section menu the Guides pages use. The layout, the
 * sidebar and its rows are the real templates; only the document shell and the page chrome are stubbed.
 */
const options = {
  real: [
    'layouts/DocsLayout.astro', 'components/docs/Sidebar.astro', 'components/docs/SidebarSection.astro', 'components/docs/SidebarLink.astro',
    'components/docs/DocumentationNavigationButtons.astro', 'components/docs/SidebarHead.astro', 'components/StatusBadge.astro',
    'components/PageToolbar.astro', 'components/api/ApiBadge.astro', 'components/api/ApiSectionBar.astro', 'components/api/SymbolName.astro',
  ],
  stubs: {
    'layouts/BaseLayout.astro': '<slot name="context" /><slot />',
    'components/docs/DocumentationContext.astro': '<slot name="navigation" />',
  },
  modules: { 'astro-expressive-code/components': { Code: createComponent(() => render`<pre></pre>`) } },
}

let template: Awaited<ReturnType<typeof loadAstroTemplate>>
beforeAll(async () => { template = await loadAstroTemplate('components/mcp/ProtocolReference.astro', options) })

async function page(port: string, section: McpSection, object?: McpObject) {
  const window = new Window()
  const url = `https://libtmux.org/${port}/next/${object?.path ?? `mcp/${section}`}/`
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { url, props: { port, version: 'next', section, itemSlug: object?.slug } }))
  return window.document
}

/** The desktop column and the drawer; the no-script fallback repeats the menu inside `noscript`. */
const menus = (document: Document) => [...document.querySelectorAll('[data-section-navigation]')].filter((sidebar) => !sidebar.closest('noscript'))
const first = (port: string, section: McpSection) => mcpObjects(port).find((object) => object.section === section)!
const cases = [['rs', 'resources'], ['rs', 'tools'], ['py', 'prompts'], ['py', 'resources']] as const

describe('the menu sidebar on protocol reference pages', () => {
  it.each(cases)('shows %s %s with the way up and the scope, the section filter and no API browser', async (port, section) => {
    const document = await page(port, section, first(port, section))
    expect(document.querySelector('.api-nav, #api-nav, [data-api-nav-toggle]'), 'no API tree, filters or its toggle').toBeNull()
    const sidebars = menus(document)
    // The drawer and the desktop column carry the same menu, and so does the no-script fallback.
    expect(sidebars.map((sidebar) => sidebar.closest('aside')?.id || 'desktop')).toEqual(['mobile-sidebar', 'desktop'])
    expect(document.querySelectorAll('noscript [data-section-navigation]')).toHaveLength(1)
    for (const sidebar of sidebars) {
      // One level up from the section is the product; the title is the section, linking to its index.
      const head = sidebar.parentElement!.querySelector('[data-sidebar-head]')!
      expect(head.querySelector('[data-sidebar-head-up]')!.getAttribute('aria-label')).toBe('Up to MCP')
      expect(head.querySelector('[data-sidebar-head-up]')!.getAttribute('href')).toBe(`/${port}/next/mcp/`)
      expect(head.querySelector('[data-sidebar-head-title]')!.textContent).toBe(MCP_SECTIONS[section])
      expect(head.querySelector('[data-sidebar-head-title]')!.getAttribute('href')).toBe(`/${port}/next/mcp/${section}/`)
      expect(sidebar.querySelector('input[type="search"][data-section-search]')?.getAttribute('placeholder')).toBe('Filter this section')
      expect(sidebar.querySelector('nav')?.getAttribute('aria-label')).toBe(`MCP: ${MCP_SECTIONS[section]}`)
    }
  })

  it.each(cases)('lists %s %s under its groups as labels over its rows and marks only the current page', async (port, section) => {
    const object = first(port, section)
    const group = mcpSectionGroups(port, section).find((entry) => entry.objects.includes(object))!
    const document = await page(port, section, object)
    expect(menus(document)).toHaveLength(2)
    for (const nav of menus(document).map((sidebar) => sidebar.querySelector('nav')!)) {
      const current = [...nav.querySelectorAll('[aria-current="page"]')]
      expect(current.map((row) => row.textContent?.trim()), 'one current row, the page itself').toEqual([object.name])
      expect(current[0].matches('a.sidebar-link.api-nav__row')).toBe(true)
      // A group is a label over its rows, not a row: it cannot be opened, closed or selected.
      expect(nav.querySelector('details'), 'no group is a disclosure').toBeNull()
      const label = [...nav.querySelectorAll('.sidebar-overline')].map((entry) => entry.textContent?.trim())
      expect(label).toEqual(mcpSectionGroups(port, section).map((entry) => entry.label))
      let before = current[0].previousElementSibling
      while (before && !before.classList.contains('sidebar-overline')) before = before.previousElementSibling
      expect(before?.textContent?.trim(), 'the label over the page\'s row names its group').toBe(group.label)
      // A group names its kind: its rows draw no mark and keep the kind for assistive technology.
      expect(nav.querySelector('.api-nav__kind'), 'no kind mark on a row').toBeNull()
      expect(current[0].getAttribute('aria-description')).toBe(object.kind)
    }
  })

  it.each(cases)('marks the section overview on the %s %s index and shows the groups as labels', async (port, section) => {
    const document = await page(port, section)
    const nav = menus(document)[1].querySelector('nav')!
    expect([...nav.querySelectorAll('[aria-current="page"]')].map((row) => row.textContent?.trim())).toEqual(['Overview'])
    expect(nav.querySelectorAll('details')).toHaveLength(0)
    expect([...nav.querySelectorAll('.sidebar-overline')].map((row) => row.textContent?.trim()))
      .toEqual(mcpSectionGroups(port, section).map((group) => group.label))
  })

  it('opens the same menu from the toolbar button as the Guides pages do', async () => {
    const document = await page('rs', 'resources', first('rs', 'resources'))
    const button = document.querySelector('#mobile-sidebar-toggle')!
    expect(button.getAttribute('aria-controls')).toBe('mobile-sidebar')
    expect(button.hasAttribute('data-api-nav-toggle')).toBe(false)
    expect(document.querySelector('#mobile-sidebar [data-section-navigation]')).not.toBeNull()
    expect(document.querySelector('#mobile-sidebar-close')).not.toBeNull()
  })

  it('names four levels in the breadcrumb: the group the sidebar draws over the object is a label, not a place', async () => {
    const object = first('rs', 'resources')
    const document = await page('rs', 'resources', object)
    const trail = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
    expect(trail.map((item) => item.textContent?.trim())).toEqual(['Rust', 'MCP', 'Resources', object.name])
    expect(trail.map((item) => item.getAttribute('href'))).toEqual(['/rs/next/', '/rs/next/mcp/', '/rs/next/mcp/resources/', null])
  })

  it('keeps the sidebar out of search, as the API tree was', async () => {
    const document = await page('rs', 'tools', first('rs', 'tools'))
    const sidebars = menus(document)
    expect(sidebars).toHaveLength(2)
    for (const sidebar of sidebars) expect(sidebar.closest('[data-pagefind-ignore="all"]'), 'sidebar is outside the index').not.toBeNull()
    expect(document.querySelector('.api-reference-content')?.closest('[data-pagefind-ignore]')).toBeNull()
  })

  it('draws the object header as every declaration header: one corner tab, no version badge, no pilcrow', async () => {
    const document = await page('rs', 'tools', first('rs', 'tools'))
    const tab = document.querySelector('dt.gp-sphinx-api-header > .gp-sphinx-api-layout > .api-corner')!
    expect(tab, 'kind and Source share the corner tab').not.toBeNull()
    // The kind leads and Source ends the tab; a tool's toolset badge (the tool browser) sits between them.
    const part = (child: Element) => child.classList.contains('api-leg--action') ? 'source' : child.classList.contains('mcp-tier') ? 'tier' : 'kind'
    expect([...tab.children].map(part)).toEqual(['kind', 'tier', 'source'])
    expect(tab.querySelector('a.api-leg--action')?.getAttribute('href')).toMatch(/^https:\/\/github\.com\//)
    // The object is the page's entry; the type definitions below it are entries of their own and keep their permalinks.
    expect(document.querySelector('dl.gp-sphinx-api-container:not(.mcp-type-definition) > dt.gp-sphinx-api-header a.heading-link')).toBeNull()
    expect(document.querySelector('.api-reference-version')).toBeNull()
    expect(document.querySelector('.api-reference-eyebrow')?.getAttribute('data-pagefind-ignore')).toBe('all')
    expect(document.querySelector('h1.api-reference-title')?.getAttribute('data-pagefind-weight')).toBe('10')
  })

  it('keeps the sidebar of every other documentation page out of search, so no excerpt opens with its labels', async () => {
    const layout = await loadAstroTemplate('layouts/DocsLayout.astro', options)
    const window = new Window()
    window.document.body.innerHTML = withoutScope(await renderAstroTemplate(layout, {
      url: 'https://libtmux.org/rs/next/mcp/guides/', props: { title: 'Guides', port: 'rs', version: 'next', pagePath: 'mcp/guides' },
    }))
    const sidebars = menus(window.document)
    expect(sidebars).toHaveLength(2)
    for (const sidebar of sidebars) expect(sidebar.closest('[data-pagefind-ignore="all"]'), 'sidebar is outside the index').not.toBeNull()
  })

  it('keeps the page content and its contents rail in the layout\'s main column', async () => {
    const object = first('rs', 'resources')
    const document = await page('rs', 'resources', object)
    const layout = document.querySelector('main > .api-reference-layout.api-reference-layout--symbol')!
    expect(layout.querySelector(':scope > .api-reference-content h1 code')?.textContent).toBe(object.name)
    expect(layout.querySelector(':scope > .api-reference-content nav.api-section-links')).not.toBeNull()
    const index = await page('rs', 'tools')
    expect(index.querySelector('main > .api-reference-layout:not(.api-reference-layout--symbol) > .api-reference-content h1')?.textContent).toBe('Tools')
  })
})
