import type { APIRoute } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'
import { sourceUrl } from '@libtmux/api-model'
import { API_MODELS } from '../lib/api-models'
import { productApiHref, productApiRoutes } from '../lib/product-api'
import { symbolMarkdown } from '../lib/symbol-markdown'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { buildTarget } from '../lib/versions'
import { docsRedirects, workspaceRedirects } from '../lib/docs-paths'
import { llmsPage, localeProse } from '../lib/llms'
import { isIndexSource, markdownDocument, markdownSlug } from '../lib/markdown-twins'

type Props =
  | { entry: CollectionEntry<'docs'> }
  | { port: string; id: string; version: string }

/**
 * The Markdown twins of `[...slug].astro`'s pages: every prose page, and
 * every product API declaration.
 *
 * A prose twin is that page's llms-full.txt section, with code narrowed to
 * this build's port and `file=` fences filled in, so a page read alone says
 * what it says inside the whole file. The routes mirror the HTML route's real
 * entries, and `markdownSlug` puts each twin where the page footer links it.
 * A placeholder gets none: its footer links the English original's.
 */
export async function getStaticPaths() {
  const locale = buildLocale()
  const port = process.env.LIBTMUX_DOCS_PORT
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  const proseEntries = localeProse(await getCollection('docs'), locale, port, defaults)
  const prose = proseEntries
    .map(({ entry, route }) => ({
      params: { slug: markdownSlug(route, isIndexSource(entry.filePath)) },
      props: { entry } as Props,
    }))
  if (locale !== DEFAULT_LOCALE) return prose
  // Static hosting cannot issue a transport redirect for a Markdown asset.
  // Serve the canonical twin at its legacy path without adding an alias to a
  // manifest, sitemap, or search index.
  const proseByRoute = new Map(proseEntries.map(({ entry, route }) => [route, entry]))
  const aliases = docsRedirects(proseEntries.map(({ entry }) => entry), port, defaults)
    .map(({ path, target }) => {
      const entry = proseByRoute.get(target)
      if (!entry) throw new Error(`Markdown alias target is not a prose route: ${target}`)
      return {
        params: { slug: markdownSlug(path, isIndexSource(entry.filePath)) },
        props: { entry } as Props,
      }
    })
  const routes = productApiRoutes(API_MODELS, port, defaults, buildTarget(process.env).version)
    .map(({ path, model, symbol, version }) => ({ params: { slug: path }, props: { port: model.port, id: symbol.id, version } as Props }))
  const byPath = new Map(routes.map((route) => [route.params.slug, route.props]))
  const all = [...prose, ...aliases, ...routes, ...workspaceRedirects([...byPath.keys()])
    .map(({ path, target }) => ({ params: { slug: path }, props: byPath.get(target)! }))]
  const paths = all.map((route) => route.params.slug)
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate generated Markdown route')
  return all
}

export const GET: APIRoute = ({ props, site }) => {
  const headers = { 'Content-Type': 'text/markdown; charset=utf-8' }
  const route = props as Props
  if ('entry' in route) {
    const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
    return new Response(markdownDocument(llmsPage(route.entry, origin, import.meta.env.BASE_URL)), { headers })
  }
  const model = API_MODELS[route.port]
  const symbol = model.symbols.find((entry) => entry.id === route.id)!
  return new Response(symbolMarkdown({
    model, symbol,
    canonical: new URL(productApiHref(model, symbol, route.version), site ?? 'https://libtmux.org').href,
    source: sourceUrl(model, symbol),
    packageName: symbol.package ?? model.sources?.find((source) => source.product === symbol.product)?.package,
  }), { headers })
}
