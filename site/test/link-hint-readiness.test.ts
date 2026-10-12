import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initializeLinkHintReadiness } from '../src/lib/link-hint-readiness'
let win: Window
const images: TestImage[] = []
class TestImage {
  src = ''; crossOrigin = ''; onload = () => {}; onerror = () => {}
  decode = vi.fn(() => Promise.resolve())
  constructor() { images.push(this) }
}
beforeEach(() => {
  vi.useFakeTimers(); images.length = 0
  win = new Window({ url: 'https://libtmux.org/en/py/stable/reference/server/' })
  win.document.head.innerHTML = '<link data-link-hints-mask href="/en/_shell/external-link.svg">'
  for (const [name, value] of Object.entries({ document: win.document, location: win.location,
    HTMLScriptElement: win.HTMLScriptElement, Image: TestImage })) vi.stubGlobal(name, value)
})
afterEach(async () => { await win.happyDOM.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const root = () => win.document.documentElement
const pending = () => root().classList.contains('link-hints-pending')
const suppressed = () => root().classList.contains('link-hints-suppressed')
const ready = (generation = root().dataset.linkHintsGeneration, href = win.location.href) => {
  win.document.dispatchEvent(new win.CustomEvent('libtmux:external-links-ready', { detail: { generation, href } }))
}
const maskReady = async (index = images.length - 1) => { images[index].onload(); await Promise.resolve() }
function navigate(href = 'https://libtmux.org/en/julia/latest/reference/server/', mask = '../../_shell/external-link.svg') {
  const next = win.document.implementation.createHTMLDocument()
  next.head.innerHTML = `<link data-link-hints-mask href="${mask}">`
  const event = new win.Event('astro:before-swap')
  Object.assign(event, { newDocument: next, to: new URL(href) })
  win.document.dispatchEvent(event)
  // Astro copies attributes onto the original HTML element, rather than replacing it.
  for (const attr of [...root().attributes]) root().removeAttribute(attr.name)
  for (const attr of [...next.documentElement.attributes]) root().setAttribute(attr.name, attr.value ?? '')
  win.happyDOM.setURL(href)
  return next
}
it.each(['mask', 'module'])('waits for both decoration and decoded mask, with %s finishing first', async (first) => {
  root().classList.add('fonts-pending'); initializeLinkHintReadiness()
  expect(pending()).toBe(true)
  expect(images[0].src).toBe('https://libtmux.org/en/_shell/external-link.svg')
  expect(images[0].crossOrigin).toBe('anonymous')
  if (first === 'mask') await maskReady(); else ready()
  expect(pending()).toBe(true)
  if (first === 'mask') ready(); else await maskReady()
  expect(pending()).toBe(false); expect(suppressed()).toBe(false)
  expect(root().classList.contains('fonts-pending')).toBe(true)
})
it('waits for decode rather than only the image load event', async () => {
  initializeLinkHintReadiness(); ready()
  let resolve!: () => void
  images[0].decode.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  images[0].onload(); await Promise.resolve(); expect(pending()).toBe(true)
  resolve(); await Promise.resolve(); expect(pending()).toBe(false)
})
it.each(['module', 'mask', 'both'])('bounds a missing %s and ignores late successes for the page', async (missing) => {
  initializeLinkHintReadiness()
  if (missing === 'module') await maskReady()
  if (missing === 'mask') ready()
  vi.advanceTimersByTime(2999); expect(pending()).toBe(true)
  vi.advanceTimersByTime(1); expect(pending()).toBe(false); expect(suppressed()).toBe(true)
  ready(); await maskReady(); expect(pending()).toBe(false); expect(suppressed()).toBe(true)
})
it.each(['error', 'decode'])('suppresses failed mask %s without leaving a blank page', async (failure) => {
  initializeLinkHintReadiness(); ready()
  if (failure === 'error') images[0].onerror()
  else { images[0].decode.mockRejectedValue(new Error('decode failed')); await maskReady() }
  expect(pending()).toBe(false); expect(suppressed()).toBe(true)
})
it('suppresses a failed current module but ignores unrelated or detached script failures', () => {
  initializeLinkHintReadiness()
  const script = win.document.createElement('script'); win.document.head.append(script)
  script.dispatchEvent(new win.Event('error')); expect(pending()).toBe(true)
  script.setAttribute('data-link-hints-module', ''); script.remove()
  script.dispatchEvent(new win.Event('error')); expect(pending()).toBe(true)
  win.document.head.append(script); script.dispatchEvent(new win.Event('error'))
  expect(pending()).toBe(false); expect(suppressed()).toBe(true)
})
it('retries a suppressed page with the destination-specific mask URL and copied HTML attributes', async () => {
  initializeLinkHintReadiness(); vi.advanceTimersByTime(3000); expect(suppressed()).toBe(true)
  const next = navigate()
  expect(images[1].src).toBe('https://libtmux.org/en/julia/latest/_shell/external-link.svg')
  expect(pending()).toBe(true); expect(suppressed()).toBe(false)
  ready(); await maskReady()
  expect(pending()).toBe(false); expect(next.documentElement.classList.contains('link-hints-pending')).toBe(false)
})
it('ignores prior-navigation readiness, masks and deadlines, including revisiting the same URL', async () => {
  initializeLinkHintReadiness(); const old = root().dataset.linkHintsGeneration
  vi.advanceTimersByTime(2000); navigate(win.location.href, '/other-root/_shell/external-link.svg')
  ready(old); await maskReady(0); vi.advanceTimersByTime(1000)
  expect(pending()).toBe(true); expect(suppressed()).toBe(false)
  ready(root().dataset.linkHintsGeneration, 'https://libtmux.org/wrong-page/')
  await maskReady(1); expect(pending()).toBe(true)
  ready(); expect(pending()).toBe(false)
})
it('ignores fragment differences for the same document', async () => {
  initializeLinkHintReadiness(); await maskReady()
  ready(root().dataset.linkHintsGeneration, `${win.location.href}#member`); expect(pending()).toBe(false)
})
it('releases with icons suppressed if a destination has no mask contract', () => {
  win.document.head.innerHTML = ''; initializeLinkHintReadiness()
  expect(pending()).toBe(false); expect(suppressed()).toBe(true)
})
it('runs the exact serialized head initializer without module-scope dependencies', () => {
  Object.assign(win, { Image: TestImage }); win.eval(`(${initializeLinkHintReadiness.toString()})();`)
  expect(pending()).toBe(true); expect(images).toHaveLength(1)
  ready(); images[0].onerror(); expect(pending()).toBe(false); expect(suppressed()).toBe(true)
})
