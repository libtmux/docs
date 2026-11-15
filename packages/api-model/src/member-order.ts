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
  /** The broadest concept by public id. */
  readonly conceptIds: ReadonlyMap<string, string>
  /** Listing roles survive a broader concept that also names the operation. */
  readonly listingConcepts: ReadonlyMap<string, string>
  /** Where that concept sits in the concept map, which lists core operations first. */
  readonly conceptOrder: ReadonlyMap<string, number>
  /** Containing object rank by public id: window, session, then server. */
  readonly parentObjects: ReadonlyMap<string, { level: number; variant: number }>
  readonly inheritedParents: ReadonlyMap<string, ReadonlySet<string>>
  /** Guide pages that discuss a member, by public id. */
  readonly mentions: ReadonlyMap<string, number>
  /** The suffix that names a method's promise-returning twin on this port, when it has one. */
  readonly twinSuffix?: string
}

/**
 * The suffix that spells a method's promise-returning twin, per port.
 *
 * Raku declares `snapshot` and `snapshot-async` side by side. A reader looks for the twin where the original is, so a
 * twin has the signals of its original unless it has some of its own. Other ports name twins differently
 * (`xAsync`, `x_async`) or not at all, and `close-async` there is an unrelated name.
 */
const TWIN_SUFFIX: Readonly<Record<string, string>> = { raku: '-async' }

/** A map whose entry for a twin falls back to the entry for its original: no entry is invented for a twin that does not exist. */
class TwinMap<V> extends Map<string, V> {
  private readonly suffix: string | undefined
  constructor(suffix: string | undefined) {
    super()
    this.suffix = suffix
  }
  override get(id: string): V | undefined {
    const own = super.get(id)
    return own !== undefined || !this.suffix || !id.endsWith(this.suffix) ? own : super.get(id.slice(0, -this.suffix.length))
  }
  override has(id: string): boolean { return this.get(id) !== undefined }
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
  const twinSuffix = TWIN_SUFFIX[port]
  const conceptPorts = new TwinMap<number>(twinSuffix)
  const conceptIds = new TwinMap<string>(twinSuffix)
  const listingConcepts = new TwinMap<string>(twinSuffix)
  const conceptOrder = new TwinMap<number>(twinSuffix)
  const parentObjects = new TwinMap<{ level: number; variant: number }>(twinSuffix)
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
      if (id.startsWith('list-') && !listingConcepts.has(target)) listingConcepts.set(target, id)
      if (concept.parentObject) parentObjects.set(target, {
        level: ['window', 'session', 'server'].indexOf(concept.parentObject), variant,
      })
      if ((conceptPorts.get(target) ?? 0) < ports) {
        conceptPorts.set(target, ports)
        conceptIds.set(target, id)
        conceptOrder.set(target, index)
      }
    }
  }
  const counts = new TwinMap<number>(twinSuffix)
  for (const m of mentions) if (m.port === port) counts.set(m.symbol, (counts.get(m.symbol) ?? 0) + 1)
  return { conceptPorts, conceptIds, listingConcepts, conceptOrder, parentObjects, inheritedParents, mentions: counts, twinSuffix }
}

const idOf = (s: ApiSymbol) => s.publicId ?? s.id

const TYPE_KINDS: ReadonlySet<ApiSymbol['kind']> = new Set(['class', 'interface', 'struct', 'union', 'enum', 'trait', 'typealias', 'exception'])
/** A name, possibly qualified: no type arguments, unions, object types or functions. */
const BARE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/**
 * The declaration a type alias names, when its right-hand side is one bare reference.
 *
 * `type ConnectOptions = ConnectionOptions` is the same type as its target, so its page
 * shows the target's members. A reference with type arguments, a union or an object
 * type is a new type and has none to show. The alias's own module wins over a same-named
 * declaration elsewhere; otherwise the name must be unique in the model.
 */
export function aliasTarget(model: ApiModelBase, alias: ApiSymbol): ApiSymbol | undefined {
  const reference = alias.kind === 'typealias' ? alias.type?.trim() : undefined
  if (!reference || !BARE_REFERENCE.test(reference)) return undefined
  const name = reference.slice(reference.lastIndexOf('.') + 1)
  const named = model.symbols.filter((symbol) => symbol !== alias && symbol.name === name && TYPE_KINDS.has(symbol.kind))
  const scope = alias.parent ?? alias.id.slice(0, Math.max(0, alias.id.length - alias.name.length - 1))
  const local = named.filter((symbol) => symbol.id === `${scope}.${name}` || (scope === '' && symbol.id === name))
  const found = local.length ? local : named
  return found.length === 1 ? found[0] : undefined
}

/** Ports whose `type` on an alias is its right-hand side, as written, and whose alias pages are covered by tests. */
const ALIAS_MEMBER_PORTS: ReadonlySet<string> = new Set(['ts'])

/**
 * The declaration whose members an alias page lists: an alias that owns no member and names
 * one declaration, on a port that has opted in.
 */
