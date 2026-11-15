/**
 * The page sections that relate a library symbol to tmux and to the rest of the site.
 *
 * One derivation feeds the HTML sections (`ApiTmuxSections.astro`), the "On this page" entries and the Markdown export,
 * so the three cannot list different rows. A section with nothing to say is not returned.
 */
import type { ApiSymbol } from '@libtmux/api-model/reference'
import { mentionsOf, referenceAlternatives } from './api-models'
import { equivalentsFor, type EquivalentsGroup } from './api-equivalents'
import { proseHref } from './docs-paths'
import type { ApiRelationshipPath } from './api-relationships'
import { SITE_ROOT } from './site-root'
import { CATALOG_KINDS, tmuxCatalogKindsForSymbol, tmuxCatalogUrl, type CatalogKind } from './tmux-catalog'
import { tmuxCommandsFor, tmuxManualUrl } from './tmux-manual-data'
import {
  tmuxCommandItems, tmuxDirectDeclarations, tmuxCommandRows, tmuxReferencePaths, tmuxReferenceUrl, tmuxSymbolSends,
  type CommandItem,
} from './tmux-reference'

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
export interface OtherPortsSection extends Base { type: 'ports'; groups: EquivalentsGroup[] }
export type ApiTmuxSection = TmuxCommandSection | TmuxCApiSection | TmuxCatalogSection | GuidesSection | OtherPortsSection

type Alternatives = ReturnType<typeof referenceAlternatives>

const VERSION = 'latest'

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)

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

  const groups = equivalentsFor(port, symbol, alternatives)
  if (groups.length) {
    sections.push({ type: 'ports', id: 'api-other-ports', label: 'In other ports', groups,
      count: groups.reduce((total, group) => total + group.mappedCount, 0),
      intro: `Equivalents of \`${symbol.name}\` in the other languages.` })
  }
  return sections
}
