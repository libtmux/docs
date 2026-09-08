import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'
import { LANG_TO_PORT } from '../src/plugins/remark-port-code.mjs'
import { SITE_BUILT, SITE_PREFIX, publishedPath, sitePath } from './site-root'

interface Manifest {
  ports: Record<string, { slug: string; supported: boolean }[]>
  defaultVersion: Record<string, string>
}

interface ProductPage {
  port: string
  name: string
  version: string
  product: 'mcp' | 'workspace'
  section: string
  path: string
}

interface StructuredEntry {
  '@type': string
  itemListElement?: { name: string; item: string }[]
}

const products = ['mcp', 'workspace'] as const
const sections = ['', 'topics', 'guides', 'examples', 'api']
const read = (path: string) => readFileSync(sitePath(path), 'utf8')
const manifest = (): Manifest => JSON.parse(read('versions.json'))
const urlFor = (path: string) => new URL(`/${SITE_PREFIX}${path}`, 'https://libtmux.org')
const productUrl = /\/(?:py|ts|rs|go|java|dotnet|cxx|swift)\/[^/]+\/(?:mcp|workspace)(?:\/|$)/

function pages(): ProductPage[] {
  const versions = manifest()
  return PORTS.flatMap((port) => {
    const supported = versions.ports[port.slug]?.filter((entry) => entry.supported) ?? []
    expect(supported.length, `${port.slug} has assembled supported versions`).toBeGreaterThan(0)
    return supported.flatMap(({ slug: version }) => products.flatMap((product) =>
      sections.map((section) => ({
        port: port.slug, name: port.name, version, product, section,
        path: `${port.slug}/${version}/${product}/${section ? `${section}/` : ''}`,
      }))))
  })
}

