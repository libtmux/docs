/**
 * The `llms.txt` family, built from the same content collection the pages are.
 *
 * `notes/research/10-llms-and-agents.md` sets the rule this follows: machine-
 * readable output must come from the *resolved* content, never from doc-comment
 * source. For the shell that is easy — its prose is hand-written Markdown, so
 * source and resolved content are the same text — and it is the reason these
 * files are generated here rather than by a post-build HTML-to-Markdown pass.
 *
 * What is genuinely new is that a per-port build gets a per-port file. The
 * remark plugin drops other ports' fences from the HTML; this does the same to
 * the Markdown, so `/py/stable/llms-full.txt` carries Python and no other
 * language. An agent pointed at one port's documentation gets one port's code,
 * which is the whole point of the per-language mechanism applied to the one
 * consumer that cannot see the language switcher.
 *
 * Scope, stated rather than implied: the generated API reference is indexed in
 * `llms.txt` but not inlined into `llms-full.txt`. .NET's reference alone is
 * 1.5 MB of Markdown across 215 files, which would make the full-text file
 * useless for the context windows it exists to fit into. Agents that want it
 * can follow the URL.
 */
import { getCollection } from 'astro:content'
import type { CollectionEntry } from 'astro:content'
import { LANG_TO_PORT, parseMeta, readFence } from '../plugins/remark-port-code.mjs'
import { PORT_BY_SLUG, hasReference, portPageUrl, productApiPath, referenceUrl } from './ports.ts'
import { DEFAULT_LOCALE } from '../i18n/locales.ts'
import { localeOf } from '../i18n/resolve.ts'
import { buildTarget } from './versions.ts'
import { docsPath, docsRoutePath } from './docs-paths.ts'
import { PORT_ROOT } from './site-root.ts'
import { API_MODELS } from './api-models.ts'
import { productApiHref, productApiRoots } from './product-api.ts'

export interface LlmsPage {
  title: string
  description: string
  /** Absolute URL on the deployed site. */
  url: string
  section: string
  body: string
}

/**
 * Turn a page's Markdown *source* into the Markdown a reader of this build
 * would actually see: other ports' fences dropped, `file=` fences filled in.
 *
 * Both halves matter, and the second is the one that is easy to forget.
 * `entry.body` is source, and a `file="examples/capture/capture.ts"` fence has
 * an empty body in source — the remark plugin reads the checkout while
 * rendering HTML. Concatenating source into llms-full.txt would therefore ship
 * a file whose TypeScript examples are all blank, which is exactly the
 * source-versus-resolved bug notes/research/10-llms-and-agents.md was written
 * about. So this calls the same reader the plugin does.
 *
 * A line scan rather than an AST walk on purpose: Astro has already parsed
 * this text once, and re-parsing it to delete four lines is the more fragile
 * of the two. Nested fences are the one thing a scanner gets wrong, and the
 * docs collection has none.
 */
export function resolvePortCode(body: string, port: string | undefined): string {
  const lines = body.split('\n')
  const out: string[] = []
  let inFence = false
  // Drop this fence entirely (it belongs to another port), or drop just its
  // source body (the plugin replaces it with the file's contents).
  let dropping = false
  let replaced = false
  for (const line of lines) {
    const fence = line.match(/^```(\S*)(.*)$/)
    if (fence && !inFence) {
      inFence = true
      const owner = LANG_TO_PORT[fence[1].toLowerCase()]
      dropping = Boolean(port) && Boolean(owner) && owner !== port
      replaced = false
      if (dropping) continue
      out.push(line)
      const meta = parseMeta(fence[2])
      if (meta.file && owner) {
        out.push(readFence(owner, meta, 'llms-full.txt'))
        replaced = true
      }
      continue
    }
    if (fence && inFence) {
      inFence = false
      const wasDropping = dropping
      dropping = false
      replaced = false
      if (!wasDropping) out.push(line)
      continue
    }
    if (!dropping && !replaced) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
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
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  // Default locale only. A translation is a different document at a different
  // URL, and listing `ja/concepts` beside `concepts` in one file would hand an
  // agent the same page twice in two languages.
  const entries = await getCollection(
    'docs',
    (entry) =>
      (!port || entry.data.port === undefined || entry.data.port === port) &&
      localeOf(entry.id) === DEFAULT_LOCALE,
  )
  return entries
    .map((entry) => {
      const entryPort = entry.data.port
      const version = port ? buildTarget(process.env).version : (defaults[entryPort ?? ''] ?? 'latest')
      let body = resolvePortCode(entry.body ?? '', entryPort ?? port)
      if (entryPort && entry.data.product && docsPath(entry) === productApiPath(entry.data.product)) {
        const model = API_MODELS[entryPort]
        const symbols = productApiRoots(model, entry.data.product)
        body += `\n\n## API declarations\n\n${symbols.map((symbol) => `- [${symbol.publicId ?? symbol.name}](${origin}${productApiHref(model, symbol, version)})`).join('\n')}\n`
        if (entry.data.product === 'mcp') body += `\n[Protocol catalog](${origin}${portPageUrl(PORT_BY_SLUG[entryPort], version, 'mcp/tools').replace(/\/$/, '.json')})\n`
      }
      return {
      title: entry.data.title,
      description: entry.data.description ?? '',
      url: `${origin}${entry.data.product && !port ? `${PORT_ROOT}/` : base}${docsRoutePath(entry, port, defaults)}/`,
      section: sectionOf(entry),
      body,
      order: entry.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER,
    }})
    .sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order || a.title.localeCompare(b.title))
}

/** The one-line header both files share, naming the port when there is one. */
export function llmsHeader(): { title: string; blurb: string } {
  const port = process.env.LIBTMUX_DOCS_PORT || undefined
  const p = port ? PORT_BY_SLUG[port] : undefined
  if (!p) {
    return {
      title: 'libtmux',
      blurb:
        'A typed tmux control library published for eight languages — Python, TypeScript, Rust, Go, Java, .NET, C++ and Swift — from one documentation site. Pages below are language-neutral prose; each carries a code sample per port.',
    }
  }
  return {
    title: `libtmux for ${p.name}`,
    blurb: `The ${p.name} port of libtmux (${p.packageName}). Every code sample below is ${p.language}; the same pages exist for the other seven ports under their own prefix.`,
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
