/**
 * How a page ends: where to go next, what relates to this page and why, and
 * the way up.
 *
 * Three parts, each from data the site already has. The sequence is the
 * section's published order, the sidebar's. The groups are typed: each says why
 * its entries belong, shows four at most and is left out when it has none, so
 * there is never a generic "related pages" list. The ladder names every level
 * above the page, nearest first, with the targets the sidebar's head and the
 * breadcrumb use. The design system's PageEnd (record 0021).
 */
import { qualifiedNameOf } from '@libtmux/api-model/reference'
import mentionIndex from '../data/mentions.json'
import { API_MODELS, referenceHref } from './api-models'
import { equivalentMcpObject, mcpObjects, type McpObject } from './mcp-reference'
import { isActivePath, type SidebarItem, type SidebarLinkItem } from './sidebar'
import { PORT_BY_SLUG, portPageUrl, type ProductStatus } from './ports'
import { hasInstaller, type SidebarHeadData } from './sidebar-head'
import { tmuxManual } from './tmux-manual-data'
import { tmuxSymbolSends } from './tmux-reference'
import { withRoot } from './site-root'
import type { DocumentationSection, DocumentationSurface } from './documentation-navigation'
import type { PagePortLink } from './page-port-links'

export interface PageEndLink {
  label: string
  href: string
}

export interface PageEndItem extends PageEndLink {
  /** The kind mark that leads the entry: a symbol kind, `command` ($) or `tool` (t). */
  kind?: string
  /** The label is an identifier, set as code. */
  code?: boolean
  status?: ProductStatus
}

export interface PageEndGroup {
  id: string
  title: string
  count?: number
  /** One line saying why these entries belong here. */
  why: string
  items: PageEndItem[]
}

export interface PageEndData {
  prev?: PageEndLink
  next?: PageEndLink
  groups: PageEndGroup[]
  /** Every level above the page, nearest first. */
  up: PageEndLink[]
}

/** A group shows this many entries at most. */
export const GROUP_LIMIT = 4

export interface PageEndInput {
  port: string
  version: string
  /** The page's own path, with the site root and any version. */
  pathname: string
  surfaces: DocumentationSurface[]
  selected: { surface: DocumentationSurface; section: DocumentationSection }
  head: SidebarHeadData
  /** This page in every language, as the port picker lists it. */
  pagePorts?: PagePortLink[]
}

const leaves = (items: SidebarItem[]): SidebarLinkItem[] => items.flatMap((item) => item.type === 'link' ? [item] : leaves(item.items))

/** The pages of a section in the sidebar's order, without the section's own overview. */
export function sectionPages(section: DocumentationSection): SidebarLinkItem[] {
  const seen = new Set<string>()
  return leaves(section.items).filter((item) => !item.external && !item.disabled && item.href !== section.href
    && !seen.has(item.href) && seen.add(item.href))
}

/** The page before and after this one in its section. A first page has no previous; a last page has no next. */
export function sequence(pages: SidebarLinkItem[], pathname: string): Pick<PageEndData, 'prev' | 'next'> {
  const at = pages.findIndex((page) => isActivePath(page.href, pathname))
  if (at < 0) return {}
  const before = pages[at - 1]
  const after = pages[at + 1]
  return { ...(before ? { prev: { label: before.label, href: before.href } } : {}), ...(after ? { next: { label: after.label, href: after.href } } : {}) }
}

/** Mentions by page, as `<port>/<path within the version>`: the key a prose page finds its own APIs under. */
const mentionsByPage = new Map<string, string[]>()
for (const { port, symbol, page } of (mentionIndex as { mentions: { port: string; symbol: string; page: string }[] }).mentions) {
  const rest = new RegExp(`^/${port}/[^/]+/(.*?)/?$`).exec(page)?.[1]
  if (rest === undefined) continue
  const key = `${port}/${rest}`
  const symbols = mentionsByPage.get(key) ?? []
  if (!symbols.includes(symbol)) symbols.push(symbol)
  mentionsByPage.set(key, symbols)
}

/** The page's path below its port and version, or undefined for a path that is not under the port. */
export function pathWithinVersion(port: string, pathname: string): string | undefined {
  return new RegExp(`/${port}/[^/]+/(.*?)/?$`).exec(pathname)?.[1]
}

