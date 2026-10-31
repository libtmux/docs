import { describe, expect, it } from 'vitest'
import { LAYOUTS } from '../src/lib/tmux-layout'
import { layoutIcon } from '../src/lib/tmux-layout-icon'

/** The path data of the dividers, split into one entry per segment. */
const segments = (svg: string) => (/class="ws-tile__divider" d="([^"]*)"/.exec(svg)?.[1] ?? '').split('M').filter(Boolean)

describe('layoutIcon', () => {
  it('is a small svg of pane outlines with no text, in the text colour', () => {
    const svg = layoutIcon('even-vertical', 3)
    expect(svg.startsWith('<svg class="ws-tile"')).toBe(true)
    expect(svg).toContain('viewBox="0 0 32 24"')
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).not.toMatch(/<text|<tspan|style=|#[0-9a-f]{3,8}\b|rgb\(/i)
    expect(svg.match(/class="ws-tile__window"/g)).toHaveLength(1)
  })

  it('draws a divider between panes and none for a single pane', () => {
    expect(segments(layoutIcon('even-vertical', 1))).toEqual([])
    expect(segments(layoutIcon('even-vertical', 3))).toHaveLength(2)
    expect(segments(layoutIcon('even-horizontal', 4))).toHaveLength(3)
    expect(layoutIcon('main-vertical', 3)).toContain('ws-tile__divider')
  })

  it('draws every layout tmux arranges, and each differently', () => {
    const drawn = LAYOUTS.map((layout) => layoutIcon(layout, 4))
    expect(new Set(drawn).size).toBe(LAYOUTS.length)
    for (const svg of drawn) expect(svg).not.toContain('NaN')
  })

  it('keeps every divider inside the window outline', () => {
    for (const layout of LAYOUTS) {
      for (const stacked of [false, true]) {
        const svg = layoutIcon(layout, 5, stacked)
        for (const [, x, y] of svg.matchAll(/M([\d.]+) ([\d.]+)/g)) {
          expect(Number(x)).toBeGreaterThanOrEqual(1)
          expect(Number(x)).toBeLessThanOrEqual(31)
          expect(Number(y)).toBeGreaterThanOrEqual(1)
          expect(Number(y)).toBeLessThanOrEqual(23)
        }
      }
    }
  })

  it('adds the edge of a window behind only for a preset with more windows', () => {
    expect(layoutIcon('tiled', 4)).not.toContain('ws-tile__back')
    const stacked = layoutIcon('tiled', 4, true)
    expect(stacked).toContain('ws-tile__back')
    // The back edge is drawn before the front tile, so the tile covers it.
    expect(stacked.indexOf('ws-tile__back')).toBeLessThan(stacked.indexOf('ws-tile__window'))
  })

  it('treats no panes as one, so a window with nothing to draw still has a tile', () => {
    expect(layoutIcon('tiled', 0)).toBe(layoutIcon('tiled', 1))
  })
})
