/**
 * Which library symbols send which tmux commands, and at which scope.
 *
 * The data is `site/src/data/tmux-usage/<port>.json`, written by
 * `scripts/gen-tmux-usage.mjs` from each port's source at the revision its
 * API model was extracted from. A symbol appears only where the source shows
 * it sending the command, so a link here is a claim about the code.
 */
import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, referenceHref } from './api-models'
import { PORTS } from './ports'
import scopeTable from '../data/tmux-usage/scopes.json'
import csharp from '../data/tmux-usage/csharp.json'
import cxx from '../data/tmux-usage/cxx.json'
import fsharp from '../data/tmux-usage/fsharp.json'
import go from '../data/tmux-usage/go.json'
import java from '../data/tmux-usage/java.json'
import julia from '../data/tmux-usage/julia.json'
import kotlin from '../data/tmux-usage/kotlin.json'
import lua from '../data/tmux-usage/lua.json'
import powershell from '../data/tmux-usage/powershell.json'
import py from '../data/tmux-usage/py.json'
import rs from '../data/tmux-usage/rs.json'
import ruby from '../data/tmux-usage/ruby.json'
import scala from '../data/tmux-usage/scala.json'
import swift from '../data/tmux-usage/swift.json'
import ts from '../data/tmux-usage/ts.json'

/** One use of a command by a symbol, as the generator records it. */
export interface UsageUse {
  command: string
  /** The command's scope, or `null` for a command that has none. */
  scope: string | null
  /** `file:line` in the port's repository at its pinned revision, the send site first. */
  evidence: string[]
  /** A reviewed claim the generator checked line by line, not a scan result. */
  reviewed?: boolean
  /** When the method sends it, for a send that only some calls make: a few words, shown beside the method. */
  when?: string
  /** The core library symbol a wrapper forwards to, and the lines that show it sends. */
  via?: { port: string; symbol: string; revision?: string; evidence: string[]; reviewed?: boolean }
}

export interface UsageDocument {
  schemaVersion: number
  port: string
  repo: string
  revision: string
  commands: string[]
  symbols: Record<string, UsageUse[]>
}

export interface TmuxScope {
  id: string
  label: string
  /** The flag that selects the scope in tmux, empty for the default. */
  flag: string
  /** The target flag, for a scope selected by what the target names. */
  target?: string
  /** The C function that lists at this scope. */
  function: string
  /** Releases that dispatch on the scope inline, with no function for it. */
  inline?: string[]
}

export const TMUX_USAGE: Record<string, UsageDocument> = {
  csharp, cxx, fsharp, go, java, julia, kotlin, lua, powershell, py, rs, ruby, scala, swift, ts,
} as unknown as Record<string, UsageDocument>

const SCOPES = scopeTable.commands as Record<string, { scopes: TmuxScope[] }>

/** Commands whose usage the data records. */
export function tmuxUsageCommands(): string[] {
  return [...new Set(Object.values(TMUX_USAGE).flatMap((document) => document.commands))].sort()
}

/** The scopes tmux gives a command, in the order its dispatch tests them. */
export function tmuxScopes(command: string): TmuxScope[] {
  return SCOPES[command]?.scopes ?? []
}

/**
 * A direct sender is the symbol whose own body sends the command, and is
 * listed. A call through a helper is recorded as evidence and shown with the
 * method, but is listed on the command's pages only when the method's own name
 * says it is for that command: `Pane.sendKeys` sends `send-keys` through a
 * helper and is listed, while a method that refreshes a pane afterwards sends
 * `list-panes` through one and is not. A wrapper is listed when the core method
 * it forwards to is.
 */
export const LISTED_MAX_HOPS = 0

/** Words a method may use for the verb of a command, where the library's wording differs from tmux's. */
const VERB_ALIASES: Record<string, string[]> = {
  list: ['list', 'search', 'find', 'get', 'all', 'snapshot', 'read'],
  show: ['show', 'get', 'read', 'all'],
  display: ['display', 'show'],
  new: ['new', 'create', 'open', 'start'],
  kill: ['kill', 'close', 'destroy', 'remove', 'delete'],
  set: ['set', 'unset', 'append', 'configure', 'apply'],
}

