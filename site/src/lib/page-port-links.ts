import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, pageSlug, referenceAlternatives, referenceHref } from './api-models'
import { PORTS, portHomeUrl, portPageUrl, referenceUrl } from './ports'
import { docsPath, type DocsPage } from './docs-paths'
import { productApiHref } from './product-api'
import { MCP_REFERENCE, equivalentMcpTool } from './mcp-reference'

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

/** Matches the port restriction used by the prose route. */
export function docsEntryAvailable(entry: DocsPage, port?: string): boolean {
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
  docs: DocsPage[]
}): PagePortLink[] {
  const path = pagePath.replace(/^\/+|\/+$/g, '')
  const [, referencePort, symbolSlug] = path.split('/')
  const isReference = path === 'reference' || path.startsWith('reference/')
  const productReference = /^(mcp|workspace)\/(?:internals\/)?api\/(.+)$/.exec(path)
  const symbol = symbolsByRoute.get(productReference ? `reference/${portSlug}/${productReference[2]}` : path)
  const symbolPort = productReference ? portSlug : referencePort
  const alternatives = symbol ? referenceAlternatives(symbolPort!, symbol.publicId ?? symbol.id) : []
  const entries = docs.filter((entry) => docsPath(entry) === path)
  const tool = path.startsWith('mcp/tools/') && portSlug
    ? MCP_REFERENCE[portSlug]?.registrations.find((entry) => entry.wireName === path.slice('mcp/tools/'.length)) : undefined

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
        const targetSymbol = productReference && match?.publicId
          ? API_MODELS[port.slug]?.symbols.find((entry) => (entry.publicId ?? entry.id) === match.publicId) : undefined
        const href = targetSymbol ? productApiHref(API_MODELS[port.slug], targetSymbol, targetVersion) : match?.href
        if (href && !links.some((link) => link.href === href)) {
          links.push({ href, label: alternative.label })
        }
      }
      if (port.slug === symbolPort) {
        const href = productReference ? portPageUrl(port, targetVersion, path) : referenceHref(symbolPort, symbol.publicId ?? symbol.id)
        if (href) links = [{ href }]
      }
    } else if (tool) {
      const target = equivalentMcpTool(portSlug!, tool.wireName, port.slug)
      if (target) links = [{ href: portPageUrl(port, targetVersion, `mcp/tools/${target.wireName}`) }]
    } else if ((SHARED_PAGE_PATHS as readonly string[]).includes(path) || entries.some((entry) => docsEntryAvailable(entry, port.slug))) {
      links = [{ href: portPageUrl(port, targetVersion, path) }]
    }
    return { port: port.slug, name: port.name, links }
  })
}
