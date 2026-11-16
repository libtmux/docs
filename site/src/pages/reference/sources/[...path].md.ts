import type { APIRoute } from 'astro'
import { API_MODELS } from '../../../lib/api-models'
import { sourceMarkdown, sourceRoutes, type SourcePageProps } from '../../../lib/source-declarations'
import { buildLocale } from '../../../i18n/resolve'
import { DEFAULT_LOCALE } from '../../../i18n/locales'

/** `sources/<file>.md`: the source page as its file, the Markdown twin the HTML page names. */
export function getStaticPaths() {
  const port = process.env.LIBTMUX_DOCS_PORT ?? ''
  const model = API_MODELS[port]
  if (buildLocale() !== DEFAULT_LOCALE || !model) return []
  return sourceRoutes(port, model)
}

export const GET: APIRoute = ({ props }) => new Response(sourceMarkdown(props as SourcePageProps), {
  headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
})
