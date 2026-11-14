/**
 * MillerColumns: cascading navigation over any hierarchy.
 *
 * Each selection opens the next level to the right and the path stays on the
 * left. Seven variants share one state: A columns, B preview, C content pane,
 * D collapsed spines, E tree, F single column with Up and Back, G columns with
 * a filter, paginator and virtual list per level. The stage width picks the
 * layout (`lib/columns/bands.ts`); the same selection renders as columns,
 * spines, a trail or a drill-down stack, so nothing is lost going narrow and
 * back.
 *
 * The module owns the document inside `root` and nothing outside it. A page
 * supplies the hierarchy (`ColumnSource`), the markup of the page a selection
 * opens, and, when it wants them, the address and toolbar.
 */
import { INSPECTOR_W, COLUMN_MAX, COLUMN_MIN, PANE_MAX, PANE_MIN, describePlan, modeFor, planLayout, type LayoutPlan } from '../../../lib/columns/bands'
import { mergeColumns } from '../../../lib/columns/config'
import { intentFor, type Intent, type KeyContext, type Surface } from '../../../lib/columns/keys'
import { clampPage, matching, moveIndex, pageCount, pageOf, pageRows, pageSpan, scrollToReveal, virtualWindow, withHeadings, type Row } from '../../../lib/columns/list-window'
import { backTarget, discardedColumns, inScope, listCount, listFor, pathTo, singleBack, singleSelect, singleUp, type Position } from '../../../lib/columns/selection'
import { COLUMN_DEFAULTS, VARIANT_IDS, type ColumnNode, type ColumnSource, type ColumnsConfig, type Variant } from '../../../lib/columns/types'
import { ICON, esc } from './html'

export { describePlan }

export interface PageContext {
  /** The content pane or the single column's page, against the read-only preview of B and D. */
  full: boolean
  path: ColumnNode[]
  source: ColumnSource
}

export interface MillerState {
  variant: Variant
  at: string
  width: string
  columns: ColumnsConfig
  pane: boolean
}

export interface MillerOptions {
  source: ColumnSource
  variant?: Variant
  /** Variants the host allows; a page scoped to C and F lists only those. */
  variants?: readonly Variant[]
  at?: string
  columns?: Partial<ColumnsConfig>
  /** Give the column variants (A to D and F) G's filter, pages and virtual rows. */
  columnTools?: boolean
  /** The markup of the page a node opens. */
  page: (node: ColumnNode, context: PageContext) => string
  /** The kind mark before a row's label. */
  mark?: (node: ColumnNode) => string
  /** What a node's children are called: "Members". */
  noun?: (node: ColumnNode) => string
  /** The tree's accessible name. */
  label?: string
  /** A pixel height, or `fill` to take the height of `root`. */
  height?: number | 'fill'
  /** The stage width in px, or `fit`; a width wider than the frame scales down to fit. */
  width?: string
  /** Show the address line when no trail is needed. */
  address?: boolean
  onSelect?: (node: ColumnNode) => void
  onChange?: (state: MillerState) => void
  onRender?: (plan: LayoutPlan, state: MillerState) => void
}

export interface MillerHandle {
  current(): string
  select(id: string): boolean
  render(): void
  plan(): LayoutPlan
  state(): MillerState
  config(): { variant: Variant; columns: ColumnsConfig }
  set(patch: { variant?: Variant; columns?: Partial<ColumnsConfig> }): void
  setWidth(width: string): void
  destroy(): void
}

interface Opts { focus?: boolean | string; animate?: boolean; from?: number | null; col?: number | null; sheet?: boolean; pane?: boolean; say?: boolean; list?: string; came?: string | null; back?: boolean }

