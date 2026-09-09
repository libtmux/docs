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
const read = (path: string) => readFileSync(sitePath(path), 'utf8')
const manifest = (): Manifest => JSON.parse(read('versions.json'))
const urlFor = (path: string) => new URL(`/${SITE_PREFIX}${path}`, 'https://libtmux.org')
const productUrl = /\/(?:py|ts|rs|go|java|dotnet|cxx|swift)\/[^/]+\/(?:mcp|workspace)(?:\/|$)/

function sectionsFor(port: string, product: ProductPage['product']): string[] {
  if (product === 'mcp') return ['', 'topics', 'guides', 'examples', 'api']
  return port === 'py'
    ? ['', 'topics', 'guides', 'examples', 'internals', 'internals/topics', 'internals/examples', 'internals/api']
    : ['', 'internals', 'internals/topics', 'internals/guides', 'internals/examples', 'internals/api']
}

function pages(): ProductPage[] {
  const versions = manifest()
  return PORTS.flatMap((port) => {
    const supported = versions.ports[port.slug]?.filter((entry) => entry.supported) ?? []
    expect(supported.length, `${port.slug} has assembled supported versions`).toBeGreaterThan(0)
    return supported.flatMap(({ slug: version }) => products.flatMap((product) =>
      sectionsFor(port.slug, product).map((section) => ({
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

function developmentStatus(document: Window['document'], path: string): void {
  const status = document.querySelector('[aria-label="Development status"]')
  expect(status, `${path} development status`).not.toBeNull()
  expect(status!.textContent, `${path} development status`).toMatch(/in development/i)
}

function redirectsTo(path: string, target: string): void {
  inspect(path, (document) => {
    const refresh = document.querySelector('meta[http-equiv="refresh"]')?.getAttribute('content')
    expect(refresh, `${path} redirects`).toBeDefined()
    const destination = refresh!.match(/url=(.+)$/i)?.[1]
    expect(destination, `${path} redirect destination`).toBeDefined()
    expect(new URL(destination!, urlFor(path)).pathname, path).toBe(urlFor(target).pathname)
    expect(resolves(destination!, urlFor(path).href), `${path} redirect target exists`).toBe(true)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), `${path} canonical`).toBe(urlFor(target).href)
    expect(document.querySelector('[data-pagefind-body]'), `${path} redirects are not searchable`).toBeNull()
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

  it('distinguishes unfinished products and groups workspace implementation docs under Internals', () => {
    for (const page of pages()) inspect(page.path, (document) => {
      if (page.product === 'mcp' || (page.port !== 'py' && page.section)) developmentStatus(document, page.path)
      const navigation = document.querySelectorAll('nav[aria-label="Documentation"]')
      expect(navigation.length, `${page.path} documentation navigation`).toBeGreaterThan(0)
      for (const nav of navigation) {
        if (page.product === 'mcp') {
          const tools = [...nav.querySelectorAll('a[href]')].find((link) => link.textContent.trim() === 'Tools')
          expect(tools, `${page.path} Tools navigation`).toBeDefined()
          const href = tools!.getAttribute('href')!
          expect(new URL(href, urlFor(page.path)).pathname).toBe(urlFor(`${page.port}/${page.version}/mcp/tools/`).pathname)
          expect(resolves(href, urlFor(page.path).href), href).toBe(true)
        } else {
          const internals = [...nav.querySelectorAll('.sidebar-section')]
            .find((section) => section.querySelector('.section-label')?.textContent.trim() === 'Internals')
          expect(internals, `${page.path} Internals navigation group`).toBeDefined()
          const hrefs = [...internals!.querySelectorAll('a[href]')]
            .map((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname)
          for (const section of sectionsFor(page.port, 'workspace').filter((entry) => entry.startsWith('internals'))) {
            expect(hrefs, `${page.path} ${section} navigation`).toContain(urlFor(`${page.port}/${page.version}/workspace/${section}/`).pathname)
          }
        }
      }
      if (page.product === 'workspace' && page.port !== 'py' && !page.section) {
        const intro = [...document.querySelectorAll('article strong')].map((element) => element.textContent).join(' ')
        expect(intro, `${page.path} unfinished workspace application`).toMatch(/is in development and is not a finished\s+workspace application/i)
        expect(document.querySelector('article')!.textContent, `${page.path} no user CLI`).toMatch(/no CLI equivalent to\s+tmuxp load/i)
        const upstream = [...document.querySelectorAll('article a[href]')]
          .find((link) => link.getAttribute('href') === 'https://tmuxp.git-pull.com/')
        expect(upstream?.textContent, `${page.path} tmuxp reference`).toBe('tmuxp')
      }
    })
  })

  it('links generated declarations and schema-bearing tools inside their product', () => {
    for (const page of pages().filter((entry) => entry.section === 'api' || entry.section === 'internals/api')) {
      const prefix = `${page.port}/${page.version}/${page.product}/${page.section}/`
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
        if (page.product === 'workspace') {
          const labels = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] a, nav[aria-label="Breadcrumb"] [aria-current="page"]')]
            .map((item) => item.textContent.trim())
          expect(labels.slice(0, 3)).toEqual([page.name, 'Workspace Manager', 'Internals'])
          expect(graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')?.itemListElement?.map((item) => item.name)).toEqual(labels)
        } else developmentStatus(document, samplePath)
      })
      if (page.product === 'workspace') redirectsTo(samplePath.replace('/internals/api/', '/api/'), samplePath)
      if (page.product !== 'mcp') continue
      const toolsPath = `${page.port}/${page.version}/mcp/tools/`
      const tools = inspect(toolsPath, (document) => {
        developmentStatus(document, toolsPath)
        return [...document.querySelectorAll('article dt a[href]')].map((link) => link.getAttribute('href')!)
      })
      expect(tools.length, `${toolsPath} protocol tools`).toBeGreaterThan(0)
      for (const href of tools) {
        expect(new URL(href, urlFor(toolsPath)).pathname).toMatch(new RegExp(`^/${SITE_PREFIX}${toolsPath}[^/]+/$`))
        expect(resolves(href, urlFor(toolsPath).href), href).toBe(true)
      }
      const toolPath = new URL(tools[0], urlFor(toolsPath)).pathname.slice(SITE_PREFIX.length + 1)
      inspect(toolPath, (document) => {
        developmentStatus(document, toolPath)
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
      const available = PORTS.filter((port) => sectionsFor(port.slug, page.product).includes(page.section))
      expect(links.length, `${page.path} port counterparts`).toBe(available.length)
      for (const port of PORTS) {
        const version = port.slug === page.port ? page.version : defaults[port.slug]
        const expected = urlFor(`${port.slug}/${version}/${page.product}/${page.section ? `${page.section}/` : ''}`).pathname
        expect(links.some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === expected),
          `${page.path} counterpart ${expected}`).toBe(available.includes(port))
        if (!available.includes(port)) {
          const unavailable = [...document.querySelectorAll('[data-page-port-switcher] [aria-disabled="true"]')]
          expect(unavailable.some((entry) => entry.textContent.includes(port.name)), `${page.path} unavailable ${port.name}`).toBe(true)
        }
      }
      const crumb = document.querySelector('nav[aria-label="Breadcrumb"]')!
      expect(crumb, page.path).not.toBeNull()
      const labels = [...crumb.querySelectorAll('a, [aria-current="page"]')].map((item) => item.textContent.trim())
      const structured = graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')
      expect(structured?.itemListElement?.map((item) => item.name), page.path).toEqual(labels)
      expect(labels[0]).toBe(page.name)
      expect(labels[1]).toBe(page.product === 'mcp' ? 'MCP' : 'Workspace Manager')
      if (page.section.startsWith('internals/')) expect(labels[2]).toBe('Internals')
      for (const item of structured!.itemListElement!) expect(resolves(item.item), item.item).toBe(true)
      expect(new URL(structured!.itemListElement!.at(-1)!.item).pathname).toBe(urlFor(page.path).pathname)
    })
  })

  it('redirects previous workspace implementation URLs without replacing Python CLI docs', () => {
    for (const page of pages().filter((entry) => entry.product === 'workspace'
      && (entry.section === 'internals/api' || (entry.port !== 'py' && entry.section.startsWith('internals/'))))) {
      redirectsTo(page.path.replace('/internals/', '/'), page.path)
    }
    for (const page of pages().filter((entry) => entry.port === 'py' && entry.product === 'workspace'
      && ['guides', 'examples'].includes(entry.section))) inspect(page.path, (document) => {
      expect(document.querySelector('meta[http-equiv="refresh"]'), `${page.path} remains a user guide`).toBeNull()
      expect(document.querySelector('article')!.textContent, `${page.path} CLI usage`).toContain('tmuxp load')
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
      if (page.product === 'workspace' && (page.section === 'internals/api'
        || (page.port !== 'py' && page.section.startsWith('internals/')))) {
        const legacy = url.replace('/workspace/internals/', '/workspace/')
        expect(sitemap, `${legacy} redirect is not canonical`).not.toContain(`<loc>${legacy}</loc>`)
      }
    }
    const exportRoots = new Set(['', ...pages().map((page) => `${page.port}/${page.version}/`)])
    for (const root of exportRoots) {
      const body = read(`${root}llms-full.txt`)
      expect(body, `${root} resolved file inclusions`).not.toMatch(/```[^\n]*file="[^"\n]+"[^\n]*\n\s*```/)
      const exported = JSON.parse(read(`${root}docs.json`)) as { pages: { url: string; markdownUrl: string }[] }
      for (const entry of exported.pages.filter((entry) => productUrl.test(entry.url))) {
        expect(resolves(entry.url), entry.url).toBe(true)
        expect(resolves(entry.markdownUrl), entry.markdownUrl).toBe(true)
        expect(entry.url, `${root} canonical workspace API exports`).not.toMatch(/\/workspace\/api(?:\/|$)/)
        expect(entry.url, `${root} canonical workspace prose exports`).not.toMatch(/\/(?:ts|rs|go|java|dotnet|cxx|swift)\/[^/]+\/workspace\/(?:topics|guides|examples)(?:\/|$)/)
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
