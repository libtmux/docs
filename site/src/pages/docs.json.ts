import type { APIRoute } from 'astro'
import { getCollection, render } from 'astro:content'
import { DEFAULT_LOCALE } from '../i18n/locales.ts'
import { localeOf } from '../i18n/resolve.ts'
import { API_MODELS, PORT_NAME, ownersOf } from '../lib/api-models.ts'
import { hasReference, PORTS, referenceUrl } from '../lib/ports.ts'

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

  const entries = await getCollection(
    'docs',
    (entry) => entry.data.port === undefined && localeOf(entry.id) === DEFAULT_LOCALE,
  )

  const pages = []
  for (const entry of entries) {
    const { headings } = await render(entry)
    pages.push({
      title: entry.data.title,
      description: entry.data.description ?? '',
      section: entry.data.sidebar?.group ?? 'Documentation',
      url: `${origin}${base}${entry.id}/`,
      markdownUrl: `${origin}${base}llms-full.txt`,
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
      url: `${origin}${base}reference/${port}/`,
      markdownUrl: `${origin}${base}reference/${port}/objects.inv`,
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
      inventory: `${base}objects.inv`,
    },
    ports: PORTS.map((p) => ({
      slug: p.slug,
      name: p.name,
      language: p.language,
      package: p.packageName,
      reference: hasReference(p) ? referenceUrl(p, 'stable') : null,
      extracted: API_MODELS[p.slug]
        ? {
            symbols: API_MODELS[p.slug].symbols.length,
            extractor: API_MODELS[p.slug].extractor,
            inventory: `${base}reference/${p.slug}/objects.inv`,
          }
        : null,
    })),
    pages,
  }

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
