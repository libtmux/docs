import type { APIRoute } from 'astro'
import { CONCEPTS } from '@libtmux/api-model'
import { referenceAlternatives } from '../lib/api-models'
import { PORTS, referenceUrl } from '../lib/ports'
import { buildLocale } from '../i18n/resolve'
import { DEFAULT_LOCALE } from '../i18n/locales'

/** Verified reference targets for the shell injected into native API pages. */
export const GET: APIRoute = () => {
  if (process.env.LIBTMUX_DOCS_PORT || buildLocale() !== DEFAULT_LOCALE) {
    return new Response(null, { status: 404 })
  }
  const symbols: Record<string, Record<string, { port: string; href: string; label: string }[]>> = {}
  for (const concept of Object.values(CONCEPTS)) {
    for (const [port, publicId] of Object.entries(concept.symbols)) {
      const entries = referenceAlternatives(port, publicId).flatMap((alternative) =>
        alternative.ports.flatMap((entry) => entry.href
          ? [{ port: entry.port, href: entry.href, label: alternative.label }]
          : []),
      )
      ;(symbols[port] ??= {})[publicId] = entries
    }
  }
  return new Response(JSON.stringify({
    schema: 1,
    indexes: Object.fromEntries(PORTS.map((port) => [port.slug, referenceUrl(port)])),
    symbols,
  }), { headers: { 'Content-Type': 'application/json' } })
}
