/**
 * What every panel workspace does with a pointer or a key, over markup it does not own.
 *
 * A panel is a `[data-region]`; its header is `[data-head]`, draggable when it has `data-draggable`; a splitter is
 * `[data-splitter="<split>:<index>"]` between two `.pw__cell`s. The workspace says what a move or a nudge does to its
 * own state, and this module reads the geometry, draws the drop target and handles the keys, so the trial and a panel
 * twin cannot drift apart.
 */
import { grow, resizePair, type Arrow, type Dock, type ViewSplit } from '../../../lib/panels/layout'
import { MIN_COL } from '../../../lib/panels/tiers'

/** A side to dock to, or `swap` for the middle of a panel, which exchanges places. */
export type Drop = Dock | 'swap'

export interface DockHooks {
  move(id: string, target: string, zone: Drop): void
  nudge(id: string, arrow: Arrow): void
}

/** The fraction of a panel's width or height, from each edge, that docks instead of swapping. */
const EDGE = 0.28
const DRAG_START = 6
const ARROWS: Record<string, Arrow> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** Where in a panel a pointer is: the nearest edge inside the edge band, else the middle. */
export function dropZone(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): Drop {
  const fx = (x - rect.left) / rect.width
  const fy = (y - rect.top) / rect.height
  const edges: [Dock, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]]
  const [zone, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a))
  return distance < EDGE ? zone : 'swap'
}

/** The part of a panel a drop would fill, in the same coordinates as `rect`. */
export function dropRect(rect: { left: number; top: number; width: number; height: number }, zone: Drop) {
  const { left, top, width, height } = rect
  if (zone === 'left') return { left, top, width: width / 2, height }
  if (zone === 'right') return { left: left + width / 2, top, width: width / 2, height }
  if (zone === 'top') return { left, top, width, height: height / 2 }
  if (zone === 'bottom') return { left, top: top + height / 2, width, height: height / 2 }
  return { left, top, width, height }
}

/** Drag a header to dock or swap a panel, and move a focused header with Alt and an arrow key. Returns a detach function. */
export function attachDock(root: HTMLElement, hooks: DockHooks): () => void {
  interface Drag { id: string; label: string; x: number; y: number; fx?: HTMLElement; ghost?: HTMLElement; zone?: HTMLElement; pick?: { target: string; zone: Drop } }
  let drag: Drag | null = null

  const finish = () => {
    drag?.fx?.remove()
    document.body.classList.remove('pw-dragging')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', finish)
    document.removeEventListener('keydown', esc, true)
    drag = null
  }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish() } }

  function begin(d: Drag) {
    d.fx = document.createElement('div')
    d.fx.className = 'pw__dragfx'
    d.ghost = Object.assign(document.createElement('div'), { className: 'pw__ghost', textContent: d.label })
    d.zone = Object.assign(document.createElement('div'), { className: 'pw__dropzone', hidden: true })
    d.fx.append(d.zone, d.ghost)
    document.body.append(d.fx)
    document.body.classList.add('pw-dragging')
  }

  function move(e: PointerEvent) {
    if (!drag) return
    if (!drag.fx) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_START) return
      begin(drag)
    }
    drag.ghost!.style.left = `${e.clientX + 12}px`
    drag.ghost!.style.top = `${e.clientY + 12}px`
    const region = document.elementsFromPoint(e.clientX, e.clientY)
      .map((el) => el.closest<HTMLElement>('[data-region]'))
      .find((el) => el && root.contains(el) && el.dataset.region !== drag!.id)
    if (!region) { drag.pick = undefined; drag.zone!.hidden = true; return }
    const rect = region.getBoundingClientRect()
    const zone = dropZone(rect, e.clientX, e.clientY)
    drag.pick = { target: region.dataset.region!, zone }
    const box = dropRect(rect, zone)
    Object.assign(drag.zone!.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
    drag.zone!.dataset.zone = zone
    drag.zone!.hidden = false
  }

  function up() {
    const done = drag
    finish()
    if (done?.pick) hooks.move(done.id, done.pick.target, done.pick.zone)
  }

  const down = (e: PointerEvent) => {
    const t = e.target as Element
    const head = t.closest<HTMLElement>('[data-head][data-draggable]')
    if (e.button !== 0 || !head || !root.contains(head) || t.closest('button, a, input, select, textarea')) return
    if (drag) finish()
    drag = { id: head.dataset.head!, label: head.querySelector('.pw__title')?.textContent ?? head.dataset.head!, x: e.clientX, y: e.clientY }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', finish)
    document.addEventListener('keydown', esc, true)
  }

  // Capture, so a header's Alt+Arrow moves the panel before any other Alt+Arrow meaning (history) sees it.
  const key = (e: KeyboardEvent) => {
    const arrow = ARROWS[e.key]
    if (!arrow || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const head = (e.target as Element).closest<HTMLElement>('[data-head]')
    if (!head || !root.contains(head)) return
    e.preventDefault()
    e.stopPropagation()
    hooks.nudge(head.dataset.head!, arrow)
  }

  root.addEventListener('pointerdown', down)
  root.addEventListener('keydown', key, true)
  return () => { finish(); root.removeEventListener('pointerdown', down); root.removeEventListener('keydown', key, true) }
}

