import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { MOVED_PAGES, docsRoutePath, movedPageRedirects, redirectDestination } from '../src/lib/docs-paths'
import { PORTS, PRODUCT_STATUS_GUIDE } from '../src/lib/ports'
import { getSidebar, type SidebarItem } from '../src/lib/sidebar'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

const PAGES = fileURLToPath(new URL('../src/pages/', import.meta.url))
const CONTENT = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const SLUG_ROUTE = join(PAGES, '[...slug].astro')

const scratch: string[] = []
afterEach(() => {
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  vi.mocked(getCollection).mockResolvedValue([])
})

/** Markdown files below a content directory, as collection ids and their front matter. */
function contentEntries(root: string, skip = ['ja']): CollectionEntry<'docs'>[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => /\.mdx?$/.test(file) && !skip.includes(file.split('/')[0]!))
    .map((file) => {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(root, file), 'utf8'))?.[1] ?? ''
      const field = (name: string) => new RegExp(`^${name}:\\s*['"]?([^'"\\r\\n]+?)['"]?\\s*$`, 'm').exec(frontmatter)?.[1]
      const nested = (name: string) => new RegExp(`^  ${name}:\\s*['"]?([^'"\\r\\n]+?)['"]?\\s*$`, 'm').exec(frontmatter)?.[1]
      const order = nested('order')
      return {
        id: file.replace(/\.mdx?$/, '').replace(/\/index$/, ''),
        data: {
          title: field('title') ?? file,
          port: field('port'),
          product: field('product'),
          route: field('route'),
          sidebar: { group: nested('group'), label: nested('label'), order: order === undefined ? undefined : Number(order) },
        },
      } as unknown as CollectionEntry<'docs'>
    })
}

/** A route's page file: an Astro page, or a Markdown page in the docs collection. */
const hasSource = (route: string) => existsSync(join(PAGES, `${route || 'index'}.astro`))
  || (route !== '' && existsSync(join(CONTENT, `${route}.md`)))

const hrefs = (items: SidebarItem[]): string[] => items.flatMap((item) =>
  item.type === 'link' ? [item.href] : [...(item.href ? [item.href] : []), ...hrefs(item.items)])

