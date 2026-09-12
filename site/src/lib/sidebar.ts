/**
 * Sidebar query logic, shared by Sidebar.astro and DocsLayout.astro.
 *
 * One code path serves two cases: pages tagged with a `port` frontmatter
 * field get that port's nav (scoped by `entry.data.port === port`); the
 * shell's own shared pages (concepts, guides, examples — no `port` set)
 * get the same grouping mechanism over the same query, since `port ===
 * undefined` matches them just as precisely. This generalizes the
 * `currentPath.startsWith("/lib/") ? ... : ...` two-branch scoping in
 * ~/work/typescript/social-embed's Sidebar.astro (per
 * notes/research/24-astro-shell.md §3) to a single filter predicate instead
 * of a growing set of hardcoded branches.
 *
 * `entryPath` is the seam for `[...slug].astro` (or whatever else builds
 * `getStaticPaths()` for the docs collection) to stay in sync with: it must
 * derive the same URL from an entry that this file uses for the entry's
 * sidebar `href`, or a page's own link and its sidebar entry disagree.
 */
import { getCollection } from 'astro:content'
import type { CollectionEntry } from 'astro:content'
import { PORT_BY_SLUG, portPageUrl, type DocProduct } from './ports'
import { withPortRoot } from './site-root'
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales'
import { localeOf, sourceIdOf } from '../i18n/resolve'
import { docsPath, docsRoutePath } from './docs-paths'

export interface SidebarLinkItem {
  type: 'link'
  label: string
  href: string
  /** True when the link leaves libtmux.org (an ecosystem reference host). */
  external?: boolean
}

export interface SidebarGroupItem {
  type: 'group'
  label: string
  items: SidebarLinkItem[]
}

export type SidebarItem = SidebarLinkItem | SidebarGroupItem

interface OrderedLabel {
  order?: number
  label: string
}

/** Ascending by `sidebar.order` when set (unordered items sort last), then alphabetical. */
function byOrderThenLabel<T extends OrderedLabel>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) return a.order - b.order
    if (a.order !== undefined) return -1
    if (b.order !== undefined) return 1
    return a.label.localeCompare(b.label)
  })
}

/**
 * A docs entry's URL path. This IS the route param `[...slug].astro` uses
 * (`params: { slug: sourceIdOf(entry.id) }`) — not a path relative to some
 * per-port build root, because the shared 'docs' collection is served from
 * one catch-all route, not one separate build per port.
 *
 * The locale comes off, and only the locale. A translated entry is stored as
 * `ja/concepts/queries` but served from a build whose base is already `/ja/`,
 * so keeping the prefix here composed `/ja/ja/concepts/` — every sidebar
 * link on a translated page, dead. Do not strip a `<port>/` prefix as well:
 * entries are not nested under one today, and if they ever are, `entry.id`
 * already includes it because that route's own param does too.
 */
export function entryPath(entry: CollectionEntry<'docs'>): string {
  return docsPath({ ...entry, id: sourceIdOf(entry.id) })
}

/** `entryPath`, joined to this build's own base and given the trailing slash `trailingSlash: 'always'` expects. */
function linkHref(entry: CollectionEntry<'docs'>, version: string): string {
  const path = docsRoutePath({ ...entry, id: sourceIdOf(entry.id) }, process.env.LIBTMUX_DOCS_PORT,
    entry.data.port ? { [entry.data.port]: version } : {})
  const base = import.meta.env.BASE_URL
  return path ? `${base}${path}/` : base
}

