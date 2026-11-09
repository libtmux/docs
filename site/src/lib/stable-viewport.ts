const EDITABLE = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="button"], [type="checkbox"], [type="radio"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"])'
let width = 0
let tallest = 0

/**
 * The layout viewport's height with any on-screen keyboard ignored. Chrome on
 * iOS shrinks innerHeight while the keyboard is up, even a floating one, so
 * while an editable element has focus this keeps the tallest height seen at
 * the current width. Any other time it is innerHeight, and a new width or
 * orientation starts over.
 */
export function stableViewportHeight(): number {
  const editing = document.activeElement?.matches(EDITABLE) ?? false
  if (window.innerWidth !== width || !editing) {
    width = window.innerWidth
    tallest = window.innerHeight
  } else tallest = Math.max(tallest, window.innerHeight)
  return tallest
}

/** Run `work` when the keyboard may have opened or closed: now, and a frame later. */
export function onViewportChange(work: () => void, signal: AbortSignal) {
  const later = () => window.requestAnimationFrame(() => window.requestAnimationFrame(work))
  window.addEventListener('resize', work, { signal })
  window.visualViewport?.addEventListener('resize', work, { signal })
  // Focus lands before the keyboard shrinks the frame, so record the full height first.
  document.addEventListener('focusin', () => { stableViewportHeight(); work() }, { signal })
  // activeElement is still the old element during focusout.
  document.addEventListener('focusout', later, { signal })
}
