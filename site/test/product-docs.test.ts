import { existsSync, globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { Window, type Element as DomElement } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { CONCEPT_DESCRIPTION, PORTS, productAvailable, productDescription, productIsConcept, productInDevelopment, productStatus, workspaceOverviewNotice, type Port } from '../src/lib/ports'
import { proseSources } from '../../scripts/lib/api-destinations.mjs'
import { REGISTRY } from '../src/lib/registry'
import { LANG_TO_PORT } from '../src/plugins/remark-port-code.mjs'
import { SITE_BUILT, SITE_PREFIX, PREVIEW_PREFIX, REPO_ROOT, productionPath, publishedPath, sitePath } from './site-root'
import { MCP_REFERENCE, MCP_SECTIONS, mcpObjects } from '../src/lib/mcp-catalog'
import { mcpObjectGroup } from '../src/lib/mcp-reference'
import { mentionBadge, mentionBadgeHtml } from '../src/lib/mention-badge'
import { headingTitle } from '../src/lib/branding'
import { docsPath, type DocsPage } from '../src/lib/docs-paths'
import { docsEntriesAvailable } from '../src/lib/page-port-links'
import { documentationAreas, SOURCE_GUIDE_PORTS, sourceGuideRedirectsFor, sourceGuidesFor } from '../src/lib/port-documentation'
import { KNOWN_PORTS, resolvePortData } from '../src/lib/workspace-shared-slots'
import { DEFAULT_LOCALE, isLocale } from '../src/i18n/locales'
import type { ApiTreeJson } from '../src/lib/api-search'
import { PRODUCT_SECTIONS } from '../src/lib/product-api-sections'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

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
    products: { slug: string; availability: string; url: string | null; inDevelopment: boolean; support?: string; supportDescription?: string; cli?: string | null; cliAvailability?: string | null; reference: string | null; protocol?: string | null }[]
    documentation: { id: string; name: string; kind: string; availability: string; url: string; package?: string }[]
  }[]
}

