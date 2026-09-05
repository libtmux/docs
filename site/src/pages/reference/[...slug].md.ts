import type { APIRoute } from 'astro'
import { API_MODELS } from '../../lib/api-models'
import { pageSlug } from '@libtmux/api-model'
import { symbolMarkdown } from '../../lib/symbol-markdown'
import { PORT_BY_SLUG } from '../../lib/ports'

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
  if (process.env.LIBTMUX_DOCS_PORT) return []
  const paths: { params: { slug: string }; props: { port: string; id: string } }[] = []
  for (const [port, model] of Object.entries(API_MODELS)) {
    for (const symbol of model.symbols) {
      paths.push({
        params: { slug: `${port}/${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}` },
        props: { port, id: symbol.id },
      })
    }
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
  const repo = (model as { repo?: string }).repo
  const rev = (model as { revision?: string }).revision
  const file = symbol.source?.file

  return new Response(
    symbolMarkdown({
      model,
      symbol,
      canonical: `${origin}/reference/${port}/${slug}/`,
      source: repo && rev && file
        ? `https://github.com/${repo}/blob/${rev}/${file}${symbol.source?.line ? `#L${symbol.source.line}` : ''}`
        : undefined,
      packageName: PORT_BY_SLUG[port]?.packageName,
    }),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  )
}
