import type { APIRoute } from 'astro'
import { getCollection, render } from 'astro:content'
import { DEFAULT_LOCALE, localeRoot } from '../i18n/locales.ts'
import { buildLocale, localeOf } from '../i18n/resolve.ts'
import { API_MODELS, PORT_NAME, ownersOf } from '../lib/api-models.ts'
import { DOC_PRODUCTS, hasReference, PORTS, PORT_BY_SLUG, portPageUrl, productApiPath, productAvailable, productInDevelopment, referenceUrl, type DocProduct } from '../lib/ports.ts'
import { PORT_ROOT } from '../lib/site-root.ts'
import { docsRoutePath } from '../lib/docs-paths.ts'
import { docsEntryAvailable } from '../lib/page-port-links.ts'
import { isIndexSource, markdownPath } from '../lib/markdown-twins.ts'
import { localeProse } from '../lib/llms.ts'
import { documentationAreas } from '../lib/port-documentation.ts'
import { buildTarget } from '../lib/versions.ts'
import { tmuxPageDescription, tmuxPageHeadings, tmuxPageTitle, tmuxReferenceRoutes, tmuxReferenceUrl } from '../lib/tmux-reference.ts'

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
  const visiblePorts = PORTS.filter((entry) => !port || entry.slug === port)
  const locale = buildLocale()
  const defaults: Record<string, string> = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')
  const versionFor = (slug: string) => slug === port ? buildTarget(process.env).version : (defaults[slug] ?? 'latest')

  const entries = await getCollection(
    'docs',
    (entry) => docsEntryAvailable(entry, port)
      && localeOf(entry.id) === DEFAULT_LOCALE
      && (locale === DEFAULT_LOCALE || Boolean(port) || !entry.data.port),
  )
  // What this build serves at each route: a translation where it has one, and
  // the default locale's page where a placeholder stands in for it.
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
  for (const [slug, model] of Object.entries(API_MODELS)) {
    if (port && slug !== port) continue
    const types = ownersOf(model)
    pages.push({
      title: `${PORT_NAME[slug] ?? slug} API reference`,
      description: `${model.symbols.length} symbols extracted from source, ${types.length} with their own page.`,
      section: 'API reference',
      // refBase, not base: the reference is generated in the default locale
      // only, so a Japanese manifest advertising a locale-prefixed reference
      // names pages nothing builds.
      url: `${origin}${refBase}${slug}/${versionFor(slug)}/reference/`,
      markdownUrl: `${origin}${refBase}${slug}/${versionFor(slug)}/reference/index.md`,
      headings: types.slice(0, 200).map((t) => ({
        id: t.publicId ?? t.id,
        level: 2,
        text: t.name,
      })),
    })
  }

  for (const { version, slug } of tmuxReferenceRoutes()) {
    const url = `${origin}${tmuxReferenceUrl(version, slug)}`
    pages.push({ title: tmuxPageTitle(version, slug), description: tmuxPageDescription(version, slug),
      section: 'tmux CLI reference', url, markdownUrl: markdownPath(url, !slug),
      headings: tmuxPageHeadings(version, slug).map((heading) => ({ id: heading.slug, level: heading.depth, text: heading.text })) })
  }

  const manifest = {
    name: port ? `libtmux for ${PORT_BY_SLUG[port].name}` : 'libtmux',
    url: `${origin}${base}`,
    description: port ? `Guides, examples and API reference for ${PORT_BY_SLUG[port].packageName}.`
      : `Typed tmux control libraries for ${PORTS.map((port) => port.name).join(', ')}, documented as one site.`,
    sourceRepository: `https://github.com/${port ? PORT_BY_SLUG[port].repo : 'tmux-python/libtmux'}`,
    agentEntrypoints: {
      manifest: `${base}docs.json`,
      llms: `${base}llms.txt`,
      llmsFull: `${base}llms-full.txt`,
      // Not in gp-sphinx's schema. Additive rather than a rename, so a reader
      // of the original shape is unaffected, and it is the entry point that
      // matters most for an agent that already speaks Sphinx.
      inventory: `${refBase}objects.inv`,
    },
    ports: visiblePorts.map((p) => ({
      slug: p.slug,
      name: p.name,
      language: p.language,
      referenceKind: p.referenceKind ?? 'model',
      package: p.packageName,
      reference: hasReference(p) ? referenceUrl(p, versionFor(p.slug)) : null,
      ...(p.parentLibrary ? { parentLibrary: p.parentLibrary } : {}),
      products: Object.entries(p.parentLibrary ? {} : DOC_PRODUCTS).map(([slug, product]) => ({
        slug, name: product.label,
        availability: productAvailable(p, slug as DocProduct) ? 'available' : 'unpublished',
        inDevelopment: productInDevelopment(p, slug as DocProduct),
        ...(slug === 'workspace' ? { cli: p.workspaceCli ?? null, cliAvailability: p.workspaceCliAvailability ?? null } : {}),
        url: portPageUrl(p, versionFor(p.slug), slug),
        reference: productAvailable(p, slug as DocProduct)
          ? portPageUrl(p, versionFor(p.slug), productApiPath(slug as DocProduct)) : null,
        ...(slug === 'mcp' ? { protocol: productAvailable(p, 'mcp')
          ? portPageUrl(p, versionFor(p.slug), 'mcp/tools').replace(/\/$/, '.json') : null } : {}),
        source: API_MODELS[p.slug]?.sources?.find((source) => source.product === slug),
      })),
      extracted: API_MODELS[p.slug]
        ? {
            symbols: API_MODELS[p.slug].symbols.length,
            extractor: API_MODELS[p.slug].extractor,
            inventory: `${refBase}${p.slug}/${versionFor(p.slug)}/reference/objects.inv`,
          }
        : null,
      documentation: documentationAreas(p.slug).map((area) => ({
        id: area.id,
        name: area.label,
        kind: area.kind,
        availability: area.kind === 'unavailable' ? 'unpublished' : 'available',
        url: portPageUrl(p, versionFor(p.slug), area.route),
        ...(area.kind === 'companion-package' ? {
          package: p.packages?.find((entry) => entry.id === area.package)?.name,
        } : {}),
      })),
    })),
    pages,
  }

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
