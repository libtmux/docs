import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

const source = readFileSync(new URL('../src/components/DocCard.astro', import.meta.url), 'utf8')
/** The component's stylesheet without comments. */
const css = source.slice(source.indexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '')

const windows: Window[] = []
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()))
})

async function card(props: Record<string, unknown>) {
  const template = await loadAstroTemplate('components/DocCard.astro')
  const window = new Window()
  windows.push(window)
  window.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props }))
  return window.document as unknown as Document
}

/** Card README: a bordered box for one destination, badges mounted in its corners. */
describe('card anatomy', () => {
  it('is a bordered box with a title and one line, and no corner when it has none', async () => {
    const document = await card({ href: '/guides/', label: 'Guides', body: 'Task guides.' })
    const link = document.querySelector('a.doc-card')!
    expect(link.querySelector('h3')!.textContent!.trim()).toBe('Guides')
    expect(link.querySelector('.doc-card__body')!.textContent).toBe('Task guides.')
    expect(link.querySelector('.lm-corner')).toBeNull()
    expect(link.getAttribute('target')).toBeNull()
  })

  it('moves an external card\'s arrow to a quiet top-right corner and says the link opens a new tab', async () => {
    const document = await card({ href: 'https://pkg.go.dev/x', label: 'pkg.go.dev documentation', body: 'Go API.', external: true })
    const link = document.querySelector('a.doc-card')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener')
    const corner = link.querySelector(':scope > .lm-corner.lm-corner--tr')!
    expect(corner, 'the corner is the first child, before the content').toBe(link.firstElementChild)
    expect(corner.querySelector('.lm-tab.lm-tab--quiet')!.getAttribute('aria-hidden')).toBe('true')
    const title = link.querySelector('h3')!
    expect(title.textContent).not.toContain('↗')
    expect(title.querySelector('.sr-only')!.textContent).toBe(' (opens in a new tab)')
  })

  it('mounts a label of one or two words in the bottom-right corner, or the corner asked for', async () => {
    const first = await card({ href: '/mcp/', label: 'MCP', body: 'Server.', corner: { label: 'alpha', title: 'Alpha: the API may change between releases' } })
    const corner = first.querySelector('a.doc-card > .lm-corner')!
    expect(corner.className).toBe('lm-corner')
    expect(corner.querySelector('.lm-tab')!.textContent).toBe('alpha')
    expect(corner.querySelector('.lm-tab')!.getAttribute('title')).toBe('Alpha: the API may change between releases')
    const second = await card({ href: '/x/', label: 'X', body: 'x', corner: { label: '0.x', at: 'tl' } })
    expect(second.querySelector('a.doc-card > .lm-corner')!.className).toBe('lm-corner lm-corner--tl')
  })

  it('keeps one slot per corner, so an external card with a status uses two', async () => {
    const document = await card({ href: 'https://x.test/', label: 'X', body: 'x', external: true, corner: { label: 'alpha' } })
    expect([...document.querySelectorAll('a.doc-card > .lm-corner')].map((corner) => corner.className))
      .toEqual(['lm-corner lm-corner--tr', 'lm-corner'])
  })

  it('leaves an unlinked card a plain box', async () => {
    const document = await card({ label: 'Coming', body: 'Not published.' })
    expect(document.querySelector('article.doc-card.doc-card--unlinked')).not.toBeNull()
    expect(document.querySelector('.lm-corner')).toBeNull()
  })
})

describe('card corners (gutter tabs)', () => {
  it('positions the corner inside the card, in the padding, a pixel thinner than it', () => {
    expect(css).toMatch(/\.doc-card\s*\{[^}]*position: relative;[^}]*--gutter: 1rem;/)
    const corner = /\.doc-card > \.lm-corner\s*\{([^}]*)\}/.exec(css)![1]!
    expect(corner).toContain('position: absolute;')
    expect(corner).toContain('--corner-h: calc(var(--gutter) - 1px);')
    expect(css).toMatch(/\.doc-card > \.lm-corner > \*\s*\{[^}]*height: var\(--corner-h\);/)
  })

  it('rounds the corner a tab sits in to the card\'s inner radius and keeps the other two square', () => {
    expect(css).toMatch(/--tab-r: calc\(var\(--card-radius, 0\.5rem\) - 1px\)/)
    expect(css).toMatch(/\.doc-card > \.lm-corner > :first-child\s*\{[^}]*border-top-left-radius: var\(--tab-r\)/)
    expect(css).toMatch(/\.doc-card > \.lm-corner > :last-child\s*\{[^}]*border-bottom-right-radius: var\(--tab-r\)/)
  })

  it('keeps the shell\'s external-link glyph off a card whose corner already carries the arrow', () => {
    expect(css).toMatch(/\.doc-card\[data-external-link\]::after\s*\{\s*content: none;/)
  })

  it('draws no start-edge accent bar', () => {
    expect(css).not.toMatch(/border-inline-start|border-left:\s*[2-9]px/)
  })
})
