import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { PORT_BY_SLUG } from '../src/lib/ports'

const stubs = { 'components/PortLinks.astro': '---\n---\n<nav class="port-links"><a class="port-link" href="https://github.com/x">GitHub</a><a class="port-link" href="https://crates.io/x">crates.io</a></nav>' }

async function hero(slug: string) {
  const template = await loadAstroTemplate('components/PortHero.astro', { real: ['components/DocumentationHero.astro'], stubs })
  const window = new Window()
  window.document.body.innerHTML = await renderAstroTemplate(template, { url: `https://libtmux.org/${slug}/latest/`, props: { port: PORT_BY_SLUG[slug] } })
  return window.document as unknown as Document
}

describe('the port hero', () => {
  it.each(['rs', 'kotlin'])('reads logo, heading, tagline and definition, with the links at the top right (%s)', async (slug) => {
    const doc = await hero(slug)
    const section = doc.querySelector('.port-hero')!
    const text = section.querySelector(':scope > div:not(.port-hero__links)')!
    const links = section.querySelector(':scope > .port-hero__links')!
    expect(links.querySelectorAll('a.port-link').length).toBeGreaterThan(0)
    // The links are a sibling of the text column, so they cannot overlap the heading at any width.
    expect(text.contains(links)).toBe(false)
    expect(text.querySelector('h1')!.textContent).toBe(`libtmux for ${PORT_BY_SLUG[slug]!.language}`)
    expect(text.querySelector('.port-hero__tagline')!.textContent).toBe(`${PORT_BY_SLUG[slug]!.language}-based tmux client`)
    expect(links.querySelector('h1')).toBeNull()
    expect([...section.children].map((node) => node.tagName.toLowerCase() + (node.classList.contains('port-hero__links') ? '.links' : ''))).toEqual(['img', 'div', 'div.links'])
    expect([...text.children].map((node) => node.tagName.toLowerCase())).toContain('p')
    expect(text.querySelector('[data-port-definition]')).not.toBeNull()
    // No monospace package line: the package is in the install block, the registry link and the title.
    expect(text.querySelector('.font-mono')).toBeNull()
    expect(section.textContent).not.toContain(PORT_BY_SLUG[slug]!.packageName === 'libtmux' ? 'libtmux\n' : '\u0000')
  })

  it('keeps the facade sentence', async () => {
    expect((await hero('kotlin')).querySelector('.port-hero')!.textContent).toContain('Built on the')
    expect((await hero('rs')).querySelector('.port-hero')!.textContent).not.toContain('Built on the')
  })

  it('places the links in a grid cell of their own, below the text on narrow widths', () => {
    const css = readFileSync(new URL('../src/components/DocumentationHero.astro', import.meta.url), 'utf8')
    expect(css).toContain('grid-template-areas: "mark text links"')
    expect(css).toMatch(/min-width: 48rem\) \{\s*\.port-hero > div:not\(\.port-hero__links\) \{ max-width: 36rem; \}/)
    expect(css).not.toMatch(/max-width: 47\.99rem[\s\S]*max-width: 36rem/)
    // Wide: one pill per row at equal width. Narrow: a wrapping row again.
    expect(css).toMatch(/\.port-hero__links :global\(\.port-links\) \{ display: grid; grid-template-columns: max-content;/)
    expect(css).toMatch(/max-width: 47\.99rem[\s\S]*\.port-links\) \{ display: flex; flex-wrap: wrap; \}/)
    expect(css).toMatch(/max-width: 47\.99rem[\s\S]*grid-template-areas: "mark text" "\. links"/)
  })
})
