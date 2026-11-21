import { below, panelMode } from '../../lib/breakpoints'
import { fitQualifiedNames } from '../../lib/qualified-name'

let controller: AbortController | undefined

/** What opens as a panel by display: the pickers and the header's Menu (record 0071). */
const OPEN_PANELS = '[data-doc-picker][open], [data-header-menu][open]'

/** A sheet locks the page's scroll while it is open; a popover does not. */
function syncSheetLock() {
  const sheet = [...document.querySelectorAll<HTMLElement>(OPEN_PANELS)].some((owner) => owner.dataset.panelMode && owner.dataset.panelMode !== 'popover')
  document.documentElement.toggleAttribute('data-sheet-open', sheet)
}

const CLOSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke-linecap="round" /></svg>'

/**
 * Give a panel the title row and Close button that a side sheet pins at its top (record 0071). The row is the panel's own
 * `.doc-picker-title`, or one named `title` for a panel with none; CSS shows the added row and the button in a side sheet only, so the
 * popover and bottom sheet keep their anatomy. Close shuts `owner` and returns focus to `trigger`.
 */
function addPanelHead(owner: HTMLDetailsElement, trigger: HTMLElement, panel: HTMLElement, title: string, noun: string, signal: AbortSignal) {
  let head = panel.querySelector<HTMLElement>(':scope > .doc-picker-title')
  if (!head) {
    head = document.createElement('p')
    head.className = 'doc-picker-title'
    head.dataset.panelHeadAdded = ''
    head.textContent = title
    panel.prepend(head)
  }
  head.querySelector('[data-panel-close]')?.remove()
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'doc-panel-close'
  close.dataset.panelClose = ''
  close.setAttribute('aria-label', `Close ${noun}`)
  close.innerHTML = CLOSE_ICON
  close.addEventListener('click', () => {
    owner.open = false
    trigger.focus({ preventScroll: true })
  }, { signal })
  head.append(close)
}

/**
 * Place an open panel for this display. A popover is fixed under its trigger, above it when there is no room below, and clamped to the
 * viewport; a bottom or side sheet is placed by CSS from `data-panel-mode` and `data-panel-side` on `owner`. Closes `owner` when its
 * trigger is gone or scrolled out of view.
 */
function placePanel(owner: HTMLDetailsElement, trigger: HTMLElement, panel: HTMLElement) {
  const rect = trigger.getBoundingClientRect()
  if (!trigger.getClientRects().length || trigger.closest('[inert]') || rect.bottom <= 8 || rect.top >= window.innerHeight - 8) {
    owner.open = false
    if (typeof panel.showPopover === 'function' && panel.matches(':popover-open')) panel.hidePopover()
    return
  }
  const mode = panelMode()
  owner.dataset.panelMode = mode
  syncSheetLock()
  if (mode !== 'popover') {
    owner.dataset.panelSide = rect.left + rect.width / 2 > document.documentElement.clientWidth / 2 ? 'end' : 'start'
    for (const property of ['left', 'top', 'bottom', 'maxHeight', 'maxWidth'] as const) panel.style[property] = ''
    return
  }
  const viewportWidth = document.documentElement.clientWidth
  panel.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`
  const width = panel.getBoundingClientRect().width
  panel.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`
  const below = window.innerHeight - rect.bottom - 14
  const above = rect.top - 14
  const upward = below < 220 && above > below
  panel.style.maxHeight = `${Math.max(0, Math.min(window.innerHeight - 16, upward ? above : below))}px`
  panel.style.top = upward ? 'auto' : `${Math.max(8, rect.bottom + 6)}px`
  panel.style.bottom = upward ? `${window.innerHeight - rect.top + 6}px` : 'auto'
}

