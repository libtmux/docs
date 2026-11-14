/**
 * The API reference's columns view: the tree beside the page (the default), or
 * Miller columns with the page beside them, both sharing one selection.
 *
 * The page is complete without this script; the view switch is an enhancement
 * that stays hidden until it runs. The choice lasts for the visit (session
 * storage) and the address (`?view=columns`); it is never remembered across
 * visits, so the default stays the tree.
 */
import { apiSource, type ApiSource } from '../../../lib/columns/api-hierarchy'
import { API_COLUMN_DEFAULTS, configCall, layoutVariant, mergeColumns, variantLayout, type Layout } from '../../../lib/columns/config'
import { parseUrlState, serializeUrlState, type View } from '../../../lib/columns/url-state'
import type { ApiTreeJson } from '../../../lib/api-search'
import type { ColumnsConfig, Variant } from '../../../lib/columns/types'
import { apiPageHtml, nodeMark, nounFor } from './api-page'
import { mountMiller, type MillerHandle } from './miller'

export const VIEW_KEY = 'libtmux:api-view'

const read = (): string | null => { try { return sessionStorage.getItem(VIEW_KEY) } catch { return null } }
const write = (view: View) => { try { sessionStorage.setItem(VIEW_KEY, view) } catch { /* private mode: the URL still carries the choice */ } }

/** The view this load opens in: the address wins, then the visit's last choice, then the tree. */
export function initialView(search: string): View {
  const q = parseUrlState(search).view
  if (q) return q
  const stored = read()
  return stored === 'columns' ? 'columns' : 'tree'
}

export interface ApiColumnsInit {
  layout?: Layout
  columns?: Partial<ColumnsConfig>
}

/**
 * The reference root this page is served under. The page names its root, and a
 * dev server that serves the reference elsewhere has the page's own path
 * instead; the root is whichever one the address sits below.
 */
export function referenceRoot(named: string, pathname: string): string {
  if (!named || pathname.startsWith(named)) return named
  const at = pathname.indexOf('/reference/')
  return at < 0 ? named : pathname.slice(0, at + '/reference/'.length)
}

let tree: Promise<ApiTreeJson> | undefined
const load = (src: string) => (tree ??= fetch(src).then((r) => { if (!r.ok) throw new Error(`tree ${r.status}`); return r.json() as Promise<ApiTreeJson> }))

/**
 * Wire one page's bar. `host` is the element that holds the bar, the config
 * row and the columns view; the tree column and the page are the page's own.
 */
