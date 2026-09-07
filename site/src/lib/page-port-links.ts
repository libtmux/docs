import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, pageSlug, referenceAlternatives, referenceHref } from './api-models'
import { PORTS, portHomeUrl, portPageUrl, referenceUrl } from './ports'

const symbolsByRoute = new Map<string, ApiSymbol>(Object.entries(API_MODELS).flatMap(([port, model]) =>
  model.symbols.map((symbol) => [
    `reference/${port}/${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}`,
    symbol,
  ] as const),
))

/** Static routes emitted in each port build, verified against assembled pages. */
export const SHARED_PAGE_PATHS = ['mcp', 'mcp/tools', 'parity', 'search', 'translations'] as const

export interface PagePortLink {
  port: string
  name: string
  links: { href: string; label?: string }[]
}

interface DocsEntry {
  id: string
  data: { port?: string }
}

/** Matches the port restriction used by the prose route. */
export function docsEntryAvailable(entry: DocsEntry, port?: string): boolean {
  return !port || !entry.data.port || entry.data.port === port
}

/** Links only to generated prose pages or verified reference equivalents. */
export function pagePortLinks({
  pagePath,
  portSlug,
  version,
  defaults,
  docs,
}: {
  pagePath: string
  portSlug?: string
  version: string
  defaults: Record<string, string>
  docs: DocsEntry[]
}): PagePortLink[] {
  const path = pagePath.replace(/^\/+|\/+$/g, '')
  const [, referencePort, symbolSlug] = path.split('/')
  const isReference = path === 'reference' || path.startsWith('reference/')
  const symbol = symbolsByRoute.get(path)
  const alternatives = symbol ? referenceAlternatives(referencePort, symbol.publicId ?? symbol.id) : []
  const entry = docs.find((e) => e.id === path)

  return PORTS.map((port) => {
    const targetVersion = port.slug === portSlug ? version : (defaults[port.slug] ?? 'latest')
    let links: PagePortLink['links'] = []
    if (!path) {
      links = [{ href: portHomeUrl(port, targetVersion) }]
    } else if ((isReference && !symbolSlug) || path === 'api') {
      if (API_MODELS[port.slug]) links = [{ href: referenceUrl(port) }]
    } else if (symbol) {
      for (const alternative of alternatives) {
        const match = alternative.ports.find((p) => p.port === port.slug)
        if (match?.href && !links.some((link) => link.href === match.href)) {
          links.push({ href: match.href, label: alternative.label })
        }
      }
      if (port.slug === referencePort) {
        const href = referenceHref(referencePort, symbol.publicId ?? symbol.id)
        if (href) links = [{ href }]
      }
    } else if ((SHARED_PAGE_PATHS as readonly string[]).includes(path) || (entry && docsEntryAvailable(entry, port.slug))) {
      links = [{ href: portPageUrl(port, targetVersion, path) }]
    }
    return { port: port.slug, name: port.name, links }
  })
}
