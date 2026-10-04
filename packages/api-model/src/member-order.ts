import { CONCEPTS, type Concept } from './concepts.ts'
import type { ApiModelBase, ApiSymbol } from './model.ts'

/**
 * The order a type's members are listed in, most useful first.
 *
 * Alphabetical put `Server.sessions` behind `__enter__`, `_list_panes` and
 * every other name that sorts before it. A reader opening Server wants what
 * it holds and what it does, so the list leads with the accessors that walk
 * the hierarchy and sinks what a caller never writes.
 *
 * Every signal is one the reference already has. Nothing here is a list of
 * favourite names: the concept map says which members are the operations the
 * ports agree on, and how many ports implement one says how central it is.
 */
export interface MemberSignals {
  /** Ports implementing the concept a member realises, by public id. */
  readonly conceptPorts: ReadonlyMap<string, number>
  /** Concept ids by public id, for the listing test. */
  readonly conceptIds: ReadonlyMap<string, string>
  /** Where that concept sits in the concept map, which lists core operations first. */
  readonly conceptOrder: ReadonlyMap<string, number>
  /** Containing object rank by public id: window, session, then server. */
  readonly parentObjects: ReadonlyMap<string, { level: number; variant: number }>
  readonly inheritedParents: ReadonlyMap<string, ReadonlySet<string>>
  /** Guide pages that discuss a member, by public id. */
  readonly mentions: ReadonlyMap<string, number>
}

export const MEMBER_TIERS = [
  'parent',
  'listing',
  'query',
  'concept',
  'discussed',
  'public',
  'deprecated',
  'special',
  'private',
] as const
export type MemberTier = (typeof MEMBER_TIERS)[number]

/** A mention as `mentions.json` records it; only the fields ranking reads. */
interface Mention {
  port: string
  symbol: string
}

export function memberSignals(
  port: string,
  mentions: readonly Mention[] = [],
  concepts: Record<string, Concept> = CONCEPTS,
): MemberSignals {
  const conceptPorts = new Map<string, number>()
  const conceptIds = new Map<string, string>()
  const conceptOrder = new Map<string, number>()
  const parentObjects = new Map<string, { level: number; variant: number }>()
  const inheritedParents = new Map<string, Set<string>>()
  for (const [index, [id, concept]] of Object.entries(concepts).entries()) {
    const symbol = concept.symbols[port]
    if (!symbol) continue
    const ports = Object.keys(concept.symbols).length
    for (const owner of concept.inheritedBy?.[port] ?? []) {
      const members = inheritedParents.get(owner) ?? new Set<string>()
      members.add(symbol)
      inheritedParents.set(owner, members)
    }
    // A member can realise several concepts; the broadest one speaks for it.
    for (const [variant, target] of [symbol, ...(concept.variants?.[port] ?? [])].entries()) {
      if (concept.parentObject)
        parentObjects.set(target, {
          level: ['window', 'session', 'server'].indexOf(concept.parentObject),
          variant,
        })
      if ((conceptPorts.get(target) ?? 0) < ports) {
        conceptPorts.set(target, ports)
        conceptIds.set(target, id)
        conceptOrder.set(target, index)
      }
    }
  }
  const counts = new Map<string, number>()
  for (const m of mentions) if (m.port === port) counts.set(m.symbol, (counts.get(m.symbol) ?? 0) + 1)
  return { conceptPorts, conceptIds, conceptOrder, parentObjects, inheritedParents, mentions: counts }
}

const idOf = (s: ApiSymbol) => s.publicId ?? s.id

/** Include explicit public re-exports without inferring access from private bases. */
export function membersOf(
  model: ApiModelBase & { port?: string },
  owner: ApiSymbol,
  signals = memberSignals(model.port ?? ''),
): ApiSymbol[] {
  const members = model.symbols.filter((symbol) => symbol.parent === owner.id)
  for (const id of signals.inheritedParents.get(idOf(owner)) ?? []) {
    const source = model.symbols.find((symbol) => idOf(symbol) === id)
    if (source && !members.some((member) => idOf(member) === id || member.name === source.name)) {
      members.push({ ...source, parent: owner.id, inheritedFrom: source.parent })
    }
  }
  return members.sort(compareMembers(signals))
}

