/**
 * The symbols that have a source page, by reference slug.
 *
 * The source pane reads this when it must show a declaration it was not opened
 * from: a reload with `?source=`, or a related type followed inside the pane.
 * One file per port shell, beside that port's reference; the root build has no
 * port and writes nothing.
 */
import type { APIRoute } from 'astro'
import { API_MODELS } from '../../lib/api-models'
import { sourceIndex } from '../../lib/source-declarations'
import { buildLocale } from '../../i18n/resolve'
import { DEFAULT_LOCALE } from '../../i18n/locales'

export const GET: APIRoute = () => {
  const port = process.env.LIBTMUX_DOCS_PORT ?? ''
  const model = API_MODELS[port]
  if (!model || buildLocale() !== DEFAULT_LOCALE) return new Response('Not found', { status: 404 })
  return new Response(JSON.stringify({ port, symbols: sourceIndex(port, model) }), { headers: { 'Content-Type': 'application/json' } })
}
