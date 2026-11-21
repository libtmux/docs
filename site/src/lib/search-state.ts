/**
 * What a search remembers: its URL parameters, the Pagefind filters they mean,
 * and the snapshot kept in `history.state` so Back returns to the same view.
 *
 * Pure functions, so the round trip is testable without a DOM. The panel in
 * `search-panel.ts` reads and writes through them.
 */

/** "Go docs and API", "Go API only", "All languages". */
export type SearchScope = 'port' | 'reference' | 'all'

export const SEARCH_SCOPES: readonly SearchScope[] = ['port', 'reference', 'all']

export interface SearchState {
  q: string
  scope: SearchScope
  /** A Pagefind `section` value, such as `guides`. */
  section?: string
  /** A Pagefind `kind` value, such as `method`. */
  kind?: string
}

/** The `port` filter value of a page that belongs to no port, such as a tmux manual page. */
export const ROOT_PORT = 'All languages'

/** The `section` value that holds a port's API reference pages. */
export const REFERENCE_SECTION = 'reference'

/**
 * The site's sections, in reading order, with the words a reader sees. The Section facet holds these and
 * nothing else, on every port: a page that fits none of them carries no `section` value.
 */
export const SECTION_LABELS: Record<string, string> = {
  guides: 'Guides',
  concepts: 'Concepts',
  examples: 'Examples',
  topics: 'Topics',
  reference: 'API reference',
  mcp: 'MCP',
  workspace: 'Workspace Manager',
}

const SECTION_ORDER = Object.keys(SECTION_LABELS)

const knownSection = (name: string | undefined): name is string => name !== undefined && Object.hasOwn(SECTION_LABELS, name)

export const sectionLabel = (section: string) => SECTION_LABELS[section] ?? section.charAt(0).toUpperCase() + section.slice(1)

/** The seven sections the counts hold, in the site's order. Another value, such as one a typed URL names, is not a row. */
export function orderedSections(counts: Record<string, number>): [string, number][] {
  return SECTION_ORDER.filter((name) => counts[name] !== undefined).map((name): [string, number] => [name, counts[name]!])
}

/**
 * The `section` filter value of a page, or none: the first path segment after any port and version, when it
 * is one of the site's sections (`guides`, `concepts`, `examples`, `topics`, `reference`, `mcp`, `workspace`).
 * The home page, the search page, the 404 page, a tmux manual page, the catalog, a port's Core directory and
 * the rest belong to none, and a facet that listed them would name folders instead of sections (record 0075).
 * `pagePath` is relative to the port and version, except for tmux pages, whose own version and kind come first.
 */
export function pageSection(pagePath: string): string | undefined {
  const path = pagePath.startsWith('tmux/')
    ? pagePath.slice(5).replace(/^[^/]+\/(?=manual|reference|catalog)/, '') : pagePath
  const first = path.split('/').filter(Boolean)[0]?.toLowerCase()
  return knownSection(first) ? first : undefined
}

/**
 * The sections a port's native Sphinx tree names differently from the Astro pages: Sphinx's own `api/` and
 * `internals/` trees and its indexes are the API reference, the glossary is a concept page, and the
 * quickstart and the migration notes are guides. `topics/` is `topics` in both.
 */
const NATIVE_SECTIONS: Record<string, string> = {
  api: REFERENCE_SECTION,
  genindex: REFERENCE_SECTION,
  'py-modindex': REFERENCE_SECTION,
  internals: REFERENCE_SECTION,
  glossary: 'concepts',
  quickstart: 'guides',
  migration: 'guides',
}

/**
 * The `section` value of a native Sphinx page, from its path inside the tree the port publishes at
 * `/<port>/<version>/api/` (`api/pane/`, `topics/architecture/`), or none. A first segment that is not
 * mapped, and that the Astro rule does not place either, such as `project/` or `history`, takes no value.
 */
export function nativeSection(path: string): string | undefined {
  const first = path.split('/').filter(Boolean)[0]?.toLowerCase()
  return (first && Object.hasOwn(NATIVE_SECTIONS, first) ? NATIVE_SECTIONS[first] : undefined) ?? pageSection(path)
}

const isScope = (value: string | null): value is SearchScope => SEARCH_SCOPES.includes(value as SearchScope)

/** `?q=&scope=&section=&kind=`, read back; an unknown scope takes the default. */
export function parseSearchState(search: string, defaultScope: SearchScope): SearchState {
  const params = new URLSearchParams(search)
  const scope = params.get('scope')
  return {
    q: params.get('q') ?? '',
    scope: isScope(scope) ? scope : defaultScope,
    section: params.get('section') || undefined,
    kind: params.get('kind') || undefined,
  }
}