const products = ['mcp', 'workspace'] as const
const primaryPorts = PORTS.filter((port) => !port.parentLibrary)
// Read authored and staged routes only when the assembled-output checks run.
let sourcePages: Map<string, DocsPage[]> | undefined
function portPages(port: string): DocsPage[] {
  if (!sourcePages) {
    const entries = proseSources({ root: REPO_ROOT })
    sourcePages = new Map(PORTS.map((owner) => [owner.slug, docsEntriesAvailable(entries, owner.slug)]))
  }
  return sourcePages.get(port)!
}
/** A regular-expression alternation over the registered ports, so a new port is covered without editing a list. */
const portSlugs = (ports: readonly Port[] = PORTS) => ports.map((port) => port.slug).join('|')
const read = (path: string) => readFileSync(sitePath(path), 'utf8')
/** An index entry's name as a reader hears it: the kind badge that leads the link is hidden decoration. */
function declarationName(link: DomElement) {
  const name = link.cloneNode(true) as DomElement
  for (const decoration of name.querySelectorAll('[aria-hidden="true"]')) decoration.remove()
  return name.textContent.trim()
}
// Earlier product checks parse these indexes. Reuse only plain link facts,
// keyed by the current HTML bytes, rather than keeping their large DOMs alive.
const declarationIndexes = new Map<string, { href: string; title: string }[]>()
function referenceDeclarations(html: string, document?: Window['document']) {
  const identity = createHash('sha256').update(html).digest('hex')
  const saved = declarationIndexes.get(identity)
  if (saved || !document) return saved
  const declarations = [...document.querySelectorAll('[aria-labelledby="generated-api"] a[href]')]
    .map((link) => ({ href: link.getAttribute('href')!, title: declarationName(link) }))
  declarationIndexes.set(identity, declarations)
  return declarations
}
const manifest = (): Manifest => JSON.parse(read('versions.json'))
/** The pages a manifest lists at or below a product's overview, other than the overview, with or without a trailing slash. */
const pagesBeyondOverview = (pages: { url: string }[], overview: string) => pages
  .map((entry) => new URL(entry.url).pathname.replace(/\/*$/, '/'))
  .filter((path) => path.startsWith(overview) && path !== overview)
const urlFor = (path: string) => new URL(`/${SITE_PREFIX}${path}`, 'https://libtmux.org')
const productUrl = new RegExp(`/(?:${portSlugs(primaryPorts)})/[^/]+/(?:mcp|workspace)(?:/|$)`)
// Only a documented Internals section without a public Topics page needs this redirect.
function legacyWorkspaceTopics(url: string) {
  const match = /\/([^/]+)\/[^/]+\/workspace\/topics\/?$/.exec(url)
  if (!match || !PORTS.some((port) => port.slug === match[1])) return false
  const sections = sectionsFor(match[1], 'workspace')
  return sections.includes('internals/topics') && !sections.includes('topics')
}
// A page's storage identity under `ports/` must not reach a public link.
const storageIdentity = new RegExp(`/ports/(?:${portSlugs()})/`)
// Port documentation is not translated, so no port tree exists under a translated locale.
const localizedPortTree = new RegExp(`^/ja/(?:${portSlugs()})/`)

const productSources = new Map<string, { title?: string; subtitle?: string; shared?: boolean } | undefined>()
type SourcePage = DocsPage & { data: DocsPage['data'] & { title: string } }
const sourceByPort = new Map<string, Map<string, SourcePage>>()
let sourceEntries: SourcePage[] | undefined

/** Expected routes come from source, so a missing rendered page cannot remove its own test. */
function documentsFor(port: string): Map<string, SourcePage> {
  const cached = sourceByPort.get(port)
  if (cached) return cached
  if (!sourceEntries) {
    const base = new URL('../src/content/docs/', import.meta.url)
    const idFor = (file: string) => file.replace(/\.mdx?$/, '').replace(/\/index$/, '')
    const entries = globSync(['**/*.md', '**/*.mdx'], { cwd: base }).filter((file) => {
      const locale = file.split('/')[0]
      return !isLocale(locale) || locale === DEFAULT_LOCALE
    }).map((file) => ({
      id: idFor(file), data: parseFrontmatter(readFileSync(new URL(file, base), 'utf8')).frontmatter,
    })) as SourcePage[]
    const owned = new Set(entries.map((entry) => entry.id))
    const shared = new URL('../src/content/_workspace-shared/', import.meta.url)
    for (const file of globSync(['**/*.md', '**/*.mdx'], { cwd: shared })) {
      const { frontmatter } = parseFrontmatter(readFileSync(new URL(file, shared), 'utf8'))
      for (const slug of KNOWN_PORTS) {
        const id = `ports/${slug}/${idFor(file)}`
        if (!owned.has(id)) entries.push({ id, data: resolvePortData(frontmatter, slug, 'workspace') } as SourcePage)
      }
    }
    sourceEntries = entries
  }
  const documents = new Map(docsEntriesAvailable(sourceEntries, port).map((entry) => [docsPath(entry), entry]))
  // A staging omission is a failure, not permission to skip that port's native guides.
  for (const guide of SOURCE_GUIDE_PORTS.includes(port) ? sourceGuidesFor(port) : []) {
    expect(documents.has(guide.route), `${port}: stage native guide ${guide.sourcePath}`).toBe(true)
  }
  sourceByPort.set(port, documents)
  return documents
}

function sourceGuide(port: string, product: ProductPage['product']) {
  return SOURCE_GUIDE_PORTS.includes(port)
    ? sourceGuidesFor(port).find((guide) => guide.product === product && guide.route === `${product}/source-guide`) : undefined
}
/** Authored metadata determines headings and which section roots really exist. */
function productSource(port: string, product: ProductPage['product'], section: string): { title?: string; subtitle?: string; shared?: boolean } | undefined {
  const key = `${port}/${product}/${section}`
  if (productSources.has(key)) return productSources.get(key)
  const route = [product, section].filter(Boolean).join('/')
  const guide = SOURCE_GUIDE_PORTS.includes(port)
    ? sourceGuidesFor(port).find((entry) => entry.route === route) : undefined
  if (guide) {
    const source = { title: guide.title }
    productSources.set(key, source)
    return source
  }
  const roots = [`docs/ports/${port}`, ...(product === 'workspace' && KNOWN_PORTS.has(port) ? ['_workspace-shared'] : [])]
  for (const root of roots) for (const suffix of ['.md', '/index.md']) {
    const file = new URL(`../src/content/${root}/${route}${suffix}`, import.meta.url)
    if (!existsSync(file)) continue
    const { frontmatter } = parseFrontmatter(readFileSync(file, 'utf8'))
    const data = resolvePortData(frontmatter, port, product)
    const source = { title: data.title as string, subtitle: data.subtitle as string | undefined, shared: root === '_workspace-shared' }
    productSources.set(key, source)
    return source
  }
  productSources.set(key, undefined)
  return undefined
}

function counterpartRoutes(port: string, path: string): Map<string, readonly string[]> {
  const own = documentsFor(port).get(path)
  const paths = [path, ...(own?.data.aliases ?? [])]
  const product = path.split('/')[0] as ProductPage['product']
  return new Map(PORTS.filter((candidate) => !candidate.parentLibrary && candidate.productAvailability?.[product] !== 'excluded')
    .map((candidate) => {
      if (own?.data.equivalence && candidate.slug === port) return [port, [path]] as const
      const documents = [...documentsFor(candidate.slug).values()]
      // Equivalent pages are all offered; otherwise the switcher offers one page per port: its own page
      // before a shared one, and a match on this page's route before a match on one of its aliases.
      const matches = own?.data.equivalence
        ? documents.filter((entry) => entry.data.equivalence === own.data.equivalence && entry.data.product === own.data.product)
        : paths.flatMap((route) => documents.filter((entry) => docsPath(entry) === route || entry.data.aliases?.includes(route)))
      const owned = matches.filter((entry) => entry.data.port === candidate.slug)
      const offered = own?.data.equivalence ? matches : (owned.length ? owned : matches).slice(0, 1)
      // A product overview may be an alias of a core integration guide.
      return [candidate.slug, [...new Set(offered.map((entry) => path === product && entry.data.aliases?.includes(path) ? path : docsPath(entry)))]] as const
    }).filter(([, routes]) => routes.length))
}

it('advertises workspace loaders with their declared command and development status', () => {
  for (const port of PORTS.filter((entry) => entry.workspaceCli)) {
    expect(port.workspaceCli).toMatch(/^\S+\s+\S+/)
    const executable = port.packages?.find((entry) => entry.id === 'workspace')?.executable
    if (executable) expect([port.workspaceCli, port.workspaceCli!.split(/\s+/)[0]]).toContain(executable)
    expect(productInDevelopment(port, 'workspace')).toBe(productAvailable(port, 'workspace') && port.workspaceCliAvailability !== 'released')
    expect(productInDevelopment(port, 'mcp')).toBe(productAvailable(port, 'mcp'))
    expect(productDescription(port, 'workspace')).not.toMatch(/worktree|checkpoint/)
    if (port.workspaceCliAvailability === 'local') {
      expect(productDescription(port, 'workspace')).toContain(port.productDescriptions?.workspace ?? 'Build the CLI from source')
    }
    if (['local', 'published'].includes(port.workspaceCliAvailability!)) expect(workspaceOverviewNotice(port)?.body).toContain(`\`${port.workspaceCliRun ?? port.workspaceCli!.split(/\s+/)[0]}\``)
    if (port.workspaceCliAvailability === 'published') {
      expect(productDescription(port, 'workspace')).toContain('published')
      expect(workspaceOverviewNotice(port)?.body).not.toMatch(/unreleased|local/)
    }
  }
})

function sectionsFor(port: string, product: ProductPage['product'], documents = documentsFor(port)): string[] {
  const owner = PORTS.find((entry) => entry.slug === port)!
  if (owner.parentLibrary || owner.productAvailability?.[product] === 'excluded') return []
  for (const area of documentationAreas(port).filter((area) => area.product === product)) {
    const overview = documents.get(area.route)
    expect(overview, `${port}: required ${product} overview`).toBeDefined()
    expect(overview!.data, `${port}: ${product} overview ownership`).toMatchObject({ port, product })
  }
  return ['', 'topics', 'guides', 'examples', 'reference', 'internals', 'internals/topics', 'internals/guides', 'internals/examples', 'source-guide']
    .filter((section) => {
      const path = `${product}${section ? `/${section}` : ''}`
      const entry = documents.get(path)
      if (!entry) return false
      expect(entry.data, `${port}: ${path} ownership`).toMatchObject({ port, product })
      return true
    })
}

it('keeps declared product overviews and their ownership required', () => {
  for (const port of primaryPorts) {
    for (const product of products) sectionsFor(port.slug, product)
    for (const area of documentationAreas(port.slug).filter((area) => area.product && port.productAvailability?.[area.product] !== 'excluded')) {
      const documents = documentsFor(port.slug)
      const missing = new Map(documents)
      missing.delete(area.route)
      expect(() => sectionsFor(port.slug, area.product!, missing)).toThrow(`${port.slug}: required ${area.product} overview`)
      const mislabelled = new Map(documents)
      const overview = documents.get(area.route)!
      mislabelled.set(area.route, { ...overview, data: { ...overview.data, product: undefined } })
      expect(() => sectionsFor(port.slug, area.product!, mislabelled)).toThrow(`${port.slug}: ${area.product} overview ownership`)
    }
  }
})

it('keeps declared product entry pages in the source-derived checks', () => {
  for (const port of primaryPorts) for (const product of products) {
    const sections = sectionsFor(port.slug, product)
    if (port.productAvailability?.[product] === 'excluded') expect(sections).toEqual([])
    else if (!productAvailable(port, product)) {
      // An unpublished product, which ships from source, builds its overview and nothing more.
      const source = productSource(port.slug, product, '')
      expect(source, `${port.slug} ${product} overview source`).toBeDefined()
      expect(sections).toEqual([''])
      expect(source!.title, `${port.slug} ${product} overview`).toBeTruthy()
    } else expect(sections, `${port.slug} ${product} entry pages`).toEqual(expect.arrayContaining(['', 'reference']))
  }
})

function pages(): ProductPage[] {
  const versions = manifest()
  return primaryPorts.flatMap((port) => {
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

async function inspect<T>(path: string, check: (document: Window['document']) => T | Promise<T>): Promise<T> {
  const file = sitePath(path, 'index.html')
  expect(existsSync(file), `assembled product page ${path}`).toBe(true)
  const window = new Window({
    url: urlFor(path).href,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  try {
    const html = readFileSync(file, 'utf8')
    window.document.write(html)
    if (/(?:mcp|workspace)\/reference\/$/.test(path)) referenceDeclarations(html, window.document)
    return await check(window.document)
  } finally {
    await window.happyDOM.close()
  }
}

async function declarationIndex(path: string) {
  const file = sitePath(path, 'index.html')
  expect(existsSync(file), `assembled product page ${path}`).toBe(true)
  const saved = referenceDeclarations(readFileSync(file, 'utf8'))
  return saved ?? inspect(path, (document) => referenceDeclarations(readFileSync(file, 'utf8'), document)!)
}

it('reuses declaration facts only for identical HTML without retaining a document', async () => {
  const window = new Window()
  try {
    const html = '<section aria-labelledby="generated-api"><a href="/reference/server/"><code>Server</code></a></section>'
    window.document.body.innerHTML = html
    const first = referenceDeclarations(html, window.document)
    expect(first).toEqual([{ href: '/reference/server/', title: 'Server' }])
    window.document.body.innerHTML = ''
    expect(referenceDeclarations(html)).toEqual(first)
    const changed = html.replaceAll('server', 'pane').replaceAll('Server', 'Pane')
    expect(referenceDeclarations(changed)).toBeUndefined()
    window.document.body.innerHTML = changed
    expect(referenceDeclarations(changed, window.document)).toEqual([{ href: '/reference/pane/', title: 'Pane' }])
    expect(referenceDeclarations(html)).toEqual(first)
  } finally {
    await window.happyDOM.close()
  }
})

it('names an index entry without the kind badge that leads its link', async () => {
  const window = new Window()
  try {
    const html = `<section aria-labelledby="generated-api"><a href="/reference/argumentmap/">${mentionBadgeHtml(mentionBadge('typealias')!)}<code>ArgumentMap</code></a></section>`
    window.document.body.innerHTML = html
    expect(window.document.querySelector('a')!.textContent).not.toBe('ArgumentMap')
    expect(referenceDeclarations(html, window.document)).toEqual([{ href: '/reference/argumentmap/', title: 'ArgumentMap' }])
  } finally {
    await window.happyDOM.close()
  }
})

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
 * Read the rendered sidebar ancestry independently of the breadcrumb builder.
 *
 * A flat API reference is one tree whose only top-level row is the reference itself; a sectioned product reference
 * has its sections as top-level rows instead, and the breadcrumb keeps the section after "API reference". The rows
 * below the reference row (a section included) to the page's declaration are returned, without the badge each row
 * draws beside its name. The page's own link must already be marked current in the served HTML, since nothing here
 * runs a script.
 */
function referenceTrail(document: Window['document'], href: string) {
  const navigation = document.querySelector('.api-nav nav')!
  const current = [...navigation.querySelectorAll('a[aria-current="page"]')]
    .find((link) => link.getAttribute('href') === href)
  expect(current, `${href} active sidebar declaration`).toBeDefined()
  const trail: { name: string; url: string | null }[] = []
  for (let row = current!.closest('[role="treeitem"]'); row; row = row.parentElement?.closest('[role="treeitem"]') ?? null) {
    // A leaf is its own link; a branch keeps its label, linked or not, in the row above its group.
    const leaf = row.tagName === 'A'
    const label = row.querySelector(leaf ? ':scope > .api-nav__label' : ':scope > .api-nav__row > .api-nav__label')!
    const copy = label.cloneNode(true)
    for (const decoration of copy.querySelectorAll('[aria-hidden="true"]')) decoration.remove()
    trail.unshift({ name: copy.textContent.trim(), url: (leaf ? row : label).getAttribute('href') })
  }
  const [top, ...declarations] = trail
  if (top?.name === 'API reference') return declarations
  const sections = new Set(Object.values(PRODUCT_SECTIONS).flat().map((section) => section.label))
  expect(sections.has(top?.name ?? ''), `${href} the tree's top row is the reference or one of its sections, not ${top?.name}`).toBe(true)
  return trail
}

/** The first paint of the real reference sidebar, so the reader below follows the component's markup. */
async function referenceSidebar(inventory: ApiTreeJson, selectedSymbol: string) {
  const template = await loadAstroTemplate('components/api/ApiTree.astro', {
    real: ['components/api/ApiTreeItems.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro'],
  })
  const window = new Window()
  window.document.body.innerHTML = await renderAstroTemplate(template, { props: {
    presentation: 'outline', inventory, selectedSymbol, referenceBase: '/reference/', portName: 'Sample', tree: [], members: [],
    withMembers: new Set(), currentPath: '/reference/', version: 'test', treeLabel: 'Sample: API Reference',
  } })
  return window
}

const sidebarInventory: ApiTreeJson = {
  port: 'sample',
  buckets: [{ id: 'sample', label: 'API reference', count: 2, slug: 'application', types: [], children: [
    { id: 'base', label: 'Base', count: 2, slug: null, types: [
      { id: 'Application', name: 'Application', slug: 'application', m: 1, kind: 'struct', category: 'types' },
      { id: 'Other', name: 'Other', slug: 'other', m: 0, kind: 'struct', category: 'types' },
    ], children: [] },
  ] }],
  members: { Application: [['close', 'application-close', 'Application.close', 'method']] },
}

it.each([
  { symbol: 'Application.close', href: '/reference/application-close/', expected: [
    { name: 'Base', url: null }, { name: 'Application', url: '/reference/application/' }, { name: 'close', url: '/reference/application-close/' },
  ] },
  { symbol: 'Application', href: '/reference/application/', expected: [
    { name: 'Base', url: null }, { name: 'Application', url: '/reference/application/' },
  ] },
])('reads reference ancestors of $symbol without badges or a repeated current owner', async ({ symbol, href, expected }) => {
  const window = await referenceSidebar(sidebarInventory, symbol)
  try {
    expect(referenceTrail(window.document, href)).toEqual(expected)
  } finally {
    await window.happyDOM.close()
  }
})

it('names a row by its label alone when a mark is drawn inside it', async () => {
  const window = await referenceSidebar(sidebarInventory, 'Application.close')
  try {
    const owner = window.document.querySelector('.api-nav [role="treeitem"][aria-description="struct"]')!
    const label = owner.querySelector(':scope > .api-nav__row > .api-nav__label')!
    label.prepend(owner.querySelector(':scope > .api-nav__row > .api-nav__kind')!)
    expect(label.textContent).toMatch(/^\s*\S+\s+Application/)
    expect(referenceTrail(window.document, '/reference/application-close/').map((item) => item.name)).toEqual(['Base', 'Application', 'close'])
  } finally {
    await window.happyDOM.close()
  }
})

it('finds no ancestry in a sidebar that does not mark the page, or that marks another', async () => {
  const window = await referenceSidebar(sidebarInventory, 'Other')
  try {
    expect(() => referenceTrail(window.document, '/reference/application-close/')).toThrow(/active sidebar declaration/)
    window.document.querySelector('.api-nav nav a[aria-current="page"]')!.removeAttribute('aria-current')
    expect(() => referenceTrail(window.document, '/reference/other/')).toThrow(/active sidebar declaration/)
  } finally {
    await window.happyDOM.close()
  }
})

/**
 * The notice is an `Aside`, the same one the reference and the guides use,
 * so it is a `role=note` rather than a landmark with a name of its own. What
 * matters to a reader is that the page says so before its prose, in a block
 * set apart from it.
 */
function developmentStatus(document: Window['document'], path: string, concept: boolean): void {
  const notes = [...document.querySelectorAll('[role="note"]')]
  const status = notes.find((note) => (concept ? /concept example/i : /in development/i).test(note.textContent ?? ''))
  expect(status, `${path} support scope or development status`).toBeDefined()
  if (concept) expect(status!.textContent).toContain(CONCEPT_DESCRIPTION)
}

async function redirectsTo(path: string, target: string): Promise<void> {
  await inspect(path, (document) => {
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
  it('publishes source guides only below their port version', async () => {
    expect(existsSync(sitePath('_staged'))).toBe(false)
    expect(existsSync(publishedPath(`${PREVIEW_PREFIX}/ja/_staged`))).toBe(false)
    expect(existsSync(sitePath('guides/source'))).toBe(false)
    expect(existsSync(sitePath('ruby/latest/guides/core/index.html'))).toBe(true)
    expect(existsSync(sitePath('lua/latest/guides/overview/index.html'))).toBe(true)
    await redirectsTo('ruby/latest/guides/source/core', 'ruby/latest/guides/core/')
    await redirectsTo('ruby/latest/guides/source/async', 'ruby/latest/guides/async/')
    await redirectsTo('lua/latest/guides/source/overview', 'lua/latest/guides/overview/')
    await redirectsTo('lua/latest/guides/source/runtime', 'lua/latest/guides/runtime/')
    await redirectsTo('powershell/latest/mcp/', 'powershell/latest/guides/mcp/')
    // Public product roots that these ports no longer claim lead to the language home.
    for (const path of ['lua/latest/mcp/', 'lua/latest/workspace/', 'elixir/latest/mcp/', 'elixir/latest/workspace/', 'haskell/latest/workspace/']) {
      await redirectsTo(path, `${path.split('/')[0]}/latest/`)
    }
    await inspect('powershell/latest/mcp/', (document) => {
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex')
      expect(document.querySelector('a[href]')?.getAttribute('href')).toBe(urlFor('powershell/latest/guides/mcp/').pathname)
    })
    await inspect('powershell/latest/guides/mcp/', (document) => {
      expect(document.querySelector('article h1')?.textContent).toBe('Using the .NET MCP server')
      expect(document.querySelector('[data-pagefind-body]')).not.toBeNull()
      expect(document.querySelector('[data-surface-picker] .surface-current .surface-label')?.textContent).toBe('Core Library')
    })
  })

  it('renders Lua Server in the public Server branch of its API sidebar', async () => {
    await inspect('lua/latest/reference/libtmux-server', (document) => {
      const current = document.querySelector('[role="tree"] a[aria-current="page"][href$="/lua/latest/reference/libtmux-server/"]')
      expect(current).toBeDefined()
      const ancestors: Array<NonNullable<typeof current>> = []
      let node = current?.closest('[role="treeitem"]')
      while (node) {
        ancestors.push(node)
        node = node.parentElement?.closest('[role="treeitem"]') ?? null
      }
      const top = ancestors.at(-1)
      expect(top?.querySelector(':scope > .api-nav__row > .api-nav__label')?.textContent?.trim()).toBe('Server')
      // A row shows its id only when a sibling shares its name.
      const first = top?.querySelector(':scope > [role="group"] > li:first-child > .api-nav__row')
      expect(first?.querySelector('.api-nav__label')?.textContent?.trim()).toBe('Server')
      expect(first?.querySelector('a')?.getAttribute('href')).toMatch(/\/lua\/latest\/reference\/libtmux-server\/$/)
      const badge = first?.querySelector('.api-nav__kind')
      expect(badge?.textContent).toBe('C')
      expect(badge?.getAttribute('title')).toBe('class')
      expect(badge?.getAttribute('aria-hidden')).toBe('true')
    })
  })

  it.each(PORTS.filter((port) => !port.parentLibrary).map((port) => port.slug))('%s exposes supported products from latest homes and core navigation', async (port) => {
    const sections = ['guides', 'topics'].filter((section) => documentsFor(port).has(section))
    for (const section of ['', ...sections.map((section) => `${section}/`)]) {
      const path = `${port}/latest/${section}`
      await inspect(path, (document) => {
        const navigation = document.querySelectorAll(section ? '[data-surface-picker]' : 'main')
        expect(navigation.length, `${path} product entry points`).toBeGreaterThan(0)
        for (const container of navigation) {
          for (const product of products) {
            const expected = urlFor(`${port}/latest/${product}/`).pathname
            const links = [...container.querySelectorAll('a[href]')]
              .filter((entry) => new URL(entry.getAttribute('href')!, urlFor(path)).pathname === expected)
            if (!productAvailable(PORTS.find((entry) => entry.slug === port)!, product)) {
              expect(links, `${path} omits unavailable ${product}`).toEqual([])
              continue
            }
            expect(links.length, `${path} links to ${expected}`).toBeGreaterThan(0)
            // The home links a product from its tab panel too ("All tools by tier →"); one link must name it.
            const name = product === 'workspace' ? 'Workspace Manager' : 'MCP'
            const labels = links.map((link) => (section ? link.closest('[data-surface-group]')!.textContent : link.textContent) ?? '')
            expect(labels.some((label) => label.includes(name)), `${path} product label among ${JSON.stringify(labels)}`).toBe(true)
            for (const link of links) expect(resolves(link.getAttribute('href')!, urlFor(path).href), `${path} resolves ${expected}`).toBe(true)
          }
        }
        if (section) {
          expect(document.querySelector('[data-surface-picker] .surface-current .surface-label')?.textContent).toBe('Core Library')
          const current = document.querySelector('[data-surface-picker] [aria-current="location"]')
          expect(current?.getAttribute('href'), `${path} selected section`).toBe(urlFor(path).pathname)
          for (const nav of document.querySelectorAll('[data-section-navigation] nav')) {
            expect([...nav.querySelectorAll('a[href]')].some((link) => products.some((product) =>
              new URL(link.getAttribute('href')!, urlFor(path)).pathname.startsWith(urlFor(`${port}/latest/${product}/`).pathname))),
              `${path} section sidebar excludes other apps`).toBe(false)
          }
        }
        const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="preload"][as="font"][href]')]
          .map((asset) => asset.getAttribute('src') ?? asset.getAttribute('href')!)
        expect(assets.length, `${path} linked assets`).toBeGreaterThan(0)
        expect([...new Set(assets)].filter((href) => !resolves(href, urlFor(path).href)), `${path} missing assets`).toEqual([])
      })
    }
  })

  it('surfaces Ruby Async and Lua runtime domains without presenting Lua products as available', async () => {
    const domains = [
      { port: 'ruby', path: 'ruby/latest/', target: 'ruby/latest/guides/async/', label: 'Async', group: 'Companion packages' },
      { port: 'lua', path: 'lua/latest/', target: 'lua/latest/guides/runtime/', label: 'luv and Neovim', group: 'Runtime adapters' },
    ]
    for (const domain of domains) {
      await inspect(domain.path, (document) => {
        const link = [...document.querySelectorAll('main a[href]')]
          .find((entry) => new URL(entry.getAttribute('href')!, urlFor(domain.path)).pathname === urlFor(domain.target).pathname)
        expect(link, `${domain.path} ${domain.label} card`).toBeDefined()
        expect(link!.textContent, `${domain.path} ${domain.label} card label`).toContain(domain.label)
      })
      await inspect(domain.target, (document) => {
        const navigation = document.querySelector('[data-section-navigation] nav')
        expect(navigation, `${domain.target} port navigation`).toBeDefined()
        const links = [...navigation!.querySelectorAll('a[href]')]
          .filter((entry) => new URL(entry.getAttribute('href')!, urlFor(domain.target)).pathname === urlFor(domain.target).pathname)
        expect(links, `${domain.target} one visible domain destination`).toHaveLength(1)
        expect(links[0].textContent.trim()).toBe(domain.label)
        expect(links[0].getAttribute('aria-current')).toBe('page')
      })
    }
    await inspect('lua/latest/', (document) => {
      for (const product of products) {
        expect(document.querySelector(`main a[href="${urlFor(`lua/latest/${product}/`).pathname}"]`),
          `Lua landing omits unavailable ${product}`).toBeNull()
      }
    })
  })

  it('serves each documented product and section with the chosen port content', () => {
    for (const page of pages()) {
      const html = pageHtml(page.path)
      const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      expect(article, page.path).toBeDefined()
      const headings1 = [...article!.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => match[1]!)
      expect(headings1, page.path).toHaveLength(1)
      const source = documentsFor(page.port).get(`${page.product}${page.section ? `/${page.section}` : ''}`)!
      expect(text(headings1[0]!), page.path).toBe(headingTitle(source.data))
      const context = html.match(/<div\b[^>]*class="surface-picker-footer"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      expect(context, `${page.path} language and version context`).toBeDefined()
      expect(text(context!), page.path).toBe(`${page.name} · ${page.version} · en`)
      expect(tags(article!, 'p').length, `${page.path} substantive prose`).toBeGreaterThan(2)
      for (const [block] of article!.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>|<pre\b[^>]*>[\s\S]*?<\/pre>/gi)) {
        const language = attribute(tags(block, 'pre')[0] ?? '', 'data-language')?.toLowerCase()
        const owner = language && LANG_TO_PORT[language]
        const caption = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? ''
        const buildScript = page.port === 'java' && language === 'kotlin'
          && ['settings.gradle.kts', 'build.gradle.kts'].includes(text(caption))
        if (owner && !buildScript) expect(owner, `${page.path} foreign language example`).toBe(page.port)
      }
      const headings = [...article!.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((match) => text(match[1]!))
      for (const other of PORTS.filter((port) => port.slug !== page.port)) {
        expect(headings, `${page.path} leaked ${other.name} section`).not.toContain(other.name)
      }
      const hrefs = tags(html, 'a').map((tag) => attribute(tag, 'href')).filter((href): href is string => Boolean(href))
      expect(hrefs.filter((href) => new URL(href, urlFor(page.path)).origin === 'https://libtmux.org'
        && storageIdentity.test(href)),
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

  it('pairs the available product mark with its overview title', () => {
    for (const page of pages()) {
      const port = PORTS.find((entry) => entry.slug === page.port)!
      const html = pageHtml(page.path)
      const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      expect(article, page.path).toBeDefined()
      const expected = urlFor(`brand/${port.logoLanguage}/${page.product}/logo.svg`).pathname
      const logos = tags(article!, 'img').filter((tag) => attribute(tag, 'src') === expected)
      const overview = page.section === '' && productAvailable(port, page.product)
      expect(logos, `${page.path} overview mark`).toHaveLength(overview ? 1 : 0)
      if (!overview) continue
      const logo = logos[0]!
      expect(attribute(logo, 'width'), page.path).toBe('88')
      expect(attribute(logo, 'height'), page.path).toBe('88')
      expect(attribute(logo, 'alt'), page.path).toBe('')
      expect(article!.indexOf(logo), `${page.path} logo precedes title`).toBeLessThan(article!.indexOf('<h1'))
      expect(resolves(expected, urlFor(page.path).href), `${page.path} logo resolves`).toBe(true)
    }
  })

  it.each(PORTS.filter((port) => !port.parentLibrary && products.some((product) => port.productAvailability?.[product] === 'unpublished')))
    ('$name builds and lists only permitted unavailable-product pages', (port) => {
    const version = manifest().defaultVersion[port.slug]!
    const docs = JSON.parse(read(`${port.slug}/${version}/docs.json`)) as DocsManifest
    for (const product of products.filter((entry) => port.productAvailability?.[entry] === 'unpublished')) {
      // Whatever the product's other pages would be called, none is built or listed.
      const directory = sitePath(`${port.slug}/${version}/${product}`)
      const built = existsSync(directory) ? readdirSync(directory, { recursive: true }).map(String) : []
      expect(built.filter((file) => file.endsWith('.html') && file !== 'index.html'),
        `${port.slug} ${product} pages built outside its availability`).toEqual([])
      expect(pagesBeyondOverview(docs.pages, urlFor(`${port.slug}/${version}/${product}/`).pathname),
        `${port.slug} ${product} pages listed beyond the overview`).toEqual([])
      const advertised = docs.ports.find((entry) => entry.slug === port.slug)!.products.find((entry) => entry.slug === product)!
      expect(advertised.reference, `${port.slug} ${product} reference`).toBeNull()
      expect(built, `${port.slug} ${product} overview exists`).toContain('index.html')
      expect(advertised.availability, `${port.slug} ${product}`).toBe('unpublished')
    }
  })

  it('covers every registered port in the patterns that name ports', () => {
    for (const port of PORTS) {
      expect(storageIdentity.test(`/en/ports/${port.slug}/guides/`), `${port.slug} storage identity`).toBe(true)
      expect(localizedPortTree.test(`/ja/${port.slug}/latest/`), `${port.slug} localized tree`).toBe(true)
      if (!port.parentLibrary) expect(productUrl.test(`/en/${port.slug}/latest/mcp/`), `${port.slug} product URL`).toBe(true)
      const redirected = documentsFor(port.slug).has('workspace/internals/topics') && !documentsFor(port.slug).has('workspace/topics')
      expect(legacyWorkspaceTopics(`/en/${port.slug}/latest/workspace/topics/`), `${port.slug} legacy Topics`).toBe(redirected)
    }
    expect(productUrl.test('/en/elixir/latest/mcp/guides/')).toBe(true)
    expect(productUrl.test('/en/elixir/latest/guides/overview/')).toBe(false)
  })

  it('finds a listed page beneath a product overview whatever its name or trailing slash', () => {
    const overview = '/en/elixir/latest/mcp/'
    const listed = (...paths: string[]) => pagesBeyondOverview(paths.map((path) => ({ url: `https://libtmux.org${path}` })), overview)
    expect(listed('/en/elixir/latest/mcp/', '/en/elixir/latest/mcp', '/en/elixir/latest/', '/en/elixir/latest/mcp-notes/')).toEqual([])
    expect(listed('/en/elixir/latest/mcp/guides')).toEqual(['/en/elixir/latest/mcp/guides/'])
    expect(listed('/en/elixir/latest/mcp/guides/', '/en/elixir/latest/mcp/cookbook/step')).toEqual(['/en/elixir/latest/mcp/guides/', '/en/elixir/latest/mcp/cookbook/step/'])
  })

  it('opens a product overview with its install picker, then its section cards', async () => {
    let checked = 0
    for (const page of pages().filter((entry) => entry.section === '')) await inspect(page.path, (document) => {
      const install = document.querySelector('article h2#install')
      if (!install) return
      checked++
      // A workspace overview with several presets leads with the preset picker, which stands above the install.
      // An MCP overview with a worked example leads with it, then install: the reader sees the server work before choosing a client.
      const presets = document.querySelector('article section.ws-picker h2#explore-tmux-layout-workspace-possibilities')
      // A workspace overview with one example has no picker, so that example leads, then install.
      const example = page.product === 'mcp'
        ? document.querySelector('article h2#tmux-through-mcp')
        : presets ? null : document.querySelector('article h2#example-workspaces')
      const first = presets ? 'explore-tmux-layout-workspace-possibilities' : example ? example.id : 'install'
      expect(document.querySelector('article h2')?.id, `${page.path} ${first} is the first section`).toBe(first)
      if (presets) expect(presets.compareDocumentPosition(install) & 4, `${page.path} install follows the preset picker`).toBeTruthy()
      if (example) expect(example.compareDocumentPosition(install) & 4, `${page.path} install follows the ${example.id}`).toBeTruthy()
      if (page.product === 'workspace') expect(document.querySelectorAll('article h2#example-workspaces').length, `${page.path} shows its examples once`).toBeLessThanOrEqual(1)
      for (const card of document.querySelectorAll('article .doc-card')) {
        expect(install.compareDocumentPosition(card) & 4, `${page.path} cards follow install`).toBeTruthy()
      }
    })
    expect(checked, 'overviews with an install picker').toBeGreaterThan(0)
  }, 30_000)

  it.each(PORTS.filter((port) => !port.parentLibrary))('$name distinguishes unfinished products and groups workspace internals', async (port) => {
    for (const page of pages().filter((entry) => entry.port === port.slug)) await inspect(page.path, (document) => {
      if (productIsConcept(port, page.product) || productInDevelopment(port, page.product))
        developmentStatus(document, page.path, productIsConcept(port, page.product))
      const picker = document.querySelector('[data-surface-picker]')
      if (!productAvailable(port, page.product)) {
        expect(document.querySelector('article')!.textContent, `${page.path} availability`).toMatch(/not\s+published|no\s+published/i)
        expect(picker?.querySelector('.surface-current .surface-label')?.textContent, `${page.path} available app`).toBe('Core Library')
        expect(picker?.querySelector('.surface-current small')?.textContent, `${page.path} available section`).toBe('Home')
        const current = picker?.querySelectorAll('[aria-current="location"]')
        expect(current, `${page.path} one available destination`).toHaveLength(1)
        expect(current![0].getAttribute('href'), `${page.path} core overview`).toBe(urlFor(`${page.port}/${page.version}/core/`).pathname)
        expect(resolves(current![0].getAttribute('href')!), `${page.path} core overview exists`).toBe(true)
        const unavailable = urlFor(`${page.port}/${page.version}/${page.product}/`).pathname
        const navigation = document.querySelectorAll('[data-surface-picker] a[href], [data-section-navigation] a[href], .doc-card[href]')
        expect([...navigation].some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname.startsWith(unavailable)),
          `${page.path} unavailable product omitted from navigation`).toBe(false)
        return
      }
      const surface = page.product === 'mcp' ? 'MCP' : 'Workspace Manager'
      if (sourceGuide(page.port, 'workspace') && page.product === 'workspace' && page.section === '') {
        expect(document.querySelector('[data-workspace-coming]'), `${page.path} native examples already documented`).toBeNull()
        const guide = urlFor(`${page.port}/${page.version}/workspace/source-guide/`).pathname
        expect([...document.querySelectorAll('article a[href]')].some((link) =>
          new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === guide), `${page.path} native example guide`).toBe(true)
      }
      const section = page.section === 'source-guide' ? 'guides' : page.section.split('/')[0] || 'home'
      const sectionLabel = section === 'reference' ? 'API Reference' : section[0].toUpperCase() + section.slice(1)
      expect(picker?.querySelector('.surface-current .surface-label')?.textContent, `${page.path} current app`).toBe(surface)
      expect(picker?.querySelectorAll('.surface-current .status-badge').length).toBe(1)
      expect(picker?.querySelector('.surface-current .status-badge')?.getAttribute('data-status'), `${page.path} badge`)
        .toBe(productStatus(port, page.product, REGISTRY))
      expect(picker?.querySelector('.surface-current small')?.textContent, `${page.path} current section`).toBe(sectionLabel)
      const current = picker?.querySelectorAll('[aria-current="location"]')
      expect(current, `${page.path} one current section`).toHaveLength(1)
      const sourceGuideSection = page.section === 'source-guide' && !sectionsFor(page.port, page.product).includes('guides')
      const sectionPath = `${page.port}/${page.version}/${page.product}/${sourceGuideSection ? 'source-guide/' : section === 'home' ? '' : `${section}/`}`
      expect(current![0].getAttribute('href'), `${page.path} current destination`).toBe(urlFor(sectionPath).pathname)
      expect(resolves(current![0].getAttribute('href')!), `${page.path} current destination exists`).toBe(true)
      // The API reference is the reference sidebar, one navigation for every viewport; the other sections share the section sidebar.
      const navigation = document.querySelectorAll(section === 'reference' ? '.api-nav nav' : '[data-section-navigation] nav')
      expect(navigation.length, `${page.path} documentation navigation`).toBeGreaterThan(0)
      if (section === 'reference') expect(navigation, `${page.path} one reference navigation`).toHaveLength(1)
      for (const nav of navigation) {
        expect(nav.getAttribute('aria-label'), page.path).toBe(`${surface}: ${sectionLabel}`)
        const links = [...nav.querySelectorAll('a[href]')]
        expect(links.length, `${page.path} current section pages`).toBeGreaterThan(0)
        const sourceGuidePath = sourceGuide(page.port, page.product) && section === 'guides'
          ? urlFor(`${page.port}/${page.version}/${page.product}/source-guide/`).pathname : undefined
        if (sourceGuidePath) {
          const guides = links.filter((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === sourceGuidePath)
          expect(guides, `${page.path} native guide`).toHaveLength(1)
          expect(guides[0].textContent.trim()).toBe(page.product === 'mcp' ? 'MCP server guide' : 'Workspace guide')
        }
        for (const link of links) {
          const href = link.getAttribute('href')!
          const path = new URL(href, urlFor(page.path)).pathname
          if (section === 'reference') {
            const prefix = urlFor(`${page.port}/${page.version}/${page.product}/`).pathname
            expect(path.startsWith(prefix), `${page.path} reference stays in its app`).toBe(true)
            expect(page.product === 'mcp' ? ['reference'] : ['reference', 'cli'], `${page.path} reference kinds`)
              .toContain(path.slice(prefix.length).split('/')[0])
          } else if (path !== sourceGuidePath) expect(path, `${page.path} scoped sidebar`).toContain(urlFor(sectionPath).pathname)
          expect(resolves(href, urlFor(page.path).href), `${page.path} sidebar destination ${href}`).toBe(true)
        }
        if (page.product === 'mcp' && page.section === 'reference' && productAvailable(port, 'mcp')) {
          for (const section of Object.keys(MCP_SECTIONS)) {
            const target = urlFor(`${page.port}/${page.version}/mcp/${section}/`).pathname
            const count = mcpObjects(page.port).filter((object) => object.section === section).length
            expect([...picker!.querySelectorAll('a[href]')].some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === target),
              `${page.path} ${section} picker destination`).toBe(count > 0)
            if (!count) expect([...picker!.querySelectorAll('[aria-disabled="true"]')].some((entry) => entry.textContent.includes(MCP_SECTIONS[section as keyof typeof MCP_SECTIONS])),
              `${page.path} empty ${section} disabled`).toBe(true)
            expect(resolves(target, urlFor(page.path).href), target).toBe(true)
          }
        } else if (page.product === 'workspace' && section === 'internals' && productAvailable(port, 'workspace')) {
          const hrefs = links
            .map((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname)
          for (const section of sectionsFor(page.port, 'workspace').filter((entry) => entry.startsWith('internals'))) {
            expect(hrefs, `${page.path} ${section} navigation`).toContain(urlFor(`${page.port}/${page.version}/workspace/${section}/`).pathname)
          }
        }
      }
      if (page.product === 'workspace' && sectionsFor(page.port, 'workspace').includes('internals')) {
        expect([...picker!.querySelectorAll('a[href]')].some((link) => link.getAttribute('href') === urlFor(`${page.port}/${page.version}/workspace/internals/`).pathname),
          `${page.path} Internals remains reachable in the picker`).toBe(true)
      }
      if (page.product === 'workspace' && port.workspaceCli && productInDevelopment(port, 'workspace') && !page.section) {
        const status = [...document.querySelectorAll('[role="note"]')]
          .map((note) => note.textContent ?? '')
          .find((text) => /concept example/i.test(text))
        expect(status, `${page.path} concept scope`).toBeDefined()
        const article = document.querySelector('article')!.textContent
        if (port.workspaceCliAvailability === 'local') {
          expect(article, `${page.path} source installation`).toContain(port.workspaceCliRun
            ? 'from a source checkout; the installation guide lists the setup'
            : 'from the source revision in the installation guide')
        }
        expect(article, `${page.path} native CLI`).toContain(port.workspaceCli.split(/\s+/)[0])
        expect(article.match(/concept example/gi), `${page.path} states scope once`).toHaveLength(1)
        const links = [...document.querySelectorAll('article a[href]')]
        const installation = documentsFor(page.port).has('workspace/guides/installation') ? 'guides/installation' : 'source-guide'
        expect(links.some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === urlFor(`${page.port}/${page.version}/workspace/${installation}/`).pathname), `${page.path} native installation`).toBe(true)
        expect(links.some((link) => link.getAttribute('href') === 'https://tmuxp.git-pull.com/'), `${page.path} foreign installation`).toBe(false)
      }
    })
  })

  it.each(primaryPorts)('$name links generated declarations and schema-bearing tools inside their product', async (port) => {
    for (const page of pages().filter((entry) => entry.section === 'reference'
      && entry.port === port.slug && productAvailable(port, entry.product))) {
      const concept = productIsConcept(port, page.product)
      const prefix = `${page.port}/${page.version}/${page.product}/${page.section}/`
      const declarations = await declarationIndex(page.path)
      expect(declarations.length, `${page.path} generated declarations`).toBeGreaterThan(0)
      for (const declaration of declarations) {
        expect(new URL(declaration.href, urlFor(page.path)).pathname).toMatch(new RegExp(`^/${SITE_PREFIX}${prefix}[^/]+/$`))
        expect(resolves(declaration.href, urlFor(page.path).href), declaration.href).toBe(true)
      }
      const sample = declarations[0]
      const samplePath = new URL(sample.href, urlFor(page.path)).pathname.slice(SITE_PREFIX.length + 1)
      await inspect(samplePath, (document) => {
        expect(document.querySelector('article h1')?.textContent).toBe(sample.title)
        expect(graph(document).some((entry) => entry['@type'] === 'APIReference')).toBe(true)
        const trail = referenceTrail(document, new URL(sample.href, urlFor(page.path)).pathname)
        if (page.product === 'workspace') {
          const reference = urlFor(page.path).pathname
          const expected = [
            { name: page.name, url: urlFor(`${page.port}/${page.version}/`).pathname },
            { name: 'Workspace Manager', url: urlFor(`${page.port}/${page.version}/workspace/`).pathname },
            { name: 'API reference', url: reference },
            ...trail,
          ]
          const crumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
          expect(crumbs.map((item) => item.textContent.trim()), `${samplePath} sidebar ancestry`)
            .toEqual(expected.map((item) => item.name))
          for (const [index, crumb] of crumbs.entries()) {
            expect(crumb.getAttribute('href'), `${samplePath} ancestor destination`)
              .toBe(index === crumbs.length - 1 ? null : expected[index].url)
            if (expected[index].url) expect(resolves(expected[index].url!, urlFor(samplePath).href)).toBe(true)
          }
          expect(crumbs.at(-1)?.getAttribute('aria-current')).toBe('page')
          expect(graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')?.itemListElement)
            .toEqual(expected.filter((item) => item.url).map((item, index) => ({
              '@type': 'ListItem', position: index + 1, name: item.name,
              item: new URL(item.url!, 'https://libtmux.org').href,
            })))
        }
        if (concept || productInDevelopment(port, page.product)) developmentStatus(document, samplePath, concept)
      })
      if (page.product !== 'mcp') continue
      const toolsPath = `${page.port}/${page.version}/mcp/tools/`
      const tools = await inspect(toolsPath, (document) => {
        developmentStatus(document, toolsPath, concept)
        return [...document.querySelectorAll('.api-index-card[id] > .api-index-card__link[href]')].map((link) => link.getAttribute('href')!)
      })
      expect(tools.length, `${toolsPath} protocol tools`).toBeGreaterThan(0)
      for (const href of tools) {
        expect(new URL(href, urlFor(toolsPath)).pathname).toMatch(new RegExp(`^/${SITE_PREFIX}${toolsPath}[^/]+/$`))
        expect(resolves(href, urlFor(toolsPath).href), href).toBe(true)
      }
      const toolPath = new URL(tools[0], urlFor(toolsPath)).pathname.slice(SITE_PREFIX.length + 1)
      await inspect(toolPath, (document) => {
        developmentStatus(document, toolPath, concept)
        const input = [...document.querySelectorAll('details')]
          .find((detail) => detail.querySelector('summary')?.textContent === 'Input schema')
        expect(input, `${toolPath} input schema`).toBeDefined()
        expect(() => JSON.parse(input!.querySelector('code')!.textContent)).not.toThrow()
        expect(document.querySelector('.api-reference-content h1 code')?.textContent).toBe(toolPath.split('/').at(-2))
      })
    }
  })

  // A port reads every page of its MCP reference in one test, so the work grows with the reference and the largest port
  // leaves little of the default deadline on a slower runner. The deadline is not what the test is about; the assertions are.
  it.each(Object.keys(MCP_REFERENCE))('%s lists all advertised protocol objects in the section menu', async (port) => {
    const version = manifest().defaultVersion[port]
    expect(version, `${port} default version`).toBeDefined()
    for (const [section, label] of Object.entries(MCP_SECTIONS)) {
      const index = `${port}/${version}/mcp/${section}/`
      const objects = mcpObjects(port).filter((object) => object.section === section)
      await inspect(index, (document) => {
        expect(document.querySelector('main .api-reference-layout'), `${index} shared layout`).not.toBeNull()
        // The menu the Guides pages use, not the API browser: the protocol section is its context.
        expect(document.querySelector('.api-nav, [data-api-nav-toggle]'), `${index} has no API browser`).toBeNull()
        expect(document.querySelector('[data-section-navigation] input[data-section-search]'), `${index} searchable menu`).not.toBeNull()
        expect(document.querySelector('[data-section-navigation] nav')?.getAttribute('aria-label'), `${index} menu context`).toBe(`MCP: ${label}`)
        expect(document.querySelector('[data-section-navigation] [aria-current="page"]')?.textContent?.trim(), `${index} current row`).toBe('Overview')
        expect(document.querySelector('#mobile-sidebar [data-section-navigation]'), `${index} drawer menu`).not.toBeNull()
        expect(document.querySelector('.api-reference-content h1')?.textContent).toBe(label)
        const links = [...document.querySelectorAll('.api-index-card[id] > .api-index-card__link[href]')]
        expect(links.map((link) => new URL(link.getAttribute('href')!, urlFor(index)).pathname).sort())
          .toEqual(objects.map((object) => urlFor(`${port}/${version}/${object.path}/`).pathname).sort())
        if (!objects.length) expect(document.querySelector('.api-reference-content')?.textContent).toContain(`does not advertise ${section}`)
      })
      for (const object of objects) await inspect(`${port}/${version}/${object.path}/`, (document) => {
        expect(document.querySelector('main .api-reference-layout--symbol'), object.id).not.toBeNull()
        const row = document.querySelector('[data-section-navigation] nav [aria-current="page"]')
        expect(row?.textContent?.trim(), `${object.id} current row`).toBe(object.name)
        expect(row?.closest('details.sidebar-section')?.querySelector(':scope > summary')?.textContent?.trim(), `${object.id} group`).toBe(mcpObjectGroup(object))
        expect(document.querySelector('.api-reference-content h1 code')?.textContent).toBe(object.name)
        const declaration = document.getElementById(object.id)
        expect(declaration?.getAttribute('data-domain')).toBe('mcp')
        expect(declaration?.getAttribute('data-objtype')).toBe(object.kind)
        expect(document.querySelector('nav.api-section-links'), `${object.id} section navigation`).not.toBeNull()
        for (const suffix of ['parameters', 'result', 'schemas']) expect(document.getElementById(`${object.id}.${suffix}`), `${object.id}.${suffix}`).not.toBeNull()
        const contract = [...document.querySelectorAll('details')].find((detail) => detail.querySelector('summary')?.textContent === (object.tool ? 'Input schema' : 'Registration'))!
        expect(JSON.parse(contract.querySelector('code')!.textContent)).toEqual(object.tool?.inputSchema ?? object.item)
      })
    }
  }, 30_000)

  it.each(primaryPorts.map((port) => port.slug))('switches to equivalent sections and the tmux documentation for %s', async (slug) => {
    const defaults = manifest().defaultVersion
    for (const page of pages().filter((entry) => entry.port === slug && entry.section !== 'source-guide')) await inspect(page.path, (document) => {
      const links = [...document.querySelectorAll('[data-page-port-switcher] a[data-port][href]')]
      const tmux = document.querySelector('[data-page-port-switcher] .tmux-area a[href]')
      expect(tmux?.getAttribute('href'), `${page.path} tmux destination`).toBe(urlFor('tmux/').pathname)
      const counterparts = new Map([...counterpartRoutes(page.port, `${page.product}${page.section ? `/${page.section}` : ''}`)].map(([port, routes]) => [port,
        routes.map((route) => urlFor(`${port}/${port === page.port ? page.version : defaults[port]}/${route}/`).pathname),
      ]))
      expect(links.length, `${page.path} port counterparts`).toBe([...counterparts.values()].flat().length)
      for (const port of PORTS) {
        const expected = counterparts.get(port.slug)
        if (expected) {
          for (const href of expected) {
            expect(links.some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname === href),
              `${page.path} counterpart ${href}`).toBe(true)
            expect(resolves(href), `${page.path} counterpart exists at ${href}`).toBe(true)
          }
        } else {
          const unavailable = document.querySelector(`[data-page-port-switcher] .doc-picker-option--unmatched[data-port="${port.slug}"]`)
          expect(unavailable?.textContent, `${page.path} unavailable ${port.name}`).toContain('No matching page')
          const home = unavailable?.querySelector('a[data-picker-home]')?.getAttribute('href')
          expect(home, `${page.path} ${port.name} home exit`).toBeDefined()
          if (!productAvailable(port, page.product)) {
            const version = port.slug === page.port ? page.version : defaults[port.slug]
            expect(home, `${page.path} unavailable product uses core home`).toBe(urlFor(`${port.slug}/${version}/`).pathname)
          }
          expect(resolves(home!, urlFor(page.path).href), `${page.path} ${port.name} home exists`).toBe(true)
        }
      }
    })
  })

  it.each(primaryPorts.map((port) => port.slug))('matches visible breadcrumbs to structured data for %s', async (slug) => {
    for (const page of pages().filter((entry) => entry.port === slug)) await inspect(page.path, (document) => {
      const crumb = document.querySelector('nav[aria-label="Breadcrumb"]')!
      expect(crumb, page.path).not.toBeNull()
      const labels = [...crumb.querySelectorAll('a[data-breadcrumb-item], [data-breadcrumb-item][aria-current="page"]')].map((item) => item.textContent.trim())
      const structured = graph(document).find((entry) => entry['@type'] === 'BreadcrumbList')
      expect(structured?.itemListElement?.map((item) => item.name), page.path).toEqual(labels)
      expect(labels[0]).toBe(page.name)
      expect(labels[1]).toBe(page.product === 'mcp' ? 'MCP' : 'Workspace Manager')
      if (page.section.startsWith('internals/')) expect(labels[2]).toBe('Internals')
      for (const item of structured!.itemListElement!) if (item.item) expect(resolves(item.item), item.item).toBe(true)
      expect(new URL(structured!.itemListElement!.at(-1)!.item).pathname).toBe(urlFor(page.path).pathname)
    })
  })

  it.each(primaryPorts.flatMap((port) => products.filter((product) => sourceGuide(port.slug, product))
    .map((product) => [port.slug, product] as const)))('switches from the native %s %s source guide to verified task counterparts', async (port, product) => {
    const defaults = manifest().defaultVersion
    const routes = counterpartRoutes(port, `${product}/source-guide`)
    const path = `${port}/${defaults[port]}/${product}/source-guide/`
    await inspect(path, (document) => {
      const links = [...document.querySelectorAll('[data-page-port-switcher] a[data-port][href]')]
      expect(links.map((link) => new URL(link.getAttribute('href')!, urlFor(path)).pathname).sort()).toEqual(
        [...routes].flatMap(([slug, paths]) => paths.map((route) => urlFor(`${slug}/${defaults[slug]}/${route}/`).pathname)).sort(),
      )
      for (const link of links) expect(resolves(link.getAttribute('href')!, urlFor(path).href)).toBe(true)
    })
  })

  it('redirects legacy workspace Topics without replacing Python CLI docs', async () => {
    // Guides and Examples now browse the native CLI documentation. The old
    // Topics route still redirects to the builder's internal topics.
    for (const page of pages().filter((entry) => entry.product === 'workspace'
      && entry.port !== 'py' && entry.section === 'internals/topics')) {
      await redirectsTo(page.path.replace('/internals/', '/'), page.path)
    }
    for (const page of pages().filter((entry) => entry.port === 'py' && entry.product === 'workspace'
      && ['guides', 'examples'].includes(entry.section))) await inspect(page.path, (document) => {
      expect(document.querySelector('meta[http-equiv="refresh"]'), `${page.path} remains a user guide`).toBeNull()
      expect(document.querySelector('article')!.textContent, `${page.path} CLI usage`).toContain('tmuxp load')
    })
  })

  it.each(PORTS.filter((port) => !port.parentLibrary && productAvailable(port, 'workspace')
    && KNOWN_PORTS.has(port.slug) && port.workspaceCliAvailability === 'local'))
    ('$name publishes workspace Guides and Examples browse pages', async (port) => {
    for (const page of pages().filter((entry) => entry.product === 'workspace'
      && entry.port === port.slug && ['guides', 'examples'].includes(entry.section))) await inspect(page.path, (document) => {
      expect(document.querySelector('meta[http-equiv="refresh"]'), `${page.path} is a browse page`).toBeNull()
      expect(document.querySelector('[data-pagefind-body]'), `${page.path} is searchable`).not.toBeNull()
      expect(document.querySelector('h1')?.textContent?.trim(), page.path).toBe(page.section === 'guides' ? 'Guides' : 'Examples')
      expect(document.querySelector('.surface-picker-footer')?.textContent?.trim(), page.path).toBe(`${page.name} · ${page.version} · en`)
      const cards = [...document.querySelectorAll('article .doc-card[href]')]
      expect(cards.length, `${page.path} published tasks`).toBeGreaterThan(0)
      for (const card of cards) {
        const href = card.getAttribute('href')!
        expect(resolves(href, urlFor(page.path).href), `${page.path} task ${href}`).toBe(true)
        expect(new URL(href, urlFor(page.path)).pathname).toContain(urlFor(`${page.port}/${page.version}/workspace/`).pathname)
      }
      expect([...document.querySelectorAll('article a[href]')].some((link) => new URL(link.getAttribute('href')!, urlFor(page.path)).pathname.startsWith(urlFor(`${page.port}/${page.version}/workspace/internals/`).pathname)),
        `${page.path} keeps builder documentation reachable`).toBe(true)
    })
  })

  it('canonicalizes each version and loads nested search from the locale index', async () => {
    const defaults = manifest().defaultVersion
    for (const page of pages()) {
      const html = pageHtml(page.path)
      const links = tags(html, 'link')
      const canonical = links.find((tag) => attribute(tag, 'rel') === 'canonical')
      const expected = `${page.port}/${defaults[page.port]}/${page.product}/${page.section ? `${page.section}/` : ''}`
      expect(canonical && attribute(canonical, 'href'), page.path).toBe(urlFor(expected).href)
      const robotsTag = tags(html, 'meta').find((tag) => attribute(tag, 'name') === 'robots')
      const robots = robotsTag && attribute(robotsTag, 'content')
      expect(robots, page.path).toBe(PREVIEW_PREFIX ? 'noindex, nofollow' : page.version === defaults[page.port] ? 'index, follow' : 'noindex, follow')
      if (PREVIEW_PREFIX && page.version === defaults[page.port]) {
        const production = readFileSync(productionPath('en', page.path, 'index.html'), 'utf8')
        const meta = tags(production, 'meta').find((tag) => attribute(tag, 'name') === 'robots')
        expect(meta && attribute(meta, 'content'), `${page.path} production indexing`).toBe('index, follow')
        const canonical = tags(production, 'link').find((tag) => attribute(tag, 'rel') === 'canonical')
        expect(canonical && attribute(canonical, 'href'), `${page.path} production canonical`).toBe(`https://libtmux.org/en/${page.path}`)
      }
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
      const coverage = readFileSync(publishedPath(`${PREVIEW_PREFIX}/${locale}/meta/translations/index.html`), 'utf8')
      expect(coverage.match(/href="\/(?:pr-\d+\/)?(?:en|ja)\/(?:ports|_staged)\/[^"]*"/g),
        `${locale} coverage links to published shared pages`).toBeNull()
    }
  })

  it('exports real product URLs, resolved examples, and canonical sitemap entries', () => {
    const defaults = manifest().defaultVersion
    const index = JSON.parse(read('docs.json')) as DocsManifest
    const llms = read('llms.txt')
    const sitemapFiles = [...readFileSync(productionPath('en/sitemap-index.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname)
    const sitemap = sitemapFiles.map((path) => readFileSync(productionPath(path), 'utf8')).join('\n')
    for (const page of pages().filter((entry) => entry.version === defaults[entry.port])) {
      const url = urlFor(page.path).href
      expect(index.pages.some((entry) => entry.url === url), `${url} in docs.json`).toBe(true)
      expect(llms, `${url} in llms.txt`).toContain(`](${url})`)
      const productionUrl = `https://libtmux.org/en/${page.path}`
      expect(sitemap, `${productionUrl} in sitemap`).toContain(`<loc>${productionUrl}</loc>`)
      if (page.product === 'workspace' && page.port !== 'py' && page.section === 'internals/topics') {
        const legacy = productionUrl.replace('/workspace/internals/', '/workspace/')
        expect(sitemap, `${legacy} redirect is not canonical`).not.toContain(`<loc>${legacy}</loc>`)
      }
    }
    const exportRoots = new Set(['', ...pages().map((page) => `${page.port}/${page.version}/`)])
    for (const root of exportRoots) {
      const body = read(`${root}llms-full.txt`)
      expect(body, `${root} resolved file inclusions`).not.toMatch(/```[^\n]*file="[^"\n]+"[^\n]*\n\s*```/)
      const exported = JSON.parse(read(`${root}docs.json`)) as DocsManifest
      const [rootPort, rootVersion] = root.split('/')
      const visiblePorts = PORTS.filter((port) => !rootPort || port.slug === rootPort)
      expect(exported.ports.map((port) => port.slug), `${root} port scope`).toEqual(visiblePorts.map((port) => port.slug))
      for (const port of visiblePorts) {
        const advertised = exported.ports.find((entry) => entry.slug === port.slug)!
        if (port.parentLibrary) {
          expect(advertised.products, `${port.slug} is library-only`).toEqual([])
          continue
        }
        for (const product of products) {
          const metadata = advertised.products.find((entry) => entry.slug === product)!
          if (port.productAvailability?.[product] === 'excluded') {
            expect(metadata, `${root}${port.slug} ${product} excluded metadata`).toBeUndefined()
            expect(advertised.documentation.map((area) => area.id), `${root}${port.slug} ${product} excluded navigation`).not.toContain(product)
            const path = `${port.slug}/${rootVersion || defaults[port.slug]}/${product}/`
            const prefix = urlFor(path).pathname
            // A product root that was public answers with a noindex redirect to the language home; nothing else is built.
            const retired = sourceGuideRedirectsFor(port.slug).some((entry) => entry.path === product)
            const tree = existsSync(sitePath(path)) ? readdirSync(sitePath(path), { recursive: true }).map(String) : []
            expect(tree, `${root}${port.slug} ${product} excluded tree`).toEqual(retired ? ['index.html'] : [])
            if (tree.length) expect(read(`${path}index.html`), `${root}${port.slug} ${product} retired redirect`).toMatch(/name="robots" content="noindex"/)
            expect(exported.pages.filter((entry) => {
              const pathname = new URL(entry.url).pathname
              return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)
            }), `${root}${port.slug} ${product} excluded pages`).toEqual([])
            expect(read(`${root}llms.txt`), `${root}${port.slug} ${product} excluded agent links`)
              .not.toMatch(new RegExp(`/${port.slug}/[^/]+/${product}(?:/|\\))`))
            continue
          }
          expect(metadata, `${root}${port.slug} ${product} metadata`).toBeDefined()
          expect(metadata.availability, `${root}${port.slug} ${product} availability`).toBe(port.productAvailability?.[product] ?? 'available')
          expect(resolves(metadata.url!, urlFor(root).href), `${root}${port.slug} ${product} overview`).toBe(true)
          expect(metadata.inDevelopment, `${root}${port.slug} ${product} development status`).toBe(productInDevelopment(port, product))
          if (productIsConcept(port, product)) {
            expect(metadata.support).toBe('concept')
            expect(metadata.supportDescription).toBe(CONCEPT_DESCRIPTION)
          } else expect(metadata.support).toBeUndefined()
          const section = 'reference'
          if (productAvailable(port, product)) {
            expect(new URL(metadata.reference!, urlFor(root)).pathname).toBe(urlFor(`${port.slug}/${rootVersion || defaults[port.slug]}/${product}/${section}/`).pathname)
          } else expect(metadata.reference).toBeNull()
          if (product === 'workspace') {
            expect(metadata.cli, `${root}${port.slug} user CLI`).toBe(port.workspaceCli ?? null)
            expect(metadata.cliAvailability, `${root}${port.slug} CLI availability`).toBe(port.workspaceCliAvailability ?? null)
          } else if (productAvailable(port, 'mcp')) expect(resolves(metadata.protocol!, urlFor(root).href), `${root}${port.slug} MCP protocol`).toBe(true)
          else expect(metadata.protocol).toBeNull()
        }
      }
      const ruby = exported.ports.find((entry) => entry.slug === 'ruby')
      if (ruby) expect(ruby.documentation).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'async', kind: 'companion-package', availability: 'available', package: 'libtmux-async' }),
      ]))
      const lua = exported.ports.find((entry) => entry.slug === 'lua')
      if (lua) {
        expect(lua.documentation).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'runtime', kind: 'runtime', availability: 'available' }),
        ]))
        expect(lua.documentation.map((area) => area.id)).not.toContain('mcp')
        expect(lua.documentation.map((area) => area.id)).not.toContain('workspace')
      }
      for (const area of exported.ports.flatMap((port) => port.documentation)) {
        expect(resolves(area.url, urlFor(root).href), `${root}${area.url} documentation area`).toBe(true)
      }
      for (const entry of exported.pages.filter((entry) => productUrl.test(entry.url))) {
        expect(resolves(entry.url), entry.url).toBe(true)
        expect(resolves(entry.markdownUrl), entry.markdownUrl).toBe(true)
        expect(entry.url, `${root} canonical workspace API exports`).not.toMatch(/\/workspace\/api(?:\/|$)/)
        expect(legacyWorkspaceTopics(entry.url), `${root} legacy workspace Topics redirect excluded`).toBe(false)
        if (root) expect(new URL(entry.url).pathname).toContain(`/${SITE_PREFIX}${root}`)
      }
    }
    const japanese = publishedPath(`${PREVIEW_PREFIX}/ja/docs.json`)
    expect(existsSync(japanese), 'Japanese assembled manifest').toBe(true)
    const translated = JSON.parse(readFileSync(japanese, 'utf8')) as { pages: { url: string }[] }
    expect(translated.pages.map((entry) => new URL(entry.url).pathname)
      .filter((path) => localizedPortTree.test(path)),
    'Japanese manifest does not invent localized port guides').toEqual([])
    for (const entry of translated.pages.filter((entry) => productUrl.test(entry.url))) {
      expect(new URL(entry.url).pathname, entry.url).not.toMatch(localizedPortTree)
      expect(resolves(entry.url), entry.url).toBe(true)
    }
  })
})

describe('Lisp workspace notice', () => {
  // `mise` only launches the checkout's script; it is not something to build.
  it('names the command a checkout runs, not its launcher', () => {
    const lisp = PORTS.find((port) => port.slug === 'lisp')!
    const body = workspaceOverviewNotice(lisp)!.body
    expect(body).toContain('Run `bin/libtmux-workspace` from a source checkout')
    expect(body).not.toMatch(/Build|`mise`/)
  })
})
