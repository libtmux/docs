import type { APIRoute } from 'astro'
import { API_MODELS } from '../../../lib/api-models'
import { buildLocale } from '../../../i18n/resolve'
import { DEFAULT_LOCALE } from '../../../i18n/locales'

/** Generated library sources travel with the model extracted from their revision. */
export function getStaticPaths() {
  const model = API_MODELS[process.env.LIBTMUX_DOCS_PORT ?? '']
  if (buildLocale() !== DEFAULT_LOCALE || !model) return []
  return Object.entries(model.generatedSources ?? {}).map(([path, source]) => ({
    params: { path },
    props: { source },
  }))
}

export const GET: APIRoute = ({ props }) =>
  new Response(props.source as string, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
