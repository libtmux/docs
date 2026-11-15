import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { fitsWithout, hiddenCounts, pageTo, revealLeft, updateTabRow, watchTabRows } from '../src/components/widgets/install-tabs'

/**
 * A tab row that overflows says how many tabs it hides (design record 0065).
 *
 * Geometry is stubbed: a DOM has no layout here, so each test lays eight tabs
 * out 100px apart, 90px wide, in a row `clientWidth` wide.
 */
const boxes = (count: number, width = 90, step = 100) => Array.from({ length: count }, (_, i) => ({ left: i * step, width }))

describe('counting the tabs a row hides', () => {
  it('counts the tabs cut off at each edge, and none when every tab shows', () => {
    expect(hiddenCounts(boxes(8), 0, 250)).toEqual({ before: 0, after: 6 })
    expect(hiddenCounts(boxes(8), 300, 250)).toEqual({ before: 3, after: 3 })
    expect(hiddenCounts(boxes(8), 550, 250)).toEqual({ before: 6, after: 0 })
    expect(hiddenCounts(boxes(3), 0, 300)).toEqual({ before: 0, after: 0 })
  })

  it('counts a tab cut in part as hidden on its side', () => {
    expect(hiddenCounts(boxes(3), 0, 250)).toEqual({ before: 0, after: 1 })
    expect(hiddenCounts(boxes(3), 20, 250)).toEqual({ before: 1, after: 1 })
  })
})

describe('a press brings the first hidden tab on that side to the opposite edge', () => {
  it('pages to the right so the first hidden tab sits at the left, clear of the fade', () => {
    // Tabs 0 and 1 show; tab 2 (200..290) is the first cut at the right edge of a 250px row.
    expect(pageTo(boxes(8), 1, 0, 250)).toBe(200 - 24)
    // Pressed again, the row is at 176 and tab 4 is the first hidden: new tabs each press.
    expect(pageTo(boxes(8), 1, 176, 250)).toBe(400 - 24)
  })

  it('pages to the left so the last hidden tab sits at the right', () => {
    expect(pageTo(boxes(8), -1, 550, 250)).toBe(590 - 250 + 24)
    expect(pageTo(boxes(8), -1, 0, 250)).toBeUndefined()
    expect(pageTo(boxes(8), 1, 550, 250)).toBeUndefined()
  })

  it('keeps a focused tab clear of the fade', () => {
    expect(revealLeft({ left: 700, width: 90 }, 0, 250)).toBe(700 + 90 - 250 + 24)
    expect(revealLeft({ left: 400, width: 90 }, 600, 250)).toBe(400 - 24)
    // The first tab clears the fade at the start with nothing before it to scroll to.
    expect(revealLeft({ left: 10, width: 90 }, 300, 250)).toBe(0)
    // Already clear of both fades: the row stays.
    expect(revealLeft({ left: 130, width: 90 }, 100, 250)).toBe(100)
  })
})

describe('judging whether every tab fits', () => {
  // The row is `container` wide with no buttons, `container - 100` with them. Tabs need `need` px.
  const settle = (container: number, need: number, showing: boolean) => {
    const trail: boolean[] = [showing]
    for (let i = 0; i < 6; i++) {
      const clientWidth = showing ? container - 100 : container
      const fits = fitsWithout(need, clientWidth, 100, showing)
      showing = !fits
      trail.push(showing)
    }
    return trail
  }

  it('gives the buttons\' width back, so showing them never flips the answer', () => {
    // Needs 640 of 700: fits without the buttons, though it would not beside them (600).
    expect(settle(700, 640, true).slice(1)).toEqual([false, false, false, false, false, false])
    expect(settle(700, 640, false).slice(1)).toEqual([false, false, false, false, false, false])
  })

  it('cannot oscillate at the boundary, from either starting state', () => {
    for (const need of [698, 699, 700, 701, 702]) {
      for (const container of [700]) {
        const fromShowing = settle(container, need, true)
        const fromHidden = settle(container, need, false)
        // Whatever the answer, it is the same from either start, and it holds from the second step on.
        expect(fromShowing.slice(2), `need ${need}`).toEqual(fromHidden.slice(2))
        expect(new Set(fromShowing.slice(2)).size, `need ${need}`).toBe(1)
      }
    }
  })

  it('keeps the buttons when the tabs do not fit even with the room given back', () => {
    expect(settle(700, 760, false).slice(1)).toEqual([true, true, true, true, true, true])
  })
})

