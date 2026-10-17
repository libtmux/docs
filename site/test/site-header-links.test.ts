import { readFileSync } from 'node:fs'
import { Window, type HTMLAnchorElement } from 'happy-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { buildLocale } from '../src/i18n/locales'
import { PORTS } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { DESTINATIONS, type ExpectedLink } from './fixtures/port-destinations'

const windows: Window[] = []
const disposals: (() => void)[] = []
afterEach(async () => {
  disposals.splice(0).forEach((dispose) => dispose())
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

const real = ['components/SiteHeader.astro', 'components/icons/RegistryIcon.astro']
// `i18n/resolve` reads Astro content collections, which a bare vitest run cannot load.
const modules = { '../i18n/resolve': { buildLocale } }
let baseLayout: unknown
let nativeShell: unknown

beforeAll(async () => {
  // The header and its icons run unchanged; sibling components render only their slot.
  baseLayout = await loadAstroTemplate('layouts/BaseLayout.astro', { real, modules })
  nativeShell = await loadAstroTemplate('layouts/NativeShell.astro', {
    real,
    modules: { ...modules, '../lib/reference-page-links': { referencePageLinks: () => ({ schema: 1, indexes: {}, symbols: {} }) } },
  })
})

function parse(html: string) {
  const win = new Window({
    url: 'https://libtmux.org/en/py/latest/',
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  windows.push(win)
  win.document.write(html)
  return win
}

interface PageOptions {
  pagePath?: string
  portSlug?: string
  pageSource?: { repo: string; ref: string; path: string }
  repository?: string
}

async function renderPage(url: string, { pagePath, portSlug, pageSource, repository }: PageOptions = {}) {
  const parsed = new URL(url, 'https://libtmux.org')
  const prefix = /^(\/pr-\d+)?\/(en|ja)\//.exec(parsed.pathname)
  vi.stubEnv('LIBTMUX_DOCS_BASE', prefix?.[0] ?? '/')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', prefix?.[2] ?? 'en')
  return renderAstroTemplate(baseLayout, {
    url: parsed.href,
    props: {
      title: 'Documentation', pagePath, portSlug, repository, locale: prefix?.[2] ?? 'en',
      pageSource: pageSource ?? { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/index.astro' },
    },
    slots: { default: '<main>Page content</main>' },
  })
}

const barLinks = (document: Window['document']) => [...document.querySelectorAll<HTMLAnchorElement>('.site-header__ports a')]
const describeLink = (link: HTMLAnchorElement) => ({ id: link.dataset.portLink, href: link.getAttribute('href'), label: link.getAttribute('aria-label') })
const expectedLinks = (expected: (typeof DESTINATIONS)[string]) =>
  ([['source', expected.source], ['package', expected.registry], ['api', expected.api]] as const)
    .flatMap(([id, link]) => link ? [{ id, href: link.url, label: link.label }] : [])

describe('port links in the top bar', () => {
  it.each(Object.entries(DESTINATIONS))('offers %s its repository, package and API host', async (slug, expected) => {
    const { document } = parse(await renderPage(`/en/${slug}/latest/guides/panes/`, { pagePath: 'guides/panes', portSlug: slug }))
    expect(barLinks(document).map(describeLink)).toEqual(expectedLinks(expected))
  })

  it('has an expectation for every registered port', () => {
    expect(Object.keys(DESTINATIONS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it.each(Object.entries(DESTINATIONS))('keeps the %s links ordinary, named, outside any disclosure and before the controls', async (slug, expected) => {
    const { document } = parse(await renderPage(`/en/${slug}/latest/`, { pagePath: '', portSlug: slug }))
    const links = barLinks(document)
    for (const link of links) {
      expect(link.tagName).toBe('A')
      expect(link.getAttribute('rel')).toBe('noopener')
      expect(link.hasAttribute('target')).toBe(false)
      expect(link.getAttribute('aria-label'), link.href).toBeTruthy()
      expect(link.closest('summary, details'), link.href).toBeNull()
    }
    // The package is its own anchor, never a trigger or a row inside the menu.
    expect(links.some((link) => link.dataset.portLink === 'package')).toBe(Boolean(expected.registry))
    const controls = document.querySelector('.site-header__always')!
    const menu = document.querySelector('details.site-header__menu')!
    expect(document.querySelector('.site-header__ports')!.compareDocumentPosition(controls) & 4).toBeTruthy()
    expect(controls.compareDocumentPosition(menu) & 4).toBeTruthy()
    expect(document.querySelector('a.site-header__search')).not.toBeNull()
    expect(menu.querySelector('summary a')).toBeNull()
    expect(document.querySelectorAll('summary a')).toHaveLength(0)
  })

  it.each(Object.entries(DESTINATIONS))('draws a decorative mark for the %s source and package and text for its API host', async (slug, expected) => {
    const { document } = parse(await renderPage(`/en/${slug}/latest/`, { pagePath: '', portSlug: slug }))
    const marks = (links: ExpectedLink[]) => links.map(({ icon }) => icon)
    const icons = barLinks(document).filter((link) => link.dataset.portLink !== 'api')
    for (const link of icons) {
      expect(link.textContent.trim(), link.href).toBe('')
      const mark = link.querySelector('.registry-icon')!
      expect(mark.getAttribute('aria-hidden') === 'true' || mark.getAttribute('alt') === '', link.href).toBe(true)
    }
    expect(icons.map((link) => link.querySelector('.registry-icon')!.getAttribute('data-icon')))
      .toEqual(['github', ...marks(expected.registry ? [expected.registry] : [])])
    const api = barLinks(document).find((link) => link.dataset.portLink === 'api')
    expect(api?.textContent.trim()).toBe(expected.api?.name)
    expect(api?.querySelector('.registry-icon') ?? null).toBeNull()
  })

  it('carries the API host into the menu, where a narrow bar has no room for text', async () => {
    const { document } = parse(await renderPage('/en/rs/latest/', { pagePath: '', portSlug: 'rs' }))
    const bar = document.querySelector<HTMLAnchorElement>('.site-header__ports a[data-port-link="api"]')!
    const menu = document.querySelector<HTMLAnchorElement>('.site-header__panel-links a.site-header__api-menu')!
    expect(menu.getAttribute('href')).toBe(bar.getAttribute('href'))
    expect(menu.getAttribute('aria-label')).toBe(bar.getAttribute('aria-label'))
    expect(menu.closest('summary')).toBeNull()
    // Ports without a distinct API host add nothing to the menu.
    for (const slug of ['py', 'go', 'cxx']) {
      const page = parse(await renderPage(`/en/${slug}/latest/`, { pagePath: '', portSlug: slug }))
      expect(page.document.querySelector('.site-header__api-menu')).toBeNull()
      expect(page.document.querySelector('.site-header__panel-links')!.querySelectorAll('a')).toHaveLength(2)
    }
  })

  it('hides the duplicate API link by width, so one copy is exposed at a time', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(max-width: 47\.999rem\) \{\s*\.site-header__port-link--api \{ display: none; \}/)
    expect(css).toMatch(/@media \(min-width: 48rem\) \{\s*\.site-header__api-menu \{ display: none; \}/)
  })

  it.each(['py', 'rs', 'cxx'])('leaves the %s mark and source link without the external-link glyph', async (slug) => {
    const win = parse(await renderPage(`/en/${slug}/latest/`, { pagePath: '', portSlug: slug }))
    const { document } = win
    disposals.push(installExternalLinks(win as unknown as typeof window))
    await win.happyDOM.waitUntilComplete()
    for (const link of barLinks(document)) {
      expect(link.hasAttribute('data-external-link'), link.href).toBe(true)
      // Icon-only links keep their name and hint but draw no glyph; the text link may.
      expect(link.hasAttribute('data-external-link-icon'), link.href).toBe(link.dataset.portLink !== 'api')
    }
    const source = document.querySelector('[data-port-link="source"]')!
    expect(source.getAttribute('aria-label')).toBe(DESTINATIONS[slug]!.source.label)
    expect(source.getAttribute('aria-description')).toMatch(/^External site: github\.com$/)
  })
})

describe('port links by page', () => {
  it('adds none to the homepage, tmux routes or other pages without a port', async () => {
    for (const prefix of ['/en/', '/ja/', '/pr-42/en/', '/pr-42/ja/']) {
      for (const page of ['', 'tmux', 'tmux/', 'tmux/guides', 'tmux/topics/environment', 'tmux/concepts/servers',
        'tmux/latest/manual', 'tmux/3.2a/manual/full/', 'tmux/latest/reference/server', 'tmux/3.7c/reference/', 'search', 'translations', 'mcp', 'workspace']) {
        for (const pagePath of [page, undefined]) {
          const { document } = parse(await renderPage(`${prefix}${page}?q=server#members`, { pagePath }))
          expect(document.querySelector('.site-header__bar'), `${prefix}${page}`).not.toBeNull()
          expect(document.querySelector('.site-header__ports'), `${prefix}${page} (${pagePath ?? 'route fallback'})`).toBeNull()
          expect(document.querySelectorAll('[data-port-link], .site-header__api-menu'), `${prefix}${page}`).toHaveLength(0)
        }
      }
    }
  })

  it('keeps external destinations free of locale and preview prefixes while internal links keep them', async () => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
    vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
    vi.resetModules()
    const unprefixed = baseLayout
    baseLayout = await loadAstroTemplate('layouts/BaseLayout.astro', { real, modules })
    try {
      for (const prefix of ['/pr-42/en/', '/pr-42/ja/']) {
        for (const slug of Object.keys(DESTINATIONS)) {
          const { document } = parse(await renderPage(`${prefix}${slug}/latest/`, { pagePath: '', portSlug: slug }))
          // The control: this environment does prefix the site's own links.
          expect(document.querySelector('a.site-header__search')!.getAttribute('href'), `${prefix}${slug}`).toBe(`/pr-42/en/${slug}/latest/search/`)
          expect(barLinks(document).map(describeLink), `${prefix}${slug}`).toEqual(expectedLinks(DESTINATIONS[slug]!))
        }
      }
    } finally {
      baseLayout = unprefixed
    }
  })

  it('points a companion page at its own repository and leaves the library package in place', async () => {
    const core = 'https://github.com/tmux-python/libtmux'
    const companion = async (repo: string, options: PageOptions = {}) => {
      const { document } = parse(await renderPage('/en/py/latest/workspace/', {
        pagePath: 'workspace', portSlug: 'py', pageSource: { repo, ref: 'master', path: 'docs/index.md' }, ...options,
      }))
      return barLinks(document).map(describeLink)
    }
    for (const [repo, name] of [['tmux-python/tmuxp', 'tmuxp'], ['tmux-python/libtmux-mcp', 'libtmux-mcp']] as const) {
      const [source, pkg] = await companion(repo)
      expect(source).toEqual({ id: 'source', href: `https://github.com/${repo}`, label: `${name} on GitHub` })
      expect(source!.href).not.toBe(core)
      expect(source!.href!.startsWith(`${core}/`)).toBe(false)
      expect(pkg).toEqual({ id: 'package', href: 'https://pypi.org/project/libtmux/', label: 'libtmux on PyPI' })
    }
    // A page may also name the repository it documents without citing a source file there.
    const [named] = await companion('libtmux/docs', { repository: 'tmux-python/tmuxp' })
    expect(named!.href).toBe('https://github.com/tmux-python/tmuxp')
  })

  it('keeps a library page with its own source in the library repository', async () => {
    const { document } = parse(await renderPage('/en/ruby/latest/mcp/', {
      pagePath: 'mcp', portSlug: 'ruby', pageSource: { repo: 'libtmux/libtmux-ruby', ref: 'master', path: 'gems/libtmux-mcp/README.md' },
    }))
    expect(barLinks(document)[0]!.getAttribute('href')).toBe('https://github.com/libtmux/libtmux-ruby')
  })

  it('follows the revision a native page cites', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const html = await renderAstroTemplate(nativeShell, {
      url: 'https://libtmux.org/en/py/v0.62.0/api/api/libtmux.server/',
      props: {
        context: {
          schema: 1, port: 'py', version: 'v0.62.0', locale: 'en', root: '', base: '/en/py/v0.62.0/api/',
          source: { repository: 'tmux-python/libtmux', sha }, artifactSha256: '', pages: [], redirects: [],
        },
        page: {
          file: 'api/libtmux.server/index.html', path: 'api/libtmux.server/', url: '/en/py/v0.62.0/api/api/libtmux.server/',
          sourcePath: 'py/v0.62.0/api/api/libtmux.server/', htmlSha256: '', articleSha256: '', hasTableOfContents: false, signatures: [],
        },
      },
    })
    const { document } = parse(html)
    expect(barLinks(document).map(describeLink)).toEqual([
      { id: 'source', href: `https://github.com/tmux-python/libtmux/tree/${sha}`, label: 'libtmux on GitHub' },
      { id: 'package', href: 'https://pypi.org/project/libtmux/', label: 'libtmux on PyPI' },
    ])
  })
})
