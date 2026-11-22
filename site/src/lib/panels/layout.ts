/**
 * The layout tree: nested row and column splits whose leaves are panels.
 * The tree never changes on resize; a view of it is pruned to the panels that
 * fit, so widening restores the exact arrangement.
 */

export interface Leaf { p: string }
export interface Split { dir: 'row' | 'col'; kids: Node[]; sizes: number[] }
export type Node = Leaf | Split

export const leaf = (p: string): Leaf => ({ p })
export const split = (dir: 'row' | 'col', items: [Node, number][]): Split => ({ dir, kids: items.map((i) => i[0]), sizes: items.map((i) => i[1]) })
export const isLeaf = (n: Node): n is Leaf => 'p' in n

/** Panel ids in layout order. */
export function leaves(n: Node): string[] {
  return isLeaf(n) ? [n.p] : n.kids.flatMap(leaves)
}

/** A pruned copy of a split keeps the original and the indexes it came from, so a splitter can write sizes back. */
export type ViewNode = Leaf | { dir: 'row' | 'col'; kids: ViewNode[]; sizes: number[]; src: Split; idx: number[] }

/** The tree reduced to the visible panels; a split left with one child becomes that child. */
export function prune(n: Node, visible: readonly string[]): ViewNode | null {
  if (isLeaf(n)) return visible.includes(n.p) ? { p: n.p } : null
  const kids: ViewNode[] = []
  const sizes: number[] = []
  const idx: number[] = []
  n.kids.forEach((k, i) => {
    const v = prune(k, visible)
    if (v) { kids.push(v); sizes.push(n.sizes[i]!); idx.push(i) }
  })
  if (!kids.length) return null
  return kids.length === 1 ? kids[0]! : { dir: n.dir, kids, sizes, src: n, idx }
}

/** Splits nested deeper than `max` collapse to one panel: the active one if it is inside, else the first. */
export function limitDepth(n: ViewNode, max: number, active: string, depth = 0): ViewNode {
  if ('p' in n) return n
  if (depth >= max) {
    const inside = leaves(n)
    return { p: inside.includes(active) ? active : inside[0]! }
  }
  return { ...n, kids: n.kids.map((k) => limitDepth(k, max, active, depth + 1)) }
}

/** A side of a panel a dragged panel can dock to. */
export type Dock = 'left' | 'right' | 'top' | 'bottom'

/** Put `id` beside `target`. A split in the same direction gains a sibling instead of nesting. */
export function insertBeside(tree: Node, target: string, id: string, zone: Dock = 'right'): Node {
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  const first = zone === 'left' || zone === 'top'
  const walk = (n: Node): Node => {
    if (isLeaf(n)) {
      if (n.p !== target) return n
      return split(dir, first ? [[leaf(id), 0.5], [leaf(target), 0.5]] : [[leaf(target), 0.5], [leaf(id), 0.5]])
    }
    const i = n.kids.findIndex((k) => isLeaf(k) && k.p === target)
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i]! / 2
      n.kids.splice(first ? i : i + 1, 0, leaf(id))
      n.sizes.splice(i, 1, half, half)
      return n
    }
    n.kids = n.kids.map(walk)
    return n
  }
  return walk(tree)
}

/** Remove a panel; a split left with one child becomes it. Returns null when the tree is empty. */
export function removeLeaf(tree: Node, id: string): Node | null {
  const walk = (n: Node): Node | null => {
    if (isLeaf(n)) return n.p === id ? null : n
    const kids: Node[] = []
    const sizes: number[] = []
    n.kids.forEach((k, i) => { const v = walk(k); if (v) { kids.push(v); sizes.push(n.sizes[i]!) } })
    if (!kids.length) return null
    if (kids.length === 1) return kids[0]!
    n.kids = kids
    n.sizes = sizes
    return n
  }
  return walk(tree)
}

/** Grow factors as percentages: a pruned split's sizes may sum below one, which CSS would leave partly empty. */
export function grow(sizes: readonly number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1
  return sizes.map((s) => Number(((s / sum) * 100).toFixed(3)))
}

/** Splitters snap to 40, 50 and 60 percent for a pair, and stop a panel short of `min` px. */
export function snapRatio(ratio: number, pairPx: number, min: number, twoPanels: boolean): number {
  const lo = min / pairPx
  const hi = 1 - lo
  if (lo >= hi) return 0.5
  let r = ratio
  if (twoPanels) for (const s of [0.4, 0.5, 0.6]) if (Math.abs(r - s) < 0.03) r = s
  return Math.max(lo, Math.min(hi, r))
}

