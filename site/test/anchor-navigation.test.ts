import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { readFileSync } from 'node:fs'
import { installAnchorNavigation } from '../public/_shell/anchors.js'

const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks() })

function page(html: string, hash = '', fontsPending = false, hintsPending = false, startup?: { state?: unknown; navigation?: string }, coordinated = false) {
  const win = new Window({ url: `https://libtmux.org/en/ts/latest/reference/${hash}` })
  win.document.body.innerHTML = html
  if (startup) {
    win.history.replaceState(startup.state ?? null, '')
    vi.spyOn(win.performance, 'getEntriesByType').mockReturnValue([{ type: startup.navigation ?? 'reload' }] as unknown as ReturnType<typeof win.performance.getEntriesByType>)
    const shell = readFileSync(new URL('../src/components/ShellHead.astro', import.meta.url), 'utf8')
    win.eval(shell.match(/<script is:inline data-anchor-startup>([\s\S]*?)<\/script>/)?.[1] ?? '')
    if (win.history.state === null) win.history.replaceState({ index: 0, scrollX: 0, scrollY: 0 }, '')
  }
  if (fontsPending) win.document.documentElement.classList.add('fonts-pending')
  if (hintsPending) win.document.documentElement.classList.add('link-hints-pending')
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, () => void>()
  let sequence = 0
  vi.spyOn(win, 'requestAnimationFrame').mockImplementation((fn) => {
    frames.set(++sequence, fn)
    return sequence as unknown as ReturnType<typeof win.requestAnimationFrame>
  })
  vi.spyOn(win, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(Number(id)) })
  vi.spyOn(win, 'setTimeout').mockImplementation((fn) => {
    timers.set(++sequence, fn as () => void)
    return sequence as unknown as ReturnType<typeof win.setTimeout>
  })
  vi.spyOn(win, 'clearTimeout').mockImplementation((id) => { timers.delete(Number(id)) })
  vi.spyOn(win.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(0, 200, 100, 30))
  const scrolled: { id: string; collapsed: number }[] = []
  win.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push({ id: this.id, collapsed: win.document.querySelectorAll('details:not([open])').length })
  }
  const layouts: (() => void)[] = []
  if (coordinated) Object.assign(win, { __libtmuxAppearance: {
    wait: () => {}, layout: (work: () => void) => layouts.push(work),
  } })
  const dispose = installAnchorNavigation(win as unknown as typeof window)
  disposals.push(dispose, () => { void win.happyDOM.abort() })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0)) }
  const click = (id: string, options = {}) => win.document.getElementById(id)!.dispatchEvent(
    new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }),
  )
  flush()
  const preparePass = () => layouts.splice(0).forEach((work) => work())
  const prepare = () => {
    for (let pass = 0; layouts.length; pass++) {
      expect(pass).toBeLessThan(3)
      preparePass()
    }
  }
  return { win, doc: win.document, flush, click, scrolled, timers, dispose, prepare, preparePass }
}

