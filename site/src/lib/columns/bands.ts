/**
 * Which layout a stage of a given width gets.
 *
 * The bands are set by how many columns fit (a list column is 240 to 320 px,
 * a preview or page 480 to 720 px), not by device. The plan says which
 * columns show, which fold into spines and which leave for the trail.
 */
import type { Variant } from './types'

export type Mode = 'stack' | 'pair' | 'two' | 'strip' | 'full' | 'ultra'

export interface ModeInfo { mode: Mode; max: number; name: string; range: string }

export const MODES: readonly ModeInfo[] = [
  { mode: 'stack', max: 600, name: 'Phone portrait', range: 'below 600 px' },
  { mode: 'pair', max: 840, name: 'Phone landscape or narrow window', range: '600 to 840 px' },
  { mode: 'two', max: 1024, name: 'Tablet portrait', range: '840 to 1024 px' },
  { mode: 'strip', max: 1440, name: 'Tablet landscape or small laptop', range: '1024 to 1440 px' },
  { mode: 'full', max: 2001, name: 'Desktop', range: '1440 to 2000 px' },
  { mode: 'ultra', max: Infinity, name: 'Ultra-wide', range: 'above 2000 px' },
]

export const MAX_VISIBLE = 6
export const SPINE_W = 36
export const MEASURE = 680
export const INSPECTOR_W = 300

/** Columns the resizable bands let a reader drag. */
export const COLUMN_MIN = 200
export const COLUMN_MAX = 480
export const PANE_MIN = 480
export const PANE_MAX = 960

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function modeFor(width: number): ModeInfo {
  return MODES.find((entry) => width < entry.max) ?? MODES[MODES.length - 1]!
}

export interface PlanInput {
  width: number
  variant: Variant
  /** The path from the root to the selection, root included. */
  depth: number
  /** The selection is a leaf. */
  leaf: boolean
  /** Variant C: the page pane is open. */
  pane: boolean
  /** Widths a reader dragged, by column index; the page's own under `paneWidth`. */
  widths?: Readonly<Record<number, number>>
  paneWidth?: number
}

export interface LayoutPlan {
  width: number
  info: ModeInfo
  /** The levels that are lists: the path, less the leaf. */
  lists: number
  /** A leaf selection turns the rightmost column into a preview (B, D, G). */
  preview: boolean
  /** The page pane beside the columns (C). */
  pane: boolean
  /** Columns left of the visible ones, in the trail only. */
  hidden: number
  /** Columns folded into spine tabs. */
  spines: number
  /** How many columns the six-column cap folded. */
  capped: number
  colW: number
  previewW: number
  paneW: number
  /** The trail is needed because a level is out of view. */
  crumbs: boolean
  resizable: boolean
  inspector: boolean
  center: boolean
  stack: boolean
  single: boolean
  tree: boolean
  treeW: number
}