describe('the moved concept page', () => {
  const OLD = 'tmux/guides/concept-examples'

  it('redirects the old URL to the support page in the root build only', () => {
    expect(movedPageRedirects()).toContainEqual({ path: OLD, target: 'meta/support' })
    expect(movedPageRedirects('py')).toEqual([])
    for (const { target } of MOVED_PAGES) expect(hasSource(target), target).toBe(true)
  })

  it('is no longer a tmux page', () => {
    const routes = contentEntries(CONTENT).map((entry) => docsRoutePath(entry))
    expect(routes).not.toContain(OLD)
    for (const { path } of MOVED_PAGES) expect(routes, path).not.toContain(path)
    expect(existsSync(join(CONTENT, 'guides/concept-examples.md'))).toBe(false)
  })

  it('has no tmux sidebar entry, and the check sees the old entry when it returns', async () => {
    const entries = contentEntries(CONTENT)
    vi.mocked(getCollection<'docs'>).mockImplementation(async (_collection, filter) => entries.filter((entry) => !filter || filter(entry)))
    const clean = hrefs(await getSidebar(undefined, 'latest'))
    expect(clean).toContain('/tmux/guides/getting-started/')
    expect(clean.filter((href) => /concept-examples|\/support\//.test(href))).toEqual([])

    // The page as it was: a Guides entry in the shared collection.
    const old = { id: 'guides/concept-examples', data: { title: 'Concept examples', sidebar: { group: 'Guides', order: 90 } } } as unknown as CollectionEntry<'docs'>
    vi.mocked(getCollection<'docs'>).mockImplementation(async (_collection, filter) => [...entries, old].filter((entry) => !filter || filter(entry)))
    expect(hrefs(await getSidebar(undefined, 'latest'))).toContain('/tmux/guides/concept-examples/')
  })

  it('keeps the badge cards pointed at a section the support page has', () => {
    const resolves = (guide: string) => {
      const [path, fragment] = guide.replace(/^\/|\/$/g, '').split('/#')
      return existsSync(join(PAGES, `${path}.astro`)) && readFileSync(join(PAGES, `${path}.astro`), 'utf8').includes(`id="${fragment}"`)
    }
    expect(PRODUCT_STATUS_GUIDE).toBe('/meta/support/#concept-and-alpha')
    expect(resolves(PRODUCT_STATUS_GUIDE)).toBe(true)
    expect(resolves('/meta/support/#no-such-section')).toBe(false)
    expect(resolves('/tmux/guides/concept-examples/#concept-and-alpha')).toBe(false)
  })

  it('renders a redirect page that names its canonical target and refreshes without script', async () => {
    const page = await loadAstroTemplate('components/docs/RedirectPage.astro')
    const html = await renderAstroTemplate(page, { props: { destination: '/en/meta/support/', title: 'the documentation' } })
    expect(html).toContain('<link rel="canonical" href="https://libtmux.org/en/meta/support/">')
    expect(html).toContain('<noscript><meta http-equiv="refresh" content="0;url=/en/meta/support/"></noscript>')
    expect(html).toContain('<meta name="robots" content="noindex">')
  })
})

/**
 * The names a page can take directly under a locale root.
 *
 * Human pages come from three places: `.astro` files and directories in
 * `src/pages`, the first segment of every content route, and the literal
 * routes `[...slug].astro` adds, named by their full route. Endpoints such as
 * `llms.txt.ts` write machine files and are not pages.
 */
function rootPages(pages: string, content: string, slugRoute: string): Map<string, string> {
  const found = new Map<string, string>()
  const add = (name: string, origin: string) => { if (name && !found.has(name)) found.set(name, origin) }
  for (const entry of readdirSync(pages, { withFileTypes: true })) {
    if (entry.name.startsWith('[')) continue
    if (entry.isDirectory()) add(entry.name, 'pages directory')
    else if (entry.name.endsWith('.astro')) {
      const name = entry.name.replace(/\.astro$/, '')
      // The locale home and the error page are not pages beside the others.
      if (name !== 'index' && name !== '404') add(name, 'pages file')
    } else if (entry.name.endsWith('.ts') && !/\.[a-z]+\.ts$/.test(entry.name)) add(entry.name.replace(/\.ts$/, ''), 'endpoint without a file extension')
  }
  for (const entry of contentEntries(content)) add(docsRoutePath(entry).split('/')[0]!, `content ${entry.id}`)
  for (const [, slug] of readFileSync(slugRoute, 'utf8').matchAll(/params: \{ slug: '([^']+)' \}/g)) add(slug!, 'catch-all route')
  return found
}

describe('the site root namespace', () => {
  // Sections and trees; pages about the site itself belong under `meta`.
  const SECTIONS = ['search', 'prompts', 'demo', 'api', 'reference', 'tmux', 'meta']
  const ALLOWED = new Set([...SECTIONS, ...PORTS.map((port) => port.slug)])
  // Found loose at the root, with no decision yet on where it belongs: the
  // cross-port tool catalogue. Its `/mcp/` parent now redirects home.
  const UNDECIDED = ['mcp/tools']
  // Pages about the site itself, each kept at its old URL by a redirect.
  const META_PAGES = ['support', 'parity', 'translations', 'third-party-notices']

  const loose = (found: Map<string, string>) => [...found]
    .filter(([name]) => !ALLOWED.has(name.split('/')[0]!) && !UNDECIDED.includes(name))

  it('holds only the allowed sections, port trees and the pages still undecided', () => {
    expect(loose(rootPages(PAGES, CONTENT, SLUG_ROUTE))).toEqual([])
  })

  it('keeps every page about the site under meta, with its old URL redirecting there', () => {
    const redirected = new Map(movedPageRedirects().map(({ path, target }) => [target, path]))
    for (const name of META_PAGES) {
      expect(hasSource(`meta/${name}`), name).toBe(true)
      expect(redirected.has(`meta/${name}`), `${name} keeps a redirect`).toBe(true)
      expect(rootPages(PAGES, CONTENT, SLUG_ROUTE).has(name), `${name} left the root`).toBe(false)
    }
    expect(redirected.get('meta/third-party-notices')).toBe('third-party-notices')
  })

  it('lists no entry that has left the root, so the allowlist cannot go stale', () => {
    const found = rootPages(PAGES, CONTENT, SLUG_ROUTE)
    for (const name of [...SECTIONS, ...UNDECIDED]) expect(found.has(name), name).toBe(true)
    expect(PORTS.some((port) => found.has(port.slug))).toBe(true)
    expect(UNDECIDED.filter((name) => ALLOWED.has(name.split('/')[0]!))).toEqual([])
  })

  it('has no cross-port MCP overview at the root, which redirects to the site home', () => {
    expect(movedPageRedirects()).toContainEqual({ path: 'mcp', target: '' })
    expect(existsSync(join(PAGES, '../components/mcp/Overview.astro'))).toBe(false)
    expect(rootPages(PAGES, CONTENT, SLUG_ROUTE).has('mcp')).toBe(false)
    expect(redirectDestination('/en/', '')).toBe('/en/')
    expect(redirectDestination('/pr-42/ja/', '')).toBe('/pr-42/ja/')
    expect(redirectDestination('/en/', 'meta/support')).toBe('/en/meta/support/')

    // The catch-all route as it was, with the overview added back.
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-root-route-'))
    scratch.push(dir)
    const route = join(dir, '[...slug].astro')
    writeFileSync(route, `${readFileSync(SLUG_ROUTE, 'utf8')}\n{ params: { slug: 'mcp' }, props: { globalPage: 'mcp' } },\n`)
    expect(loose(rootPages(PAGES, CONTENT, route)).map(([name]) => name)).toEqual(['mcp'])
  })

  it('flags a new page, content route or extensionless endpoint added to the current source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-root-pages-'))
    scratch.push(dir)
    const pages = join(dir, 'pages')
    const content = join(dir, 'content')
    // Mirror the real top level, then add pages that no one has placed.
    for (const entry of readdirSync(PAGES, { withFileTypes: true })) {
      if (entry.isDirectory()) mkdirSync(join(pages, entry.name), { recursive: true })
      else { mkdirSync(pages, { recursive: true }); writeFileSync(join(pages, entry.name), '') }
    }
    for (const rogue of ['widgets.astro', 'status.ts', 'status.json.ts']) writeFileSync(join(pages, rogue), '')
    mkdirSync(join(content, 'guides'), { recursive: true })
    writeFileSync(join(content, 'about.md'), '---\ntitle: About\n---\n')
    writeFileSync(join(content, 'guides/panes.md'), '---\ntitle: Panes\n---\n')

    const found = rootPages(pages, content, SLUG_ROUTE)
    expect(loose(found).map(([name]) => name).sort()).toEqual(['about', 'status', 'widgets'])
  })
})