/**
 * Move `id` to a side of `target`, keeping every other panel. A move onto itself, or onto a missing panel,
 * changes nothing. The panel and its target split the target's cell evenly, wherever the panel came from, so
 * a drop on a half takes that half. The cell the panel left goes to its former neighbours.
 */
export function moveLeaf(tree: Node, id: string, target: string, zone: Dock): Node {
  if (id === target) return tree
  const rest = removeLeaf(structuredClone(tree), id)
  if (!rest || !leaves(rest).includes(target)) return tree
  return insertBeside(rest, target, id, zone)
}

/** Exchange two panels' places, each keeping the size of the cell it moves to. */
export function swapLeaves(tree: Node, a: string, b: string): Node {
  if (a === b) return tree
  const next = structuredClone(tree)
  const walk = (n: Node) => {
    if (isLeaf(n)) return
    n.kids = n.kids.map((k) => (isLeaf(k) && (k.p === a || k.p === b) ? leaf(k.p === a ? b : a) : k))
    n.kids.forEach(walk)
  }
  if (isLeaf(next)) return tree
  walk(next)
  return next
}

export type Arrow = 'left' | 'right' | 'up' | 'down'
const AXIS = { left: 'row', right: 'row', up: 'col', down: 'col' } as const
const STEP = { left: -1, right: 1, up: -1, down: 1 } as const

interface Hop { split: Split; i: number }
function hopsTo(n: Node, id: string, hops: Hop[] = []): Hop[] | null {
  if (isLeaf(n)) return n.p === id ? hops : null
  for (let i = 0; i < n.kids.length; i++) {
    const found = hopsTo(n.kids[i]!, id, [...hops, { split: n, i }])
    if (found) return found
  }
  return null
}

/**
 * Move a panel one step in the direction of an arrow key, with the same results a drag can reach.
 *
 * Along the arrow's axis a panel swaps with its neighbour, taking its own size. A panel nested in a region
 * first leaves it for the side the arrow names. A panel with no split on that axis stacks onto its neighbour.
 * At the edge nothing changes, and the tree comes back as it was.
 */
export function nudgeLeaf(tree: Node, id: string, arrow: Arrow): Node {
  const next = structuredClone(tree)
  const hops = hopsTo(next, id)
  if (!hops?.length) return tree
  const axis = AXIS[arrow]
  const step = STEP[arrow]
  for (let h = hops.length - 1; h >= 0; h--) {
    const { split: s, i } = hops[h]!
    if (s.dir !== axis) continue
    if (h < hops.length - 1) {
      const rest = removeLeaf(s.kids[i]!, id)!
      const size = s.sizes[i]!
      s.kids.splice(i, 1, ...(step < 0 ? [leaf(id), rest] : [rest, leaf(id)]))
      s.sizes.splice(i, 1, size / 2, size / 2)
      return next
    }
    const j = i + step
    if (j < 0 || j >= s.kids.length) continue
    ;[s.kids[i], s.kids[j]] = [s.kids[j]!, s.kids[i]!]
    ;[s.sizes[i], s.sizes[j]] = [s.sizes[j]!, s.sizes[i]!]
    return next
  }
  if (hops.some(({ split: s }) => s.dir === axis)) return tree
  const { split: s, i } = hops[hops.length - 1]!
  const beside = s.kids[i - 1] ?? s.kids[i + 1]
  const ids = beside ? leaves(beside) : []
  const target = i > 0 ? ids[ids.length - 1] : ids[0]
  return target ? moveLeaf(tree, id, target, step < 0 ? 'top' : 'bottom') : tree
}

/** The sizes of a visible split, which a splitter writes back to the tree it came from. */
export type ViewSplit = Extract<ViewNode, { src: unknown }>

/**
 * Move the boundary between cell `i` and `i + 1` to `ratio` of the pair, snapped and stopped at `min`.
 * The ratio applied comes back, as a fraction of the pair, so a caller can show it.
 */
export function resizePair(n: ViewSplit, i: number, ratio: number, pairPx: number, min: number): number {
  const r = snapRatio(ratio, pairPx, min, n.kids.length === 2)
  const sum = n.sizes[i]! + n.sizes[i + 1]!
  n.sizes[i] = sum * r
  n.sizes[i + 1] = sum * (1 - r)
  n.src.sizes[n.idx[i]!] = n.sizes[i]!
  n.src.sizes[n.idx[i + 1]!] = n.sizes[i + 1]!
  return r
}

/** The share of cell `i` in the pair `i`, `i + 1`, as a whole percent: what a splitter reports as `aria-valuenow`. */
export const pairPercent = (sizes: readonly number[], i: number): number => Math.round((sizes[i]! / (sizes[i]! + sizes[i + 1]!)) * 100)
