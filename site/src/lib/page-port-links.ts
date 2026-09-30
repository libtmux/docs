import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, pageSlug, referenceAlternatives, referenceHref } from './api-models'
import { PORT_BY_SLUG, PORTS, portHomeUrl, portPageUrl, productAvailable, referenceUrl } from './ports'
import { docsPath, type DocsPage } from './docs-paths'
import { productApiHref } from './product-api'
import { MCP_REFERENCE, equivalentMcpTool } from './mcp-reference'
import { LOCALES } from '../i18n/locales'

/**
 * Every symbol by the route it answers on, keyed by port.
 *
 * A reference page's path no longer carries its port — it sits under one —
 * so the port comes from the build rather than from the path's second
 * segment.
 */
const symbolsByRoute = new Map<string, ApiSymbol>(Object.entries(API_MODELS).flatMap(([port, model]) =>
  model.symbols.map((symbol) => [
    `${port}/${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}`,
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
  if (port && entry.data.supportedPorts && !entry.data.supportedPorts.includes(port)) return false
  if (port && PORT_BY_SLUG[port]?.parentLibrary) {
    if (entry.data.product) return false
    const first = entry.id.split('/')[0]
    const id = (LOCALES as readonly string[]).includes(first) ? entry.id.slice(first.length + 1) : entry.id
    return entry.data.port === port || (!entry.data.port && /^(concepts(?:\/|$)|notices$)/.test(id))
  }
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
  const isReference = path === 'reference' || path.startsWith('reference/')
  const symbolSlug = isReference ? path.slice('reference/'.length) || undefined : undefined
  const productReference = /^(mcp|workspace)\/reference\/(.+)$/.exec(path)
  const symbol = portSlug
    ? symbolsByRoute.get(`${portSlug}/${productReference ? productReference[2] : (symbolSlug ?? '')}`)
    : undefined
  const symbolPort = portSlug
  const alternatives = symbol ? referenceAlternatives(symbolPort!, symbol.publicId ?? symbol.id) : []
  const own = docs.find((entry) => entry.data.port === portSlug && docsPath(entry) === path)
  const paths = [path, ...(own?.data.aliases ?? [])]
  const entries = paths.flatMap((candidate) => docs.filter((entry) => docsPath(entry) === candidate || entry.data.aliases?.includes(candidate)))
  const tool = path.startsWith('mcp/tools/') && portSlug
    ? MCP_REFERENCE[portSlug]?.registrations.find((entry) => entry.wireName === path.slice('mcp/tools/'.length)) : undefined

  return PORTS.map((port) => {
    const targetVersion = port.slug === portSlug ? version : (defaults[port.slug] ?? 'latest')
    let links: PagePortLink['links'] = []
    if (!path) {
      links = [{ href: portHomeUrl(port, targetVersion) }]
    } else if ((isReference && !symbolSlug) || path === 'api') {
      if (API_MODELS[port.slug] || port.parentLibrary) links = [{ href: referenceUrl(port, targetVersion) }]
    } else if (symbol) {
      for (const alternative of alternatives) {
        const match = alternative.ports.find((p) => p.port === port.slug)
        // Resolved here rather than taken from `match.href`, because the
        // equivalent lives under the *target* port's version, which this
        // caller knows and `referenceAlternatives` does not.
        const targetSymbol = match?.publicId
          ? API_MODELS[port.slug]?.symbols.find((entry) => (entry.publicId ?? entry.id) === match.publicId) : undefined
        const href = targetSymbol ? productApiHref(API_MODELS[port.slug], targetSymbol, targetVersion) : match?.href
        if (href && !links.some((link) => link.href === href)) {
          links.push({ href, label: alternative.label })
        }
      }
      if (port.slug === symbolPort) {
        const href = productReference
          ? portPageUrl(port, targetVersion, path)
          : referenceHref(symbolPort, symbol.publicId ?? symbol.id, targetVersion)
        if (href) links = [{ href }]
      }
    } else if (tool) {
      const target = productAvailable(port, 'mcp') ? equivalentMcpTool(portSlug!, tool.wireName, port.slug) : undefined
      if (target) links = [{ href: portPageUrl(port, targetVersion, `mcp/tools/${target.wireName}`) }]
    } else if (path === 'mcp/tools') {
      if (productAvailable(port, 'mcp')) links = [{ href: portPageUrl(port, targetVersion, path) }]
    } else if (!port.parentLibrary && (SHARED_PAGE_PATHS as readonly string[]).includes(path)) {
      links = [{ href: portPageUrl(port, targetVersion, path) }]
    } else {
      const target = entries.find((entry) => entry.data.port === port.slug && docsEntryAvailable(entry, port.slug))
        ?? entries.find((entry) => docsEntryAvailable(entry, port.slug))
      if (target) links = [{ href: portPageUrl(port, targetVersion, docsPath(target)) }]
    }
    return { port: port.slug, name: port.name, links }
  })
}
