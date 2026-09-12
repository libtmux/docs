import type { APIRoute } from 'astro'
import { getCollection, render } from 'astro:content'
import { DEFAULT_LOCALE, localeRoot } from '../i18n/locales.ts'
import { buildLocale, localeOf } from '../i18n/resolve.ts'
import { API_MODELS, PORT_NAME, ownersOf } from '../lib/api-models.ts'
import { DOC_PRODUCTS, hasReference, PORTS, portPageUrl, productApiPath, productInDevelopment, referenceUrl, type DocProduct } from '../lib/ports.ts'
import { PORT_ROOT } from '../lib/site-root.ts'
import { docsRoutePath } from '../lib/docs-paths.ts'
import { isIndexSource, markdownPath } from '../lib/markdown-twins.ts'
import { localeProse } from '../lib/llms.ts'

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
 * `markdownUrl` is the twin the page itself names, placed by
 * `lib/markdown-twins.ts`. Ours are written from resolved content; gp-sphinx's
 * copy source, so an autodoc page's twin is the unresolved directive
 * (`10-llms-and-agents.md`). A translation build lists the default locale's
 * pages at its own URLs. Each is a translation with its own twin or a
 * placeholder that names the English one.
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
  // What this build serves at each route: a translation where it has one, and
  // the default locale's page where a placeholder stands in for it.
  const locale = buildLocale()
  const translations = new Map(locale === DEFAULT_LOCALE ? []
    : localeProse(await getCollection('docs'), locale, port, defaults)
      .map(({ entry, route }) => [route, entry] as const))

  const pages = []
  for (const entry of entries) {
    const path = docsRoutePath(entry, port, defaults)
    const route = `${path}/`
    // A translated page is described in its own language, so an agent reading
    // the Japanese manifest is not handed English titles for Japanese pages.
    const served = translations.get(path) ?? entry
    const { headings } = await render(served)
    const twinBase = locale === DEFAULT_LOCALE || translations.has(path) ? base : localeRoot(DEFAULT_LOCALE)
    pages.push({
      title: served.data.title,
      description: served.data.description ?? '',
      section: served.data.sidebar?.group ?? 'Documentation',
      url: `${origin}${entry.data.product && !port ? refBase : base}${route}`,
      markdownUrl: `${origin}${markdownPath(`${entry.data.product && !port ? refBase : twinBase}${route}`, isIndexSource(served.filePath))}`,
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
      markdownUrl: `${origin}${refBase}reference/${port}/index.md`,
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
        inDevelopment: productInDevelopment(p, slug as DocProduct),
        ...(slug === 'workspace' ? { cli: p.workspaceCli ?? null } : {}),
        url: portPageUrl(p, defaults[p.slug] ?? 'latest', slug),
        reference: portPageUrl(p, defaults[p.slug] ?? 'latest', productApiPath(slug as DocProduct)),
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
