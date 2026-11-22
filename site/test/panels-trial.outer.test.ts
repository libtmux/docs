/**
 * The trial workspace's panels move like a twin's: a drag or Alt+Arrow on a header, a splitter that reports its share,
 * a Closed panels list, and a layout kept in storage that may be blocked. Outer loop: it mounts the real workspace in
 * a DOM, which renders every tier's markup.
 */
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SESSION_KEY, mountPanelWorkspace } from '../src/components/api/panels/panel-workspace'
import { mountPanelsTrial } from '../src/components/api/panels/trial-panels'
import { conceptIndex } from '../src/lib/panels/concepts'
import { leaves } from '../src/lib/panels/layout'

const ORIGIN = 'https://libtmux.org'
/** Dispatch an event of happy-dom's on one of its elements, which DOM's own types do not relate. */
const fire = (el: unknown, event: unknown) => (el as EventTarget).dispatchEvent(event as Event)

describe('the trial workspace shares the same movement', () => {
  const row = (port: string) => ({ port, publicId: `${port}.capture`, qualifiedName: `${port}.Pane.capture`, chips: [] as string[], kind: 'method' })
  const concepts = conceptIndex(
    [{ id: 'capture-pane', label: 'Read a pane', primary: 'go', summary: 'Capture text.', rows: [row('go'), row('py'), row('rs')], absent: {}, unmapped: [] }],
    [{ slug: 'go', name: 'Go', short: 'Go' }, { slug: 'py', name: 'Python', short: 'Py' }, { slug: 'rs', name: 'Rust', short: 'Rs' }],
  )
  let win: Window

  afterEach(() => {
    vi.unstubAllGlobals()
    win?.happyDOM.abort()
  })

  function mount(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void }, restore = true) {
    win = new Window({ url: `${ORIGIN}/en/go/latest/reference/trial/panels/` })
    win.document.body.innerHTML = '<main data-panels-trial><div data-viewport><div data-stage></div></div><p data-status></p><pre data-state></pre><div data-live></div></main>'
    vi.stubGlobal('document', win.document)
    vi.stubGlobal('window', win)
    const root = win.document.querySelector('[data-panels-trial]') as unknown as HTMLElement
    const handle = mountPanelWorkspace(root, { concepts, storage, restore, board: 't4' })
    const order = () => [...win.document.querySelectorAll('[data-region]')].map((el) => el.getAttribute('data-region'))
    const alt = (id: string, key: string) => {
      const head = win.document.querySelector(`[data-region] [data-head="${id}"]`) as unknown as HTMLElement
      head.focus()
      const e = new win.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true })
      fire(head, e)
      return e
    }
    return { root, handle, order, alt }
  }
  const memory = () => {
    const data = new Map<string, string>()
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }

  it('makes every header focusable and draggable, and every splitter a focusable separator with a value', () => {
    const w = mount(memory())
    expect(w.order()).toEqual(['p1', 'p2', 'p3', 'p4'])
    for (const head of win.document.querySelectorAll('[data-head]')) {
      expect(head.hasAttribute('data-draggable')).toBe(true)
      expect(head.getAttribute('tabindex')).toBe('0')
    }
    const separators = [...win.document.querySelectorAll('[role="separator"]')]
    expect(separators.length).toBeGreaterThan(0)
    for (const s of separators) expect(Number(s.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('moves a panel with Alt and an arrow key, keeps the layout, and finds it again on the next visit', () => {
    const storage = memory()
    const first = mount(storage)
    expect(first.alt('p1', 'ArrowRight').defaultPrevented).toBe(true)
    expect(first.order()).toEqual(['p2', 'p1', 'p3', 'p4'])
    first.handle.destroy()
    expect(leaves(JSON.parse(storage.data.get(SESSION_KEY)!).layoutTree)).toEqual(['p2', 'p1', 'p3', 'p4'])
    expect(mount(storage).order()).toEqual(['p2', 'p1', 'p3', 'p4'])
    expect(mount(storage, false).order()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('starts from the template when the saved session is not a whole layout', () => {
    const storage = memory()
    storage.data.set(SESSION_KEY, JSON.stringify({ name: 'x', panels: {}, layoutTree: { p: 'ghost' }, activePanelId: 'ghost', linkSets: {} }))
    expect(mount(storage).order()).toEqual(['p1', 'p2', 'p3', 'p4'])
    storage.data.set(SESSION_KEY, '{nope')
    expect(mount(storage).order()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('works for the visit when storage throws', () => {
    const w = mount(blocked)
    expect(w.order()).toEqual(['p1', 'p2', 'p3', 'p4'])
    w.alt('p1', 'ArrowRight')
    expect(w.order()).toEqual(['p2', 'p1', 'p3', 'p4'])
  })

  it('closes a panel from its menu and brings it back from the Closed panels list', () => {
    const w = mount(memory())
    ;(win.document.querySelector('[data-menu="p4"]') as unknown as HTMLElement).click()
    ;(win.document.querySelector('[data-act="close:p4"]') as unknown as HTMLElement).click()
    expect(w.order()).toEqual(['p1', 'p2', 'p3'])
    const closed = win.document.querySelector('[data-act="closed"]') as unknown as HTMLElement
    expect(closed.textContent).toBe('Closed panels (1)')
    closed.click()
    ;(win.document.querySelector('[data-act="reopen:p4"]') as unknown as HTMLElement).click()
    // It returns beside the active panel, not where it was.
    expect(w.order()).toEqual(['p1', 'p4', 'p2', 'p3'])
    expect(win.document.querySelector('[data-act="closed"]')).toBeNull()
  })

  it('keeps a closed panel in the list across visits', () => {
    const storage = memory()
    const first = mount(storage)
    ;(win.document.querySelector('[data-menu="p4"]') as unknown as HTMLElement).click()
    ;(win.document.querySelector('[data-act="close:p4"]') as unknown as HTMLElement).click()
    first.handle.destroy()
    const second = mount(storage)
    expect(second.order()).toEqual(['p1', 'p2', 'p3'])
    expect(win.document.querySelector('[data-act="closed"]')!.textContent).toBe('Closed panels (1)')
  })

  it('mounts the page once however often the router asks, so the Closed panels list opens on one click', () => {
    win = new Window({ url: `${ORIGIN}/en/go/latest/reference/trial/panels/?board=t4` })
    win.document.body.innerHTML = '<main data-panels-trial><div data-viewport><div data-stage></div></div><p data-status></p><pre data-state></pre><div data-live></div>' +
      `<script type="application/json" id="pw-concepts">${JSON.stringify({ list: concepts.list, ports: concepts.ports })}</script></main>`
    for (const [name, value] of Object.entries({ document: win.document, window: win, location: win.location, history: win.history, matchMedia: win.matchMedia.bind(win), localStorage: win.localStorage })) vi.stubGlobal(name, value)
    const root = win.document.querySelector('[data-panels-trial]') as unknown as HTMLElement
    mountPanelsTrial(root)
    mountPanelsTrial(root)
    ;(win.document.querySelector('[data-menu="p4"]') as unknown as HTMLElement).click()
    ;(win.document.querySelector('[data-act="close:p4"]') as unknown as HTMLElement).click()
    ;(win.document.querySelector('[data-act="closed"]') as unknown as HTMLElement).click()
    expect(win.document.querySelector('[role="menu"][aria-label="Closed panels"]')).not.toBeNull()
  })
})