/** Section ids whose pages teach with code: the ones that name APIs and the tmux commands they send. */
const TEACHING = new Set(['guides', 'topics', 'examples', 'concepts'])

/** The MCP tool a tmux command is the same operation as: `capture-pane` is `capture_pane`, or `tmux_capture_pane` on a server that prefixes its tools. */
function toolFor(port: string, command: string): McpObject | undefined {
  const name = command.replaceAll('-', '_')
  return mcpObjects(port).find((object) => object.kind === 'tool' && (object.name === name || object.name === `tmux_${name}`))
}

function teachingGroups(port: string, version: string, pathname: string): PageEndGroup[] {
  const rest = pathWithinVersion(port, pathname)
  const model = API_MODELS[port]
  const ids = rest === undefined || !model ? [] : mentionsByPage.get(`${port}/${rest}`) ?? []
  const apis = ids.flatMap((id) => {
    const symbol = model!.symbols.find((entry) => entry.id === id)
    const href = symbol && referenceHref(port, symbol.publicId ?? symbol.id, version)
    return symbol && href ? [{ symbol, href }] : []
  })
  if (!apis.length) return []
  const groups: PageEndGroup[] = [{
    id: 'apis', title: 'APIs on this page', count: apis.length, why: 'Named in this page.',
    items: apis.slice(0, GROUP_LIMIT).map(({ symbol, href }) => ({ label: qualifiedNameOf(symbol), href, kind: symbol.kind, code: true })),
  }]

  // What those calls send: the documented commands the page's symbols send, the most shared first.
  const documented = new Set(tmuxManual('latest').commands.map((command) => command.name))
  const sent = new Map<string, { href: string; shared: number }>()
  for (const { symbol } of apis) {
    for (const send of tmuxSymbolSends(port, symbol.publicId ?? symbol.id)) {
      // Only the sends a reader should hear about: the library lists those, and leaves the probes a method makes on the way.
      if (!send.scopes.some((use) => use.listed) || !documented.has(send.command)) continue
      const known = sent.get(send.command)
      sent.set(send.command, { href: send.manualHref, shared: (known?.shared ?? 0) + 1 })
    }
  }
  const commands = [...sent].sort((a, b) => b[1].shared - a[1].shared || a[0].localeCompare(b[0]))
  if (commands.length) {
    groups.push({ id: 'commands', title: 'tmux commands', count: commands.length, why: 'What those calls send.',
      items: commands.slice(0, GROUP_LIMIT).map(([name, { href }]) => ({ label: name, href, kind: 'command', code: true })) })
  }

  // The same operation as a tool, for a port whose server advertises one.
  const info = PORT_BY_SLUG[port]!
  const tools = commands.flatMap(([name]) => toolFor(port, name) ?? [])
  if (tools.length) {
    groups.push({ id: 'mcp', title: 'In MCP', count: tools.length, why: 'The same operation as a tool.',
      items: tools.slice(0, GROUP_LIMIT).map((tool) => ({ label: tool.name, href: portPageUrl(info, version, tool.path), kind: 'tool', code: true })) })
  }
  return groups
}

/** This page in the other languages: one link with the count, to the parity view. */
function otherLanguages(port: string, pagePorts: PagePortLink[] | undefined, what: string, why: string): PageEndGroup[] {
  const count = (pagePorts ?? []).filter((entry) => entry.port !== port && entry.links.some((link) => !link.fallback)).length
  if (!count) return []
  return [{ id: 'languages', title: 'Other languages', count, why,
    items: [{ label: `${what} in ${count} other ${count === 1 ? 'language' : 'languages'}`, href: withRoot('/meta/parity/') }] }]
}

/** The same tool on other ports' servers. */
function otherServers(port: string, object: McpObject): PageEndGroup[] {
  const count = Object.keys(PORT_BY_SLUG).filter((other) => other !== port && equivalentMcpObject(port, object, other)).length
  if (!count) return []
  return [{ id: 'languages', title: 'Other languages', count, why: 'The same tool on other languages\' servers.',
    items: [{ label: `${object.name} in ${count} other ${count === 1 ? 'server' : 'servers'}`, href: withRoot('/meta/parity/') }] }]
}

