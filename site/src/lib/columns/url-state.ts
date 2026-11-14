/**
 * The state the address carries: `?view=columns`, `?variant=f`, `?at=sym:...`,
 * the stage width, and the column tools (`?search=open`, `?paginate=1`,
 * `?pagesize=25`, `?virtual=0`, `?filter=bottom`).
 *
 * Settings are written only when they differ from the defaults, other query
 * parameters (`?theme`) are kept, and anything unreadable is ignored.
 */
import { PAGE_SIZES, VARIANT_IDS, type ColumnSearch, type ColumnsConfig, type FilterAt, type Variant } from './types'

export type View = 'tree' | 'columns'

export interface UrlState {
  view?: View
  variant?: Variant
  at?: string
  width?: string
  columns: Partial<ColumnsConfig>
}

export const STAGE_WIDTHS = ['fit', '375', '720', '900', '1280', '1680', '2400'] as const

export function parseUrlState(query: string | URLSearchParams, allowed: readonly Variant[] = VARIANT_IDS): UrlState {
  const q = typeof query === 'string' ? new URLSearchParams(query) : query
  const state: UrlState = { columns: {} }
  const view = q.get('view')
  if (view === 'tree' || view === 'columns') state.view = view
  const variant = q.get('variant')
  if (variant && (allowed as readonly string[]).includes(variant)) state.variant = variant as Variant
  const at = q.get('at')
  if (at) state.at = at
  const width = q.get('width')
  if (width && (STAGE_WIDTHS as readonly string[]).includes(width)) state.width = width
  const search = q.get('search')
  if (search === 'off' || search === 'button' || search === 'open') state.columns.search = search as ColumnSearch
  const paginate = q.get('paginate')
  if (paginate === '0' || paginate === '1') state.columns.paginate = paginate === '1'
  const size = Number(q.get('pagesize'))
  if ((PAGE_SIZES as readonly number[]).includes(size)) state.columns.pageSize = size
  const virtual = q.get('virtual')
  if (virtual === '0' || virtual === '1') state.columns.virtual = virtual === '1'
  const filter = q.get('filter')
  if (filter === 'top' || filter === 'bottom') state.columns.filterAt = filter as FilterAt
  return state
}

export interface UrlDefaults {
  view?: View
  variant?: Variant
  at?: string
  width?: string
  columns: ColumnsConfig
}

/** The query string (with its `?`, or empty) after writing `state` over `current`. */
export function serializeUrlState(current: string | URLSearchParams, state: Omit<UrlState, 'columns'> & { columns?: ColumnsConfig }, defaults: UrlDefaults): string {
  const q = new URLSearchParams(typeof current === 'string' ? current : current.toString())
  const write = (key: string, value: string | undefined, fallback: string | undefined) => {
    if (value === undefined || value === fallback) q.delete(key)
    else q.set(key, value)
  }
  write('view', state.view, defaults.view)
  write('variant', state.variant, defaults.variant)
  write('at', state.at, defaults.at)
  write('width', state.width, defaults.width)
  const c = state.columns
  const d = defaults.columns
  write('search', c?.search, d.search)
  write('paginate', c ? (c.paginate === d.paginate ? undefined : c.paginate ? '1' : '0') : undefined, undefined)
  write('pagesize', c ? (c.pageSize === d.pageSize ? undefined : String(c.pageSize)) : undefined, undefined)
  write('virtual', c ? (c.virtual === d.virtual ? undefined : c.virtual ? '1' : '0') : undefined, undefined)
  write('filter', c?.filterAt, d.filterAt)
  const out = q.toString()
  return out ? `?${out}` : ''
}