describe('the row in a page', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close() })

  /** Eight tabs in a 250px row with edge buttons 40px wide, and the geometry a layout would give them. */
  function fixture(options: { clientWidth?: number; noun?: string; scrollLeft?: number } = {}) {
    const window = new Window()
    windows.push(window)
    const { document } = window
    const noun = options.noun ?? 'clients'
    document.body.innerHTML = `<div data-install-row data-fits>
      <button type="button" data-install-more="-1" data-noun="${noun}" disabled><span data-n></span></button>
      <div data-install-scroll>${boxes(8).map((_, i) => `<button type="button" role="tab" aria-selected="${i === 0}">Tab ${i}</button>`).join('')}</div>
      <button type="button" data-install-more="1" data-noun="${noun}" disabled><span data-n></span></button>
    </div>`
    const wrap = document.querySelector<HTMLElement>('[data-install-row]')!
    const row = document.querySelector<HTMLElement>('[data-install-scroll]')!
    const define = (el: Element, values: Record<string, number>) => { for (const [key, value] of Object.entries(values)) Object.defineProperty(el, key, { configurable: true, writable: true, value }) }
    define(row, { clientWidth: options.clientWidth ?? 250, scrollWidth: 800, scrollLeft: options.scrollLeft ?? 0 })
    row.querySelectorAll('[role="tab"]').forEach((tab, i) => define(tab, { offsetLeft: i * 100, offsetWidth: 90 }))
    wrap.querySelectorAll('[data-install-more]').forEach((button) => define(button, { offsetWidth: 40 }))
    const scrolls: { left: number; behavior: string }[] = []
    Object.defineProperty(row, 'scrollTo', { configurable: true, value: (options: { left: number; behavior: string }) => scrolls.push(options) })
    const buttons = [...wrap.querySelectorAll<HTMLButtonElement>('[data-install-more]')]
    return { window, document, wrap, row, buttons, scrolls, update: () => updateTabRow(row) }
  }

  it('shows the count hidden on each side, and names what a press does', () => {
    const { wrap, buttons, update } = fixture()
    update()
    expect(wrap.hasAttribute('data-fits')).toBe(false)
    expect(buttons.map((button) => button.querySelector('[data-n]')!.textContent)).toEqual(['', '+6'])
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['No more clients this way', 'Show 6 more clients'])
  })

  it('names the noun the row holds: clients, or tools', () => {
    const { buttons, update } = fixture({ noun: 'tools' })
    update()
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['No more tools this way', 'Show 6 more tools'])
  })

  it('dims and disables a side with nothing hidden, and enables the side with some', () => {
    const { row, buttons, update } = fixture()
    update()
    expect(buttons.map((button) => button.disabled)).toEqual([true, false])
    row.scrollLeft = 300
    update()
    expect(buttons.map((button) => button.disabled)).toEqual([false, false])
    expect(buttons.map((button) => button.querySelector('[data-n]')!.textContent)).toEqual(['+3', '+3'])
    row.scrollLeft = 550
    update()
    expect(buttons.map((button) => button.disabled)).toEqual([false, true])
    expect(buttons.map((button) => button.querySelector('[data-n]')!.textContent)).toEqual(['+6', ''])
  })

  it('fades on the side with more tabs', () => {
    const { row, update } = fixture()
    update()
    expect(row.dataset.more).toBe('end')
    row.scrollLeft = 300
    update()
    expect(row.dataset.more).toBe('both')
    row.scrollLeft = 550
    update()
    expect(row.dataset.more).toBe('start')
  })

  it('removes both buttons only when every tab fits, with their room given back', () => {
    // The buttons show: the row is 720 wide beside their 80px, so 800 without them.
    const { wrap, row, update } = fixture({ clientWidth: 720 })
    wrap.removeAttribute('data-fits')
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 790 })
    update()
    expect(wrap.hasAttribute('data-fits')).toBe(true)
    // With the buttons gone the row is 800 wide, and the answer holds.
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 800 })
    update()
    expect(wrap.hasAttribute('data-fits')).toBe(true)
    // Tabs that need more than the row has even without them bring the buttons back.
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 850 })
    update()
    expect(wrap.hasAttribute('data-fits')).toBe(false)
  })

  it('pages on a press, smoothly, or at once for a reader who asks for less motion', () => {
    const { window, document, row, scrolls, update, buttons } = fixture()
    watchTabRows(document as unknown as Document)
    update()
    buttons[1]!.click()
    expect(scrolls).toEqual([{ left: 176, behavior: 'smooth' }])
    ;(window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true })
    row.scrollLeft = 176
    update()
    buttons[1]!.click()
    expect(scrolls.at(-1)).toEqual({ left: 376, behavior: 'auto' })
  })

  it('does nothing for a disabled button', () => {
    const { document, scrolls, update, buttons } = fixture()
    watchTabRows(document as unknown as Document)
    update()
    buttons[0]!.click()
    expect(scrolls).toEqual([])
  })
})
