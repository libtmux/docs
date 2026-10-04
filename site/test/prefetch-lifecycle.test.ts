import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { type HTMLAnchorElement, Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const implementation = readFileSync(
  join(dirname(require.resolve('astro/package.json')), 'dist/prefetch/index.js'),
  'utf8',
)
// Exercise the installed dependency, including its pinned patch, without
// loading the browser-only virtual modules used by the other strategies.
const observerSource = implementation.slice(
  implementation.indexOf('function createViewportIntersectionObserver()'),
  implementation.indexOf('function initLoadStrategy()'),
)

let win: Window
beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/swift/latest/topics/' })
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.useRealTimers()
  await win.happyDOM.abort()
})

function viewport() {
  type Entry = { target: HTMLAnchorElement; isIntersecting: boolean }
  let callback: (entries: Entry[], observer: Observer) => void
  class Observer {
    unobserve = vi.fn()
    constructor(onIntersection: typeof callback) {
      callback = onIntersection
    }
  }
  const prefetch = vi.fn()
  const observer = runInNewContext(`${observerSource}\ncreateViewportIntersectionObserver()`, {
    IntersectionObserver: Observer,
    setTimeout,
    clearTimeout,
    prefetch,
  }) as Observer
  return {
    prefetch,
    observer,
    intersect: (target: HTMLAnchorElement, isIntersecting = true) => callback([{ target, isIntersecting }], observer),
  }
}

function link(href: string) {
  const anchor = win.document.createElement('a')
  anchor.href = href
  win.document.body.append(anchor)
  return anchor
}

describe('viewport prefetch across client navigation', () => {
  it('prefetches an attached link after its full viewport dwell', () => {
    const v = viewport(),
      anchor = link('architecture/?example=one#source-layout')
    v.intersect(anchor)
    vi.advanceTimersByTime(299)
    expect(v.prefetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(v.prefetch).toHaveBeenCalledExactlyOnceWith(
      'https://libtmux.org/en/swift/latest/topics/architecture/?example=one#source-layout',
    )
    expect(v.observer.unobserve).toHaveBeenCalledExactlyOnceWith(anchor)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['/en/swift/latest/topics/', 'architecture/', '/en/swift/latest/topics/architecture/'],
    ['/en/py/stable/api/', 'quickstart/', '/en/py/stable/api/internals/'],
    ['/pr-42/ja/tmux/topics/', '../concepts/', '/pr-42/ja/tmux/topics/architecture/'],
  ])('drops a removed relative link from %s before reading its rebased URL', (source, href, destination) => {
    win.history.replaceState(null, '', source)
    const v = viewport(),
      anchor = link(href),
      original = anchor.href
    v.intersect(anchor)
    anchor.remove()
    win.history.pushState(null, '', destination)
    expect(anchor.isConnected).toBe(false)
    expect(anchor.href).not.toBe(original)
    const hrefRead = vi.spyOn(anchor, 'href', 'get')
    vi.advanceTimersByTime(300)
    expect(hrefRead).not.toHaveBeenCalled()
    expect(v.prefetch).not.toHaveBeenCalled()
    expect(v.observer.unobserve).toHaveBeenCalledExactlyOnceWith(anchor)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a departed link and gives a returning link a new dwell', () => {
    const v = viewport(),
      anchor = link('architecture/')
    v.intersect(anchor)
    vi.advanceTimersByTime(150)
    v.intersect(anchor, false)
    vi.advanceTimersByTime(300)
    expect(v.prefetch).not.toHaveBeenCalled()
    expect(v.observer.unobserve).not.toHaveBeenCalled()
    v.intersect(anchor)
    vi.advanceTimersByTime(299)
    expect(v.prefetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(v.prefetch).toHaveBeenCalledExactlyOnceWith(anchor.href)
  })
})
