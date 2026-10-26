/** tmux source data adapted to the shared API reference and navigation. */
import { docSummaryText, navSidecarFor, pageSlug, sourceUrl, type ApiSymbol, type SourceApiModel, type SymbolIndex } from '@libtmux/api-model'
import v32 from '../data/tmux/api/3.2a.json?raw'
import v37 from '../data/tmux/api/3.7c.json?raw'
import pins from '../data/tmux/versions.json'
import { createApiIndex, type PortNavData } from './api-models'
import type { LinkPreview } from './link-preview'
import { limitPreviewSignature } from './preview-signature'
import { navTreeFor, referenceTreeFor, referenceBreadcrumbs } from './api-tree'
import { apiRelationshipPath } from './api-relationships'
import { PORTS } from './ports'
import { withPortRoot } from './site-root'
import { buildsTmuxDocumentation, TMUX_VERSIONS, tmuxApiLinks, tmuxManualUrl } from './tmux-manual-data'
import { tmuxCatalogLinksForSource } from './tmux-catalog'
import { tmuxScopes, tmuxUsage, tmuxUsageCommands, tmuxUsageOf, type CommandUsage, type SymbolUsage, type TmuxScope, type UsageGroup } from './tmux-library-usage'

export interface TmuxSourceModel extends SourceApiModel {
  commands: { name: string; entry: string; callback: string }[]
  profile: {
    pin: string
    sourceCommit: string
    producer: string
    configuredPlatform: string
    inputs: string[]
  }
}

const models: Record<string, TmuxSourceModel> = {
  '3.2a': JSON.parse(v32) as TmuxSourceModel,
  '3.7c': JSON.parse(v37) as TmuxSourceModel,
}
export function tmuxSourceModel(version = 'latest'): TmuxSourceModel {
  const model = models[version === 'latest' ? pins.latest : version]
  if (!model) throw new Error(`Unknown tmux source version: ${version}`)
  return model
}
export function tmuxReferenceUrl(version = 'latest', symbol?: ApiSymbol): string {
  const slug = symbol ? symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id) : ''
  return withPortRoot(`/tmux/${version}/reference/${slug ? `${slug}/` : ''}`)
}

/** Stable declaration IDs preserve the selected symbol across releases. */
export function tmuxReferenceVersionUrl(version: string, currentVersion: string, slug?: string): string {
  const symbol = tmuxSourceModel(currentVersion).symbols.find((entry) => entry.slug === slug)
  const counterpart = symbol && tmuxSourceModel(version).symbols.find((entry) => entry.id === symbol.id)
  return tmuxReferenceUrl(version, counterpart)
}

