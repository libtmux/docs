import { describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { loadAstroTemplate, withoutScope } from './astro-templates'
import { catalogTypeCounts, tmuxCatalog, tmuxCatalogEntries } from '../src/lib/tmux-catalog'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

/**
 * Catalog kind pages are comparison tables: the facts a reader sets side by
 * side (type, default) are columns, one table per scope, every row in the page.
 */
async function render(kind: 'option' | 'hook' | 'format') {
  const page = await loadAstroTemplate('components/tmux/Catalog.astro', { real: ['components/api/ApiBadge.astro', 'components/api/SymbolName.astro'] })
  // The page builds its canonical URL from the site, which the shared helper's container does not set.
  const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } })
  return container.renderToString(page as Parameters<typeof container.renderToString>[0], { request: new Request('https://libtmux.org/tmux/3.7c/catalog/'), props: { version: '3.7c', kind } }).then(withoutScope)
}

const rows = (html: string) => [...html.matchAll(/<tr data-catalog-row[^>]*>/g)]
const heads = (html: string) => [...new Set([...html.matchAll(/<thead[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>\s*<\/thead>/g)].map((m) => [...m[1]!.matchAll(/>([A-Za-z]+)<\/th>/g)].map((x) => x[1]).join(',')))]

describe('catalog kind pages', () => {
  it('lists every option as a table row under its scope, with name, type, default and summary', async () => {
    const html = await render('option')
    expect(rows(html)).toHaveLength(tmuxCatalog('3.7c').counts.option)
    expect(heads(html)).toEqual(['Name,Type,Default,Summary'])
    expect(html).not.toContain('api-index-card')
    // A filter and the type chips exist in the markup; JavaScript reveals them.
    expect(html).toMatch(/data-catalog-filter hidden/)
    expect(html).toMatch(/data-catalog-type="choice"/)
    // Each wide table scrolls in a labelled, focusable region.
    expect(html).toMatch(/class="catalog-table" role="region" tabindex="0" aria-label="[^"]+scrollable"/)
  })

  it('lists the after-command hooks once by name, and the other hooks as Name, Scope, Summary tables', async () => {
    const html = await render('hook')
    expect(html).toContain('class="catalog-names"')
    expect(html).toContain('shares one description')
    expect(heads(html)).toEqual(['Name,Scope,Summary'])
  })

  it('gives formats a Name, Type, Summary table', async () => {
    expect(heads(await render('format'))).toEqual(['Name,Type,Summary'])
  })

  // A reader of a screen reader hears the label whole: "Session options options, scrollable" says the word twice.
  it.each(['option', 'hook', 'format'] as const)('names each %s scroll region once, with no word repeated', async (kind) => {
    const labels = [...(await render(kind)).matchAll(/class="catalog-table" role="region" tabindex="0" aria-label="([^"]+)"/g)].map((m) => m[1]!)
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label, label).not.toMatch(/\b(\w+) \1\b/i)
    expect(labels.every((label) => label.endsWith(', scrollable'))).toBe(true)
  })

  it('sets the page title at the reference scale, as the manual and the C reference do (15-typesetting)', async () => {
    for (const kind of ['option', 'hook', 'format'] as const) {
      const title = /<h1 class="([^"]*)"/.exec(await render(kind))?.[1] ?? ''
      expect(title.split(' '), kind).toContain('api-reference-title')
      // Tailwind's text-2xl is 24/32: the section size, not the title's 32/38.
      expect(title).not.toMatch(/\btext-(?:xl|2xl|3xl)\b/)
    }
  })

  it('counts the types a kind has for its filter chips', () => {
    const chips = catalogTypeCounts(tmuxCatalogEntries('3.7c', 'option'))
    expect(chips[0]![0]).toBe('string')
    expect(chips.reduce((sum, [, n]) => sum + n, 0)).toBeLessThanOrEqual(tmuxCatalog('3.7c').counts.option)
    expect(chips.map(([type]) => type)).toContain('flag')
  })
})
