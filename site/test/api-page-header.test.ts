import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { closeWindows, go, options, page, symbolOf, windows } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)
// The first test of a cold run compiles the real templates and loads the API models.
vi.setConfig({ testTimeout: 60_000 })

/**
 * The header of an API page against the design system (PageApiDetail; adoption steps 2 and 3).
 */
describe('the page header (PageApiDetail, adoption steps 2 and 3)', () => {
  it('states the version once, in the context strip: no `latest` badge beside the title', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane.Capture'))
    expect(document.querySelector('.api-reference-version')).toBeNull()
    expect(document.querySelector('.api-reference-eyebrow')?.textContent).not.toMatch(/\blatest\b/)
    expect(document.querySelector('.api-reference-eyebrow .api-badge--mod')).toBeNull()
  })

  it('keeps the eyebrow out of search, weights the title, and indexes the owner as metadata', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane.Capture'))
    expect(document.querySelector('.api-reference-eyebrow')?.getAttribute('data-pagefind-ignore')).toBe('all')
    expect(document.querySelector('h1')?.getAttribute('data-pagefind-weight')).toBe('10')
    expect(document.querySelector('[data-pagefind-meta="owner:Pane"]')).not.toBeNull()
    expect(document.querySelector('[data-pagefind-meta^="kind:"]')).not.toBeNull()
  })

  it('draws one outline: the section bar, and no right-hand "On this page" list', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane.Capture'))
    expect(document.querySelectorAll('nav.api-section-links')).toHaveLength(1)
    expect(document.querySelector('nav[aria-label="On this page"]')).toBeNull()
    expect(document.querySelector('nav[aria-label="Related APIs"]')).toBeNull()
    // The element stays: it measures the sticky bars and marks the section in view.
    expect(document.querySelector('api-page-contents')).not.toBeNull()
    expect(document.querySelector('api-page-contents aside')).toBeNull()
  })

  it('keeps the right-hand list where there is no section bar, on the glossary', async () => {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { ...options, stubs: { ...options.stubs,
      'components/api/ApiGlossaryContent.astro': '<p>glossary</p>' } })
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, {
      url: 'https://libtmux.org/en/go/latest/reference/glossary/', props: { model: go, glossary: true },
    }))
    expect(win.document.querySelector('nav[aria-label="On this page"]')).not.toBeNull()
  })
})

