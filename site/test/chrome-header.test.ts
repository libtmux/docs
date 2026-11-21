import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLocale } from '../src/i18n/locales'
import { below } from '../src/lib/breakpoints'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { parseHtml } from './header-page'

/**
 * The header's chrome rules from the design system's SiteHeader and
 * ContextStrip components: the Menu button only where it holds something the
 * bar does not, the search shortcut, the one-line release notice on phones and
 * the programming-language label.
 */
const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
const real = [
  'components/SiteHeader.astro', 'components/HeaderLinks.astro', 'components/HeaderPicker.astro',
  'components/icons/RegistryIcon.astro', 'components/PrereleaseNotice.astro',
]
let layout: unknown
beforeAll(async () => {
  layout = await loadAstroTemplate('layouts/BaseLayout.astro', { real, modules: { '../i18n/resolve': { buildLocale } } })
})
afterEach(() => vi.unstubAllEnvs())

async function page(path: string, slots: Record<string, string> = {}, portSlug = 'go') {
  vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
  const html = await renderAstroTemplate(layout, {
    url: `https://libtmux.org${path}`,
    props: { title: 'Documentation', pagePath: 'guides/panes', portSlug, locale: 'en', pageSource: { repo: 'libtmux/docs', ref: 'main', path: 'x.md' } },
    slots: { default: '<main>Page content</main>', ...slots },
  })
  return parseHtml(html, `https://libtmux.org${path}`).document
}

/** The declarations a stylesheet gives `selector` inside any `@media <query>` block. */
function ruleIn(query: string, selector: string) {
  const pattern = new RegExp(`${selector.replaceAll('.', '\\.').replaceAll('(', '\\(').replaceAll(')', '\\)').replaceAll('[', '\\[').replaceAll(']', '\\]')}\\s*\\{([^}]*)\\}`)
  for (let start = css.indexOf(`@media ${query} {`); start >= 0; start = css.indexOf(`@media ${query} {`, start + 1)) {
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}' && --depth === 0) {
        const found = pattern.exec(css.slice(start, i + 1))?.[1]
        if (found !== undefined) return found
        break
      }
    }
  }
  return undefined
}

describe('header Menu button', () => {
  it('is marked as overflow under a ContextStrip, where its panel holds nothing the bar lacks from 48rem', async () => {
    const withStrip = await page('/en/go/latest/guides/panes/', { context: '<div data-context-probe></div>' })
    expect(withStrip.querySelector('details.site-header__menu')!.classList.contains('site-header__menu--overflow')).toBe(true)
    const without = await page('/en/go/latest/search/')
    expect(without.querySelector('details.site-header__menu')!.classList.contains('site-header__menu--overflow')).toBe(false)
  })

  it('keeps its panel in the document, so the first-paint hold still has its target', async () => {
    const doc = await page('/en/go/latest/guides/panes/', { context: '<div data-context-probe></div>' })
    expect(doc.querySelector('#site-header-panel')).not.toBeNull()
    expect(doc.querySelector('link[rel="expect"]')!.getAttribute('href')).toBe('#site-header-panel')
  })

  it('goes from bp-tablet, and only the overflow form', () => {
    expect(ruleIn('(min-width: 48rem)', '.site-header__menu--overflow')).toMatch(/display:\s*none/)
    expect(css).not.toMatch(/\.site-header__menu\s*\{[^}]*display:\s*none/)
  })
})

