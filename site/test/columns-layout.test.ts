import { describe, expect, it } from 'vitest'
import { MAX_VISIBLE, SPINE_W, describePlan, modeFor, planLayout, type PlanInput } from '../src/lib/columns/bands'

const input = (over: Partial<PlanInput>): PlanInput => ({ width: 1280, variant: 'b', depth: 4, leaf: false, pane: true, ...over })

describe('stage width bands', () => {
  it('picks the band at each documented boundary', () => {
    const at = (w: number) => modeFor(w).mode
    expect([599, 600, 839, 840, 1023, 1024, 1439, 1440, 2000, 2001].map(at)).toEqual(
      ['stack', 'pair', 'pair', 'two', 'two', 'strip', 'strip', 'full', 'full', 'ultra'])
  })
})

describe('layout plan', () => {
  it('is a drill-down stack below 600 px for every variant', () => {
    for (const variant of ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const) {
      expect(planLayout(input({ width: 390, variant })).stack).toBe(true)
    }
  })

  it('variant C at 600 to 840 px: the current list beside the page, other levels in the trail', () => {
    const p = planLayout(input({ width: 720, variant: 'c', depth: 4, leaf: true }))
    expect(p).toMatchObject({ lists: 3, hidden: 2, colW: 300, paneW: 420, crumbs: true, pane: true })
  })

  it('variant C at 1024 to 1440 px: two or three columns beside a 480 to 600 px page', () => {
    const p = planLayout(input({ width: 1280, variant: 'c', depth: 4, leaf: true }))
    expect(p.paneW).toBeGreaterThanOrEqual(480)
    expect(p.paneW).toBeLessThanOrEqual(600)
    expect(p.hidden).toBe(0)
    expect(p.colW * 3).toBeLessThanOrEqual(1280 - p.paneW)
  })

  it('variant C from 1440 px: resizable columns, a 640 px page to start, a dragged width kept', () => {
    expect(planLayout(input({ width: 1680, variant: 'c', leaf: true })).paneW).toBe(640)
    expect(planLayout(input({ width: 1680, variant: 'c', leaf: true, paneWidth: 720 })).paneW).toBe(720)
    expect(planLayout(input({ width: 1680, variant: 'c', leaf: true })).resizable).toBe(true)
    expect(planLayout(input({ width: 1280, variant: 'c', leaf: true })).resizable).toBe(false)
  })

  it('variant C above 2000 px: the page stops at 680 px and the spare width holds an inspector', () => {
    const p = planLayout(input({ width: 2400, variant: 'c', leaf: true }))
    expect(p).toMatchObject({ paneW: 680, inspector: true, center: true })
  })

  it('closing the C page gives the columns the width', () => {
    const open = planLayout(input({ width: 1280, variant: 'c', leaf: true }))
    const closed = planLayout(input({ width: 1280, variant: 'c', leaf: true, pane: false }))
    expect(open.pane).toBe(true)
    expect(closed.pane).toBe(false)
    expect(closed.paneW).toBe(0)
    expect(closed.colW).toBeGreaterThan(open.colW)
  })

  it('keeps one 280 px column for F, 320 px from 840 px', () => {
    expect(planLayout(input({ width: 720, variant: 'f' }))).toMatchObject({ single: true, colW: 280 })
    expect(planLayout(input({ width: 900, variant: 'f' }))).toMatchObject({ single: true, colW: 320 })
  })

  it('folds the leftmost levels into spines so at most six columns are in view, the preview counted', () => {
    const p = planLayout(input({ width: 1680, variant: 'b', depth: 7, leaf: true }))
    expect(p.lists).toBe(6)
    expect(p.capped).toBe(1)
    expect(p.spines).toBe(1)
    const shown = p.lists - p.hidden - p.spines + (p.preview ? 1 : 0)
    expect(shown).toBeLessThanOrEqual(MAX_VISIBLE)
    // The page of C sits outside the strip, so it does not count.
    expect(planLayout(input({ width: 1680, variant: 'c', depth: 7, leaf: true })).capped).toBe(0)
  })

  it('D shows every ancestor as a spine, and folds the list too when a preview must fit under 840 px', () => {
    expect(planLayout(input({ width: 900, variant: 'd', depth: 4, leaf: false })).spines).toBe(3)
    const small = planLayout(input({ width: 720, variant: 'd', depth: 4, leaf: true }))
    expect(small.spines).toBe(small.lists)
    expect(small.previewW).toBe(720 - small.lists * SPINE_W)
  })

  it('shows the trail whenever the strip cannot hold every level', () => {
    expect(planLayout(input({ width: 1024, variant: 'a', depth: 8, leaf: false })).crumbs).toBe(true)
    expect(planLayout(input({ width: 1280, variant: 'a', depth: 3, leaf: false })).crumbs).toBe(false)
  })

  it('describes the band and the folded levels in the status line', () => {
    const p = planLayout(input({ width: 1680, variant: 'b', depth: 7, leaf: true }))
    expect(describePlan(p, 'b')).toMatch(/^Desktop \(1440 to 2000 px, stage 1680 px\).*1 leftmost level folds into the spine/)
  })
})
