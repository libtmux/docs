/**
 * What a port's header offers: the repository and package host as direct
 * links, and an index of every other published destination to search.
 *
 * Every URL is external and unversioned, so it is the same from any locale,
 * preview or documentation version. The direct links come from the same
 * resolver as the homepage's links row; the index comes from the inventory,
 * where an unpublished entry yields nothing.
 */
import {
  API_HOSTS, INVENTORY, INVENTORY_KIND_LABEL, KIND_TERMS, PACKAGE_HOSTS, entryDestinations,
  type DestinationKind, type HostIcon, type InventoryEntry, type InventoryProduct,
} from './port-inventory'
import { PICKER_GROUP_LABEL, portDestinations, type Port } from './ports'

export interface HeaderAction {
  kind: DestinationKind
  /** The chip's visible name: GitHub, or the package host or API tool. */
  label: string
  /** The accessible name; it starts with the visible one. */
  name: string
  url: string
  icon: HostIcon
}

/** One destination in the index. Entries that share a URL share a row. */
export interface HeaderRow {
  kind: DestinationKind
  product: InventoryProduct
  label: string
  /** The line under the label: a coordinate, a repository path or the host. */
  detail: string
  url: string
  icon: HostIcon
  /** Everything a reader may type to find the row. */
  match: string
  /** The inventory entries the row stands for, first the one that names it. */
  entries: string[]
}

export interface HeaderSection {
  kind: DestinationKind
  label: string
  rows: HeaderRow[]
}

export interface PortHeaderLinks {
  actions: HeaderAction[]
  rows: HeaderRow[]
  /** Whether the index holds a destination that no direct link already opens. */
  indexed: boolean
}

export const SECTION_LABEL: Readonly<Record<DestinationKind, string>> = {
  source: 'Source', package: 'Packages', api: 'API reference',
}
const KINDS: readonly DestinationKind[] = ['source', 'package', 'api']
const PRODUCTS: readonly InventoryProduct[] = ['core', 'mcp', 'workspace']
const KIND_WORDS: Readonly<Record<DestinationKind, readonly string[]>> = {
  source: ['github', 'source', 'repository'], package: ['package', 'registry'], api: ['api', 'reference', 'documentation', 'docs'],
}

