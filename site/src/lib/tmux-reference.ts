/** tmux source data adapted to the shared API reference and navigation. */
import { navSidecarFor, pageSlug, type ApiSymbol, type SourceApiModel, type SymbolIndex } from '@libtmux/api-model'
import v32 from '../data/tmux/api/3.2a.json?raw'
import v37 from '../data/tmux/api/3.7c.json?raw'
import pins from '../data/tmux/versions.json'
import { createApiIndex, type PortNavData } from './api-models'
import { navTreeFor, referenceTreeFor } from './api-tree'
import { apiRelationshipPath } from './api-relationships'
import { PORTS } from './ports'
import { withPortRoot } from './site-root'
import { buildsTmuxDocumentation, TMUX_VERSIONS, tmuxApiLinks, tmuxManualUrl } from './tmux-manual-data'

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
  const slug = symbol ? (symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)) : ''
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
  {
    id: 'pane',
    label: 'Pane',
    names: /^(?:window_pane|window_mode)(?:s|_|$)/,
    files: /^window-(?:copy|buffer|client|tree|clock|customize)\.c$/,
  },
  { id: 'window', label: 'Window', names: /^(?:window(?!_(?:pane|mode))|winlink)(?:s|_|$)/, files: /^window\.c$/ },
  {
    id: 'client',
    label: 'Client',
    names: /^(?:client|server_client|server_acl)(?:s|_|$)/,
    files: /^(?:client|server-client|server-acl)\.c$/,
  },
  { id: 'commands', label: 'Commands', names: /^(?:cmd|args)(?:_|$)/, files: /^(?:cmd(?:-.*)?|arguments)\.c$/ },
  {
    id: 'screen',
    label: 'Screen and terminal',
    names: /^(?:screen|grid|tty|input|colour|utf8)(?:_|$)/,
    files: /^(?:screen|grid|tty|input|colour|utf8)(?:-.*)?\.c$/,
  },
  {
    id: 'options',
    label: 'Options and formats',
    names: /^(?:options|format|environ)(?:_|$)/,
    files: /^(?:options|format|environ)(?:-.*)?\.c$/,
  },
  {
    id: 'layout',
    label: 'Layouts and buffers',
    names: /^(?:layout|paste)(?:_|$)/,
    files: /^(?:layout|paste)(?:-.*)?\.c$/,
  },
  { id: 'compat', label: 'Compatibility', names: /^(?:compat)_/, files: /^compat\// },
]

