import { CONCEPTS } from '@libtmux/api-model'
import { referenceAlternatives } from './api-models'
import { PORTS, referenceUrl } from './ports'
import { defaultVersionFor } from './versions'

/** Verified native-signature counterparts, also published for external shells. */
export function referencePageLinks() {
  const symbols: Record<string, Record<string, { port: string; href: string; label: string }[]>> = {}
  for (const concept of Object.values(CONCEPTS)) {
    for (const [port, publicId] of Object.entries(concept.symbols)) {
      const entries = referenceAlternatives(port, publicId).flatMap((alternative) =>
        alternative.ports.flatMap((entry) =>
          entry.href ? [{ port: entry.port, href: entry.href, label: alternative.label }] : [],
        ),
      )
      ;(symbols[port] ??= {})[publicId] = entries
    }
  }
  return {
    schema: 1,
    indexes: Object.fromEntries(PORTS.map((port) => [port.slug, referenceUrl(port, defaultVersionFor(port.slug))])),
    symbols,
  }
}
