import { readFileSync } from 'node:fs'
import type { Element, HTMLAnchorElement, HTMLDetailsElement, Window } from 'happy-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { PORTS } from '../src/lib/ports'
import { renderAstroTemplate } from './astro-templates'
import { LINKS } from './fixtures/header-links'
import { loadHeaderTemplates, parseHtml, renderPage, type HeaderTemplates, type PageOptions } from './header-page'

const windows: Window[] = []
const disposals: (() => void)[] = []
afterEach(async () => {
  disposals.splice(0).forEach((dispose) => dispose())
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

let templates: HeaderTemplates
beforeAll(async () => { templates = await loadHeaderTemplates() })

const parse = (html: string) => {
  const win = parseHtml(html)
  windows.push(win)
  return win
}
const page = async (url: string, options?: PageOptions) => parse(await renderPage(templates.baseLayout, url, options))
const portPage = (slug: string) => page(`/en/${slug}/latest/guides/panes/`, { pagePath: 'guides/panes', portSlug: slug })

type Doc = Window['document']
type Placement = 'bar' | 'menu'
const PLACEMENTS: Placement[] = ['bar', 'menu']
const container = (document: Doc, placement: Placement) =>
  document.querySelector(placement === 'bar' ? '.site-header__destinations' : '.site-header__panel-destinations')!
const actions = (document: Doc, placement: Placement) =>
  [...container(document, placement).querySelectorAll<HTMLAnchorElement>('a[data-header-action]')]
const disclosures = (document: Doc, placement: Placement) =>
  [...document.querySelectorAll<HTMLDetailsElement>(`details[data-header-picker][data-placement="${placement}"]`)]
const rowsOf = (picker: Element) => [...picker.querySelectorAll<HTMLAnchorElement>('a[data-picker-option]')]
const described = (picker: Element) => rowsOf(picker).map((row) => [
  row.closest('[data-picker-group]')!.getAttribute('data-group'),
  row.querySelector('.header-picker__name')!.textContent,
  row.querySelector('small')!.textContent,
  row.getAttribute('href'),
])

describe('header links in the ordinary shell', () => {
  it.each(Object.entries(LINKS))('offers %s the verified actions and index in the bar and in the menu', async (slug, expected) => {
    const { document } = await portPage(slug)
    for (const placement of PLACEMENTS) {
      expect(actions(document, placement).map((link) => [link.dataset.headerAction, link.querySelector('.header-link__label')!.textContent, link.getAttribute('aria-label'), link.getAttribute('href')]),
        `${slug} ${placement} actions`).toEqual(expected.actions.map((action) => [...action]))
      const found = disclosures(document, placement)
      expect(found, `${slug} ${placement} disclosures`).toHaveLength(expected.indexed ? 1 : 0)
      if (expected.indexed) expect(described(found[0]!), `${slug} ${placement} rows`).toEqual(expected.rows.map(([kind, label, detail, url]) => [kind, label, detail, url]))
    }
  })

  it('keeps the bar and menu copies identical apart from placement', async () => {
    for (const slug of ['rs', 'py', 'swift', 'lua']) {
      const { document } = await portPage(slug)
      const normalize = (placement: Placement) => container(document, placement).innerHTML
        .replaceAll(`data-placement="${placement}"`, 'data-placement="x"').replaceAll(`header-picker-${placement}-`, 'header-picker-')
      expect(normalize('bar'), slug).toBe(normalize('menu'))
    }
  })

  it.each(Object.keys(LINKS))('makes each %s action an ordinary link and the disclosure a closed details of links', async (slug) => {
    const { document } = await portPage(slug)
    for (const placement of PLACEMENTS) {
      for (const link of actions(document, placement)) {
        expect(link.tagName).toBe('A')
        expect(link.getAttribute('rel')).toBe('noopener')
        expect(link.hasAttribute('target'), 'opens in the same tab').toBe(false)
        expect(link.closest('summary, button, details[data-header-picker]'), 'a direct link is not inside a disclosure').toBeNull()
        const mark = link.querySelector('.registry-icon')!
        expect(mark.getAttribute('aria-hidden') === 'true' || mark.getAttribute('alt') === '', 'the mark is decorative').toBe(true)
        expect(link.getAttribute('aria-label')!.startsWith(link.querySelector('.header-link__label')!.textContent), 'the visible label is inside the name').toBe(true)
        expect(link.hasAttribute('title'), 'the shared link hint supplies the tooltip').toBe(false)
      }
      for (const picker of disclosures(document, placement)) {
        expect(picker.tagName).toBe('DETAILS')
        expect(picker.open, 'closed until opened').toBe(false)
        expect(picker.hasAttribute('data-doc-picker')).toBe(true)
        expect(picker.hasAttribute('data-pagefind-ignore')).toBe(true)
        const summary = picker.querySelector(':scope > summary')!
        expect(summary.querySelector('a, button, input')).toBeNull()
        const panel = picker.querySelector(':scope > [data-picker-panel]')!
        expect(panel.querySelectorAll('a')).toHaveLength(picker.querySelectorAll('a').length)
        // No menu or listbox widget: the rows are navigation links.
        expect(picker.querySelectorAll('[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [aria-haspopup], [aria-expanded]')).toHaveLength(0)
        for (const row of rowsOf(picker)) {
          expect(row.getAttribute('rel')).toBe('noopener')
          expect(row.hasAttribute('target')).toBe(false)
          expect(row.dataset.match!.trim()).not.toBe('')
          expect(row.querySelector('.header-picker__name')!.textContent.trim()).not.toBe('')
        }
      }
    }
  })

  it('names the trigger with its visible label first, and each row by its text', async () => {
    const { document } = await portPage('rs')
    const [picker] = disclosures(document, 'bar')
    const summary = picker!.querySelector(':scope > summary')!
    const visible = summary.querySelector('.header-picker__label')!.textContent
    expect(visible).toBe('Packages')
    expect(summary.getAttribute('aria-label')).toBe('Packages and source: choose a destination')
    expect(summary.getAttribute('aria-label')!.startsWith(visible)).toBe(true)
    expect(summary.querySelector('.registry-icon')!.getAttribute('aria-hidden')).toBe('true')
    for (const row of rowsOf(picker!)) {
      expect(row.textContent.replace(/\s+/g, ' ')).toContain(row.querySelector('.header-picker__name')!.textContent)
      const mark = row.querySelector('.registry-icon')!
      expect(row.querySelectorAll('.registry-icon')).toHaveLength(1)
      expect(mark.getAttribute('aria-hidden') === 'true' || mark.getAttribute('alt') === '').toBe(true)
    }
  })

  it('searches an index of several rows, and shows an empty state and a status line only then', async () => {
    for (const [slug, expected] of Object.entries(LINKS)) {
      const { document } = await portPage(slug)
      for (const picker of disclosures(document, 'bar')) {
        const searchable = expected.rows.length > 1
        expect(picker.querySelectorAll('input[type="search"][data-picker-search]').length, slug).toBe(searchable ? 1 : 0)
        // Hidden until the script runs, so the no-script reader meets no dead control.
        expect(picker.querySelectorAll('label[data-picker-search-label][hidden]').length, slug).toBe(searchable ? 1 : 0)
        expect(picker.querySelectorAll('[data-picker-empty][hidden]').length, slug).toBe(searchable ? 1 : 0)
        expect(picker.querySelectorAll('[data-picker-status][role="status"]').length, slug).toBe(searchable ? 1 : 0)
        expect(picker.querySelector('.doc-picker-count')!.textContent, slug).toBe(String(expected.rows.length))
      }
    }
    const { document } = await portPage('rs')
    const picker = disclosures(document, 'bar')[0]!
    expect(picker.querySelector('.doc-picker-title')!.textContent.replace(/\s+/g, ' ')).toBe('Packages and source 13')
    expect(picker.querySelector('[data-picker-empty]')!.textContent).toBe('No matching destinations.')
    expect(picker.querySelector('.header-picker__footer')!.textContent.replace(/\s+/g, ' ')).toBe('Rust · libtmux/libtmux-rs')
  })

  it.each(['py', 'rs', 'java', 'swift', 'cxx'])('gives each %s link one external-link hint', async (slug) => {
    const win = await portPage(slug)
    disposals.push(installExternalLinks(win as unknown as typeof window))
    await win.happyDOM.waitUntilComplete()
    for (const placement of PLACEMENTS) {
      const links = [...actions(win.document, placement), ...disclosures(win.document, placement).flatMap(rowsOf)]
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) {
        expect(link.hasAttribute('data-external-link'), link.href).toBe(true)
        expect(link.querySelector('.external-indicator, [data-external-marker]'), link.href).toBeNull()
        expect(link.textContent, link.href).not.toMatch(/[↗⇗]|opens in a new tab/)
        expect(link.getAttribute('aria-description')).toBe(`External site: ${new URL(link.href).hostname}`)
      }
    }
  })

  it('places the bar copy before the controls and the menu copy in the Menu panel', async () => {
    const { document } = await portPage('rs')
    const bar = document.querySelector('.site-header__destinations')!
    const controls = document.querySelector('.site-header__always')!
    const menu = document.querySelector('details.site-header__menu')!
    expect(bar.closest('details')).toBeNull()
    expect(document.querySelector('.site-header__spacer')!.compareDocumentPosition(bar) & 4).toBeTruthy()
    expect(bar.compareDocumentPosition(controls) & 4).toBeTruthy()
    expect(controls.compareDocumentPosition(menu) & 4).toBeTruthy()
    expect(document.querySelector('a.site-header__search')).not.toBeNull()
    const inMenu = menu.querySelector('.site-header__panel-row.site-header__panel-destinations')!
    expect(inMenu.querySelectorAll('a[data-header-action]')).toHaveLength(3)
    expect(inMenu.querySelectorAll('details[data-header-picker]')).toHaveLength(1)
    expect(menu.querySelectorAll('details[data-header-picker]').length).toBe(1)
    expect(menu.querySelector('summary a')).toBeNull()
    // The API host is a direct link or an index row: the Menu links stay Reference and MCP.
    expect([...menu.querySelectorAll('.site-header__panel-links a')].map((link) => link.textContent.trim())).toEqual(['Reference', 'MCP'])
    for (const placement of ['bar', 'menu'] as const) expect(container(document, placement).getAttribute('data-pagefind-ignore'), placement).toBe('all')
  })

  it('points the MCP chip at the port MCP home and drops it where there is none', async () => {
    const mcp = (document: Doc) => [...document.querySelectorAll<HTMLAnchorElement>('.site-header__panel-links a')]
      .filter((link) => link.textContent.trim() === 'MCP').map((link) => link.getAttribute('href'))
    expect(mcp((await portPage('rs')).document)).toEqual(['/rs/latest/mcp/'])
    expect(mcp((await portPage('py')).document)).toEqual(['/py/latest/mcp/'])
    // Lua has no MCP server, and the homepage belongs to no port.
    expect(mcp((await portPage('lua')).document)).toEqual([])
    expect(mcp((await page('/en/', { pagePath: '' })).document)).toEqual([])
  })

  it('shows exactly one copy at a time by width, and the label only where there is room', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(max-width: 47\.999rem\) \{\s*\.site-header__destinations \{ display: none; \}/)
    expect(css).toMatch(/@media \(min-width: 48rem\) \{\s*\.site-header__panel-destinations \{ display: none; \}/)
    // A host's name is longer than the search label, so its label waits for 80rem.
    expect(css).toMatch(/@media \(max-width: 79\.999rem\) \{\s*\.site-header__destinations :is\(\.header-link__label, \.header-picker__label\) \{ display: none; \}/)
    // A direct link has the disclosure trigger's height, and the hint glyph never widens it.
    expect(css).toMatch(/\.site-header \.header-link,\s*\.site-header \.header-picker > summary \{[^}]*height: 1\.75rem/)
    expect(css).toMatch(/\.site-header a\.header-link\[data-external-link\]::after \{\s*content: none;/)
  })

  it('adds none to the homepage, tmux routes or other pages without a port', async () => {
    for (const prefix of ['/en/', '/ja/', '/pr-42/en/', '/pr-42/ja/']) {
      for (const route of ['', 'tmux', 'tmux/', 'tmux/guides', 'tmux/topics/environment', 'tmux/concepts/servers',
        'tmux/latest/manual', 'tmux/3.2a/manual/full/', 'tmux/latest/reference/server', 'tmux/3.7c/reference/', 'search', 'meta/support', 'meta/translations', 'mcp', 'workspace']) {
        for (const pagePath of [route, undefined]) {
          const { document } = await page(`${prefix}${route}?q=server#members`, { pagePath })
          expect(document.querySelector('.site-header__bar'), `${prefix}${route}`).not.toBeNull()
          expect(document.querySelectorAll('.site-header__destinations, .site-header__panel-destinations, [data-header-picker], [data-header-action]'),
            `${prefix}${route} (${pagePath ?? 'route fallback'})`).toHaveLength(0)
        }
      }
    }
  })

  it('keeps external destinations free of locale and preview prefixes while internal links keep them', async () => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
    vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-42')
    vi.resetModules()
    const unprefixed = templates
    templates = await loadHeaderTemplates()
    try {
      for (const prefix of ['/pr-42/en/', '/pr-42/ja/']) {
        for (const slug of Object.keys(LINKS)) {
          const { document } = await page(`${prefix}${slug}/latest/`, { pagePath: '', portSlug: slug })
          // The control: this environment does prefix the site's own links.
          expect(document.querySelector('a.site-header__search')!.getAttribute('href'), `${prefix}${slug}`).toBe(`/pr-42/en/${slug}/latest/search/`)
          const hrefs = [...document.querySelectorAll('.site-header__destinations a')].map((link) => link.getAttribute('href')!)
          expect(hrefs.length).toBeGreaterThan(0)
          for (const href of hrefs) expect(href, `${prefix}${slug}`).toMatch(/^https:\/\/(?!libtmux\.org)/)
          expect(hrefs.join(' ')).not.toMatch(/\/pr-\d+\/|\/(?:en|ja)\//)
        }
      }
    } finally {
      templates = unprefixed
    }
  })

  it('offers the same links on a companion page as on the library page', async () => {
    const library = await portPage('py')
    const companion = await page('/en/py/latest/workspace/', {
      pagePath: 'workspace', portSlug: 'py', pageSource: { repo: 'tmux-python/tmuxp', ref: 'master', path: 'docs/index.md' },
    })
    expect(container(companion.document, 'bar').innerHTML).toBe(container(library.document, 'bar').innerHTML)
    const hrefs = actions(library.document, 'bar').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(['https://github.com/tmux-python/libtmux', 'https://pypi.org/project/libtmux/'])
    expect(described(disclosures(library.document, 'bar')[0]!).map(([, , , href]) => href)).toContain('https://github.com/tmux-python/tmuxp')
  })

  it('heads each kind of destination with a plain-text label that its group is named by', async () => {
    const { document } = await portPage('rs')
    for (const picker of [...disclosures(document, 'bar'), ...disclosures(document, 'menu')]) {
      const groups = [...picker.querySelectorAll<Element>('[data-picker-group]')]
      expect(groups.map((group) => group.getAttribute('data-group'))).toEqual(['source', 'package', 'api'])
      for (const group of groups) {
        const heading = group.querySelector<Element>('[data-picker-heading]')!
        expect(group.getAttribute('role')).toBe('group')
        expect(group.getAttribute('aria-label')).toBeNull()
        expect(heading.id).toBe(`header-picker-${picker.dataset.placement}-${group.getAttribute('data-group')}`)
        expect(group.getAttribute('aria-labelledby')).toBe(heading.id)
        expect(heading.tagName).toBe('P')
        expect(heading.textContent).toBe({ source: 'Source', package: 'Packages', api: 'API reference' }[group.getAttribute('data-group') as 'source'])
        expect(heading.querySelectorAll('*'), 'no icon, link or summary line in a heading').toHaveLength(0)
        expect(heading.hasAttribute('tabindex')).toBe(false)
        expect(heading.closest('a, button, summary')).toBeNull()
        expect(group.firstElementChild).toBe(heading)
        expect(group.querySelectorAll('[data-picker-option]').length).toBeGreaterThan(0)
      }
    }
    // Headings are the only thing that tells the kinds apart, so an index of one kind has none.
    const { document: single } = await portPage('cxx')
    const [picker] = disclosures(single, 'bar')
    expect(picker!.querySelectorAll('[data-picker-heading], [role="group"], [aria-labelledby]')).toHaveLength(0)
    expect(picker!.querySelectorAll('[data-picker-group]')).toHaveLength(1)
  })

  it('gives every heading on a page its own id, so the bar and Menu copies cannot share one', async () => {
    for (const slug of Object.keys(LINKS)) {
      const { document } = await portPage(slug)
      const ids = [...document.querySelectorAll('[data-picker-heading]')].map((heading) => heading.id)
      expect(new Set(ids).size, slug).toBe(ids.length)
      for (const group of document.querySelectorAll('[role="group"][aria-labelledby]')) {
        expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.closest('[data-picker-group]'), slug).toBe(group)
      }
    }
  })

  it('leaves a disclosure out where no destination is beyond the direct links', async () => {
    const lua = await portPage('lua')
    expect(actions(lua.document, 'bar').map((link) => link.dataset.headerAction)).toEqual(['source', 'package'])
    expect(lua.document.querySelectorAll('[data-header-picker]')).toHaveLength(0)
    // Control: a port that has more has one, in each copy.
    const kotlin = await portPage('kotlin')
    expect(kotlin.document.querySelectorAll('[data-header-picker]')).toHaveLength(2)
  })

  it('reaches every destination without a script: ordinary links, a native disclosure, a search that waits for the script', async () => {
    const win = await portPage('rs')
    expect(win.document.querySelectorAll('script[src*="documentation"], [data-enhanced]')).toHaveLength(0)
    const [picker] = disclosures(win.document, 'bar')
    // Nothing in the disclosure needs the script to be followed.
    for (const row of rowsOf(picker!)) expect(new URL(row.getAttribute('href')!).protocol).toBe('https:')
    expect(picker!.querySelector('[data-picker-search-label]')!.hasAttribute('hidden')).toBe(true)
    expect(actions(win.document, 'bar').map((link) => link.getAttribute('href'))).toEqual(LINKS.rs!.actions.map(([, , , url]) => url))
  })
})

describe('header links in the native documentation shell', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'
  const native = async (slug: string, version: string, path: string) => parse(await renderAstroTemplate(templates.nativeShell, {
    url: `https://libtmux.org/en/${slug}/${version}/api/${path}`,
    props: {
      context: {
        schema: 1, port: slug, version, locale: 'en', root: '', base: `/en/${slug}/${version}/api/`,
        source: { repository: 'tmux-python/libtmux', sha }, artifactSha256: '', pages: [], redirects: [],
      },
      page: {
        file: `api/${path}index.html`, path: `api/${path}`, url: `/en/${slug}/${version}/api/api/${path}`,
        sourcePath: `${slug}/${version}/api/api/${path}`, htmlSha256: '', articleSha256: '', hasTableOfContents: false, signatures: [],
      },
    },
  }))

  it.each(['py', 'rs', 'go', 'swift', 'lua'])('renders the verified %s links in both placements', async (slug) => {
    const { document } = await native(slug, 'latest', 'libtmux.server/')
    const expected = LINKS[slug]!
    for (const placement of PLACEMENTS) {
      expect(actions(document, placement).map((link) => link.getAttribute('href')), `${slug} ${placement}`).toEqual(expected.actions.map(([, , , url]) => url))
      expect(disclosures(document, placement), `${slug} ${placement}`).toHaveLength(expected.indexed ? 1 : 0)
    }
    if (expected.indexed) expect(described(disclosures(document, 'bar')[0]!).map(([, , , href]) => href)).toEqual(expected.rows.map(([, , , url]) => url))
  })

  it('keeps the links inside the header boundary that native pages replace', async () => {
    const html = await renderAstroTemplate(templates.nativeShell, {
      url: 'https://libtmux.org/en/py/v0.62.0/api/api/libtmux.server/',
      props: {
        context: { schema: 1, port: 'py', version: 'v0.62.0', locale: 'en', root: '', base: '/en/py/v0.62.0/api/', source: { repository: 'tmux-python/libtmux', sha }, artifactSha256: '', pages: [], redirects: [] },
        page: { file: 'api/libtmux.server/index.html', path: 'api/libtmux.server/', url: '/en/py/v0.62.0/api/api/libtmux.server/', sourcePath: 'py/v0.62.0/api/api/libtmux.server/', htmlSha256: '', articleSha256: '', hasTableOfContents: false, signatures: [] },
      },
    })
    const start = html.indexOf('data-native-boundary="header-start"')
    const end = html.indexOf('data-native-boundary="header-end"')
    expect(start).toBeGreaterThan(-1)
    for (const marker of ['site-header__destinations', 'site-header__panel-destinations', 'data-header-picker="destinations"']) {
      const at = html.indexOf(marker)
      expect(at, marker).toBeGreaterThan(start)
      expect(at, marker).toBeLessThan(end)
    }
    // Nothing of it reaches the article or the footer.
    expect(html.slice(end)).not.toMatch(/data-header-action|data-header-picker/)
    expect(html.slice(0, start)).not.toMatch(/data-header-action|data-header-picker/)
  })

  it('offers the same destinations in the native header as in the ordinary one', async () => {
    for (const slug of ['py', 'ts', 'java']) {
      const ordinary = await portPage(slug)
      const nativePage = await native(slug, 'latest', 'x/')
      for (const placement of PLACEMENTS) {
        expect(container(nativePage.document, placement).innerHTML, `${slug} ${placement}`).toBe(container(ordinary.document, placement).innerHTML)
      }
    }
  })
})

describe('registered ports', () => {
  it('has a header expectation for every one', () => {
    expect(Object.keys(LINKS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })
})
