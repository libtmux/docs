import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { PORTS, productAvailable, productInDevelopment } from '../src/lib/ports'
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

interface DocsManifest {
  pages: { url: string; markdownUrl: string }[]
  ports: {
    slug: string
    products: { slug: string; availability: string; inDevelopment: boolean; cli?: string | null; reference: string | null; protocol?: string | null }[]
    documentation: { id: string; name: string; kind: string; availability: string; url: string; package?: string }[]
  }[]
}

const products = ['mcp', 'workspace'] as const
const read = (path: string) => readFileSync(sitePath(path), 'utf8')
const manifest = (): Manifest => JSON.parse(read('versions.json'))
const urlFor = (path: string) => new URL(`/${SITE_PREFIX}${path}`, 'https://libtmux.org')
const productUrl = /\/(?:py|ruby|lua|ts|rs|go|java|dotnet|cxx|swift)\/[^/]+\/(?:mcp|workspace)(?:\/|$)/

function sectionsFor(port: string, product: ProductPage['product']): string[] {
  if (port === 'lua') return ['']
  if (port === 'ruby') return ['', 'topics', 'guides', 'examples', 'reference']
  // `reference` is a section of the product now, not a page inside Internals:
  // the Workspace Manager and the MCP server are packages with APIs of their
  // own, and Internals keeps the notes about building one.
  if (product === 'mcp') return ['', 'topics', 'guides', 'examples', 'reference']
  return port === 'py'
    ? ['', 'topics', 'guides', 'examples', 'reference', 'internals', 'internals/topics', 'internals/examples']
    : ['', 'reference', 'internals', 'internals/topics', 'internals/guides', 'internals/examples']
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

const pageHtml = (path: string) => readFileSync(sitePath(path, 'index.html'), 'utf8')
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => match[0])
const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1]
const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').replaceAll('&#39;', "'").trim()

function graph(document: Window['document']): StructuredEntry[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => {
      const value = JSON.parse(script.textContent)
      return value['@graph'] ?? [value]
    })
}

/**
 * The notice is an `Aside`, the same one the reference and the guides use,
 * so it is a `role=note` rather than a landmark with a name of its own. What
 * matters to a reader is that the page says so before its prose, in a block
 * set apart from it.
 */
