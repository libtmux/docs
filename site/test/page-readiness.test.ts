import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initializePageReadiness, layoutBeforeAppearance, waitForAppearance } from '../src/lib/page-readiness'

const deferred = () => {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let win: Window
let mask: ReturnType<typeof deferred>
let fonts: ReturnType<typeof deferred>
let faces: { family: string; status: string; loaded?: Promise<void> }[]
let state: string
const decorate = vi.fn()
class Image {
  src = ''
  decode() { return mask.promise }
}
beforeEach(() => {
  vi.useFakeTimers()
  mask = deferred(); fonts = deferred(); faces = []; state = 'loading'
  decorate.mockClear()
  win = new Window({ url: 'https://libtmux.org/en/swift/latest/reference/server/', settings: {
    disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
  } })
  Object.defineProperty(win.document, 'readyState', { get: () => state })
  Object.defineProperty(win.document, 'fonts', { value: {
    ready: fonts.promise, addEventListener: vi.fn(), [Symbol.iterator]: () => faces.values(),
  } })
  // Layout and resource decoding belong to the Chromium acceptance path.
  Object.defineProperty(win.document, 'images', { value: [] })
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location,
    Element: win.Element, HTMLScriptElement: win.HTMLScriptElement, HTMLLinkElement: win.HTMLLinkElement,
    CSSImportRule: class {}, CSSStyleRule: win.CSSStyleRule,
    ErrorEvent: win.ErrorEvent, CustomEvent: win.CustomEvent, MutationObserver: win.MutationObserver,
    matchMedia: win.matchMedia.bind(win), Image })) vi.stubGlobal(name, value)
})
afterEach(async () => { await win.happyDOM.abort(); vi.useRealTimers(); vi.unstubAllGlobals() })
const root = () => win.document.documentElement
const flush = async () => { for (let i = 0; i < 16; ++i) await Promise.resolve() }
const parse = () => { state = 'interactive'; win.document.dispatchEvent(new win.Event('readystatechange')) }
const ready = async () => { mask.resolve(); fonts.resolve(); parse(); await flush() }
const script = () => {
  const element = win.document.createElement('script'); element.type = 'module'; element.src = '/required.js'
  win.document.head.append(element)
  return element
}

