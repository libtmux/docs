/** Anchor arrival shared by Astro and native documentation pages. */
export function installAnchorNavigation(win = window) {
  const doc = win.document
  const controller = new win.AbortController()
  const { signal } = controller
  let frame = 0
  let timer = 0
  let highlighted
  let observer

  doc.documentElement.setAttribute('data-anchor-navigation', '')

  const clear = () => {
    win.clearTimeout(timer)
    observer?.disconnect()
    highlighted?.removeAttribute('data-anchor-arrival')
    highlighted = undefined
  }

  const visibleTarget = (target) => {
    if (target.matches('.section-anchor-alias, .sr-only') ||
        (target.matches('span, a') && !target.textContent.trim())) {
      target = target.closest('h1, h2, h3, h4, h5, h6, dt, tr, .api-index-card') ||
        target.nextElementSibling || target.parentElement
    }
    if (target?.matches('details')) return target.querySelector(':scope > summary') || target
    return target?.querySelector(':scope > :is(h1, h2, h3, h4, h5, h6)') || target
  }

  const arrive = (hash, scroll = false) => {
    clear()
    let id
    try { id = decodeURIComponent(hash.replace(/^#/, '')) } catch { return }
    const target = id && doc.getElementById(id)
    if (!target) return
    let opened = false
    for (let node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS' && !node.open) {
        node.open = true
        opened = true
      }
    }
    const display = visibleTarget(target)
    if (!display || display === doc.body || display === doc.documentElement) return
    // The font gate hides the page for up to three seconds. Keep the full
    // arrival cue for the moment the reader can actually see it.
    if (doc.documentElement.classList.contains('fonts-pending') && win.MutationObserver) {
      observer = new win.MutationObserver(() => {
        if (!doc.documentElement.classList.contains('fonts-pending')) schedule(hash, scroll || opened)
      })
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] })
      return
    }
    if (opened || scroll) display.scrollIntoView({ block: 'start', behavior: 'instant' })

    const highlight = () => {
      if (signal.aborted || !display.isConnected) return
      observer?.disconnect()
      highlighted = display
      display.setAttribute('data-anchor-arrival', '')
      timer = win.setTimeout(clear, 2600)
    }
    // Start the cue on arrival, including browsers using smooth scrolling.
    const rect = display.getBoundingClientRect()
    if (rect.bottom > 0 && rect.top < win.innerHeight) highlight()
    else if (win.IntersectionObserver) {
      observer = new win.IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) highlight()
      })
      observer.observe(display)
    }
  }
  const schedule = (hash = win.location.hash, scroll = false) => {
    win.cancelAnimationFrame(frame)
    // Removing the marker before the next frame also restarts repeated links.
    clear()
    frame = win.requestAnimationFrame(() => arrive(hash, scroll))
  }

  win.addEventListener('hashchange', () => schedule(), { signal })
  doc.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const link = event.target.closest?.('a[href]')
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
    const next = new URL(link.href, win.location.href)
    // ClientRouter prevents the native click after updating the URL itself.
    // Its repeated fragment navigation emits no hashchange.
    if (event.defaultPrevented && next.hash !== win.location.hash) return
    if (next.origin === win.location.origin && next.pathname === win.location.pathname &&
        next.search === win.location.search && next.hash) schedule(next.hash, true)
  }, { signal })
  // Search or other controls that scroll without changing the URL can use
  // the same behavior without replacing the browser's scrolling methods.
  doc.addEventListener('libtmux:anchor-arrival', (event) => {
    if (typeof event.detail?.id === 'string') schedule(`#${encodeURIComponent(event.detail.id)}`, true)
  }, { signal })
  schedule()

  return () => {
    controller.abort()
    win.cancelAnimationFrame(frame)
    clear()
  }
}

if (typeof window !== 'undefined') {
  let cleanup
  const boot = () => {
    cleanup?.()
    cleanup = installAnchorNavigation(window)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
  document.addEventListener('astro:page-load', boot)
  document.addEventListener('astro:before-swap', () => cleanup?.())
}
