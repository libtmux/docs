/**
 * The player of a recorded replay: the controls bar and the keys that step
 * through it, shared by the MCP worked example (`components/mcp/McpReplay.astro`)
 * and the Core API example (`components/core/CorePlayer.astro`).
 *
 * The player owns which step is current, the step a reader pinned, the step
 * under the pointer, and playing. A host draws what a step looks like, in its
 * `render`; the player draws the controls from `ReplayControls.astro`'s
 * markup: `[data-controls]` holding `[data-action]` buttons for play, back,
 * forward and fullscreen, one `[data-mark]` per step, `[data-fill]` and
 * `[data-count]`. Step `n` means the state after the `n`th call, and step 0
 * the state before the first.
 *
 * A player opens at rest (record 0081): it shows step 1 because nothing is
 * chosen yet, and the host highlights nothing. The reader's first stepping
 * action leaves rest. `bindPreview` adds the Hide preview and Show preview
 * buttons, which both hosts share.
 */

const REDUCED = '(prefers-reduced-motion: reduce)'

export interface ReplayState {
  /** Calls made so far. */
  step: number
  /** The step the host draws: what the pointer is over, else the pinned step, else the current one. */
  shown: number
  pinned: number | null
  playing: boolean
  /** The player rests: `shown` is only the step it infers, so the host highlights no line or turn. A pin or a preview under the pointer ends it for the moment. */
  rest: boolean
}

export interface ReplayOptions {
  /** How many steps there are now; a host whose steps change with a choice the reader makes calls `refresh`. */
  total: () => number
  /** Draw the state. `scroll` is true when a step has just been played and the host may scroll it into view. */
  render: (state: ReplayState, scroll: boolean) => void
  /** Whether a key pressed while `target` has focus belongs to the player; the body itself always does. */
  ownsKey?: (target: HTMLElement) => boolean
  /** The element that listens for keys, and that a reader tabs to. */
  body: HTMLElement
  /**
   * What the dot for `step` shows: the call, in code, and what it did. With
   * it, a dot under the pointer or focus shows a tooltip, and a pointer over
   * it previews that step as hovering the call's marker does.
   */
  tip?: (step: number) => { call?: string; text: string } | undefined
  /**
   * The pane a reader reads and selects in: the program, or the chat. An
   * autoplaying player pauses when a reader selects text in it, scrolls it or
   * touches it. Nothing in it changes the step; the host's own controls do.
   */
  content?: HTMLElement | null
  /** Play by itself once the player is on screen and still at rest. Off unless the instance opts in, and never under reduced motion. */
  autoplay?: boolean
  /**
   * Open at rest on step 1, which is shown but not chosen. Ignored for a reader who asked for less motion when
   * `reducedOpening` names another place for them, and when there is no step to rest on. A host that opens on a
   * step a link names leaves it off, so that player is not at rest and does not autoplay.
   */
  rest?: boolean
  /**
   * The step the markup is drawn at and the player opens on: 0 is the state
   * before the first call, `'end'` the last. A page the script has not bound
   * draws this step, so binding changes nothing on screen.
   */
  opening?: number | 'end'
  /** Where a reader who asked for less motion opens; `opening` by default. */
  reducedOpening?: number | 'end'
}

export interface ReplayPlayer {
  state: () => ReplayState
  /** Show the state after `step` calls and stop playing. */
  go: (step: number) => void
  /** Pin a step, or let go of it when it is pinned already. */
  togglePin: (step: number) => void
  hover: (step: number | null) => void
  clearPin: () => void
  /** Draw again, after `total` changed. */
  refresh: () => void
  /** Whether the reader asked for less motion. */
  reduced: boolean
  /** Whether the player is playing by itself, which a reader's selection, scroll or focus stops. */
  autoplaying: () => boolean
}

/**
 * Bind the controls inside `root`. Nothing is bound, and nothing returned, when
 * the page has no controls (a replay of requests only).
 */
