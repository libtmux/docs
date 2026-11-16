import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { experimental_AstroContainer } from 'astro/container'
import { describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

/**
 * A manual page is in the reference family: the command kind and the release
 * above its title, and a section bar that names the sections it has.
 */
const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre><code>${props.code}</code></pre>`)

/** The layout is a stub that says which layout family and outline the page asked it for. */
const LAYOUT = '---\nconst { documentationLayout, tableOfContents } = Astro.props\n---\n<div data-layout={documentationLayout ?? "prose"} data-contents={String(tableOfContents ?? true)}><slot /></div>'

async function render(slug: string) {
  const page = await loadAstroTemplate('pages/tmux/[version]/manual/[...slug].astro', { real: ['components/api/ApiBadge.astro', 'components/SectionHeading.astro'],
    stubs: { 'layouts/DocsLayout.astro': LAYOUT }, modules: { 'astro-expressive-code/components': { Code } } })
  const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } })
  return withoutScope(await container.renderToString(page as Parameters<typeof container.renderToString>[0], {
    request: new Request(`https://libtmux.org/tmux/3.7c/manual/${slug}/`), params: { version: '3.7c', slug },
  }))
}

describe('tmux manual command page', () => {
  it('shows the command kind and release in an eyebrow, and a section bar for the sections it has', async () => {
    const html = await render('capture-pane')
    expect(html).toMatch(/class="api-reference-eyebrow manual-eyebrow"/)
    expect(html).toContain('3.7c')
    const bar = /<nav class="api-section-links manual-sections"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''
    const labels = [...bar.matchAll(/>([^<>]+)<\/a>/g)].map((m) => m[1])
    expect(labels).toEqual(expect.arrayContaining(['Common uses', 'Syntax', 'Options', 'Use from a library']))
    // Each bar entry points at a heading the page really has.
    for (const [, id] of bar.matchAll(/href="#([^"]+)"/g)) expect(html, id).toContain(`id="${id}"`)
  })

  // The section bar is the page's one outline (TmuxManualPage): a right "On this page" rail beside it lists the same sections twice.
  it('is in the reference layout with no outline rail beside its section bar', async () => {
    const html = await render('capture-pane')
    expect(html).toContain('data-layout="reference"')
    expect(html).toContain('data-contents="false"')
  })

  // The full manual and the command index have no section bar; their headings are the outline.
  it.each(['full', ''])('keeps the outline of the page without a section bar: %j', async (slug) => {
    const html = await render(slug)
    expect(html).not.toContain('manual-sections')
    expect(html).toContain('data-layout="prose"')
    expect(html).toContain('data-contents="true"')
  })
})
