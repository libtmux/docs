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
  /** The library symbol a wrapper's claim stands on. */
  via?: { port: string; symbol: string }
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
 * A direct sender is the symbol whose own body sends the command. A call
 * through a helper is recorded as evidence and listed with the method, but
 * not on the command's pages, which would otherwise list every method that
 * refreshes a pane afterwards.
 */
export const LISTED_MAX_HOPS = 0

const symbolIndexes = new Map<string, Map<string, ApiSymbol>>()
function symbolOf(port: string, publicId: string): ApiSymbol | undefined {
  let index = symbolIndexes.get(port)
  if (!index) {
    index = new Map((API_MODELS[port]?.symbols ?? []).map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
    symbolIndexes.set(port, index)
  }
  return index.get(publicId)
}

const TYPE_KINDS = new Set(['class', 'interface', 'struct', 'union', 'enum', 'trait', 'exception'])

/** The type that owns a member, when it has one. */
function ownerOf(port: string, symbol: ApiSymbol): ApiSymbol | undefined {
  const parent = symbol.parent ? API_MODELS[port]?.symbols.find((entry) => entry.id === symbol.parent) : undefined
  return parent && TYPE_KINDS.has(parent.kind) ? parent : undefined
}

/** `Server.panes`, `Server#list_panes`, `Server::panes`: the member with the type that owns it. */
export function usageLabel(port: string, symbol: ApiSymbol): string {
  const owner = ownerOf(port, symbol)
  if (!owner) return symbol.name
  const qualified = qualifiedNameOf(symbol)
  const at = qualified.lastIndexOf(owner.name)
  return at >= 0 ? qualified.slice(at) : `${owner.name}.${symbol.name}`
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
  via?: { port: string; symbol: string }
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
    evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), ...(use.via ? { via: use.via } : {}),
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
      const links = Object.entries(document.symbols).flatMap(([publicId, uses]) => uses
        .filter((use) => use.command === command && use.scope === (group?.id ?? null) && (use.reviewed || use.evidence.length - 1 <= LISTED_MAX_HOPS))
        .flatMap((use) => linkFor(port.slug, publicId, use, version) ?? []))
        .sort((a, b) => ownerRank(group, a.owner, Boolean(a.owner)) - ownerRank(group, b.owner, Boolean(b.owner)) || a.label.localeCompare(b.label))
      return links.length ? [{ port: port.slug, name: PORT_NAME[port.slug] ?? port.name, links }] : []
    }),
  }))
  return groups.some((group) => group.ports.length) ? { command, groups } : undefined
}

export interface SymbolUsage {
  command: string
  scopes: { scope: TmuxScope | undefined; evidence: string[]; hops: number; reviewed: boolean; via?: { port: string; symbol: string } }[]
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
        ? scopes.flatMap((scope) => list.filter((use) => use.scope === scope.id).map((use) => ({ scope, evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), via: use.via })))
        : list.map((use) => ({ scope: undefined, evidence: use.evidence, hops: use.evidence.length - 1, reviewed: Boolean(use.reviewed), via: use.via })),
    }
  })
}

/** The commands the data records for a symbol, whatever the scope. */
export const tmuxUsageCommandsOf = (port: string, publicId: string): string[] => tmuxUsageOf(port, publicId).map((entry) => entry.command)
