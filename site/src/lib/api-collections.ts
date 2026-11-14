/**
 * What a declaration's relationship collections can say, and what the data cannot.
 *
 * A collection that has nothing to show names the reason: the model records no call edges, or a member has no
 * siblings. Absence of a section is never presented as absence of callers.
 */
import type { ApiModelBase, ApiSymbol } from '@libtmux/api-model'
import { apiRelationships, type ApiRelationshipSection } from './api-relationships'

const recording = new WeakMap<ApiModelBase, boolean>()

/** Whether any declaration in the model records a direct call. Most port models record declarations only. */
export function recordsCalls(model: ApiModelBase): boolean {
  let known = recording.get(model)
  if (known === undefined) {
    known = model.symbols.some((symbol) => symbol.references?.some((reference) => reference.kind === 'call'))
    recording.set(model, known)
  }
  return known
}

/** The declarations that take the symbol as a function pointer or callback: they reach it without calling it. */
export function referencedBy(model: ApiModelBase, symbol: ApiSymbol): ApiSymbol[] {
  const { incoming } = apiRelationships(model, symbol)
  const callers = new Set(incoming.filter((edge) => edge.kind === 'call').map((edge) => edge.from.id))
  return [...new Map(incoming.filter((edge) => edge.kind === 'reference' && !callers.has(edge.from.id)).map((edge) => [edge.from.id, edge.from])).values()]
    .sort((left, right) => left.name.localeCompare(right.name))
}

const MIN_STEM = 4
const SHOWN = 4

export interface SameOwner {
  parent: ApiSymbol
  /** Siblings sharing a stem with the declaration, at most `SHOWN`. */
  siblings: ApiSymbol[]
  /** Every sibling that shares the stem. */
  shared: number
  /** Every member of the owner. */
  total: number
}

const callable = (symbol: ApiSymbol) => symbol.kind === 'method' || symbol.kind === 'function'

/**
 * Other members declared on the same owner whose names share a stem with this one (`Capture`: `CaptureBytes`,
 * `CaptureToFile`). Containment only: it says they sit on the same type, not that they behave alike.
 */
export function sameOwnerMembers(model: ApiModelBase, symbol: ApiSymbol): SameOwner | undefined {
  if (!symbol.parent || !callable(symbol) || symbol.name.length < MIN_STEM) return undefined
  const parent = model.symbols.find((candidate) => candidate.id === symbol.parent)
  if (!parent) return undefined
  const members = model.symbols.filter((candidate) => candidate.parent === parent.id)
  const own = symbol.name.toLowerCase()
  const shared = members.filter((member) => {
    if (member.id === symbol.id || !callable(member) || member.apiScope === 'internal') return false
    const name = member.name.toLowerCase()
    return name !== own && (name.startsWith(own) || (name.length >= MIN_STEM && own.startsWith(name)))
  }).sort((left, right) => left.name.length - right.name.length || left.name.localeCompare(right.name))
  return shared.length ? { parent, siblings: shared.slice(0, SHOWN), shared: shared.length, total: members.length } : undefined
}

/** A callable on a library page whose model records no calls anywhere: the page says so rather than showing nothing. */
export function lacksCallEdges(model: ApiModelBase, symbol: ApiSymbol, sections: ApiRelationshipSection[]): boolean {
  return callable(symbol) && !sections.some((section) => section.id === 'api-calls' || section.id === 'api-called-by') && !recordsCalls(model)
}
