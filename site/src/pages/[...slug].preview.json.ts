import type { APIRoute } from 'astro'
import { API_MODELS } from '../lib/api-models'
import { productApiHref } from '../lib/product-api'
import { symbolPreview, glossaryPreview, highlightedPreview, type LinkPreview } from '../lib/link-preview'
import { PORT_BY_SLUG, referenceUrl } from '../lib/ports'
import { symbolsForProduct } from '@libtmux/api-model'
import { buildTarget } from '../lib/versions'
import { buildLocale, DEFAULT_LOCALE } from '../i18n/locales'
import { API_GLOSSARY_PATH } from '../lib/api-glossary'
import { mcpObjects } from '../lib/mcp-catalog'
import { mcpObjectPreview } from '../lib/mcp-preview'

export function getStaticPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  const buildPort = process.env.LIBTMUX_DOCS_PORT
  const buildBase = process.env.LIBTMUX_DOCS_BASE ?? '/'
  const buildVersion = buildTarget(process.env).version
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults use latest. */ }
  const route = (href: string, preview: LinkPreview) => ({ params: { slug: href.slice(buildBase.length).replace(/\/$/, '') }, props: { preview } })
  const paths = !buildPort ? [route(API_GLOSSARY_PATH, glossaryPreview(API_GLOSSARY_PATH))] : []
  for (const [port, model] of Object.entries(API_MODELS)) {
    if (buildPort && port !== buildPort) continue
    const version = buildPort ? buildVersion : defaults[port] ?? 'latest'
    const info = PORT_BY_SLUG[port]
    for (const symbol of model.symbols) {
      if (!buildPort && (!symbol.product || symbol.product === 'core' || symbol.apiScope === 'internal')) continue
      paths.push(route(productApiHref(model, symbol, version), symbolPreview(model, symbol, version)))
    }
    for (const product of ['core', 'mcp', 'workspace'] as const) {
      if (!buildPort && product === 'core') continue
      if (product !== 'core' && !symbolsForProduct(model, product).length) continue
      const href = `${referenceUrl(info, version, product)}glossary/`
      paths.push(route(href, glossaryPreview(href)))
    }
    for (const object of mcpObjects(port)) {
      const preview = mcpObjectPreview(port, version, object)
      paths.push(route(preview.href, preview))
    }
  }
  return paths
}
export const GET: APIRoute = async ({ props }) => new Response(JSON.stringify(await highlightedPreview(props.preview)), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
