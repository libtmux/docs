import { readFileSync } from 'node:fs'
import type { Element, HTMLAnchorElement, HTMLDetailsElement, HTMLElement, Window } from 'happy-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { PORTS } from '../src/lib/ports'
import { renderAstroTemplate } from './astro-templates'
import { PICKERS } from './fixtures/port-pickers'
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
const pickers = (document: Doc, placement: 'bar' | 'menu') =>
  [...document.querySelectorAll<HTMLDetailsElement>(`details[data-header-picker][data-placement="${placement}"]`)]
const rowsOf = (picker: Element) => [...picker.querySelectorAll<HTMLAnchorElement>('a[data-picker-option]')]
const described = (picker: Element) => rowsOf(picker).map((row) => [
  row.closest('[data-picker-group]')!.getAttribute('data-group'),
  row.querySelector('.header-picker__name')!.textContent,
  row.querySelector('small')!.textContent,
  row.getAttribute('href'),
])
const expectedKinds = (slug: string) => (['github', 'packages', 'docs'] as const).filter((kind) => PICKERS[slug]![kind])

describe('header pickers', () => {
  it.each(Object.entries(PICKERS))('offers %s the verified rows in the bar and in the menu', async (slug, expected) => {
    const { document } = await portPage(slug)
    for (const placement of ['bar', 'menu'] as const) {
      const found = pickers(document, placement)
      expect(found.map((picker) => picker.dataset.headerPicker), `${slug} ${placement}`).toEqual(expectedKinds(slug))
      for (const picker of found) {
        const kind = picker.dataset.headerPicker as 'github' | 'packages' | 'docs'
        expect(described(picker), `${slug} ${placement} ${kind}`).toEqual(expected[kind]!.map((row) => [...row]))
      }
    }
  })

  it('keeps the bar and menu copies identical apart from placement', async () => {
    for (const slug of ['rs', 'py', 'swift']) {
      const { document } = await portPage(slug)
      const text = (picker: Element) => picker.outerHTML.replace(/data-placement="\w+"/, '').replaceAll(/header-picker-(?:bar|menu)-/g, 'header-picker-')
      expect(pickers(document, 'bar').map(text)).toEqual(pickers(document, 'menu').map(text))
    }
  })

  it.each(Object.keys(PICKERS))('makes each %s trigger a disclosure and each row an ordinary link', async (slug) => {
    const { document } = await portPage(slug)
    expect(document.querySelectorAll('summary a')).toHaveLength(0)
    for (const picker of [...pickers(document, 'bar'), ...pickers(document, 'menu')]) {
      expect(picker.tagName).toBe('DETAILS')
      expect(picker.open, 'closed until opened').toBe(false)
      expect(picker.hasAttribute('data-doc-picker')).toBe(true)
      expect(picker.hasAttribute('data-pagefind-ignore')).toBe(true)
      const summary = picker.querySelector(':scope > summary')!
      expect(summary.querySelector('a, button, input')).toBeNull()
      // Every link is inside the panel, which is inside the disclosure.
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
  })

  it('names each trigger and row, with the visible label inside the trigger name', async () => {
    const { document } = await portPage('rs')
    const names = Object.fromEntries(pickers(document, 'bar').map((picker) => {
      const summary = picker.querySelector(':scope > summary')!
      const visible = summary.querySelector('.header-picker__label')!.textContent
      expect(summary.getAttribute('aria-label')!.startsWith(visible), summary.getAttribute('aria-label')!).toBe(true)
      expect(summary.querySelector('.registry-icon')!.getAttribute('aria-hidden')).toBe('true')
      return [picker.dataset.headerPicker, [visible, summary.getAttribute('aria-label')]]
    }))
    expect(names).toEqual({
      github: ['GitHub', 'GitHub: choose a repository'],
      packages: ['Packages', 'Packages: choose a package'],
      docs: ['Docs', 'Docs: choose an API reference'],
    })
    for (const picker of pickers(document, 'bar')) {
      for (const row of rowsOf(picker)) {
        // The link's name is its text: the label and what it points at.
        expect(row.textContent.replace(/\s+/g, ' ')).toContain(row.querySelector('.header-picker__name')!.textContent)
        const mark = row.querySelector('.registry-icon')!
        expect(mark.getAttribute('aria-hidden') === 'true' || mark.getAttribute('alt') === '').toBe(true)
        expect(row.querySelectorAll('.registry-icon')).toHaveLength(1)
      }
    }
  })

  it('searches a menu with several rows and leaves a single destination without a search box', async () => {
    for (const slug of Object.keys(PICKERS)) {
      const { document } = await portPage(slug)
      for (const picker of pickers(document, 'bar')) {
        const kind = picker.dataset.headerPicker as 'github' | 'packages' | 'docs'
        const searchable = PICKERS[slug]![kind]!.length > 1
        expect(picker.querySelectorAll('input[type="search"][data-picker-search]').length, `${slug} ${kind}`).toBe(searchable ? 1 : 0)
        expect(picker.querySelectorAll('label[data-picker-search-label][hidden]').length).toBe(searchable ? 1 : 0)
        expect(picker.querySelectorAll('[data-picker-empty][hidden]').length).toBe(searchable ? 1 : 0)
        expect(picker.querySelectorAll('[data-picker-status]').length).toBe(searchable ? 1 : 0)
      }
    }
    // The count badge and the groups: Rust packages lists core, MCP and workspace.
    const { document } = await portPage('rs')
    const packages = pickers(document, 'bar').find((picker) => picker.dataset.headerPicker === 'packages')!
    expect(packages.querySelector('.doc-picker-count')!.textContent).toBe('4')
    expect([...packages.querySelectorAll('[data-picker-group]')].map((group) => group.getAttribute('data-group')))
      .toEqual(['core', 'mcp', 'workspace'])
    expect(packages.querySelector('.doc-picker-title')!.textContent).toContain('Packages on crates.io')
    expect(packages.querySelector('.header-picker__footer')!.textContent.replace(/\s+/g, ' ')).toBe('Rust · crates.io')
  })

  it.each(['py', 'rs', 'java', 'swift', 'cxx'])('gives each %s row one external-link hint and none on a glyph-free link', async (slug) => {
    const win = await portPage(slug)
    disposals.push(installExternalLinks(win as unknown as typeof window))
    await win.happyDOM.waitUntilComplete()
    for (const picker of pickers(win.document, 'bar')) {
      for (const row of rowsOf(picker)) {
        // The shared hint draws one glyph on a link that has text and none on an icon-only link.
        expect(row.hasAttribute('data-external-link'), row.href).toBe(true)
        expect(row.hasAttribute('data-external-link-icon'), row.href).toBe(false)
        expect(row.querySelector('.external-indicator, [data-external-marker]'), row.href).toBeNull()
        expect(row.textContent, row.href).not.toMatch(/[↗⇗]|opens in a new tab/)
        expect(row.getAttribute('aria-description')).toBe(`External site: ${new URL(row.href).hostname}`)
      }
    }
  })

  it('places the bar copy before the controls and the menu copy in the Menu panel', async () => {
    const { document } = await portPage('rs')
    const bar = document.querySelector('.site-header__pickers')!
    const controls = document.querySelector('.site-header__always')!
    const menu = document.querySelector('details.site-header__menu')!
    expect(bar.closest('details')).toBeNull()
    expect(document.querySelector('.site-header__spacer')!.compareDocumentPosition(bar) & 4).toBeTruthy()
    expect(bar.compareDocumentPosition(controls) & 4).toBeTruthy()
    expect(controls.compareDocumentPosition(menu) & 4).toBeTruthy()
    expect(document.querySelector('a.site-header__search')).not.toBeNull()
    const inMenu = menu.querySelector('.site-header__panel-row.site-header__panel-pickers')!
    expect(inMenu.querySelectorAll('details[data-header-picker]')).toHaveLength(3)
    expect(menu.querySelectorAll('details[data-header-picker]').length).toBe(3)
    expect(menu.querySelector('summary a')).toBeNull()
    // The API host is a Docs row now: the Menu links stay Reference and MCP.
    expect([...menu.querySelectorAll('.site-header__panel-links a')].map((link) => link.textContent.trim())).toEqual(['Reference', 'MCP'])
    expect(document.querySelectorAll('[data-port-link], .site-header__api-menu, .site-header__ports')).toHaveLength(0)
  })

  it('shows exactly one copy at a time by width', () => {
    const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(max-width: 47\.999rem\) \{\s*\.site-header__pickers \{ display: none; \}/)
    expect(css).toMatch(/@media \(min-width: 48rem\) \{\s*\.site-header__panel-pickers \{ display: none; \}/)
    // The visible labels go below 70rem, where the search label goes too.
    expect(css).toMatch(/@media \(max-width: 69\.999rem\) \{\s*\.site-header__pickers \.header-picker__label \{ display: none; \}/)
  })

  it('adds none to the homepage, tmux routes or other pages without a port', async () => {
    for (const prefix of ['/en/', '/ja/', '/pr-42/en/', '/pr-42/ja/']) {
      for (const route of ['', 'tmux', 'tmux/', 'tmux/guides', 'tmux/topics/environment', 'tmux/concepts/servers',
        'tmux/latest/manual', 'tmux/3.2a/manual/full/', 'tmux/latest/reference/server', 'tmux/3.7c/reference/', 'search', 'translations', 'mcp', 'workspace']) {
        for (const pagePath of [route, undefined]) {
          const { document } = await page(`${prefix}${route}?q=server#members`, { pagePath })
          expect(document.querySelector('.site-header__bar'), `${prefix}${route}`).not.toBeNull()
          expect(document.querySelectorAll('.site-header__pickers, .site-header__panel-pickers, [data-header-picker]'),
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
        for (const slug of Object.keys(PICKERS)) {
          const { document } = await page(`${prefix}${slug}/latest/`, { pagePath: '', portSlug: slug })
          // The control: this environment does prefix the site's own links.
          expect(document.querySelector('a.site-header__search')!.getAttribute('href'), `${prefix}${slug}`).toBe(`/pr-42/en/${slug}/latest/search/`)
          const hrefs = [...document.querySelectorAll('details[data-header-picker] a')].map((link) => link.getAttribute('href')!)
          expect(hrefs.length).toBeGreaterThan(0)
          for (const href of hrefs) expect(href, `${prefix}${slug}`).toMatch(/^https:\/\/(?!libtmux\.org)/)
          expect(hrefs.join(' ')).not.toMatch(/\/pr-\d+\/|\/(?:en|ja)\//)
        }
      }
    } finally {
      templates = unprefixed
    }
  })

  it('offers the same menus on a companion page as on the library page', async () => {
    const library = await portPage('py')
    const companion = await page('/en/py/latest/workspace/', {
      pagePath: 'workspace', portSlug: 'py', pageSource: { repo: 'tmux-python/tmuxp', ref: 'master', path: 'docs/index.md' },
    })
    const urls = (doc: Doc) => pickers(doc, 'bar').map((picker) => described(picker))
    expect(urls(companion.document)).toEqual(urls(library.document))
    expect(urls(library.document)[0]!.map(([, , , href]) => href)).toContain('https://github.com/tmux-python/tmuxp')
  })

  it('names each product with a plain-text heading that its group is labelled by', async () => {
    const { document } = await portPage('rs')
    for (const picker of [...pickers(document, 'bar'), ...pickers(document, 'menu')]) {
      const kind = picker.dataset.headerPicker
      const groups = [...picker.querySelectorAll<HTMLElement>('[data-picker-group]')]
      expect(groups.map((group) => group.getAttribute('data-group')), kind).toEqual(['core', 'mcp', 'workspace'].slice(0, groups.length))
      for (const group of groups) {
        const heading = group.querySelector<HTMLElement>('[data-picker-heading]')!
        // The group is named by its heading, which is text and nothing else.
        expect(group.getAttribute('role')).toBe('group')
        expect(group.getAttribute('aria-label')).toBeNull()
        expect(heading.id).toBe(`header-picker-${picker.dataset.placement}-${kind}-${group.dataset.group}`)
        expect(group.getAttribute('aria-labelledby')).toBe(heading.id)
        expect(heading.tagName).toBe('P')
        expect(heading.textContent).toBe({ core: 'Core Library', mcp: 'MCP', workspace: 'Workspace Manager' }[group.dataset.group as 'core'])
        expect(heading.querySelectorAll('*'), 'no icon, link or summary line in a heading').toHaveLength(0)
        expect(heading.hasAttribute('tabindex')).toBe(false)
        expect(heading.closest('a, button, summary')).toBeNull()
        // Rows follow their heading inside the group.
        expect(group.firstElementChild).toBe(heading)
        expect(group.querySelectorAll('[data-picker-option]').length).toBeGreaterThan(0)
      }
    }
    // Headings are the only thing that tells the products apart, so a menu of one product has none.
    for (const slug of ['lua', 'kotlin', 'scala', 'fsharp']) {
      const { document: single } = await portPage(slug)
      for (const picker of pickers(single, 'bar')) {
        expect(picker.querySelectorAll('[data-picker-heading], [role="group"], [aria-labelledby]'), `${slug} ${picker.dataset.headerPicker}`).toHaveLength(0)
        expect(picker.querySelectorAll('[data-picker-group]').length).toBe(1)
      }
    }
  })

  it('gives every heading on a page its own id, so the bar and Menu copies cannot share one', async () => {
    for (const slug of Object.keys(PICKERS)) {
      const { document } = await portPage(slug)
      const ids = [...document.querySelectorAll('[data-picker-heading]')].map((heading) => heading.id)
      expect(new Set(ids).size, slug).toBe(ids.length)
      for (const group of document.querySelectorAll('[role="group"][aria-labelledby]')) {
        expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.closest('[data-picker-group]'), slug).toBe(group)
      }
    }
  })

  it('renders the menus in the native documentation header too', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const html = await renderAstroTemplate(templates.nativeShell, {
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
    expect(pickers(document, 'bar').map((picker) => picker.dataset.headerPicker)).toEqual(['github', 'packages'])
    expect(pickers(document, 'menu').map((picker) => picker.dataset.headerPicker)).toEqual(['github', 'packages'])
    expect(described(pickers(document, 'bar')[0]!).map((row) => row[3])).toEqual([
      'https://github.com/tmux-python/libtmux', 'https://github.com/tmux-python/libtmux-mcp', 'https://github.com/tmux-python/tmuxp',
    ])
  })

  it('has a header expectation for every registered port', () => {
    expect(Object.keys(PICKERS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })
})