/** The lower-case words of a member name: `sendKeysAsync`, `send_keys` and `Send-TmuxText` each give `send` first. */
function memberWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase())
    .filter((word) => word && word !== 'async' && word !== 'tmux').map((word) => (/(?:ss|us|is)$/.test(word) ? word : word.replace(/s$/, '')))
}

/** Whether a member's name carries the verb of the command: `sendKeys` for `send-keys`, `Create` for `new`. */
export function namesCommand(command: string, member: string): boolean {
  const verb = command.split('-')[0]
  const accepted = VERB_ALIASES[verb] ?? [verb]
  return memberWords(member).some((word) => accepted.includes(word))
}

/** The member a symbol id ends with, without the owners before it or the argument labels after it: `Server.capture(_:includingHistory:)` gives `capture`. */
const memberName = (id: string): string => id.replace(/\(.*$/s, '').split(/[.#:\\]+/).at(-1) ?? id

/**
 * Whether a use belongs on the command's own pages, and not only on the method's.
 *
 * @param members the names the use may be listed under: the symbol's own, and for a wrapper the core method's.
 */
export function isListed(use: UsageUse, ...members: string[]): boolean {
  if (use.reviewed) return true
  if (use.via) return isListed({ command: use.command, scope: use.scope, evidence: use.via.evidence, reviewed: use.via.reviewed }, ...members, use.via.symbol)
  return use.evidence.length - 1 <= LISTED_MAX_HOPS || members.some((member) => namesCommand(use.command, memberName(member)))
}

const symbolIndexes = new Map<string, Map<string, ApiSymbol>>()
function symbolOf(port: string, publicId: string): ApiSymbol | undefined {
  let index = symbolIndexes.get(port)
  if (!index) {
    index = new Map((API_MODELS[port]?.symbols ?? []).map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
    symbolIndexes.set(port, index)
  }
  return index.get(publicId)
}

const TYPE_KINDS = new Set(['class', 'interface', 'struct', 'union', 'enum', 'trait', 'exception', 'typealias'])

/** The type that owns a member, when it has one. */
function ownerOf(port: string, symbol: ApiSymbol): ApiSymbol | undefined {
  const parent = symbol.parent ? API_MODELS[port]?.symbols.find((entry) => entry.id === symbol.parent) : undefined
  return parent && TYPE_KINDS.has(parent.kind) ? parent : undefined
}

/** Where the segment that names the owner starts in a qualified name, whole segments only: `Pane` is not the end of `NewPane`. */
function ownerSegment(qualified: string, owner: string): number {
  const parts = qualified.split(/(\.|::|#|:)/)
  for (let index = parts.length - 3; index >= 0; index -= 2) {
    if (parts[index] === owner) return parts.slice(0, index).join('').length
  }
  return -1
}

/** `Server.panes`, `Server#list_panes`, `Server::panes`: the member with the type that owns it. */
export function usageLabel(port: string, symbol: ApiSymbol): string {
  const owner = ownerOf(port, symbol)
  if (!owner) return symbol.name
  const qualified = qualifiedNameOf(symbol)
  const at = ownerSegment(qualified, owner.name)
  return at >= 0 ? qualified.slice(at) : `${owner.name}.${symbol.name}`
}

/**
 * Two methods of one language that share a label, such as Scala's plain and cats `Server.panes`, are told
 * apart by the namespace that holds their type: `scaladsl.Server.panes` and `cats.Server.panes`.
 */
function apart(links: UsageLink[]): UsageLink[] {
  const counts = Map.groupBy(links, (link) => link.label)
  return links.map((link) => {
    if (counts.get(link.label)!.length < 2 || !link.owner) return link
    const symbol = symbolOf(link.port, link.symbolId)
    const qualified = symbol ? qualifiedNameOf(symbol) : ''
    const at = ownerSegment(qualified, link.owner)
    // The namespace segment before the owner, with the separator that joins it: `cats.Server.panes`, `Async::Server#new_session`.
    const before = /([A-Za-z_]\w*)(\.|::)$/.exec(qualified.slice(0, at))
    return before ? { ...link, label: `${before[1]}${before[2]}${qualified.slice(at)}` } : link
  })
}

/**
 * Methods of the object a scope names come first: `Server` for the server,
 * `Session` for a session, `Window` for a window. Free functions follow, and
 * a method of another type, which sends the command for its own purpose, last.
 */
function ownerRank(scope: TmuxScope | undefined, owner: string | undefined, hasOwner: boolean): number {
  if (!scope || !hasOwner) return 1
  return owner?.toLowerCase() === scope.label.toLowerCase() ? 0 : 2
}

export interface UsageLink {
  port: string
  symbolId: string
  label: string
  kind: string
  href: string
  /** The name of the type that owns the symbol, when it has one. */
  owner?: string
  scope: string | null
  evidence: string[]
  hops: number
  reviewed: boolean
  /** The condition under which the method sends it, when not every call does. */
  when?: string
  via?: UsageUse['via']
}

export interface UsageGroup {
  scope: TmuxScope | undefined
  ports: { port: string; name: string; links: UsageLink[] }[]
}

export interface CommandUsage {
  command: string
  /** One group per scope, or a single group without a scope for an unscoped command. */
  groups: UsageGroup[]
}

function linkFor(port: string, publicId: string, use: UsageUse, version?: string): UsageLink | undefined {
  const symbol = symbolOf(port, publicId)
  const href = symbol && referenceHref(port, publicId, version)
  if (!symbol || !href) return undefined
  return {
    port, symbolId: publicId, label: usageLabel(port, symbol), kind: symbol.kind, href, scope: use.scope, owner: ownerOf(port, symbol)?.name,
    evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), ...(use.when ? { when: use.when } : {}), ...(use.via ? { via: use.via } : {}),
  }
}

/**
 * The library symbols that send a command, by scope and then by port in the
 * order the site lists ports.
 *
 * @param scope Keep only this scope, for the page of the C function that lists at it.
 */
export function tmuxUsage(command: string, { scope, version }: { scope?: string; version?: string } = {}): CommandUsage | undefined {
  if (!tmuxUsageCommands().includes(command)) return undefined
  const scopes = tmuxScopes(command)
  const wanted: (TmuxScope | undefined)[] = scopes.length ? scopes.filter((candidate) => !scope || candidate.id === scope) : [undefined]
  const groups = wanted.map((group): UsageGroup => ({
    scope: group,
    ports: PORTS.flatMap((port) => {
      const document = TMUX_USAGE[port.slug]
      if (!document) return []
      const links = apart(Object.entries(document.symbols).flatMap(([publicId, uses]) => uses
        .filter((use) => use.command === command && use.scope === (group?.id ?? null) && isListed(use, publicId))
        .flatMap((use) => linkFor(port.slug, publicId, use, version) ?? [])))
        .sort((a, b) => ownerRank(group, a.owner, Boolean(a.owner)) - ownerRank(group, b.owner, Boolean(b.owner)) || a.label.localeCompare(b.label))
      return links.length ? [{ port: port.slug, name: PORT_NAME[port.slug] ?? port.name, links }] : []
    }),
  }))
  return groups.some((group) => group.ports.length) ? { command, groups } : undefined
}

export interface SymbolUsage {
  command: string
  scopes: { scope: TmuxScope | undefined; evidence: string[]; hops: number; reviewed: boolean; listed: boolean; when?: string; via?: UsageUse['via'] }[]
}

/** The commands one symbol sends, with the scope and the lines that show it. Every hop counts here. */
export function tmuxUsageOf(port: string, publicId: string): SymbolUsage[] {
  const uses = TMUX_USAGE[port]?.symbols[publicId] ?? []
  const byCommand = Map.groupBy(uses, (use) => use.command)
  return [...byCommand].map(([command, list]) => {
    const scopes = tmuxScopes(command)
    return {
      command,
      scopes: scopes.length
        ? scopes.flatMap((scope) => list.filter((use) => use.scope === scope.id).map((use) => ({ scope, evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), listed: isListed(use, publicId), when: use.when, via: use.via })))
        : list.map((use) => ({ scope: undefined, evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), listed: isListed(use, publicId), when: use.when, via: use.via })),
    }
  })
}

/** The commands the data records for a symbol, whatever the scope. */
export const tmuxUsageCommandsOf = (port: string, publicId: string): string[] => tmuxUsageOf(port, publicId).map((entry) => entry.command)