/** The section's first page, where a product home goes next. */
function firstPage(surface: DocumentationSurface): PageEndLink | undefined {
  for (const section of surface.sections) {
    const page = section.id === 'home' || section.id === 'reference' ? undefined : sectionPages(section)[0]
    if (page) return { label: page.label, href: page.href }
  }
  return undefined
}

/** The end of the page at `pathname`, for a page of a port's documentation. */
export function pageEnd(input: PageEndInput & { title: string }): PageEndData {
  const { port, version, pathname, surfaces, selected, head, pagePorts, title } = input
  const info = PORT_BY_SLUG[port]
  if (!info) throw new Error(`page-end: unknown port slug "${port}"`)
  const { surface, section } = selected
  const everyLanguage: PageEndLink = { label: 'All languages', href: withRoot('/') }
  const portLink: PageEndLink = { label: info.name, href: portPageUrl(info, version) }

  if (head.level === 'port') {
    const total = Object.keys(PORT_BY_SLUG).length
    return { up: [everyLanguage], groups: [{ id: 'languages', title: 'Other languages', count: total - 1, why: 'libtmux in every other language.',
      items: [{ label: `All ${total} languages`, href: everyLanguage.href }] }] }
  }

  if (head.level === 'product') {
    const next = firstPage(surface)
    const others = surfaces.filter((entry) => entry.id !== 'home' && entry.id !== surface.id)
    return { ...(next ? { next } : {}), up: [portLink, everyLanguage], groups: others.length ? [{ id: 'products', title: `Also in ${info.name}`, why: 'The other products for this language.',
      items: others.map((entry) => ({ label: entry.label, href: entry.href, ...(entry.status ? { status: entry.status } : {}) })) }] : [] }
  }

  const product: PageEndLink = { label: surface.label, href: surface.href }
  const sectionLink: PageEndLink = { label: section.label, href: section.href ?? surface.href }
  if (section.href && isActivePath(section.href, pathname)) {
    const siblings = surface.sections.filter((entry) => entry.id !== 'home' && entry.id !== section.id && entry.href && !entry.disabled)
    return { up: [product, portLink], groups: siblings.length ? [{ id: 'sections', title: 'Other sections', count: siblings.length, why: `In ${surface.label}.`,
      items: siblings.map((entry) => ({ label: entry.label, href: entry.href! })) }] : [] }
  }

  const up = [sectionLink, product, portLink]
  if (section.id === 'reference') return { up, groups: [] }
  const flow = sequence(sectionPages(section), pathname)
  if (surface.id === 'mcp' && ['tools', 'prompts', 'resources'].includes(section.id)) {
    const object = mcpObjects(port).find((entry) => isActivePath(portPageUrl(info, version, entry.path), pathname))
    return { ...flow, up, groups: object ? otherServers(port, object) : [] }
  }
  const teaches = TEACHING.has(section.id) || surface.id !== 'core'
  return { ...flow, up, groups: [...(teaches ? teachingGroups(port, version, pathname) : []),
    ...otherLanguages(port, pagePorts, title, 'This page in other languages.')] }
}


/**
 * The one-line note under a page's title: what the page needs and where to install it.
 *
 * Every page of a product that teaches with code names the package it runs
 * against and that package's maturity, and links the installer on the product's
 * home. A section index, a reference and a concept page have no program to run
 * and carry none.
 */
export function pageNeeds(port: string, surface: DocumentationSurface, section: DocumentationSection, pathname: string): { text: string; status?: ProductStatus; href?: string } | undefined {
  const info = PORT_BY_SLUG[port]
  if (!info || section.id === 'home' || section.id === 'reference' || section.id === 'concepts') return undefined
  if (section.href && isActivePath(section.href, pathname)) return undefined
  const text = surface.id === 'core' ? `libtmux for ${info.name}` : `the ${surface.id === 'mcp' ? 'MCP server' : surface.label} for ${info.name}`
  return { text: `Needs ${text}`, ...(surface.status ? { status: surface.status } : {}), ...(hasInstaller(port, surface.id) ? { href: `${surface.href}#install` } : {}) }
}