export function initDocumentationNavigation() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  for (const context of document.querySelectorAll<HTMLElement>('[data-documentation-context]')) {
    const toggle = context.querySelector<HTMLButtonElement>('[data-context-settings-toggle]')!
    const back = context.querySelector<HTMLButtonElement>('[data-context-settings-back]')!
    const settings = context.querySelector<HTMLElement>('[data-context-settings]')!
    if (!toggle || !back || !settings) continue
    const compact = window.matchMedia(below('phone'))
    // Under 22rem the navigation buttons also fold into the settings view.
    const narrow = window.matchMedia('(max-width: 21.875rem)')
    toggle.hidden = back.hidden = false
    const closeSettings = () => {
      for (const picker of settings.querySelectorAll<HTMLDetailsElement>('[data-doc-picker][open]')) picker.open = false
      delete context.dataset.settingsOpen
      toggle.setAttribute('aria-expanded', 'false')
    }
    toggle.addEventListener('click', () => {
      if (!compact.matches) return
      for (const picker of context.querySelectorAll<HTMLDetailsElement>('[data-doc-picker][open]')) picker.open = false
      context.dataset.settingsOpen = ''
      toggle.setAttribute('aria-expanded', 'true')
      back.focus({ preventScroll: true })
    }, { signal })
    back.addEventListener('click', () => { closeSettings(); toggle.focus({ preventScroll: true }) }, { signal })
    context.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !context.hasAttribute('data-settings-open')) return
      event.preventDefault()
      closeSettings()
      toggle.focus({ preventScroll: true })
    }, { signal })
    const resized = () => {
      const focused = document.activeElement
      const navigationOpen = context.querySelector('.documentation-context-navigation > :is(button, [role="button"])[aria-expanded="true"]')
      closeSettings()
      // A drawer must still have a visible opener to restore focus on close.
      if (narrow.matches && navigationOpen) {
        context.dataset.settingsOpen = ''
        toggle.setAttribute('aria-expanded', 'true')
      }
      // Keep keyboard focus on a visible control when resizing either way.
      if (focused instanceof HTMLElement && context.contains(focused) && !focused.getClientRects().length) {
        (compact.matches ? toggle : settings.querySelector<HTMLElement>('summary'))?.focus({ preventScroll: true })
      }
    }
    compact.addEventListener('change', resized, { signal })
    narrow.addEventListener('change', resized, { signal })
  }
  for (const picker of document.querySelectorAll<HTMLDetailsElement>('[data-doc-picker]')) {
    const panel = picker.querySelector<HTMLElement>('[data-picker-panel]')!
    const summary = picker.querySelector<HTMLElement>(':scope > summary')!
    const search = picker.querySelector<HTMLInputElement>('[data-picker-search]')
    const groups = () => [...picker.querySelectorAll<HTMLElement>('[data-picker-group]')]
    let saved = new Map(groups().map((group) => [group, group instanceof HTMLDetailsElement && group.open]))
    const options = () => [...picker.querySelectorAll<HTMLElement>('[data-picker-option]')]
    picker.dataset.enhanced = ''
    // The top layer escapes scrolling containers. Native details remain usable
    // without scripting; every destination is still an ordinary link.
    const topLayer = typeof panel.showPopover === 'function'
    if (topLayer) panel.setAttribute('popover', 'manual')
    const searchLabel = picker.querySelector<HTMLElement>('[data-picker-search-label]')
    if (searchLabel) searchLabel.hidden = false
    const position = () => placePanel(picker, summary, panel)
    addPanelHead(picker, summary, panel, summary.getAttribute('aria-label') ?? summary.textContent?.trim() ?? 'Options', 'picker', signal)
    const filter = () => {
      const tokens = (search?.value ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
      const entries = options()
      for (const option of entries) option.hidden = !tokens.every((token) => option.dataset.match!.toLocaleLowerCase().includes(token))
      groups().forEach((group) => {
        group.hidden = ![...group.querySelectorAll<HTMLElement>('[data-picker-option]')].some((option) => !option.hidden)
        if (group instanceof HTMLDetailsElement) group.open = tokens.length ? !group.hidden : saved.get(group) ?? false
      })
      const count = entries.filter((option) => !option.hidden).length
      const empty = picker.querySelector<HTMLElement>('[data-picker-empty]')
      if (empty) empty.hidden = count > 0
      const status = picker.querySelector<HTMLElement>('[data-picker-status]')
      if (status) status.textContent = tokens.length ? `${count} matching entries` : ''
    }
    const visibleLinks = () => options().filter((option) => !option.hidden)
      .flatMap((option) => option instanceof HTMLAnchorElement ? [option] : [...option.querySelectorAll<HTMLAnchorElement>('[data-picker-home]')])
      .filter((link) => Boolean(link.getClientRects().length))
    picker.addEventListener('toggle', () => {
      if (!picker.open) {
        if (topLayer && panel.matches(':popover-open')) panel.hidePopover()
        syncSheetLock()
        if (search?.value) { search.value = ''; filter() }
        return
      }
      for (const other of document.querySelectorAll<HTMLDetailsElement>('[data-doc-picker][open]')) {
        if (other !== picker) other.open = false
      }
      saved = new Map(groups().map((group) => [group, group instanceof HTMLDetailsElement && group.open]))
      if (search) { search.value = ''; filter() }
      if (topLayer) panel.showPopover()
      position()
      // Matched API names fit once the panel has its width (record 0069).
      fitQualifiedNames(panel)
      // A reopened menu must not leave its focused search above the viewport.
      panel.scrollTop = 0
      if (picker.open) (search ?? panel.querySelector<HTMLElement>('a[aria-current]') ?? visibleLinks()[0])?.focus({ preventScroll: true })
    }, { signal })
    search?.addEventListener('input', filter, { signal })
    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && picker.open) {
        event.preventDefault()
        event.stopPropagation()
        picker.open = false
        summary.focus({ preventScroll: true })
        return
      }
      const links = visibleLinks()
      if (event.target === search) {
        if (event.key === 'ArrowDown') { event.preventDefault(); links[0]?.focus() }
        if (event.key === 'Enter' && search?.value.trim()) { event.preventDefault(); links[0]?.click() }
      } else if (event.target instanceof HTMLAnchorElement && links.includes(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const index = links.indexOf(event.target)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length
        event.preventDefault()
        links[next]?.focus()
      }
    }, { signal })
    picker.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-preserve-fragment]') : null
      if (!link) return
      const ids = link.dataset.fragmentIds?.split(' ')
      if (ids) {
        let id = location.hash.slice(1)
        try { id = decodeURIComponent(id) } catch { id = '' }
        link.hash = id && ids.includes(id) ? location.hash : ''
      } else if (location.hash) link.hash = location.hash
    }, { signal })
    document.addEventListener('click', (event) => {
      if (picker.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
      // A tap on a sheet's backdrop lands on the panel itself, outside its box.
      else if (picker.open && event.target === panel && picker.dataset.panelMode !== 'popover') {
        const box = panel.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) picker.open = false
      }
    }, { signal })
    document.addEventListener('focusin', (event) => {
      if (picker.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
    }, { signal })
    window.addEventListener('resize', () => { if (picker.open) { position(); fitQualifiedNames(panel) } }, { signal })
    document.addEventListener('scroll', (event) => {
      if (picker.open && event.target instanceof Node && !panel.contains(event.target)) position()
    }, { capture: true, signal })
  }

  // The header Menu is a disclosure that opens by display like a picker's panel: a bottom sheet on a phone, a side sheet on a short
  // landscape screen, a popover elsewhere (record 0071). Escape and a side sheet's Close button close it and return focus to its button.
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-header-menu]')) {
    const summary = menu.querySelector<HTMLElement>(':scope > summary')!
    const panel = menu.querySelector<HTMLElement>(':scope > .site-header__panel')!
    if (!summary || !panel) continue
    const topLayer = typeof panel.showPopover === 'function'
    if (topLayer) panel.setAttribute('popover', 'manual')
    menu.dataset.enhanced = ''
    const position = () => placePanel(menu, summary, panel)
    const close = () => { menu.open = false }
    addPanelHead(menu, summary, panel, 'Menu', 'menu', signal)
    // The Close button is the sheet's way out, not where a reader starts.
    const firstControl = () => [...panel.querySelectorAll<HTMLElement>('a[href], button:not([data-panel-close]), summary, input')].find((control) => control.getClientRects().length)
    menu.addEventListener('toggle', () => {
      if (!menu.open) {
        for (const picker of menu.querySelectorAll<HTMLDetailsElement>('[data-doc-picker][open]')) picker.open = false
        if (topLayer && panel.matches(':popover-open')) panel.hidePopover()
        syncSheetLock()
        return
      }
      // One panel at a time: a picker elsewhere closes, one in the Menu's own panel belongs to it.
      for (const other of document.querySelectorAll<HTMLDetailsElement>('[data-doc-picker][open]')) {
        if (!menu.contains(other)) other.open = false
      }
      if (topLayer && !panel.matches(':popover-open')) panel.showPopover()
      position()
      panel.scrollTop = 0
      if (menu.open) firstControl()?.focus({ preventScroll: true })
    }, { signal })
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.open) return
      event.preventDefault()
      event.stopPropagation()
      close()
      summary.focus({ preventScroll: true })
    }, { signal })
    // Choosing a destination closes the panel, so a link that opens a new tab does not leave a sheet locking the page.
    panel.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) close()
    }, { signal })
    document.addEventListener('click', (event) => {
      if (!menu.open) return
      if (event.target instanceof Node && !menu.contains(event.target)) close()
      // A tap on a sheet's backdrop lands on the panel itself, outside its box.
      else if (event.target === panel && menu.dataset.panelMode !== 'popover') {
        const box = panel.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
      }
    }, { signal })
    document.addEventListener('focusin', (event) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) close()
    }, { signal })
    window.addEventListener('resize', () => { if (menu.open) position() }, { signal })
  }
}
