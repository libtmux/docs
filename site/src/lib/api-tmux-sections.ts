/**
 * The page sections that relate a library symbol to tmux and to the rest of the site.
 *
 * One derivation feeds the HTML sections (`ApiTmuxSections.astro`), the "On this page" entries and the Markdown export,
 * so the three cannot list different rows. A section with nothing to say is not returned.
 */
import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, mentionsOf, referenceAlternatives } from './api-models'
import { proseHref } from './docs-paths'
import { PORTS } from './ports'
import { productApiIndex } from './product-api'
import { SITE_ROOT } from './site-root'
import { CATALOG_KINDS, tmuxCatalogKindsForSymbol, tmuxCatalogUrl, type CatalogKind } from './tmux-catalog'
import { tmuxCommandsFor, tmuxManualUrl } from './tmux-manual-data'
import {
  tmuxCommandDeclarations, tmuxCommandItems, tmuxCommandRows, tmuxReferencePaths, tmuxReferenceUrl, tmuxSymbolSends,
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
  /** Functions reached from a direct one along a curated path through the tmux source. */
  paths: { title: string; from: CApiItem; items: (CApiItem & { degree: number })[] }[]
}
export interface TmuxCatalogSection extends Base { type: 'catalog'; catalog: CatalogKind; items: { name: string; href: string }[] }
export interface GuidesSection extends Base { type: 'guides'; groups: { id: string; label: string; items: { title: string; href: string }[] }[] }
export interface OtherPortsSection extends Base { type: 'ports'; groups: { label: string; table: UsageTable }[] }
export type ApiTmuxSection = TmuxCommandSection | TmuxCApiSection | TmuxCatalogSection | GuidesSection | OtherPortsSection

type Alternatives = ReturnType<typeof referenceAlternatives>

const VERSION = 'latest'
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
      if (entry.publicId) {
        return [{ port: entry.port, name: entry.name, links: [], note: `\`${qualified}\`${entry.note ? `. ${entry.note}` : ''}`, noteIndex: noteIndex(entry.port) }]
      }
      // A reason says why this language has none; a language with no reason is one of the closing sentence's.
      return entry.absent ? [{ port: entry.port, name: entry.name, links: [], note: entry.absent }] : []
    })
    const bare = ports.filter(({ entry }) => !entry.href && !entry.publicId && !entry.absent).map(({ entry }) => entry.name)
    return {
      label: group.label,
      table: {
        command: group.label, caption: `Equivalents of ${group.label} in other languages`,
        absent: bare.length ? `No equivalent in ${new Intl.ListFormat('en', { type: 'disjunction' }).format(bare)}.` : null,
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

  // The functions each command's rows already name come first, then the rest of what the data records for it.
  const direct: (CApiItem & { symbol: ApiSymbol })[] = []
  for (const row of rows) {
    const linked = new Set(row.scopes.map((use) => use.function?.href))
    const declarations = tmuxCommandDeclarations(VERSION, row.command)
    const ordered = [...declarations.filter((entry) => linked.has(tmuxReferenceUrl(VERSION, entry))), ...declarations.filter((entry) => !linked.has(tmuxReferenceUrl(VERSION, entry)))]
    for (const entry of ordered) {
      if (!direct.some((found) => found.id === entry.id)) direct.push({ id: entry.id, name: entry.name, href: tmuxReferenceUrl(VERSION, entry), kind: entry.kind, symbol: entry })
    }
  }
  if (direct.length) {
    // The curated paths are the only source of onward edges; a path is entered at its first direct function.
    const paths = tmuxReferencePaths(VERSION).flatMap((path) => {
      const start = path.symbols.findIndex((entry) => direct.some((found) => found.id === entry.id))
      if (start < 0) return []
      const item = (entry: ApiSymbol): CApiItem => ({ id: entry.id, name: entry.name, href: tmuxReferenceUrl(VERSION, entry), kind: entry.kind })
      return [{ title: path.title, from: item(path.symbols[start]),
        items: path.symbols.slice(start + 1).map((entry, i) => ({ ...item(entry), degree: i + 2 })) }]
    })
    sections.push({
      type: 'c-api', id: 'api-tmux-c-api', label: 'tmux C API', direct: direct.map(({ symbol: _, ...rest }) => rest), paths,
      count: direct.length + paths.reduce((total, path) => total + path.items.length, 0),
      intro: `The C declarations in tmux that implement these commands${paths.length ? ', and the functions they reach along curated paths through the source' : ''}.`,
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
      count: tables.reduce((total, group) => total + group.table.groups[0].ports.filter((entry) => entry.links.length).length, 0),
      intro: `Equivalents of \`${symbol.name}\` in the other languages.` })
  }
  return sections
}
