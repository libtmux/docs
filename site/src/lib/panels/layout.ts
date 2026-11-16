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

/** Put `id` beside `target`. A split in the same direction gains a sibling instead of nesting. */
export function insertBeside(tree: Node, target: string, id: string, zone: 'left' | 'right' | 'top' | 'bottom' = 'right'): Node {
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
