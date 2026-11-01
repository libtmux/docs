/**
 * The workspace preset picker.
 *
 * The page renders every preset into one stack. Which one shows is a single
 * attribute on the picker, `data-selected`, so the stack is as tall as the
 * tallest preset from the first paint and choosing never moves what is below.
 * Nothing shows until the whole stack is parsed (`workspace-picker.css`).
 * A tiny script inside the picker sets the attribute while the page is still
 * being parsed, from `?preset=` or the last choice, and stylesheet rules keyed
 * on it (`selectionRules`) show the right preset and the right menu label
 * before anything is painted. The element then keeps the attribute, the menu
 * and the address in step.
 */

import { bindHomeHoverPreview } from './home-hover-preview'
import { HOVER_OPEN } from './status-toggletip'

export const STORAGE_PREFIX = 'libtmux-workspace-preset:'

/** The first candidate that names a preset on the page, or the first preset. */
export function resolvePreset(ids: readonly string[], ...candidates: (string | null | undefined)[]): string | undefined {
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && ids.includes(candidate)) ?? ids[0]
}

/**
 * A preset other than the current one, chosen at random.
 *
 * `random` is `Math.random` in the page. With a single preset there is nothing
 * to roll to, so the current one comes back.
 */
export function rollPreset(ids: readonly string[], current: string, random: () => number = Math.random): string {
  const others = ids.filter((id) => id !== current)
  if (!others.length) return current
  // A generator that returns 1 would index past the end.
  return others[Math.min(others.length - 1, Math.floor(random() * others.length))]!
}

/** Where a key moves in a row of options, or nothing when the key is not one that moves. */
export function stepIndex(count: number, current: number, key: string): number | undefined {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return undefined
}

/**
 * Where the slider's thumb sits for a strip that scrolls, or nothing when the
 * strip does not overflow. The thumb is as wide as the part of the strip that
 * shows, never narrower than `minThumb`, and its offset follows `scrollLeft`
 * across the room the track has left.
 */
export function thumbMetrics(scrollWidth: number, clientWidth: number, scrollLeft: number, trackWidth: number, minThumb = 24): { width: number; left: number } | undefined {
  const max = scrollWidth - clientWidth
  if (max <= 1 || trackWidth <= 0 || clientWidth <= 0) return undefined
  const width = Math.min(trackWidth, Math.max(minThumb, (trackWidth * clientWidth) / scrollWidth))
  return { width, left: (trackWidth - width) * Math.min(1, Math.max(0, scrollLeft / max)) }
}

/** The `scrollLeft` a thumb dragged `deltaX` pixels from where it was picked up stands for. */
export function scrollForThumb(deltaX: number, startScroll: number, scrollWidth: number, clientWidth: number, trackWidth: number, thumbWidth: number): number {
  const max = scrollWidth - clientWidth
  const room = trackWidth - thumbWidth
  if (max <= 0 || room <= 0) return startScroll
  return Math.min(max, Math.max(0, startScroll + (deltaX * max) / room))
}

/** The preset last chosen for a port, or nothing when storage is unavailable or empty. */
export function readStoredPreset(port: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${port}`)
  } catch {
    // Private windows and blocked site data throw here; the page shows its first preset.
    return null
  }
}

/** Remember a choice. Storage that refuses it loses only the memory. */
export function storePreset(port: string, id: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${port}`, id)
  } catch {
    // The choice still applies to this page.
  }
}

/** The page's address with `preset` set, keeping every other part. */
export function withPreset(url: string, id: string): string {
  const next = new URL(url)
  next.searchParams.set('preset', id)
  return `${next.pathname}${next.search}${next.hash}`
}

/**
 * The script that runs as the picker's first child, before the presets that
 * follow it are parsed. It does what `resolvePreset` and `readStoredPreset`
 * do, in the old syntax a bare inline script wants, and marks the picker.
 * Any failure leaves the picker unmarked, which shows the first preset.
 */
export function paintScript(port: string, ids: readonly string[]): string {
  return '(function(){try{'
    + `var ids=${JSON.stringify(ids)},q=new URLSearchParams(location.search).get("preset"),s=null;`
    + `try{s=localStorage.getItem(${JSON.stringify(`${STORAGE_PREFIX}${port}`)})}catch(e){}`
    + 'var id=ids.indexOf(q)>=0?q:ids.indexOf(s)>=0?s:ids[0];'
    + 'document.currentScript.parentElement.setAttribute("data-selected",id)'
    + '}catch(e){}})()'
}