/** `libtmux-go/tmux` of `github.com/libtmux/libtmux-go/tmux`: the host is the mark's job, and the owner is in the footer. */
const shown = (coordinate: string) => coordinate.replace(/^github\.com\/[^/]+\//, '')
/** The coordinate without its host, for an accessible name. */
const named = (coordinate: string) => coordinate.replace(/^github\.com\//, '')
const repoName = (repo: string) => repo.split('/').pop()!

interface Draft extends Omit<HeaderRow, 'match' | 'entries'> {
  terms: string[]
  entry: string
}

/**
 * A row's detail is one short line, so it carries only what the label and the
 * section heading do not: the ecosystem's word for the entry, then a path or a
 * coordinate. The owner and the host are in the footer and the mark.
 */
function drafts(entry: InventoryEntry, home: string): Draft[] {
  const label = entry.label
  const terms = [entry.label, entry.coordinate, ...entry.aliases, entry.repo, repoName(entry.repo),
    INVENTORY_KIND_LABEL[entry.kind], ...KIND_TERMS[entry.kind], ...(entry.unit ? [entry.unit] : []), PICKER_GROUP_LABEL[entry.product]]
  const line = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')
  return entryDestinations(entry).map(({ kind, url, host }): Draft => {
    if (kind === 'source') {
      // A path in the port's own repository needs no repository name; one in another repository keeps it.
      const where = entry.path ? (entry.repo === home ? entry.path : `${repoName(entry.repo)}/${entry.path}`) : entry.repo
      return { kind, product: entry.product, label, url, icon: 'github', entry: entry.id,
        detail: line(entry.unit, where), terms: [...terms, ...KIND_WORDS.source, entry.path ?? ''] }
    }
    const hostName = kind === 'package' ? PACKAGE_HOSTS[entry.package!.host].name : API_HOSTS[entry.api!.host].name
    const tool = kind === 'api' ? entry.api!.tool : undefined
    const icon = kind === 'package' ? PACKAGE_HOSTS[entry.package!.host].icon : API_HOSTS[entry.api!.host].icon
    // A coordinate that differs from the label is worth the line; otherwise name the host.
    const what = kind === 'package' ? (entry.coordinate === label ? hostName : shown(entry.coordinate)) : line(tool, hostName)
    return { kind, product: entry.product, label, url, icon, entry: entry.id,
      detail: line(entry.unit, what),
      terms: [...terms, ...KIND_WORDS[kind], hostName, host, ...(tool ? [tool] : [])] }
  })
}

/**
 * The index: source, then package, then API destinations, each under its
 * product. An identical URL appears once and keeps every entry's names in its
 * search text, so a Swift product or a Go package that shares its package's
 * page is still found by its own name.
 */
function indexRows(entries: readonly InventoryEntry[], home: string): HeaderRow[] {
  const ordered = entries.flatMap((entry) => drafts(entry, home))
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => KINDS.indexOf(a.draft.kind) - KINDS.indexOf(b.draft.kind)
      || PRODUCTS.indexOf(a.draft.product) - PRODUCTS.indexOf(b.draft.product) || a.index - b.index)
  const rows = new Map<string, HeaderRow & { terms: Set<string> }>()
  for (const { draft } of ordered) {
    const known = rows.get(draft.url)
    if (known) {
      // An entry whose package page is also its reference reaches this row twice.
      if (!known.entries.includes(draft.entry)) known.entries.push(draft.entry)
      for (const term of draft.terms) known.terms.add(term)
      for (const word of KIND_WORDS[draft.kind]) known.terms.add(word)
      continue
    }
    const { terms, entry, ...row } = draft
    rows.set(draft.url, { ...row, match: '', entries: [entry], terms: new Set([row.detail, ...terms]) })
  }
  return [...rows.values()].map(({ terms, ...row }) => ({ ...row, match: [...terms].filter(Boolean).join(' ') }))
}

export function portHeaderLinks(port: Port, inventory: Readonly<Record<string, readonly InventoryEntry[]>> = INVENTORY): PortHeaderLinks {
  const entries = (inventory[port.slug] ?? []).filter((entry) => entry.status === 'published')
  const library = entries.find((entry) => entry.kind === 'library')
  if (!library) return { actions: [], rows: [], indexed: false }
  const { source } = portDestinations({ port })
  const actions: HeaderAction[] = [{
    kind: 'source', label: 'GitHub', icon: 'github', url: source.url,
    name: `GitHub: ${source.repo}${source.path ? `/${source.path}` : ''}`,
  }]
  const documented = library.api ? library : entries.find((entry) => entry.id === library.reference)
  if (library.package) {
    const host = PACKAGE_HOSTS[library.package.host]
    // A host that serves the package page as its reference is one destination, not two, so its one link says it is both.
    const also = documented?.api?.url === library.package.url ? ' and API reference' : ''
    actions.push({ kind: 'package', label: host.name, icon: host.icon, url: library.package.url, name: `${host.name}: ${named(library.coordinate)} package${also}` })
  }
  if (documented?.api && documented.api.url !== library.package?.url) {
    const host = API_HOSTS[documented.api.host]
    const label = documented.api.tool ?? host.name
    actions.push({ kind: 'api', label, icon: host.icon, url: documented.api.url, name: `${label}: ${named(documented.coordinate)} API reference` })
  }
  const rows = indexRows(entries, port.repo)
  return { actions, rows, indexed: rows.some((row) => !actions.some((action) => action.url === row.url)) }
}

/** A search matches when every word appears in the row's text, as the picker's script decides. */
export function matchesSearch(row: Pick<HeaderRow, 'match'>, query: string): boolean {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return tokens.every((token) => row.match.toLocaleLowerCase().includes(token))
}

/** The rows under their kind, in kind order; a kind with no rows has no section. */
export function headerSections(rows: readonly HeaderRow[]): HeaderSection[] {
  return KINDS.map((kind) => ({ kind, label: SECTION_LABEL[kind], rows: rows.filter((row) => row.kind === kind) }))
    .filter((section) => section.rows.length > 0)
}
