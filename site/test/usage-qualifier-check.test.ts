import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qualifierProblems } from '../scripts/check-badge-centring.mjs'

/**
 * The browser check of the usage table judges boxes it reads from the page. Here the boxes are written down, one chip and
 * its qualifier at a time, so the judgement can be read without a browser: a chip that keeps the width its name needs passes,
 * and a chip that gave up width to its qualifier, or a qualifier laid over its chip, is named.
 */
const windows: Window[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const win of windows.splice(0)) await win.happyDOM.abort() })

interface Box { top: number; left: number; width: number; height: number }
interface Qualified { chip: Box; needs: number; room: number; when: Box }

/** Items of the usage table, each a chip and its qualifier, with the width the chip's name needs and the room its cell gives it. */
async function qualified(items: Qualified[]) {
  const win = new Window()
  windows.push(win)
  const { document } = win
  document.body.innerHTML = '<div class="tmux-usage"><span class="tmux-usage__links"></span></div>'
  const links = document.querySelector('.tmux-usage__links')!
  const rect = (box: Box) => ({ top: box.top, left: box.left, bottom: box.top + box.height, right: box.left + box.width, width: box.width, height: box.height })
  const place = (element: object, box: Box) => Object.defineProperty(element, 'getBoundingClientRect', { value: () => rect(box), configurable: true })
  Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { get() { return document.body }, configurable: true })
  for (const spec of items) {
    const item = document.createElement('span')
    item.className = 'tmux-usage__item'
    item.innerHTML = '<a><span class="api-nav__kind">f</span><code>newSession</code></a><span class="tmux-usage__when">the spec names a first window</span>'
    const [chip, when] = [item.querySelector('a')!, item.querySelector('.tmux-usage__when')!]
    links.append(item)
    place(item, { top: spec.chip.top, left: spec.chip.left, width: spec.room, height: spec.chip.height })
    place(chip, spec.chip)
    place(when, spec.when)
    // A copy of the chip in the wide measuring box is as wide as its name needs.
    const clone = chip.cloneNode.bind(chip)
    Object.defineProperty(chip, 'cloneNode', { value: (deep?: boolean) => { const copy = clone(deep); place(copy, { ...spec.chip, width: spec.needs }); return copy }, configurable: true })
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('getComputedStyle', win.getComputedStyle.bind(win))
  return (await qualifierProblems({ evaluate: async (read: () => unknown) => read() })).problems
}

describe('the qualifier check of the browser gate', () => {
  const chip = (width: number): Box => ({ top: 0, left: 0, width, height: 20 })
  const beside: Box = { top: 4, left: 90, width: 190, height: 14 }
  const under: Box = { top: 22, left: 0, width: 160, height: 28 }

  it('passes a chip at the width its name needs, with its qualifier beside it or under it', async () => {
    expect(await qualified([{ chip: chip(80), needs: 80, room: 290, when: beside }])).toEqual([])
    expect(await qualified([{ chip: chip(80), needs: 80, room: 176, when: under }])).toEqual([])
    // A cell narrower than the name gives it the cell: the chip is as wide as the room, and wraps its name inside.
    expect(await qualified([{ chip: { top: 0, left: 0, width: 100, height: 35 }, needs: 190, room: 100, when: { top: 38, left: 0, width: 100, height: 28 } }])).toEqual([])
  })

  it('names a chip that gave up width to its qualifier in a cell with room, and a qualifier laid over its chip', async () => {
    // The layout of b8f892310: the chip is 62px of 290 and its name of ten characters needs 80.
    expect(await qualified([{ chip: chip(62), needs: 80, room: 290, when: beside }])).toEqual(['fnewSession: it is 62.0px wide in 290.0px of room and its name needs 80.0px'])
    expect(await qualified([{ chip: chip(80), needs: 80, room: 290, when: { top: 4, left: 40, width: 190, height: 14 } }])).toEqual(['fnewSession: its qualifier is over it by 14.0px'])
  })
})