it('waits for parsing, mask decode, fonts and final connected layout', async () => {
  initializePageReadiness(decorate, 'data:image/svg+xml,icon')
  const layout = vi.fn(() => expect(decorate).toHaveBeenCalledOnce()); layoutBeforeAppearance(layout)
  mask.resolve(); fonts.resolve(); await flush()
  expect(decorate).not.toHaveBeenCalled()
  expect(root().dataset.pageReadiness).toBe('pending')
  parse()
  expect(decorate).toHaveBeenCalledOnce()
  expect(layout).not.toHaveBeenCalled()
  await flush()
  expect(layout).toHaveBeenCalledOnce()
  expect(root().dataset.pageReadiness).toBe('ready')
  expect(root().classList.contains('fonts-pending')).toBe(false)
  expect(root().classList.contains('link-hints-pending')).toBe(false)
})
it('keeps decorated content gated until the external-link mask has decoded', async () => {
  initializePageReadiness(decorate, 'icon')
  fonts.resolve(); parse(); await flush()
  expect(decorate).toHaveBeenCalledOnce()
  expect(root().dataset.pageReadiness).toBe('pending')
  expect(root().classList.contains('link-hints-pending')).toBe(true)
  mask.resolve(); await flush()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('treats decoration failure as a required appearance failure', async () => {
  decorate.mockImplementationOnce(() => { throw new Error('decoration failed') })
  initializePageReadiness(decorate, 'icon')
  await ready()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(root().classList.contains('link-hints-pending')).toBe(true)
  expect(win.document.querySelector('[role="alert"]')?.textContent).toContain('Reload')
})
it('does not turn a required failure into success when remaining resources settle', async () => {
  const module = script()
  initializePageReadiness(decorate, 'icon')
  parse(); module.dispatchEvent(new win.Event('error')); await flush()
  module.dispatchEvent(new win.Event('load'))
  mask.resolve(); fonts.resolve(); await flush()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(root().classList.contains('link-hints-pending')).toBe(true)
  expect(win.document.querySelectorAll('[role="alert"]')).toHaveLength(1)
})
it('a delayed module cannot reveal through an empty task registry or an elapsed cutoff', async () => {
  const module = script()
  initializePageReadiness(decorate, 'icon')
  await ready()
  vi.advanceTimersByTime(3500); await flush()
  expect(root().dataset.pageReadiness).toBe('pending')
  module.dispatchEvent(new win.Event('load')); await flush()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('awaits visual work started by a successfully loaded module', async () => {
  const module = script(), effect = deferred()
  initializePageReadiness(decorate, 'icon')
  await ready()
  waitForAppearance(effect.promise)
  module.dispatchEvent(new win.Event('load')); await flush()
  expect(root().dataset.pageReadiness).toBe('pending')
  effect.resolve(); await flush()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('reports module failure while another required resource remains held', async () => {
  const module = script()
  initializePageReadiness(decorate, 'icon')
  parse(); module.dispatchEvent(new win.Event('error')); await flush()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(root().classList.contains('link-hints-pending')).toBe(true)
  expect(win.document.querySelector('[role="alert"]')?.textContent).toContain('Reload')
})
it('decode failure produces recovery rather than suppressed-icon success', async () => {
  initializePageReadiness(decorate, 'icon')
  mask.reject(new Error('decode failed')); fonts.resolve(); parse(); await flush()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(root().classList.contains('link-hints-pending')).toBe(true)
})
it('fonts.ready settling after a failed face does not certify successful fonts', async () => {
  faces.push({ family: 'IBM Plex Mono', status: 'error' })
  initializePageReadiness(decorate, 'icon')
  await ready()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(root().classList.contains('fonts-pending')).toBe(true)
})
it('reports a failed font while another face keeps fonts.ready pending', async () => {
  const face = deferred()
  faces.push({ family: 'IBM Plex Mono', status: 'loading', loaded: face.promise })
  initializePageReadiness(decorate, 'icon')
  mask.resolve(); parse(); await flush()
  face.reject(new Error('font failed')); await flush()
  expect(root().dataset.pageReadiness).toBe('failed')
  expect(win.document.querySelector('[role="alert"]')?.textContent).toContain('Reload')
})
it('unavailable local metric fallbacks do not count as failed downloaded fonts', async () => {
  faces.push({ family: 'IBM Plex Mono-43e546aadd822e31 fallback: Courier New', status: 'error' })
  initializePageReadiness(decorate, 'icon')
  await ready()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('drains work and layout registered during the final font wait', async () => {
  const effect = deferred(), layout = vi.fn()
  initializePageReadiness(decorate, 'icon')
  mask.resolve(); parse(); await flush()
  waitForAppearance(effect.promise); layoutBeforeAppearance(layout)
  fonts.resolve(); await flush()
  expect(root().dataset.pageReadiness).toBe('pending')
  effect.resolve(); await flush()
  expect(layout).toHaveBeenCalledOnce()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('waits for required CSS discovered by initial visual work', async () => {
  const effect = deferred()
  initializePageReadiness(decorate, 'icon'); waitForAppearance(effect.promise)
  await ready()
  const style = win.document.createElement('link'); style.rel = 'stylesheet'
  win.document.head.append(style); await win.happyDOM.waitUntilComplete()
  effect.resolve(); await flush()
  expect(root().dataset.pageReadiness).toBe('pending')
  style.dispatchEvent(new win.Event('load')); await flush()
  expect(root().dataset.pageReadiness).toBe('ready')
})
it('the exact serialized initializer has no module-scope dependencies', async () => {
  Object.assign(win, { Image })
  win.eval(`(${initializePageReadiness.toString()})(() => {}, 'icon');`)
  await ready()
  expect(root().dataset.pageReadiness).toBe('ready')
})
