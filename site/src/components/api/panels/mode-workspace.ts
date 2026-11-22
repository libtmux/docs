/**
 * The browser half of panel mode: it lifts the page's own article into the main panel of a workspace, opens linked
 * pages in panels beside it, and keeps the arrangement.
 *
 * Panels are elements that move between layouts, never markup that is drawn again, so a page keeps its scroll, its
 * listeners and its focus. The arrangement is a layout tree (`lib/panels/layout.ts`) saved per browser; the shared
 * `panel-dock.ts` handles dragging a header, Alt+Arrow and the splitters.
 */
import { grow, insertBeside, leaves, moveLeaf, nudgeLeaf, pairPercent, prune, removeLeaf, swapLeaves, type Arrow, type Node as Tree, type ViewNode, type ViewSplit } from '../../../lib/panels/layout'
import { readLinked, type LinkedPanel } from '../../../lib/panels/linked'
import { MODE_ATTRIBUTE, READY_ATTRIBUTE, exitUrl, pagePath, panelHref } from '../../../lib/panels/mode'
import { LAYOUT_KEY, LINKED_OPEN_BY_DEFAULT, MAIN_PANEL, parseLayout, reconcile, type ModeLayout } from '../../../lib/panels/mode-layout'
import { browserStorage, panelStore, type PanelStorage } from '../../../lib/panels/persist'
import { attachDock, attachSplitters, type Drop } from './panel-dock'
import { SHELL_HTML, linkedRegion, pageRegion } from './mode-markup'
import panelStyles from '../../../styles/panels.css?inline'

/** A panel opened with Shift and a click lasts for the visit: its page cannot be rebuilt from a saved layout. */
const isEphemeral = (id: string): boolean => id.startsWith('page:')
const textOf = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

export interface ModeOptions {
  /** Where the arrangement is kept. Defaults to `localStorage`, which may be blocked. */
  storage?: PanelStorage
  /** Leave the workspace for a full page load, which is what turning the mode off is. */
  navigate?: (url: string) => void
}

export interface ModeHandle { root: HTMLElement; destroy(): void }

/**
 * Draw the workspace around the page this document shows. Returns nothing when there is no page article to lift,
 * which leaves the page as it is, or when the workspace is already drawn.
 */
