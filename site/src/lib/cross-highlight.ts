/**
 * Point at a name anywhere (the text of a doc comment, a directory chip, the member list or the sidebar tree) and
 * every other link to the same page lights up, so the reader sees where else the page names it. Keyboard focus does
 * the same. A branch row of the tree lights as a whole: its link is the label inside the row.
 */
const LINKS = 'a.api-doc-link[href], a.api-member-link[href], a.api-nav__row[href], .api-nav__row > a.api-nav__label[href]'
const started = new WeakSet<Document>()

/** Wire the page's links; a page asks once, however many components ask. */
export function crossHighlight(document: Document): void {
  if (started.has(document)) return
  started.add(document)
  const view = document.defaultView!
  const sameOrigin = (link: HTMLAnchorElement) => link.origin === view.location.origin

  // The links by the page they lead to. A page holds a couple of thousand, so the map is built the first time a name
  // is pointed at and again once the tree adds rows, not on every hover.
  let paths: Map<string, HTMLAnchorElement[]> | undefined
  const watched = new Set<Element>()
  const observer = new view.MutationObserver(() => { paths = undefined })
  const build = () => {
    const built = new Map<string, HTMLAnchorElement[]>()
    for (const link of document.querySelectorAll<HTMLAnchorElement>(LINKS)) {
      if (!sameOrigin(link)) continue
      const group = built.get(link.pathname)
      if (group) group.push(link)
      else built.set(link.pathname, [link])
    }
    for (const nav of document.querySelectorAll('.api-nav')) {
      if (watched.has(nav)) continue
      watched.add(nav)
      observer.observe(nav, { childList: true, subtree: true })
    }
    return built
  }
  const linksTo = (link: HTMLAnchorElement) => {
    const group = (paths ??= build()).get(link.pathname)
    if (group?.includes(link)) return group
    // A row the tree added since the map was built.
    return (paths = build()).get(link.pathname) ?? []
  }

  const surface = (link: HTMLAnchorElement): Element => link.matches('.api-nav__row > a') ? link.parentElement! : link
  let current: Element | null = null
  let lit: Element[] = []
  const clear = () => {
    for (const element of lit) element.classList.remove('is-cross-lit')
    lit = []
    current = null
  }
  const light = (target: EventTarget | null) => {
    const link = target instanceof view.Element ? target.closest<HTMLAnchorElement>(LINKS) : null
    if (!link || link === current) return
    clear()
    current = link
    if (!sameOrigin(link)) return
    const own = surface(link)
    lit = [...new Set(linksTo(link).map(surface))].filter((element) => element !== own)
    for (const element of lit) element.classList.add('is-cross-lit')
  }
  document.addEventListener('pointerover', (event) => light(event.target))
  document.addEventListener('pointerout', (event) => {
    const next = event.relatedTarget instanceof view.Element ? event.relatedTarget.closest(LINKS) : null
    if (next !== current) clear()
  })
  document.addEventListener('focusin', (event) => light(event.target))
  document.addEventListener('focusout', clear)
}
