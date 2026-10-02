/**
 * LLM exports use the HTML renderer's port selection and example sources.
 * API references are linked, rather than inlined into the full prose export.
 */
import { getCollection } from 'astro:content'
import type { CollectionEntry } from 'astro:content'
import { resolvePortCode } from '../plugins/remark-port-code.mjs'
import { PORTS, PORT_BY_SLUG, hasReference, portPageUrl, productApiPath, productAvailable, referenceUrl, workspaceOverviewNotice } from './ports.ts'
import { DEFAULT_LOCALE } from '../i18n/locales.ts'
import { buildLocale, localeOf, sourceIdOf } from '../i18n/resolve.ts'
import { buildTarget } from './versions.ts'
import { docsPath, docsRoutePath, proseHref, type DocsPage } from './docs-paths.ts'
import { docsEntryAvailable } from './page-port-links.ts'
import type { Locale } from '../i18n/locales.ts'
import { PORT_ROOT, SITE_ROOT } from './site-root.ts'
import { API_MODELS } from './api-models.ts'
import { productApiHref, productApiRoots } from './product-api.ts'
import { buildsTmuxReference, tmuxReferenceUrl } from './tmux-reference.ts'

export interface LlmsPage {
  title: string
  description: string
  /** Absolute URL on the deployed site. */
  url: string
  section: string
  body: string
}

/** Section label for grouping, falling back to the top path segment. */
function sectionOf(entry: CollectionEntry<'docs'>): string {
  const group = entry.data.sidebar?.group
  if (group) return group
  if (entry.data.product) return `${PORT_BY_SLUG[entry.data.port!].name} ${entry.data.product === 'mcp' ? 'MCP' : 'Workspace Manager'}`
  const [first] = docsPath(entry).split('/')
  return first === entry.id ? 'Overview' : first[0].toUpperCase() + first.slice(1)
}

/**
 * Every prose page this build emits, in sidebar order, with its code narrowed
 * to this build's port.
 */
export async function llmsPages(origin: string, base: string): Promise<LlmsPage[]> {
  const port = process.env.LIBTMUX_DOCS_PORT || undefined
  const locale = buildLocale()
  // Default locale only. A translation is a different document at a different
  // URL, and listing `ja/concepts` beside `concepts` in one file would hand an
  // agent the same page twice in two languages.
  const entries = await getCollection(
    'docs',
    (entry) =>
      docsEntryAvailable(entry, port) &&
      localeOf(entry.id) === DEFAULT_LOCALE &&
      (locale === DEFAULT_LOCALE || Boolean(port) || entry.data.port === undefined),
  )
  // The same page the routes serve: a translation where this locale has one,
  // so a section and that page's `.md` twin stay one text rather than two.
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  const translations = new Map(locale === DEFAULT_LOCALE ? []
    : localeProse(await getCollection('docs'), locale, port, defaults)
      .map(({ entry, route }) => [route, entry] as const))
  return entries
    .map((entry) => llmsPage(translations.get(docsRoutePath(entry, port, defaults)) ?? entry, origin, base))
    .sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order || a.title.localeCompare(b.title))
}

/**
 * One prose page as this build serves it: its URL, and its Markdown with code
 * narrowed to the build's port and `file=` fences filled in. llms-full.txt
 * concatenates these, and the page's `.md` twin is one of them, so the two
 * cannot drift.
 *
 * `entry.id` must be the source id, without a translation's locale prefix,
 * because the route path is derived from it.
 */
