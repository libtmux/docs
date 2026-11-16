/**
 * The "In other ports" table: one row per port for the task a declaration performs.
 *
 * `referenceAlternatives` already reads the concept table; this module adds what the table needs to say about each
 * row. A row is mapped (a symbol), a recorded absence (a reason the concept table writes), or unmapped (nothing
 * recorded, which is not evidence that the port lacks the operation). The mapped rows also carry difference chips,
 * computed from model fields alone: nothing is inferred from a name. The header picker (`page-port-links.ts`) reads
 * the same rows, so the picker and the table cannot disagree.
 */
import { docSummaryText, OWNER_KINDS, qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS, PORT_NAME, referenceAlternatives } from './api-models'
import { PORTS } from './ports'

type Alternatives = ReturnType<typeof referenceAlternatives>

/** The sentence the concept table writes for every language it has no mapping or reason for. */
export const GENERIC_ABSENCE = /^No source-verified .+ equivalent is recorded for this operation\.$/

export interface EquivalentRow {
  port: string
  name: string
  status: 'mapped' | 'absent' | 'unmapped'
  /** Target's public id, when mapped. */
  publicId?: string
  qualifiedName?: string
  href?: string
  kind?: string
  /** The target's doc summary: sparse stays sparse. */
  summary?: string
  /** What differs from the page's own declaration, each chip a word the reader can search for. */
  chips: string[]
  /** The concept's `notes[port]`: a native difference the model states in prose. */
  note?: string
  /** A recorded reason this port has none. */
  reason?: string
  /** The reason is the concept table's generic sentence, not a statement about this port. */
  generic?: boolean
  /** This row is the page's own declaration. */
  current?: boolean
}

export interface EquivalentsGroup {
  /** The concept's label. */
  label: string
  /** Mapped rows in site port order; the page's own row comes first. */
  rows: EquivalentRow[]
  /** Recorded absences with a specific reason about this port. */
  absent: EquivalentRow[]
  /** Ports whose absence is the generic sentence, in site order. */
  genericAbsent: string[]
  /** Ports the concept table says nothing about. */
  unmapped: string[]
  /** Mapped ports other than the page's own. */
  mappedCount: number
}

const order = (slug: string) => PORTS.findIndex((entry) => entry.slug === slug)

const indexes = new Map<string, Map<string, ApiSymbol>>()
/** A port's symbols by public id, built once. */
function symbolIn(port: string, publicId: string): ApiSymbol | undefined {
  let index = indexes.get(port)
  if (!index) {
    index = new Map()
    for (const symbol of API_MODELS[port]?.symbols ?? []) {
      const key = symbol.publicId ?? symbol.id
      if (!index.has(key)) index.set(key, symbol)
    }
    indexes.set(port, index)
  }
  return index.get(publicId)
}

/** The type a member is declared on, when its parent is a type rather than a module or namespace. */
export function ownerTypeOf(port: string, symbol: ApiSymbol): ApiSymbol | undefined {
  if (!symbol.parent) return undefined
  const parent = API_MODELS[port]?.symbols.find((entry) => entry.id === symbol.parent)
  return parent && OWNER_KINDS.has(parent.kind) && parent.kind !== 'module' ? parent : undefined
}

/**
 * How `target` differs from `source`, as the model records it.
 *
 * Each chip is relative to the page's own declaration, so a free function on a page that is itself a free function
 * carries none. A chip means "read the target page", not "this is worse".
 */
export function differenceChips(source: { port: string; symbol: ApiSymbol }, target: { port: string; symbol: ApiSymbol }): string[] {
  const chips: string[] = []
  const own = source.symbol
  const other = target.symbol
  if (other.modifiers.includes('async') && !own.modifiers.includes('async')) chips.push('async')
  const ownOwner = ownerTypeOf(source.port, own)
  const otherOwner = ownerTypeOf(target.port, other)
  const callable = (symbol: ApiSymbol) => symbol.kind === 'method' || symbol.kind === 'function'
  if (callable(own) && callable(other)) {
    if (ownOwner && otherOwner && ownOwner.name !== otherOwner.name) chips.push(`on ${otherOwner.name}`)
    else if (ownOwner && !otherOwner && other.kind === 'function') chips.push('free function')
  }
  if (other.signatures.length > 1 && other.signatures.length > own.signatures.length) chips.push(`${other.signatures.length} overloads`)
  if (other.modifiers.includes('readonly') && !own.modifiers.includes('readonly')) chips.push('readonly')
  return chips
}

/** One group per concept naming the symbol. `alternatives` lets a product page supply its own version-aware links. */
export function equivalentsFor(port: string, symbol: ApiSymbol, alternatives: Alternatives = referenceAlternatives(port, symbol.publicId ?? symbol.id)): EquivalentsGroup[] {
  return alternatives.map((group) => {
    const rows: EquivalentRow[] = [{
      port, name: PORT_NAME[port] ?? port, status: 'mapped', current: true, chips: [],
      // The concept's own id for this port, which is what the header picker links to; a variant page names its primary.
      publicId: group.ports.find((entry) => entry.port === port)?.publicId ?? symbol.publicId ?? symbol.id,
      qualifiedName: qualifiedNameOf(symbol), kind: symbol.kind,
      summary: symbol.doc?.summary ? docSummaryText(symbol.doc.summary, port) : undefined,
    }]
    const absent: EquivalentRow[] = []
    const genericAbsent: string[] = []
    const unmapped: string[] = []
    for (const entry of [...group.ports].sort((a, b) => order(a.port) - order(b.port))) {
      if (entry.port === port) continue
      if (entry.publicId) {
        const target = symbolIn(entry.port, entry.publicId)
        rows.push({
          port: entry.port, name: entry.name, status: 'mapped', publicId: entry.publicId,
          qualifiedName: target ? qualifiedNameOf(target) : entry.publicId, href: entry.href, kind: entry.kind,
          summary: target?.doc?.summary ? docSummaryText(target.doc.summary, entry.port) : undefined,
          chips: target ? differenceChips({ port, symbol }, { port: entry.port, symbol: target }) : [],
          note: entry.note,
        })
      } else if (entry.absent && !GENERIC_ABSENCE.test(entry.absent)) {
        absent.push({ port: entry.port, name: entry.name, status: 'absent', chips: [], reason: entry.absent })
      } else if (entry.absent) {
        genericAbsent.push(entry.name)
      } else {
        unmapped.push(entry.name)
      }
    }
    return { label: group.label, rows, absent, genericAbsent, unmapped, mappedCount: rows.length - 1 }
  })
}

/** "No equivalent is recorded in A, B or C." for the ports the concept table gives only its generic sentence. */
export function genericAbsenceSentence(names: string[]): string | null {
  return names.length ? `No equivalent is recorded in ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(names)}.` : null
}

/** "Not mapped" ports in one sentence; the closing clause keeps absence of data from reading as absence of an API. */
export function unmappedSentence(names: string[]): string | null {
  return names.length ? `${new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(names)}. Unmapped is not evidence of absence.` : null
}

/** Whether the table is long enough to offer "Only with differences". */
export const FILTER_AFTER_ROWS = 8