export function mountMiller(root: HTMLElement, options: MillerOptions): MillerHandle {
  const { source } = options
  const allowed = (options.variants ?? VARIANT_IDS) as readonly Variant[]
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)
  if (!root.querySelector('[data-viewport]')) {
    root.insertAdjacentHTML('afterbegin', '<div class="miller__viewport" data-viewport><div class="miller__stage" data-stage></div></div><div class="sr-only" data-live aria-live="polite"></div>')
  }
  root.classList.add('miller')
  const viewport = $('[data-viewport]')!
  const stage = $('[data-stage]')!
  const live = $('[data-live]')
  const fill = options.height === 'fill'
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const ROOT = source.root
  const initial = inScope(source, options.at)?.id ?? ROOT

  const st = {
    variant: (options.variant && allowed.includes(options.variant) ? options.variant : allowed[0] ?? 'b') as Variant,
    at: initial,
    list: null as string | null,
    hist: [] as Position[],
    width: options.width ?? 'fit',
    pane: true,
    pin: null as string | null,
    sheet: true,
    came: null as string | null,
    open: {} as Record<string, boolean>,
    widths: {} as Record<number, number>,
    paneW: 0,
    col: mergeColumns(COLUMN_DEFAULTS, options.columns),
    colq: {} as Record<string, string>,
    colOpen: {} as Record<string, boolean>,
    colPage: {} as Record<string, number>,
    colSeen: {} as Record<string, string>,
    vtop: {} as Record<string, number | null>,
    colOn: Boolean(options.columnTools),
  }
  const last = { avail: 0, mode: '', lists: 0, depth: 0 }
  let busy = false
  let destroyed = false

  const node = (id: string | null | undefined): ColumnNode => (id ? source.find(id) : undefined) ?? source.find(ROOT)!
  const kids = (n: ColumnNode) => source.children(n)
  const pathOf = (n: ColumnNode) => pathTo(source, n)
  const tools = () => st.variant === 'g' || st.colOn
  const noun = (n: ColumnNode) => options.noun?.(n) ?? 'Items'
  const mark = (n: ColumnNode) => options.mark?.(n) ?? ''
  const openPath = (n: ColumnNode) => pathOf(n).forEach((x) => { if (!x.leaf) st.open[x.id] = true })
  openPath(node(st.at))

  const announce = (text: string) => { if (live) live.textContent = text }
  const paneNode = () => (st.pin && source.find(st.pin)) || node(st.at)
  const state = (): MillerState => ({ variant: st.variant, at: st.at, width: st.width, columns: { ...st.col }, pane: st.pane })

  // ---- Layout

  function applyWidth(): number {
    const avail = viewport.clientWidth
    const sim = st.width === 'fit' ? avail : Number(st.width)
    const z = sim > avail && avail > 0 ? avail / sim : 1
    if (st.width === 'fit' && fill) { stage.style.width = ''; stage.style.height = '100%' }
    else {
      stage.style.width = `${sim}px`
      stage.style.height = `${Math.round((typeof options.height === 'number' ? options.height : 600) / z)}px`
    }
    stage.style.zoom = z === 1 ? '' : String(z)
    root.dataset.zoom = z.toFixed(2)
    last.avail = avail
    return st.width === 'fit' && fill ? stage.clientWidth || avail : sim
  }

  function plan(W: number): LayoutPlan {
    const n = node(st.at)
    return planLayout({ width: W, variant: st.variant, depth: pathOf(n).length, leaf: n.leaf, pane: st.pane, widths: st.widths, paneWidth: st.paneW })
  }

  // ---- Markup

  const badges = (n: ColumnNode) => (n.count ? `<span class="miller__count">${n.count}</span>` : '')

  function rowHtml(c: ColumnNode, on: boolean, tab: boolean, extra = ''): string {
    return `<li class="miller__row" role="option" data-at="${esc(c.id)}" aria-selected="${on}" tabindex="${tab ? 0 : -1}"${tab ? ' data-focus' : ''}${extra}>` +
      `${mark(c)}<span class="miller__label">${esc(c.label)}</span>${badges(c)}${c.leaf ? '' : ICON.chevron}</li>`
  }

  function listHtml(parent: ColumnNode, sel: ColumnNode | null, focusable: boolean, cls = ''): string {
    const items = kids(parent)
    const tabbed = focusable && !sel ? items[0] : undefined
    return `<ul class="miller__list${cls}" role="listbox" aria-label="${esc(parent.label)}">` + withHeadings(items).map((r) => {
      if (r.group !== undefined) return `<li class="miller__group" role="presentation">${esc(r.group)}</li>`
      const on = Boolean(sel && r.node.id === sel.id)
      return rowHtml(r.node, on, focusable && (on || r.node === tabbed))
    }).join('') + '</ul>'
  }

  function trailHtml(list: readonly ColumnNode[], current: boolean): string {
    return `<ol class="miller__trail" aria-label="Path">` + list.map((x, i) =>
      `<li>${i === list.length - 1 && current ? `<span aria-current="location">${esc(x.label)}</span>` : `<a href="#" data-at="${esc(x.id)}">${esc(x.label)}</a>`}</li>`).join('') + '</ol>'
  }

  const grip = (label: string, now: number, key: string | number, min: number, max: number) =>
    `<div class="miller__grip" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${esc(label)}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${now}" data-grip="${key}"></div>`

  const pageHtml = (n: ColumnNode, full: boolean) => options.page(n, { full, path: pathOf(n), source })

  function topHtml(p: LayoutPlan, crumbs: boolean): string {
    const open = st.variant === 'c' && !st.pane ? '<button type="button" class="miller__btn" data-open-pane>Open page</button>' : ''
    if (!crumbs && options.address === false && !open) return ''
    const n = node(st.at)
    const addr = options.address ? `<span class="miller__addr">${esc(n.href ?? '')}</span>` : ''
    return `<div class="miller__top">${crumbs ? trailHtml(pathOf(n), true) : addr}${open}</div>`
  }

  function inspectorHtml(n: ColumnNode): string {
    const t = pathOf(n)
    const siblings = n.id !== ROOT && n.parent ? kids(node(n.parent)).length : 1
    const facts: [string, string][] = [['Kind', n.kind], ['Level', `${t.length - 1} of ${t.length - 1 + (n.leaf ? 0 : 1)}`], ['Siblings', String(siblings)], ['Children', n.leaf ? 'none' : String(kids(n).length)]]
    return `<aside class="miller__inspector" aria-label="Inspector" style="width:${INSPECTOR_W}px"><h2 class="miller__sub">Inspector</h2><dl class="miller__facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="miller__url">${esc(n.href ?? '')}</p></aside>`
  }

  function columnsHtml(p: LayoutPlan): string {
    const n = node(st.at)
    const path = pathOf(n)
    let spines = ''
    let cols = ''
    for (let k = p.hidden; k < p.lists; k++) {
      const parent = path[k]!
      const sel = path[k + 1] ?? null
      if (k < p.hidden + p.spines) {
        const lab = (sel ?? parent).label
        spines += `<button type="button" class="miller__spine" data-spine="${k}" aria-label="Back to ${esc(lab)}" title="${esc(lab)}"><span>${esc(lab)}</span></button>`
        continue
      }
      const w = p.resizable ? st.widths[k] || p.colW : p.colW
      const active = k === Math.max(0, path.length - 2)
      cols += `<section class="miller__col${active ? ' is-active' : ''}${tools() ? ' miller__col--g' : ''}" data-col="${k}" style="width:${w}px">` +
        (tools() ? gColumn(parent, sel, active) : `<h3 class="miller__colhead">${esc(parent.label)}</h3>${listHtml(parent, sel, active)}`) +
        (p.resizable ? grip(`Width of the ${parent.label} column`, w, k, COLUMN_MIN, COLUMN_MAX) : '') + '</section>'
    }
    if (p.preview) cols += `<section class="miller__preview" data-preview aria-label="Preview" style="width:${p.previewW}px">${pageHtml(n, false)}</section>`
    let body = `${spines ? `<div class="miller__spines" data-spines>${spines}</div>` : ''}<div class="miller__strip" data-strip>${cols}</div>`
    if (p.pane) {
      body += `<aside class="miller__pane" data-pane aria-label="Page" style="width:${p.paneW}px">${p.resizable ? grip('Width of the page', p.paneW, 'pane', PANE_MIN, PANE_MAX) : ''}` +
        `<div class="miller__panehead"><span class="miller__panekind">${st.pin ? 'Pinned page' : 'Page, following the selection'}</span>` +
        `<button type="button" class="miller__btn" data-pin aria-pressed="${Boolean(st.pin)}">${st.pin ? 'Unpin' : 'Pin'}</button>` +
        `<button type="button" class="miller__btn miller__close" data-close aria-label="Close the page (Escape)">${ICON.close}</button></div>` +
        `<div class="miller__panebody">${pageHtml(paneNode(), true)}</div></aside>`
      if (p.inspector) body += inspectorHtml(paneNode())
    }
    return `${topHtml(p, p.crumbs)}<div class="miller__body${p.center ? ' is-centered' : ''}">${body}</div>`
  }

  function treeHtml(p: LayoutPlan): string {
    const rows = (n: ColumnNode, depth: number): string => kids(n).map((k) => {
      const exp = !k.leaf && Boolean(st.open[k.id])
      const sel = k.id === st.at
      return `<li role="treeitem" class="miller__ti" data-at="${esc(k.id)}" aria-level="${depth + 1}"${k.leaf ? '' : ` aria-expanded="${exp}"`} aria-selected="${sel}" tabindex="${sel ? 0 : -1}"${sel ? ' data-focus' : ''}>` +
        `<div class="miller__row" style="--depth:${depth}"><span class="miller__twisty"${k.leaf ? '>' : ` data-twisty>${ICON.chevron}`}</span>${mark(k)}<span class="miller__label">${esc(k.label)}</span>${badges(k)}</div>` +
        (exp ? `<ul role="group">${rows(k, depth + 1)}</ul>` : '') + '</li>'
    }).join('')
    let html = rows(node(ROOT), 0)
    if (!/data-focus/.test(html)) html = html.replace('tabindex="-1"', 'tabindex="0" data-focus')
    return `<div class="miller__tree"${p.treeW ? ` style="width:${p.treeW}px"` : ''}><ul role="tree" aria-label="${esc(options.label ?? node(ROOT).label)}">${html}</ul></div>`
  }

  /** Phones: one level per screen with Back and the trail; a preview or page is a pushed screen. */
  function stackHtml(p: LayoutPlan): string {
    const n = node(st.at)
    const v = st.variant
    if (v === 'e') {
      const over = st.sheet && st.at !== ROOT ? pageHtml(n, true) : null
      return `<div class="miller__stackbar">${over ? `<button type="button" class="miller__back" data-back>${ICON.back}<span>Tree</span></button>` : `<span class="miller__screentitle">${esc(node(ROOT).label)}</span>`}</div>` +
        `<div class="miller__screen" data-screen>${over ? `<div class="miller__sheet">${over}</div>` : treeHtml(p)}</div>`
    }
    const base = n.leaf ? node(n.parent) : n
    let over: string | null = null
    if ((v === 'b' || v === 'd' || v === 'f' || v === 'g') && n.leaf && st.sheet) over = pageHtml(n, false)
    if (v === 'c' && st.pane) over = pageHtml(paneNode(), true)
    const up = over ? base : base.id !== ROOT ? node(base.parent) : null
    const hi = n.leaf ? n : st.came ? source.find(st.came) ?? null : null
    const list = over ? '' : `<h2 class="miller__screentitle">${esc(base.label)}</h2>${listHtml(base, hi, true, ' miller__list--touch')}`
    return `<div class="miller__stackbar">${up ? `<button type="button" class="miller__back" data-back aria-label="Back to ${esc(up.label)}">${ICON.back}<span>${esc(up.label)}</span></button>` : ''}` +
      `${trailHtml(pathOf(over ? (v === 'c' ? paneNode() : n) : base), true)}</div>` +
      `<div class="miller__screen" data-screen>${over ? `<div class="miller__sheet">${over}</div>` : list}</div>`
  }

  // ---- Single column (F)

  function listNode(): ColumnNode {
    let l = st.list ? inScope(source, st.list) : undefined
    if (!l || l.leaf) { l = node(listFor(source, node(st.at))); st.list = l.id }
    return l
  }

  function singleHtml(p: LayoutPlan): string {
    const list = listNode()
    const n = node(st.at)
    const up = list.id !== ROOT ? node(list.parent) : null
    const prev = backTarget(source, { at: st.at, list: list.id, hist: st.hist })
    const sel = n.id !== list.id ? n : null
    const title = typeof list.data?.symbol === 'string' ? `<code>${esc(list.data.qualifiedName ?? list.data.symbol)}</code>` : esc(list.label)
    const head = `<div class="miller__shead"><div class="miller__fnav">` +
      (up ? `<a href="#" class="miller__up" data-f-up aria-label="Up to ${esc(up.label)}">${ICON.up}<span>${esc(up.label)}</span></a>` : `<span class="miller__up miller__fnav-off" aria-hidden="true">${ICON.up}<span>Top level</span></span>`) +
      `<button type="button" class="miller__btn miller__fback" data-f-back${prev ? ` aria-label="Back to ${esc(prev.label)}" title="Back to ${esc(prev.label)}"` : ' disabled'}>${ICON.back}<span>Back</span></button></div>` +
      `<div class="miller__scope"><a href="#" class="miller__scopetitle" data-at="${esc(list.id)}">${title}</a>` +
      (tools() && st.col.search === 'button' ? searchButton(list, `Filter ${list.label}`) : '') + '</div></div>'
    return `${topHtml(p, false)}<div class="miller__body"><section class="miller__col miller__single is-active${tools() ? ' miller__col--g' : ''}" data-col="0" style="width:${p.colW}px">${head}` +
      `${tools() ? gColumn(list, sel, true, { head: false }) : listHtml(list, sel, true)}</section>` +
      `<section class="miller__detail" data-detail aria-label="Page">${pageHtml(n, true)}</section></div>`
  }

  // ---- Column tools: filter, pages, virtual rows

  const searchButton = (parent: ColumnNode, label: string) => {
    const open = Boolean(st.colOpen[parent.id] || st.colq[parent.id])
    return `<button type="button" class="miller__ctool" data-col-search="${esc(parent.id)}" aria-pressed="${open}" aria-label="${esc(label)}" title="${esc(label)}">${ICON.search}</button>`
  }

  const filteredKids = (parent: ColumnNode) => matching(kids(parent), st.colq[parent.id] ?? '')
  const vdata: Record<string, { rows: Row[]; sel: ColumnNode | null; tab: string | null; count: number }> = {}

  function vslice(pid: string, top: number, height: number): { html: string; key: string } {
    const d = vdata[pid]!
    const w = virtualWindow(d.rows.length, top, height)
    const html = d.rows.slice(w.start, w.end).map((r) =>
      r.group !== undefined ? `<li class="miller__group" role="presentation">${esc(r.group)}</li>`
        : rowHtml(r.node, Boolean(d.sel && r.node.id === d.sel.id), r.node.id === d.tab, ` aria-posinset="${r.pos + 1}" aria-setsize="${d.count}"`)).join('')
    // Spacer rows stand in for the rows outside the window, so the list keeps its full scroll height.
    const spacer = (h: number) => (h ? `<li class="miller__vspace" aria-hidden="true" role="presentation" style="height:${h}px"></li>` : '')
    return { html: spacer(w.before) + html + spacer(w.after), key: `${w.start}:${w.end}` }
  }

  function reslice(ul: HTMLElement) {
    const pid = ul.dataset.vlist
    if (!pid || !vdata[pid]) return
    const s = vslice(pid, ul.scrollTop, ul.clientHeight || 560)
    const top = ul.scrollTop
    if (ul.dataset.sliceKey !== s.key) { ul.innerHTML = s.html; ul.dataset.sliceKey = s.key; ul.scrollTop = top }
  }

  function gColumn(parent: ColumnNode, sel: ColumnNode | null, focusable: boolean, o: { head?: boolean } = {}): string {
    const C = st.col
    const pid = parent.id
    const items = filteredKids(parent)
    const total = kids(parent).length
    const n = items.length
    const q = st.colq[pid] ?? ''
    const open = C.search === 'open' || (C.search === 'button' && (Boolean(st.colOpen[pid]) || Boolean(q)))
    const size = C.pageSize
    const pages = C.paginate ? pageCount(n, size) : 1
    const selIdx = sel ? items.findIndex((x) => x.id === sel.id) : -1
    // The page follows the selection when it changes, so the current position stays in view.
    if (sel && st.colSeen[pid] !== sel.id) { st.colSeen[pid] = sel.id; if (selIdx >= 0) { st.colPage[pid] = pageOf(selIdx, size); st.vtop[pid] = null } }
    const page = clampPage(st.colPage[pid] ?? 0, n, size)
    st.colPage[pid] = page
    const rows: Row[] = C.paginate ? pageRows(items, page, size) : withHeadings(items)
    const onPage = Boolean(sel && rows.some((r) => r.node && r.node.id === sel.id))
    const first = rows.find((r) => r.node)
    const tabId = focusable ? (onPage ? sel!.id : first?.node?.id ?? null) : null
    const label = esc(parent.label)
    let head = `<div class="miller__colhead miller__colhead--g"><span>${label}</span>${C.search === 'button' ? searchButton(parent, `Filter ${parent.label}`) : ''}</div>`
    const filter = C.search !== 'off' && open
      ? `<div class="miller__cfilter"><input type="search" class="miller__cinput" data-col-q="${esc(pid)}" value="${esc(q)}" placeholder="Filter ${label}" aria-label="Filter ${label}" autocomplete="off"><span class="miller__cmeta">${n === total ? total : `${n} of ${total}`}</span></div>` : ''
    let list: string
    if (C.virtual) {
      const rowIdx = sel ? rows.findIndex((r) => r.node && r.node.id === sel.id) : -1
      vdata[pid] = { rows, sel, tab: tabId, count: n }
      let top = st.vtop[pid]
      if (top == null) top = scrollToReveal(rowIdx)
      st.vtop[pid] = Math.max(0, top)
      const s0 = vslice(pid, st.vtop[pid]!, 560)
      list = `<ul class="miller__list miller__list--virtual" data-vlist="${esc(pid)}" data-slice-key="${s0.key}" role="listbox" aria-label="${label}">${s0.html}</ul>`
    } else {
      list = `<ul class="miller__list" role="listbox" aria-label="${label}">` + rows.map((r) =>
        r.group !== undefined ? `<li class="miller__group" role="presentation">${esc(r.group)}</li>` : rowHtml(r.node, Boolean(sel && r.node.id === sel.id), r.node.id === tabId)).join('') + '</ul>'
    }
    const empty = n ? '' : `<p class="miller__cempty">No ${esc(noun(parent).toLowerCase())} match &ldquo;${esc(q)}&rdquo;. Escape clears the filter.</p>`
    const span = pageSpan(n, page, size)
    const pager = C.paginate && pages > 1
      ? `<div class="miller__pager" role="group" aria-label="Pages of ${label}"><button type="button" data-col-page="${esc(pid)}:-1"${page ? '' : ' disabled'} aria-label="Previous page">&lsaquo;</button><span>${span.from}&ndash;${span.to} of ${span.total}</span><button type="button" data-col-page="${esc(pid)}:1"${page < pages - 1 ? '' : ' disabled'} aria-label="Next page">&rsaquo;</button></div>` : ''
    if (o.head === false) head = ''
    return C.filterAt === 'bottom' ? head + list + empty + filter + pager : head + filter + list + empty + pager
  }

  // ---- Render

  function render(o: Opts = {}) {
    if (destroyed) return
    const hadFocus = stage.contains(document.activeElement)
    const W = applyWidth()
    const p = plan(W)
    const depth = pathOf(node(st.at)).length + (st.sheet ? 1 : 0) + (st.pane ? 1 : 0)
    root.dataset.layout = p.info.mode
    root.dataset.variant = st.variant
    root.dataset.lists = String(p.stack ? 1 : p.tree ? 0 : p.lists - p.hidden - p.spines)
    root.dataset.spines = String(p.spines)
    root.dataset.hidden = String(p.hidden)
    if (p.stack) stage.innerHTML = stackHtml(p)
    else if (p.single) stage.innerHTML = singleHtml(p)
    else if (p.tree) stage.innerHTML = `${topHtml(p, false)}<div class="miller__body">${treeHtml(p)}<section class="miller__detail" data-detail aria-label="Detail">${pageHtml(node(st.at), true)}</section></div>`
    else stage.innerHTML = columnsHtml(p)
    stage.querySelectorAll<HTMLElement>('[data-vlist]').forEach((ul) => { ul.scrollTop = st.vtop[ul.dataset.vlist!] || 0; reslice(ul) })
    reveal(o)
    if (typeof o.focus === 'string' && o.focus.startsWith('[')) {
      const fe = stage.querySelector<HTMLInputElement>(o.focus) ?? $('[data-focus]')
      if (fe) { fe.focus({ preventScroll: true }); if (fe.type === 'search') fe.setSelectionRange(fe.value.length, fe.value.length) }
    } else if (o.focus === 'title') {
      $<HTMLElement>('[data-pane] .miller__title, [data-screen] .miller__title, [data-preview] .miller__title, [data-detail] .miller__title')?.focus({ preventScroll: true })
    } else if (hadFocus || o.focus) {
      $<HTMLElement>('[data-focus]')?.focus({ preventScroll: true })
    }
    if (o.animate && !reduced) enter(o)
    if (p.stack && !reduced && last.mode === 'stack' && depth !== last.depth) {
      const screen = $<HTMLElement>('[data-screen]')
      screen?.animate?.([{ opacity: 0, transform: `translateX(${depth > last.depth ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' })
    }
    last.mode = p.info.mode
    last.lists = p.lists
    last.depth = depth
    options.onRender?.(p, state())
    options.onChange?.(state())
  }

  /** Scroll to reveal: show the newest column, keeping the selected item's column in view; snap points align the edges. */
  function reveal(o: Opts) {
    const strip = $<HTMLElement>('[data-strip]')
    if (strip) {
      const max = strip.scrollWidth - strip.clientWidth
      const act = $<HTMLElement>('.miller__col.is-active')
      const left = act && act.offsetLeft < max ? act.offsetLeft : max
      strip.scrollTo({ left: Math.max(0, left), behavior: o.animate && !reduced ? 'smooth' : 'auto' })
    }
    // Keep the current row in view inside its own column, never scrolling the page.
    root.querySelectorAll<HTMLElement>('.miller__list, .miller__tree').forEach((list) => {
      const on = list.querySelector('[aria-selected="true"]')
      if (!on) return
      const r = on.getBoundingClientRect()
      const b = list.getBoundingClientRect()
      if (r.top < b.top || r.bottom > b.bottom) list.scrollTop += (r.top - b.top) - list.clientHeight / 3
    })
  }

  function enter(o: Opts) {
    const from = o.from == null ? last.lists - 1 : o.from
    root.querySelectorAll<HTMLElement>('.miller__col, .miller__preview').forEach((el) => {
      const k = el.dataset.col == null ? Infinity : Number(el.dataset.col)
      if (k > from && el.animate) el.animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' })
    })
  }

  // ---- Selection

  /** Select a node. A click in a shallower column first collapses the columns it discards, so the reader sees why they went. */
  function go(id: string, o: Opts = {}) {
    const n = inScope(source, id)
    if (!n || busy) return
    const newLists = listCount(pathOf(n))
    const k = o.col
    const visible = Array.from(root.querySelectorAll<HTMLElement>('.miller__col, .miller__preview'))
    const index = visible.map((el) => (el.dataset.col == null ? null : Number(el.dataset.col)))
    const gone = k == null || reduced ? [] : discardedColumns(index, newLists)
    const leaving = visible.filter((_, i) => gone.includes(index[i]!))
    const done = () => {
      busy = false
      if (st.variant === 'e') openPath(n)
      if (st.variant === 'f' && !o.back) {
        const next = singleSelect({ at: st.at, list: st.list ?? listFor(source, node(st.at)), hist: st.hist }, n.id, o.list ?? listFor(source, n))
        st.hist = next.hist
        st.list = next.list
      }
      st.at = n.id
      st.came = o.came ?? null
      if (o.sheet != null) st.sheet = o.sheet
      if (o.pane != null) st.pane = o.pane
      render({ animate: o.animate !== false, from: k, focus: o.focus })
      if (o.say !== false) announce(`Selected ${n.label}${n.leaf ? '' : `, ${kids(n).length} ${noun(n).toLowerCase()}`}`)
      options.onSelect?.(n)
    }
    if (!leaving.length || !leaving[0]!.animate) { done(); return }
    busy = true
    const anims = leaving.map((el) => {
      el.style.overflow = 'hidden'
      return el.animate([{ width: `${el.offsetWidth}px`, opacity: 1 }, { width: '0px', opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' })
    })
    Promise.all(anims.map((a) => a.finished)).then(done, done)
  }

  const colOf = (el: Element) => { const c = el.closest<HTMLElement>('[data-col]'); return c ? Number(c.dataset.col) : null }

  function up() {
    const list = listNode()
    const next = singleUp(source, { at: st.at, list: list.id, hist: st.hist })
    if (next) go(next.at, { list: next.list, focus: true })
  }

  function history() {
    const next = singleBack({ at: st.at, list: st.list ?? '', hist: st.hist }, (id) => inScope(source, id) !== undefined)
    if (!next) return
    st.at = next.at
    st.list = next.list
    st.hist = next.hist
    render({ focus: true })
    announce(`Back to ${node(next.at).label}`)
  }

  /** Phones: open a row (push), go back (pop). */
  function open(n: ColumnNode) {
    const v = st.variant
    if (!n.leaf) return go(n.id, { sheet: false, focus: true })
    if (v === 'c') return go(n.id, { pane: true, focus: 'title' })
    go(n.id, { sheet: v !== 'a', focus: v === 'a' ? true : 'title' })
  }

  function back() {
    const n = node(st.at)
    const v = st.variant
    if (v === 'e') { st.sheet = false; render({ focus: true }); return }
    if (v === 'c' && st.pane) { st.pane = false; render({ focus: true }); return }
    if ((v === 'b' || v === 'd' || v === 'f' || v === 'g') && n.leaf && st.sheet) { st.sheet = false; render({ focus: true }); return }
    const base = n.leaf ? node(n.parent) : n
    if (base.id !== ROOT && base.parent) go(base.parent, { came: base.id, sheet: false, focus: true })
  }

  function setVariant(variant: Variant) {
    if (!allowed.includes(variant)) return
    st.variant = variant
    if (variant === 'f') { st.list = listFor(source, node(st.at)); st.hist = [] }
    if (variant === 'e') openPath(node(st.at))
  }

  // ---- Events

  const roving = (all: ArrayLike<HTMLElement>, el: HTMLElement | undefined) => {
    if (!el) return
    Array.from(all).forEach((x) => { x.tabIndex = -1 })
    el.tabIndex = 0
    el.focus()
  }

  const onClick = (e: MouseEvent) => {
    const t = e.target as Element
    let el: Element | null
    if (!stage.contains(t)) return
    if (t.closest('a[href="#"]')) e.preventDefault()
    if ((el = t.closest('[data-twisty]'))) {
      const id = el.closest<HTMLElement>('[data-at]')!.dataset.at!
      st.open[id] = !st.open[id]
      render({ focus: true })
      return
    }
    if ((el = t.closest('[data-spine]'))) {
      const path = pathOf(node(st.at))
      const k = Number((el as HTMLElement).dataset.spine)
      go((path[k + 1] ?? path[k])!.id, { col: k, focus: true })
      return
    }
    if (t.closest('[data-close]')) { st.pane = false; render({ focus: true }); return }
    if (t.closest('[data-open-pane]')) { st.pane = true; render({ focus: 'title' }); return }
    if (t.closest('[data-pin]')) { st.pin = st.pin ? null : paneNode().id; render(); return }
    if (t.closest('[data-back]')) { back(); return }
    if (t.closest('[data-f-up]')) { up(); return }
    if (t.closest('[data-f-back]')) { history(); return }
    if ((el = t.closest('[data-col-search]'))) {
      const cid = (el as HTMLElement).dataset.colSearch!
      const was = Boolean(st.colOpen[cid] || st.colq[cid])
      st.colOpen[cid] = !was
      if (was) st.colq[cid] = ''
      render({ focus: was ? `[data-col-search="${cid}"]` : `[data-col-q="${cid}"]` })
      return
    }
    if ((el = t.closest('[data-col-page]'))) {
      const spec = (el as HTMLElement).dataset.colPage!
      const cut = spec.lastIndexOf(':')
      const pid = spec.slice(0, cut)
      st.colPage[pid] = (st.colPage[pid] ?? 0) + Number(spec.slice(cut + 1))
      st.vtop[pid] = 0
      render({ focus: `[data-col-page="${spec}"]` })
      return
    }
    if ((el = t.closest('[data-at]'))) {
      const n = source.find((el as HTMLElement).dataset.at!)
      if (!n) return
      const isRow = el.matches('.miller__row')
      if (el.closest('[data-screen]') && isRow) { open(n); return }
      if (el.matches('.miller__ti')) { go(n.id, { sheet: true }); if (!n.leaf) { st.open[n.id] = true; render({ focus: true }) } return }
      go(n.id, { col: isRow ? colOf(el) : null, sheet: true, focus: isRow })
    }
  }

  const surfaceOf = (p: LayoutPlan): Surface => (p.tree || (p.stack && st.variant === 'e') ? 'tree' : p.single ? 'single' : p.stack ? 'stack' : 'columns')

  function apply(intent: Intent, p: LayoutPlan, e: KeyboardEvent): boolean {
    const n = node(st.at)
    const par = n.id !== ROOT && n.parent ? node(n.parent) : null
    const move = (list: ColumnNode[], listId: string | null, m: Parameters<typeof moveIndex>[2]) => {
      const i = list.indexOf(n)
      const target = list[moveIndex(i, list.length, m, st.col.pageSize)]
      if (target && target !== n) go(target.id, { animate: false, focus: true, say: true, ...(listId ? { list: listId } : {}) })
    }
    switch (intent.kind) {
      case 'close-pane': st.pane = false; render({ focus: true }); return true
      case 'open-pane': st.pane = true; render({ focus: 'title' }); return true
      case 'back': back(); return true
      case 'history': history(); return true
      case 'up': up(); return true
      case 'parent': if (par && par.id !== ROOT) go(par.id, { animate: false, focus: true, say: true }); return true
      case 'child': { const c = (tools() ? filteredKids(n) : kids(n))[0]; if (c) go(c.id, { animate: false, focus: true, say: true }); return true }
      case 'into': go(n.id, { list: n.id, focus: true, animate: false }); return true
      case 'focus-page': $<HTMLElement>('[data-detail] .miller__title')?.focus({ preventScroll: true }); return true
      case 'open': { const id = (document.activeElement as HTMLElement | null)?.dataset?.at; const row = id ? source.find(id) : undefined; if (row) open(row); return true }
      case 'move': {
        if (p.single) { const list = listNode(); move(tools() ? filteredKids(list) : kids(list), list.id, intent.move); return true }
        if (p.stack) { const rows = Array.from(stage.querySelectorAll<HTMLElement>('[data-screen] .miller__row')); roving(rows, rows[moveIndex(rows.indexOf(document.activeElement as HTMLElement), rows.length, intent.move, st.col.pageSize)]); return true }
        if (p.tree) { const items = Array.from(stage.querySelectorAll<HTMLElement>('.miller__ti')); roving(items, items[moveIndex(items.indexOf((e.target as Element).closest('.miller__ti') as HTMLElement), items.length, intent.move, st.col.pageSize)]); return true }
        const list = par ? (tools() ? filteredKids(par) : kids(par)) : (tools() ? filteredKids(n) : kids(n))
        if (par) move(list, null, intent.move)
        else { const first = list[moveIndex(-1, list.length, intent.move, st.col.pageSize)]; if (first) go(first.id, { animate: false, focus: true, say: true }) }
        return true
      }
      case 'expand': case 'collapse': case 'select': return treeKey(intent, e)
    }
  }

  function treeKey(intent: Intent, e: KeyboardEvent): boolean {
    const items = Array.from(stage.querySelectorAll<HTMLElement>('.miller__ti'))
    const cur = (e.target as Element).closest<HTMLElement>('.miller__ti')
    if (!cur) return false
    const id = cur.dataset.at!
    const n = source.find(id)
    if (!n) return false
    const refocus = () => roving(stage.querySelectorAll<HTMLElement>('.miller__ti'), Array.from(stage.querySelectorAll<HTMLElement>('.miller__ti')).find((x) => x.dataset.at === id))
    if (intent.kind === 'expand') {
      if (!st.open[id]) { st.open[id] = true; render(); refocus() } else roving(items, cur.querySelector<HTMLElement>('[role="group"] > .miller__ti') ?? undefined)
    } else if (intent.kind === 'collapse') {
      if (!n.leaf && st.open[id]) { st.open[id] = false; render(); refocus() } else roving(items, cur.parentElement?.closest<HTMLElement>('.miller__ti') ?? undefined)
    } else go(id, { sheet: true, focus: 'title' })
    return true
  }

  function resize(g: HTMLElement, dx: number) {
    const key = g.dataset.grip!
    const box = key === 'pane' ? g.closest<HTMLElement>('[data-pane]') : g.closest<HTMLElement>('[data-col]')
    if (!box) return
    const min = Number(g.getAttribute('aria-valuemin'))
    const max = Number(g.getAttribute('aria-valuemax'))
    const w = Math.max(min, Math.min(max, box.offsetWidth + dx))
    box.style.width = `${w}px`
    g.setAttribute('aria-valuenow', String(w))
    if (key === 'pane') st.paneW = w
    else st.widths[Number(key)] = w
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as Element
    if (!stage.contains(target)) return
    const g = target.closest<HTMLElement>('[data-grip]')
    if (g) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(g, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 48 : 16) * (g.dataset.grip === 'pane' ? -1 : 1)) }
      return
    }
    const qi = target.closest<HTMLInputElement>('[data-col-q]')
    if (qi) { filterKey(e, qi); return }
    const p = plan(applyWidth())
    const n = node(st.at)
    const surface = surfaceOf(p)
    if (e.key !== 'Escape' && target.closest('[data-pane], [data-preview], [data-detail], .miller__sheet')) return
    const par = n.id !== ROOT && n.parent ? node(n.parent) : null
    const ctx: KeyContext = { variant: st.variant, surface, pane: st.pane, hasChildren: !n.leaf && kids(n).length > 0, leaf: n.leaf, hasParentColumn: Boolean(par && par.id !== ROOT), tools: tools() }
    const intent = intentFor(e, ctx)
    if (!intent) return
    if (apply(intent, p, e)) e.preventDefault()
  }

  function filterKey(e: KeyboardEvent, input: HTMLInputElement) {
    const pid = input.dataset.colQ!
    const parent = source.find(pid)
    if (!parent) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (input.value) { st.colq[pid] = ''; st.colPage[pid] = 0; st.vtop[pid] = 0; render({ focus: `[data-col-q="${pid}"]` }) }
      else { st.colOpen[pid] = false; render({ focus: true }) }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      const f = filteredKids(parent)[0]
      if (!f) return
      e.preventDefault()
      go(f.id, { animate: false, focus: true, say: true, ...(st.variant === 'f' ? { list: parent.id } : {}) })
    }
  }

  const onInput = (e: Event) => {
    const qi = (e.target as Element).closest?.<HTMLInputElement>('[data-col-q]')
    if (!qi) return
    const pid = qi.dataset.colQ!
    st.colq[pid] = qi.value
    st.colPage[pid] = 0
    st.vtop[pid] = 0
    render({ focus: `[data-col-q="${pid}"]` })
  }

  const onPointerDown = (e: PointerEvent) => {
    const g = (e.target as Element).closest<HTMLElement>('[data-grip]')
    if (!g) return
    e.preventDefault()
    g.setPointerCapture(e.pointerId)
    const z = Number(root.dataset.zoom) || 1
    const sign = g.dataset.grip === 'pane' ? -1 : 1
    let x0 = e.clientX
    const move = (ev: PointerEvent) => { const dx = ((ev.clientX - x0) / z) * sign; x0 = ev.clientX; resize(g, dx) }
    const end = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', end); g.removeEventListener('pointercancel', end); render() }
    g.addEventListener('pointermove', move)
    g.addEventListener('pointerup', end)
    g.addEventListener('pointercancel', end)
  }

  let vframe = 0
  const onScroll = (e: Event) => {
    const ul = e.target as HTMLElement
    if (!ul.matches?.('[data-vlist]')) return
    st.vtop[ul.dataset.vlist!] = ul.scrollTop
    if (!vframe) vframe = requestAnimationFrame(() => { vframe = 0; reslice(ul) })
  }

  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('input', onInput)
  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('scroll', onScroll, true)

  // Keep the path when the width changes: the same state renders as columns, spines, a trail or a stack.
  let observer: ResizeObserver | undefined
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      const a = viewport.clientWidth
      const W = st.width === 'fit' ? a : Number(st.width)
      if (!a) return
      if (Math.abs(a - last.avail) < 24 && modeFor(W).mode === last.mode) return
      render()
    })
    observer.observe(viewport)
  }

  if (st.variant === 'f') st.list = listFor(source, node(st.at))
  render()

  return {
    current: () => st.at,
    select(id) {
      const n = inScope(source, id)
      if (!n) return false
      st.at = n.id
      if (st.variant === 'f') { st.list = listFor(source, n); st.hist = [] }
      openPath(n)
      render()
      return true
    },
    render: () => render(),
    plan: () => plan(applyWidth()),
    state,
    config: () => ({ variant: st.variant, columns: { ...st.col } }),
    set(patch) {
      if (patch.variant) setVariant(patch.variant)
      if (patch.columns) { st.col = mergeColumns(st.col, patch.columns); st.colPage = {}; st.vtop = {}; st.colSeen = {} }
      render()
    },
    setWidth(width) { st.width = width; render() },
    destroy() {
      destroyed = true
      observer?.disconnect()
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('input', onInput)
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('scroll', onScroll, true)
    },
  }
}