function resolves(href: string, from = 'https://libtmux.org/'): boolean {
  const url = new URL(href, from)
  if (url.origin !== 'https://libtmux.org') return true
  const path = publishedPath(decodeURIComponent(url.pathname).replace(/^\//, ''))
  return [path, join(path, 'index.html')].some((file) => existsSync(file) && statSync(file).isFile())
}

function inspect<T>(path: string, check: (document: Window['document']) => T): T {
  const file = sitePath(path, 'index.html')
  expect(existsSync(file), `assembled product page ${path}`).toBe(true)
  const window = new Window({
    url: urlFor(path).href,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  try {
    window.document.write(readFileSync(file, 'utf8'))
    return check(window.document)
  } finally {
    window.close()
  }
}

function graph(document: Window['document']): StructuredEntry[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => {
      const value = JSON.parse(script.textContent)
      return value['@graph'] ?? [value]
    })
}

describe.skipIf(!SITE_BUILT)('assembled MCP and Workspace Manager docs', () => {
  it('serves both products and every section with the chosen port content', () => {
    for (const page of pages()) inspect(page.path, (document) => {
      const article = document.querySelector('article')!
      expect(article, page.path).not.toBeNull()
      expect(article.querySelectorAll('h1'), page.path).toHaveLength(1)
      expect(article.querySelector('h1')!.textContent, page.path).toContain(page.name)
      expect(article.querySelectorAll('p').length, `${page.path} substantive prose`).toBeGreaterThan(2)
      for (const block of article.querySelectorAll('pre[data-language]')) {
        const owner = LANG_TO_PORT[block.getAttribute('data-language')!.toLowerCase()]
        if (owner) expect(owner, `${page.path} foreign language example`).toBe(page.port)
      }
      const headings = [...article.querySelectorAll('h2, h3')].map((heading) => heading.textContent.trim())
      for (const other of PORTS.filter((port) => port.slug !== page.port)) {
        expect(headings, `${page.path} leaked ${other.name} section`).not.toContain(other.name)
      }
      const hrefs = [...document.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')!)
      expect(hrefs.filter((href) => new URL(href, urlFor(page.path)).origin === 'https://libtmux.org'
        && /\/ports\/(?:py|ts|rs|go|java|dotnet|cxx|swift)\//.test(href)),
        `${page.path} storage identities in public links`).toEqual([])
      if (!page.section) inspect(`${page.port}/${page.version}/`, (home) => {
        const entryPoints = [...home.querySelectorAll('main a[href]')]
          .map((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname)
        expect(entryPoints, `${page.path} port-home entry point`).toContain(urlFor(page.path).pathname)
      })
    })
  })

  it('links generated declarations and schema-bearing tools inside their product', () => {
    for (const page of pages().filter((entry) => entry.section === 'api')) {
      const prefix = `${page.port}/${page.version}/${page.product}/api/`
      const declarations = inspect(page.path, (document) =>
        [...document.querySelectorAll('[aria-labelledby="generated-api"] a[href]')]
          .map((link) => ({ href: link.getAttribute('href')!, title: link.textContent.trim() })))
      expect(declarations.length, `${page.path} generated declarations`).toBeGreaterThan(0)
      for (const declaration of declarations) {
        expect(new URL(declaration.href, urlFor(page.path)).pathname).toMatch(new RegExp(`^/${SITE_PREFIX}${prefix}[^/]+/$`))
        expect(resolves(declaration.href, urlFor(page.path).href), declaration.href).toBe(true)
      }
      const sample = declarations[0]
      const samplePath = new URL(sample.href, urlFor(page.path)).pathname.slice(SITE_PREFIX.length + 1)
      inspect(samplePath, (document) => {
        expect(document.querySelector('article h1')?.textContent).toBe(sample.title)
        expect(graph(document).some((entry) => entry['@type'] === 'APIReference')).toBe(true)
      })
      if (page.product !== 'mcp') continue
      const toolsPath = `${page.port}/${page.version}/mcp/tools/`
      const tools = inspect(toolsPath, (document) =>
        [...document.querySelectorAll('article dt a[href]')].map((link) => link.getAttribute('href')!))
      expect(tools.length, `${toolsPath} protocol tools`).toBeGreaterThan(0)
      for (const href of tools) {
        expect(new URL(href, urlFor(toolsPath)).pathname).toMatch(new RegExp(`^/${SITE_PREFIX}${toolsPath}[^/]+/$`))
        expect(resolves(href, urlFor(toolsPath).href), href).toBe(true)
      }
      const toolPath = new URL(tools[0], urlFor(toolsPath)).pathname.slice(SITE_PREFIX.length + 1)
      inspect(toolPath, (document) => {
        const input = [...document.querySelectorAll('details')]
          .find((detail) => detail.querySelector('summary')?.textContent === 'Input schema')
        expect(input, `${toolPath} input schema`).toBeDefined()
        expect(() => JSON.parse(input!.querySelector('code')!.textContent)).not.toThrow()
        expect(document.querySelector('article h1')?.textContent).toBe(toolPath.split('/').at(-2))
      })
    }
  })

  it('switches to equivalent sections and matches visible breadcrumbs to structured data', () => {
    const defaults = manifest().defaultVersion
    for (const page of pages()) inspect(page.path, (document) => {
      const links = [...document.querySelectorAll('[data-page-port-switcher] a[href]')]
      expect(links.length, `${page.path} port counterparts`).toBe(PORTS.length)
      for (const port of PORTS) {
        const version = port.slug === page.port ? page.version : defaults[port.slug]
        const expected = urlFor(`${port.slug}/${version}/${page.product}/${page.section ? `${page.section}/` : ''}`).pathname
        expect(links.some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === expected),
          `${page.path} counterpart ${expected}`).toBe(true)
      }
      const crumb = document.querySelector('nav[aria-label="Breadcrumb"]')!
      expect(crumb, page.path).not.toBeNull()
      const labels = [...crumb.querySelectorAll('a, [aria-current="page"]')].map((item) => item.textContent.trim())
      const structured = graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')
      expect(structured?.itemListElement?.map((item) => item.name), page.path).toEqual(labels)
      expect(labels[0]).toBe(page.name)
      expect(labels[1]).toBe(page.product === 'mcp' ? 'MCP' : 'Workspace Manager')
      for (const item of structured!.itemListElement!) expect(resolves(item.item), item.item).toBe(true)
      expect(new URL(structured!.itemListElement!.at(-1)!.item).pathname).toBe(urlFor(page.path).pathname)
    })
  })

  it('canonicalizes each version and loads nested search from the locale index', () => {
    const defaults = manifest().defaultVersion
    for (const page of pages()) inspect(page.path, (document) => {
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
      const expected = `${page.port}/${defaults[page.port]}/${page.product}/${page.section ? `${page.section}/` : ''}`
      expect(canonical, page.path).toBe(urlFor(expected).href)
      const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content')
      expect(robots, page.path).toBe(page.version === defaults[page.port] ? 'index, follow' : 'noindex, follow')
      expect(document.querySelectorAll('link[hreflang]'), `${page.path} no invented translations`).toHaveLength(0)
      const bundles = [...document.querySelectorAll('[data-search-bundle]')].map((panel) => panel.getAttribute('data-search-bundle'))
      expect(bundles.length, `${page.path} search`).toBeGreaterThan(0)
      for (const bundle of bundles) {
        expect(bundle).toBe(`/${SITE_PREFIX}pagefind/`)
        expect(resolves(`${bundle}pagefind.js`)).toBe(true)
      }
    })
  })

  it('keeps product storage paths out of shared translation coverage', () => {
    for (const locale of ['en', 'ja']) {
      const coverage = readFileSync(publishedPath(`${locale}/translations/index.html`), 'utf8')
      expect(coverage.match(/href="\/(?:en|ja)\/ports\/[^"]*"/g),
        `${locale} coverage links to published shared pages`).toBeNull()
    }
  })

  it('exports real product URLs, resolved examples, and canonical sitemap entries', () => {
    const defaults = manifest().defaultVersion
    const index = JSON.parse(read('docs.json')) as { pages: { url: string; markdownUrl: string }[] }
    const llms = read('llms.txt')
    const sitemapFiles = [...read('sitemap-index.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    const sitemap = sitemapFiles.map((path) => readFileSync(publishedPath(path), 'utf8')).join('\n')
    for (const page of pages().filter((entry) => entry.version === defaults[entry.port])) {
      const url = urlFor(page.path).href
      expect(index.pages.some((entry) => entry.url === url), `${url} in docs.json`).toBe(true)
      expect(llms, `${url} in llms.txt`).toContain(`](${url})`)
      expect(sitemap, `${url} in sitemap`).toContain(`<loc>${url}</loc>`)
    }
    const exportRoots = new Set(['', ...pages().map((page) => `${page.port}/${page.version}/`)])
    for (const root of exportRoots) {
      const body = read(`${root}llms-full.txt`)
      expect(body, `${root} resolved file inclusions`).not.toMatch(/```[^\n]*file="[^"\n]+"[^\n]*\n\s*```/)
      const exported = JSON.parse(read(`${root}docs.json`)) as { pages: { url: string; markdownUrl: string }[] }
      for (const entry of exported.pages.filter((entry) => productUrl.test(entry.url))) {
        expect(resolves(entry.url), entry.url).toBe(true)
        expect(resolves(entry.markdownUrl), entry.markdownUrl).toBe(true)
        if (root) expect(new URL(entry.url).pathname).toContain(`/${SITE_PREFIX}${root}`)
      }
    }
    const japanese = publishedPath('ja/docs.json')
    expect(existsSync(japanese), 'Japanese assembled manifest').toBe(true)
    const translated = JSON.parse(readFileSync(japanese, 'utf8')) as { pages: { url: string }[] }
    for (const entry of translated.pages.filter((entry) => productUrl.test(entry.url))) {
      expect(new URL(entry.url).pathname, entry.url).not.toMatch(/^\/ja\/(?:py|ts|rs|go|java|dotnet|cxx|swift)\//)
      expect(resolves(entry.url), entry.url).toBe(true)
    }
  })
})
