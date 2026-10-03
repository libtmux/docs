import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { installAnchorNavigation } from '../public/_shell/anchors.js'

const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.restoreAllMocks() })

function page(html: string, hash = '', fontsPending = false) {
  const win = new Window({ url: `https://libtmux.org/en/ts/latest/reference/${hash}` })
  win.document.body.innerHTML = html
  if (fontsPending) win.document.documentElement.classList.add('fonts-pending')
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
  const dispose = installAnchorNavigation(win as unknown as typeof window)
  disposals.push(dispose, () => { void win.happyDOM.abort() })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(0)) }
  const click = (id: string, options = {}) => win.document.getElementById(id)!.dispatchEvent(
    new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options }),
  )
  flush()
  return { win, doc: win.document, flush, click, scrolled, timers, dispose }
}

describe('shared anchor arrival', () => {
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
})
