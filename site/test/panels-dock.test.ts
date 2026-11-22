import { describe, expect, it } from 'vitest'
import { insertBeside, leaf, leaves, moveLeaf, nudgeLeaf, pairPercent, prune, resizePair, split, swapLeaves, type Arrow, type Node, type ViewSplit } from '../src/lib/panels/layout'
import { dropRect, dropZone } from '../src/components/api/panels/panel-dock'
import { closePanel, fromTemplate, reopenPanel, violations, type Workspace } from '../src/lib/panels/state'
import { panelStore } from '../src/lib/panels/persist'

const row = (...ids: string[]) => split('row', ids.map((id): [Node, number] => [leaf(id), 1]))
const shape = (n: Node): unknown => ('p' in n ? n.p : { [n.dir]: n.kids.map(shape) })
/** The share of the whole layout each panel fills, walking the tree the way the stage divides it. */
const areas = (n: Node, share = 1, out: Record<string, number> = {}): Record<string, number> => {
  if ('p' in n) { out[n.p] = share; return out }
  const total = n.sizes.reduce((x, y) => x + y, 0)
  n.kids.forEach((k, i) => areas(k, share * n.sizes[i]! / total, out))
  return out
}

describe('moving a panel', () => {
  it('docks beside another panel, keeps every panel once, and leaves its input alone', () => {
    const tree = row('a', 'b', 'c')
    const moved = moveLeaf(tree, 'c', 'a', 'left')
    expect(shape(moved)).toEqual({ row: ['c', 'a', 'b'] })
    expect(shape(tree)).toEqual({ row: ['a', 'b', 'c'] })
    expect(shape(moveLeaf(tree, 'a', 'c', 'bottom'))).toEqual({ row: ['b', { col: ['c', 'a'] }] })
  })

  /** The share of the whole layout each panel fills, by walking the tree the way the stage divides it. */
  const areas = (n: Node, share = 1, out: Record<string, number> = {}): Record<string, number> => {
    if ('p' in n) { out[n.p] = share; return out }
    const total = n.sizes.reduce((a, b) => a + b, 0)
    n.kids.forEach((k, i) => areas(k, share * n.sizes[i]! / total, out))
    return out
  }

  it('splits the target\'s cell evenly on a drop on any of its four sides, whatever share the dropped panel held', () => {
    // b held a quarter of the row. Without it main and a share the row two to one, and main's cell is then b's and main's.
    const tree = split('row', [[leaf('main'), 2], [leaf('a'), 1], [leaf('b'), 1]])
    for (const zone of ['left', 'right', 'top', 'bottom'] as const) {
      const after = areas(moveLeaf(tree, 'b', 'main', zone))
      expect(after.b, zone).toBeCloseTo(1 / 3)
      expect(after.main, zone).toBeCloseTo(1 / 3)
      expect(after.a, zone).toBeCloseTo(1 / 3)
    }
  })

  it('splits the target\'s cell in half inside a column too, and leaves the other panels in their proportion', () => {
    // a leaves the row, so the column fills the layout and c holds three quarters of it; a and c then take a half of that each.
    const tree = split('row', [[leaf('a'), 3], [split('col', [[leaf('b'), 1], [leaf('c'), 3]]), 1]])
    for (const zone of ['left', 'right', 'top', 'bottom'] as const) {
      const after = areas(moveLeaf(tree, 'a', 'c', zone))
      expect(after.a, zone).toBeCloseTo(0.375)
      expect(after.c, zone).toBeCloseTo(0.375)
      expect(after.b, zone).toBeCloseTo(0.25)
    }
  })

  it('does nothing for a move onto itself or onto a panel that is not there', () => {
    const tree = row('a', 'b')
    expect(moveLeaf(tree, 'a', 'a', 'left')).toBe(tree)
    expect(moveLeaf(tree, 'a', 'zzz', 'left')).toBe(tree)
    expect(swapLeaves(tree, 'a', 'a')).toBe(tree)
  })

  it('swaps two panels, each keeping the size of the cell it moves to', () => {
    const tree = split('row', [[leaf('a'), 3], [leaf('b'), 1]])
    const swapped = swapLeaves(tree, 'a', 'b') as ReturnType<typeof split>
    expect(shape(swapped)).toEqual({ row: ['b', 'a'] })
    expect(swapped.sizes).toEqual([3, 1])
  })
})

describe('moving a panel with Alt and an arrow key', () => {
  const step = (tree: Node, id: string, arrow: Arrow) => shape(nudgeLeaf(tree, id, arrow))

  it('swaps with the neighbour along the arrow and carries its own size', () => {
    const tree = split('row', [[leaf('a'), 1], [leaf('b'), 2], [leaf('c'), 3]])
    const next = nudgeLeaf(tree, 'b', 'right') as ReturnType<typeof split>
    expect(shape(next)).toEqual({ row: ['a', 'c', 'b'] })
    expect(next.sizes).toEqual([1, 3, 2])
  })

  it('takes a panel out of the column it sits in before moving it along the row', () => {
    const tree = split('row', [[leaf('a'), 1], [split('col', [[leaf('b'), 1], [leaf('c'), 1]]), 1]])
    expect(step(tree, 'c', 'left')).toEqual({ row: ['a', 'c', 'b'] })
    expect(step(tree, 'c', 'right')).toEqual({ row: ['a', 'b', 'c'] })
  })

  it('stacks a panel onto its neighbour when no split runs along the arrow', () => {
    expect(step(row('a', 'b', 'c'), 'c', 'up')).toEqual({ row: ['a', { col: ['c', 'b'] }] })
    expect(step(row('a', 'b'), 'a', 'down')).toEqual({ col: ['b', 'a'] })
  })

  it('stops at an edge and hands back the tree it was given', () => {
    const tree = row('a', 'b')
    expect(nudgeLeaf(tree, 'a', 'left')).toBe(tree)
    expect(nudgeLeaf(tree, 'b', 'right')).toBe(tree)
    expect(nudgeLeaf(leaf('only'), 'only', 'left')).toEqual(leaf('only'))
  })

  it('never loses or repeats a panel over any run of moves', () => {
    const arrows: Arrow[] = ['left', 'right', 'up', 'down']
    let tree: Node = split('row', [[leaf('a'), 1], [split('col', [[leaf('b'), 1], [leaf('c'), 1]]), 1], [leaf('d'), 1]])
    let seed = 7
    for (let i = 0; i < 400; i++) {
      seed = (seed * 48271) % 2147483647
      tree = nudgeLeaf(tree, ['a', 'b', 'c', 'd'][seed % 4]!, arrows[(seed >> 3) % 4]!)
      expect([...leaves(tree)].sort(), `after move ${i}`).toEqual(['a', 'b', 'c', 'd'])
    }
  })
})

