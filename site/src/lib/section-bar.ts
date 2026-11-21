/**
 * A section bar is one row at every width (design record 0007). Its links scroll inside the row; two arrow buttons appear
 * only when links are hidden, each disabled at its end, and the row marks which edge has more behind it so the stylesheet
 * can fade that edge. The markup paints one row before this runs, so mounting moves nothing below the bar.
 *
 * `data-overflow` is on the bar while its links do not fit, `data-start` and `data-end` while the row sits at that edge.
 */

/** Pixels of slack: a fractional layout width must not count as overflow. */
const SLACK = 1

export function mountSectionBar(bar: HTMLElement): () => void {
  const track = bar.querySelector<HTMLElement>('[data-scroll-track]')
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button[data-dir]')]
  const previous = buttons.find((button) => button.dataset.dir === '-1')
  const next = buttons.find((button) => button.dataset.dir === '1')
  const win = bar.ownerDocument.defaultView
  if (!track || !previous || !next || !win) return () => {}
  const controller = new AbortController()
  const { signal } = controller

  const smooth = () => !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const update = () => {
    const overflow = track.scrollWidth > track.clientWidth + SLACK
    const atStart = track.scrollLeft <= SLACK
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - SLACK
    // A button that holds focus and disables would drop focus to the page: hand it to the other one.
    const focused = bar.ownerDocument.activeElement
    if (focused === previous && atStart && !atEnd) next.focus()
    else if (focused === next && atEnd && !atStart) previous.focus()
    previous.hidden = next.hidden = !overflow
    previous.disabled = atStart
    next.disabled = atEnd
    bar.toggleAttribute('data-overflow', overflow)
    bar.toggleAttribute('data-start', overflow && atStart)
    bar.toggleAttribute('data-end', overflow && atEnd)
  }

  /** Scroll the current section to the middle of the row. The scroll spy keeps it visible after this. */
  const center = () => {
    const current = track.querySelector<HTMLElement>('[aria-current]')
    if (!current || track.scrollWidth <= track.clientWidth + SLACK) return
    const trackBox = track.getBoundingClientRect()
    const box = current.getBoundingClientRect()
    track.scrollLeft += box.left - trackBox.left - (track.clientWidth - box.width) / 2
  }

  bar.addEventListener('click', (event) => {
    const button = event.target instanceof win.Element ? event.target.closest<HTMLButtonElement>('button[data-dir]') : null
    if (!button || !bar.contains(button) || button.disabled) return
    track.scrollBy({ left: Number(button.dataset.dir) * Math.max(track.clientWidth * 0.75, 60), behavior: smooth() ? 'smooth' : 'auto' })
  }, { signal })
  track.addEventListener('scroll', update, { passive: true, signal })

  let width = -1
  const resized = () => {
    // The buttons appearing narrows the track, which is not a new width for the bar and must not move the row.
    if (bar.clientWidth !== width) { width = bar.clientWidth; center() }
    update()
  }
  if (win.ResizeObserver) {
    const observer = new win.ResizeObserver(resized)
    observer.observe(bar)
    observer.observe(track)
    // Links change width when the font arrives or a count is written.
    for (const link of track.children) observer.observe(link)
    signal.addEventListener('abort', () => observer.disconnect())
  }
  void bar.ownerDocument.fonts?.ready.then(() => { if (!signal.aborted) update() })
  resized()
  return () => controller.abort()
}
