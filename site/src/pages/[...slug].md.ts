import type { APIRoute } from 'astro'
import { sourceUrl } from '@libtmux/api-model'
import { API_MODELS } from '../lib/api-models'
import { productApiHref, productApiRoutes } from '../lib/product-api'
import { symbolMarkdown } from '../lib/symbol-markdown'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { buildTarget } from '../lib/versions'
import { workspaceRedirects } from '../lib/docs-paths'

export function getStaticPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults are latest. */ }
  const routes = productApiRoutes(API_MODELS, process.env.LIBTMUX_DOCS_PORT, defaults, buildTarget(process.env).version)
    .map(({ path, model, symbol, version }) => ({ params: { slug: path }, props: { port: model.port, id: symbol.id, version } }))
  const byPath = new Map(routes.map((route) => [route.params.slug, route.props]))
  return [...routes, ...workspaceRedirects([...byPath.keys()])
    .map(({ path, target }) => ({ params: { slug: path }, props: byPath.get(target)! }))]
}

export const GET: APIRoute = ({ props, site }) => {
  const model = API_MODELS[props.port]
  const symbol = model.symbols.find((entry) => entry.id === props.id)!
  return new Response(symbolMarkdown({
    model, symbol,
    canonical: new URL(productApiHref(model, symbol, props.version), site ?? 'https://libtmux.org').href,
    source: sourceUrl(model, symbol),
    packageName: model.sources?.find((source) => source.product === symbol.product)?.package,
  }), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
