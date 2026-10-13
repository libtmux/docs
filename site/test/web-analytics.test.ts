import { Window, type HTMLScriptElement } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initializeWebAnalytics } from '../src/lib/web-analytics'

let win: Window
let state: string
const token = '0123456789abcdef0123456789abcdef'
const fetch = vi.fn()
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const beacon = () => win.document.querySelector<HTMLScriptElement>('script[data-cf-beacon]')
beforeEach(() => {
  state = 'loading'
  fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ token }), {
    headers: { 'x-libtmux-analytics': 'allow' },
  }))
  win = new Window({ url: 'https://libtmux.org/pr-142/en/', settings: { disableJavaScriptFileLoading: true } })
  Object.defineProperty(win.document, 'readyState', { get: () => state })
  Object.defineProperty(win, 'fetch', { value: fetch })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', win.document)
})
afterEach(async () => { await win.happyDOM.abort(); vi.unstubAllGlobals() })

it('starts neither policy nor beacon before the load event', async () => {
  initializeWebAnalytics('/pr-142/en/_shell/web-analytics.json')
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'))
  await flush()
  expect(fetch).not.toHaveBeenCalled()
  expect(beacon()).toBeNull()
  state = 'complete'
  win.dispatchEvent(new win.Event('load'))
  await flush()
  expect(fetch).toHaveBeenCalledWith('/pr-142/en/_shell/web-analytics.json', {
    cache: 'no-store', credentials: 'same-origin',
  })
  expect(beacon()?.type).toBe('module')
  expect(beacon()?.async).toBe(true)
  expect(beacon()?.src).toBe('https://static.cloudflareinsights.com/beacon.min.js')
  expect(JSON.parse(beacon()!.dataset.cfBeacon!)).toEqual({ token })
})
it.each([undefined, 'deny'])('does not load a beacon without edge permission: %s', async (permission) => {
  state = 'complete'
  fetch.mockResolvedValue(new Response(JSON.stringify({ token }), {
    headers: permission ? { 'x-libtmux-analytics': permission } : {},
  }))
  initializeWebAnalytics('/policy.json')
  await flush()
  expect(beacon()).toBeNull()
})
it.each([
  new Response('{}', { status: 403, headers: { 'x-libtmux-analytics': 'allow' } }),
  new Response('{', { headers: { 'x-libtmux-analytics': 'allow' } }),
  new Response('{"token":"invalid"}', { headers: { 'x-libtmux-analytics': 'allow' } }),
])('skips unsuccessful or invalid policy responses', async (response) => {
  state = 'complete'
  fetch.mockResolvedValue(response)
  initializeWebAnalytics('/policy.json')
  await flush()
  expect(beacon()).toBeNull()
})
it('does not reject startup when the policy request fails', async () => {
  state = 'complete'
  fetch.mockRejectedValue(new Error('Network failed'))
  initializeWebAnalytics('/policy.json')
  await flush()
  expect(beacon()).toBeNull()
})
it('does not duplicate analytics when the head runs again after a swap', async () => {
  state = 'complete'
  initializeWebAnalytics('/policy.json')
  await flush()
  beacon()?.remove()
  initializeWebAnalytics('/policy.json')
  await flush()
  expect(fetch).toHaveBeenCalledOnce()
})
it('leaves an automatically injected beacon as the only installation', async () => {
  state = 'complete'
  const script = win.document.createElement('script')
  script.dataset.cfBeacon = '{}'
  win.document.head.append(script)
  initializeWebAnalytics('/policy.json')
  await flush()
  expect(fetch).not.toHaveBeenCalled()
  expect(win.document.querySelectorAll('script[data-cf-beacon]')).toHaveLength(1)
})
it('the serialized head initializer has no module-scope dependency', async () => {
  state = 'complete'
  win.eval(`(${initializeWebAnalytics.toString()})('/policy.json')`)
  await flush()
  expect(beacon()).not.toBeNull()
})
