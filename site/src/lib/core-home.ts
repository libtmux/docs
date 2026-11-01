/**
 * What a port's Core Library home shows: its own Server, Session, Window and
 * Pane types, and the capabilities it really has, each tied to the symbol of
 * the extracted API model that provides it.
 *
 * `data/core-home.json` names symbols only. Labels, the tmux object each type
 * wraps and every link come from here and from the model, so a symbol that is
 * wrong, renamed or removed fails `resolveCoreHome` (and
 * `test/core-home.test.ts`) instead of rendering a dead link or a claim
 * nothing backs. A capability a port lacks has no entry and is not listed.
 */
import { qualifiedNameOf, type ApiSymbol } from '@libtmux/api-model'
import DATA from '../data/core-home.json'
import { API_MODELS, referenceHref } from './api-models.ts'
import { PORT_BY_SLUG } from './ports.ts'

export const CORE_ROLES = ['server', 'session', 'window', 'pane'] as const
export type CoreRole = (typeof CORE_ROLES)[number]

/** The tmux object a port's type wraps, in hierarchy order. */
export const TMUX_OBJECTS: Readonly<Record<CoreRole, { wraps: string; id: string }>> = {
  server: { wraps: 'A tmux server', id: '' },
  session: { wraps: 'A session', id: '$' },
  window: { wraps: 'A window in a session', id: '@' },
  pane: { wraps: 'A pane in a window', id: '%' },
}

export const CAPABILITIES = {
  objects: { group: 'typed', label: 'Typed objects instead of parsed format strings' },
  ids: { group: 'typed', label: 'Addressing by tmux ID' },
  queries: { group: 'typed', label: 'Filtering and queries over tmux objects' },
  errors: { group: 'typed', label: 'Typed errors instead of exit codes and stderr' },
  traversal: { group: 'cli', label: 'Traversal from a server down to its panes' },
  argv: { group: 'cli', label: 'Arguments passed as a list, with no shell quoting' },
  'version-gate': { group: 'cli', label: 'A typed error when the running tmux lacks a feature' },
  'current-pane': { group: 'cli', label: 'Finds the current pane from TMUX and TMUX_PANE' },
  'test-fixtures': { group: 'cli', label: 'Isolated tmux servers for tests' },
  async: { group: 'cli', label: 'Async operations' },
} as const
export type CapabilityKey = keyof typeof CAPABILITIES

export const CAPABILITY_GROUPS = {
  typed: 'Typed API',
  cli: 'What you get over the tmux CLI',
} as const

/**
 * What a symbol must show to back a capability. Each test reads the model's
 * own name, qualified name or signature, so mapping a capability to an
 * unrelated symbol fails `resolveCoreHome` rather than rendering a claim the
 * symbol does not support.
 */
const CAPABILITY_EVIDENCE: Record<CapabilityKey, { needs: string; test: (symbol: ApiSymbol) => boolean }> = {
  objects: { needs: 'a type, function or property', test: (symbol) => symbol.kind !== 'constant' },
  ids: { needs: 'an ID type or accessor', test: (symbol) => /\b(id|ID)\b|Id\b|ID\b|Ref\b/.test(symbol.name) },
  queries: { needs: 'a filter, query or selection', test: (symbol) => /filter|query|select|where|expr/i.test(symbol.name) },
  errors: { needs: 'an error, exception or failure type', test: (symbol) => /error|exception|failure/i.test(symbol.name) },
  traversal: { needs: 'a panes, windows, sessions or snapshot accessor', test: (symbol) => /panes|windows|sessions|snapshot/i.test(symbol.name) },
  argv: { needs: 'a command or run symbol', test: (symbol) => /cmd|command|run|exec|invoke/i.test(symbol.name) },
  'version-gate': { needs: 'a version or unsupported-feature error', test: (symbol) => /version|unsupported|capabilit/i.test(symbol.name) },
  'current-pane': { needs: 'an environment constructor', test: (symbol) => /env/i.test(symbol.name) },
  'test-fixtures': { needs: 'a test or fixture symbol', test: (symbol) => /test|fixture|junit|pytest/i.test(`${qualifiedNameOf(symbol)} ${symbol.source?.file ?? ''}`) },
  async: { needs: 'an async, suspend, Promise or Task signature', test: (symbol) => /async|suspend|promise|task|await/i.test(`${symbol.name} ${JSON.stringify(symbol.signatures)}`) },
}

export interface CoreHomeEntry {
  objects: Record<CoreRole, string>
  capabilities: Partial<Record<CapabilityKey, string>>
}

export interface CoreSymbolLink {
  /** The symbol's `publicId ?? id`, as the model and the reference route name it. */
  id: string
  /** Name as the reference shows it. */
  name: string
  href: string
}