/** Entry points into each subsystem, in the order a reader follows its work. */
const selections: Record<string, string[]> = {
  server: [
    'c:function:server_start',
    'c:function:server_create_socket',
    'c:function:server_update_socket',
    'c:function:server_check_unattached',
    'c:function:server_destroy_session',
    'c:function:server_kill_window',
    'c:function:server_kill_pane',
  ],
  session: [
    'c:struct:session',
    'c:function:session_create',
    'c:function:session_find',
    'c:function:session_find_by_id',
    'c:function:session_attach',
    'c:function:session_detach',
    'c:function:session_select',
    'c:function:session_set_current',
    'c:function:session_destroy',
  ],
  window: [
    'c:struct:window',
    'c:struct:winlink',
    'c:function:window_create',
    'c:function:window_find_by_id',
    'c:function:window_set_active_pane',
    'c:function:window_add_pane',
    'c:function:window_remove_pane',
    'c:function:window_resize',
  ],
  pane: [
    'c:struct:window_pane',
    'c:function:window_pane_find_by_id',
    'c:function:window_pane_at_index',
    'c:function:window_pane_key',
    'c:function:window_pane_paste',
    'c:function:window_pane_resize',
    'c:function:window_pane_set_mode',
    'c:function:window_pane_reset_mode',
  ],
  client: [
    'c:struct:client',
    'c:function:client_main',
    'c:function:server_client_create',
    'c:function:server_client_open',
    'c:function:server_client_set_session',
    'c:function:server_client_detach',
    'c:function:server_client_lost',
  ],
  commands: [
    'c:struct:cmd',
    'c:struct:cmd_entry',
    'c:struct:args',
    'c:struct:cmd_parse_result',
    'c:struct:cmd_find_state',
    'c:function:cmd_parse_from_string',
    'c:function:cmd_find_target',
    'c:function:cmdq_get_command',
    'c:function:cmdq_append',
    'c:function:cmdq_next',
  ],
  options: [
    'c:struct:options',
    'c:struct:format_tree',
    'c:struct:environ',
    'c:function:options_get',
    'c:function:options_set_string',
    'c:function:options_set_number',
    'c:function:format_create',
    'c:function:format_expand',
  ],
  screen: [
    'c:struct:screen',
    'c:struct:grid',
    'c:struct:grid_cell',
    'c:struct:tty',
    'c:function:screen_init',
    'c:function:screen_resize',
    'c:function:screen_write_start',
    'c:function:screen_write_puts',
    'c:function:screen_write_stop',
  ],
  layout: [
    'c:struct:layout_cell',
    'c:struct:paste_buffer',
    'c:function:layout_init',
    'c:function:layout_split_pane',
    'c:function:layout_resize_pane',
    'c:function:paste_get_top',
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
    const domain =
      domains.find((entry) => entry.names.test(symbol.name)) ??
      domains.find((entry) => entry.files.test(symbol.source.file))
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
        id: domain.id,
        label: domain.label,
        collapsed: !['server', 'session', 'window', 'pane', 'client'].includes(domain.id),
        match: { kind: 'id' as const, is: ids },
        order,
        ...(order.length && rest.length
          ? {
              children: [
                {
                  id: `${domain.id}-support`,
                  label: 'Supporting declarations',
                  collapsed: true,
                  match: { kind: 'id' as const, is: rest },
                },
              ],
            }
          : {}),
      }
    })
  // Match order handles overlapping vocabulary; display follows tmux's hierarchy.
  const order = [
    'server',
    'session',
    'window',
    'pane',
    'client',
    'commands',
    'options',
    'screen',
    'layout',
    'compat',
    'support',
  ]
  buckets.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
  const nav = navSidecarFor('tmux', model, { buckets }) as ReturnType<typeof navSidecarFor> & PortNavData
  return { nav, tree: navTreeFor(model, nav) }
}
function navigation(model: TmuxSourceModel) {
  let value = navigationCache.get(model)
  if (!value) {
    value = navigationFor(model)
    navigationCache.set(model, value)
  }
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
export function tmuxSourceCommands(version: string, symbol: ApiSymbol) {
  return tmuxSourceModel(version)
    .commands.filter((command) => command.entry === symbol.id || command.callback === symbol.id)
    .map((command) => ({ name: command.name, href: tmuxManualUrl(version, command.name) }))
}
export function tmuxCommandSources(version: string, name: string) {
  const model = tmuxSourceModel(version)
  const command = model.commands.find((entry) => entry.name === name)
  return command
    ? [command.entry, command.callback].flatMap((id) => {
        const symbol = model.symbols.find((entry) => entry.id === id)
        return symbol ? [{ name: symbol.name, href: tmuxReferenceUrl(version, symbol) }] : []
      })
    : []
}
export function tmuxReferenceRoutes() {
  return buildsTmuxDocumentation()
    ? TMUX_VERSIONS.flatMap((version) => [
        { version, symbol: undefined as ApiSymbol | undefined },
        ...tmuxSourceModel(version).symbols.map((symbol) => ({ version, symbol })),
      ])
    : []
}
/** Representative reading paths, checked against each version's native edges. */
export function tmuxReferencePaths(version = 'latest') {
  const model = tmuxSourceModel(version)
  const paths = [
    apiRelationshipPath(model, 'Create a session and its first pane', [
      'c:function:cmd-new-session.c:cmd_new_session_exec',
      'c:function:spawn_window',
      'c:function:spawn_pane',
      'c:function:window_add_pane',
      'c:function:window.c:window_pane_create',
    ]),
    apiRelationshipPath(model, 'Split a window', [
      'c:function:cmd-split-window.c:cmd_split_window_exec',
      'c:function:spawn_pane',
      'c:function:window_add_pane',
      'c:function:window.c:window_pane_create',
    ]),
    apiRelationshipPath(model, 'Start the server and create a client', [
      'c:function:server_start',
      'c:function:server_client_create',
      'c:function:proc_add_peer',
    ]),
  ]
  return paths.filter((path) => path !== undefined)
}
export function tmuxReferenceContext(version: string, symbol?: ApiSymbol) {
  const model = tmuxSourceModel(version)
  const commands = symbol ? tmuxSourceCommands(version, symbol) : []
  const equivalents = commands.flatMap((command) => tmuxApiLinks(command.name))
  return {
    model,
    version,
    label: 'tmux C',
    title: 'tmux C source reference',
    description: `C declarations from tmux ${model.version}. These are tmux internals, not a supported external library API.`,
    referenceBase: tmuxReferenceUrl(version),
    pagePath: `tmux/${version}/reference${symbol ? `/${symbol.slug}` : ''}`,
    breadcrumbs: [
      { name: 'tmux', url: withPortRoot('/tmux/') },
      { name: `Reference (${model.version})`, url: tmuxReferenceUrl(version) },
      ...(symbol ? [{ name: symbol.name, url: tmuxReferenceUrl(version, symbol) }] : []),
    ],
    ...navigation(model),
    index: tmuxReferenceIndex(version),
    paths: tmuxReferencePaths(version),
    manualLinks: commands,
    pagePorts: PORTS.map((port) => ({
      port: port.slug,
      name: port.name,
      links: [...new Set(equivalents.filter((entry) => entry.name === port.name).map((entry) => entry.href))].map(
        (href) => ({ href }),
      ),
    })),
  }
}
