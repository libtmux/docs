/**
 * Behavior for the status badges that explain themselves (`StatusBadge`).
 *
 * The card is a manual popover, so it escapes a scrolling menu; the button's
 * `popovertarget` toggles it without script. Script adds what the attribute
 * cannot: opening on hover and keyboard focus, keeping the card open while
 * focus or the pointer is inside it, Escape, and a click that keeps a card the
 * pointer or focus already opened. One set of delegated listeners serves
 * every badge, so a swapped page needs no rebinding.
 */
const HOVER_OPEN = 120
const HOVER_CLOSE = 250

let installed = false
// Focus returned to a badge by Escape must not reopen the card it just closed.
let restoring: HTMLElement | null = null
const timers = new WeakMap<HTMLElement, number>()
const rootOf = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-status-toggletip]') : null
const partsOf = (root: HTMLElement) => ({
  button: root.querySelector<HTMLButtonElement>(':scope > button')!,
  card: root.querySelector<HTMLElement>(':scope > [popover]')!,
})
const isOpen = (root: HTMLElement) => partsOf(root).card.matches(':popover-open')
const openRoots = () => [...document.querySelectorAll<HTMLElement>('[data-status-toggletip]')].filter(isOpen)

function cancel(root: HTMLElement) {
  window.clearTimeout(timers.get(root))
  timers.delete(root)
}

function place(root: HTMLElement) {
  const { button, card } = partsOf(root)
  const anchor = button.getBoundingClientRect()
  const width = document.documentElement.clientWidth
  const gap = 6
  const below = window.innerHeight - anchor.bottom - gap
  const upward = card.offsetHeight > below && anchor.top > below
  card.style.left = `${Math.max(8, Math.min(anchor.left, width - card.offsetWidth - 8))}px`
  card.style.top = upward ? `${Math.max(8, anchor.top - gap - card.offsetHeight)}px` : `${anchor.bottom + gap}px`
}

function open(root: HTMLElement) {
  cancel(root)
  for (const other of openRoots()) if (other !== root) close(other)
  const { button, card } = partsOf(root)
  if (!card.matches(':popover-open')) card.showPopover()
  button.setAttribute('aria-expanded', 'true')
  place(root)
}

function close(root: HTMLElement) {
  cancel(root)
  delete root.dataset.pinned
  const { button, card } = partsOf(root)
  if (card.matches(':popover-open')) card.hidePopover()
  button.setAttribute('aria-expanded', 'false')
}

function later(root: HTMLElement, delay: number, action: (root: HTMLElement) => void) {
  cancel(root)
  timers.set(root, window.setTimeout(() => action(root), delay))
}

export function initStatusToggletips() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const on = <K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void) =>
    document.addEventListener(type, listener, true)

  on('pointerover', (event) => {
    const root = rootOf(event.target)
    if (root && event.pointerType === 'mouse') later(root, HOVER_OPEN, open)
  })
  on('pointerout', (event) => {
    const root = rootOf(event.target)
    if (!root || event.pointerType !== 'mouse' || root.contains(event.relatedTarget as Node | null)) return
    if (root.dataset.pinned === undefined && !root.matches(':focus-within')) later(root, HOVER_CLOSE, close)
    else cancel(root)
  })
  on('focusin', (event) => {
    const root = rootOf(event.target)
    if (root && root !== restoring) open(root)
  })
  on('focusout', (event) => {
    const root = rootOf(event.target)
    if (!root || root.contains(event.relatedTarget as Node | null)) return
    if (root.dataset.pinned === undefined && !root.matches(':hover')) later(root, HOVER_CLOSE, close)
  })
  on('click', (event) => {
    const root = rootOf(event.target)
    if (!root || !(event.target as Element).closest('button')) return
    // The click opens or pins a card; the attribute's own toggle would close the one hover or focus opened.
    event.preventDefault()
    if (isOpen(root) && root.dataset.pinned !== undefined) close(root)
    else {
      open(root)
      root.dataset.pinned = ''
    }
  })
  on('pointerdown', (event) => {
    for (const root of openRoots()) if (!root.contains(event.target as Node)) close(root)
  })
  on('keydown', (event) => {
    if (event.key !== 'Escape') return
    const roots = openRoots()
    if (roots.length === 0) return
    // Dismiss the card before any menu around it sees the key.
    event.preventDefault()
    event.stopPropagation()
    for (const root of roots) {
      const focused = root.contains(document.activeElement)
      close(root)
      if (focused) {
        restoring = root
        partsOf(root).button.focus({ preventScroll: true })
        restoring = null
      }
    }
  })
  on('toggle', (event) => {
    const target = event.target
    if (target instanceof HTMLDetailsElement && !target.open) {
      for (const root of target.querySelectorAll<HTMLElement>('[data-status-toggletip]')) close(root)
    }
    const root = rootOf(target)
    if (root && target === partsOf(root).card) {
      partsOf(root).button.setAttribute('aria-expanded', String(isOpen(root)))
    }
  })
  window.addEventListener('resize', () => openRoots().forEach(close))
  window.addEventListener('scroll', (event) => {
    if (!openRoots().some((root) => root.contains(event.target as Node))) openRoots().forEach(close)
  }, true)
}
