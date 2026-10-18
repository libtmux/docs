/** tmux options, hooks and format variables, extracted for each pinned release. */
import { createHash } from 'node:crypto'
import { CONCEPTS, conceptsFor, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from './api-models'
import pins from '../data/tmux/versions.json'
import v32 from '../data/tmux/catalog/3.2a.json'
import v37 from '../data/tmux/catalog/3.7c.json'
import type { ApiTreeJson } from './api-search'
import type { TreeBucket } from './api-tree'
import { withPortRoot } from './site-root'
import { TMUX_REPOSITORY, buildsTmuxDocumentation, tmuxManualUrl, TMUX_VERSIONS } from './tmux-manual-data'

export type CatalogKind = 'option' | 'hook' | 'format'

export interface CatalogSite { file: string; line: number; call?: string }

/** One entry as extracted by `scripts/gen-tmux-catalog.mjs`. */
export interface CatalogEntry {
  kind: CatalogKind
  name: string
  scope?: string[]
  type?: string
  array?: boolean
  style?: boolean
  default?: string | number | string[]
  choices?: string[]
  minimum?: number
  maximum?: number
  unit?: string
  pattern?: string
  separator?: string
  aliases?: string[]
  alias?: string
  after?: string
  notification?: string
  firedFrom?: CatalogSite[]
  callback?: string
  documented?: boolean
  descriptionSource: 'manual' | 'control-mode' | 'after-hook' | 'source' | 'none'
  html: string
  summary: string
  sourceText?: string
  manual?: { anchor: string }
  source: CatalogSite
}

export interface CatalogModel {
  schemaVersion: number
  version: string
  revision: string
  sourceCommit: string
  sourceTree: string
  manualSha256: string
  counts: Record<CatalogKind, number>
  entries: CatalogEntry[]
}

const models: Record<string, CatalogModel> = {
  '3.2a': v32 as unknown as CatalogModel,
  '3.7c': v37 as unknown as CatalogModel,
}

export const CATALOG_KINDS: Record<CatalogKind, { label: string; singular: string; segment: string; blurb: string }> = {
  option: { label: 'Options', singular: 'option', segment: 'options', blurb: 'Settings for the server, sessions, windows and panes, with their types, defaults and allowed values.' },
  hook: { label: 'Hooks', singular: 'hook', segment: 'hooks', blurb: 'Events that run tmux commands, with the scope each hook belongs to and where tmux fires it.' },
  format: { label: 'Formats', singular: 'format variable', segment: 'formats', blurb: 'Variables available in formats, such as status lines and the -F flag of list commands.' },
}
const KINDS = Object.keys(CATALOG_KINDS) as CatalogKind[]
export const catalogKindForSegment = (segment: string | undefined) => KINDS.find((kind) => CATALOG_KINDS[kind].segment === segment)

export const CATALOG_TITLE = 'Options, hooks and formats'

export function tmuxCatalog(version = 'latest'): CatalogModel {
  const model = models[version === 'latest' ? pins.latest : version]
  if (!model) throw new Error(`Unknown tmux catalog version: ${version}`)
  return model
}

const indexes = new WeakMap<CatalogModel, Map<string, CatalogEntry>>()
function entryIndex(model: CatalogModel) {
  let index = indexes.get(model)
  if (!index) {
    index = new Map()
    for (const entry of model.entries) {
      index.set(`${entry.kind}/${entry.name}`, entry)
      for (const alias of entry.aliases ?? []) index.set(`${entry.kind}/${alias}`, entry)
    }
    indexes.set(model, index)
  }
  return index
}

/** Names resolve to their canonical entry, including the spelling tmux accepts for colour options. */
export function tmuxCatalogEntry(version: string, kind: CatalogKind, name: string): CatalogEntry | undefined {
  return entryIndex(tmuxCatalog(version)).get(`${kind}/${name}`)
}

export const tmuxCatalogEntries = (version: string, kind?: CatalogKind) =>
  tmuxCatalog(version).entries.filter((entry) => !kind || entry.kind === kind)

export function tmuxCatalogUrl(version = 'latest', kind?: CatalogKind, name = ''): string {
  const path = kind ? `${CATALOG_KINDS[kind].segment}/${name ? `${name}/` : ''}` : ''
  return withPortRoot(`/tmux/${version}/catalog/${path}`)
}

/** Linkable address of a name in one release, or nothing when that release lacks it. */
export function tmuxCatalogHref(kind: CatalogKind, name: string, version = 'latest'): string | undefined {
  const entry = tmuxCatalogEntry(version, kind, name)
  return entry ? tmuxCatalogUrl(version, kind, entry.name) : undefined
}

/** An entry absent from another release leads to that release's section instead. */
export function tmuxCatalogVersionUrl(version: string, kind?: CatalogKind, name?: string): string {
  const exists = kind && name && tmuxCatalogEntry(version, kind, name)
  return exists ? tmuxCatalogUrl(version, kind, name) : tmuxCatalogUrl(version, kind)
}

export function tmuxCatalogManualUrl(version: string, entry: CatalogEntry): string | undefined {
  return entry.manual ? `${tmuxManualUrl(version, 'full')}#${entry.manual.anchor}` : undefined
}

export function tmuxCatalogSourceUrl(version: string, site: CatalogSite): string {
  return `https://github.com/${TMUX_REPOSITORY}/blob/${tmuxCatalog(version).sourceCommit}/${site.file}#L${site.line}`
}

export function tmuxCatalogRoutes(): { version: string; slug?: string }[] {
  if (!buildsTmuxDocumentation()) return []
  return TMUX_VERSIONS.flatMap((version) => [
    { version },
    ...KINDS.filter((kind) => tmuxCatalog(version).counts[kind]).flatMap((kind) => [
      { version, slug: CATALOG_KINDS[kind].segment },
      ...tmuxCatalogEntries(version, kind).map((entry) => ({ version, slug: `${CATALOG_KINDS[kind].segment}/${entry.name}` })),
    ]),
  ])
}

/* ----------------------------------------------------------------- history */

const COMPARED = ['scope', 'type', 'default', 'choices', 'minimum', 'maximum', 'unit', 'array', 'style'] as const

type CatalogValue = string | number | boolean | string[] | undefined

export interface CatalogRelease {
  version: string
  present: boolean
  /** Fields whose value differs from the previous pinned release. */
  changes: { field: string; from: CatalogValue; to: CatalogValue }[]
}

/** Presence and changes across the pinned releases, oldest first. */
export function tmuxCatalogHistory(kind: CatalogKind, name: string): CatalogRelease[] {
  const releases = [...pins.versions].reverse().map((pin) => pin.version)
  const out: CatalogRelease[] = []
  let previous: CatalogEntry | undefined
  for (const version of releases) {
    const entry = tmuxCatalogEntry(version, kind, name)
    const changes = entry && previous
      ? COMPARED.flatMap((field) => JSON.stringify(previous![field]) === JSON.stringify(entry[field]) ? []
        : [{ field, from: previous![field], to: entry[field] }])
      : []
    out.push({ version, present: Boolean(entry), changes })
    previous = entry ?? previous
  }
  return out
}

const FIELD_LABELS: Record<string, string> = {
  scope: 'scope', type: 'type', default: 'default', choices: 'values', minimum: 'minimum', maximum: 'maximum',
  unit: 'unit', array: 'array', style: 'style',
}
const show = (value: string | number | boolean | string[] | undefined): string => {
  if (value === undefined) return 'none'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  const text = Array.isArray(value) ? value.join(', ') : String(value)
  return text.length > 48 ? (Array.isArray(value) ? 'a longer list' : 'a longer value') : text
}

/** One difference between two pinned releases, in a clause. */
export function tmuxCatalogChangeText(change: CatalogRelease['changes'][number]): string {
  const label = FIELD_LABELS[change.field] ?? change.field
  return change.from === undefined ? `${label} now ${show(change.to)}` : `${label} ${show(change.from)} to ${show(change.to)}`
}

/* --------------------------------------------------------------- navigation */

interface Group { id: string; label: string }

const OPTION_GROUPS: Record<string, Group> = {
  server: { id: 'server', label: 'Server options' },
  session: { id: 'session', label: 'Session options' },
  window: { id: 'window', label: 'Window options' },
  'window+pane': { id: 'window-pane', label: 'Window and pane options' },
  pane: { id: 'pane', label: 'Pane options' },
}
const HOOK_PREFIXES: [string, Group][] = [
  ['after-', { id: 'after', label: 'After a command' }],
  ['alert-', { id: 'alert', label: 'Window alerts' }],
  ['client-', { id: 'client', label: 'Clients' }],
  ['pane-', { id: 'pane', label: 'Panes' }],
  ['session-', { id: 'session', label: 'Sessions' }],
  ['window-', { id: 'window', label: 'Windows' }],
]
const FORMAT_SCOPES: Record<string, Group> = {
  pane: { id: 'pane', label: 'Pane' },
  window: { id: 'window', label: 'Window' },
  session: { id: 'session', label: 'Session' },
  client: { id: 'client', label: 'Client' },
  buffer: { id: 'buffer', label: 'Paste buffer' },
  mouse: { id: 'mouse', label: 'Mouse' },
  server: { id: 'server', label: 'Server' },
}
const OTHER: Group = { id: 'other', label: 'Other' }

/** The sidebar group of an entry, from its scope or the shape of its name. */
export function tmuxCatalogGroup(entry: CatalogEntry, version: string): Group {
  if (entry.kind === 'option') {
    const group = OPTION_GROUPS[(entry.scope ?? []).join('+')]
    if (!group) throw new Error(`Unknown option scope for ${entry.name}: ${entry.scope?.join('+')}`)
    return group
  }
  if (entry.kind === 'hook') return HOOK_PREFIXES.find(([prefix]) => entry.name.startsWith(prefix))?.[1] ?? { id: 'other', label: 'Other hooks' }
  const scope = entry.scope?.[0]
  if (scope) return FORMAT_SCOPES[scope] ?? OTHER
  // Variables with no callback group by their leading word when several share it.
  const word = entry.name.split('_')[0]
  const siblings = tmuxCatalogEntries(version, 'format').filter((other) => !other.scope && other.name.split('_')[0] === word)
  return siblings.length >= 3 ? { id: word, label: word[0].toUpperCase() + word.slice(1) } : OTHER
}

const navigations = new Map<string, { tree: TreeBucket[]; json: ApiTreeJson; version: string }>()

/** The shared reference tree and its search inventory for one release. */
export function tmuxCatalogNavigation(version: string) {
  const cached = navigations.get(version)
  if (cached) return cached
  const model = tmuxCatalog(version)
  const tree: TreeBucket[] = KINDS.filter((kind) => model.counts[kind]).map((kind) => {
    const info = CATALOG_KINDS[kind]
    const groups = new Map<string, { group: Group; entries: CatalogEntry[] }>()
    for (const entry of tmuxCatalogEntries(version, kind)) {
      const group = tmuxCatalogGroup(entry, version)
      const bucket = groups.get(group.id) ?? { group, entries: [] }
      bucket.entries.push(entry)
      groups.set(group.id, bucket)
    }
    const ordered = [...groups.values()].sort((a, b) => Number(a.group.id === 'other') - Number(b.group.id === 'other'))
    return {
      id: info.segment, label: info.label, collapsed: false, entries: [],
      target: { id: `catalog.${kind}`, name: info.label, slug: info.segment, kind: 'catalog-section' },
      children: ordered.map(({ group, entries }) => ({
        id: `${info.segment}-${group.id}`, label: group.label, collapsed: false, children: [],
        entries: entries.map((entry) => ({ id: `${kind}.${entry.name}`, name: entry.name, slug: `${info.segment}/${entry.name}`, kind })),
      })),
    }
  })
  const bucket = (entry: TreeBucket): ApiTreeJson['buckets'][number] => ({
    id: entry.id, label: entry.label,
    count: entry.entries.length + entry.children.reduce((total, child) => total + child.entries.length, 0),
    slug: entry.target?.slug ?? entry.entries[0]?.slug ?? null,
    types: entry.entries.map((row) => {
      const found = tmuxCatalogEntry(version, row.kind as CatalogKind, row.name)!
      return { ...row, m: 0 as const, symbolName: found.name, qualifiedName: found.name,
        category: CATALOG_KINDS[found.kind].segment, summary: [found.summary, ...(found.aliases ?? []), found.alias ?? ''].join(' ').trim() }
    }),
    children: entry.children.map(bucket),
  })
  const json: ApiTreeJson = { port: `tmux-catalog-${version}`, buckets: tree.map(bucket), members: {} }
  const hash = createHash('sha256').update(JSON.stringify([model.sourceCommit, json])).digest('hex').slice(0, 20)
  const value = { tree, json, version: `catalog-1:${hash}` }
  navigations.set(version, value)
  return value
}

/* ------------------------------------------------------------------ display */

export const OPTION_TYPES: Record<string, string> = {
  string: 'Text', number: 'Number', key: 'Key', colour: 'Colour', flag: 'Flag (on or off)', choice: 'Choice', command: 'tmux command',
}

/** The value a reader sets, as tmux prints it. */
export function tmuxCatalogDefault(entry: CatalogEntry): string | undefined {
  if (entry.default === undefined || entry.default === '' || (Array.isArray(entry.default) && !entry.default.length)) return undefined
  return Array.isArray(entry.default) ? entry.default.join(entry.separator ?? ',') : String(entry.default)
}

/** Allowed values: a choice list, a numeric range, or a unit. */
export function tmuxCatalogValues(entry: CatalogEntry): string | undefined {
  if (entry.choices?.length) return entry.choices.join(', ')
  if (entry.minimum !== undefined || entry.maximum !== undefined) {
    const range = `${entry.minimum ?? ''} to ${entry.maximum ?? ''}`.trim()
    return entry.unit ? `${range} ${entry.unit}` : range
  }
  return undefined
}

/** tmux selects a scope with a flag, and session options need none. */
export const OPTION_SCOPE_FLAGS: Record<string, string> = { server: '-s', session: '', window: '-w', pane: '-p' }

export function tmuxCatalogPageTitle(version: string, kind?: CatalogKind, name?: string): string {
  if (name) return name
  return `tmux ${tmuxCatalog(version).version} ${kind ? CATALOG_KINDS[kind].label.toLowerCase() : 'options, hooks and formats'}`
}

export function tmuxCatalogDescription(version: string, kind?: CatalogKind, name?: string): string {
  const model = tmuxCatalog(version)
  if (kind && name) {
    const entry = tmuxCatalogEntry(version, kind, name)
    return entry?.summary || `The ${name} ${CATALOG_KINDS[kind].singular} in tmux ${model.version}.`
  }
  if (kind) return `${CATALOG_KINDS[kind].blurb} Reference for tmux ${model.version}.`
  return `Browse the ${model.counts.option} options, ${model.counts.hook} hooks and ${model.counts.format} format variables of tmux ${model.version}.`
}

const conceptKeys = new Map(Object.entries(CONCEPTS).map(([key, concept]) => [concept, key]))

/**
 * The catalog sections a library member wraps, from the concepts it implements.
 *
 * A concept named for options or hooks (`session-options`, `set-window-hook`)
 * is the library's own statement that the member reads or writes them.
 */
export function tmuxCatalogKindsFor(port: string, publicId: string): CatalogKind[] {
  const kinds = new Set<CatalogKind>()
  for (const concept of conceptsFor(port, publicId)) {
    const key = conceptKeys.get(concept) ?? ''
    if (/(?:^|-)hooks?(?:-|$)/.test(key)) kinds.add('hook')
    else if (/(?:^|-)options?(?:-|$)/.test(key)) kinds.add('option')
  }
  return [...kinds]
}

const callbacks = new WeakMap<CatalogModel, Map<string, CatalogEntry>>()

/**
 * Catalog pages for a declaration in the C source reference.
 *
 * The tables lead to their section, a format callback to the variable it
 * computes, and a notification function to the hooks.
 */
export function tmuxCatalogLinksForSource(version: string, symbolName: string): { name: string; href: string }[] {
  const model = tmuxCatalog(version)
  if (/^options_table(?:_entry|_type)?$/.test(symbolName)) {
    return (['option', 'hook'] as const).map((kind) => ({ name: CATALOG_KINDS[kind].label, href: tmuxCatalogUrl(version, kind) }))
  }
  if (/^format_table(?:_entry|_type)?$/.test(symbolName)) return [{ name: CATALOG_KINDS.format.label, href: tmuxCatalogUrl(version, 'format') }]
  if (/^notify_[a-z_]+$/.test(symbolName)) return [{ name: CATALOG_KINDS.hook.label, href: tmuxCatalogUrl(version, 'hook') }]
  if (symbolName.startsWith('format_cb_')) {
    let index = callbacks.get(model)
    if (!index) {
      index = new Map(model.entries.flatMap((entry) => entry.callback ? [[entry.callback, entry] as const] : []))
      callbacks.set(model, index)
    }
    const entry = index.get(symbolName)
    return entry ? [{ name: entry.name, href: tmuxCatalogUrl(version, 'format', entry.name) }] : []
  }
  return []
}

/**
 * Types whose own documentation says they hold tmux hooks or options. Each id
 * is checked against the API model by a test, so a renamed type fails loudly.
 */
export const CATALOG_WRAPPER_TYPES: Record<string, Partial<Record<'option' | 'hook', string[]>>> = {
  py: {
    hook: ['libtmux._internal.constants.Hooks', 'libtmux.hooks.HooksMixin'],
    option: ['libtmux._internal.constants.ServerOptions', 'libtmux._internal.constants.SessionOptions',
      'libtmux._internal.constants.WindowOptions', 'libtmux._internal.constants.PaneOptions',
      'libtmux._internal.constants.Options', 'libtmux.options.OptionsMixin'],
  },
  csharp: { hook: ['LibTmux.TmuxHooks'], option: ['LibTmux.TmuxOptions'] },
  go: {
    hook: ['tmux.ServerHookValues', 'tmux.SessionHookValues', 'tmux.WindowHookValues', 'tmux.PaneHookValues'],
    option: ['tmux.ServerOptionValues', 'tmux.SessionOptionValues', 'tmux.WindowOptionValues', 'tmux.PaneOptionValues'],
  },
  java: { hook: ['io.github.libtmux.Hooks.Hooks'], option: ['io.github.libtmux.Options.Options'] },
  kotlin: { hook: ['io.github.libtmux.kotlin.Hooks'], option: ['io.github.libtmux.kotlin.Options'] },
  scala: { hook: ['io.github.libtmux.scaladsl.cats.Hooks'], option: ['io.github.libtmux.scaladsl.cats.Options'] },
  ruby: { hook: ['LibTmux::Hooks'], option: ['LibTmux::Options'] },
}

const symbolIds = new Map<string, Map<string, ApiSymbol>>()

/** The catalog sections a library declaration wraps: by concept, by wrapper type, or as a member of one. */
export function tmuxCatalogKindsForSymbol(port: string, symbol: ApiSymbol): CatalogKind[] {
  const kinds = new Set(tmuxCatalogKindsFor(port, symbol.publicId ?? symbol.id))
  const wrappers = CATALOG_WRAPPER_TYPES[port]
  if (wrappers) {
    let byId = symbolIds.get(port)
    if (!byId) {
      byId = new Map((API_MODELS[port]?.symbols ?? []).map((candidate) => [candidate.id, candidate]))
      symbolIds.set(port, byId)
    }
    const parent = symbol.parent ? byId.get(symbol.parent) : undefined
    for (const kind of ['hook', 'option'] as const) {
      const types = wrappers[kind] ?? []
      if (types.some((id) => id === (symbol.publicId ?? symbol.id) || (parent && id === (parent.publicId ?? parent.id)))) kinds.add(kind)
    }
  }
  return [...kinds]
}