export function mountApiColumns(host: HTMLElement, init: ApiColumnsInit = {}): { setView(view: View): void; destroy(): void } {
  const root = document.documentElement
  const nav = document.getElementById('api-nav')
  const view = host.querySelector<HTMLElement>('[data-api-columns-view]')!
  const bar = host.querySelector<HTMLElement>('[data-api-columns-bar]')!
  const cfg = host.querySelector<HTMLElement>('[data-cfg-row]')
  const base = referenceRoot(host.dataset.base ?? '', location.pathname)
  const portName = host.dataset.portName ?? ''
  const pageSymbol = nav?.dataset.symbol ?? ''
  const defaults = { view: 'tree' as View, variant: 'c' as Variant, columns: mergeColumns(API_COLUMN_DEFAULTS, init.columns) }
  let miller: MillerHandle | undefined
  let source: ApiSource | undefined
  let current: View = 'tree'
  let failed = false

  const pageNode = () => {
    if (!source) return undefined
    return (pageSymbol ? source.find(`sym:${pageSymbol}`) : undefined) ?? source.nodeForHref(location.pathname) ?? source.find(source.root)
  }

  const writeUrl = () => {
    const state = miller?.state()
    const next = current === 'columns' && state
      ? serializeUrlState(location.search, { view: 'columns', variant: state.variant, at: state.at, columns: state.columns }, { ...defaults, at: pageNode()?.id })
      : serializeUrlState(location.search, { view: 'tree', columns: defaults.columns }, defaults)
    if (next !== location.search) history.replaceState(history.state, '', `${location.pathname}${next}${location.hash}`)
  }

  /** The columns fill what is left of the viewport below the page's own chrome. */
  const fit = () => {
    if (root.dataset.apiView !== 'columns') return
    root.style.setProperty('--api-columns-top', `${Math.round(view.getBoundingClientRect().top + window.scrollY)}px`)
  }
  window.addEventListener('resize', fit)

  const syncConfig = () => {
    bar.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === current)))
    if (!cfg) return
    cfg.hidden = current !== 'columns' || !miller
    if (!miller) return
    const c = miller.config()
    const layout = variantLayout(c.variant)
    cfg.querySelectorAll<HTMLElement>('[data-cfg-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cfgLayout === layout)))
    cfg.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cfg]').forEach((el) => {
      const k = el.dataset.cfg as keyof ColumnsConfig
      const v = c.columns[k]
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v)
      else el.value = k === 'paginate' ? (v ? '1' : '0') : String(v)
    })
    const size = cfg.querySelector<HTMLSelectElement>('[data-cfg="pageSize"]')
    if (size) size.disabled = !c.columns.paginate
    const code = cfg.querySelector('[data-cfg-code]')
    if (code) code.textContent = configCall(layout, c.columns)
    fit()
  }

  async function ensureMiller(): Promise<boolean> {
    if (miller) return true
    if (failed) return false
    view.setAttribute('aria-busy', 'true')
    try {
      const json = await load(nav?.dataset.src && base === host.dataset.base ? nav.dataset.src : `${base}tree.json`)
      source = apiSource(json, { base, portName })
    } catch {
      failed = true
      view.removeAttribute('aria-busy')
      view.innerHTML = '<p class="api-columns__error" role="status">The columns did not load. The tree and the page are complete without them.</p>'
      return false
    }
    const url = parseUrlState(location.search, ['c', 'f'])
    const variant = url.variant ?? layoutVariant(init.layout ?? 'columns')
    const at = (url.at && source.find(url.at)?.id) || pageNode()?.id
    view.replaceChildren()
    view.removeAttribute('aria-busy')
    miller = mountMiller(view, {
      source, variant, variants: ['c', 'f'], at, columnTools: true, columns: mergeColumns(defaults.columns, url.columns),
      height: 'fill', address: false, label: `${portName} API`,
      page: (node, context) => apiPageHtml(source!, node, context, portName),
      mark: nodeMark, noun: nounFor,
      onChange: () => { writeUrl(); syncConfig() },
    })
    return true
  }

  async function setView(next: View, o: { place?: boolean } = {}) {
    if (next === 'columns') {
      current = 'columns'
      write('columns')
      root.dataset.apiView = 'columns'
      fit()
      if (!(await ensureMiller())) { current = 'tree'; write('tree'); root.dataset.apiView = 'tree' }
      else {
        // The tree's selection is the page; coming back from the tree opens columns on it.
        const place = pageNode()
        if (o.place && place) miller!.select(place.id)
        miller!.render()
      }
    } else {
      // Columns to tree: the page is the tree's selection, so a different selection means another page.
      const target = miller && source ? source.find(miller.current()) : undefined
      const place = pageNode()
      current = 'tree'
      write('tree')
      root.dataset.apiView = 'tree'
      if (target && place && target.id !== place.id && target.href) {
        history.replaceState(history.state, '', `${location.pathname}${serializeUrlState(location.search, { view: 'tree', columns: defaults.columns }, defaults)}`)
        location.assign(target.href)
        return
      }
    }
    syncConfig()
    writeUrl()
  }

  const onClick = (e: Event) => {
    const t = e.target as Element
    const b = t.closest<HTMLElement>('[data-view]')
    if (b && bar.contains(b)) { void setView(b.dataset.view as View, { place: true }); return }
    // The full page is the tree's page: leave the columns view for it.
    if (view.contains(t) && t.closest('[data-open-page]')) write('tree')
    const lay = cfg && t.closest<HTMLElement>('[data-cfg-layout]')
    if (lay && miller) { miller.set({ variant: layoutVariant(lay.dataset.cfgLayout as Layout) }); syncConfig(); writeUrl() }
  }
  const onChange = (e: Event) => {
    const el = (e.target as Element).closest<HTMLInputElement | HTMLSelectElement>('[data-cfg]')
    if (!el || !miller) return
    const k = el.dataset.cfg as keyof ColumnsConfig
    const value = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : k === 'paginate' ? el.value === '1' : k === 'pageSize' ? Number(el.value) : el.value
    miller.set({ columns: { [k]: value } })
  }
  host.addEventListener('click', onClick)
  host.addEventListener('change', onChange)

  current = initialView(location.search)
  root.dataset.apiView = current
  syncConfig()
  if (current === 'columns') void setView('columns')

  return {
    setView: (v) => { void setView(v) },
    destroy() { window.removeEventListener('resize', fit); host.removeEventListener('click', onClick); host.removeEventListener('change', onChange); miller?.destroy() },
  }
}
