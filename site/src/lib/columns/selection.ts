/**
 * Selection in a hierarchy: the path, what a change discards, and the single
 * column's position and history (variant F).
 */
import type { ColumnNode, ColumnSource } from './types'

/** The nodes from the root to `node`, or [] when `node` is outside the scope. */
export function pathTo(source: ColumnSource, node: ColumnNode | undefined): ColumnNode[] {
  const out: ColumnNode[] = []
  for (let at = node; at; at = at.parent ? source.find(at.parent) : undefined) {
    out.unshift(at)
    if (at.id === source.root) return out
    if (out.length > 64) break
  }
  return []
}

/** A node inside the root's subtree, or undefined: only ids the source produces resolve. */
export function inScope(source: ColumnSource, id: string | null | undefined): ColumnNode | undefined {
  const node = id ? source.find(id) : undefined
  return node && pathTo(source, node).length ? node : undefined
}

/** How many levels are lists for a selection: the path, less a leaf. */
export function listCount(path: readonly ColumnNode[]): number {
  const last = path[path.length - 1]
  return last?.leaf ? path.length - 1 : path.length
}

/**
 * The columns a selection discards. A click in column `k` keeps the lists up to
 * and including the new selection's own and drops every column at or beyond
 * `newLists`; the preview, which has no index, always goes.
 */
export function discardedColumns(visible: readonly (number | null)[], newLists: number): (number | null)[] {
  return visible.filter((col) => col === null || col >= newLists)
}

/** The node whose children variant F lists for a selection. */
export function listFor(source: ColumnSource, node: ColumnNode): string {
  return node.id === source.root ? source.root : node.leaf ? node.parent ?? source.root : node.id
}

export const HISTORY_LIMIT = 50

export interface Position { at: string; list: string }
export interface SingleState extends Position { hist: Position[] }

/**
 * Move variant F's selection. A change of position records where it was, so
 * Back can undo it; selecting what is already selected records nothing.
 */
export function singleSelect(state: SingleState, id: string, list: string): SingleState {
  const moved = state.at !== id || state.list !== list
  return { at: id, list, hist: moved ? [...state.hist, { at: state.at, list: state.list }].slice(-HISTORY_LIMIT) : state.hist }
}

/** Up: the level just left stays highlighted in the parent's list; nothing above the root. */
export function singleUp(source: ColumnSource, state: SingleState): SingleState | null {
  if (state.list === source.root) return null
  const list = source.find(state.list)
  if (!list?.parent) return null
  return singleSelect(state, list.id, list.parent)
}

/** Into an item with children: the column becomes that item's list. */
export function singleInto(source: ColumnSource, state: SingleState, id: string): SingleState | null {
  const node = source.find(id)
  if (!node || node.leaf) return null
  return singleSelect(state, node.id, node.id)
}

/** Back returns to the previous position whichever way it was reached, without recording a move. */
export function singleBack(state: SingleState, valid: (id: string) => boolean): SingleState | null {
  for (let i = state.hist.length - 1; i >= 0; i--) {
    const entry = state.hist[i]!
    if (valid(entry.at) && valid(entry.list)) return { at: entry.at, list: entry.list, hist: state.hist.slice(0, i) }
  }
  return null
}

/** The node Back names ("Back to Capturing output"), or undefined when there is nowhere to return. */
export function backTarget(source: ColumnSource, state: SingleState): ColumnNode | undefined {
  const entry = state.hist[state.hist.length - 1]
  if (!entry) return undefined
  return source.find(entry.at !== state.at ? entry.at : entry.list)
}
