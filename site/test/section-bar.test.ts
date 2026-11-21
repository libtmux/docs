import { Window } from 'happy-dom'
import { afterEach, expect, it } from 'vitest'
import { mountSectionBar } from '../src/lib/section-bar'

let win: Window
afterEach(async () => { await win?.happyDOM.abort() })

/** A bar with the markup `ApiSectionBar.astro` emits, in a row `visible` px wide holding `total` px of links. */
function mount({ visible, total }: { visible: number; total: number }) {
  win = new Window({ url: 'https://libtmux.org/en/go/latest/reference/pane/' })
  win.document.body.innerHTML = `<api-section-bar class="api-section-bar">
    <button type="button" data-dir="-1" aria-label="Earlier sections" hidden></button>
    <nav class="api-section-links" data-scroll-track><a href="#a" aria-current="location">A</a><a href="#b">B</a></nav>
    <button type="button" data-dir="1" aria-label="Later sections" hidden></button></api-section-bar>`
  const bar = win.document.querySelector('api-section-bar') as unknown as HTMLElement
  const track = win.document.querySelector('nav') as unknown as HTMLElement
  const [previous, next] = [...win.document.querySelectorAll('button')] as unknown as HTMLButtonElement[]
  let left = 0
  Object.defineProperties(track, {
    clientWidth: { value: visible }, scrollWidth: { value: total },
    scrollLeft: { get: () => left, set: (value: number) => { left = value } },
  })
  const stop = mountSectionBar(bar)
  const scrollTo = (value: number) => { left = value; track.dispatchEvent(new win.Event('scroll')) }
  return { bar, previous, next, scrollTo, stop }
}

it('shows no arrows while the links fit', () => {
  const { bar, previous, next } = mount({ visible: 600, total: 400 })
  expect(previous.hidden).toBe(true)
  expect(next.hidden).toBe(true)
  expect(bar.hasAttribute('data-overflow')).toBe(false)
})

it('shows both arrows when links overflow, disables the one at the edge and marks the edge that has more behind it', () => {
  const { bar, previous, next, scrollTo } = mount({ visible: 300, total: 900 })
  expect([previous.hidden, next.hidden]).toEqual([false, false])
  expect([previous.disabled, next.disabled]).toEqual([true, false])
  expect([bar.hasAttribute('data-start'), bar.hasAttribute('data-end')]).toEqual([true, false])
  scrollTo(300)
  expect([previous.disabled, next.disabled]).toEqual([false, false])
  expect([bar.hasAttribute('data-start'), bar.hasAttribute('data-end')]).toEqual([false, false])
  scrollTo(600)
  expect([previous.disabled, next.disabled]).toEqual([false, true])
  expect([bar.hasAttribute('data-start'), bar.hasAttribute('data-end')]).toEqual([false, true])
})

it('hands focus to the other arrow when the focused one reaches its end', () => {
  const { previous, next, scrollTo } = mount({ visible: 300, total: 900 })
  scrollTo(300)
  next.focus()
  scrollTo(600)
  expect(win.document.activeElement).toBe(previous)
})
