import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { API_MODELS } from '../lib/api-models'
import { productApiHref } from '../lib/product-api'
import { symbolPreview, glossaryPreview, highlightedPreview, proseReferencePreviews, tmuxManualPreview, type LinkPreview } from '../lib/link-preview'
import { PORT_BY_SLUG, portPageUrl, referenceUrl } from '../lib/ports'
import { docsPath } from '../lib/docs-paths'
import { docsEntriesAvailable } from '../lib/page-port-links'
import { localeOf } from '../i18n/resolve'
import { symbolsForProduct } from '@libtmux/api-model'
import { buildTarget } from '../lib/versions'
import { buildLocale, DEFAULT_LOCALE } from '../i18n/locales'
import { API_GLOSSARY_PATH } from '../lib/api-glossary'
import { mcpObjects } from '../lib/mcp-catalog'
import { mcpObjectPreview } from '../lib/mcp-preview'
import { tmuxManualRoutes, tmuxManualUrl } from '../lib/tmux-manual-data'

export async function getStaticPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  const buildPort = process.env.LIBTMUX_DOCS_PORT
  const buildBase = process.env.LIBTMUX_DOCS_BASE ?? '/'
  const buildVersion = buildTarget(process.env).version
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults use latest. */ }
  const route = (href: string, preview: LinkPreview) => ({ params: { slug: href.slice(buildBase.length).replace(/\/$/, '') }, props: { preview } })
  const paths = !buildPort ? [route(API_GLOSSARY_PATH, glossaryPreview(API_GLOSSARY_PATH))] : []
  for (const { version, slug } of tmuxManualRoutes()) {
    if (slug) paths.push(route(tmuxManualUrl(version, slug), tmuxManualPreview(version, slug)))
  }
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
  // Prose pages beside the declarations, such as a workspace's exit codes: the policy marks a link to one for a card too.
  // A root build writes a product's pages, as it does a product's declarations; a port build writes all of the port's.
  const entries = docsEntriesAvailable(await getCollection('docs', (entry) => localeOf(entry.id) === DEFAULT_LOCALE), buildPort)
    .filter((entry) => entry.data.port && PORT_BY_SLUG[entry.data.port] && (buildPort || entry.data.product))
  for (const { href, preview } of proseReferencePreviews(entries.map((entry) => ({
    title: entry.data.title, description: entry.data.description,
    href: portPageUrl(PORT_BY_SLUG[entry.data.port!], buildPort ? buildVersion : defaults[entry.data.port!] ?? 'latest', docsPath(entry)),
  })))) paths.push(route(href, preview))
  return paths
}
export const GET: APIRoute = async ({ props }) => new Response(JSON.stringify(await highlightedPreview(props.preview)), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
})
