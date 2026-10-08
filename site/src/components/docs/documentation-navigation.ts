let controller: AbortController | undefined

export function initDocumentationNavigation() {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  for (const context of document.querySelectorAll<HTMLElement>('[data-documentation-context]')) {
    const toggle = context.querySelector<HTMLButtonElement>('[data-context-settings-toggle]')!
    const back = context.querySelector<HTMLButtonElement>('[data-context-settings-back]')!
    const settings = context.querySelector<HTMLElement>('[data-context-settings]')!
    if (!toggle || !back || !settings) continue
    const compact = window.matchMedia('(max-width: 24rem)')
    context.dataset.settingsEnhanced = ''
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
    compact.addEventListener('change', () => {
      const focused = document.activeElement
      const navigationOpen = context.querySelector('.documentation-context-navigation > :is(button, [role="button"])[aria-expanded="true"]')
      closeSettings()
      // A drawer must still have a visible opener to restore focus on close.
      if (compact.matches && navigationOpen) {
        context.dataset.settingsOpen = ''
        toggle.setAttribute('aria-expanded', 'true')
      }
      // Keep keyboard focus on a visible control when resizing either way.
      if (focused instanceof HTMLElement && context.contains(focused) && !focused.getClientRects().length) {
        (compact.matches ? toggle : settings.querySelector<HTMLElement>('summary'))?.focus({ preventScroll: true })
      }
    }, { signal })
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
    const position = () => {
      const rect = summary.getBoundingClientRect()
      if (!summary.getClientRects().length || summary.closest('[inert]') || rect.bottom <= 8 || rect.top >= window.innerHeight - 8) {
        picker.open = false
        if (topLayer && panel.matches(':popover-open')) panel.hidePopover()
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
    const visibleLinks = () => options().filter((option): option is HTMLAnchorElement => option instanceof HTMLAnchorElement && Boolean(option.getClientRects().length))
    picker.addEventListener('toggle', () => {
      if (!picker.open) {
        if (topLayer && panel.matches(':popover-open')) panel.hidePopover()
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
      if (link && location.hash) link.hash = location.hash
    }, { signal })
    document.addEventListener('click', (event) => {
      if (picker.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
    }, { signal })
    document.addEventListener('focusin', (event) => {
      if (picker.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false
    }, { signal })
    window.addEventListener('resize', () => { if (picker.open) position() }, { signal })
    document.addEventListener('scroll', (event) => {
      if (picker.open && event.target instanceof Node && !panel.contains(event.target)) position()
    }, { capture: true, signal })
  }
  for (const nav of document.querySelectorAll<HTMLElement>('[data-section-navigation]')) {
    const input = nav.querySelector<HTMLInputElement>('[data-section-search]')!
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('.sidebar-nav a')]
    const groups = [...nav.querySelectorAll<HTMLDetailsElement>('.sidebar-nav details')]
    let saved: boolean[] | undefined
    nav.querySelector<HTMLElement>('[data-section-search-label]')!.hidden = false
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase()
      if (query && !saved) saved = groups.map((group) => group.open)
      for (const link of links) link.hidden = !link.textContent?.toLocaleLowerCase().includes(query)
      groups.forEach((group, index) => {
        group.hidden = ![...group.querySelectorAll('a')].some((link) => !link.hidden)
        if (query) group.open = !group.hidden
        else if (saved) group.open = saved[index]
      })
      if (!query) saved = undefined
      nav.querySelector<HTMLElement>('[data-section-empty]')!.hidden = links.some((link) => !link.hidden)
    }, { signal })
  }
}