/** An attribute value inside double quotes in a selector. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`

/**
 * The rules that show the selected preset and its menu label.
 *
 * One pair for each preset, because a stylesheet cannot compare an attribute
 * of the picker with an attribute of a panel. With no `data-selected` yet the
 * first preset shows, so a picker whose script never ran still shows one.
 */
export function selectionRules(ids: readonly string[]): string {
  const picker = 'html[data-js] libtmux-workspace-picker'
  const shown = 'visibility:visible'
  const rules = ids.map((id) => `${picker}[data-selected=${quoted(id)}] :is(.ws-picker__panel[data-preset=${quoted(id)}],.ws-picker__current>[data-for=${quoted(id)}]){${shown}}`)
  if (ids.length) rules.push(`${picker}:not([data-selected]) :is(.ws-picker__panel,.ws-picker__current>span):first-child{${shown}}`)
  return rules.join('\n')
}

/**
 * The scroll buttons and the slider of one panel's window tabs.
 *
 * They show only while the strip overflows: the start button once it has
 * scrolled, the end button while more remains, and the slider whenever it
 * overflows. All of them are drawn over the card, so showing them moves
 * nothing. The tabs keep their own keys, so the slider is for the pointer
 * alone and stays out of the accessibility tree. Returns a function that reads
 * the strip again.
 */
function scrollControls(panel: HTMLElement, strip: HTMLElement, tabs: HTMLElement[], signal: AbortSignal): () => void {
  const start = panel.querySelector<HTMLButtonElement>('[data-scroll="-1"]')
  const end = panel.querySelector<HTMLButtonElement>('[data-scroll="1"]')
  const slider = panel.querySelector<HTMLElement>('[data-slider]')
  const thumb = slider?.querySelector<HTMLElement>('[data-thumb]')
  if (!start || !end || !slider || !thumb) return () => {}

  const sync = () => {
    const max = strip.scrollWidth - strip.clientWidth
    const overflows = max > 1
    // A button that disappears under focus hands focus to the tab that is selected.
    const hide = (button: HTMLButtonElement, hidden: boolean) => {
      if (hidden && !button.hidden && button.ownerDocument.activeElement === button) tabs.find((tab) => tab.tabIndex === 0)?.focus({ preventScroll: true })
      button.hidden = hidden
    }
    hide(start, !overflows || strip.scrollLeft <= 1)
    hide(end, !overflows || strip.scrollLeft >= max - 1)
    slider.hidden = !overflows
    const metrics = overflows ? thumbMetrics(strip.scrollWidth, strip.clientWidth, strip.scrollLeft, slider.clientWidth) : undefined
    if (metrics) {
      thumb.style.width = `${metrics.width}px`
      thumb.style.transform = `translateX(${metrics.left}px)`
    }
  }
  const smooth = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
  strip.addEventListener('scroll', sync, { signal, passive: true })
  for (const button of [start, end]) {
    // About one tab: the width of the first, which no tab is much wider or narrower than.
    button.addEventListener('click', () => strip.scrollBy({ left: Number(button.dataset.scroll) * Math.max(80, tabs[0]?.offsetWidth ?? 0), behavior: smooth() }), { signal })
  }

  let drag: { x: number; scroll: number } | undefined
  thumb.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, scroll: strip.scrollLeft }
    thumb.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, { signal })
  thumb.addEventListener('pointermove', (event) => {
    if (!drag) return
    strip.scrollLeft = scrollForThumb(event.clientX - drag.x, drag.scroll, strip.scrollWidth, strip.clientWidth, slider.clientWidth, thumb.offsetWidth)
  }, { signal })
  for (const type of ['pointerup', 'pointercancel']) thumb.addEventListener(type, () => { drag = undefined }, { signal })
  // A press on the track beside the thumb pages toward it.
  slider.addEventListener('pointerdown', (event) => {
    if (event.target === thumb) return
    const at = thumb.getBoundingClientRect()
    strip.scrollBy({ left: (event.clientX < at.left ? -1 : 1) * strip.clientWidth * 0.8, behavior: smooth() })
  }, { signal })
  return sync
}

const TIP_CLOSE = 250

/**
 * Full window names for the tabs whose text the strip clips with an ellipsis.
 *
 * One `role="tooltip"` serves every tab. It opens on hover after the status
 * badges' delay and at once on keyboard focus, and only for a label that
 * overflows, so a name that fits gets nothing. While it is open the tab names
 * it in `aria-describedby`. It stays while the pointer is on the tab or the
 * tooltip or focus is on the tab (WCAG 1.4.13), and Escape closes it without
 * moving focus. The tab's own name is its full text; the ellipsis is only paint.
 */
