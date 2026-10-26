/**
 * The page sections that relate a library symbol to tmux and to the rest of the site.
 *
 * One derivation feeds the HTML sections (`ApiTmuxSections.astro`), the "On this page" entries and the Markdown export,
 * so the three cannot list different rows. A section with nothing to say is not returned.
 */
import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, mentionsOf, referenceAlternatives } from './api-models'
import { proseHref } from './docs-paths'
import type { ApiRelationshipPath } from './api-relationships'
import { PORTS } from './ports'
import { productApiIndex } from './product-api'
import { SITE_ROOT } from './site-root'
import { CATALOG_KINDS, tmuxCatalogKindsForSymbol, tmuxCatalogUrl, type CatalogKind } from './tmux-catalog'
import { tmuxCommandsFor, tmuxManualUrl } from './tmux-manual-data'
import {
  tmuxCommandItems, tmuxDirectDeclarations, tmuxCommandRows, tmuxReferencePaths, tmuxReferenceUrl, tmuxSymbolSends,
  type CommandItem, type UsageTable,
} from './tmux-reference'
import { defaultVersionFor } from './versions'

export interface CApiItem { id: string; name: string; href: string; kind: string }

interface Base { id: string; label: string; intro: string; count: number }
export interface TmuxCommandSection extends Base { type: 'commands'; items: CommandItem[] }
export interface TmuxCApiSection extends Base {
  type: 'c-api'
  /** The functions the commands end in: degree 1. */
  direct: CApiItem[]
  /** What the degrees count, said once for every path. */
  note?: string
  /** Curated paths through the tmux source, each entered at a direct function (degree 1) and followed in order. */
  paths: { title: string; items: (CApiItem & { degree: number; /** How the step before reaches this one. */ edge?: ApiRelationshipPath['edges'][number] })[] }[]
}
export interface TmuxCatalogSection extends Base { type: 'catalog'; catalog: CatalogKind; items: { name: string; href: string }[] }
export interface GuidesSection extends Base { type: 'guides'; groups: { id: string; label: string; items: { title: string; href: string }[] }[] }
export interface OtherPortsSection extends Base { type: 'ports'; groups: { label: string; table: UsageTable }[] }
export type ApiTmuxSection = TmuxCommandSection | TmuxCApiSection | TmuxCatalogSection | GuidesSection | OtherPortsSection

type Alternatives = ReturnType<typeof referenceAlternatives>

const VERSION = 'latest'
/** The sentence the concept table writes for every language it has no mapping or reason for. */
const GENERIC_ABSENCE = /^No source-verified .+ equivalent is recorded for this operation\.$/

const order = (slug: string) => PORTS.findIndex((entry) => entry.slug === slug)
const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

/** Each concept's equivalents as a Language | Equivalent table; a language with nothing to say joins one closing sentence. */
function otherPorts(port: string, alternatives: Alternatives): OtherPortsSection['groups'] {
  return alternatives.map((group) => {
    const ports = group.ports.filter((entry) => entry.port !== port).map((entry) => {
      const target = entry.publicId ? API_MODELS[entry.port]?.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === entry.publicId) : undefined
      const qualified = target ? qualifiedNameOf(target) : entry.publicId
      return { entry, qualified }
    })
    const noteIndex = (slug: string) => API_MODELS[slug] ? productApiIndex(API_MODELS[slug], defaultVersionFor(slug)) : undefined
    const rows = ports.flatMap(({ entry, qualified }) => {
      if (entry.href) {
        return [{ port: entry.port, name: entry.name, links: [{ href: entry.href, kind: entry.kind ?? '', label: qualified! }],
          ...(entry.note ? { note: entry.note, noteIndex: noteIndex(entry.port) } : {}) }]
      }
      // A reason says why this language has none; a language with no reason is one of the closing sentence's.
      return entry.absent && !GENERIC_ABSENCE.test(entry.absent) ? [{ port: entry.port, name: entry.name, links: [], note: entry.absent }] : []
    })
    const bare = ports.filter(({ entry }) => !entry.href && !(entry.absent && !GENERIC_ABSENCE.test(entry.absent)))
      .sort((a, b) => order(a.entry.port) - order(b.entry.port)).map(({ entry }) => entry.name)
    return {
      label: group.label,
      table: {
        command: group.label, caption: `Equivalents of ${group.label} in other languages`,
        absent: bare.length ? `No equivalent is recorded in ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(bare)}.` : null,
        groups: [{ heading: 'Equivalent', ports: rows.sort((a, b) => order(a.port) - order(b.port)) }],
      } satisfies UsageTable,
    }
  })
}