describe('shared anchor arrival', () => {
  it('prepares an unowned initial disclosure and starts its full cue after reveal', () => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true, true, {}, true)
    expect(p.scrolled).toEqual([])
    p.prepare()
    expect(p.doc.querySelector('details')?.open).toBe(true)
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
    expect(p.timers.size).toBe(0)
    p.doc.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
    p.doc.dispatchEvent(new p.win.CustomEvent('libtmux:page-ready'))
    expect(p.win.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2600)
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'PageDown', 'Tab'])('does not recover cancelled startup scrolling during appearance layout: %s', (input) => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true, true, {}, true)
    p.doc.dispatchEvent(['PageDown', 'Tab'].includes(input)
      ? new p.win.KeyboardEvent('keydown', { key: input, bubbles: true })
      : new p.win.Event(input, { bubbles: true }))
    p.prepare()
    expect(p.doc.querySelector('details')?.open).toBe(true)
    expect(p.scrolled).toEqual([])
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
    // Explicit subsequent intent still scrolls after the same cancellation.
    p.doc.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
    p.doc.dispatchEvent(new p.win.CustomEvent('libtmux:anchor-arrival', { detail: { id: 'server' } }))
    p.flush()
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
  })

  it.each([
    { state: { index: 1, scrollX: 0, scrollY: 480 } },
    { state: { index: 1, scrollX: 0, scrollY: 0 } },
    { navigation: 'back_forward' },
  ])('preserves a restored reading position during coordinated initial layout: %j', (startup) => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true, true, startup, true)
    const state = p.win.history.state
    p.prepare()
    expect(p.doc.querySelector('details')?.open).toBe(true)
    expect(p.scrolled).toEqual([])
    expect(p.win.history.state).toEqual(state)
  })

  it('does not reinterpret a changed fragment as pending initial intent', () => {
    const p = page('<h2 id="server">Server</h2><h2 id="other">Other</h2>', '#server', true, true, {}, true)
    p.win.history.replaceState(null, '', '#other')
    p.prepare()
    expect(p.scrolled).toEqual([])
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.win.location.hash).toBe('#other')
  })

  it('leaves a stale fragment alone after reader input and passive appearance work', () => {
    const p = page('<h2 id="server">Server</h2>', '#server', true, true, {}, true)
    p.doc.dispatchEvent(new p.win.Event('wheel', { bubbles: true }))
    p.prepare()
    p.win.dispatchEvent(new p.win.Event('resize'))
    p.win.dispatchEvent(new p.win.Event('scroll'))
    p.flush()
    expect(p.scrolled).toEqual([])
    expect(p.win.location.hash).toBe('#server')
  })

  it('makes retained appearance callbacks inert after anchor cleanup', () => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true, true, {}, true)
    p.dispose()
    p.prepare()
    expect(p.doc.querySelector('details')?.open).toBe(false)
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.scrolled).toEqual([])
    expect(p.timers.size).toBe(0)
  })

  it('rechecks cleanup between native preparation and initial measurement', () => {
    const p = page('<h2 id="server">Server</h2>', '#server', true, true, {}, true)
    p.preparePass()
    expect(p.scrolled).toEqual([])
    p.dispose()
    p.preparePass()
    expect(p.scrolled).toEqual([])
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
  })

  it('recovers an initially unowned fragment after the router seeds its startup position', () => {
    const p = page('<h2 id="server">Server</h2>', '#server', false, false, {})
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
    expect(p.win.history.state).toEqual({ index: 0, scrollX: 0, scrollY: 0 })
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
    p.dispose()
    disposals.push(installAnchorNavigation(p.win as unknown as typeof window))
    p.flush()
    expect(p.scrolled).toHaveLength(1)
  })

  it('keeps the initial unowned arrival through bootstrap replacement and both visibility gates', async () => {
    const p = page('<h2 id="server">Server</h2>', '#server', true, true, {})
    expect(p.scrolled).toEqual([])
    expect(p.doc.documentElement.getAttribute('data-anchor-startup')).toBe(p.win.location.href)
    p.dispose()
    disposals.push(installAnchorNavigation(p.win as unknown as typeof window))
    p.flush()
    p.doc.documentElement.classList.remove('fonts-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.scrolled).toEqual([])
    p.doc.documentElement.classList.remove('link-hints-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
  })

  it.each([
    { state: { index: 1, scrollX: 0, scrollY: 480 } },
    { state: { index: 1, scrollX: 0, scrollY: 0 } },
    { navigation: 'back_forward' },
  ])('leaves owned or traversed reading positions to normal history: %j', (startup) => {
    const p = page('<h2 id="server">Server</h2>', '#server', false, false, startup)
    expect(p.scrolled).toEqual([])
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'PageDown'])('cancels only the pending initial arrival after reader input: %s', async (input) => {
    const p = page('<h2 id="server">Server</h2>', '#server', true, true, {})
    p.doc.dispatchEvent(input === 'PageDown'
      ? new p.win.KeyboardEvent('keydown', { key: input, bubbles: true })
      : new p.win.Event(input, { bubbles: true }))
    p.doc.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.scrolled).toEqual([])
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
  })

  it('retains an initial arrival after a key that does not scroll', async () => {
    const p = page('<h2 id="server">Server</h2>', '#server', true, false, {})
    p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    p.doc.documentElement.classList.remove('fonts-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
  })

  it('discards a pending startup destination when the fragment changes', async () => {
    const p = page('<h2 id="server">Server</h2><h2 id="other">Other</h2>', '#server', true, false, {})
    p.win.location.hash = '#other'
    p.win.dispatchEvent(new p.win.HashChangeEvent('hashchange')); p.flush()
    expect(p.doc.documentElement.hasAttribute('data-anchor-startup')).toBe(false)
    p.doc.documentElement.classList.remove('fonts-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    p.win.location.hash = '#server'
    p.win.dispatchEvent(new p.win.HashChangeEvent('hashchange')); p.flush()
    expect(p.scrolled).toEqual([])
  })

  it('opens every containing disclosure before scrolling and highlights its summary', () => {
    const p = page('<details><summary>Outer</summary><details id="server"><summary id="server-label">Server</summary>Members</details></details>', '#server')
    expect(p.doc.querySelectorAll('details[open]')).toHaveLength(2)
    expect(p.scrolled).toEqual([{ id: 'server-label', collapsed: 0 }])
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('server-label')
  })

  it('highlights headings, API objects, and table rows without replacing navigation or focus', () => {
    const p = page('<input id="editor"><h2 id="overview">Overview</h2><dl><dt id="LibTmux.Server">Server</dt><dd>Behavior</dd></dl><table><tr id="options-json"><td>--json</td></tr></table>', '#overview')
    p.doc.querySelector('input')!.focus()
    for (const id of ['LibTmux.Server', 'options-json']) {
      p.win.location.hash = encodeURIComponent(id)
      p.win.dispatchEvent(new p.win.HashChangeEvent('hashchange'))
      p.flush()
      expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe(id)
      expect(p.doc.querySelectorAll('[data-anchor-arrival]')).toHaveLength(1)
      expect(p.doc.activeElement?.id).toBe('editor')
    }
    expect(p.scrolled).toEqual([])
  })

  it('restarts the cue for an explicitly followed current fragment and then clears it', () => {
    const p = page('<a id="again" href="#overview">Overview</a><h2 id="overview">Overview</h2>', '#overview')
    const firstTimer = [...p.timers.keys()][0]
    p.click('again')
    p.flush()
    expect(p.scrolled).toEqual([{ id: 'overview', collapsed: 0 }])
    expect(p.timers.has(firstTimer)).toBe(false)
    expect(p.doc.getElementById('overview')!.hasAttribute('data-anchor-arrival')).toBe(true)
    for (const callback of [...p.timers.values()]) callback()
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
  })

  it('paints a visible heading for an alias instead of its zero-size anchor', () => {
    const p = page('<h2 id="capture-options"><span class="section-anchor-alias" id="options"></span>Options</h2>', '#options')
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('capture-options')
  })

  it('restarts a current-fragment link handled by the client router', () => {
    const p = page('<a id="again" href="#overview">Overview</a><h2 id="overview">Overview</h2>', '#overview')
    for (const callback of [...p.timers.values()]) callback()
    // A router suppresses native navigation after updating history itself.
    p.win.addEventListener('click', (event) => {
      event.preventDefault()
      p.win.history.replaceState(null, '', '#overview')
    }, { capture: true })
    p.click('again')
    p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('overview')
    expect(p.scrolled).toEqual([{ id: 'overview', collapsed: 0 }])
  })

  it('opens disclosures immediately but starts the cue after the font gate reveals the page', async () => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true)
    expect(p.doc.querySelector('details')?.open).toBe(true)
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.timers.size).toBe(0)
    p.doc.documentElement.classList.remove('fonts-pending')
    await p.win.happyDOM.waitUntilComplete()
    p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('server')
    expect(p.timers.size).toBe(1)
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
  })

  it.each(['fonts-pending', 'link-hints-pending'])('waits for both visibility gates when %s finishes first', async (first) => {
    const p = page('<details><summary>API</summary><h2 id="server">Server</h2></details>', '#server', true, true)
    expect(p.doc.querySelector('details')?.open).toBe(true)
    expect(p.timers.size).toBe(0)
    p.doc.documentElement.classList.remove(first)
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.timers.size).toBe(0)
    p.doc.documentElement.classList.remove('fonts-pending', 'link-hints-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('server')
    expect(p.win.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2600)
    expect(p.scrolled).toEqual([{ id: 'server', collapsed: 0 }])
  })

  it.each([false, true])('starts a full cue after the link gate releases, including suppressed icons: %s', async (suppressed) => {
    const p = page('<h2 id="server">Server</h2>', '#server', false, true)
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.timers.size).toBe(0)
    p.doc.documentElement.classList.toggle('link-hints-suppressed', suppressed)
    p.doc.documentElement.classList.remove('link-hints-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('server')
    expect(p.win.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2600)
  })

  it('disconnects a pending link-gate observer when the page is replaced', async () => {
    const p = page('<h2 id="server">Server</h2>', '#server', false, true)
    p.dispose()
    p.doc.documentElement.classList.remove('link-hints-pending')
    await p.win.happyDOM.waitUntilComplete(); p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    expect(p.timers.size).toBe(0)
  })

  it('ignores malformed fragments, other destinations, modified clicks and downloads', () => {
    const p = page('<h2 id="target">Target</h2><a id="external" href="https://example.com/#target">External</a><a id="other" href="../other/#target">Other</a><a id="modified" href="#target">Modified</a><a id="download" href="#target" download>Download</a>', '#%E0%A4')
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    p.click('external'); p.click('other'); p.click('modified', { ctrlKey: true }); p.click('download')
    p.flush()
    expect(p.scrolled).toEqual([])
  })

  it('supports a programmatic destination and removes listeners when a page is replaced', () => {
    const p = page('<section id="examples"><h2 id="examples-heading">Examples</h2></section>')
    p.doc.dispatchEvent(new p.win.CustomEvent('libtmux:anchor-arrival', { detail: { id: 'examples' } }))
    p.flush()
    expect(p.doc.querySelector('[data-anchor-arrival]')?.id).toBe('examples-heading')
    p.dispose()
    expect(p.doc.querySelector('[data-anchor-arrival]')).toBeNull()
    p.doc.dispatchEvent(new p.win.CustomEvent('libtmux:anchor-arrival', { detail: { id: 'examples' } }))
    p.flush()
    expect(p.scrolled).toHaveLength(1)
  })

  it.each(['../other/#target', '?view=other#target'])('loads an unowned history destination when the old page remains mounted: %s', (destination) => {
    const p = page('<h2 id="target">Target</h2>')
    const reload = vi.spyOn(p.win.location, 'reload').mockImplementation(() => {})
    p.win.history.replaceState(null, '', destination)
    p.win.dispatchEvent(new p.win.PopStateEvent('popstate', { state: null }))
    expect(reload).toHaveBeenCalledOnce()
    expect(p.win.history.state).toBeNull()
  })

  it('leaves native same-page fragments and router-owned history to their normal navigation', () => {
    const p = page('<h2 id="target">Target</h2>')
    const reload = vi.spyOn(p.win.location, 'reload').mockImplementation(() => {})
    p.win.history.replaceState(null, '', '#target')
    p.win.dispatchEvent(new p.win.PopStateEvent('popstate', { state: null }))
    p.win.history.replaceState({ index: 1 }, '', '../other/')
    p.win.dispatchEvent(new p.win.PopStateEvent('popstate', { state: { index: 1 } }))
    expect(reload).not.toHaveBeenCalled()
  })

  it('stops history fallback when the mounted page is replaced', () => {
    const p = page('<h2 id="target">Target</h2>')
    const reload = vi.spyOn(p.win.location, 'reload').mockImplementation(() => {})
    p.dispose()
    p.win.history.replaceState(null, '', '../other/')
    p.win.dispatchEvent(new p.win.PopStateEvent('popstate', { state: null }))
    expect(reload).not.toHaveBeenCalled()
  })
})