/** The query string for a state: empty parameters and the default scope are left out. */
export function searchStateQuery(state: SearchState, defaultScope: SearchScope): string {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.scope !== defaultScope) params.set('scope', state.scope)
  if (state.section) params.set('section', state.section)
  if (state.kind) params.set('kind', state.kind)
  const text = params.toString()
  return text ? `?${text}` : ''
}

type FilterValue = string[] | { any: string[] }
export type PagefindFilters = Record<string, FilterValue>

/** Several values of one filter mean "any of them": a page has one port. */
const anyOf = (values: string[]): FilterValue => (values.length > 1 ? { any: values } : values)

/**
 * The Pagefind filters a state asks for.
 *
 * `ports` are the Port facet's checkboxes, which only apply under "All
 * languages". "<Port> docs and API" searches the port and the root pages, the
 * tmux manual and catalog every port builds on; "<Port> API only" is the port
 * narrowed to reference pages, so its Section facet is fixed.
 */
export function filtersFor(state: SearchState, portName: string | undefined, ports: readonly string[] = []): PagefindFilters | undefined {
  const filters: PagefindFilters = {}
  if (state.scope === 'all') {
    if (ports.length) filters.port = anyOf([...ports])
  } else if (portName) {
    filters.port = state.scope === 'reference' ? [portName] : { any: [portName, ROOT_PORT] }
  }
  const section = state.scope === 'reference' ? REFERENCE_SECTION : state.section
  if (section) filters.section = [section]
  if (state.kind) filters.kind = [state.kind]
  return Object.keys(filters).length ? filters : undefined
}

/** What the scope control says, for a port named `portName` (or the whole site). */
export function scopeLabel(scope: SearchScope, portName: string | undefined): string {
  if (scope === 'all' || !portName) return 'All languages'
  return scope === 'reference' ? `${portName} API only` : `${portName} docs and API`
}

/** The status line: "145 results in Go docs and API · showing 16". */
export function countLine(total: number, shown: number, scope: string): string {
  const noun = `${total} result${total === 1 ? '' : 's'}`
  return shown < total ? `${noun} in ${scope} · showing ${shown}` : `${noun} in ${scope}`
}

/** How many filters beyond the scope a state carries. */
export const filterCount = (state: SearchState, ports: readonly string[] = []) =>
  (state.scope === 'reference' ? 0 : state.section ? 1 : 0) + (state.kind ? 1 : 0) + (state.scope === 'all' ? ports.length : 0)

/** The view a result leaves behind, so Back can put it back. */
export interface SearchSnapshot extends SearchState {
  /** Ports ticked under "All languages". */
  ports: string[]
  /** How many results were on screen. */
  shown: number
  /** The chosen row, or -1. */
  selected: number
  /** The results list's scroll offset. */
  scroll: number
  /** The dialog was open; the search page never is. */
  open: boolean
}

export const SEARCH_HISTORY_KEY = 'libtmuxSearch'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value >= -1 ? Math.floor(value) : fallback)

/** The snapshot in a `history.state` value, if it holds a usable one. */
export function readSnapshot(historyState: unknown): SearchSnapshot | null {
  if (!isRecord(historyState)) return null
  const raw = historyState[SEARCH_HISTORY_KEY]
  if (!isRecord(raw) || typeof raw.q !== 'string' || !isScope(typeof raw.scope === 'string' ? raw.scope : null)) return null
  return {
    q: raw.q,
    scope: raw.scope as SearchScope,
    section: typeof raw.section === 'string' && raw.section ? raw.section : undefined,
    kind: typeof raw.kind === 'string' && raw.kind ? raw.kind : undefined,
    ports: Array.isArray(raw.ports) ? raw.ports.filter((p): p is string => typeof p === 'string') : [],
    shown: Math.max(0, whole(raw.shown, 0)),
    selected: whole(raw.selected, -1),
    scroll: Math.max(0, whole(raw.scroll, 0)),
    open: raw.open === true,
  }
}

/**
 * A `history.state` value that carries the snapshot beside whatever the page
 * router keeps there. The router's own entries are never replaced, only added to.
 */
export function withSnapshot(historyState: unknown, snapshot: SearchSnapshot): Record<string, unknown> {
  return { ...(isRecord(historyState) ? historyState : {}), [SEARCH_HISTORY_KEY]: snapshot }
}

/**
 * Whether a restored snapshot has more to show than the first page of results.
 * Back returns to the view the reader left, including the extra pages they opened.
 */
export const needsMoreResults = (snapshot: Pick<SearchSnapshot, 'shown'>, pageSize: number) => snapshot.shown > pageSize
