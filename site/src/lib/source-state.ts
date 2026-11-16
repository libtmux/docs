/**
 * The state of the source views, as plain functions.
 *
 * Location lives in the URL, restoration in history state, and the DOM only
 * draws what these return (see "State: URL, history, storage" in the design
 * system). The page reads `#L112-L129` and `?from=`; the pane keeps a trail
 * of declarations and mirrors its top entry as `?source=<symbol-slug>`.
 */

export type LineRange = readonly [from: number, to: number]

/** `#L112` or `#L112-L129` as a range; undefined for any other fragment. */
export function parseLineFragment(hash: string): LineRange | undefined {
  const match = /^#?L(\d+)(?:-L?(\d+))?$/.exec(hash)
  if (!match) return undefined
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  return from >= 1 && to >= from ? [from, to] : undefined
}

/** A range as the words of the bar: "Lines 112–129" or "Line 112". */
export const rangeLabel = ([from, to]: LineRange) => from === to ? `Line ${from}` : `Lines ${from}–${to}`

/** The slug a reader came from, from a query string. */
export const fromParam = (search: string): string | undefined => new URLSearchParams(search).get('from') || undefined

/** The declaration a pane shows, by the slug of its reference page. */
export interface PaneEntry {
  slug: string
  title: string
  kind: string
  file: string
  line: number
  from: number
  to: number
}

export interface PaneState {
  /** Declarations opened in the pane, oldest first; the last is shown. */
  trail: readonly PaneEntry[]
}

export const PANE_CLOSED: PaneState = { trail: [] }

export const paneOpen = (state: PaneState) => state.trail.length > 0
export const paneTop = (state: PaneState): PaneEntry | undefined => state.trail.at(-1)

/** Show a declaration: a new entry on the trail, or a no-op when it is already on top. */
export function pushEntry(state: PaneState, entry: PaneEntry): PaneState {
  return paneTop(state)?.slug === entry.slug ? state : { trail: [...state.trail, entry] }
}

/** Walk the trail back one step; the last entry stays, since closing is its own action. */
export function backEntry(state: PaneState): PaneState {
  return state.trail.length > 1 ? { trail: state.trail.slice(0, -1) } : state
}

/** "Capture → CapturePaneRequest", the footer's trail. */
export const trailLabel = (state: PaneState, name: (entry: PaneEntry) => string = (entry) => entry.title): string =>
  state.trail.map(name).join(' → ')

/** The `?source=` of a search string, or undefined. */
export const sourceParam = (search: string): string | undefined => new URLSearchParams(search).get('source') || undefined

/** A URL with `source` set or removed and everything else kept, as a path, query and fragment. */
export function withSourceParam(href: string, slug: string | undefined): string {
  const url = new URL(href, 'https://pane.invalid')
  if (slug) url.searchParams.set('source', slug)
  else url.searchParams.delete('source')
  return `${url.pathname}${url.search}${url.hash}`
}

/** The slice of `History` the pane writes through, so tests can supply their own. */
export interface PaneHistory {
  state: unknown
  pushState(state: unknown, unused: string, url: string): void
  replaceState(state: unknown, unused: string, url: string): void
}

/** History state is namespaced, so the pane never overwrites another widget's. */
export const PANE_STATE_KEY = 'libtmuxSourcePane'

const merged = (state: unknown, value: unknown) => ({ ...(state && typeof state === 'object' ? state : {}), [PANE_STATE_KEY]: value })

const recordedIn = (state: unknown): { slug?: unknown; pushed?: unknown } | undefined => {
  const recorded = state && typeof state === 'object' ? (state as Record<string, unknown>)[PANE_STATE_KEY] : undefined
  return recorded && typeof recorded === 'object' ? recorded : undefined
}

/**
 * Opening pushes an entry, so the browser's Back closes the pane; a later
 * declaration opened inside the pane replaces that entry, because the pane's
 * own trail is the way back through them.
 */
export function recordOpen(history: PaneHistory, href: string, slug: string, wasOpen: boolean): void {
  const url = withSourceParam(href, slug)
  if (!wasOpen) history.pushState(merged(history.state, { slug, pushed: true }), '', url)
  else history.replaceState(merged(history.state, { slug, pushed: recordedIn(history.state)?.pushed === true }), '', url)
}

/**
 * How a Close button or Escape ends the pane. An entry this page pushed is
 * stepped back over, so the history holds no dead entry; one that arrived with
 * the URL (a reload or a shared link) has nothing before it to step back to.
 */
export const closeAction = (state: unknown): 'back' | 'replace' => recordedIn(state)?.pushed === true ? 'back' : 'replace'

/** Clear the pane from the URL in place. */
export function recordClose(history: PaneHistory, href: string): void {
  history.replaceState(merged(history.state, null), '', withSourceParam(href, undefined))
}

/**
 * The slug to show for a URL the reader arrived at: the `?source=` of a reload
 * or a shared link, or the one a history entry recorded.
 */
export function restoreSlug(search: string, state: unknown): string | undefined {
  const slug = recordedIn(state)?.slug
  return sourceParam(search) ?? (typeof slug === 'string' ? slug : undefined)
}

/** Whether the pane is a right column or an overlay, from the viewport width in rem. */
export const PANE_COLUMN_FROM_REM = 72
export const paneMode = (viewportRem: number): 'column' | 'overlay' => viewportRem >= PANE_COLUMN_FROM_REM ? 'column' : 'overlay'
