import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

const layout = readFileSync(new URL('../src/layouts/DocsLayout.astro', import.meta.url), 'utf8')
/** The layout's scoped stylesheet, without comments. */
const css = layout.slice(layout.lastIndexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '')

it('puts the contents rail after the article in source, so the article is read and tabbed first', () => {
  const main = layout.indexOf('<main class="min-w-0 flex-1">')
  const end = layout.indexOf('</main>')
  const rail = layout.indexOf('<aside class="hidden w-56 shrink-0 xl:block" data-toc-rail')
  expect(main).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(main)
  expect(rail).toBeGreaterThan(end)
  expect(layout.match(/<aside[^>]*data-toc-rail/g)).toHaveLength(1)
  expect(layout).not.toMatch(/order-last/)
})

it('reserves the rail column on the wrapper, which precedes the article, only for a page that has a rail', () => {
  const wrapper = layout.indexOf("<div class:list={['docs-shell mx-auto flex max-w-[100rem]")
  expect(wrapper).toBeGreaterThan(0)
  expect(wrapper).toBeLessThan(layout.indexOf('<main class="min-w-0 flex-1">'))
  expect(layout).toContain("tocItems.length > 0 && 'docs-has-toc'")
  // 14rem of rail, the 1.25rem gap and the wrapper's own 1.25rem edge.
  expect(css).toMatch(/@media \(min-width: 80rem\)[\s\S]*\.docs-has-toc:not\(\.docs-reference-navigation\)\s*\{\s*position: relative;\s*padding-inline-end: 16\.5rem;\s*min-height: calc\(100vh - 3rem\);/)
  expect(css).toMatch(/\.docs-has-toc:not\(\.docs-reference-navigation\) > \[data-toc-rail\]\s*\{[^}]*position: absolute;/)
  expect(css).toMatch(/\.docs-reference-navigation\.docs-has-toc\s*\{\s*grid-template-columns: 16rem minmax\(0, 1fr\) 14rem;/)
})

it('reserves nothing below the width where the rail shows, and no longer waits for the rail to parse', () => {
  const reserving = css.match(/padding-inline-end: 16\.5rem/g) ?? []
  expect(reserving).toHaveLength(1)
  // The reservation sits inside the min-width: 80rem block, never at the base.
  expect(css.indexOf('padding-inline-end: 16.5rem')).toBeGreaterThan(css.indexOf('@media (min-width: 80rem)'))
  // The reference grid is no longer widened by finding the rail with :has(), which waited for it.
  expect(css).not.toMatch(/:has\(> aside\)/)
  expect(layout).toMatch(/<aside class="hidden w-56 shrink-0 xl:block" data-toc-rail[ >]/)
})

/**
 * The layout renders the real outline twice, the narrow-screen drawer and the desktop rail, and stubs the document shell.
 * The stubs record what the layout hands the shell, so a test can read the layout family and the strip's mode.
 */
async function renderLayout(props: Record<string, unknown>) {
  const layout = await loadAstroTemplate('layouts/DocsLayout.astro', {
    real: ['components/MobileToC.astro', 'components/TableOfContents/TableOfContents.astro', 'components/TableOfContents/TableOfContentsList.astro'],
    stubs: {
      'layouts/BaseLayout.astro': '---\nconst { documentationLayout } = Astro.props\n---\n<div data-layout={documentationLayout}><slot name="context" /><slot /></div>',
      'components/docs/DocumentationContext.astro': '---\nconst { reference, tableOfContents } = Astro.props\n---\n<div data-context data-reference={String(reference)} data-contents={String(tableOfContents)}><slot name="navigation" /></div>',
    },
  })
  const window = new Window()
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(layout, { url: 'https://libtmux.org/tmux/latest/manual/capture-pane/', props: {
    title: 'tmux capture-pane', pagePath: 'tmux/latest/manual/capture-pane',
    headings: [{ depth: 2, slug: 'syntax', text: 'Syntax' }, { depth: 3, slug: 'flags', text: 'Flags' }], ...props } }))
  return window.document
}

it('keeps the outline out of the search index, whichever of its two renderings is hidden at the width', async () => {
  const document = await renderLayout({})
  const outlines = [...document.querySelectorAll('nav.toc-nav')]
  expect(outlines, 'the drawer and the rail').toHaveLength(2)
  // Search reads the article's own headings; an outline in the index only repeats them, in excerpts and as a heading of its own.
  for (const outline of outlines) expect(outline.closest('[data-pagefind-ignore="all"]'), 'outline is outside the index').not.toBeNull()
  // At every width at most one is in the accessibility tree: the closed drawer is inert, and each is display:none where it is not used.
  expect(document.getElementById('mobile-toc')?.hasAttribute('inert')).toBe(true)
  expect(document.getElementById('mobile-toc')?.className).toContain('xl:hidden')
  expect(document.querySelector('[data-toc-rail]')?.className).toMatch(/\bhidden\b.*\bxl:block\b/)
})

it('draws a reference-family page in the reference layout, with no outline beside its section bar, when the page says so', async () => {
  const document = await renderLayout({ documentationLayout: 'reference', tableOfContents: false })
  expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('reference')
  expect(document.querySelector('[data-context]')?.getAttribute('data-reference')).toBe('true')
  expect(document.querySelector('[data-context]')?.getAttribute('data-contents')).toBe('false')
  expect(document.querySelector('[data-toc-rail], #mobile-toc, nav.toc-nav'), 'no outline rail or drawer').toBeNull()
})

it('keeps the prose layout for a page that does not ask for another', async () => {
  const document = await renderLayout({})
  expect(document.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('prose')
  expect(document.querySelector('[data-context]')?.getAttribute('data-reference')).not.toBe('true')
  expect(document.querySelector('[data-context]')?.getAttribute('data-contents')).toBe('true')
})
