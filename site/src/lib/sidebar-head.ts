/**
 * What the left column says about where a reader is, one level at a time.
 *
 * A port has four levels, Port, Product, Section and Page. The column's head
 * names the level its rows list and links one level higher; the rows below it
 * are that level's contents. The levels, the up row, the scope title and the
 * rows are the design system's SidebarHead (record 0021): a reader climbs from
 * any page to the port home and on to every language without the Back button.
 */
import { hasPackageInstalls, PORT_BY_SLUG, portPageUrl, productAvailable, productStatus, type ProductStatus } from './ports'
import { REGISTRY } from './registry'
import { withRoot } from './site-root'
import { currentDocumentation, getDocumentationSurfaces, type DocumentationSection, type DocumentationSurface } from './documentation-navigation'
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales'
import type { SidebarItem, SidebarLinkItem } from './sidebar'

export type HeadLevel = 'port' | 'product' | 'section'

export interface HeadLink {
  label: string
  href: string
}

export interface SidebarHeadData {
  level: HeadLevel
  /** Exactly one level higher than the one the column lists. */
  up: HeadLink
  /** The scope the rows below belong to, linking to that scope's home. */
  title: HeadLink & { status?: ProductStatus }
}

interface Selection {
  surface: DocumentationSurface
  section: DocumentationSection
}

/** The head for the column of a port page: Port goes up to every language, Product to its port, Section and Page to their product. */
export function sidebarHead(port: string, version: string, { surface, section }: Selection): SidebarHeadData {
  const info = PORT_BY_SLUG[port]
  if (!info) throw new Error(`sidebar-head: unknown port slug "${port}"`)
  const home = portPageUrl(info, version)
  if (surface.id === 'home') {
    // The language's maturity is its core library's.
    return { level: 'port', up: { label: 'All languages', href: withRoot('/') },
      title: { label: info.name, href: home, status: productStatus(info, 'core', REGISTRY) } }
  }
  if (section.id === 'home') {
    return { level: 'product', up: { label: info.name, href: home },
      title: { label: surface.label, href: surface.href, ...(surface.status ? { status: surface.status } : {}) } }
  }
  // A section carries no badge of its own: it inherits its product's.
  return { level: 'section', up: { label: surface.label, href: surface.href }, title: { label: section.label, href: section.href ?? surface.href } }
}

/** The head for the page at `pathname` in a port's documentation, for a page that does not render the docs sidebar itself. */
export async function sidebarHeadAt(port: string | undefined, version: string, pathname: string, locale: Locale = DEFAULT_LOCALE): Promise<SidebarHeadData | undefined> {
  if (!port) return undefined
  const surfaces = await getDocumentationSurfaces(port, version, locale)
  return surfaces.length ? sidebarHead(port, version, currentDocumentation(surfaces, pathname)) : undefined
}

const leaves = (items: SidebarItem[]): SidebarLinkItem[] =>
  items.flatMap((item) => item.type === 'link' ? [item] : leaves(item.items))

/**
 * The pages a section holds, for the count beside its row.
 *
 * The section's own overview is not one of its pages, and a reference holds
 * declarations rather than pages, so it carries no count; an empty section
 * shows none rather than "0".
 */
export function pageCount(section: DocumentationSection): number | undefined {
  if (section.id === 'reference' || section.id === 'home') return undefined
  const pages = new Set(leaves(section.items).filter((item) => !item.external && !item.disabled && item.href !== section.href)
    .map((item) => item.href.split('#')[0]))
  return pages.size || undefined
}

/** Whether a product's home carries an installer for the Install row to jump to. */
export function hasInstaller(port: string, product: string): boolean {
  const info = PORT_BY_SLUG[port]
  if (!info) return false
  if (product === 'core') return true
  if (product === 'mcp') return productAvailable(info, 'mcp')
  return product === 'workspace' && hasPackageInstalls(info, 'workspace')
}

const sectionRows = (surface: DocumentationSurface): SidebarLinkItem[] => surface.sections
  .filter((section) => section.id !== 'home' && section.href)
  .map((section) => {
    const count = pageCount(section)
    return { type: 'link' as const, label: section.label, href: section.href!, ...(section.disabled ? { disabled: true } : {}), ...(count ? { count } : {}) }
  })

/** A product home's rows: Overview, Install second, then its sections with their page counts. */
export function productRows(port: string, surface: DocumentationSurface): SidebarItem[] {
  return [
    { type: 'link', label: 'Overview', href: surface.href },
    ...(hasInstaller(port, surface.id) ? [{ type: 'link' as const, label: 'Install', href: `${surface.href}#install`, install: true }] : []),
    ...sectionRows(surface),
  ]
}

/** A port home's rows: each product as a disclosure holding its overview and sections. */
export function portRows(surfaces: DocumentationSurface[]): SidebarItem[] {
  return surfaces.filter((surface) => surface.id !== 'home').map((surface): SidebarItem => ({
    type: 'group', label: surface.label, open: true,
    items: [{ type: 'link', label: 'Overview', href: surface.href }, ...sectionRows(surface)],
  }))
}

/** The rows a head's level lists; a section's own rows are its sidebar items. */
export function rowsFor(port: string, head: SidebarHeadData, surfaces: DocumentationSurface[], selected: Selection, items: SidebarItem[]): SidebarItem[] {
  if (head.level === 'port') return portRows(surfaces)
  if (head.level === 'product') return productRows(port, selected.surface)
  return items
}
