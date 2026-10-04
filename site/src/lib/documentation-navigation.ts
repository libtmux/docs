import { getSidebar, type SidebarItem, type SidebarLinkItem } from './sidebar'
import { documentationAreas } from './port-documentation'
import { PORT_BY_SLUG, portPageUrl, referenceUrl, type DocProduct } from './ports'
import { API_MODELS } from './api-models'
import { productApiHref, productApiRoots } from './product-api'
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales'
import { withPortRoot } from './site-root'
import { tmuxReferenceUrl } from './tmux-reference'

export interface DocumentationSection {
  id: string
  label: string
  href?: string
  items: SidebarItem[]
  alternatives?: SidebarLinkItem[]
}

export interface DocumentationSurface {
  id: string
  label: string
  href: string
  sections: DocumentationSection[]
}

const labels: Record<string, string> = {
  home: 'Home', guides: 'Guides', tutorials: 'Tutorials', topics: 'Topics', concepts: 'Concepts',
  examples: 'Examples', reference: 'Reference', configuration: 'Configuration', internals: 'Internals',
  async: 'Async', runtimes: 'Runtimes', notices: 'Third-party notices',
}
const standardSections = ['home', 'guides', 'tutorials', 'topics', 'concepts', 'examples', 'reference']
const linksOf = (items: SidebarItem[]): SidebarLinkItem[] => items.flatMap((item) => item.type === 'link'
  ? [item] : [...(item.href ? [{ type: 'link' as const, label: item.label, href: item.href }] : []), ...item.items])

/** Group actual published destinations, not a guessed matrix of app routes. */
export function buildDocumentationSurfaces(
  port: string, version: string, menus: Partial<Record<'core' | DocProduct, SidebarItem[]>>,
): DocumentationSurface[] {
  const info = PORT_BY_SLUG[port]
  const base = portPageUrl(info, version)
  return documentationAreas(port).filter((domain) => domain.kind !== 'unavailable' && (domain.id === 'core' || domain.product))
    .sort((a, b) => ['core', 'mcp', 'workspace'].indexOf(a.product ?? 'core') - ['core', 'mcp', 'workspace'].indexOf(b.product ?? 'core'))
    .map((domain) => {
    const id = domain.product ?? 'core'
    const prefix = domain.product ? `${domain.product}/` : ''
    const href = portPageUrl(info, version, domain.route)
    const home: DocumentationSection = { id: 'home', label: 'Home', href, items: [] }
    const sections = new Map<string, DocumentationSection>([['home', home]])
    const seen = new Set<string>()
    for (const link of linksOf(menus[id] ?? [])) {
      if (seen.has(link.href)) continue
      seen.add(link.href)
      const route = link.href.startsWith(base) ? link.href.slice(base.length).replace(/\/$/, '') : undefined
      const relative = route === domain.route ? '' : route?.startsWith(prefix) ? route.slice(prefix.length) : undefined
      let key = relative?.split('/')[0] || 'home'
      if (link.external || key === 'cli' || key === 'tools' || key === 'api') key = 'reference'
      const section = sections.get(key) ?? { id: key, label: labels[key] ?? link.label, items: [] }
      if (!section.href && relative === key && !link.external) section.href = link.href
      section.items.push(link)
      sections.set(key, section)
    }
    const reference: DocumentationSection = sections.get('reference') ?? { id: 'reference', label: 'Reference', items: [] }
    reference.href = referenceUrl(info, version, id)
    if (domain.product) {
      // Protocol tools, CLI contracts and the implementation API are distinct
      // references within the same application, with their own native URLs.
      const groups = new Map<string, SidebarLinkItem[]>()
      for (const item of linksOf(reference.items)) {
        const route = item.href.slice(base.length)
        const label = route.startsWith(`${prefix}cli/`) ? 'CLI reference'
          : route.startsWith(`${prefix}tools/`) ? 'Tools'
          : domain.product === 'workspace' && item.href !== reference.href ? 'CLI contracts' : 'Language API'
        const entries = groups.get(label) ?? []
        entries.push(item)
        groups.set(label, entries)
      }
      const api = groups.get('Language API') ?? []
      if (API_MODELS[port]) api.push(...productApiRoots(API_MODELS[port], domain.product).map((symbol) => ({
        type: 'link' as const, label: symbol.name, kind: symbol.kind,
        href: productApiHref(API_MODELS[port], symbol, version),
      })))
      groups.set('Language API', api)
      reference.items = [...groups].map(([label, items]) => ({ type: 'group', label, items }))
    } else {
      reference.alternatives = linksOf(reference.items).filter((item) => item.href !== reference.href)
    }
    sections.set('reference', reference)
    // Some named areas have no overview. Their first real page is a useful
    // destination without inventing an overview route.
    for (const section of sections.values()) section.href ??= linksOf(section.items)[0]?.href
    const ordered = [...sections.values()].filter((section) => section.href).sort((a, b) => {
      const rank = (key: string) => standardSections.includes(key) ? standardSections.indexOf(key) : standardSections.length
      return rank(a.id) - rank(b.id)
    })
    home.items = [
      { type: 'link', label: 'Overview', href },
      ...ordered.filter((section) => section.id !== 'home' && section.href)
        .map((section): SidebarLinkItem => ({ type: 'link', label: section.label, href: section.href! })),
    ]
    return { id, label: domain.id === 'core' ? 'Core Library' : domain.label, href, sections: ordered }
  })
}

