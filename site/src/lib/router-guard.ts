/**
 * Send navigation the router cannot swap to the browser, before it fetches.
 *
 * Each independently built tree ships its own hashed scripts. Swapping into
 * another tree would run them beside this document's, and their global
 * listeners would accumulate. A rejection after the fetch costs a second
 * request for the same page, so what the URL alone decides is decided first.
 */
export function guardTreeNavigation(doc: Document = document) {
  doc.addEventListener('astro:before-preparation', (event) => {
    const base = doc.documentElement.dataset.shellBase
    const { pathname } = event.to
    // Pages are directory URLs; the Markdown twin, JSON and text files are not pages.
    if (!pathname.endsWith('/') || (base && !pathname.startsWith(base))) {
      event.preventDefault()
      return
    }
    // Another tree's mount point can sit under this one's; its page says so.
    const load = event.loader
    event.loader = async () => {
      await load()
      if (event.newDocument.documentElement.dataset.shellBase !== doc.documentElement.dataset.shellBase) {
        event.preventDefault()
      }
    }
  })
}

/**
 * Keep navigation within the page this document shows away from the router.
 *
 * Pages rewrite their own query with `history.replaceState` (a chosen
 * language, a workspace preset) and add their fields to entries the browser
 * made for a fragment. The router compares a destination with the URL it last
 * navigated to, and takes any entry with state for its own, so a fragment link
 * or Back and Forward between two of the page's entries would fetch the page
 * again and swap it in. A fragment link goes to the browser, which scrolls to
 * it. A traversal reaches the page's own listeners without its state, which
 * the router ignores, and the scroll position the entry saved is restored.
 * Window listeners run in the order they were added, so this must be
 * installed before the router's script runs.
 */
export function guardPageNavigation(doc: Document = document) {
  const win = doc.defaultView!
  let pagePath = win.location.pathname
  doc.addEventListener('astro:after-swap', () => { pagePath = win.location.pathname })
  doc.addEventListener('astro:before-preparation', (event) => {
    const { pathname, search, hash } = event.to
    if (event.navigationType !== 'traverse' && hash && pathname === win.location.pathname && search === win.location.search) {
      event.preventDefault()
    }
  })
  let resending = false
  win.addEventListener('popstate', (event) => {
    if (resending || event.state === null || win.location.pathname !== pagePath) return
    event.stopImmediatePropagation()
    const { scrollX, scrollY } = event.state
    if (typeof scrollX === 'number' && typeof scrollY === 'number') {
      win.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' })
    }
    resending = true
    try {
      win.dispatchEvent(new win.PopStateEvent('popstate', { state: null }))
    } finally {
      resending = false
    }
  })
}
