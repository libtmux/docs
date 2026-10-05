import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindHomeHoverPreview, HOME_PREVIEW_DELAY } from '../src/lib/home-hover-preview'

let win: Window
let controller: AbortController

beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/' })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
  vi.spyOn(win, 'matchMedia').mockReturnValue({ matches: true } as ReturnType<typeof win.matchMedia>)
  vi.useFakeTimers()
  controller = new AbortController()
})
afterEach(async () => {
  controller.abort()
  vi.useRealTimers()
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function controls() {
  win.document.body.innerHTML = '<button>one</button><button>two</button>'
  const options = [...win.document.querySelectorAll('button')]
  const show = vi.fn()
  const restore = vi.fn()
  const preview = bindHomeHoverPreview({
    options: options as unknown as HTMLElement[], show, restore, signal: controller.signal,
  })
  const enter = (index = 0, pointerType = 'mouse') => options[index].dispatchEvent(new win.PointerEvent('pointerenter', { pointerType }))
  const leave = (index = 0) => options[index].dispatchEvent(new win.PointerEvent('pointerleave'))
  return { options, show, restore, preview, enter, leave }
}

it('requires a full dwell and restores a completed preview on leave', () => {
  const c = controls()
  c.enter()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY - 1)
  expect(c.show).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(c.show).toHaveBeenCalledExactlyOnceWith(c.options[0])
  c.leave()
  expect(c.restore).toHaveBeenCalledOnce()
})

it('cancels brief hovers and gives the next option its own dwell', () => {
  const c = controls()
  c.enter()
  vi.advanceTimersByTime(800)
  c.leave()
  c.enter(1)
  vi.advanceTimersByTime(800)
  expect(c.show).not.toHaveBeenCalled()
  vi.advanceTimersByTime(400)
  expect(c.show).toHaveBeenCalledExactlyOnceWith(c.options[1])
})

it.each([false, true])('click commits without a late preview or reversal (active %s)', (active) => {
  const c = controls()
  c.enter()
  if (active) vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  c.preview.commit()
  c.leave()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  expect(c.show).toHaveBeenCalledTimes(active ? 1 : 0)
  expect(c.restore).not.toHaveBeenCalled()
})

it.each(['escape', 'blur', 'swap', 'abort'])('cancels pending and active previews on %s', (reason) => {
  const c = controls()
  const cancel = () => {
    if (reason === 'escape') win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }))
    if (reason === 'blur') win.dispatchEvent(new win.Event('blur'))
    if (reason === 'swap') win.document.dispatchEvent(new win.Event('astro:before-swap'))
    if (reason === 'abort') controller.abort()
  }
  c.enter()
  cancel()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  expect(c.show).not.toHaveBeenCalled()
  if (reason === 'abort') return
  c.enter()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  cancel()
  expect(c.restore).toHaveBeenCalledOnce()
})

it('does not preview a touch or detached option', () => {
  const c = controls()
  c.enter(0, 'touch')
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  expect(c.show).not.toHaveBeenCalled()
  c.enter()
  c.options[0].remove()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  expect(c.show).not.toHaveBeenCalled()
})

it('restores before a picker consumes Escape to close itself', () => {
  const c = controls()
  c.options[0].addEventListener('keydown', (event) => event.stopPropagation())
  c.enter()
  vi.advanceTimersByTime(HOME_PREVIEW_DELAY)
  c.options[0].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(c.restore).toHaveBeenCalledOnce()
})