/**
 * `sessions`, `Sessions`, `sessions()`, `list_sessions`, `listSessions`,
 * `ListSessionsAsync`, `GetClientsAsync`: accessors that walk one
 * level down tmux's hierarchy.
 */
const LISTING = /^(list_?|get)?(sessions|windows|panes|clients|buffers)$/
const LISTING_ORDER = ['sessions', 'windows', 'panes', 'clients', 'buffers']
const listingRank = (s: ApiSymbol, signals: MemberSignals) => {
  const concept = signals.conceptIds.get(idOf(s))
  const name = concept?.startsWith('list-') ? concept.slice(5) : bareName(s).replace(/^(list_?|get)/, '')
  const rank = LISTING_ORDER.indexOf(name)
  return rank < 0 ? LISTING_ORDER.length : rank
}

/**
 * Operations that return a collection to filter: `search_panes`, `Snapshot`,
 * and Lua's `query` and `snapshot`, which are how a Lua Server lists anything
 * at all since it has no `sessions` accessor.
 */
const QUERY = /^(search-|snapshot$)/
const bareName = (s: ApiSymbol) =>
  s.name
    .replace(/\(.*$/, '')
    .replace(/Async$/, '')
    .toLowerCase()

export function memberTier(s: ApiSymbol, signals: MemberSignals): MemberTier {
  const name = s.name.replace(/\(.*$/, '')
  // Demotions first: a private listing helper such as `_list_panes` is still
  // private, and a deprecated `list_sessions` is still deprecated.
  if (/^__\w+__$/.test(name)) return 'special'
  if (name.startsWith('_') || s.modifiers?.includes('private') || s.apiScope === 'internal') return 'private'
  if (s.doc?.deprecated !== undefined || s.modifiers?.includes('deprecated')) return 'deprecated'
  if (signals.parentObjects.has(idOf(s))) return 'parent'
  const concept = signals.conceptIds.get(idOf(s))
  if (LISTING.test(bareName(s)) || concept?.startsWith('list-')) return 'listing'
  if (concept && QUERY.test(concept)) return 'query'
  if (concept) return 'concept'
  if (signals.mentions.get(idOf(s)) || s.doc?.examples?.length) return 'discussed'
  return 'public'
}

/**
 * Tier, then declared before inherited, then the breadth of the concept a
 * member realises and its place in the concept map, then how often the
 * guides discuss it, then the name.
 *
 * Breadth is the key that makes the concept tier readable: Python's Server
 * maps most of its members to a concept, and by name alone `bind_key` led
 * `new_session`. Every port implements `new-session`; fewer bind keys.
 */
export function compareMembers(signals: MemberSignals): (a: ApiSymbol, b: ApiSymbol) => number {
  const tier = new Map<ApiSymbol, number>()
  const rank = (s: ApiSymbol) => {
    let t = tier.get(s)
    if (t === undefined) {
      t = MEMBER_TIERS.indexOf(memberTier(s, signals))
      tier.set(s, t)
    }
    return t
  }
  return (a, b) =>
    rank(a) - rank(b) ||
    (memberTier(a, signals) === 'parent'
      ? signals.parentObjects.get(idOf(a))!.level - signals.parentObjects.get(idOf(b))!.level ||
        signals.parentObjects.get(idOf(a))!.variant - signals.parentObjects.get(idOf(b))!.variant
      : 0) ||
    Number(Boolean(a.inheritedFrom)) - Number(Boolean(b.inheritedFrom)) ||
    (signals.conceptPorts.get(idOf(b)) ?? 0) - (signals.conceptPorts.get(idOf(a)) ?? 0) ||
    (signals.conceptOrder.get(idOf(a)) ?? Infinity) - (signals.conceptOrder.get(idOf(b)) ?? Infinity) ||
    (memberTier(a, signals) === 'listing' ? listingRank(a, signals) - listingRank(b, signals) : 0) ||
    (signals.mentions.get(idOf(b)) ?? 0) - (signals.mentions.get(idOf(a)) ?? 0) ||
    a.name.localeCompare(b.name) ||
    idOf(a).localeCompare(idOf(b))
}