const domains = [
  { id: 'server', label: 'Server', names: /^server(?!_(?:client|acl))(?:_|$)/, files: /^server(?:-fn)?\.c$/ },
  { id: 'session', label: 'Session', names: /^session(?:s|_|$)/, files: /^session\.c$/ },
  { id: 'pane', label: 'Pane', names: /^(?:window_pane|window_mode)(?:s|_|$)/, files: /^window-(?:copy|buffer|client|tree|clock|customize)\.c$/ },
  { id: 'window', label: 'Window', names: /^(?:window(?!_(?:pane|mode))|winlink)(?:s|_|$)/, files: /^window\.c$/ },
  { id: 'client', label: 'Client', names: /^(?:client|server_client|server_acl)(?:s|_|$)/, files: /^(?:client|server-client|server-acl)\.c$/ },
  { id: 'commands', label: 'Commands', names: /^(?:cmd|args)(?:_|$)/, files: /^(?:cmd(?:-.*)?|arguments)\.c$/ },
  { id: 'screen', label: 'Screen and terminal', names: /^(?:screen|grid|tty|input|colour|utf8)(?:_|$)/, files: /^(?:screen|grid|tty|input|colour|utf8)(?:-.*)?\.c$/ },
  { id: 'options', label: 'Options and formats', names: /^(?:options|format|environ)(?:_|$)/, files: /^(?:options|format|environ)(?:-.*)?\.c$/ },
  { id: 'layout', label: 'Layouts and buffers', names: /^(?:layout|paste)(?:_|$)/, files: /^(?:layout|paste)(?:-.*)?\.c$/ },
  { id: 'compat', label: 'Compatibility', names: /^(?:compat)_/, files: /^compat\// },
]

/** Entry points into each subsystem, in the order a reader follows its work. */
const selections: Record<string, string[]> = {
  server: [
    'c:function:server_start', 'c:function:server_create_socket',
    'c:function:server_update_socket', 'c:function:server_check_unattached',
    'c:function:server_destroy_session', 'c:function:server_kill_window',
    'c:function:server_kill_pane',
  ],
  session: [
    'c:struct:session', 'c:function:session_create',
    'c:function:session_find', 'c:function:session_find_by_id',
    'c:function:session_attach', 'c:function:session_detach',
    'c:function:session_select', 'c:function:session_set_current',
    'c:function:session_destroy',
  ],
  window: [
    'c:struct:window', 'c:struct:winlink',
    'c:function:window_create', 'c:function:window_find_by_id',
    'c:function:window_set_active_pane', 'c:function:window_add_pane',
    'c:function:window_remove_pane', 'c:function:window_resize',
  ],
  pane: [
    'c:struct:window_pane', 'c:function:window_pane_find_by_id',
    'c:function:window_pane_at_index', 'c:function:window_pane_key',
    'c:function:window_pane_paste', 'c:function:window_pane_resize',
    'c:function:window_pane_set_mode', 'c:function:window_pane_reset_mode',
  ],
  client: [
    'c:struct:client', 'c:function:client_main',
    'c:function:server_client_create', 'c:function:server_client_open',
    'c:function:server_client_set_session', 'c:function:server_client_detach',
    'c:function:server_client_lost',
  ],
  commands: [
    'c:struct:cmd', 'c:struct:cmd_entry',
    'c:struct:args', 'c:struct:cmd_parse_result',
    'c:struct:cmd_find_state', 'c:function:cmd_parse_from_string',
    'c:function:cmd_find_target', 'c:function:cmdq_get_command',
    'c:function:cmdq_append', 'c:function:cmdq_next',
  ],
  options: [
    'c:struct:options', 'c:struct:format_tree',
    'c:struct:environ', 'c:function:options_get',
    'c:function:options_set_string', 'c:function:options_set_number',
    'c:function:format_create', 'c:function:format_expand',
  ],
  screen: [
    'c:struct:screen', 'c:struct:grid',
    'c:struct:grid_cell', 'c:struct:tty',
    'c:function:screen_init', 'c:function:screen_resize',
    'c:function:screen_write_start', 'c:function:screen_write_puts',
    'c:function:screen_write_stop',
  ],
  layout: [
    'c:struct:layout_cell', 'c:struct:paste_buffer',
    'c:function:layout_init', 'c:function:layout_split_pane',
    'c:function:layout_resize_pane', 'c:function:paste_get_top',
    'c:function:paste_set',
  ],
}

const navigationCache = new WeakMap<TmuxSourceModel, ReturnType<typeof navigationFor>>()
function navigationFor(model: TmuxSourceModel) {
  const topLevel = model.symbols.filter((entry) => !entry.parent)
  const available = new Set(topLevel.map((symbol) => symbol.id))
  const groups = new Map<string, string[]>()
  for (const symbol of topLevel) {
    // Primary object names group their operations; source files place the rest.
    const domain = domains.find((entry) => entry.names.test(symbol.name))
      ?? domains.find((entry) => entry.files.test(symbol.source.file))
    const key = domain?.id ?? 'support'
    const entries = groups.get(key) ?? []
    entries.push(symbol.id)
    groups.set(key, entries)
  }
  const buckets = [...domains, { id: 'support', label: 'Supporting declarations' }]
    .filter((domain) => groups.has(domain.id))
    .map((domain) => {
      const ids = groups.get(domain.id)!
      const order = (selections[domain.id] ?? []).filter((id) => available.has(id))
      const rest = ids.filter((id) => !order.includes(id))
      return {
        id: domain.id, label: domain.label,
        collapsed: !['server', 'session', 'window', 'pane', 'client'].includes(domain.id),
        match: { kind: 'id' as const, is: ids }, order,
        ...(order.length && rest.length ? { children: [{
          id: `${domain.id}-support`, label: 'Supporting declarations', collapsed: true,
          match: { kind: 'id' as const, is: rest },
        }] } : {}),
      }
    })
  // Match order handles overlapping vocabulary; display follows tmux's hierarchy.
  const order = ['server', 'session', 'window', 'pane', 'client', 'commands', 'options', 'screen', 'layout', 'compat', 'support']
  buckets.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
  const nav = navSidecarFor('tmux', model, { buckets }) as ReturnType<typeof navSidecarFor> & PortNavData
  return { nav, tree: navTreeFor(model, nav) }
}
function navigation(model: TmuxSourceModel) {
  let value = navigationCache.get(model)
  if (!value) { value = navigationFor(model); navigationCache.set(model, value) }
  return value
}

const indexes = new Map<string, SymbolIndex>()
export function tmuxReferenceIndex(version = 'latest'): SymbolIndex {
  const base = tmuxReferenceUrl(version)
  let index = indexes.get(base)
  if (!index) {
    index = createApiIndex(tmuxSourceModel(version), (symbol) => tmuxReferenceUrl(version, symbol))
    indexes.set(base, index)
  }
  return index
}
export function tmuxReferenceTree(version = 'latest') {
  const model = tmuxSourceModel(version)
  return referenceTreeFor('tmux', model, navigation(model).tree)
}
const scopeFunctions = new Map<string, ApiSymbol | undefined>()

/**
 * The C function that lists a command at one scope in a release. A release that dispatches inline has
 * none, so the scope's column leads to the command's own function, where the dispatch is, unless the
 * caller asks for the scope's function alone.
 */
export function tmuxScopeFunction(version: string, command: string, scope: TmuxScope, { inline = true }: { inline?: boolean } = {}): ApiSymbol | undefined {
  const model = tmuxSourceModel(version)
  const key = `${model.version}\0${command}\0${scope.id}`
  const exec = model.symbols.find((entry) => entry.id === model.commands.find((candidate) => candidate.name === command)?.callback)
  if (!scopeFunctions.has(key)) {
    scopeFunctions.set(key, exec && model.symbols.find((entry) => entry.name === scope.function && entry.source.file === exec.source.file && entry.id.startsWith('c:function:')))
  }
  return scopeFunctions.get(key) ?? (inline && scope.inline?.includes(model.version) ? exec : undefined)
}

/**
 * The commands a C declaration belongs to, and for a scope's function, that scope.
 * A command's entry and callback answer for every scope.
 */
export function tmuxSourceUsage(version: string, symbol: ApiSymbol): { command: string; scope?: string }[] {
  const direct = tmuxSourceModel(version).commands
    .filter((command) => command.entry === symbol.id || command.callback === symbol.id)
    .map((command) => ({ command: command.name }))
  const scoped = tmuxUsageCommands().flatMap((command) => tmuxScopes(command)
    .filter((scope) => tmuxScopeFunction(version, command, scope, { inline: false })?.id === symbol.id)
    .map((scope) => ({ command, scope: scope.id })))
  return [...direct, ...scoped]
}

export function tmuxSourceCommands(version: string, symbol: ApiSymbol) {
  return tmuxSourceUsage(version, symbol)
    .map(({ command }) => ({ name: command, href: tmuxManualUrl(version, command) }))
    .filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index)
}

