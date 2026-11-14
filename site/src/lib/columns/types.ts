/**
 * The vocabulary MillerColumns shares with the pages that mount it.
 *
 * A hierarchy is any tree of nodes a page can list level by level. The module
 * knows nothing about the API reference: a page supplies a `ColumnSource`, and
 * a renderer for the page a selection opens.
 */

export const VARIANT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const
export type Variant = typeof VARIANT_IDS[number]

export const VARIANTS: Record<Variant, { name: string; what: string }> = {
  a: { name: 'Columns', what: 'Every column is a list; selecting an item opens its children in the next column. A leaf only highlights.' },
  b: { name: 'Preview', what: 'A selected leaf turns the rightmost column into a wider, read-only preview; a non-leaf turns it back into a list.' },
  c: { name: 'Content pane', what: 'A page pane on the right follows the selection, or stays while pinned; closing it gives the columns the width.' },
  d: { name: 'Collapsed', what: 'Only the current level is a list; each ancestor is a spine tab, or a trail on phones.' },
  e: { name: 'Tree', what: 'An indented tree beside the detail. A tree shows siblings at every open depth; columns show one path.' },
  f: { name: 'Single column', what: 'One column keeps the current position. Up climbs a level, Back returns to where you were, and the page sits beside it.' },
  g: { name: 'Searchable', what: 'Columns and a preview where each column carries its own filter, paginator and virtual list.' },
}

export interface ColumnNode {
  id: string
  label: string
  /** What the node is, for the page renderer and the status line: `group`, `type`, `method`. */
  kind: string
  parent?: string
  /** A leaf has no children and opens no column. */
  leaf: boolean
  /** A heading the node's row sits under in its parent's list. */
  group?: string
  count?: number
  href?: string
  summary?: string
  /** Anything else the page renderer needs. */
  data?: Record<string, unknown>
}

export interface ColumnSource {
  /** The id of the level the columns start from. */
  readonly root: string
  /** A node by id, or undefined for an id the hierarchy does not produce. */
  find(id: string): ColumnNode | undefined
  /** The node's children in display order; empty for a leaf. */
  children(node: ColumnNode): ColumnNode[]
}

export type ColumnSearch = 'off' | 'button' | 'open'
export type FilterAt = 'top' | 'bottom'
export const PAGE_SIZES = [10, 25, 50, 100] as const

/** What each column offers: a filter, a paginator, a virtual list. */
export interface ColumnsConfig {
  search: ColumnSearch
  paginate: boolean
  pageSize: number
  virtual: boolean
  filterAt: FilterAt
}

/** Variant G's defaults: the column variants a page upgrades with `columnTools` take their own. */
export const COLUMN_DEFAULTS: ColumnsConfig = { search: 'button', paginate: true, pageSize: 50, virtual: true, filterAt: 'top' }

/** A row height the virtual list assumes, in px. */
export const ROW_HEIGHT = 32
