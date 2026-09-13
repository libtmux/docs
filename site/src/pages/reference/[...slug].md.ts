import type { APIRoute } from 'astro'
import { API_MODELS } from '../../lib/api-models'
import { pageSlug, symbolsForProduct } from '@libtmux/api-model'
import { symbolMarkdown } from '../../lib/symbol-markdown'
import { PORT_BY_SLUG, referenceUrl } from '../../lib/ports'
import { DEFAULT_LOCALE } from '../../i18n/locales'
import { buildLocale } from '../../i18n/resolve'
import { buildTarget } from '../../lib/versions'

/**
 * `/reference/<port>/<symbol>.md` — the page, as its source.
 *
 * Same generator as the copy button on the HTML page, which fetches this URL
 * rather than carrying its own copy: two renderings of the same document
 * drift, and the difference only shows when someone pastes one and reads the
 * other.
 *
 * Only the root build emits these, for the same reason the HTML route does —
 * the reference is not rendered inside the fourteen shell builds.
 */
export async function getStaticPaths() {
  // This port's shell, in the default locale only, matching the HTML route:
  // the reference is not translated, so a twin under another locale would be
  // the English body wearing that locale's prefix.
  const port = process.env.LIBTMUX_DOCS_PORT
  if (!port) return []
  if (buildLocale() !== DEFAULT_LOCALE) return []
  const model = API_MODELS[port]
  if (!model) return []
  const productIds = new Set([
    ...symbolsForProduct(model, 'mcp'),
    ...symbolsForProduct(model, 'workspace'),
  ].map((symbol) => symbol.id))
  const paths: { params: { slug: string }; props: { port: string; id: string } }[] = []
  for (const symbol of model.symbols) {
    if (productIds.has(symbol.id)) continue
    paths.push({
      params: { slug: symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id) },
      props: { port, id: symbol.id },
    })
  }
  return paths
}

export const GET: APIRoute = ({ props, site }) => {
  const { port, id } = props as { port: string; id: string }
  const model = API_MODELS[port]
  const symbol = model?.symbols.find((s) => s.id === id)
  if (!model || !symbol) return new Response('Not found', { status: 404 })

  const origin = (site?.origin ?? 'https://libtmux.org').replace(/\/$/, '')
  const slug = symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)
  const repo = symbol.source.repo ?? model.repo
  const rev = symbol.source.revision ?? model.revision
  const file = symbol.source?.file

  return new Response(
    symbolMarkdown({
      model,
      symbol,
      canonical: `${origin}${referenceUrl(PORT_BY_SLUG[port]!, buildTarget(process.env).version)}${slug}/`,
      source: repo && rev && file
        ? `https://github.com/${repo}/blob/${rev}/${file}${symbol.source?.line ? `#L${symbol.source.line}` : ''}`
        : undefined,
      packageName: PORT_BY_SLUG[port]?.packageName,
    }),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  )
}
