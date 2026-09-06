import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'
import { SITE_BUILT, SITE_PREFIX, publishedHas, publishedPath, sitePath } from './site-root'

/**
 * The published machine-readable artifacts, checked for shape and counts.
 *
 * Asserting a 200 proves the route exists and nothing else. Every one of
 * these has a way of being present, well-formed and wrong: a sitemap that
 * indexes the preview tree, an llms.txt that lists a page the site does not
 * serve, a docs.json whose `ports` array quietly loses a port when its
 * generator is skipped. None of those fail a build and none change a page a
 * human looks at.
 *
 * These run against the assembled `_site`, not a dev server, because that is
 * what deploys.
 */
const has = publishedHas
const read = (p: string) => readFileSync(sitePath(p), 'utf8')
const readPublished = (p: string) => readFileSync(publishedPath(p), 'utf8')

const describeIfAssembled = SITE_BUILT ? describe : describe.skip

describeIfAssembled('published exports', () => {
  describe('robots.txt', () => {
    it('names the sitemap by absolute URL', () => {
      const body = readPublished('robots.txt')
      const sitemap = /^Sitemap:\s*(\S+)$/m.exec(body)?.[1]
      expect(sitemap, 'a Sitemap: line').toBeTruthy()
      expect(() => new URL(sitemap!)).not.toThrow()
      expect(sitemap).toMatch(/sitemap-index\.xml$/)
    })

    it('keeps crawlers out of previews, demos and the search index', () => {
      const body = readPublished('robots.txt')
      for (const path of ['/pr-', `/${SITE_PREFIX}demo`, `/${SITE_PREFIX}pagefind/`]) {
        expect(body, `Disallow: ${path}`).toMatch(new RegExp(`^Disallow:\\s*${path}`, 'm'))
      }
    })
  })

  describe('sitemap', () => {
    it('indexes at least one sitemap, and each one exists', () => {
      const index = read('sitemap-index.xml')
      const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
      expect(locs.length).toBeGreaterThan(0)
      for (const loc of locs) {
        const file = new URL(loc).pathname.replace(/^\//, '')
        expect(has(file), `${file} referenced by the index`).toBe(true)
      }
    })

    it('excludes preview and demo routes', () => {
      const index = read('sitemap-index.xml')
      const files = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => new URL(m[1]).pathname.replace(/^\//, ''))
        .filter(has)
      const urls = files.flatMap((f) => [...readPublished(f).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))
      expect(urls.length, 'sitemap has entries').toBeGreaterThan(0)
      expect(urls.filter((u) => /\/pr-|\/demo/.test(u))).toEqual([])
    })
  })

  describe('llms.txt', () => {
    it('is a heading, a summary and linked sections', () => {
      const body = read('llms.txt')
      expect(body).toMatch(/^# \S/)
      expect(body, 'a `>` summary line').toMatch(/^> \S/m)
      expect(body.match(/^## /gm)?.length ?? 0).toBeGreaterThan(0)
    })

    it('links only pages the site actually serves', () => {
      const body = read('llms.txt')
      const paths = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
        .map((m) => new URL(m[1]).pathname)
        .filter((p) => !p.endsWith('.txt') && !p.endsWith('.json') && !p.endsWith('.inv'))

      expect(paths.length, 'llms.txt links pages').toBeGreaterThan(0)
      const missing = paths.filter((p) => !has(join(p.replace(/^\//, ''), 'index.html')) && !has(p.replace(/^\//, '')))
      expect(missing, 'linked pages that were never built').toEqual([])
    })
  })

  describe('docs.json', () => {
    const manifest = () => JSON.parse(read('docs.json'))

    it('carries the gp-sphinx fields', () => {
      const m = manifest()
      for (const key of ['name', 'url', 'description', 'sourceRepository', 'agentEntrypoints', 'pages']) {
        expect(m, `field ${key}`).toHaveProperty(key)
      }
      expect(Array.isArray(m.pages)).toBe(true)
      expect(m.pages.length).toBeGreaterThan(0)
    })

    it('names an entry point for every agent artifact, and each resolves', () => {
      const { agentEntrypoints } = manifest()
      for (const [name, url] of Object.entries(agentEntrypoints as Record<string, string>)) {
        const path = new URL(url, 'https://libtmux.org').pathname.replace(/^\//, '')
        expect(has(path), `${name} -> ${path}`).toBe(true)
      }
    })

    it('lists every port the site builds', () => {
      const m = manifest()
      expect(Array.isArray(m.ports), 'ports array').toBe(true)
      expect(
        (m.ports as Array<{ slug?: string }>).map((p) => p.slug).sort(),
        'one entry per port in ports.ts',
      ).toEqual(PORTS.map((p) => p.slug).sort())
    })

    it('describes pages that exist', () => {
      const m = manifest()
      const missing = (m.pages as Array<{ url: string }>)
        .map((p) => new URL(p.url, 'https://libtmux.org').pathname.replace(/^\//, ''))
        .filter((p) => !has(join(p, 'index.html')) && !has(p))
      expect(missing, 'documented pages that were never built').toEqual([])
    })
  })

  describe('native shell assets', () => {
    it.each(['latest', 'stable'].filter((version) => has(`${SITE_PREFIX}py/${version}/api/api/libtmux.session/index.html`)))(
      '%s loads the shell script and tokens from this locale tree', (version) => {
        const html = read(`py/${version}/api/api/libtmux.session/index.html`)
        const script = /<script\b[^>]*src="([^"]*\/_shell\/shell\.js[^"]*)"/.exec(html)?.[1]
        expect(script).toBe(`/${SITE_PREFIX}_shell/shell.js`)
        expect(has(script!)).toBe(true)
        const css = read(`py/${version}/api/_static/libtmux-org.css`)
        expect(css).toContain(`url('/${SITE_PREFIX}_shell/tokens.css')`)
        expect(has(`${SITE_PREFIX}_shell/tokens.css`)).toBe(true)
      },
    )
  })

  describe('native navigation manifest', () => {
    it('publishes verified symbol counterparts for the native shell', () => {
      const manifest = JSON.parse(read('page-links.json'))
      expect(manifest.schema).toBe(1)
      expect(Object.keys(manifest.indexes).sort()).toEqual(PORTS.map((port) => port.slug).sort())
      expect(manifest.symbols.py['libtmux.Session.windows']).toEqual(expect.arrayContaining([
        expect.objectContaining({ port: 'ts', href: expect.stringMatching(/\/reference\/ts\/session-session-windows\/$/) }),
      ]))
      const targets = new Set([
        ...Object.values(manifest.indexes as Record<string, string>),
        ...Object.values(manifest.symbols as Record<string, Record<string, { href: string }[]>>)
          .flatMap((symbols) => Object.values(symbols).flatMap((entries) => entries.map((entry) => entry.href))),
      ])
      const missing = [...targets].filter((href) => {
        const path = new URL(href, 'https://libtmux.org').pathname.replace(/^\//, '')
        return !has(join(path, 'index.html'))
      })
      expect(missing, 'native page-switcher targets missing from the assembly').toEqual([])
    })
  })

  describe('hreflang', () => {
    it('is a complete cluster wherever it appears, including x-default', () => {
      // A partial cluster is worse than none: a page that advertises `ja` but
      // not `x-default` tells a crawler the site has no fallback.
      for (const page of [`${SITE_PREFIX}index.html`, `${SITE_PREFIX}concepts/index.html`, 'ja/index.html']) {
        if (!has(page)) continue
        const html = readPublished(page)
        const tags = [...html.matchAll(/<link\b[^>]*hreflang="([^"]+)"/g)].map((m) => m[1])
        if (tags.length === 0) continue
        expect(tags, `${page} advertises a default`).toContain('x-default')
        expect(new Set(tags).size, `${page} has no duplicate hreflang`).toBe(tags.length)
      }
    })

    it('points every alternate at a page that exists', () => {
      const html = read('index.html')
      const hrefs = [...html.matchAll(/<link[^>]+hreflang="[^"]+"[^>]+href="([^"]+)"/g)].map((m) => m[1])
      for (const href of hrefs) {
        const path = new URL(href, 'https://libtmux.org').pathname.replace(/^\//, '')
        expect(has(join(path, 'index.html')) || has(path || 'index.html'), href).toBe(true)
      }
    })
  })
})
