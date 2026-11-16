import { describe, expect, it } from 'vitest'
import { BAND, MIN_COL, TIERS, columnCap, effectiveTier, railWidth, tierOf } from '../src/lib/panels/tiers'
import { insertBeside, leaf, leaves, limitDepth, prune, removeLeaf, snapRatio, split } from '../src/lib/panels/layout'

describe('workspace tiers', () => {
  it('picks the tier at each documented boundary', () => {
    const at = (w: number) => tierOf(w).t
    expect([479, 480, 767, 768, 1023, 1024, 1439, 1440, 2099, 2100].map(at)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5])
  })

  it('holds the previous tier inside a 24 px dead band, in both directions', () => {
    const t2 = TIERS[2]!
    const t3 = TIERS[3]!
    // Widening from T2: T3 starts at 1024 but is taken only from 1036.
    expect(tierOf(1030, t2).t).toBe(2)
    expect(tierOf(1036, t2).t).toBe(3)
    // Narrowing from T3: T2 is taken only below 1012.
    expect(tierOf(1020, t3).t).toBe(3)
    expect(tierOf(1011, t3).t).toBe(2)
    expect(BAND).toBe(24)
  })

  it('does not flip when a window is dragged back and forth along a boundary', () => {
    let tier = tierOf(1000)
    const seen = new Set<number>()
    for (const w of [1018, 1026, 1022, 1030, 1020, 1028, 1016]) { tier = tierOf(w, tier); seen.add(tier.t) }
    expect(seen.size).toBe(1)
    // A jump of two tiers is never held.
    expect(tierOf(1500, TIERS[2]).t).toBe(4)
  })

  it('renders a short stage under 1024 px as T1 whatever its width', () => {
    expect(effectiveTier(844, 390).t).toBe(1)
    expect(effectiveTier(1194, 834).t).toBe(3)
    expect(effectiveTier(844, 800).t).toBe(2)
  })

  it('never shows a column narrower than 320 px, and keeps the rail an icon strip at T2', () => {
    expect(MIN_COL).toBe(320)
    expect(columnCap(TIERS[3]!, 1100, 240)).toBe(2)
    expect(columnCap(TIERS[3]!, 1100, 48)).toBe(3)
    expect(columnCap(TIERS[2]!, 400, 48)).toBe(1)
    expect(railWidth(TIERS[2]!, true)).toBe(48)
    expect(railWidth(TIERS[3]!, true)).toBe(240)
    expect(railWidth(TIERS[3]!, false)).toBe(48)
  })
})

describe('layout tree', () => {
  const tree = () => split('row', [[leaf('a'), 1], [split('col', [[leaf('b'), 1], [leaf('c'), 1]]), 1], [leaf('d'), 1]])

  it('prunes to the visible panels and collapses a split left with one child', () => {
    const view = prune(tree(), ['a', 'c'])!
    expect(leaves(view)).toEqual(['a', 'c'])
    expect('dir' in view && view.kids.map((k) => ('p' in k ? k.p : '?'))).toEqual(['a', 'c'])
  })

  it('limits nesting depth and keeps the active panel when a split collapses', () => {
    const view = prune(tree(), ['a', 'b', 'c', 'd'])!
    const shallow = limitDepth(view, 1, 'c')
    expect(leaves(shallow)).toEqual(['a', 'c', 'd'])
  })

  it('docks beside a panel as a sibling in the same direction and nests otherwise', () => {
    const t = insertBeside(tree(), 'a', 'x', 'right')
    expect(t).toMatchObject({ dir: 'row' })
    expect(leaves(t)).toEqual(['a', 'x', 'b', 'c', 'd'])
    expect(leaves(insertBeside(tree(), 'a', 'x', 'top'))).toEqual(['x', 'a', 'b', 'c', 'd'])
  })

  it('removes a leaf without losing the others', () => {
    expect(leaves(removeLeaf(tree(), 'b')!)).toEqual(['a', 'c', 'd'])
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('snaps a pair to 40, 50 and 60 percent and stops a panel short of 320 px', () => {
    expect(snapRatio(0.52, 1000, 320, true)).toBe(0.5)
    expect(snapRatio(0.58, 1000, 320, true)).toBe(0.6)
    expect(snapRatio(0.55, 1000, 320, false)).toBe(0.55)
    expect(snapRatio(0.1, 1000, 320, true)).toBeCloseTo(0.32)
    expect(snapRatio(0.9, 1000, 320, true)).toBeCloseTo(0.68)
  })
})
