import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { SITE_BUILT, BUCKET_ROOT, SITE_PREFIX, PREVIEW_PREFIX } from './site-root'

/** Built switcher links must resolve within the assembled site. */
const SITE = BUCKET_ROOT

const describeIfAssembled = SITE_BUILT ? describe : describe.skip

/** Pages that exercise a different combination of the port, version and locale axes. */
function samplePages(): string[] {
  const prefix = SITE_PREFIX
  const wanted = [
    'index.html', 'concepts/index.html', 'mcp/tools/index.html',
    'topics/architecture/index.html', 'py/index.html',
    'py/latest/topics/architecture/index.html', 'ts/latest/topics/architecture/index.html',
    'rs/index.html', 'reference/index.html', 'ts/latest/reference/index.html',
    'ts/latest/reference/session-session-panes/index.html', 'ts/latest/reference/session-session-sessionbrand/index.html',
    'ts/latest/mcp/reference/index.html', 'go/latest/workspace/reference/index.html',
  ].map((page) => prefix + page)
  wanted.push(`${PREVIEW_PREFIX.slice(1)}${PREVIEW_PREFIX ? '/' : ''}ja/index.html`, `${PREVIEW_PREFIX.slice(1)}${PREVIEW_PREFIX ? '/' : ''}ja/concepts/index.html`)
  const present = wanted.filter((page) => existsSync(join(SITE, page)))

  return present
}

/** Resolve a site-absolute or absolute URL to a file in the built tree. */
function resolves(href: string): boolean {
  let path: string
  try {
    path = href.startsWith('http') ? new URL(href).pathname : href
  } catch {
    return false
  }
  if (path.startsWith('#') || path.startsWith('mailto:')) return true
  const clean = path.split('#')[0].split('?')[0].replace(/^\//, '')
  if (clean === '') return existsSync(join(SITE, 'index.html'))
  return existsSync(join(SITE, clean)) || existsSync(join(SITE, clean, 'index.html'))
}

/**
 * Sampled pages that are not about one document, so no other port serves a
 * matching page: the locale home, each port's home, the all-port reference
 * index, and the global MCP tool table.
 */
const NO_PAGE_COUNTERPART = [
  'en/index.html',
  'ja/index.html',
  'py/index.html',
  'rs/index.html',
  'mcp/tools/index.html',
  'en/reference/index.html',
]

const pages = samplePages()

describeIfAssembled('switcher targets', () => {
  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(3)
  })

  it.each(pages.map((p) => [p]))('%s: page counterparts resolve without a header destination strip', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const noDocument = NO_PAGE_COUNTERPART.some((suffix) => page.endsWith(suffix))
    // The counterpart picker is distinct from the app/section picker. Keep
    // explicit exceptions so losing a document's control remains a failure.
    const window = new Window({ url: `https://libtmux.org/${page}`, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })
    try {
      window.document.write(html)
      const allMenus = [...window.document.querySelectorAll('details[data-page-port-switcher]')]
      const launchers = allMenus.filter((menu) => menu.closest('[data-home-launcher]'))
      const menus = allMenus.filter((menu) => !menu.closest('[data-home-launcher]'))
      expect(menus, `${page} matching-page controls`).toHaveLength(noDocument ? 0 : 1)
      expect(launchers, `${page} homepage language launcher`).toHaveLength(page.endsWith('en/index.html') ? 1 : 0)
      expect(window.document.querySelectorAll('header nav[aria-label="Documentation destinations"]')).toHaveLength(0)
      for (const menu of allMenus) {
        const counterparts = [...menu.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')!)
        expect(counterparts.length, `${page} has an available destination`).toBeGreaterThan(0)
        expect(counterparts.filter((href) => !resolves(href)), `${page}: destinations missing on disk`).toEqual([])
        for (const disabled of menu.querySelectorAll('[aria-disabled="true"]')) {
          expect(disabled.hasAttribute('href'), `${page} unavailable counterparts are not links`).toBe(false)
        }
      }
    } finally {
      window.close()
    }
  })

  it.each(pages.map((p) => [p]))('%s: every hreflang alternate resolves', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const hrefs = [...html.matchAll(/<link[^>]+hreflang="[^"]+"[^>]+href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.filter((h) => !resolves(h)), `${page}: alternates with no page`).toEqual([])
  })

})
