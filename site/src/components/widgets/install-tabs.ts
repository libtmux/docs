/**
 * The tab row in an installer's header (design record 0065).
 *
 * A row of tabs scrolls sideways and never wraps. When they overflow, a button
 * at each end shows how many tabs are hidden on that side ("‹ +2", "+3 ›");
 * a press brings the first hidden tab on that side to the opposite edge, so
 * each press shows new tabs. A side with nothing hidden keeps its button,
 * dimmed and disabled, so the tabs never move when a count reaches zero. When
 * every tab fits, both buttons go. The row fades on the side with more tabs.
 *
 * Markup (see `InstallTabRow.astro`): a `[data-install-row]` holding the two
 * `[data-install-more]` buttons around the `[data-install-scroll]` scroller of
 * `role="tab"` buttons. `data-fits` on the row hides the buttons.
 *
 * The scroller is positioned, so each tab's `offsetLeft` is measured from the
 * row, and carries `scroll-padding-inline: 1.5rem`, so a focused tab clears the
 * fade; the padding is the `PAD` below.
 */

/** The fade's width, which a tab brought into view clears. */
const PAD = 24

export interface Box {
  left: number
  width: number
}

/** The tabs cut off at each edge of a row `clientWidth` wide scrolled to `scrollLeft`; a tab cut in part counts as hidden. */
export function hiddenCounts(tabs: readonly Box[], scrollLeft: number, clientWidth: number): { before: number; after: number } {
  const hi = scrollLeft + clientWidth
  let before = 0
  let after = 0
  for (const tab of tabs) {
    if (tab.left < scrollLeft - 1) before++
    else if (tab.left + tab.width > hi + 1) after++
  }
  return { before, after }
}

/**
 * Where a press scrolls the row: the first tab hidden on that side moves to the
 * opposite edge, clear of the fade. Undefined where nothing is hidden that way.
 */
export function pageTo(tabs: readonly Box[], direction: 1 | -1, scrollLeft: number, clientWidth: number): number | undefined {
  const hi = scrollLeft + clientWidth
  if (direction > 0) {
    const next = tabs.find((tab) => tab.left + tab.width > hi + 1)
    return next && next.left - PAD
  }
  const next = tabs.filter((tab) => tab.left < scrollLeft - 1).at(-1)
  return next && next.left + next.width - clientWidth + PAD
}

/** The scroll that brings a tab into view with the fade's width to spare, or the row's own where it already is. */
export function revealLeft(tab: Box, scrollLeft: number, clientWidth: number): number {
  if (tab.left < scrollLeft + PAD) return Math.max(0, tab.left - PAD)
  if (tab.left + tab.width > scrollLeft + clientWidth - PAD) return tab.left + tab.width - clientWidth + PAD
  return scrollLeft
}

/**
 * Whether every tab fits, judged with the buttons' room given back.
 *
 * While the buttons show, the row is narrower by their width, so the tabs are
 * measured against the row as it would be without them. Judged against the
 * narrow row, showing them could make the answer "does not fit" and hiding
 * them "fits", and the row would flip on every measure.
 */
export function fitsWithout(scrollWidth: number, clientWidth: number, room: number, showing: boolean): boolean {
  return scrollWidth <= clientWidth + (showing ? room : 0) + 1
}

const tabsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) => tab.offsetWidth > 0)
const boxOf = (tab: HTMLElement): Box => ({ left: tab.offsetLeft, width: tab.offsetWidth })

/** Repaint a row's buttons, fade and fit from where it is scrolled. */
export function updateTabRow(row: HTMLElement): void {
  const { before, after } = hiddenCounts(tabsOf(row).map(boxOf), row.scrollLeft, row.clientWidth)
  if (before || after) row.dataset.more = before && after ? 'both' : before ? 'start' : 'end'
  else delete row.dataset.more
  const wrap = row.closest<HTMLElement>('[data-install-row]')
  if (!wrap) return
  const buttons = [...wrap.querySelectorAll<HTMLButtonElement>('[data-install-more]')]
  const showing = !wrap.hasAttribute('data-fits')
  const room = buttons.reduce((sum, button) => sum + button.offsetWidth, 0)
  wrap.toggleAttribute('data-fits', fitsWithout(row.scrollWidth, row.clientWidth, room, showing))
  const counts = { '-1': before, '1': after } as const
  for (const button of buttons) {
    const count = counts[button.dataset.installMore as '-1' | '1'] ?? 0
    const noun = button.dataset.noun ?? 'tabs'
    button.disabled = count === 0
    const label = button.querySelector('[data-n]')
    if (label) label.textContent = count ? `+${count}` : ''
    button.setAttribute('aria-label', count ? `Show ${count} more ${noun}` : `No more ${noun} this way`)
  }
}

/** Bring the selected tab into view: centred where a row opens or a saved choice is restored, else just clear of the fade. */
export function revealSelected(row: HTMLElement, how: 'center' | 'nearest' = 'nearest'): void {
  const selected = row.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
  if (selected && selected.offsetWidth > 0) {
    row.scrollLeft = how === 'center'
      ? Math.max(0, selected.offsetLeft - row.clientWidth / 2 + selected.offsetWidth / 2)
      : revealLeft(boxOf(selected), row.scrollLeft, row.clientWidth)
  }
  updateTabRow(row)
}

const WATCHED = Symbol.for('libtmux.install-tabs')

/**
 * Keep every tab row of a document current: counts after a scroll or a resize,
 * and the press of an edge button. Safe to call again after a page swap.
 */
export function watchTabRows(doc: Document = document): void {
  const view = doc.defaultView
  const state = doc as Document & { [WATCHED]?: boolean }
  if (!state[WATCHED]) {
    state[WATCHED] = true
    doc.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-install-more]')
      const row = button?.closest('[data-install-row]')?.querySelector<HTMLElement>('[data-install-scroll]')
      if (!button || !row || button.disabled) return
      const left = pageTo(tabsOf(row).map(boxOf), button.dataset.installMore === '-1' ? -1 : 1, row.scrollLeft, row.clientWidth)
      if (left === undefined) return
      const reduced = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      row.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' })
    })
    view?.addEventListener('resize', () => doc.querySelectorAll<HTMLElement>('[data-install-scroll]').forEach(updateTabRow))
  }
  doc.querySelectorAll<HTMLElement>('[data-install-scroll]').forEach((row) => {
    if (row.dataset.watched !== 'true') {
      row.dataset.watched = 'true'
      row.addEventListener('scroll', () => updateTabRow(row), { passive: true })
      // A row's width follows its container, its buttons and the tabs it holds, none of which a window resize reports.
      if (view?.ResizeObserver) new view.ResizeObserver(() => updateTabRow(row)).observe(row)
    }
    revealSelected(row, 'center')
  })
}
