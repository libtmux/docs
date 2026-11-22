/**
 * The skip link (record 0077): the header's first tab stop, which leads to `main#content`.
 *
 * A native page's article is the `article[role=main]` its own renderer wrote and keeps its own id, so the
 * link follows that id. Either way the target can take focus, so the next Tab after the link enters the page.
 */
export function skipTarget(doc: Document = document): HTMLElement | null {
  return doc.getElementById('content') ?? doc.querySelector<HTMLElement>('main, [role="main"]')
}

/** Point the link at its target, giving a target that lacks an id or a tab index what the link needs. */
export function readySkipLink(doc: Document = document) {
  const target = skipTarget(doc)
  const link = doc.querySelector<HTMLAnchorElement>('a.skip-link')
  if (!target || !link) return
  if (!target.id) target.id = 'content'
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  link.setAttribute('href', `#${target.id}`)
}

/** Ready the link on load and after each client-routed swap, and move focus when it is followed: the router scrolls to the fragment but does not focus it. */
export function installSkipLink(doc: Document = document) {
  readySkipLink(doc)
  doc.addEventListener('astro:after-swap', () => readySkipLink(doc))
  doc.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest?.('a.skip-link')) skipTarget(doc)?.focus()
  })
}