export function bindReplay(root: HTMLElement, options: ReplayOptions): ReplayPlayer | undefined {
  const controls = root.querySelector<HTMLElement>('[data-controls]')
  if (!controls) return undefined
  const { body, render: draw } = options
  const play = root.querySelector<HTMLButtonElement>('[data-action="play"]')!
  const marks = [...root.querySelectorAll<HTMLElement>('[data-mark]')]
  const fill = root.querySelector<HTMLElement>('[data-fill]')!
  const count = root.querySelector<HTMLElement>('[data-count]')!
  const interval = Number(root.dataset.interval) || 1600
  const reduced = window.matchMedia?.(REDUCED).matches ?? false
  const total = () => options.total()

  const rail = root.querySelector<HTMLElement>('[data-rail]')
  const track = rail?.querySelector<HTMLElement>('[data-track]')
  const pages = [...(rail?.querySelectorAll<HTMLButtonElement>('[data-page]') ?? [])]
  const behavior = (): ScrollBehavior => (reduced ? 'auto' : 'smooth')
  // The dots outrun the track on a tight bar: it scrolls, its buttons page it, and the edges say which side has more.
  const edges = () => {
    if (!rail || !track) return
    const room = track.scrollWidth - track.clientWidth
    const more = [track.scrollLeft > 1 ? 'start' : '', track.scrollLeft < room - 1 ? 'end' : ''].filter(Boolean).join(' ')
    if (more) rail.dataset.more = more
    else delete rail.dataset.more
    rail.toggleAttribute('data-fits', room <= 1)
    pages.forEach((button) => { button.disabled = Number(button.dataset.page) < 0 ? track.scrollLeft <= 1 : track.scrollLeft >= room - 1 })
  }
  // The shown dot stays inside the track. The track's own scroll moves, never the page's.
  const keepInView = (smooth: boolean) => {
    const mark = marks.find((candidate) => candidate.getAttribute('aria-current') === 'step')
    if (!track || !mark) return
    const box = track.getBoundingClientRect()
    const dot = mark.getBoundingClientRect()
    const margin = 24 + dot.width
    if (dot.left >= box.left + margin && dot.right <= box.right - margin) return
    const left = track.scrollLeft + (dot.left + dot.width / 2) - (box.left + box.width / 2)
    track.scrollTo({ left: Math.max(0, left), behavior: smooth ? behavior() : 'auto' })
  }
  let railStep = -1

  const reducedStart = options.reducedOpening ?? options.opening ?? 0
  const opening = (reduced ? reducedStart : options.opening ?? 0)
  // At rest the shown step is the first one, inferred because the reader has chosen none.
  let rest = options.rest === true && total() > 0 && !(reduced && options.reducedOpening !== undefined)
  let step = rest ? 1 : opening === 'end' ? total() : Math.min(opening, total())
  let pinned: number | null = null
  let hover: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let playing = false
  // Once the reader has used a control, or has selected, scrolled or focused in, the replay does not start by itself.
  let touched = false
  // Set while the player plays because the instance asked for it; the reader's selection, scroll or focus ends it.
  let automatic = false

  const use = () => { touched = true; automatic = false; hover = null }
  const stop = () => { playing = false; automatic = false; if (timer) clearTimeout(timer); timer = undefined }
  const state = (): ReplayState => ({ step, shown: hover ?? pinned ?? step, pinned, playing, rest: rest && pinned === null && hover === null })

  function render(scroll = false) {
    const last = total()
    if (step > last) step = last
    if (pinned !== null && pinned > last) pinned = null
    if (last < 1) rest = false
    marks.forEach((mark) => {
      const position = Number(mark.dataset.mark)
      mark.hidden = position > last
      mark.style.left = `${(position / last) * 100}%`
      // At rest the step-1 mark is a hollow ring: shown, not yet reached.
      mark.classList.toggle('is-done', rest ? position < step : position <= step)
      mark.classList.toggle('is-rest', rest && position === step)
      if (position === step) mark.setAttribute('aria-current', 'step')
      else mark.removeAttribute('aria-current')
    })
    fill.style.width = `${rest ? 0 : (step / last) * 100}%`
    track?.style.setProperty('--mcp-count', String(last + 1))
    if (step !== railStep) { keepInView(railStep !== -1); railStep = step }
    edges()
    count.textContent = `${step}/${last}`
    const ended = step >= last && !rest
    play.setAttribute('aria-label', ended && !playing ? 'Replay' : playing ? 'Pause' : 'Play')
    // The button draws its icon from this state (see mcp-replay.css).
    play.dataset.state = playing ? 'pause' : ended ? 'replay' : 'play'
    draw(state(), scroll)
  }

  function tick() {
    timer = undefined
    if (!playing) return
    if (step >= total()) { stop(); render(); return }
    step += 1
    render(true)
    if (step >= total()) { stop(); render() } else timer = setTimeout(tick, interval)
  }
  // Play from rest highlights step 1 and plays on; from the end it plays again from before the first call.
  function start() {
    use()
    if (rest) rest = false
    else if (step >= total()) step = 0
    pinned = null
    playing = true
    render(true)
    timer = setTimeout(tick, interval)
  }
  function go(next: number) {
    use()
    stop()
    rest = false
    pinned = null
    step = Math.max(0, Math.min(total(), next))
    render(true)
  }
  function togglePin(frame: number) {
    use()
    stop()
    rest = false
    pinned = pinned === frame ? null : frame
    render()
  }

  root.setAttribute('data-live', '')
  controls.hidden = false
  const fullscreen = root.querySelector<HTMLElement>('[data-action="fullscreen"]')!
  if (!root.requestFullscreen) fullscreen.hidden = true

  play.addEventListener('click', () => { if (playing) { stop(); render() } else start() })
  root.querySelector('[data-action="back"]')!.addEventListener('click', () => go(step - 1))
  root.querySelector('[data-action="forward"]')!.addEventListener('click', () => go(step + 1))
  marks.forEach((mark) => mark.addEventListener('click', () => go(Number(mark.dataset.mark))))
  if (track) {
    track.addEventListener('scroll', edges, { passive: true })
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { edges(); keepInView(false) }).observe(track)
    pages.forEach((button) => button.addEventListener('click', () => {
      track.scrollBy({ left: Number(button.dataset.page) * track.clientWidth * 0.75, behavior: behavior() })
    }))
  }
  const tip = root.querySelector<HTMLElement>('[data-tip]')
  if (tip && options.tip) {
    const describe = options.tip
    // A touch screen fires mouseenter on a tap and never mouseleave, so only a pointer that can hover previews.
    const canHover = window.matchMedia?.('(hover: hover)').matches ?? true
    const show = (mark: HTMLElement) => {
      const content = describe(Number(mark.dataset.mark))
      if (!content) { tip.hidden = true; return }
      const call = document.createElement('code')
      call.textContent = content.call ?? ''
      const text = document.createElement('span')
      text.textContent = content.text
      tip.replaceChildren(...(content.call ? [call] : []), ...(content.text ? [text] : []))
      tip.hidden = false
      // Centred on the dot, and kept inside the rail's ends so a dot at either end keeps its tooltip on the page.
      const half = tip.offsetWidth / 2
      const box = tip.parentElement!.getBoundingClientRect()
      const dot = mark.getBoundingClientRect()
      tip.style.left = `${Math.max(half - 8, Math.min(box.width - half + 8, dot.left + dot.width / 2 - box.left))}px`
    }
    const hide = () => { tip.hidden = true }
    marks.forEach((mark) => {
      if (canHover) {
        mark.addEventListener('mouseenter', () => { show(mark); hover = Number(mark.dataset.mark); render() })
        mark.addEventListener('mouseleave', () => { hide(); hover = null; render() })
      }
      mark.addEventListener('focus', () => show(mark))
      mark.addEventListener('blur', hide)
    })
  }
  fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.requestFullscreen?.()
  })
  body.addEventListener('keydown', (event) => {
    // Leave the browser's own shortcuts, such as Alt+Left for back, alone, and keys meant for a result being scrolled.
    const target = event.target as HTMLElement
    if (target !== body && !options.ownsKey?.(target)) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'ArrowRight') { go(step + 1); event.preventDefault() }
    else if (event.key === 'ArrowLeft') { go(step - 1); event.preventDefault() }
    else if (event.key === 'Home') { go(0); event.preventDefault() }
    else if (event.key === 'End') { go(total()); event.preventDefault() }
    else if (event.key === 'Escape' && pinned !== null) { pinned = null; hover = null; render(); event.preventDefault() }
  })

  const player: ReplayPlayer = {
    state, go, togglePin, reduced,
    hover: (next) => { hover = next; render() },
    clearPin: () => { pinned = null; hover = null; render() },
    refresh: () => render(),
    autoplaying: () => automatic,
  }

  render()
  // A stepping player (the default) stays at rest until the reader acts. An autoplay player opts in, and a reader who asked for less motion never gets it.
  if (!options.autoplay || reduced) return player

  // A reader's first control, a selection in the content, a wheel or a touch there, or focus into the player ends autoplay for good, even before it has started.
  const halt = () => {
    touched = true
    if (!automatic) return
    stop()
    render()
  }
  const content = options.content
  // A pointer press on a control also focuses it. That focus is not the stop: the click that follows is the reader's control, and pressing Pause must leave it paused.
  let pressing = false
  const doc = root.ownerDocument
  root.addEventListener('pointerdown', () => { pressing = true }, true)
  for (const type of ['pointerup', 'pointercancel']) doc.addEventListener(type, () => { setTimeout(() => { pressing = false }, 0) }, true)
  root.addEventListener('focusin', (event) => { if (!(pressing && (event.target as HTMLElement).closest('[data-controls]'))) halt() })
  // A step control stops the run in its own handler; a button that steps nothing (Hide preview, copy, the rail's pages) ends autoplay here.
  root.addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('button')) halt() })
  for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown']) content?.addEventListener(type, halt, { passive: true })
  const selected = () => {
    const selection = doc.getSelection()
    if (!root.isConnected) { doc.removeEventListener('selectionchange', selected); return }
    if (content && selection && !selection.isCollapsed && content.contains(selection.anchorNode)) halt()
  }
  doc.addEventListener('selectionchange', selected)

  const begin = () => {
    // A hidden panel can still intersect the viewport; it plays when the reader sees it.
    const shown = root.checkVisibility?.({ visibilityProperty: true }) ?? true
    if (!shown || touched || playing || !rest) return
    automatic = true
    rest = false
    playing = true
    render(true)
    timer = setTimeout(tick, interval)
  }
  if (typeof IntersectionObserver === 'undefined') begin()
  else {
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { watcher.disconnect(); begin() }
    }, { threshold: 0.4 })
    watcher.observe(root)
  }
  return player
}

