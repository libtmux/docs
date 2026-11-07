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
 */

const REDUCED = '(prefers-reduced-motion: reduce)'

export interface ReplayState {
  /** Calls made so far. */
  step: number
  /** The step the host draws: what the pointer is over, else the pinned step, else the current one. */
  shown: number
  pinned: number | null
  playing: boolean
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
   * it previews that step as hovering the call's code does.
   */
  tip?: (step: number) => { call?: string; text: string } | undefined
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

  let step = total()
  let pinned: number | null = null
  let hover: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let playing = false
  // Once the reader has used a control, the replay does not start by itself.
  let touched = false

  const use = () => { touched = true; hover = null }
  const stop = () => { playing = false; if (timer) clearTimeout(timer); timer = undefined }
  const state = (): ReplayState => ({ step, shown: hover ?? pinned ?? step, pinned, playing })

  function render(scroll = false) {
    const last = total()
    if (step > last) step = last
    if (pinned !== null && pinned > last) pinned = null
    marks.forEach((mark) => {
      const position = Number(mark.dataset.mark)
      mark.hidden = position > last
      mark.style.left = `${(position / last) * 100}%`
      mark.classList.toggle('is-done', position <= step)
      if (position === step) mark.setAttribute('aria-current', 'step')
      else mark.removeAttribute('aria-current')
    })
    fill.style.width = `${(step / last) * 100}%`
    count.textContent = `${step}/${last}`
    play.setAttribute('aria-label', step >= last && !playing ? 'Replay' : playing ? 'Pause' : 'Play')
    // The button draws its icon from this state (see mcp-replay.css).
    play.dataset.state = playing ? 'pause' : step >= last ? 'replay' : 'play'
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
  function start() {
    use()
    if (step >= total()) step = 0
    pinned = null
    playing = true
    render(true)
    timer = setTimeout(tick, interval)
  }
  function go(next: number) {
    use()
    stop()
    pinned = null
    step = Math.max(0, Math.min(total(), next))
    render(true)
  }
  function togglePin(frame: number) {
    use()
    stop()
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
      // Centred on the dot, and kept inside the track's ends so a dot at either end keeps its tooltip on the page.
      const half = tip.offsetWidth / 2
      const width = tip.parentElement!.clientWidth
      tip.style.left = `${Math.max(half - 8, Math.min(width - half + 8, mark.offsetLeft))}px`
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
  }

  // A reader who asks for less motion gets the finished replay and presses play; others see it play once it is on screen.
  if (reduced) { render(); return player }
  step = 0
  render()
  const begin = () => {
    // A hidden panel can still intersect the viewport; it plays when the reader sees it.
    const shown = root.checkVisibility?.({ visibilityProperty: true }) ?? true
    if (shown && !touched && !playing && step === 0 && pinned === null) start()
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