export function aliasMembersTarget(model: ApiModelBase & { port?: string }, owner: ApiSymbol): ApiSymbol | undefined {
  if (!ALIAS_MEMBER_PORTS.has(model.port ?? (model as { language?: string }).language ?? '')) return undefined
  if (model.symbols.some((symbol) => symbol.parent === owner.id)) return undefined
  return aliasTarget(model, owner)
}

/** Include explicit public re-exports without inferring access from private bases. */
export function membersOf(model: ApiModelBase & { port?: string }, owner: ApiSymbol, signals = memberSignals(model.port ?? '')): ApiSymbol[] {
  const members = model.symbols.filter((symbol) => symbol.parent === owner.id)
  for (const id of signals.inheritedParents.get(idOf(owner)) ?? []) {
    const source = model.symbols.find((symbol) => idOf(symbol) === id)
    if (source && !members.some((member) => idOf(member) === id || member.name === source.name)) {
      members.push({ ...source, parent: owner.id, inheritedFrom: source.parent })
    }
  }
  return sortMembers(owner, members, signals)
}

const sortMembers = (owner: ApiSymbol, members: ApiSymbol[], signals: MemberSignals) =>
  owner.variant || owner.declarations?.some((declaration) => declaration.kind === 'constant')
    ? members : members.sort(compareMembers(signals))

/**
 * The members a type's own page lists: `membersOf`, and for an alias of one declaration that
 * declaration's members too. An alias is another name, so each keeps its id and page.
 *
 * Only the alias page and its Markdown export call this. The navigation tree, sidebar, search
 * and inventories take `membersOf`, where a member has exactly one owner.
 */
export function pageMembersOf(model: ApiModelBase & { port?: string }, owner: ApiSymbol, signals = memberSignals(model.port ?? ''), seen = new Set<string>()): ApiSymbol[] {
  const members = membersOf(model, owner, signals)
  const target = members.length ? undefined : aliasMembersTarget(model, owner)
  if (!target || seen.has(target.id)) return members
  seen.add(owner.id)
  // The target's members keep their own inheritance marks; an alias adds none.
  const listed = pageMembersOf(model, target, signals, seen).map((member) => ({ ...member, parent: owner.id }))
  return sortMembers(owner, listed, signals)
}

/**
 * `sessions`, `Sessions`, `sessions()`, `list_sessions`, `listSessions`,
 * `ListSessionsAsync`, `GetClientsAsync`: accessors that walk one
 * level down tmux's hierarchy.
 */
const LISTING = /^(list_?|get)?(sessions|windows|panes|clients|buffers)$/
const LISTING_ORDER = ['sessions', 'windows', 'panes', 'clients', 'buffers']
const listingRank = (s: ApiSymbol, signals: MemberSignals) => {
  const concept = signals.listingConcepts.get(idOf(s))
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
    .replace(/\/\d+$/, '')
    .replace(/Async$/, '')
    .replace(/[!?]$/, '')
    .toLowerCase()

export function memberTier(s: ApiSymbol, signals: MemberSignals): MemberTier {
  const name = s.name.replace(/\(.*$/, '').replace(/\/\d+$/, '')
  // Demotions first: a private listing helper such as `_list_panes` is still
  // private, and a deprecated `list_sessions` is still deprecated.
  if (/^__\w+__$/.test(name)) return 'special'
  if (name.startsWith('_') || s.modifiers?.includes('private') || s.apiScope === 'internal') return 'private'
  if (s.doc?.deprecated !== undefined || s.modifiers?.includes('deprecated')) return 'deprecated'
  if (signals.parentObjects.has(idOf(s))) return 'parent'
  const concept = signals.conceptIds.get(idOf(s))
  if (LISTING.test(bareName(s)) || signals.listingConcepts.has(idOf(s))) return 'listing'
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
  // Equal signals put a twin by its original; ordering by the original's name keeps another method from landing between them.
  const base = (s: ApiSymbol) => signals.twinSuffix && s.name.endsWith(signals.twinSuffix) ? s.name.slice(0, -signals.twinSuffix.length) : s.name
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
        signals.parentObjects.get(idOf(a))!.variant - signals.parentObjects.get(idOf(b))!.variant : 0) ||
    Number(Boolean(a.inheritedFrom)) - Number(Boolean(b.inheritedFrom)) ||
    (signals.conceptPorts.get(idOf(b)) ?? 0) - (signals.conceptPorts.get(idOf(a)) ?? 0) ||
    (signals.conceptOrder.get(idOf(a)) ?? Infinity) - (signals.conceptOrder.get(idOf(b)) ?? Infinity) ||
    (memberTier(a, signals) === 'listing' ? listingRank(a, signals) - listingRank(b, signals) : 0) ||
    (signals.mentions.get(idOf(b)) ?? 0) - (signals.mentions.get(idOf(a)) ?? 0) ||
    base(a).localeCompare(base(b)) ||
    a.name.localeCompare(b.name) ||
    idOf(a).localeCompare(idOf(b))
}