/**
 * The reference entries a port-scoped sidebar carries.
 *
 * A list, not one entry. This returned a single link that was *either* the
 * ecosystem host *or* this site, so the two could never coexist — and five of
 * the eight ports were therefore never offering the reference this site
 * generates for them. Rust, Go and Java linked only docs.rs, pkg.go.dev and
 * javadoc.io; Python linked the vendored gp-sphinx build; Swift's entry said
 * "API reference" and went to the port's landing page.
 *
 * All three kinds are worth having and they are different documents:
 *
 * - Ours is generated from the port's own source and cross-links to the other
 *   seven languages. Every port has one.
 * - The ecosystem host is where the rest of that language's world will send a
 *   reader, and it is canonical for them. Named for the host, marked as
 *   leaving, so the click is predictable.
 * - Python additionally has gp-sphinx rendering upstream's own documentation,
 *   which is neither of the above. Which of the two Python entries survives is
 *   what `scripts/compare-reference.mjs` exists to decide; dropping one now
 *   would pre-empt that.
 */
export function referenceEntries(port: string, version: string): SidebarLinkItem[] {
  const p = PORT_BY_SLUG[port]
  if (!p) throw new Error(`sidebar.ts: unknown port slug "${port}"`)

  const entries: SidebarLinkItem[] = [
    // withPortRoot, not withRoot: the reference is built in the default
    // locale only, so a Japanese page reaches across to it rather than
    // expecting a copy under its own prefix.
    { type: 'link', label: 'API reference', href: withPortRoot(`/reference/${port}/`), external: false },
  ]

  if (p.ecosystemHost) {
    entries.push({
      type: 'link',
      label: p.ecosystemHost.name,
      href: p.ecosystemHost.url,
      external: true,
    })
  }

  // Not `referenceUrl`, which answers a different question — where a reader
  // should be sent by default. This is the second Python document, named for
  // what it is rather than for where it sits.
  if (port === 'py') {
    entries.push({
      type: 'link',
      label: 'Upstream reference',
      href: withPortRoot(`/py/${version}/api/`),
      external: false,
    })
  }

  return entries
}

/**
 * The port's own documentation areas, as a sidebar group.
 *
 * The four shared sections — the same set `[port]/index.astro` offers as
 * cards — under this port's prefix, so `/reference/ts/` can hand a reader
 * back to `/ts/latest/topics/` rather than leave the reference as a place
 * with no exit. Built from `portPageUrl` rather than spelled out, so the
 * version axis and the port root stay ports.ts's business.
 */
export function portAreas(port: string, version: string): SidebarGroupItem {
  const p = PORT_BY_SLUG[port]
  if (!p) throw new Error(`sidebar.ts: unknown port slug "${port}"`)
  return {
    type: 'group',
    label: 'Documentation',
    items: (['topics', 'guides', 'examples', 'concepts'] as const).map((area) => ({
      type: 'link',
      label: `${area[0]!.toUpperCase()}${area.slice(1)}`,
      href: portPageUrl(p, version, area),
    })),
  }
}

/**
 * The sidebar for one section of the docs collection: pages grouped by
 * `sidebar.group` and ordered by `sidebar.order` (falling back to
 * alphabetical at both the item and group level). Pages without a group
 * render as flat top-level links rather than a synthetic single-item group.
 *
 * `port` scopes the query — `entry.data.port === port` — so `undefined`
 * returns the shell's shared pages (concepts, guides, examples) and a port
 * slug returns that port's own pages, with the reference-tree entry
 * appended only in the port-scoped case. An unrecognized `port` throws
 * rather than silently rendering an empty sidebar.
 */