export function planLayout(input: PlanInput): LayoutPlan {
  const { width: W, variant: v, depth, leaf } = input
  const info = modeFor(W)
  const lists = leaf ? depth - 1 : depth
  const P = (v === 'b' || v === 'd' || v === 'g') && leaf
  const C = v === 'c' && input.pane
  const p: LayoutPlan = {
    width: W, info, lists, preview: P, pane: C, hidden: 0, spines: 0, capped: 0, colW: 280, previewW: 0, paneW: 0,
    crumbs: false, resizable: false, inspector: false, center: false, stack: false, single: false, tree: false, treeW: 0,
  }
  if (info.mode === 'stack') { p.stack = true; return p }
  if (v === 'f') { p.single = true; p.colW = W < 840 ? 280 : 320; return p }
  if (v === 'e') { p.tree = true; p.treeW = W < 840 ? Math.round(W * 0.45) : 340; return p }
  if (v === 'd') {
    p.spines = lists - 1
    p.colW = 320
    if (P && W < 840) { p.spines = lists; p.previewW = W - lists * SPINE_W } else if (P) p.previewW = Math.min(720, W - p.spines * SPINE_W - p.colW)
    return p
  }
  let avail: number
  if (info.mode === 'pair') {
    p.crumbs = true
    if (C) { p.hidden = lists - 1; p.colW = 300; p.paneW = W - p.colW }
    else if (P) { p.hidden = Math.max(0, lists - 2); p.spines = Math.min(1, lists - 1); p.colW = 280; p.previewW = W - p.spines * SPINE_W - p.colW }
    else { p.hidden = Math.max(0, lists - 2); p.colW = Math.floor(W / Math.min(2, lists)) }
    return p
  }
  if (info.mode === 'two') {
    if (C) { p.hidden = lists - 1; p.colW = 320; p.paneW = W - p.colW } else { p.colW = Math.floor(W / 2); if (P) p.previewW = p.colW }
  } else if (info.mode === 'strip') {
    if (C) {
      p.paneW = clamp(Math.round(W * 0.42), 480, 600)
      avail = W - p.paneW
      p.colW = Math.floor(avail / clamp(Math.floor(avail / 240), 2, 3))
    } else {
      if (P) p.previewW = clamp(Math.round(W * 0.4), 480, 720)
      avail = W - p.previewW
      p.colW = Math.floor(avail / (avail / 4 >= 240 ? 4 : 3))
    }
  } else {
    p.resizable = true
    p.colW = 260
    p.center = info.mode === 'ultra'
    if (C) { p.paneW = input.paneWidth || (p.center ? MEASURE : 640); p.inspector = p.center }
  }
  // The cap: at most six columns in view, the preview counted; the leftmost fold into spines at every width.
  const shown = lists - p.hidden + (P ? 1 : 0)
  if (shown > MAX_VISIBLE) { p.capped = shown - MAX_VISIBLE; p.spines = Math.max(p.spines, p.capped) }
  // Desktop and ultra-wide columns start at whatever fits beside the preview or page (220 to 280 px) until resized.
  if (p.resizable) {
    p.colW = clamp(Math.floor((W - p.spines * SPINE_W - (P ? 480 : 0) - p.paneW - (p.inspector ? INSPECTOR_W : 0)) / Math.max(1, lists - p.spines)), 220, 280)
  }
  let cols = 0
  for (let k = p.hidden + p.spines; k < lists; k++) cols += p.resizable ? input.widths?.[k] || p.colW : p.colW
  if (p.resizable && P) p.previewW = clamp(W - p.spines * SPINE_W - cols, 480, p.center ? 960 : 720)
  // Whatever does not fit scrolls sideways, and the trail appears so no level is out of reach.
  p.crumbs = p.hidden > 0 || p.spines * SPINE_W + cols + p.previewW + p.paneW + (p.inspector ? INSPECTOR_W : 0) > W
  return p
}

/** The status line under the stage: the band and what the layout is doing. */
export function describePlan(p: LayoutPlan, variant: Variant): string {
  let s: string
  const C = variant === 'c'
  const P = variant === 'b' || variant === 'd' || variant === 'g'
  if (p.stack) s = variant === 'e' ? 'the tree takes the full width; the detail is a pushed screen.'
    : `a drill-down stack, one level per screen; Back and the trail recover the path.${P ? ' A leaf\'s preview is a pushed screen.' : C ? ' The page is a pushed screen; Back closes it.' : ''}`
  else if (p.tree) s = 'a tree beside the detail: siblings at every open depth at once.'
  else if (p.single) s = 'one column keeps the current level; Up climbs a level and Back returns to the previous position, with the page beside it.'
  else if (variant === 'd') s = 'one list; each ancestor is a spine tab that jumps back to its level.'
  else if (p.info.mode === 'pair') s = p.pane ? 'the current list and the page side by side; the other levels collapse to the trail.' : p.preview && p.spines ? 'the parent folds to a spine so the preview fits beside the current list.' : 'two columns, the parent and the current level; earlier levels are in the trail.'
  else if (p.info.mode === 'two') s = p.pane ? 'the trail, the current list and the page.' : 'two full columns; the strip scrolls sideways for deeper levels, with the trail above.'
  else if (p.info.mode === 'strip') s = C ? 'columns beside the page; close the page to give the columns the width.' : 'three to four columns; the strip scrolls and snaps to column edges.'
  else if (p.info.mode === 'full') s = `the full strip; drag a column edge, or focus it and use the arrow keys, to resize.${C ? ' The page resizes the same way.' : ''}`
  else s = `the strip is centred and stops adding columns; ${C ? 'the page stops at a readable measure and the spare width holds an inspector.' : 'the preview widens instead.'}`
  const extra = p.capped ? ` ${p.capped} leftmost ${p.capped === 1 ? 'level folds' : 'levels fold'} into the spine: six columns in view at most.` : ''
  return `${p.info.name} (${p.info.range}, stage ${p.width} px): ${s}${extra}`
}
