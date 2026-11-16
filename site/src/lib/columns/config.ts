/**
 * The settings of the columns view and the call that reproduces them.
 *
 * `layout` and `columns` are the props a page passes: a new column per level
 * (MillerColumns C, the page in a pane) or one column with Up and Back (F),
 * and each level's filter, paginator and virtual list.
 */
import { COLUMN_DEFAULTS, PAGE_SIZES, type ColumnSearch, type ColumnsConfig, type FilterAt, type Variant } from './types'

export type Layout = 'columns' | 'single'

/** The API reference scrolls long levels by default; variant G pages them. */
export const API_COLUMN_DEFAULTS: ColumnsConfig = { ...COLUMN_DEFAULTS, paginate: false }

export const layoutVariant = (layout: Layout): Variant => layout === 'single' ? 'f' : 'c'
export const variantLayout = (variant: Variant): Layout => variant === 'f' ? 'single' : 'columns'

const SEARCH: readonly ColumnSearch[] = ['off', 'button', 'open']
const FILTER_AT: readonly FilterAt[] = ['top', 'bottom']

/** Keep the valid fields of `patch` over `base`; anything else is ignored, never thrown. */
export function mergeColumns(base: ColumnsConfig, patch: Partial<Record<keyof ColumnsConfig, unknown>> | undefined): ColumnsConfig {
  const out = { ...base }
  if (!patch) return out
  if (SEARCH.includes(patch.search as ColumnSearch)) out.search = patch.search as ColumnSearch
  if (typeof patch.paginate === 'boolean') out.paginate = patch.paginate
  if ((PAGE_SIZES as readonly number[]).includes(patch.pageSize as number)) out.pageSize = patch.pageSize as number
  if (typeof patch.virtual === 'boolean') out.virtual = patch.virtual
  if (FILTER_AT.includes(patch.filterAt as FilterAt)) out.filterAt = patch.filterAt as FilterAt
  return out
}

/** The mount call that reproduces `layout` and `columns`, as a page would write it. */
export function configCall(layout: Layout, columns: ColumnsConfig, fn = 'mountApiColumns'): string {
  return `${fn}(root, { layout: '${layout}', columns: { search: '${columns.search}', paginate: ${columns.paginate}, pageSize: ${columns.pageSize}, virtual: ${columns.virtual}, filterAt: '${columns.filterAt}' } })`
}

/** The `columns` object alone, for variant G's props row. */
export function columnsLiteral(columns: ColumnsConfig): string {
  return `columns: { search: '${columns.search}', paginate: ${columns.paginate}, pageSize: ${columns.pageSize}, virtual: ${columns.virtual}, filterAt: '${columns.filterAt}' }`
}