describe('header search', () => {
  it('announces its shortcut and draws the key cap for sighted readers only', async () => {
    const doc = await page('/en/go/latest/guides/panes/')
    const search = doc.querySelector('a.site-header__search')!
    expect(search.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K')
    const cap = search.querySelector('kbd.site-header__search-hint')!
    expect(cap.getAttribute('aria-hidden')).toBe('true')
    expect(cap.textContent).toBe('Ctrl K')
    expect(ruleIn('(min-width: 80rem)', '.site-header__search-hint')).toMatch(/display:\s*inline-block/)
  })
})

describe('release notice on phones', () => {
  it('has a short line, the sentence and a disclosure that opens without a script', async () => {
    const doc = await page('/en/go/latest/guides/panes/')
    const notice = doc.querySelector('[data-prerelease-notice]')!
    expect(notice.querySelector('.prerelease-notice__lead')!.textContent).toBe('APIs may still change.')
    expect(notice.querySelector('.prerelease-notice__full')!.textContent).toContain('This site\'s structure and URLs may change too.')
    const more = notice.querySelector('details.prerelease-notice__more')!
    expect(more.querySelector('summary')!.textContent).toContain('More')
    // A <details> is not allowed inside the paragraph, so the parser must not have moved it out of the notice.
    expect(more.closest('[data-prerelease-notice]')).toBe(notice)
    expect(notice.querySelector('p details')).toBeNull()
    expect(notice.querySelector('[data-prerelease-dismiss]')).not.toBeNull()
  })

  // The full sentence wraps to two to four rows between 30rem and 48rem, and fits on one line from bp-nav (64rem).
  it('holds one line under bp-nav and shows the sentence only when More is open', () => {
    const folded = (selector: string) => ruleIn(below('nav'), selector)
    expect(folded('.prerelease-notice--collapsible .prerelease-notice__lead')).toMatch(/white-space:\s*nowrap/)
    expect(folded('.prerelease-notice--collapsible .prerelease-notice__inner')).toMatch(/flex-wrap:\s*wrap/)
    expect(folded('.prerelease-notice--collapsible .prerelease-notice__more')).toMatch(/display:\s*block/)
    expect(folded('.prerelease-notice--collapsible .prerelease-notice__text > .prerelease-notice__full')).toMatch(/display:\s*none/)
    expect(css, 'the phone query no longer holds the fold').not.toMatch(/@media \(max-width: 29\.999rem\) \{\s*\.prerelease-notice--collapsible/)
    expect(css).toMatch(/\.prerelease-notice--collapsible:has\(\.prerelease-notice__more\[open\]\) \.prerelease-notice__full\s*\{\s*display:\s*block/)
    expect(css).toMatch(/\.prerelease-notice__lead,\s*\.prerelease-notice__more\s*\{\s*display:\s*none/)
  })
})

describe('programming-language label', () => {
  it('names the header picker for what it chooses, apart from the translation-language picker', async () => {
    const picker = await loadAstroTemplate('components/PagePortSwitcher.astro')
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
    const doc = parseHtml(await renderAstroTemplate(picker, {
      props: { entries: [{ port: 'go', name: 'Go', links: [{ href: '/en/go/latest/' }] }], portSlug: 'go' },
    })).document
    expect(doc.querySelector('summary')!.getAttribute('aria-label')).toBe('Go: choose a programming language or tmux documentation')
  })
})

describe('the bar at an enlarged root size (adoption plan step 51)', () => {
  const launcher = readFileSync(new URL('../src/components/HomeLauncher.astro', import.meta.url), 'utf8')
  const bar = /\n\.site-header__bar \{([^}]*)\}/.exec(css)![1]!

  it('wraps whenever its content does not fit, on every page, and keeps the colour controls at the end of their row', () => {
    expect(bar).toMatch(/flex-wrap:\s*wrap/)
    expect(css).not.toMatch(/\.site-header__bar:has\(\.site-header-language\)\s*\{\s*flex-wrap/)
    expect(launcher, 'the home no longer holds the bar to one row').not.toMatch(/site-header__bar:has\(\.home-launcher\)\)\s*\{\s*flex-wrap:\s*nowrap/)
    expect(/\n\.site-header__always \{([^}]*)\}/.exec(css)![1]).toMatch(/margin-inline-start:\s*auto/)
  })

  it('keeps the home language picker at its content width, so its label is not cut away', () => {
    expect(/\.home-language-control \{([^}]*)\}/.exec(launcher)![1]).toMatch(/min-width:\s*max-content/)
  })
})