export interface ResolvedUsageGroup extends UsageGroup {
  /** The C function behind the scope, in the release the page describes. */
  function?: { name: string; href: string }
}
export interface ResolvedUsage extends Omit<CommandUsage, 'groups'> {
  manualHref: string
  groups: ResolvedUsageGroup[]
}

/** A command's usage with each scope's C function linked in one release. */
export function tmuxResolvedUsage(version: string, command: string, scope?: string): ResolvedUsage | undefined {
  const usage = tmuxUsage(command, { scope })
  if (!usage) return undefined
  return {
    ...usage,
    manualHref: tmuxManualUrl(version, command),
    groups: usage.groups.map((group) => {
      const target = group.scope && tmuxScopeFunction(version, command, group.scope)
      return { ...group, ...(target ? { function: { name: target.name, href: tmuxReferenceUrl(version, target) } } : {}) }
    }),
  }
}
export function tmuxCommandSources(version: string, name: string) {
  const model = tmuxSourceModel(version)
  const command = model.commands.find((entry) => entry.name === name)
  const scoped = tmuxScopes(name).flatMap((scope) => tmuxScopeFunction(version, name, scope, { inline: false }) ?? [])
  return command ? [...[command.entry, command.callback].flatMap((id) => model.symbols.find((entry) => entry.id === id) ?? []), ...scoped]
    .map((symbol) => ({ name: symbol.name, kind: symbol.kind, href: tmuxReferenceUrl(version, symbol) })) : []
}