export interface CoreHome {
  summary: string
  objects: (CoreSymbolLink & { role: CoreRole; wraps: string; tmuxId: string })[]
  capabilities: Record<keyof typeof CAPABILITY_GROUPS, (CoreSymbolLink & { key: CapabilityKey; label: string })[]>
}

export const CORE_HOME: Readonly<Record<string, CoreHomeEntry>> = DATA as Record<string, CoreHomeEntry>

function link(port: string, id: string, version: string, what: string, evidence?: CapabilityKey): CoreSymbolLink {
  const symbol = API_MODELS[port]?.symbols.find((entry) => (entry.publicId ?? entry.id) === id)
  if (!symbol) throw new Error(`core-home: ${port} ${what} names ${id}, which is not in its API model`)
  if (symbol.apiScope === 'internal' || (symbol.product ?? 'core') !== 'core') {
    throw new Error(`core-home: ${port} ${what} names ${id}, which has no core reference page`)
  }
  const needed = evidence && CAPABILITY_EVIDENCE[evidence]
  if (needed && !needed.test(symbol)) throw new Error(`core-home: ${port} ${what} names ${id}, which is not ${needed.needs}`)
  const href = referenceHref(port, id, version)
  if (!href) throw new Error(`core-home: ${port} ${what} has no reference page for ${id}`)
  return { id, name: qualifiedNameOf(symbol), href }
}

/** Resolve one port's entry against its model; throws on any unresolvable symbol. */
export function resolveCoreHome(port: string, version: string, entry: CoreHomeEntry | undefined = CORE_HOME[port]): CoreHome {
  const info = PORT_BY_SLUG[port]
  if (!info) throw new Error(`core-home: unknown port ${port}`)
  if (!entry) throw new Error(`core-home: ${port} has no entry`)
  const objects = CORE_ROLES.map((role) => {
    if (!entry.objects[role]) throw new Error(`core-home: ${port} names no ${role} type`)
    return { role, ...link(port, entry.objects[role], version, role), wraps: TMUX_OBJECTS[role].wraps, tmuxId: TMUX_OBJECTS[role].id }
  })
  const capabilities: CoreHome['capabilities'] = { typed: [], cli: [] }
  for (const [key, id] of Object.entries(entry.capabilities)) {
    const capability = CAPABILITIES[key as CapabilityKey]
    if (!capability) throw new Error(`core-home: ${port} lists unknown capability ${key}`)
    capabilities[capability.group].push({ key: key as CapabilityKey, label: capability.label, ...link(port, id, version, key, key as CapabilityKey) })
  }
  for (const group of Object.values(capabilities)) group.sort((a, b) =>
    Object.keys(CAPABILITIES).indexOf(a.key) - Object.keys(CAPABILITIES).indexOf(b.key))
  return { summary: `Control tmux servers, sessions, windows and panes from ${info.language}.`, objects, capabilities }
}

/** The page's facts as Markdown, for the `.md` twin and llms-full.txt. */
export function coreHomeMarkdown(port: string, version: string, origin: string): string {
  const home = resolveCoreHome(port, version)
  const at = (href: string) => new URL(href, origin).href
  return [
    home.summary,
    '## Structure',
    '| Type | Wraps |\n| ---- | ----- |\n' + home.objects.map((object) =>
      `| [\`${object.name}\`](${at(object.href)}) | ${object.wraps}${object.tmuxId ? `, ID \`${object.tmuxId}n\`` : ''} |`).join('\n'),
    ...Object.entries(CAPABILITY_GROUPS).flatMap(([group, title]) => {
      const rows = home.capabilities[group as keyof typeof CAPABILITY_GROUPS]
      return rows.length ? [`## ${title}`, rows.map((row) => `- ${row.label}: [\`${row.name}\`](${at(row.href)})`).join('\n')] : []
    }),
  ].join('\n\n')
}

/** The headings `CoreHome.astro` renders, for the page's contents list. */
export function coreHomeHeadings(port: string, version: string, example = true): { depth: 2; slug: string; text: string }[] {
  const home = resolveCoreHome(port, version)
  return [
    { depth: 2, slug: 'install', text: 'Install' },
    ...(example ? [{ depth: 2 as const, slug: 'example', text: 'Example' }] : []),
    { depth: 2, slug: 'structure', text: 'Structure' },
    ...Object.entries(CAPABILITY_GROUPS).filter(([group]) => home.capabilities[group as keyof typeof CAPABILITY_GROUPS].length)
      .map(([group, text]) => ({ depth: 2 as const, slug: group === 'typed' ? 'typed-api' : 'over-the-tmux-cli', text })),
  ]
}
