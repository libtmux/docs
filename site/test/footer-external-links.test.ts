import { readFileSync } from 'node:fs'
import { Window, type Element } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

/**
 * The footer's only external destination is the GitHub icon. It is drawn without the external-link glyph that a text
 * link gets, and it keeps an accessible name, because an icon has no text of its own.
 */
const css = readFileSync(new URL('../public/_shell/external-links.css', import.meta.url), 'utf8')
// The selector the stylesheet draws the glyph on, as the stylesheet writes it.
const DECORATED = css.match(/^(a\[data-external-link\][^{]*?)::after\s*\{/m)![1]!

const disposals: (() => void)[] = []
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()))

async function footer(extra = '') {
  const template = await loadAstroTemplate('components/SiteFooter.astro')
  const win = new Window({ url: 'https://libtmux.org/en/scala/latest/' })
  win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, {
    props: { locale: 'en', llmsRoot: '/en/scala/latest/', githubUrl: 'https://github.com/libtmux/libtmux-scala' },
  })) + extra
  disposals.push(installExternalLinks(win as unknown as typeof window), () => { void win.happyDOM.abort() })
  return win.document
}

/** The name a screen reader gives a link: its label, else its text outside anything hidden, else an image's alternative text. */
function accessibleName(link: Element): string {
  const label = link.getAttribute('aria-label')?.trim()
  if (label) return label
  const copy = link.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((node) => node.remove())
  const alternative = [...copy.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt')).join(' ')
  return `${copy.textContent} ${alternative}`.trim()
}

describe('the footer external links', () => {
  it('draws the GitHub link as an icon with no external-link glyph', async () => {
    const document = await footer()
    const external = [...document.querySelectorAll('footer a[data-external-link]')]
    expect(external.map((link) => link.getAttribute('href'))).toEqual(['https://github.com/libtmux/libtmux-scala'])
    const [github] = external
    expect(github!.hasAttribute('data-external-link-icon')).toBe(true)
    expect(github!.matches(DECORATED)).toBe(false)
    expect(github!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(github!.textContent!.trim()).toBe('')
    // Every external destination in the footer is icon-only, so the glyph appears on none of them.
    expect([...document.querySelectorAll('footer a')].filter((link) => link.matches(DECORATED))).toEqual([])
  })

  it('names the icon link, and keeps the destination in its description', async () => {
    const [github] = [...(await footer()).querySelectorAll('footer a[data-external-link]')]
    expect(accessibleName(github!)).toBe('GitHub')
    expect(github!.getAttribute('aria-description')).toBe('External site: github.com')
    expect(github!.getAttribute('title')).toBe('View on github.com')
  })

  it('tells an icon from a text link: only the text link takes the glyph', async () => {
    const document = await footer('<footer><a id="text" href="https://example.com/notes">Notes</a></footer>')
    const text = document.getElementById('text')!
    expect(text.hasAttribute('data-external-link')).toBe(true)
    expect(text.matches(DECORATED)).toBe(true)
  })

  it('leaves the glyph off every icon-only link in the stylesheet', () => {
    expect(DECORATED).toContain(':not([data-external-link-icon])')
  })
})