export interface SymbolSend extends Omit<SymbolUsage, 'scopes'> {
  manualHref: string
  scopes: (SymbolUsage['scopes'][number] & { function?: { name: string; href: string } })[]
}

export interface CommandRow {
  command: string
  href: string
  scopes: SymbolSend['scopes']
  /** When the symbol sends the command, if only some calls do and every scope says the same. A scope that says otherwise says it itself. */
  when?: string
}

/** The one condition every scope of a send carries, or nothing when some scope carries another or none. */
export function sharedWhen(send: Pick<SymbolSend, 'scopes'>): string | undefined {
  const first = send.scopes[0]?.when
  return first !== undefined && send.scopes.every((use) => use.when === first) ? first : undefined
}

/**
 * The commands a symbol page names, in the order a reader should weigh them:
 * what the symbol itself sends, then the commands it has an equivalent for,
 * then what it sends through a helper, which is rarely why anyone is here.
 */
export function tmuxCommandRows(sends: SymbolSend[], equivalents: { name: string; href: string }[]): CommandRow[] {
  const rows = (list: SymbolSend[]) => list.map((send): CommandRow => ({
    command: send.command, href: send.manualHref, scopes: send.scopes.filter((use) => use.scope),
    ...(sharedWhen(send) ? { when: sharedWhen(send) } : {}),
  }))
  const direct = (send: SymbolSend) => send.scopes.some((use) => use.listed)
  const sent = new Set(sends.map((send) => send.command))
  return [
    ...rows(sends.filter(direct)),
    // A command the symbol is recorded as sending is named once, by what it sends.
    ...equivalents.filter((entry) => !sent.has(entry.name)).map((entry): CommandRow => ({ command: entry.name, href: entry.href, scopes: [] })),
    ...rows(sends.filter((send) => !direct(send))),
  ]
}

/**
 * One destination pair of a method page's tmux command line: the command with the flag that picks the scope, and the C
 * function that implements it at that scope. A command sent at three scopes is three items, so each reads whole.
 */
export interface CommandItem {
  command: string
  href: string
  /** The scope this item sends the command at; a command with no scope is the command alone. */
  scope?: NonNullable<SymbolSend['scopes'][number]['scope']>
  function?: { name: string; href: string }
  when?: string
  /** The line that sends, or for a wrapper the core call it makes: what the scope's tooltip cites. */
  evidence?: string
}

/** The items of a command line, one for each scope a command is sent at and one for a command with none. */
export function tmuxCommandItems(rows: CommandRow[]): CommandItem[] {
  return rows.flatMap((row): CommandItem[] => row.scopes.length
    ? row.scopes.map((use) => ({
      command: row.command, href: row.href, scope: use.scope!,
      ...(use.function ? { function: use.function } : {}),
      ...(use.when ? { when: use.when } : {}),
      evidence: use.via ? `Calls ${use.via.symbol}: ${use.via.evidence[0]}` : use.evidence[0],
    }))
    : [{ command: row.command, href: row.href, ...(row.when ? { when: row.when } : {}) }])
}

/**
 * What goes between the items of one line. A comma already separates a command from its C function, so a line that
 * has one uses a semicolon between items, and a line of commands alone keeps the comma.
 */
export const tmuxCommandSeparator = (items: CommandItem[]) => items.some((item) => item.function) ? '; ' : ', '

/** The commands a library symbol sends, with each scope's manual and C function. */
export function tmuxSymbolSends(port: string, publicId: string, version = 'latest'): SymbolSend[] {
  return tmuxUsageOf(port, publicId).map((entry) => ({
    ...entry,
    manualHref: tmuxManualUrl(version, entry.command),
    scopes: entry.scopes.map((use) => {
      const target = use.scope && tmuxScopeFunction(version, entry.command, use.scope)
      return { ...use, ...(target ? { function: { name: target.name, href: tmuxReferenceUrl(version, target) } } : {}) }
    }),
  }))
}
/**
 * The card a link to a declaration of tmux's C source opens, from the same record as the page it leads to. tmux's source
 * carries no Doxygen briefs, so the card says where the declaration is and shows it, which is what a reader following a
 * link from a method wants to see before leaving the page. A declaration longer than a card holds shows its head, and the
 * page has all of it (`limitPreviewSignature`).
 */
