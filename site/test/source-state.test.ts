import { describe, expect, it } from 'vitest'
import {
  PANE_CLOSED, backEntry, closeAction, fromParam, paneMode, paneOpen, paneTop, parseLineFragment, pushEntry, rangeLabel,
  recordClose, recordOpen, restoreSlug, trailLabel, withSourceParam, type PaneEntry, type PaneHistory,
} from '../src/lib/source-state'

/** A browser's session history: a stack of entries and a position in it. */
class FakeHistory implements PaneHistory {
  entries: { state: unknown; url: string }[]
  index = 0
  constructor(url: string) { this.entries = [{ state: null, url }] }
  get state() { return this.entries[this.index]!.state }
  get url() { return this.entries[this.index]!.url }
  pushState(state: unknown, _unused: string, url: string) { this.entries.splice(this.index + 1); this.entries.push({ state, url }); this.index++ }
  replaceState(state: unknown, _unused: string, url: string) { this.entries[this.index] = { state, url } }
  back() { this.index = Math.max(0, this.index - 1) }
  forward() { this.index = Math.min(this.entries.length - 1, this.index + 1) }
}

const entry = (slug: string, title = slug): PaneEntry => ({ slug, title, kind: 'method', file: 'a.go', line: 5, from: 3, to: 9 })
const PAGE = '/en/go/latest/reference/tmux-pane-capture/?x=1#api-overview'

describe('line fragments and the from parameter', () => {
  it('reads a line or a range and nothing else', () => {
    expect(parseLineFragment('#L112-L129')).toEqual([112, 129])
    expect(parseLineFragment('#L7')).toEqual([7, 7])
    expect(parseLineFragment('L7-8')).toEqual([7, 8])
    for (const hash of ['', '#api-overview', '#L0', '#L9-L3', '#L1-L2-L3', '#Lx']) expect(parseLineFragment(hash), hash).toBeUndefined()
    expect([rangeLabel([112, 129]), rangeLabel([7, 7])]).toEqual(['Lines 112–129', 'Line 7'])
  })

  it('reads the slug a reader came from', () => {
    expect(fromParam('?from=tmux-pane-capture')).toBe('tmux-pane-capture')
    expect(fromParam('?from=')).toBeUndefined()
    expect(fromParam('')).toBeUndefined()
  })
})

describe('the pane trail', () => {
  it('pushes declarations, walks back and never empties itself', () => {
    let state = pushEntry(PANE_CLOSED, entry('capture', 'Capture'))
    expect(paneOpen(state)).toBe(true)
    state = pushEntry(state, entry('request', 'CapturePaneRequest'))
    expect(trailLabel(state)).toBe('Capture → CapturePaneRequest')
    expect(pushEntry(state, entry('request'))).toBe(state)
    state = backEntry(state)
    expect(paneTop(state)?.slug).toBe('capture')
    expect(backEntry(state)).toBe(state)
    expect(paneOpen(PANE_CLOSED)).toBe(false)
  })

  it('is a column from 72rem and an overlay below it', () => {
    expect([paneMode(71.99), paneMode(72), paneMode(90)]).toEqual(['overlay', 'column', 'column'])
  })
})

describe('?source= and the history', () => {
  it('sets and removes the parameter and keeps the rest of the address', () => {
    expect(withSourceParam(PAGE, 'tmux-pane-capture')).toBe('/en/go/latest/reference/tmux-pane-capture/?x=1&source=tmux-pane-capture#api-overview')
    expect(withSourceParam(withSourceParam(PAGE, 'a'), undefined)).toBe('/en/go/latest/reference/tmux-pane-capture/?x=1#api-overview')
  })

  it('pushes an entry on open, so the browser Back closes the pane', () => {
    const history = new FakeHistory(PAGE)
    recordOpen(history, history.url, 'capture', false)
    expect(history.entries).toHaveLength(2)
    expect(history.url).toContain('source=capture')
    expect(restoreSlug('?source=capture', history.state)).toBe('capture')
    history.back()
    expect(history.url).toBe(PAGE)
    expect(restoreSlug('', history.state)).toBeUndefined()
    history.forward()
    expect(restoreSlug('?source=capture', history.state)).toBe('capture')
  })

  it('replaces the entry when a declaration opens inside an open pane, so one Back still closes it', () => {
    const history = new FakeHistory(PAGE)
    recordOpen(history, history.url, 'capture', false)
    recordOpen(history, history.url, 'request', true)
    expect(history.entries).toHaveLength(2)
    expect(restoreSlug('?source=request', history.state)).toBe('request')
    expect(closeAction(history.state)).toBe('back')
    history.back()
    expect(history.url).toBe(PAGE)
  })

  it('restores a reload from the address alone, and closes it in place because no entry was pushed', () => {
    const history = new FakeHistory('/reference/x/?source=capture')
    expect(restoreSlug(history.url.slice(history.url.indexOf('?')), history.state)).toBe('capture')
    expect(closeAction(history.state)).toBe('replace')
    recordClose(history, history.url)
    expect(history.entries).toHaveLength(1)
    expect(history.url).toBe('/reference/x/')
  })

  it('keeps other widgets\' history state', () => {
    const history = new FakeHistory(PAGE)
    history.replaceState({ libtmuxApiTree: { open: ['a'] } }, '', PAGE)
    recordOpen(history, history.url, 'capture', false)
    expect(history.state).toMatchObject({ libtmuxApiTree: { open: ['a'] }, libtmuxSourcePane: { slug: 'capture' } })
  })
})