export function mountPanelMode(doc: Document = document, options: ModeOptions = {}): ModeHandle | undefined {
  const win = doc.defaultView!
  const html = doc.documentElement
  if (doc.querySelector('[data-panels-root]')) return undefined
  const article = doc.querySelector<HTMLElement>('main#content')
  if (!article) { html.removeAttribute(MODE_ATTRIBUTE); return undefined }

  const base = html.dataset.shellBase ?? '/'
  const origin = win.location.origin
  const store = panelStore(options.storage ?? browserStorage())
  const navigate = options.navigate ?? ((url: string) => win.location.assign(url))
  const regions = new Map<string, HTMLElement>()
  const sequence = new Map<string, number>()
  const pages = new Map<string, string>([[MAIN_PANEL, win.location.pathname]])
  let linked: LinkedPanel[] = []
  let active = MAIN_PANEL
  let splits: ViewSplit[] = []
  let counter = 0
  /** Nothing is saved until the reader changes something, so a page's own defaults are never frozen by looking at it. */
  let touched = false

  const root = doc.createElement('div')
  root.className = 'pw pw--mode'
  root.dataset.panelsRoot = ''
  root.setAttribute('data-pagefind-ignore', 'all')
  root.innerHTML = SHELL_HTML
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const work = $('[data-route-work]')
  const list = $('[data-panel-list]')
  const summary = $('[data-panels-summary]')
  const menu = $<HTMLDetailsElement>('[data-panels-menu]')
  const live = $('[data-live]')

  const nameOf = (id: string) => textOf(regions.get(id)?.querySelector('.pw__title')) || id
  const announce = (text: string) => { live.textContent = text }
  const openDefaults = () => [MAIN_PANEL, ...linked.slice(0, LINKED_OPEN_BY_DEFAULT).map((panel) => panel.id)]
  const heading = (scope: ParentNode, fallback: string) => textOf(scope.querySelector('main#content h1')) || fallback

  /** The linked panels a page offers, replacing the ones for the page before it. */
  function takeLinked(scope: ParentNode, title: string) {
    linked = readLinked(scope, title)
    for (const id of regions.keys()) if (id.startsWith('link:')) regions.delete(id)
    for (const panel of linked) regions.set(panel.id, linkedRegion(doc, panel, linked.filter((other) => other.id !== panel.id)))
  }

  const mainRegion = pageRegion(doc, { id: MAIN_PANEL, title: heading(doc, doc.title), loc: pagePath(win.location.pathname, base) })
  regions.set(MAIN_PANEL, mainRegion)
  takeLinked(doc, heading(doc, doc.title))

  let layout: ModeLayout = reconcile(parseLayout(store.read<unknown>(LAYOUT_KEY, null)), [...regions.keys()], openDefaults())

  function persist() {
    if (!touched) return
    let tree: Tree | null = structuredClone(layout.tree)
    for (const id of leaves(tree)) if (isEphemeral(id) && tree) tree = removeLeaf(tree, id)
    if (tree) store.write(LAYOUT_KEY, { v: 1, tree, closed: layout.closed.filter((id) => !isEphemeral(id)) } satisfies ModeLayout)
  }

  // ---- Drawing: panels move between containers; their content is never re-created.

  function element(className: string): HTMLElement {
    const el = doc.createElement('div')
    el.className = className
    return el
  }

  function splitter(n: ViewSplit, k: number, i: number): HTMLElement {
    const el = element('pw__splitter')
    const before = leaves(n.kids[i]!).at(-1)!
    const after = leaves(n.kids[i + 1]!)[0]!
    el.setAttribute('role', 'separator')
    el.tabIndex = 0
    el.setAttribute('aria-orientation', n.dir === 'row' ? 'vertical' : 'horizontal')
    el.setAttribute('aria-label', `Resize between ${nameOf(before)} and ${nameOf(after)}`)
    el.setAttribute('aria-valuemin', '0')
    el.setAttribute('aria-valuemax', '100')
    el.setAttribute('aria-valuenow', String(pairPercent(n.sizes, i)))
    el.dataset.splitter = `${k}:${i}`
    return el
  }

  function build(n: ViewNode): HTMLElement {
    if ('p' in n) return regions.get(n.p)!
    const k = splits.push(n) - 1
    const box = element(`pw__split pw__split--${n.dir}`)
    const flex = grow(n.sizes)
    n.kids.forEach((kid, i) => {
      const cell = element('pw__cell')
      cell.style.flex = `${flex[i]} 1 0`
      cell.append(build(kid))
      box.append(cell)
      if (i < n.kids.length - 1) box.append(splitter(n, k, i))
    })
    return box
  }

  function render(focus?: string) {
    const scroll = new Map([...regions].map(([id, el]) => [id, el.querySelector('[data-body]')?.scrollTop ?? 0]))
    const shown = leaves(layout.tree)
    if (!shown.includes(active)) active = shown[0]!
    splits = []
    const view = prune(layout.tree, shown)!
    work.replaceChildren(build(view))
    for (const id of shown) { const body = regions.get(id)!.querySelector('[data-body]'); if (body) body.scrollTop = scroll.get(id) ?? 0 }
    for (const [id, el] of regions) el.classList.toggle('is-active', id === active && shown.includes(id))
    renderList()
    persist()
    if (focus) regions.get(focus)?.querySelector<HTMLElement>('[data-head]')?.focus({ preventScroll: true })
  }

  function renderList() {
    const shown = new Set(leaves(layout.tree))
    list.replaceChildren(...[...regions.keys()].map((id) => {
      const item = doc.createElement('li')
      const button = doc.createElement('button')
      button.type = 'button'
      button.dataset.act = `toggle:${id}`
      button.setAttribute('aria-pressed', String(shown.has(id)))
      button.textContent = nameOf(id)
      const state = doc.createElement('small')
      state.textContent = shown.has(id) ? 'open' : 'closed'
      button.append(' ', state)
      item.append(button)
      return item
    }))
    const closed = regions.size - shown.size
    summary.textContent = closed ? `Panels (${closed} closed)` : 'Panels'
  }

  // ---- Changing the arrangement

  function apply(tree: Tree, id: string, said: string) {
    touched = true
    layout = { ...layout, tree }
    active = id
    announce(said)
    render(id)
  }

  const dock = (id: string, target: string, zone: Drop) => {
    const tree = zone === 'swap' ? swapLeaves(layout.tree, id, target) : moveLeaf(layout.tree, id, target, zone)
    if (tree !== layout.tree) apply(tree, id, `${nameOf(id)} ${zone === 'swap' ? `swapped with ${nameOf(target)}` : `docked ${zone} of ${nameOf(target)}`}`)
  }

  const nudge = (id: string, arrow: Arrow) => {
    const tree = nudgeLeaf(layout.tree, id, arrow)
    if (tree === layout.tree) { announce(`${nameOf(id)} is already as far ${arrow} as it goes`); return }
    apply(tree, id, `${nameOf(id)} moved ${arrow}`)
  }

  function close(id: string) {
    const open = leaves(layout.tree)
    if (!open.includes(id)) return
    if (open.length < 2) { announce('The last open panel stays open'); return }
    touched = true
    layout = { ...layout, tree: removeLeaf(layout.tree, id)!, closed: [id, ...layout.closed] }
    if (active === id) active = leaves(layout.tree)[0]!
    announce(`${nameOf(id)} panel closed. Reopen it from Panels.`)
    render(active)
  }

  function reveal(id: string) {
    if (!regions.has(id)) return
    touched = true
    if (!leaves(layout.tree).includes(id)) {
      const beside = leaves(layout.tree).includes(active) ? active : leaves(layout.tree)[0]!
      layout = { ...layout, tree: insertBeside(layout.tree, beside, id, 'right'), closed: layout.closed.filter((c) => c !== id) }
      announce(`${nameOf(id)} panel opened`)
    }
    active = id
    render(id)
  }

  /** Forget the saved arrangement and draw the page's own default. Where storage cannot forget it, the default replaces it. */
  function reset() {
    touched = !store.remove(LAYOUT_KEY)
    for (const id of regions.keys()) if (isEphemeral(id)) regions.delete(id)
    layout = reconcile(undefined, [...regions.keys()], openDefaults())
    active = MAIN_PANEL
    announce('Layout reset')
    render(MAIN_PANEL)
  }

  // ---- Pages: a link in a page opens it in the panel, or in a panel of its own.

  /** Styles the fetched page needs, and its module scripts when it comes from this tree, which this document lacks. */
  function adopt(fetched: Document, sameTree: boolean) {
    const key = (el: Element) => el.tagName === 'LINK' ? `href:${el.getAttribute('href')}` : `style:${el.getAttribute('data-vite-dev-id') ?? `${el.textContent?.length}:${el.textContent?.slice(0, 160)}`}`
    const have = new Set([...doc.head.querySelectorAll('link[rel="stylesheet"], style')].map(key))
    for (const el of fetched.head.querySelectorAll('link[rel="stylesheet"], style')) if (!have.has(key(el))) doc.head.append(doc.importNode(el, true))
    // Another tree ships its own hashed scripts; running them beside this tree's would stack their global listeners.
    if (!sameTree) return
    const scripts = new Set([...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')))
    for (const old of fetched.querySelectorAll('script[type="module"][src]')) {
      const src = old.getAttribute('src')!
      if (scripts.has(src)) continue
      doc.head.append(Object.assign(doc.createElement('script'), { type: 'module', src }))
    }
  }

  /** Scripts inserted from a parsed page do not run; a copy of each does. */
  function revive(scope: Element) {
    for (const old of scope.querySelectorAll('script')) {
      const next = doc.createElement('script')
      for (const { name, value } of old.attributes) next.setAttribute(name, value)
      next.textContent = old.textContent
      old.replaceWith(next)
    }
  }

  async function load(id: string, url: string) {
    const region = regions.get(id)
    const body = region?.querySelector<HTMLElement>('[data-body]')
    if (!region || !body) return
    const mine = (sequence.get(id) ?? 0) + 1
    sequence.set(id, mine)
    region.setAttribute('aria-busy', 'true')
    try {
      const response = await win.fetch(url, { headers: { Accept: 'text/html' } })
      if (!response.ok) throw new Error(`${response.status}`)
      const fetched = new win.DOMParser().parseFromString(await response.text(), 'text/html')
      const page = fetched.querySelector<HTMLElement>('main#content')
      if (!page) throw new Error('no page in the response')
      if (sequence.get(id) !== mine) return
      adopt(fetched, fetched.documentElement.dataset.shellBase === html.dataset.shellBase)
      body.replaceChildren(doc.importNode(page, true))
      revive(body)
      body.scrollTop = 0
      const path = new URL(url, origin).pathname
      const title = heading(fetched, fetched.title)
      pages.set(id, path)
      if (region.dataset.panelKind === 'linked') region.dataset.panelKind = 'linked-page'
      region.querySelector('.pw__title')!.textContent = title
      const loc = pagePath(path, fetched.documentElement.dataset.shellBase ?? base)
      let readout = region.querySelector('.pw__loc')
      if (!readout) {
        readout = Object.assign(doc.createElement('code'), { className: 'pw__loc' })
        region.querySelector('.pw__title')!.after(readout)
      }
      readout.textContent = loc
      readout.setAttribute('title', loc)
      if (id === MAIN_PANEL) {
        doc.title = fetched.title
        win.history.replaceState(win.history.state, '', url)
        takeLinked(fetched, title)
        layout = reconcile({ v: 1, tree: layout.tree, closed: layout.closed }, [...regions.keys()], openDefaults())
        render()
      } else renderList()
      announce(`${title} loaded`)
      doc.dispatchEvent(new win.Event('astro:page-load'))
    } catch {
      if (sequence.get(id) !== mine) return
      const note = Object.assign(doc.createElement('p'), { className: 'pw__why' })
      note.setAttribute('role', 'status')
      note.append('The page did not load, and this panel is as it was left. ')
      note.append(Object.assign(doc.createElement('a'), { href: url, textContent: 'Open the page on its own.' }))
      note.querySelector('a')!.setAttribute('data-panel-native', '')
      body.prepend(note)
    } finally {
      region.removeAttribute('aria-busy')
    }
  }

  function openPage(url: string) {
    const id = `page:${++counter}`
    regions.set(id, pageRegion(doc, { id, title: 'Page', loc: url }))
    const beside = leaves(layout.tree).includes(active) ? active : leaves(layout.tree)[0]!
    layout = { ...layout, tree: insertBeside(layout.tree, beside, id, 'right') }
    active = id
    render(id)
    void load(id, url)
  }

  // ---- Events

  const onClick = (event: Event) => {
    const e = event as MouseEvent
    const t = e.target as Element
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act
    if (act && root.contains(t)) {
      // A panel id holds a colon (`link:py`), so the verb is what comes before the first one.
      const colon = act.indexOf(':')
      const verb = colon < 0 ? act : act.slice(0, colon)
      const id = colon < 0 ? undefined : act.slice(colon + 1)
      if (verb === 'close' && id) close(id)
      else if (verb === 'toggle' && id) { menu.open = false; if (leaves(layout.tree).includes(id)) close(id); else reveal(id) }
      else if (verb === 'reset') reset()
      else if (verb === 'exit') navigate(exitUrl(win.location.href, origin))
      return
    }
    const a = t.closest<HTMLAnchorElement>('a[href]')
    if (!a || !root.contains(a) || a.hasAttribute('data-panel-native')) return
    const region = a.closest<HTMLElement>('[data-region]')
    if (!region) return
    if (a.dataset.panelOpen) { e.preventDefault(); reveal(a.dataset.panelOpen); return }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || a.hasAttribute('download')) return
    const id = region.dataset.region!
    const here = pages.get(id) ?? win.location.pathname
    const target = new URL(a.href, origin)
    // A fragment of the panel's own page scrolls that panel, not whichever panel holds the same id. A bare `#id` in a
    // fetched page resolves against this document, so the markup says whether it was the page's own.
    if (target.hash && (a.getAttribute('href')!.startsWith('#') || (target.origin === origin && target.pathname === here))) {
      e.preventDefault()
      const anchor = decodeURIComponent(target.hash.slice(1))
      ;[...region.querySelectorAll('[id]')].find((el) => el.id === anchor)?.scrollIntoView()
      return
    }
    const href = panelHref(a.href, origin, base, here, region.dataset.panelKind?.startsWith('linked') || a.dataset.panelLoad !== undefined ? 'origin' : 'tree')
    if (!href) return
    e.preventDefault()
    e.stopPropagation()
    if (e.shiftKey) openPage(href)
    else void load(id, href)
  }

  const activate = (e: Event) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-region]')?.dataset.region
    if (!id || id === active || !root.contains(e.target as Node)) return
    active = id
    for (const [key, el] of regions) el.classList.toggle('is-active', key === active)
  }

  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && menu.open) { menu.open = false; summary.focus() }
  }

  /** The workspace fills the window below whatever the page draws above it, which is measured where it lands. */
  const fit = () => root.style.setProperty('--pw-top', `${Math.max(0, Math.round(root.getBoundingClientRect().top + win.scrollY))}px`)

  // A router swap replaces the head's styles, so the workspace's own are put back before every draw, as text and not as a
  // stylesheet link the swap would drop with the page it came from.
  if (!doc.head.querySelector('style[data-panels-style]')) {
    doc.head.append(Object.assign(doc.createElement('style'), { textContent: panelStyles }))
    doc.head.lastElementChild!.setAttribute('data-panels-style', '')
  }

  // Build and draw before the page is touched, so a failure leaves the page as it was.
  render()
  const wrapper = article.closest<HTMLElement>('body > div[data-pagefind-filter]') ?? article
  wrapper.before(root)
  mainRegion.querySelector('[data-body]')!.append(article)
  fit()
  html.setAttribute(READY_ATTRIBUTE, '')

  const detachDock = attachDock(root, { move: dock, nudge })
  const detachSplitters = attachSplitters(work, { split: (k) => splits[k], scale: () => 1, commit: () => { touched = true; persist() } })
  root.addEventListener('click', onClick, true)
  root.addEventListener('pointerdown', activate)
  root.addEventListener('focusin', activate)
  root.addEventListener('keydown', onKey)
  win.addEventListener('resize', fit)
  const destroy = () => {
    detachDock()
    detachSplitters()
    root.removeEventListener('click', onClick, true)
    root.removeEventListener('pointerdown', activate)
    root.removeEventListener('focusin', activate)
    root.removeEventListener('keydown', onKey)
    win.removeEventListener('resize', fit)
  }
  doc.addEventListener('astro:before-swap', destroy, { once: true })

  return { root, destroy }
}