export function tmuxReferencePreview(version: string, symbol: ApiSymbol): LinkPreview {
  const model = tmuxSourceModel(version)
  const full = symbol.signatures[0]?.raw ?? (symbol.value !== undefined ? `${symbol.name} = ${symbol.value}` : undefined)
  const signature = full === undefined ? undefined : limitPreviewSignature(full)
  const summary = symbol.doc?.summary ?? symbol.signatures.find((entry) => entry.doc?.summary)?.doc?.summary
  return {
    schema: 1, title: symbol.name, kind: symbol.kind,
    description: summary ? docSummaryText(summary, 'c') : '',
    detail: `Defined in ${symbol.source.file}${symbol.source.line ? `, line ${symbol.source.line}` : ''} of tmux ${model.version}.${signature !== full ? ' The card shows the first lines of the declaration.' : ''}`,
    signature, signatureLanguage: signature ? 'c' : undefined,
    href: tmuxReferenceUrl(version, symbol), source: sourceUrl(model, symbol),
  }
}
export function tmuxReferenceRoutes() {
  return buildsTmuxDocumentation() ? TMUX_VERSIONS.flatMap((version) => [
    { version, symbol: undefined as ApiSymbol | undefined },
    ...tmuxSourceModel(version).symbols.map((symbol) => ({ version, symbol })),
  ]) : []
}
/** Representative reading paths, checked against each version's native edges. */
export function tmuxReferencePaths(version = 'latest') {
  const model = tmuxSourceModel(version)
  const paths = [
    apiRelationshipPath(model, 'Create a session and its first pane', [
      'c:function:cmd-new-session.c:cmd_new_session_exec', 'c:function:spawn_window',
      'c:function:spawn_pane', 'c:function:window_add_pane', 'c:function:window.c:window_pane_create',
    ]),
    apiRelationshipPath(model, 'Split a window', [
      'c:function:cmd-split-window.c:cmd_split_window_exec', 'c:function:spawn_pane',
      'c:function:window_add_pane', 'c:function:window.c:window_pane_create',
    ]),
    apiRelationshipPath(model, 'Start the server and create a client', [
      'c:function:server_start', 'c:function:server_client_create', 'c:function:proc_add_peer',
    ]),
  ]
  return paths.filter((path) => path !== undefined)
}
export function tmuxReferenceContext(version: string, symbol?: ApiSymbol) {
  const model = tmuxSourceModel(version)
  const referenceNavigation = navigation(model)
  const commands = symbol ? tmuxSourceCommands(version, symbol) : []
  const sources = symbol ? tmuxSourceUsage(version, symbol) : []
  const usage = sources.flatMap(({ command, scope }) => tmuxResolvedUsage(version, command, scope) ?? [])
  const sent = new Map<string, string>()
  for (const entry of usage.flatMap((resolved) => resolved.groups.flatMap((group) => group.ports))) {
    if (!sent.has(entry.port)) sent.set(entry.port, entry.links[0].href)
  }
  // The command's own pages offer a language that sends nothing the page of its
  // equivalent API; a scope's page has no equivalent for a language without that scope.
  const scopeOnly = sources.length > 0 && sources.every((entry) => entry.scope)
  const equivalents = scopeOnly ? [] : commands.flatMap((command) => tmuxApiLinks(command.name))
  return {
    model, version, label: 'tmux C', title: 'tmux C source reference',
    description: `C declarations from tmux ${model.version}. These are tmux internals, not a supported external library API.`,
    referenceBase: tmuxReferenceUrl(version),
    pagePath: `tmux/${version}/reference${symbol ? `/${symbol.slug}` : ''}`,
    breadcrumbs: [
      { name: 'tmux', url: withPortRoot('/tmux/') },
      { name: `Reference (${model.version})`, url: tmuxReferenceUrl(version) },
      ...(symbol ? referenceBreadcrumbs(model, referenceNavigation.nav, referenceNavigation.tree, symbol,
        tmuxReferenceUrl(version), (entry) => tmuxReferenceUrl(version, entry)) : []),
    ],
    ...referenceNavigation, index: tmuxReferenceIndex(version), paths: tmuxReferencePaths(version),
    manualLinks: commands,
    usage,
    catalogLinks: symbol ? tmuxCatalogLinksForSource(version, symbol.name) : [],
    pagePorts: PORTS.map((port) => ({ port: port.slug, name: port.name,
      links: sent.has(port.slug) ? [{ href: sent.get(port.slug)! }]
        : [...new Set(equivalents.filter((entry) => entry.name === port.name).map((entry) => entry.href))].map((href) => ({ href })),
    })),
  }
}