function developmentStatus(document: Window['document'], path: string): void {
  const notes = [...document.querySelectorAll('[role="note"]')]
  const status = notes.find((note) => /in development/i.test(note.textContent ?? ''))
  expect(status, `${path} development status`).toBeDefined()
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
  it('publishes source guides only below their port version', () => {
    expect(existsSync(sitePath('_staged'))).toBe(false)
    expect(existsSync(publishedPath('ja/_staged'))).toBe(false)
    expect(existsSync(sitePath('guides/source'))).toBe(false)
    expect(existsSync(sitePath('ruby/latest/guides/core/index.html'))).toBe(true)
    expect(existsSync(sitePath('lua/latest/guides/overview/index.html'))).toBe(true)
    redirectsTo('ruby/latest/guides/source/core', 'ruby/latest/guides/core/')
    redirectsTo('ruby/latest/guides/source/async', 'ruby/latest/guides/async/')
    redirectsTo('lua/latest/guides/source/overview', 'lua/latest/guides/overview/')
    redirectsTo('lua/latest/guides/source/runtime', 'lua/latest/guides/runtime/')
  })

  it('renders Lua Server in the public Server branch of its API sidebar', () => {
    inspect('lua/latest/reference/libtmux-server', (document) => {
      const current = document.querySelector('a[aria-current="page"][href$="/lua/latest/reference/libtmux-server/"]')
      expect(current).toBeDefined()
      const ancestors = [] as Element[]
      let node = current?.closest('[role="treeitem"]')
      while (node) {
        ancestors.push(node)
        node = node.parentElement?.closest('[role="treeitem"]') ?? null
      }
      const top = ancestors.at(-1)
      expect(top?.querySelector(':scope > .api-nav__row > a')?.textContent?.trim()).toBe('Server')
      expect(top?.querySelector(':scope > [role="group"] > li:first-child a')?.textContent?.trim()).toBe('libtmux.Server')
    })
  })

  it.each(PORTS.map((port) => port.slug))('%s exposes products from latest homes and core navigation', (port) => {
    for (const section of ['', 'guides/', 'topics/']) {
      const path = `${port}/latest/${section}`
      inspect(path, (document) => {
        const navigation = document.querySelectorAll(section ? 'nav[aria-label="Port documentation"]' : 'main')
        expect(navigation.length, `${path} product entry points`).toBeGreaterThan(0)
        for (const container of navigation) {
          for (const product of products) {
            const expected = urlFor(`${port}/latest/${product}/`).pathname
            const link = [...container.querySelectorAll('a[href]')]
              .find((entry) => new URL(entry.getAttribute('href')!, urlFor(path)).pathname === expected)
            expect(link, `${path} links to ${expected}`).toBeDefined()
            expect(link!.textContent, `${path} product label`).toContain(product === 'workspace' ? 'Workspace Manager' : 'MCP')
            if (!productAvailable(PORTS.find((entry) => entry.slug === port)!, product)) {
              expect(link!.textContent, `${path} unavailable product label`).toContain('not available')
            }
            expect(resolves(link!.getAttribute('href')!, urlFor(path).href), `${path} resolves ${expected}`).toBe(true)
          }
        }
        const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preload"][as="font"][href]')]
          .map((asset) => asset.getAttribute('src') ?? asset.getAttribute('href')!)
        expect(assets.length, `${path} linked assets`).toBeGreaterThan(0)
        expect([...new Set(assets)].filter((href) => !resolves(href, urlFor(path).href)), `${path} missing assets`).toEqual([])
      })
    }
  })

  it('surfaces Ruby Async and Lua runtime domains without presenting Lua products as available', () => {
    const domains = [
      { port: 'ruby', path: 'ruby/latest/', target: 'ruby/latest/guides/async/', label: 'Async', group: 'Companion packages' },
      { port: 'lua', path: 'lua/latest/', target: 'lua/latest/guides/runtime/', label: 'luv and Neovim', group: 'Runtime adapters' },
    ]
    for (const domain of domains) {
      inspect(domain.path, (document) => {
        const link = [...document.querySelectorAll('main a[href]')]
          .find((entry) => new URL(entry.getAttribute('href')!, urlFor(domain.path)).pathname === urlFor(domain.target).pathname)
        expect(link, `${domain.path} ${domain.label} card`).toBeDefined()
        expect(link!.textContent, `${domain.path} ${domain.label} card label`).toContain(domain.label)
      })
      inspect(domain.target, (document) => {
        const navigation = document.querySelector('nav[aria-label="Port documentation"]')
        expect(navigation, `${domain.target} port navigation`).toBeDefined()
        const section = [...navigation!.querySelectorAll('.sidebar-section')]
          .find((entry) => entry.querySelector('.section-label')?.textContent.trim() === domain.group)
        expect(section, `${domain.target} ${domain.group} group`).toBeDefined()
      })
    }
    inspect('lua/latest/', (document) => {
      for (const label of ['MCP (not available)', 'Workspace Manager (not available)']) {
        expect(document.querySelector('main')!.textContent, `Lua landing ${label}`).toContain(label)
      }
    })
  })

  it('serves both products and every section with the chosen port content', () => {
    for (const page of pages()) {
      const html = pageHtml(page.path)
      const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      expect(article, page.path).toBeDefined()
      const headings1 = [...article!.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => match[1]!)
      expect(headings1, page.path).toHaveLength(1)
      expect(text(headings1[0]!), page.path).toContain(page.name)
      expect(tags(article!, 'p').length, `${page.path} substantive prose`).toBeGreaterThan(2)
      for (const block of tags(article!, 'pre').filter((tag) => attribute(tag, 'data-language'))) {
        const owner = LANG_TO_PORT[attribute(block, 'data-language')!.toLowerCase()]
        if (owner) expect(owner, `${page.path} foreign language example`).toBe(page.port)
      }
      const headings = [...article!.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((match) => text(match[1]!))
      for (const other of PORTS.filter((port) => port.slug !== page.port)) {
        expect(headings, `${page.path} leaked ${other.name} section`).not.toContain(other.name)
      }
      const hrefs = tags(html, 'a').map((tag) => attribute(tag, 'href')).filter((href): href is string => Boolean(href))
      expect(hrefs.filter((href) => new URL(href, urlFor(page.path)).origin === 'https://libtmux.org'
        && /\/ports\/(?:py|ruby|lua|ts|rs|go|java|dotnet|cxx|swift)\//.test(href)),
        `${page.path} storage identities in public links`).toEqual([])
      if (!page.section && page.version !== 'latest') {
        const home = pageHtml(`${page.port}/${page.version}/`)
        const main = home.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? ''
        const entryPoints = tags(main, 'a').map((tag) => attribute(tag, 'href')).filter((href): href is string => Boolean(href))
          .map((href) => new URL(href, urlFor(page.path)).pathname)
        expect(entryPoints, `${page.path} port-home entry point`).toContain(urlFor(page.path).pathname)
      }
    }
  })

  it('distinguishes unfinished products and groups workspace implementation docs under Internals', () => {
    for (const page of pages()) inspect(page.path, (document) => {
      const port = PORTS.find((entry) => entry.slug === page.port)!
      if (productInDevelopment(port, page.product)) developmentStatus(document, page.path)
      const navigation = document.querySelectorAll('nav[aria-label="Documentation"]')
      expect(navigation.length, `${page.path} documentation navigation`).toBeGreaterThan(0)
      for (const nav of navigation) {
        if (page.product === 'mcp' && productAvailable(port, 'mcp')) {
          const tools = [...nav.querySelectorAll('a[href]')].find((link) => link.textContent.trim() === 'Tools')
          expect(tools, `${page.path} Tools navigation`).toBeDefined()
          const href = tools!.getAttribute('href')!
          expect(new URL(href, urlFor(page.path)).pathname).toBe(urlFor(`${page.port}/${page.version}/mcp/tools/`).pathname)
          expect(resolves(href, urlFor(page.path).href), href).toBe(true)
        } else if (page.product === 'workspace' && page.port !== 'ruby' && productAvailable(port, 'workspace')) {
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
      if (!productAvailable(port, page.product)) {
        expect(document.querySelector('article')!.textContent, `${page.path} availability`).toMatch(/not published|no published/i)
      }
      if (page.product === 'workspace' && productInDevelopment(port, 'workspace') && !page.section) {
        const status = [...document.querySelectorAll('[role="note"]')]
          .map((note) => note.textContent ?? '')
          .find((text) => /in development/i.test(text))
        expect(status, `${page.path} unfinished workspace application`).toMatch(/not a finished\s+workspace application/i)
        expect(status, `${page.path} no user CLI`).toMatch(/no CLI equivalent to\s+tmuxp load/i)
        expect(document.querySelector('article')!.textContent.match(/is in development/gi), `${page.path} states maturity once`).toHaveLength(1)
        const upstream = [...document.querySelectorAll('article a[href]')]
          .find((link) => link.getAttribute('href') === 'https://tmuxp.git-pull.com/')
        expect(upstream?.textContent, `${page.path} tmuxp reference`).toBe('tmuxp')
      }
    })
  })

  it('links generated declarations and schema-bearing tools inside their product', () => {
    for (const page of pages().filter((entry) => entry.section === 'reference'
      && productAvailable(PORTS.find((port) => port.slug === entry.port)!, entry.product))) {
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
          // The reference is a section of the product, so its pages hang
          // directly off it: no Internals level in between any more.
          expect(labels.slice(0, 2)).toEqual([page.name, 'Workspace Manager'])
          expect(labels.at(-1)).toBe(sample.title)
          expect(graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')?.itemListElement?.map((item) => item.name)).toEqual(labels)
        } else developmentStatus(document, samplePath)
      })
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
    // The reference is a section of the product now, not a page inside
    // Internals, so it has no lifted twin to redirect. What remains under
    // Internals still does, for a port with no workspace CLI of its own.
    for (const page of pages().filter((entry) => entry.product === 'workspace'
      && entry.port !== 'py' && entry.section.startsWith('internals/'))) {
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
    for (const page of pages()) {
      const html = pageHtml(page.path)
      const links = tags(html, 'link')
      const canonical = links.find((tag) => attribute(tag, 'rel') === 'canonical')
      const expected = `${page.port}/${defaults[page.port]}/${page.product}/${page.section ? `${page.section}/` : ''}`
      expect(canonical && attribute(canonical, 'href'), page.path).toBe(urlFor(expected).href)
      const robotsTag = tags(html, 'meta').find((tag) => attribute(tag, 'name') === 'robots')
      const robots = robotsTag && attribute(robotsTag, 'content')
      expect(robots, page.path).toBe(page.version === defaults[page.port] ? 'index, follow' : 'noindex, follow')
      expect(links.filter((tag) => attribute(tag, 'hreflang')), `${page.path} no invented translations`).toHaveLength(0)
      const bundles = [...html.matchAll(/\bdata-search-bundle="([^"]+)"/g)].map((match) => match[1])
      expect(bundles.length, `${page.path} search`).toBeGreaterThan(0)
      for (const bundle of bundles) {
        expect(bundle).toBe(`/${SITE_PREFIX}pagefind/`)
        expect(resolves(`${bundle}pagefind.js`)).toBe(true)
      }
    }
  })

  it('keeps product storage paths out of shared translation coverage', () => {
    for (const locale of ['en', 'ja']) {
      const coverage = readFileSync(publishedPath(`${locale}/translations/index.html`), 'utf8')
      expect(coverage.match(/href="\/(?:en|ja)\/(?:ports|_staged)\/[^"]*"/g),
        `${locale} coverage links to published shared pages`).toBeNull()
    }
  })

  it('exports real product URLs, resolved examples, and canonical sitemap entries', () => {
    const defaults = manifest().defaultVersion
    const index = JSON.parse(read('docs.json')) as DocsManifest
    const llms = read('llms.txt')
    const sitemapFiles = [...read('sitemap-index.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    const sitemap = sitemapFiles.map((path) => readFileSync(publishedPath(path), 'utf8')).join('\n')
    for (const page of pages().filter((entry) => entry.version === defaults[entry.port])) {
      const url = urlFor(page.path).href
      expect(index.pages.some((entry) => entry.url === url), `${url} in docs.json`).toBe(true)
      expect(llms, `${url} in llms.txt`).toContain(`](${url})`)
      expect(sitemap, `${url} in sitemap`).toContain(`<loc>${url}</loc>`)
      if (page.product === 'workspace' && page.port !== 'py' && page.section.startsWith('internals/')) {
        const legacy = url.replace('/workspace/internals/', '/workspace/')
        expect(sitemap, `${legacy} redirect is not canonical`).not.toContain(`<loc>${legacy}</loc>`)
      }
    }
    const exportRoots = new Set(['', ...pages().map((page) => `${page.port}/${page.version}/`)])
    for (const root of exportRoots) {
      const body = read(`${root}llms-full.txt`)
      expect(body, `${root} resolved file inclusions`).not.toMatch(/```[^\n]*file="[^"\n]+"[^\n]*\n\s*```/)
      const exported = JSON.parse(read(`${root}docs.json`)) as DocsManifest
      for (const port of PORTS) {
        const advertised = exported.ports.find((entry) => entry.slug === port.slug)!
        for (const product of products) {
          const metadata = advertised.products.find((entry) => entry.slug === product)!
          expect(metadata.availability, `${root}${port.slug} ${product} availability`).toBe(productAvailable(port, product) ? 'available' : 'unpublished')
          expect(metadata.inDevelopment, `${root}${port.slug} ${product} development status`).toBe(productInDevelopment(port, product))
          const section = 'reference'
          if (productAvailable(port, product)) {
            expect(new URL(metadata.reference!, urlFor(root)).pathname).toBe(urlFor(`${port.slug}/${defaults[port.slug]}/${product}/${section}/`).pathname)
          } else expect(metadata.reference).toBeNull()
          if (product === 'workspace') expect(metadata.cli, `${root}${port.slug} user CLI`).toBe(port.workspaceCli ?? null)
          else if (productAvailable(port, 'mcp')) expect(resolves(metadata.protocol!, urlFor(root).href), `${root}${port.slug} MCP protocol`).toBe(true)
          else expect(metadata.protocol).toBeNull()
        }
      }
      const ruby = exported.ports.find((entry) => entry.slug === 'ruby')!
      expect(ruby.documentation).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'async', kind: 'companion-package', availability: 'available', package: 'libtmux-async' }),
      ]))
      const lua = exported.ports.find((entry) => entry.slug === 'lua')!
      expect(lua.documentation).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'runtime', kind: 'runtime', availability: 'available' }),
        expect.objectContaining({ id: 'mcp', kind: 'unavailable', availability: 'unpublished' }),
        expect.objectContaining({ id: 'workspace', kind: 'unavailable', availability: 'unpublished' }),
      ]))
      for (const area of [...ruby.documentation, ...lua.documentation]) {
        expect(resolves(area.url, urlFor(root).href), `${root}${area.url} documentation area`).toBe(true)
      }
      for (const entry of exported.pages.filter((entry) => productUrl.test(entry.url))) {
        expect(resolves(entry.url), entry.url).toBe(true)
        expect(resolves(entry.markdownUrl), entry.markdownUrl).toBe(true)
        expect(entry.url, `${root} canonical workspace API exports`).not.toMatch(/\/workspace\/api(?:\/|$)/)
        expect(entry.url, `${root} canonical workspace prose exports`).not.toMatch(/\/(?:lua|ts|rs|go|java|dotnet|cxx|swift)\/[^/]+\/workspace\/(?:topics|guides|examples)(?:\/|$)/)
        if (root) expect(new URL(entry.url).pathname).toContain(`/${SITE_PREFIX}${root}`)
      }
    }
    const japanese = publishedPath('ja/docs.json')
    expect(existsSync(japanese), 'Japanese assembled manifest').toBe(true)
    const translated = JSON.parse(readFileSync(japanese, 'utf8')) as { pages: { url: string }[] }
    expect(translated.pages.map((entry) => new URL(entry.url).pathname)
      .filter((path) => /^\/ja\/(?:py|ruby|lua|ts|rs|go|java|dotnet|cxx|swift)\//.test(path)),
    'Japanese manifest does not invent localized port guides').toEqual([])
    for (const entry of translated.pages.filter((entry) => productUrl.test(entry.url))) {
      expect(new URL(entry.url).pathname, entry.url).not.toMatch(/^\/ja\/(?:py|ruby|lua|ts|rs|go|java|dotnet|cxx|swift)\//)
      expect(resolves(entry.url), entry.url).toBe(true)
    }
  })
})
