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