describe('dropping on a panel', () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 }

  it('docks to the nearest edge inside the edge band and swaps in the middle', () => {
    expect(dropZone(rect, 110, 200)).toBe('left')
    expect(dropZone(rect, 490, 200)).toBe('right')
    expect(dropZone(rect, 300, 55)).toBe('top')
    expect(dropZone(rect, 300, 345)).toBe('bottom')
    expect(dropZone(rect, 300, 200)).toBe('swap')
  })

  it('outlines the half a dock would fill, and the whole panel for a swap', () => {
    expect(dropRect(rect, 'left')).toEqual({ left: 100, top: 50, width: 200, height: 300 })
    expect(dropRect(rect, 'bottom')).toEqual({ left: 100, top: 200, width: 400, height: 150 })
    expect(dropRect(rect, 'swap')).toEqual(rect)
  })
})

describe('resizing with a splitter', () => {
  const view = () => prune(split('row', [[leaf('a'), 1], [leaf('b'), 1], [leaf('c'), 2]]), ['a', 'b', 'c']) as ViewSplit

  it('moves one boundary, writes the sizes back to the tree, and reports the share as a percent', () => {
    const n = view()
    const r = resizePair(n, 1, 0.3, 1000, 100)
    expect(r).toBe(0.3)
    expect(n.src.sizes[0]).toBe(1)
    expect(n.src.sizes[1]).toBeCloseTo(0.9)
    expect(n.src.sizes[2]).toBeCloseTo(2.1)
    expect(pairPercent(n.src.sizes, 1)).toBe(30)
  })

  it('stops a panel short of the minimum and snaps a pair of two to 50 percent', () => {
    expect(resizePair(view(), 0, 0.01, 1000, 320)).toBeCloseTo(0.32)
    const two = prune(row('a', 'b'), ['a', 'b']) as ViewSplit
    expect(resizePair(two, 0, 0.52, 1000, 100)).toBe(0.5)
  })
})

describe('closing and reopening a panel', () => {
  const known = () => true

  it('keeps a closed panel with its tabs and brings it back beside the active one', () => {
    const ws = fromTemplate('read')
    ws.panels.p4!.locked = true
    expect(closePanel(ws, 'p4')).toBe(true)
    expect(ws.closed.map((p) => p.id)).toEqual(['p4'])
    expect(reopenPanel(ws, 'p4')).toBe('p4')
    expect(ws.closed).toEqual([])
    expect(ws.panels.p4!.locked).toBe(true)
    expect(leaves(ws.layoutTree)).toEqual(['p1', 'p4'])
    expect(violations(ws, known)).toEqual([])
  })

  it('gives a reopened panel a fresh id when a new panel took its own', () => {
    const ws = fromTemplate('read')
    closePanel(ws, 'p4')
    ws.panels.p4 = { ...ws.panels.p1!, id: 'p4' }
    ws.layoutTree = insertBeside(ws.layoutTree, 'p1', 'p4', 'right')
    const id = reopenPanel(ws, 'p4')
    expect(id).not.toBe('p4')
    expect(ws.panels[id!]!.id).toBe(id)
    expect(violations(ws, known)).toEqual([])
  })

  it('keeps the closed list bounded, and reopens nothing it does not hold', () => {
    const ws: Workspace = fromTemplate('compare')
    expect(reopenPanel(ws, 'p1')).toBeNull()
    for (let i = 0; i < 30; i++) { const extra = `x${i}`; ws.panels[extra] = { ...ws.panels.p1!, id: extra }; ws.layoutTree = insertBeside(ws.layoutTree, 'p1', extra, 'right'); closePanel(ws, extra) }
    expect(ws.closed.length).toBeLessThanOrEqual(12)
  })
})

describe('storage that fails', () => {
  const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }

  it('reads the fallback and reports a failed write instead of throwing', () => {
    const store = panelStore(throwing)
    expect(store.read('k', { v: 1 })).toEqual({ v: 1 })
    expect(store.write('k', { v: 2 })).toBe(false)
    expect(panelStore(undefined).write('k', 1)).toBe(false)
  })

  it('reads the fallback for text that is not JSON, and round-trips what it wrote', () => {
    const data = new Map<string, string>([['bad', '{nope']])
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    const store = panelStore(storage)
    expect(store.read('bad', 'fallback')).toBe('fallback')
    expect(store.write('good', { a: [1] })).toBe(true)
    expect(store.read('good', null)).toEqual({ a: [1] })
  })
})
