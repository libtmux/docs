import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []), render: vi.fn(async () => ({})) }))
import { Window, type Document, type Element, type HTMLAnchorElement } from 'happy-dom'
import { getDocumentationSurfaces } from '../src/lib/documentation-navigation'
import { PORTS, portHomeUrl } from '../src/lib/ports'
import { defaultVersionFor } from '../src/lib/versions'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

const text = (node: { textContent: string | null } | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim()
const open = (html: string) => {
  const win = new Window()
  windows.push(win)
  win.document.write(html)
  return win.document
}

let page: unknown
let picker: unknown
beforeAll(async () => {
  // The real front page, launcher, picker and intro; the layout only passes its slots through.
  page = await loadAstroTemplate('pages/index.astro', {
    real: ['components/HomeLauncher.astro', 'components/HomeIntro.astro', 'components/docs/SurfacePicker.astro', 'components/docs/DocumentationIcon.astro'],
    stubs: { 'layouts/BaseLayout.astro': '<slot name="header-navigation" /><slot />' },
    modules: {
      'astro-expressive-code/components': { Code: () => '' },
      '../i18n/resolve': { ALL_TRANSLATED: {}, buildLocale: () => 'en', localesFor: async () => ['en'] },
    },
  })
  picker = await loadAstroTemplate('components/docs/SurfacePicker.astro', { real: ['components/docs/DocumentationIcon.astro'] })
})

async function frontPage() {
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
  return open(await renderAstroTemplate(page, { url: 'https://libtmux.org/en/' }))
}

const panelOf = (document: Document, slug: string) => document.querySelector(`.home-launcher-solution[data-home-language="${slug}"]`)!
const rowsOf = (panel: Element) => [...panel.querySelectorAll<HTMLAnchorElement>('nav a[data-picker-option]')]

describe('the front page solution picker', () => {
  it('links the Haskell mutation example to its guides and gives every Core card one line', async () => {
    const document = await frontPage()
    const panel = document.querySelector('.home-examples [data-home-language="haskell"]')!
    expect.soft(panel.querySelector('.home-example-link a')!.getAttribute('href')).toMatch(/\/haskell\/[^/]+\/guides\/$/)
    const core = PORTS.map((port) => text(document.querySelector(`.home-intro [data-home-language="${port.slug}"] .home-solutions > a small`)))
    expect.soft(new Set(core)).toEqual(new Set(['Control tmux from your code.']))
    expect(document.querySelector('.home-examples [data-home-language="ts"] .home-example-link a')!.getAttribute('href')).toContain('/examples/')
  })
  it.each(PORTS)('lists $name Home first, at the latest home of that language', async (port) => {
    const document = await frontPage()
    const [first, ...products] = rowsOf(panelOf(document, port.slug))
    expect(text(first!.querySelector('span')), 'the first row is Home').toBe('Home')
    expect(first!.getAttribute('href')).toBe(portHomeUrl(port, defaultVersionFor(port.slug)))
    // The language page that the intro already offers is the page the row opens.
    const explore = document.querySelector(`.home-intro [data-home-language="${port.slug}"] .brand-action`)!
    expect(first!.getAttribute('href')).toBe(explore.getAttribute('href'))
    // Home is a destination like the products below it, and only it is Home.
    expect(first!.classList.contains('surface-destination')).toBe(true)
    expect(first!.querySelector('.surface-destination-arrow')).not.toBeNull()
    expect(products.length).toBeGreaterThan(0)
    for (const row of products) {
      expect(row.classList.contains('surface-destination'), text(row)).toBe(true)
      expect(row.getAttribute('href'), text(row)).not.toBe(first!.getAttribute('href'))
      expect(text(row), 'one Home row').not.toMatch(/^Home\b/)
    }
  })

  it.each(PORTS)('counts the $name products without counting Home', async (port) => {
    const document = await frontPage()
    const panel = panelOf(document, port.slug)
    const rows = rowsOf(panel)
    const products = (await getDocumentationSurfaces(port.slug, defaultVersionFor(port.slug), 'en')).filter((surface) => surface.id !== 'home')
    expect(text(panel.querySelector('.doc-picker-count'))).toBe(String(products.length))
    expect(rows.length).toBe(products.length + 1)
    expect(rows.slice(1).map((row) => row.getAttribute('href'))).toEqual(products.map((surface) => surface.href))
    // The intro cards below the picker list the same products and no Home card.
    const cards = [...document.querySelectorAll(`.home-intro [data-home-language="${port.slug}"] .home-solutions > a`)]
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(products.map((surface) => surface.href))
  })

  it('draws the Home row with the icon the documentation picker uses', async () => {
    const document = await frontPage()
    const [port] = PORTS
    const home = rowsOf(panelOf(document, port!.slug))[0]!
    const surfaces = await getDocumentationSurfaces(port!.slug, defaultVersionFor(port!.slug), 'en')
    const current = surfaces[0]!.href
    const portPage = open(await renderAstroTemplate(picker, {
      url: `https://libtmux.org${current}`,
      props: { surfaces, currentPath: current, port: port!.slug, version: defaultVersionFor(port!.slug), locale: 'en' },
    }))
    const reference = portPage.querySelector('[data-surface-home] a')!
    expect(home.querySelector('svg')!.outerHTML).toBe(reference.querySelector('svg')!.outerHTML)
    // The port page keeps its compact row: the current mark, no arrow.
    expect(text(reference)).toBe('Home ✓')
    expect(reference.classList.contains('surface-destination')).toBe(false)
    expect(reference.querySelector('.surface-destination-arrow')).toBeNull()
    // The launcher only offers a place to go: no current mark on any row.
    expect(home.hasAttribute('aria-current')).toBe(false)
    expect(home.querySelector('.doc-picker-check')).toBeNull()
  })

  it('shows the default language Home before any script runs', async () => {
    const document = await frontPage()
    const shown = [...document.querySelectorAll('.home-launcher-solution')].filter((panel) => !panel.hasAttribute('hidden'))
    expect(shown.map((panel) => panel.getAttribute('data-home-language'))).toEqual([PORTS[0]!.slug])
    expect(rowsOf(shown[0]!)[0]!.getAttribute('href')).toBe(portHomeUrl(PORTS[0]!, defaultVersionFor(PORTS[0]!.slug)))
    // Every other language keeps its own Home in its own hidden panel, so selecting one only reveals it.
    for (const port of PORTS.slice(1)) {
      const panel = panelOf(document, port.slug)
      expect(panel.hasAttribute('hidden'), port.slug).toBe(true)
      expect(rowsOf(panel)[0]!.getAttribute('href'), port.slug).toBe(portHomeUrl(port, defaultVersionFor(port.slug)))
    }
  })
})