export interface SplitHooks {
  /** The visible split a splitter's first number names. */
  split(k: number): ViewSplit | undefined
  /** The CSS zoom of the surface, 1 when it has none. */
  scale(): number
  /** The sizes changed for good: a drag ended, or a key moved a splitter. The workspace saves, and may redraw after a drag. */
  commit(via: 'pointer' | 'key'): void
}

const NUDGE = 0.05

/** Resize by dragging a splitter or with arrow keys, Home and End, and report the share as `aria-valuenow`. Returns a detach function. */
export function attachSplitters(root: HTMLElement, hooks: SplitHooks): () => void {
  const parts = (spl: HTMLElement) => {
    const [k, i] = spl.dataset.splitter!.split(':').map(Number) as [number, number]
    const n = hooks.split(k)
    const cells = Array.from(spl.parentElement!.children).filter((c) => c.classList.contains('pw__cell')) as HTMLElement[]
    return n && cells[i] && cells[i + 1] ? { n, i, cells } : null
  }

  function setPair(spl: HTMLElement, ratio: number) {
    const p = parts(spl)
    if (!p) return
    const { n, i, cells } = p
    const row = n.dir === 'row'
    const a = cells[i]!.getBoundingClientRect()
    const b = cells[i + 1]!.getBoundingClientRect()
    const r = resizePair(n, i, ratio, (row ? a.width + b.width : a.height + b.height) / hooks.scale(), row ? MIN_COL : 140)
    const g = grow(n.sizes)
    cells[i]!.style.flexGrow = String(g[i])
    cells[i + 1]!.style.flexGrow = String(g[i + 1])
    spl.setAttribute('aria-valuenow', String(Math.round(r * 100)))
  }

  const down = (e: PointerEvent) => {
    const spl = (e.target as Element).closest<HTMLElement>('[data-splitter]')
    const p = spl && root.contains(spl) ? parts(spl) : null
    if (!spl || !p) return
    e.preventDefault()
    spl.setPointerCapture(e.pointerId)
    const track = (ev: PointerEvent) => {
      const r1 = p.cells[p.i]!.getBoundingClientRect()
      const r2 = p.cells[p.i + 1]!.getBoundingClientRect()
      setPair(spl, p.n.dir === 'row' ? (ev.clientX - r1.left) / (r2.right - r1.left) : (ev.clientY - r1.top) / (r2.bottom - r1.top))
    }
    const end = () => { spl.removeEventListener('pointermove', track); spl.removeEventListener('pointerup', end); hooks.commit('pointer') }
    spl.addEventListener('pointermove', track)
    spl.addEventListener('pointerup', end)
  }

  const key = (e: KeyboardEvent) => {
    const spl = (e.target as Element).closest<HTMLElement>('[data-splitter]')
    const p = spl && root.contains(spl) ? parts(spl) : null
    if (!spl || !p || e.altKey || e.ctrlKey || e.metaKey) return
    const share = p.n.sizes[p.i]! / (p.n.sizes[p.i]! + p.n.sizes[p.i + 1]!)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? share + NUDGE
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? share - NUDGE
        : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : undefined
    if (next === undefined) return
    e.preventDefault()
    setPair(spl, next)
    hooks.commit('key')
  }

  root.addEventListener('pointerdown', down)
  root.addEventListener('keydown', key)
  return () => { root.removeEventListener('pointerdown', down); root.removeEventListener('keydown', key) }
}
