import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Window, type Document } from 'happy-dom'
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
    'components/docs/DocumentationNavigationButtons.astro', 'components/PageToolbar.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro',
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
  it.each(cases)('shows %s %s with the section context, the page search and no API browser', async (port, section) => {
    const document = await page(port, section, first(port, section))
    expect(document.querySelector('.api-nav, #api-nav, [data-api-nav-toggle]'), 'no API tree, filters or its toggle').toBeNull()
    const sidebars = menus(document)
    // The drawer and the desktop column carry the same menu, and so does the no-script fallback.
    expect(sidebars.map((sidebar) => sidebar.closest('aside')?.id || 'desktop')).toEqual(['mobile-sidebar', 'desktop'])
    expect(document.querySelectorAll('noscript [data-section-navigation]')).toHaveLength(1)
    for (const sidebar of sidebars) {
      const context = sidebar.parentElement!.querySelector('.section-context')!
      expect([...context.children].map((child) => child.textContent)).toEqual(['MCP', MCP_SECTIONS[section]])
      expect(sidebar.querySelector('input[type="search"][data-section-search]')?.getAttribute('placeholder')).toBe('Find page')
      expect(sidebar.querySelector('nav')?.getAttribute('aria-label')).toBe(`MCP: ${MCP_SECTIONS[section]}`)
    }
  })

  it.each(cases)('nests %s %s under its groups and marks only the current page', async (port, section) => {
    const object = first(port, section)
    const group = mcpSectionGroups(port, section).find((entry) => entry.objects.includes(object))!
    const document = await page(port, section, object)
    expect(menus(document)).toHaveLength(2)
    for (const nav of menus(document).map((sidebar) => sidebar.querySelector('nav')!)) {
      const current = [...nav.querySelectorAll('[aria-current="page"]')]
      expect(current.map((row) => row.textContent?.trim()), 'one current row, the page itself').toEqual([object.name])
      expect(current[0].matches('a.sidebar-link.api-nav__row')).toBe(true)
      const details = current[0].closest('details.sidebar-section')!
      expect(details.getAttribute('open'), 'the group of the page is open').not.toBeNull()
      expect(details.querySelector(':scope > summary')?.textContent?.trim()).toBe(group.label)
      expect(details.querySelector(':scope > .sidebar-section__children')?.contains(current[0])).toBe(true)
      expect(current[0].parentElement?.closest('details')).toBe(details)
      expect(nav.querySelectorAll('details.sidebar-section[open]'), 'every other group stays closed').toHaveLength(1)
      // A group names its kind: its rows draw no mark and keep the kind for assistive technology.
      expect(nav.querySelector('.api-nav__kind'), 'no kind mark on a row').toBeNull()
      expect(current[0].getAttribute('aria-description')).toBe(object.kind)
    }
  })

  it.each(cases)('marks the section overview on the %s %s index and opens no group', async (port, section) => {
    const document = await page(port, section)
    const nav = menus(document)[1].querySelector('nav')!
    expect([...nav.querySelectorAll('[aria-current="page"]')].map((row) => row.textContent?.trim())).toEqual(['Overview'])
    expect(nav.querySelectorAll('details.sidebar-section[open]')).toHaveLength(0)
    expect([...nav.querySelectorAll('summary')].map((row) => row.textContent?.trim()))
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

  it('keeps the breadcrumb trail through the group of the object', async () => {
    const object = first('rs', 'resources')
    const document = await page('rs', 'resources', object)
    const trail = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
    expect(trail.map((item) => item.textContent?.trim())).toEqual(['Rust', 'MCP', 'Resources', 'Fixed resources', object.name])
    expect(trail.map((item) => item.getAttribute('href'))).toEqual(['/rs/next/', '/rs/next/mcp/', '/rs/next/mcp/resources/', '/rs/next/mcp/resources/#resources-fixed-resources', null])
  })

  it('keeps the sidebar out of search, as the API tree was', async () => {
    const document = await page('rs', 'tools', first('rs', 'tools'))
    const sidebars = menus(document)
    expect(sidebars).toHaveLength(2)
    for (const sidebar of sidebars) expect(sidebar.closest('[data-pagefind-ignore="all"]'), 'sidebar is outside the index').not.toBeNull()
    expect(document.querySelector('.api-reference-content')?.closest('[data-pagefind-ignore]')).toBeNull()
  })

  it('leaves the sidebar of every other documentation page indexed', async () => {
    const layout = await loadAstroTemplate('layouts/DocsLayout.astro', options)
    const window = new Window()
    window.document.body.innerHTML = withoutScope(await renderAstroTemplate(layout, {
      url: 'https://libtmux.org/rs/next/mcp/guides/', props: { title: 'Guides', port: 'rs', version: 'next', pagePath: 'mcp/guides' },
    }))
    const sidebars = menus(window.document)
    expect(sidebars).toHaveLength(2)
    for (const sidebar of sidebars) expect(sidebar.closest('[data-pagefind-ignore]')).toBeNull()
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
