/** Runs before paint, and again for each sidebar after an Astro document swap. */
export function initializeDocumentationSidebar(nav: HTMLElement | null) {
  if (!nav) return
  const input = nav.querySelector<HTMLInputElement>('[data-section-search]')!
  const links = [...nav.querySelectorAll<HTMLElement>('.sidebar-nav [data-sidebar-label]')]
  const groups = [...nav.querySelectorAll<HTMLDetailsElement>('.sidebar-nav details')]
  const scroll = nav.closest<HTMLElement>('[data-documentation-scroll]')
  const controller = new AbortController(), { signal } = controller
  let searchSaved: boolean[] | undefined
  let initialized = false, interacted = false
  let queued = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const key = `libtmux:section-nav:${nav.dataset.sectionScope}`
  const branchKey = (group: HTMLDetailsElement) => {
    const path: string[] = []
    for (let parent: HTMLDetailsElement | null = group; parent && nav.contains(parent); parent = parent.parentElement?.closest('details') ?? null) {
      const summary = parent.querySelector(':scope > summary')!
      path.unshift(summary.querySelector('a')?.getAttribute('href') ?? summary.querySelector<HTMLElement>('[data-sidebar-label]')?.dataset.sidebarLabel ?? summary.textContent!.trim())
    }
    return JSON.stringify(path)
  }
  const visible = () => Boolean(scroll?.getClientRects().length && !scroll.closest('[inert]'))
  const save = () => {
    if (!initialized || !visible() || !scroll) return
    const branches = Object.fromEntries(groups.map((group, index) => [branchKey(group), searchSaved?.[index] ?? group.open]))
    try { window.sessionStorage.setItem(key, JSON.stringify({ top: scroll.scrollTop, branches })) } catch { /* Storage is optional. */ }
  }
  const reveal = () => {
    if (!scroll || !visible() || interacted || signal.aborted || !nav.isConnected) return
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]')
    if (!current) return
    const row = current.getBoundingClientRect(), box = scroll.getBoundingClientRect()
    const top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom)
    if (row.top < top || row.bottom > bottom) {
      // Move only the sidebar; the document may be arriving at a deep fragment.
      scroll.scrollTop += row.top - top - (bottom - top - row.height) / 2
    }
  }
  const restore = () => {
    if (scroll?.dataset.documentationScroll === 'desktop' && visible() && nav.isConnected && !signal.aborted) {
      // Before it sticks, the sidebar starts below the full context header.
      // Its last row must remain reachable without scrolling the document.
      const top = Math.max(0, scroll.getBoundingClientRect().top)
      scroll.style.maxHeight = `calc(100dvh - ${top}px - 1rem)`
    }
    if (!scroll || !visible() || interacted || signal.aborted || !nav.isConnected) return
    if (!initialized) {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(key) ?? 'null')
        if (Number.isFinite(saved?.top) && saved.top >= 0 && saved.branches && typeof saved.branches === 'object' && !Array.isArray(saved.branches)) {
          for (const group of groups) {
            const open = saved.branches[branchKey(group)]
            if (typeof open === 'boolean') group.open = Boolean(group.querySelector('[aria-current="page"]')) || open
          }
          scroll.scrollTop = saved.top
        }
      } catch { /* Direct arrivals remain usable without saved state. */ }
      initialized = true
    }
    reveal()
  }
  const later = () => {
    if (queued) return
    queued = true
    window.requestAnimationFrame(() => { queued = false; restore() })
  }
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase()
    if (query && !searchSaved) searchSaved = groups.map((group) => group.open)
    for (const link of links) {
      const ancestors = []
      for (let parent = link.closest('details'); parent && nav.contains(parent); parent = parent.parentElement?.closest('details') ?? null) {
        const summary = parent.querySelector(':scope > summary')!
        ancestors.push((summary.querySelector<HTMLElement>('[data-sidebar-label]')?.dataset.sidebarLabel ?? summary.textContent!).trim())
      }
      const label = link.dataset.sidebarLabel ?? link.textContent!.trim()
      const qualified = [...ancestors].reverse().concat(label).join('.')
      link.hidden = ![label, qualified, ...ancestors].some((text) => text.toLocaleLowerCase().includes(query))
    }
    for (const group of [...groups].reverse()) {
      group.hidden = ![...group.querySelectorAll<HTMLElement>('[data-sidebar-label]')].some((link) => !link.hidden)
      const heading = group.querySelector<HTMLElement>(':scope > summary > a')
      if (heading && !group.hidden) heading.hidden = false
      if (query) group.open = !group.hidden
      else if (searchSaved) group.open = searchSaved[groups.indexOf(group)]
    }
    if (!query) searchSaved = undefined
    nav.querySelector<HTMLElement>('[data-section-empty]')!.hidden = links.some((link) => !link.hidden)
  }, { signal })
  // Bind and reveal together, before the parser paints this sidebar.
  nav.querySelector<HTMLElement>('[data-section-search-label]')!.hidden = false
  for (const event of ['wheel', 'pointerdown', 'keydown']) {
    scroll?.addEventListener(event, () => { interacted = true }, { signal, once: true })
  }
  scroll?.addEventListener('scroll', () => {
    clearTimeout(timer)
    timer = setTimeout(save, 80)
  }, { signal, passive: true })
  nav.addEventListener('toggle', save, { signal, capture: true })
  // Capture before the mobile drawer closes and becomes inert on navigation.
  nav.addEventListener('click', save, { signal, capture: true })
  document.addEventListener('astro:before-swap', () => {
    save(); clearTimeout(timer); observer?.disconnect(); controller.abort()
  }, { signal, once: true })
  window.addEventListener('pagehide', save, { signal })
  window.addEventListener('resize', later, { signal })
  window.addEventListener('scroll', later, { signal, passive: true })
  document.addEventListener('libtmux:drawer-open', later, { signal })
  // Notice dismissal and content/font layout can move the sidebar without a resize.
  const observer = window.ResizeObserver ? new window.ResizeObserver(later) : undefined
  observer?.observe(document.body)
  restore()
  later()
  void document.fonts?.ready.then(later)
}