function tabTips(tip: HTMLElement, tabs: HTMLElement[], signal: AbortSignal): void {
  let owner: HTMLElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let hovered: HTMLElement | undefined
  let dismissed: HTMLElement | undefined
  const label = (tab: HTMLElement) => tab.querySelector<HTMLElement>('.ws-layout__tab-label')
  const clipped = (tab: HTMLElement) => {
    const text = label(tab)
    return !!text && text.scrollWidth > text.clientWidth
  }
  const hide = () => {
    clearTimeout(timer)
    timer = undefined
    owner?.removeAttribute('aria-describedby')
    owner = undefined
    tip.hidden = true
  }
  const open = (tab: HTMLElement) => {
    clearTimeout(timer)
    timer = undefined
    if (owner !== tab) hide()
    if (dismissed === tab || !clipped(tab)) return
    owner = tab
    tip.textContent = label(tab)?.textContent ?? ''
    tip.hidden = false
    tip.style.left = '0px'
    tab.setAttribute('aria-describedby', tip.id)
    place(tab)
  }
  const place = (tab: HTMLElement) => {
    const at = tab.getBoundingClientRect()
    const width = document.documentElement.clientWidth
    tip.style.left = `${Math.max(8, Math.min(at.left, width - tip.offsetWidth - 8))}px`
    tip.style.top = `${at.bottom + 4}px`
  }
  const settle = (tab: HTMLElement) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (owner === tab && hovered !== tab && !tab.matches(':focus') && !tip.matches(':hover')) hide()
    }, TIP_CLOSE)
  }
  for (const tab of tabs) {
    tab.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return
      hovered = tab
      clearTimeout(timer)
      // Another tab's tooltip does not outlive the pointer's move to this one.
      if (owner && owner !== tab) hide()
      if (owner === tab) return
      timer = setTimeout(() => open(tab), HOVER_OPEN)
    }, { signal })
    tab.addEventListener('pointerleave', () => {
      if (hovered === tab) hovered = undefined
      if (dismissed === tab && !tab.matches(':focus')) dismissed = undefined
      if (owner === tab) settle(tab)
      else clearTimeout(timer)
    }, { signal })
    tab.addEventListener('focus', () => open(tab), { signal })
    tab.addEventListener('blur', () => {
      if (dismissed === tab) dismissed = undefined
      if (owner === tab && hovered !== tab) settle(tab)
    }, { signal })
  }
  tip.addEventListener('pointerenter', () => clearTimeout(timer), { signal })
  tip.addEventListener('pointerleave', () => { if (owner && hovered !== owner) settle(owner) }, { signal })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !owner) return
    event.preventDefault()
    event.stopPropagation()
    dismissed = owner
    hide()
  }, { signal, capture: true })
  document.addEventListener('scroll', (event) => {
    // The strip scrolls its tab into view when a key moves focus; the tooltip follows it.
    if (event.target instanceof Element && event.target.closest('[role="tablist"]')) {
      if (owner) place(owner)
      return
    }
    hide()
  }, { signal, capture: true })
  window.addEventListener('resize', hide, { signal })
  signal.addEventListener('abort', hide, { once: true })
}

/**
 * Register `<libtmux-workspace-picker>`.
 *
 * Its panels (`[data-preset]`) and menu options (`[data-preset-option]`) share
 * ids; `data-port` names the storage slot. The menu is the site's shared
 * `details` picker (`documentation-navigation.ts` opens it, filters it and
 * moves focus), so this only reacts to a choice. A `[data-action="roll"]`
 * button picks another preset at random. Inside a panel, `[role="tab"]` buttons
 * choose which `[data-window]` figure shows.
 */