const cache = new Map<string, Promise<DocumentationSurface[]>>()

/** Reuse collection queries across every declaration in a static port build. */
export function getDocumentationSurfaces(port: string | undefined, version: string, locale: Locale = DEFAULT_LOCALE) {
  const key = `${port}/${version}/${locale}`
  const build = async () => {
    if (!port) {
      const menus = await getSidebar(undefined, version, locale)
      const current = version === 'latest'
      const sections: DocumentationSection[] = [
        { id: 'home', label: current ? 'Home' : 'Current docs →', href: withPortRoot('/tmux/'), items: [] },
        ...(current ? menus : []).flatMap((item) => item.type === 'group' && item.href
          ? [{ id: item.label.toLowerCase(), label: item.label, href: item.href, items: item.items }] : []),
        { id: 'manual', label: 'Manual', href: tmuxReferenceUrl(version), items: [] },
      ]
      sections[0].items = sections.filter((section) => section.href).map((section) => ({
        type: 'link', label: section.label, href: section.href!,
      }))
      return [{ id: 'tmux', label: 'Just tmux', href: withPortRoot('/tmux/'), sections }]
    }
    const products = documentationAreas(port).flatMap((domain) => domain.kind !== 'unavailable' && domain.product ? [domain.product] : [])
    const menus = await Promise.all(['core' as const, ...products].map(async (product) =>
      [product, await getSidebar(port, version, locale, product === 'core' ? undefined : product)] as const))
    return buildDocumentationSurfaces(port, version, Object.fromEntries(menus))
  }
  if (import.meta.env.DEV) return build()
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)!
}

/** URL-derived selection also works on direct loads, reloads and browser history. */
export function currentDocumentation(surfaces: DocumentationSurface[], currentPath: string) {
  const surface = surfaces.filter((entry) => currentPath.startsWith(entry.href))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? surfaces[0]
  const path = currentPath.slice(surface.href.length).split('/')[0] || 'home'
  const key = path === 'cli' || path === 'tools' || path === 'api' ? 'reference' : path
  const section = surface.sections.filter((entry) => entry.id !== 'home' && entry.href && currentPath.startsWith(entry.href))
    .sort((a, b) => b.href!.length - a.href!.length)[0]
    ?? surface.sections.find((entry) => entry.id === key) ?? surface.sections[0]
  return { surface, section }
}
