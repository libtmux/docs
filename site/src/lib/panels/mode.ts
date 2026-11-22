/**
 * Panel mode: an opt-in way to read any page of the site. The page's article becomes the main panel of a workspace
 * of movable panels, and a link in a panel opens the linked page in a panel.
 *
 * The mode is a reader's choice kept in the browser. Nothing on the site links to it: `?panels=1` turns it on,
 * `?panels=0` or the workspace's Exit button turns it off. A page the reader never opted into is untouched.
 */

/** Where the choice is kept. */
export const MODE_KEY = 'libtmux-docs.panel-mode'
/** The query parameter that sets the choice from an address. */
export const MODE_PARAM = 'panels'
/** Set on the root element while the mode is on, from the first paint, so the page's own body can wait for the workspace. */
export const MODE_ATTRIBUTE = 'data-panels'
/** Set on the root element once the workspace has drawn. */
export const READY_ATTRIBUTE = 'data-panels-ready'

/**
 * Read the choice from the address and storage, remember an explicit one, and set `data-panels` on the root.
 * Returns whether the mode is on.
 *
 * `?panels=1` and `?panels=0` are the only values that choose; anything else leaves the stored choice. A choice that
 * storage kept is removed from the address, so a reload or a shared link carries no stale value. Where storage is
 * blocked the choice lasts for this page: `?panels=1` stays in the address so a reload keeps it.
 *
 * This runs in `<head>` before the body is parsed and again after each router swap, so it is serialized into the
 * page and must not refer to anything outside itself.
 */
export function applyPanelMode(doc: Document, key: string, param: string, attribute: string): boolean {
  const win = doc.defaultView!
  const url = new URL(win.location.href)
  const asked = url.searchParams.get(param)
  const choice = asked === '1' || asked === '0' ? asked : null
  let stored: string | null = null
  let kept = true
  try {
    if (choice) win.localStorage.setItem(key, choice)
    stored = win.localStorage.getItem(key)
  } catch { kept = false }
  const on = choice ? choice === '1' : stored === '1'
  doc.documentElement.toggleAttribute(attribute, on)
  if (choice && (kept || !on)) {
    url.searchParams.delete(param)
    try { win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`) } catch { /* The address keeps the parameter. */ }
  }
  return on
}

/** The address of a page with the mode turned off, which a full load applies and remembers. */
export function exitUrl(href: string, origin: string): string {
  const url = new URL(href, origin)
  url.searchParams.set(MODE_PARAM, '0')
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Keep the mode's start-up attached to a document: apply the choice after each router swap, which replaces the
 * root's attributes, and mount the workspace when it is on. The workspace's code loads only then, so a reader who
 * never opted in downloads none of it. A workspace that fails to load or draw leaves the page as it was.
 */
export function watchPanelMode(doc: Document, load: () => Promise<{ mountPanelMode(doc: Document): unknown }>): void {
  const mount = () => {
    if (!doc.documentElement.hasAttribute(MODE_ATTRIBUTE)) return
    load().then((workspace) => workspace.mountPanelMode(doc)).catch(() => {
      doc.documentElement.removeAttribute(MODE_ATTRIBUTE)
      doc.documentElement.removeAttribute(READY_ATTRIBUTE)
    })
  }
  doc.addEventListener('astro:after-swap', () => { applyPanelMode(doc, MODE_KEY, MODE_PARAM, MODE_ATTRIBUTE) })
  // The router also fires this after the first load, so the mount below may already have run: mounting is idempotent.
  doc.addEventListener('astro:page-load', mount)
  mount()
}

/** The path of a page below its tree's base, which a panel header shows: `reference/tmux-pane-capture`, or `index`. */
export function pagePath(pathname: string, base: string): string {
  const root = `${base.replace(/\/+$/, '')}/`
  const rest = pathname.startsWith(root) ? pathname.slice(root.length) : pathname
  return rest.replace(/^\/+|\/+$/g, '') || 'index'
}

export type LinkScope = 'tree' | 'origin'

/**
 * Where a link in a panel goes without leaving the workspace: the path to fetch, or nothing when the browser
 * should follow it. Only a page of this site can open in a panel: the same origin, a directory URL, not the page
 * the panel is on with a fragment. `tree` also requires the page to be in this tree, so a link out of a port's
 * pages leaves the workspace; `origin` takes any page of the site, which is what a linked panel needs for another port.
 */
export function panelHref(href: string, origin: string, base: string, current: string, scope: LinkScope = 'tree'): string | undefined {
  let url: URL
  try { url = new URL(href, origin) } catch { return undefined }
  const root = `${base.replace(/\/+$/, '')}/`
  if (url.origin !== origin || !url.pathname.endsWith('/')) return undefined
  if (scope === 'tree' && !url.pathname.startsWith(root)) return undefined
  if (url.pathname === current && url.hash) return undefined
  url.searchParams.delete(MODE_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}