export function defineWorkspacePicker(): void {
  if (typeof customElements === 'undefined' || customElements.get('libtmux-workspace-picker')) return
  class LibtmuxWorkspacePicker extends HTMLElement {
    private controller?: AbortController

    connectedCallback() {
      this.controller?.abort()
      this.controller = new AbortController()
      const { signal } = this.controller
      const panels = [...this.querySelectorAll<HTMLElement>('[data-preset]')]
      const options = [...this.querySelectorAll<HTMLAnchorElement>('[data-preset-option]')]
      const menu = this.querySelector<HTMLDetailsElement>('[data-preset-menu]')
      const summary = menu?.querySelector<HTMLElement>(':scope > summary')
      const announce = this.querySelector<HTMLElement>('[data-picker-announce]')
      const port = this.dataset.port ?? ''
      if (!panels.length) return
      const ids = panels.map((panel) => panel.dataset.preset ?? '')
      const titles = new Map(panels.map((panel) => [panel.dataset.preset ?? '', panel.getAttribute('aria-label') ?? '']))
      let current = ids[0]!

      // The stack and the menu label follow one attribute. A preview moves only this.
      const paint = (id: string) => {
        this.setAttribute('data-selected', id)
        // Hidden presets take no focus and no pointer, whatever their descendants' own styles say.
        for (const panel of panels) panel.inert = panel.dataset.preset !== id
      }
      const show = (id: string, say = false) => {
        current = id
        paint(id)
        for (const option of options) {
          const on = option.dataset.presetOption === id
          if (on) option.setAttribute('aria-current', 'true')
          else option.removeAttribute('aria-current')
          const check = option.querySelector<HTMLElement>('.doc-picker-check')
          if (check) check.hidden = !on
          option.href = withPreset(location.href, option.dataset.presetOption ?? id)
        }
        summary?.setAttribute('aria-label', `Preset: ${titles.get(id) ?? id}`)
        if (say && announce) announce.textContent = `Preset: ${titles.get(id) ?? id}`
      }
      const choose = (id: string) => {
        show(id, true)
        storePreset(port, id)
        try {
          history.replaceState(history.state, '', withPreset(location.href, id))
        } catch {
          // A sandboxed frame cannot rewrite its address; the choice still applies.
        }
      }
      show(resolvePreset(ids, new URLSearchParams(location.search).get('preset'), readStoredPreset(port)) ?? ids[0]!)

      // Hovering a row shows its preset after the home page's dwell. The choice, the check and the address stay.
      const preview = bindHomeHoverPreview({
        options,
        show: (option) => { if (menu?.open) paint(option.dataset.presetOption ?? current) },
        restore: () => paint(current),
        signal,
      })
      menu?.addEventListener('toggle', () => { if (!menu.open) preview.cancel() }, { signal })

      // Before the site's own navigation listener sees the link, as the task menu does.
      this.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('[data-preset-option]') : null
        if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        preview.commit()
        choose(link.dataset.presetOption!)
        if (menu) menu.open = false
        summary?.focus({ preventScroll: true })
      }, { capture: true, signal })
      this.querySelector('[data-action="roll"]')?.addEventListener('click', () => {
        preview.commit()
        choose(rollPreset(ids, current))
      }, { signal })

      // Window tabs: each panel picks its own window, and an arrow key moves between them.
      const syncs: (() => void)[] = []
      for (const panel of panels) {
        const strip = panel.querySelector<HTMLElement>('[role="tablist"]')
        const tabs = [...panel.querySelectorAll<HTMLElement>('[role="tab"]')]
        const windows = [...panel.querySelectorAll<HTMLElement>('[data-window]')]
        const pick = (index: number) => {
          tabs.forEach((tab, position) => {
            tab.setAttribute('aria-selected', String(position === index))
            tab.tabIndex = position === index ? 0 : -1
          })
          windows.forEach((figure, position) => {
            if (position === index) figure.setAttribute('data-active', '')
            else figure.removeAttribute('data-active')
          })
          // The strip scrolls, so a tab reached by key or click comes into view inside it.
          tabs[index]?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
        }
        tabs.forEach((tab, index) => tab.addEventListener('click', () => pick(index), { signal }))
        strip?.addEventListener('keydown', (event) => {
          const from = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
          const next = stepIndex(tabs.length, from, (event as KeyboardEvent).key)
          if (next === undefined) return
          event.preventDefault()
          pick(next)
          tabs[next]!.focus()
        }, { signal })
        if (strip) syncs.push(scrollControls(panel, strip, tabs, signal))
      }
      const tip = this.querySelector<HTMLElement>('[data-tab-tip]')
      if (tip) tabTips(tip, panels.flatMap((panel) => [...panel.querySelectorAll<HTMLElement>('[role="tab"]')]), signal)
      // A font or a resize changes what overflows, so every strip is read again.
      const syncAll = () => syncs.forEach((sync) => sync())
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(syncAll)
        for (const panel of panels) { const strip = panel.querySelector('[role="tablist"]'); if (strip) observer.observe(strip) }
        signal.addEventListener('abort', () => observer.disconnect())
      }
      void document.fonts?.ready.then(syncAll)
      syncAll()
    }

    disconnectedCallback() {
      this.controller?.abort()
    }
  }
  customElements.define('libtmux-workspace-picker', LibtmuxWorkspacePicker)
}
