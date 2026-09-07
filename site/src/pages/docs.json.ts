import type { APIRoute } from 'astro'
import { getCollection, render } from 'astro:content'
import { DEFAULT_LOCALE } from '../i18n/locales.ts'
import { localeOf } from '../i18n/resolve.ts'
import { API_MODELS, PORT_NAME, ownersOf } from '../lib/api-models.ts'
import { DOC_PRODUCTS, hasReference, PORTS, portPageUrl, referenceUrl } from '../lib/ports.ts'
import { PORT_ROOT } from '../lib/site-root.ts'
import { docsRoutePath } from '../lib/docs-paths.ts'

/**
 * `/docs.json` — the agent manifest.
 *
 * The schema is `sphinx-gp-llms`'s, field for field, read from its
 * `_docs_json.py` and from the 55-page instance that ships under each
 * version's Python API subtree. Matching it exactly matters more than our
 * own: the Python port publishes both files, so an agent that understands one
 * must not find the other contradicting it.
 *
 *   { name, url, description, sourceRepository,
 *     agentEntrypoints: { manifest, llms, llmsFull },
 *     pages: [ { title, description, section, url, markdownUrl,
 *                headings: [ { id, level, text } ] } ] }
 *
 * `markdownUrl` is the one field we diverge on, and deliberately. gp-sphinx
 * points it at a per-page Markdown twin; we publish none, and the upstream
 * twin generator has the bug recorded in `10-llms-and-agents.md` — it copies
 * source rather than resolved content, so an autodoc page's twin is the
 * unresolved directive. Pointing at `llms-full.txt`, which *is* resolved,
 * is honest; pointing at a file we do not emit would not be.
 */
export const GET: APIRoute = async ({ site }) => {
  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const base = import.meta.env.BASE_URL
  // Where the reference and its inventories actually live. PORT_ROOT has no
  // trailing slash; every use below joins a path that has no leading one.
  const refBase = `${PORT_ROOT}/`
  const port = process.env.LIBTMUX_DOCS_PORT
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }

  const entries = await getCollection(
    'docs',
    (entry) => (!port || !entry.data.port || entry.data.port === port) && localeOf(entry.id) === DEFAULT_LOCALE,
  )

  const pages = []
  for (const entry of entries) {
    const { headings } = await render(entry)
    pages.push({
      title: entry.data.title,
      description: entry.data.description ?? '',
      section: entry.data.sidebar?.group ?? 'Documentation',
      url: `${origin}${entry.data.product && !port ? refBase : base}${docsRoutePath(entry, port, defaults)}/`,
      markdownUrl: `${origin}${entry.data.product && !port ? refBase : base}llms-full.txt`,
      headings: headings.map((h) => ({ id: h.slug, level: h.depth, text: h.text })),
    })
  }

  // The reference is not in the docs collection, and an agent asking "what is
  // documented here" should not be told only about the prose.
  for (const [port, model] of Object.entries(API_MODELS)) {
    const types = ownersOf(model)
    pages.push({
      title: `${PORT_NAME[port] ?? port} API reference`,
      description: `${model.symbols.length} symbols extracted from source, ${types.length} with their own page.`,
      section: 'API reference',
      // refBase, not base: the reference is generated in the default locale
      // only, so a Japanese manifest advertising /ja/reference/… names pages
      // nothing builds. Nothing parses this file, so nothing reported it.
      url: `${origin}${refBase}reference/${port}/`,
      markdownUrl: `${origin}${refBase}reference/${port}/objects.inv`,
      headings: types.slice(0, 200).map((t) => ({
        id: t.publicId ?? t.id,
        level: 2,
        text: t.name,
      })),
    })
  }

  const manifest = {
    name: 'libtmux',
    url: `${origin}${base}`,
    description:
      'A typed tmux control library for eight languages — Python, TypeScript, Rust, Go, Java, .NET, C++ and Swift — documented as one site.',
    sourceRepository: 'https://github.com/tmux-python/libtmux',
    agentEntrypoints: {
      manifest: `${base}docs.json`,
      llms: `${base}llms.txt`,
      llmsFull: `${base}llms-full.txt`,
      // Not in gp-sphinx's schema. Additive rather than a rename, so a reader
      // of the original shape is unaffected, and it is the entry point that
      // matters most for an agent that already speaks Sphinx.
      inventory: `${refBase}objects.inv`,
    },
    ports: PORTS.map((p) => ({
      slug: p.slug,
      name: p.name,
      language: p.language,
      package: p.packageName,
      reference: hasReference(p) ? referenceUrl(p, 'stable') : null,
      products: Object.entries(DOC_PRODUCTS).map(([slug, product]) => ({
        slug, name: product.label,
        url: portPageUrl(p, defaults[p.slug] ?? 'latest', slug),
        reference: portPageUrl(p, defaults[p.slug] ?? 'latest', `${slug}/api`),
        ...(slug === 'mcp' ? { protocol: portPageUrl(p, defaults[p.slug] ?? 'latest', 'mcp/tools').replace(/\/$/, '.json') } : {}),
        source: API_MODELS[p.slug]?.sources?.find((source) => source.product === slug),
      })),
      extracted: API_MODELS[p.slug]
        ? {
            symbols: API_MODELS[p.slug].symbols.length,
            extractor: API_MODELS[p.slug].extractor,
            inventory: `${refBase}reference/${p.slug}/objects.inv`,
          }
        : null,
    })),
    pages,
  }

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
