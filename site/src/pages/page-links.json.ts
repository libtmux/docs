import type { APIRoute } from 'astro'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'
import { referencePageLinks } from '../lib/reference-page-links'

/** Verified reference targets for the shell injected into native API pages. */
export const GET: APIRoute = () => {
  if (process.env.LIBTMUX_DOCS_PORT || buildLocale() !== DEFAULT_LOCALE) {
    return new Response(null, { status: 404 })
  }
  return new Response(JSON.stringify(referencePageLinks()), { headers: { 'Content-Type': 'application/json' } })
}