export function llmsPage(entry: CollectionEntry<'docs'>, origin: string, base: string): LlmsPage & { order: number } {
  const port = process.env.LIBTMUX_DOCS_PORT || undefined
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  const entryPort = entry.data.port
  const version = port ? buildTarget(process.env).version : (defaults[entryPort ?? ''] ?? 'latest')
  const path = docsRoutePath(entry, port, defaults)
  const url = `${origin}${entry.data.product && !port ? `${PORT_ROOT}/` : base}${path ? `${path}/` : ''}`
  let body = resolvePortCode(entry.body ?? '', port, entryPort,
    (href: string) => new URL(proseHref(href, SITE_ROOT, entryPort ?? port, version), url).href)
  if (entry.data.cards?.length) {
    body += `\n\n${entry.data.cards.map((card) => `- [${card.label}](${new URL(card.href, url).href}): ${card.body}`).join('\n')}\n`
  }
  if (entryPort && entry.data.product === 'workspace' && docsPath(entry) === 'workspace') {
    const notice = workspaceOverviewNotice(PORT_BY_SLUG[entryPort])
    if (notice) body = `**${notice.title}** ${notice.body}\n\n${body}`
  }
  if (entryPort && entry.data.product && productAvailable(PORT_BY_SLUG[entryPort], entry.data.product)
    && docsPath(entry) === productApiPath(entry.data.product)) {
    const model = API_MODELS[entryPort]
    const symbols = productApiRoots(model, entry.data.product)
    body += `\n\n## API declarations\n\n${symbols.map((symbol) => `- [${symbol.publicId ?? symbol.name}](${origin}${productApiHref(model, symbol, version)})`).join('\n')}\n`
    if (entry.data.product === 'mcp') body += `\n[Protocol catalog](${origin}${portPageUrl(PORT_BY_SLUG[entryPort], version, 'mcp/tools').replace(/\/$/, '.json')})\n`
  }
  // A locale's landing entry routes to '', which is the root itself.
  return {
    title: entry.data.title,
    description: entry.data.description ?? '',
    url,
    section: sectionOf(entry),
    body,
    order: entry.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER,
  }
}

/**
 * The prose entries this locale serves, each paired with its route.
 *
 * `[...slug].md.ts` writes one Markdown twin per entry and `docs.json` names
 * them. Deriving the set twice is how a manifest comes to advertise a file
 * nothing builds, so both read it from here.
 */
export function localeProse<T extends DocsPage>(
  entries: T[],
  locale: Locale,
  port?: string,
  defaults: Record<string, string> = {},
): { entry: T; route: string }[] {
  return entries
    .filter((entry) => localeOf(entry.id) === locale && docsEntryAvailable(entry, port))
    .map((entry) => {
      const source = { ...entry, id: sourceIdOf(entry.id) } as T
      return { entry: source, route: docsRoutePath(source, port, defaults) }
    })
}

/** The one-line header both files share, naming the port when there is one. */
export function llmsHeader(): { title: string; blurb: string } {
  const port = process.env.LIBTMUX_DOCS_PORT || undefined
  const p = port ? PORT_BY_SLUG[port] : undefined
  if (!p) {
    return {
      title: 'libtmux',
      blurb: `Typed tmux control libraries for ${PORTS.map((port) => port.name).join(', ')}. This site includes shared concepts and language-specific guides, examples and API references.`,
    }
  }
  return {
    title: `libtmux for ${p.name}`,
    blurb: `The ${p.name} library (${p.packageName}). These pages include its guides, tested examples and API documentation.`,
  }
}

/**
 * The reference entry, when this port has one to point at.
 *
 * Absolute, like every other URL in these files. An agent fetches llms.txt
 * out of band and has no page to resolve a root-relative path against —
 * referenceUrl() returns one for a self-hosted port and a full URL for an
 * ecosystem host, so only the former needs the origin.
 */
export function referenceLine(origin: string): string | null {
  if (buildsTmuxReference()) return `- [tmux CLI reference](${origin}${tmuxReferenceUrl()}): versioned command syntax and the tmux manual.`
  const port = process.env.LIBTMUX_DOCS_PORT || undefined
  const p = port ? PORT_BY_SLUG[port] : undefined
  if (!p || !hasReference(p)) return null
  const { version } = buildTarget(process.env)
  const url = referenceUrl(p, version)
  const absolute = url.startsWith('/') ? `${origin}${url}` : url
  // Always ours now: `referenceUrl` returns this site's extracted reference
  // for all eight ports. Where a canonical ecosystem host also exists it is
  // named separately, by `referenceEntries`.
  const where = 'libtmux.org'
  return `- [${p.name} API reference](${absolute}): every public symbol, generated from the source. Hosted on ${where}.`
}