/**
 * The step a link names (`?step=3`), or undefined: the player then opens at rest. A link names one position, so it
 * counts only on a page with a single player of the host's kind (`selector`); with several there is no player it could mean.
 */
export function linkedStep(selector: string, doc: Document = document): number | undefined {
  if (doc.querySelectorAll(selector).length !== 1) return undefined
  const value = new URLSearchParams(doc.location.search).get('step')
  return value !== null && /^\d+$/.test(value) ? Number(value) : undefined
}

/** What the page remembers when storage throws (blocked, a private window, a full quota): the choice then holds until the page is left. */
const session = new Map<string, boolean>()
function hiddenBefore(key: string): boolean {
  try { return localStorage.getItem(key) === 'hidden' } catch { return session.get(key) ?? false }
}
function remember(key: string, hidden: boolean) {
  session.set(key, hidden)
  try {
    if (hidden) localStorage.setItem(key, 'hidden')
    else localStorage.removeItem(key)
  } catch { /* The choice still holds for this page. */ }
}

const ICON = (paths: string) => `<svg class="mcp-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
// A window with its right pane: shaded while the preview shows, empty while it is hidden.
const PANE_SHOWN = '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M10 2.75v10.5"/><path d="M10 3.5h2.75a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H10z" fill="currentColor" stroke="none" opacity=".4"/>'
const PANE_HIDDEN = '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5"/><path d="M10 2.75v10.5"/>'
let previews = 0

export interface PreviewOptions {
  /** Where the choice is kept: `libtmux-docs.core-player-preview` or `libtmux-docs.replay-preview`. `hidden` is stored; absent means shown. */
  key: string
  /** The column that folds away: the tmux and the result, or the tmux. It gets an id when it has none. */
  column: HTMLElement
  /** The row at the column's top end that holds Hide preview. The markup draws it empty, so adding the button moves nothing. */
  head: HTMLElement
  /** Where Show preview goes: before the code's copy button, or at the chat's top end. A button is added to each, ahead of `before` (or last), so the tab order follows the visual one. */
  places: { parent: HTMLElement; before?: Element | null }[]
  /** The class that places a Show preview button in its host. The controls' own class, `mcp-replay__button`, draws it, as it draws Hide preview. */
  showClass: string
}

/**
 * Hide preview (record 0081): the column folds away and the code or chat takes the full width at the same height. Both
 * buttons are drawn here, never in the markup, so a page without script has no dead button. The player root says
 * `data-preview-hidden` while the column is hidden. A stored choice is also on `<html>` before the first paint
 * (`ThemeScript.astro`), so a returning reader's page is drawn that way and nothing moves when this binds.
 */
export function bindPreview(root: HTMLElement, { key, column, head, places, showClass }: PreviewOptions) {
  const doc = root.ownerDocument
  if (!column.id) column.id = `replay-preview-${++previews}`
  const draw = (label: string, paths: string, className: string) => {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = className
    button.title = label
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-controls', column.id)
    button.innerHTML = ICON(paths)
    return button
  }
  const hide = draw('Hide preview', PANE_SHOWN, 'mcp-replay__button')
  head.append(hide)
  const shows = places.map(({ parent, before }) => { const button = draw('Show preview', PANE_HIDDEN, `mcp-replay__button ${showClass}`); parent.insertBefore(button, before ?? null); return button })
  const apply = (hidden: boolean) => {
    root.toggleAttribute('data-preview-hidden', hidden)
    for (const button of [hide, ...shows]) button.setAttribute('aria-expanded', String(!hidden))
  }
  // Focus follows the press: the pressed button is gone, and the other is the way back.
  const choose = (hidden: boolean) => {
    apply(hidden)
    remember(key, hidden)
    ;(hidden ? shows.find((show) => show.checkVisibility?.() ?? true) ?? shows[0] : hide)?.focus()
  }
  hide.addEventListener('click', () => choose(true))
  for (const show of shows) show.addEventListener('click', () => choose(false))
  apply(hiddenBefore(key))
}

/**
 * The screens of a `TmuxScreen` drawn with `client` inside `container`: a
 * button in a screen's status line, a window's label or another session's
 * name, shows that window there; `reset` shows every screen's client window
 * again, which the host calls when it moves to another call.
 */
export function bindClientViews(container: HTMLElement): { reset: () => void } {
  const show = (screen: HTMLElement, key: string) => {
    screen.querySelectorAll<HTMLElement>('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== key })
    // The status line holds the shown window's session and its windows, and names every other session at its end.
    screen.querySelectorAll<HTMLElement>('[data-session-windows]').forEach((group) => { group.hidden = !group.dataset.sessionWindows!.split(' ').includes(key) })
    screen.querySelectorAll<HTMLElement>('[data-session-switch]').forEach((other) => { other.hidden = other.dataset.sessionSwitch!.split(' ').includes(key) })
    screen.querySelectorAll<HTMLButtonElement>('.mcp-tmux__window[data-show]').forEach((button) => {
      button.classList.toggle('is-current', button.dataset.show === key)
      button.setAttribute('aria-pressed', String(button.dataset.show === key))
    })
    screen.classList.toggle('is-peeking', key !== screen.dataset.clientView)
  }
  container.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-show]')
    const screen = button?.closest<HTMLElement>('[data-client-view]')
    if (button?.dataset.show && screen) show(screen, button.dataset.show)
  })
  return { reset: () => container.querySelectorAll<HTMLElement>('[data-client-view]').forEach((screen) => show(screen, screen.dataset.clientView!)) }
}