export function apiTmuxSections(
  port: string | undefined, symbol: ApiSymbol, alternatives: Alternatives = port ? referenceAlternatives(port, symbol.publicId ?? symbol.id) : [],
): ApiTmuxSection[] {
  if (!port) return []
  const anchor = symbol.publicId ?? symbol.id
  const sections: ApiTmuxSection[] = []

  const equivalents = tmuxCommandsFor(port, anchor).map((command) => ({ ...command, href: tmuxManualUrl(VERSION, command.name) }))
  const rows = tmuxCommandRows(tmuxSymbolSends(port, anchor), equivalents)
  const items = tmuxCommandItems(rows)
  if (items.length) {
    sections.push({ type: 'commands', id: 'api-tmux-command', label: 'tmux command', count: items.length, items,
      intro: `The tmux commands behind \`${symbol.name}\`.` })
  }

  // Degree 1 is what the symbol itself reaches: the entry of each command it sends and the function at each scope it sends.
  // A command it only has an equivalent for contributes none.
  const sends = tmuxSymbolSends(port, anchor)
  const sent = new Set(sends.map((send) => send.command))
  const direct: (CApiItem & { symbol: ApiSymbol })[] = []
  for (const row of rows.filter((entry) => sent.has(entry.command))) {
    for (const entry of tmuxDirectDeclarations(VERSION, row.command, row.scopes.map((use) => use.scope!), sends.find((send) => send.command === row.command)!.scopes.some((use) => !use.scope))) {
      if (!direct.some((found) => found.id === entry.id)) direct.push({ id: entry.id, name: entry.name, href: tmuxReferenceUrl(VERSION, entry), kind: entry.kind, symbol: entry })
    }
  }
  if (direct.length) {
    // The curated paths are the only source of onward edges; a path is entered at its first direct function.
    const paths = tmuxReferencePaths(VERSION).flatMap((path) => {
      const start = path.symbols.findIndex((entry) => direct.some((found) => found.id === entry.id))
      if (start < 0) return []
      const item = (entry: ApiSymbol): CApiItem => ({ id: entry.id, name: entry.name, href: tmuxReferenceUrl(VERSION, entry), kind: entry.kind })
      return [{ title: path.title, items: path.symbols.slice(start).map((entry, i) => ({ ...item(entry), degree: i + 1, ...(i > 0 ? { edge: path.edges[start + i - 1] } : {}) })) }]
    })
    sections.push({
      type: 'c-api', id: 'api-tmux-c-api', label: 'tmux C API', direct: direct.map(({ symbol: _, ...rest }) => rest), paths,
      count: new Set([...direct, ...paths.flatMap((path) => path.items)].map((item) => item.id)).size,
      intro: 'The C declarations in tmux that implement these commands.',
      ...(paths.length ? { note: 'Each path starts at a function a command runs, which is degree 1. The degree counts steps from there along the path, and each step is a call or a reference: degree 2 is reached from that function, degree 3 from the next, and so on.' } : {}),
    })
  }

  const kinds = tmuxCatalogKindsForSymbol(port, symbol)
  for (const [kind, plural] of [['hook', 'hooks'], ['option', 'options'], ['format', 'formats']] as const) {
    if (!kinds.includes(kind)) continue
    sections.push({ type: 'catalog', catalog: kind, id: `api-tmux-${plural}`, label: `tmux ${plural}`, count: 1,
      intro: CATALOG_KINDS[kind].blurb, items: [{ name: CATALOG_KINDS[kind].label, href: tmuxCatalogUrl(VERSION, kind) }] })
  }

  const mentions = mentionsOf(port, symbol.id)
  if (mentions.length) {
    const groups = [...new Set(mentions.map((entry) => entry.section ?? 'docs'))].sort().map((section) => ({
      id: section, label: capitalize(section),
      items: mentions.filter((entry) => (entry.section ?? 'docs') === section).map((entry) => ({ title: entry.title ?? entry.page, href: proseHref(entry.page, SITE_ROOT) })),
    }))
    sections.push({ type: 'guides', id: 'api-guides', label: 'Guides', count: mentions.length, groups,
      intro: `Pages that discuss \`${symbol.name}\`.` })
  }

  const tables = otherPorts(port, alternatives)
  if (tables.length) {
    sections.push({ type: 'ports', id: 'api-other-ports', label: 'In other ports', groups: tables,
      // The rows the tables draw: a language with a link or a reason, and not the languages of the closing sentence.
      count: tables.reduce((total, group) => total + group.table.groups[0].ports.length, 0),
      intro: `Equivalents of \`${symbol.name}\` in the other languages.` })
  }
  return sections
}
