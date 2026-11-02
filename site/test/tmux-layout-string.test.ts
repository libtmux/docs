import { describe, expect, it } from 'vitest'
import { parseLayout } from '../src/lib/tmux-layout-string'
import { arrange, renderLayout, renderRects } from '../src/lib/tmux-layout'

describe('reading a layout a server reported', () => {
  it('reads tmux\'s own window_layout', () => {
    expect(parseLayout('ba5d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}')).toEqual({
      width: 80, height: 24,
      panes: [{ id: '%0', x: 0, y: 0, w: 40, h: 24 }, { id: '%1', x: 41, y: 0, w: 39, h: 24 }],
    })
  })

  it('reads nested splits, in tmux\'s order', () => {
    const parsed = parseLayout('1234,80x24,0,0{40x24,0,0,0,39x24,41,0[39x12,41,0,1,39x11,41,13,2]}')!
    expect(parsed.panes.map((pane) => [pane.id, pane.x, pane.y, pane.w, pane.h])).toEqual([['%0', 0, 0, 40, 24], ['%1', 41, 0, 39, 12], ['%2', 41, 13, 39, 11]])
  })

  it('reads one pane', () => {
    expect(parseLayout('abcd,80x24,0,0,5')!.panes).toEqual([{ id: '%5', x: 0, y: 0, w: 80, h: 24 }])
  })

  it('reads the JSON form two servers return', () => {
    const text = JSON.stringify({ V: 2, L: { t: 'h', w: 80, h: 24, x: 0, y: 0, c: [
      { t: 'p', w: 40, h: 24, x: 0, y: 0, I: '%0' }, { t: 'p', w: 39, h: 24, x: 41, y: 0, I: '%1' },
    ] } })
    expect(parseLayout(text)).toEqual(parseLayout('ba5d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}'))
  })

  it.each(['', 'nonsense', '80x24,0,0{40x24,0,0,0', '{"V":2}', '{"V":2,"L":{"t":"p","w":1,"h":1,"x":0,"y":0}}', 'abcd,80x24,0,0,5trailing'])('refuses %j rather than guessing', (text) => {
    expect(parseLayout(text)).toBeUndefined()
  })
})

describe('drawing at given rectangles', () => {
  it('gives the same markup as a named layout does for the rectangles that layout gives', () => {
    const panes = [['a'], ['b'], ['c']]
    const named = renderLayout(panes, 'tiled', [44, 12], { id: 'x' })
    expect(renderRects(panes, arrange('tiled', 3, 44, 12), [44, 12], { id: 'x' })).toBe(named)
  })

  it('refuses rectangles that are not one per pane', () => {
    expect(() => renderRects([[], []], [{ x: 0, y: 0, w: 1, h: 1 }], [10, 10])).toThrow(/2 panes need 2 rectangles/)
    expect(() => renderRects([[]], [{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }], [10, 10])).toThrow(/1 panes need 1 rectangles, got 2/)
  })
})
