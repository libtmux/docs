import { symbolsForProduct, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, pageSlug, referenceAlternatives, referenceHref } from './api-models'
import { DOC_PRODUCTS, PORT_BY_SLUG, PORTS, portHomeUrl, portPageUrl, productAvailable, referenceUrl } from './ports'
import { docsPath, docsRoutePath, type DocsPage } from './docs-paths'
import { productApiHref } from './product-api'
import { MCP_REFERENCE, equivalentMcpObject, mcpObjectAt, type McpSection } from './mcp-reference'
import { DEFAULT_LOCALE, LOCALES } from '../i18n/locales'

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
  links: { href: string; label?: string; preserveFragment?: boolean; fallback?: 'section' }[]
  /** A separate exit when this language has no equivalent page. */
  home?: { href: string; label: string }
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

/** A port's authored page takes precedence over shared prose at the same URL. */
export function docsEntriesAvailable<T extends DocsPage>(entries: readonly T[], port?: string): T[] {
  const selected = new Map<string, T>()
  const claims = new Map<string, T>()
  for (const entry of entries) {
    if (!docsEntryAvailable(entry, port)) continue
    const locale = LOCALES.find((value) => value !== DEFAULT_LOCALE && entry.id.startsWith(`${value}/`))
    const source = locale ? { ...entry, id: entry.id.slice(locale.length + 1) } : entry
    const route = docsRoutePath(source, port)
    const key = `${locale ?? DEFAULT_LOCALE}:${route}`
    const ownerKey = `${key}:${entry.data.port ?? 'shared'}`
    const previous = claims.get(ownerKey)
    if (previous) throw new Error(`Duplicate documentation route ${route}: ${previous.id} and ${entry.id}`)
    claims.set(ownerKey, entry)
    if (!selected.has(key) || entry.data.port === port) selected.set(key, entry)
  }
  return [...selected.values()]
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
  const path = pagePath.replace(/^\/+|\/+$/g, '').replace(/^tmux\/(?=guides(?:\/|$)|topics(?:\/|$)|concepts(?:\/|$)|examples(?:\/|$))/, '')
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
  const entries = own?.data.equivalence
    ? docs.filter((entry) => entry.data.equivalence === own.data.equivalence && entry.data.product === own.data.product)
    : paths.flatMap((candidate) => docs.filter((entry) => docsPath(entry) === candidate || entry.data.aliases?.includes(candidate)))
  const product = /^(mcp|workspace)\//.exec(path)?.[1] as 'mcp' | 'workspace' | undefined
  const protocol = /^mcp\/(tools|prompts|resources)(?:\/(.+))?$/.exec(path)
  const object = protocol && portSlug ? mcpObjectAt(portSlug, protocol[1] as McpSection, protocol[2]) : undefined

  return PORTS.map((port) => {
    const targetVersion = port.slug === portSlug ? version : (defaults[port.slug] ?? 'latest')
    let links: PagePortLink['links'] = []
    if (!path) {
      links = [{ href: portHomeUrl(port, targetVersion) }]
    } else if ((isReference && !symbolSlug) || path === 'api') {
      if (API_MODELS[port.slug] || port.parentLibrary) links = [{ href: referenceUrl(port, targetVersion) }]
    } else if (/^(?:(?:mcp|workspace)\/)?reference\/glossary$/.test(path)) {
      const model = API_MODELS[port.slug]
      if (model && (!product || symbolsForProduct(model, product).length)) {
        links = [{ href: `${referenceUrl(port, targetVersion, product ?? 'core')}glossary/`, preserveFragment: true }]
      }
    } else if (symbol) {
      const targets = new Map<string, { label: string; note?: string }>()
      for (const alternative of alternatives) {
        const match = alternative.ports.find((p) => p.port === port.slug)
        // Resolve against the target port's version, which this caller knows.
        const targetSymbol = match?.publicId
          ? API_MODELS[port.slug]?.symbols.find((entry) => (entry.publicId ?? entry.id) === match.publicId) : undefined
        const href = targetSymbol ? productApiHref(API_MODELS[port.slug], targetSymbol, targetVersion) : match?.href
        if (href && !targets.has(href)) targets.set(href, {
          label: targetSymbol ? `${targetSymbol.name} (${match?.kind ?? targetSymbol.kind})` : alternative.label,
          note: match?.note,
        })
      }
      links = [...targets].map(([href, target]) => ({ href,
        ...(targets.size > 1 || target.note ? { label: target.label } : {}),
      }))
      if (port.slug === symbolPort) {
        const href = productReference
          ? portPageUrl(port, targetVersion, path)
          : referenceHref(symbolPort, symbol.publicId ?? symbol.id, targetVersion)
        if (href) links = [{ href }]
      }
    } else if (object) {
      const target = productAvailable(port, 'mcp') ? equivalentMcpObject(portSlug!, object, port.slug) : undefined
      if (target) links = [{ href: portPageUrl(port, targetVersion, target.path) }]
      else if (productAvailable(port, 'mcp') && MCP_REFERENCE[port.slug]) links = [{ href: portPageUrl(port, targetVersion, `mcp/${object.section}`), label: `${object.section[0].toUpperCase()}${object.section.slice(1)} overview`, fallback: 'section' }]
    } else if (protocol && !protocol[2]) {
      if (productAvailable(port, 'mcp') && MCP_REFERENCE[port.slug]) links = [{ href: portPageUrl(port, targetVersion, path) }]
    } else if (!port.parentLibrary && (SHARED_PAGE_PATHS as readonly string[]).includes(path)) {
      links = [{ href: portPageUrl(port, targetVersion, path) }]
    } else {
      const eligible = entries.filter((entry) => docsEntryAvailable(entry, port.slug)
        && (!product || productAvailable(port, product)))
      const owned = eligible.filter((entry) => entry.data.port === port.slug)
      const targets = owned.length ? owned : eligible
      if (own?.data.equivalence && targets.length) {
        const selected = port.slug === portSlug ? [own] : targets
        links = [...new Map(selected.map((entry) => [docsPath(entry), entry])).values()]
          .sort((a, b) => docsPath(a).localeCompare(docsPath(b)))
          .map((entry) => ({
            href: portPageUrl(port, targetVersion, docsPath(entry)),
            ...(selected.length > 1 ? { label: entry.data.title ?? docsPath(entry) } : {}),
          }))
      } else if (targets[0]) links = [{ href: portPageUrl(port, targetVersion, docsPath(targets[0])) }]
      else {
        // A language-specific article may have no counterpart. Keep its
        // section reachable, and label that destination as an overview.
        const sectionPath = /^((?:(?:mcp|workspace)\/(?:internals\/)?)?)(guides|examples|concepts|topics)(?:\/|$)/.exec(path)
        const group = own?.data.sidebar?.group?.toLowerCase()
        const section = sectionPath?.[2] ?? (group && /^(guides|examples|concepts|topics)$/.test(group) ? group : undefined)
        const overviewPath = section && `${sectionPath?.[1] ?? (product ? `${product}/` : '')}${section}`
        const overview = overviewPath && (!product || productAvailable(port, product))
          && docs.find((entry) => docsPath(entry) === overviewPath && docsEntryAvailable(entry, port.slug))
        if (overview && section && overviewPath) links = [{
          href: portPageUrl(port, targetVersion, overviewPath),
          label: `${section[0].toUpperCase()}${section.slice(1)} overview`,
          fallback: 'section',
        }]
      }
    }
    const homeProduct = product && productAvailable(port, product) ? product : undefined
    const home = {
      href: homeProduct ? portPageUrl(port, targetVersion, homeProduct) : portHomeUrl(port, targetVersion),
      label: `Go to ${port.name}${homeProduct ? ` ${DOC_PRODUCTS[homeProduct].label}` : ''} home`,
    }
    return { port: port.slug, name: port.name, links, home }
  })
}