export async function getSidebar(
  port: string | undefined,
  version: string,
  locale: Locale = DEFAULT_LOCALE,
  product?: DocProduct,
): Promise<SidebarItem[]> {
  if (port !== undefined && !PORT_BY_SLUG[port]) throw new Error(`sidebar.ts: unknown port slug "${port}"`)

  // Shared prose (no `port` frontmatter) belongs to every language build:
  // /py/stable/concepts/ is the same page as /concepts/ with Python's code
  // fences kept. Matching only `entry.data.port === port` emptied the whole
  // sidebar the moment builds started setting a port, since no shared page
  // carries the field. A page that *does* name a port stays exclusive to it.
  //
  // The source locale defines the page set, in every locale. Scoping the set
  // itself to `locale` instead left a translated build's sidebar listing only
  // the pages translated so far, and hid every placeholder page — the pages
  // that exist precisely so every page answers in every language. A nav that
  // shrinks as you switch language is worse than one that admits what is
  // untranslated.
  const entries = await getCollection(
    'docs',
    (entry) =>
      (entry.data.port === undefined || entry.data.port === port) &&
      entry.data.product === product &&
      localeOf(entry.id) === DEFAULT_LOCALE,
  )

  // The reader's own locale, where it has this page. `entryPath` strips the
  // locale, so a translation and its source share a key; the href is built
  // from the source either way, because the build's base already carries the
  // locale and a placeholder is served at the same path as a translation.
  const translated = new Map<string, CollectionEntry<'docs'>>()
  if (locale !== DEFAULT_LOCALE) {
    const inLocale = await getCollection('docs', (entry) => localeOf(entry.id) === locale)
    for (const entry of inLocale) translated.set(entryPath(entry), entry)
  }

  const rows = entries.map((entry) => {
    // The translated label when there is one, so the nav reads in the
    // reader's language as far as the translation has got, and in English —
    // not blank, and not a slug — for the rest.
    const localised = translated.get(entryPath(entry)) ?? entry
    return {
      label: localised.data.sidebar?.label ?? localised.data.title,
      href: linkHref(entry, version),
      order: entry.data.sidebar?.order,
      group: entry.data.sidebar?.group,
    }
  })

  const ungrouped: SidebarLinkItem[] = byOrderThenLabel(rows.filter((r) => !r.group)).map((r) => ({
    type: 'link',
    label: r.label,
    href: r.href,
  }))

  const groupNames = [...new Set(rows.flatMap((r) => (r.group ? [r.group] : [])))]
  const groups: SidebarGroupItem[] = byOrderThenLabel(
    groupNames.map((label) => {
      const items = byOrderThenLabel(rows.filter((r) => r.group === label))
      // items is already order-then-label sorted, so the first defined
      // order in it is the group's minimum — used only to place the group
      // among its siblings, not carried into the returned shape.
      const order = items.find((i) => i.order !== undefined)?.order
      return { label, order, items }
    }),
  ).map(({ label, items }) => ({
    type: 'group' as const,
    label,
    items: items.map((i): SidebarLinkItem => ({ type: 'link', label: i.label, href: i.href })),
  }))

  /*
   * Reference first, miscellany last.
   *
   * This read `[...ungrouped, ...groups, referenceEntry(...)]`, which put the
   * two entries in exactly the wrong places: on /ts/stable/concepts/ the
   * 29-entry sidebar opened with "Third-party notices" and closed with "API
   * reference". The licence list had the position a reader's eye lands on and
   * the thing they came for was below twenty-seven other links.
   *
   * `ungrouped` is every page that declares no `sidebar.group`, which today
   * is the notices page and nothing else — so sending it to the end is the
   * general form of "notices last" rather than a special case for one file.
   */
  if (port === undefined) return [...groups, ...ungrouped]
  if (product) {
    if (product === 'mcp') ungrouped.splice(1, 0, {
      type: 'link', label: 'Tools', href: portPageUrl(PORT_BY_SLUG[port], version, 'mcp/tools'),
    })
    return [...ungrouped, ...groups]
  }
  return [...referenceEntries(port, version), ...groups, ...ungrouped]
}

/**
 * Whether `href` (as built by `linkHref`/`referenceUrl` above — base-prefixed,
 * trailing-slashed, possibly absolute) points at the page currently
 * rendering. Trims this build's own base and both sides' slashes before
 * comparing, so it doesn't matter whether the caller's `currentPath` is
 * `Astro.url.pathname` (base-included) or already base-relative.
 */
export function isActivePath(href: string, currentPath: string): boolean {
  const base = import.meta.env.BASE_URL
  const relative = (p: string) => (p.startsWith(base) ? p.slice(base.length) : p).replace(/^\/+|\/+$/g, '')
  return relative(href) === relative(currentPath)
}
