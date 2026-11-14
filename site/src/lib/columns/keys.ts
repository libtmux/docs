/**
 * The keyboard map, as intents. The mount turns an intent into a selection
 * change; nothing here touches the document.
 *
 * Columns: Up and Down move within a column and open the selection's children
 * beside it; Right or Enter opens the next level; Left returns to the parent;
 * Home and End jump; Enter in C opens the page and Escape closes it. On phones
 * Left or Backspace goes back. In the tree, Right expands, Left collapses and
 * Enter selects. In F, Up and Down move within the column, Right or Enter moves
 * into an item with children, Left goes up a level, and Backspace or Alt+Left
 * goes back. With column tools, Page Down and Page Up move a page of rows.
 */
import type { Move } from './list-window'
import type { Variant } from './types'

export type Surface = 'columns' | 'single' | 'tree' | 'stack'

export interface KeyInput { key: string; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }

export interface KeyContext {
  variant: Variant
  surface: Surface
  /** The page pane (C) is open. */
  pane: boolean
  /** The selected node has children. */
  hasChildren: boolean
  /** The selected node is a leaf. */
  leaf: boolean
  /** The selection has a parent column to return to (its parent is not the root, in columns). */
  hasParentColumn: boolean
  /** Column tools are on: filters and pages. */
  tools: boolean
}

export type Intent =
  | { kind: 'move'; move: Move }
  | { kind: 'parent' }
  | { kind: 'child' }
  | { kind: 'open-pane' }
  | { kind: 'close-pane' }
  | { kind: 'focus-page' }
  | { kind: 'back' }
  | { kind: 'up' }
  | { kind: 'history' }
  | { kind: 'into' }
  | { kind: 'expand' }
  | { kind: 'collapse' }
  | { kind: 'select' }
  | { kind: 'open' }

const MOVES: Record<string, Move> = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' }

export function intentFor(input: KeyInput, ctx: KeyContext): Intent | null {
  const { key } = input
  if (input.ctrlKey || input.metaKey) return null
  if (key === 'Escape') {
    if (ctx.variant === 'c' && ctx.pane && ctx.surface !== 'stack') return { kind: 'close-pane' }
    return ctx.surface === 'stack' ? { kind: 'back' } : null
  }
  if (ctx.surface === 'tree') {
    if (MOVES[key]) return { kind: 'move', move: MOVES[key]! }
    if (key === 'ArrowRight') return ctx.leaf ? null : { kind: 'expand' }
    if (key === 'ArrowLeft') return { kind: 'collapse' }
    if (key === 'Enter' || key === ' ') return { kind: 'select' }
    return null
  }
  if (ctx.surface === 'stack') {
    if (MOVES[key]) return { kind: 'move', move: MOVES[key]! }
    if (key === 'Enter' || key === 'ArrowRight') return { kind: 'open' }
    if (key === 'ArrowLeft' || key === 'Backspace') return { kind: 'back' }
    return null
  }
  if (ctx.surface === 'single') {
    if (MOVES[key]) return { kind: 'move', move: MOVES[key]! }
    if (ctx.tools && (key === 'PageDown' || key === 'PageUp')) return { kind: 'move', move: key === 'PageDown' ? 'page-next' : 'page-prev' }
    if ((key === 'ArrowLeft' && input.altKey) || key === 'Backspace') return { kind: 'history' }
    if (key === 'ArrowLeft') return { kind: 'up' }
    if (key === 'ArrowRight' || key === 'Enter') {
      if (!ctx.leaf && ctx.hasChildren) return { kind: 'into' }
      return key === 'Enter' ? { kind: 'focus-page' } : null
    }
    return null
  }
  if (ctx.tools && (key === 'PageDown' || key === 'PageUp')) return { kind: 'move', move: key === 'PageDown' ? 'page-next' : 'page-prev' }
  if (MOVES[key]) return { kind: 'move', move: MOVES[key]! }
  if (key === 'ArrowLeft') return ctx.hasParentColumn ? { kind: 'parent' } : null
  if (key === 'ArrowRight' || key === 'Enter') {
    if (key === 'Enter' && ctx.variant === 'c') return { kind: 'open-pane' }
    if (!ctx.leaf && ctx.hasChildren) return { kind: 'child' }
    return null
  }
  return null
}
