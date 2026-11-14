import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { pageBreadcrumbs } from '../src/lib/sidebar'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { closeWindows, go, symbolOf, windows } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)

/**
 * The breadcrumb of an API page against the design system (Breadcrumb, record 0021).
 */
describe('the breadcrumb (Breadcrumb, record 0021)', () => {
  const trail = async (crumbs: unknown[]) => {
    const template = await loadAstroTemplate('components/PageToolbar.astro', { real: ['components/api/SymbolName.astro'] })
    const win = new Window({ url: 'https://libtmux.org/en/go/latest/reference/tmux-pane-capture/' })
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { breadcrumbs: crumbs } }))
    return win.document
  }
  const items = [
    { name: 'Go', url: '/en/go/latest/' }, { name: 'Core Library', url: '/en/go/latest/core/' },
    { name: 'API reference', url: '/en/go/latest/reference/' }, { name: 'Pane section', url: '/en/go/latest/reference/#section-pane' },
    { name: 'Pane', url: '/en/go/latest/reference/tmux-pane/', symbol: true }, { name: 'Capture', symbol: true },
  ]

  it('draws an owner and the page as code, so a reader tells the type from the sidebar bucket', async () => {
    const document = await trail(items)
    const crumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
    expect(crumbs.map((crumb) => crumb.querySelector('code') !== null)).toEqual([false, false, false, false, true, true])
    expect(crumbs.at(-1)?.getAttribute('aria-current')).toBe('page')
  })

  it('collapses the middle on a phone: the first and the last two stay, and the "…" names what it hides', async () => {
    const document = await trail(items)
    const lis = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')]
    expect(lis.map((li) => li.classList.contains('crumb-mid') ? 'mid' : li.classList.contains('crumb-collapsed') ? '…' : li.textContent!.replaceAll('/', '').trim()))
      .toEqual(['Go', 'mid', 'mid', 'mid', '…', 'Pane', 'Capture'])
    const collapsed = document.querySelector('nav[aria-label="Breadcrumb"] .crumb-collapsed a')!
    expect(collapsed.textContent).toBe('…')
    expect(collapsed.getAttribute('aria-label')).toBe('Core Library, API reference, Pane section')
    expect(collapsed.getAttribute('href'), 'it links to the nearest index').toBe('/en/go/latest/reference/#section-pane')
    // The "…" is not a crumb of the trail: the visible labels and the structured data stay the same list.
    expect(collapsed.hasAttribute('data-breadcrumb-item')).toBe(false)
  })

  it('does not collapse a trail that already fits', async () => {
    const document = await trail(items.slice(0, 3))
    expect(document.querySelector('.crumb-collapsed')).toBeNull()
    expect(document.querySelectorAll('.crumb-mid')).toHaveLength(0)
  })

  it('shows four levels on an API page, Port / Product / Section / Page, and labels a bucket that repeats its type as a section', async () => {
    const symbol = symbolOf(go, 'tmux.Pane.Capture')
    const crumbs = await pageBreadcrumbs('Pane.Capture', `reference/${symbol.slug}`, 'latest', 'go')
    expect(crumbs.map((crumb) => crumb.name)).toEqual(['Go', 'Core Library', 'API reference', 'Pane section', 'Pane', 'Capture'])
    expect(crumbs.map((crumb) => Boolean(crumb.symbol))).toEqual([false, false, false, false, true, true])
    expect(new Set(crumbs.map((crumb) => crumb.name)).size, 'no label repeats').toBe(crumbs.length)
    expect(crumbs[1]!.url).toMatch(/\/go\/latest\/core\/$/)
  })

  it('names the product on the reference index and the glossary too', async () => {
    expect((await pageBreadcrumbs('API reference', 'reference', 'latest', 'go')).map((crumb) => crumb.name)).toEqual(['Go', 'Core Library', 'API reference'])
    expect((await pageBreadcrumbs('API glossary', 'reference/glossary', 'latest', 'go')).map((crumb) => crumb.name)).toEqual(['Go', 'Core Library', 'API reference', 'API glossary'])
  })
})

