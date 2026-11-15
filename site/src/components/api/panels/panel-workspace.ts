/**
 * PanelWorkspace: dockable panels over cross-port concepts, linked by a shared
 * locator, rendered at six width tiers from one state.
 *
 * The state and the tier rules live in `lib/panels`; this module draws them.
 * Not built here: dragging a panel header to dock it, floating windows and the
 * panels that pop out to them, dragging a pinned card, and reordering chips on a
 * phone. Previews, pins, link sets, locks, Re-sync, send-to, saved layouts, the
 * command bar and the keyboard map are.
 */
import { ICON, esc } from '../columns/html'
import { grow, isLeaf, leaves, snapRatio, type ViewNode } from '../../../lib/panels/layout'
import { planWorkspace, type WorkspacePlan } from '../../../lib/panels/plan'
import { MIN_COL, type Tier } from '../../../lib/panels/tiers'
import { SET_NAMES, TEMPLATE_NAMES, activate, activeTab, apiOf, clone, closePanel, fromTemplate, go, isStale, openResource, panelIds, partners, resync, setLink, step, validResource, type Panel, type TemplateName, type Workspace } from '../../../lib/panels/state'
import { symbolOf, type ConceptIndex, type ConceptRecord } from '../../../lib/panels/concepts'

export const BOARDS = [
  ['fit', 'Fit', 0, 0], ['t0', '390 x 844', 390, 844], ['t1', '844 x 390', 844, 390], ['t2', '834 x 1194', 834, 1194],
  ['t3', '1194 x 834', 1194, 834], ['half', '960 x 1040', 960, 1040], ['t4', '1728 x 1117', 1728, 1117], ['t5', '3440 x 1440', 3440, 1440],
] as const
export type BoardId = typeof BOARDS[number][0] | 'custom'

export interface WorkspaceOptions {
  concepts: ConceptIndex
  template?: TemplateName
  loc?: string
  board?: BoardId
  pointer?: 'hover' | 'touch'
  /** Where saved layouts and notes persist; the page passes `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  height?: number
  maxHeight?: number
  onChange?: (info: { board: BoardId; pointer: 'hover' | 'touch'; plan: WorkspacePlan; ws: Workspace }) => void
}

export interface WorkspaceHandle {
  state(): Workspace
  plan(): WorkspacePlan | null
  render(): void
  setBoard(board: BoardId, size?: { w: number; h: number }): void
  setPointer(pointer: 'hover' | 'touch'): void
  loadTemplate(name: TemplateName): void
  destroy(): void
}

export const LAYOUTS_KEY = 'libtmux:panel-layouts'
export const SESSION_KEY = 'libtmux:panel-last-session'
export const NOTES_KEY = 'libtmux:panel-notes'

const TOOLS = [['library', 'Library'], ['search', 'Search'], ['notes', 'Notes'], ['layouts', 'Layouts']] as const
const TOOL_ICON: Record<string, string> = {
  library: '<path d="M3 2.5v11M6 2.5v11M9.5 2.8l3 10.4"/>', search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  notes: '<path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6.5 7.5h4M6.5 10h4"/>', layouts: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M7 2.5v11M7 8h6.5"/>',
  more: '<circle cx="4" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12" cy="8" r=".8"/>', lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  pin: '<path d="M9.5 2.5 13.5 6.5 11 8l-1 3.5L4.5 6 8 5z"/><path d="M6.5 9.5 3 13"/>', side: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M9 3v10"/>',
}
const glyph = (name: string) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICON[name] ?? ''}</svg>`

interface Pop { res: string; loc: string; x: number; y: number }
interface Menu { id: string; x: number; y: number }
interface Cmd { q: string; sel: number; items: { label: string; code?: string; hint: string; run: () => void }[] }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function mountPanelWorkspace(root: HTMLElement, options: WorkspaceOptions): WorkspaceHandle {
  const { concepts } = options
  const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = root) => el.querySelector<T>(s)
  const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = root) => Array.from(el.querySelectorAll<T>(s))
  const viewport = $('[data-viewport]')!
  const stage = $('[data-stage]')!
  const statusEl = $('[data-status]')
  const stateEl = $('[data-state]')
  const live = $('[data-live]')
  const hoverable = typeof matchMedia !== 'function' || matchMedia('(hover: hover)').matches
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const ports = concepts.ports.map((p) => p.slug)
  const portName = (slug: string) => concepts.ports.find((p) => p.slug === slug)?.name ?? slug
  const portShort = (slug: string) => concepts.ports.find((p) => p.slug === slug)?.short ?? slug
  const known = (loc: string) => concepts.byId.has(loc)
  const conceptOf = (loc: string): ConceptRecord => concepts.byId.get(loc) ?? concepts.list[0]!
  const firstLoc = options.loc && known(options.loc) ? options.loc : concepts.byId.has('capture-pane') ? 'capture-pane' : concepts.list[0]!.id

  const store = {
    read<T>(key: string, fallback: T): T { try { const v = options.storage?.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback } },
    write(key: string, value: unknown) { try { options.storage?.setItem(key, JSON.stringify(value)) } catch { /* storage is optional */ } },
  }
  const st = {
    board: (options.board ?? 'fit') as BoardId, custom: null as { w: number; h: number } | null,
    pointer: (options.pointer ?? (hoverable ? 'hover' : 'touch')) as 'hover' | 'touch',
    railPinned: true, fullWidth: false, prevTier: null as Tier | null,
    saved: store.read<Workspace[]>(LAYOUTS_KEY, []),
    filters: { notes: true, absent: true } as Record<string, boolean>,
    tool: null as string | null, menu: null as Menu | null, pops: [] as Pop[], cmd: null as Cmd | null,
    compare: false, sheet: null as { res: string; loc: string; full: boolean } | null, side: null as string | null,
    pulse: [] as string[], toast: '',
  }
  const notes = store.read<Record<string, string[]>>(NOTES_KEY, { [firstLoc]: ['A note is kept against the locator, so every panel showing this concept marks it, in any port.'] })
  let ws = fromTemplate(options.template ?? 'study', firstLoc)
  let last: WorkspacePlan | null = null
  let viewSplits: Extract<ViewNode, { src: unknown }>[] = []
  let focusNext: string | null = null
  let destroyed = false

  const tabOf = (p: Panel) => activeTab(p)
  const resTitle = (res: string) => (res === 'equiv' ? 'All ports' : res === 'notes' ? 'Notes' : `${portName(apiOf(res) ?? '')} API`)
  const resShort = (res: string) => (res === 'equiv' ? 'Ports' : res === 'notes' ? 'Notes' : portShort(apiOf(res) ?? ''))
  const title = (id: string) => (ws.panels[id] ? resTitle(tabOf(ws.panels[id]!).res) : '')
  const announce = (text: string) => { if (live) live.textContent = text }

  // ---- Size

  const boardSize = () => {
    if (st.board === 'custom' && st.custom) return st.custom
    const b = BOARDS.find((x) => x[0] === st.board) ?? BOARDS[0]
    return { w: b[2], h: b[3] }
  }
  function size() {
    const avail = viewport.clientWidth
    const b = boardSize()
    const w = b.w || avail
    const h = b.h || options.height || 720
    const z = Math.min(1, avail / w, (options.maxHeight ?? 760) / h)
    stage.style.width = `${w}px`
    stage.style.height = `${h}px`
    stage.style.zoom = z === 1 ? '' : String(z)
    root.dataset.zoom = z.toFixed(2)
    return { w, h }
  }

  // ---- Markup

  function badge(p: Panel): string {
    if (!p.linkSet) return `<span class="pw__badge pw__badge--none" title="Not linked${p.formerSet ? `; was in link set ${p.formerSet}` : ''}" aria-label="Not linked"></span>`
    const tip = `Link set ${p.linkSet}${p.linkRole === 'follower' ? ', follows only' : ', drives and follows'}; the set is at ${ws.linkSets[p.linkSet]}`
    return `<span class="pw__badge pw__badge--${p.linkSet.toLowerCase()}${p.linkRole === 'follower' ? ' is-follower' : ''}" title="${esc(tip)}" aria-label="${esc(tip)}">${p.linkSet}</span>`
  }
  const noteMark = (loc: string) => { const n = (notes[loc] ?? []).length; return st.filters.notes && n ? `<span class="pw__notemark" title="Notes kept at ${esc(loc)}">${n} ${n === 1 ? 'note' : 'notes'}</span>` : '' }
  const chipsHtml = (chips: string[]) => chips.map((c) => `<span class="pw__diff">${esc(c)}</span>`).join('')

  function apiHtml(port: string, c: ConceptRecord, compact: boolean): string {
    const row = symbolOf(c, port)
    const others = c.rows.filter((r) => r.port !== port).slice(0, compact ? 3 : 6)
    const i = concepts.list.indexOf(c)
    const prev = concepts.list[i - 1]
    const next = concepts.list[i + 1]
    return '<article class="pw__doc">' +
      `<p class="pw__eyebrow"><span>${esc(portName(port))} &middot; concept <code>${esc(c.id)}</code></span>${noteMark(c.id)}</p>` +
      `<h2 class="pw__h">${esc(c.label)}</h2>` +
      (row ? `<p class="pw__sym"><code data-xc="${esc(`${port}:${c.id}`)}">${esc(row.qualifiedName)}</code>${row.kind ? ` <span class="pw__kind">${esc(row.kind)}</span>` : ''}${chipsHtml(row.chips)}</p>` +
        (port === c.primary && c.summary ? `<p class="pw__lede">${esc(c.summary)}</p>` : '') +
        (row.href && !compact ? `<p class="pw__why"><a href="${esc(row.href)}">Open the ${esc(portName(port))} reference page</a></p>` : '')
        : `<p class="pw__absent">No ${esc(portName(port))} equivalent. ${esc(c.absent[port] ?? 'None is recorded.')}</p>`) +
      (row?.note ? `<p class="pw__note">${esc(row.note)}</p>` : '') +
      (others.length ? `<h3 class="pw__sub">In other ports</h3><ul class="pw__xrefs">${others.map((x) =>
        `<li><a href="#" data-xref="api:${esc(x.port)}|${esc(c.id)}">${esc(portName(x.port))}</a> <code data-xc="${esc(`${x.port}:${c.id}`)}">${esc(x.qualifiedName)}</code>${chipsHtml(x.chips)}</li>`).join('')}</ul>` : '') +
      (compact ? '' : `<nav class="pw__seq" aria-label="Neighbouring concepts">${prev ? `<button type="button" data-goto="${esc(prev.id)}">${ICON.back}<span>${esc(prev.label)}</span></button>` : '<span></span>'}${next ? `<button type="button" data-goto="${esc(next.id)}"><span>${esc(next.label)}</span>${ICON.chevron}</button>` : ''}</nav>`) +
      '</article>'
  }

  function equivHtml(c: ConceptRecord): string {
    const rows = concepts.ports.map((p) => {
      const row = symbolOf(c, p.slug)
      if (!row && !st.filters.absent) return ''
      return `<tr${row ? '' : ' class="is-absent"'}><th scope="row"><span>${esc(p.name)}</span></th><td>` +
        (row ? `<a href="#" data-xref="api:${esc(p.slug)}|${esc(c.id)}"><code data-xc="${esc(`${p.slug}:${c.id}`)}">${esc(row.qualifiedName)}</code></a>${chipsHtml(row.chips)}${row.note ? `<span class="pw__why">${esc(row.note)}</span>` : ''}`
          : `<span class="pw__why">${esc(c.absent[p.slug] ?? 'Not recorded.')}</span>`) + '</td></tr>'
    }).join('')
    return `<article class="pw__doc"><p class="pw__eyebrow"><span>All ports &middot; concept <code>${esc(c.id)}</code></span>${noteMark(c.id)}</p><h2 class="pw__h">${esc(c.label)}</h2>` +
      `<p class="pw__lede">${c.rows.length} of ${concepts.ports.length} ports implement it.${st.filters.absent ? '' : ' Absent ports are hidden by the layer switch.'}</p><table class="pw__table"><tbody>${rows}</tbody></table></article>`
  }

  function notesHtml(p: Panel, c: ConceptRecord): string {
    const list = notes[c.id] ?? []
    return `<article class="pw__doc"><p class="pw__eyebrow"><span>Notes &middot; at <code>${esc(c.id)}</code></span></p><h2 class="pw__h">Notes on ${esc(c.label)}</h2>` +
      (list.length ? `<ul class="pw__notes">${list.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="pw__lede">No notes at this locator yet.</p>') +
      `<form class="pw__noteform" data-note-form="${esc(p.id)}"><label class="sr-only" for="note-${esc(p.id)}">Add a note at ${esc(c.id)}</label><textarea id="note-${esc(p.id)}" rows="3" placeholder="Add a note at ${esc(c.id)}"></textarea><button type="submit" class="pw__btn">Add note</button></form>` +
      '<p class="pw__why">Unlinked: this panel stays where you left it while the linked panels move.</p></article>'
  }

  const docHtml = (res: string, loc: string, compact = false) => {
    const c = conceptOf(loc)
    return res === 'equiv' ? equivHtml(c) : apiHtml(apiOf(res) ?? '', c, compact)
  }

  function headHtml(p: Panel, plan: WorkspacePlan): string {
    const t = tabOf(p)
    const c = conceptOf(t.loc)
    const stale = isStale(ws, p)
    return `<header class="pw__head" data-head="${esc(p.id)}" tabindex="-1">${badge(p)}<span class="pw__title">${esc(resTitle(t.res))}</span>` +
      `<button type="button" class="pw__loc" data-act="cmd:${esc(p.id)}" title="${esc(c.label)} (go to another concept)">${esc(t.loc)}</button>` +
      (stale ? `<button type="button" class="pw__stale" data-act="resync:${esc(p.id)}" title="Drifted from link set ${esc(p.linkSet ?? p.formerSet ?? '')}, now at ${esc(ws.linkSets[p.linkSet ?? p.formerSet ?? ''] ?? '')}">Re-sync</button>` : '') +
      (p.locked ? `<span class="pw__lock" title="Locked: ignores links and send-to" aria-label="Locked">${glyph('lock')}</span>` : '') +
      '<span class="pw__spacer"></span>' +
      (plan.tier.t >= 4 ? `<button type="button" class="pw__icon" data-act="back:${esc(p.id)}" aria-label="Back in this panel"${p.historyIndex > 0 ? '' : ' disabled'}>${ICON.back}</button><button type="button" class="pw__icon" data-act="fwd:${esc(p.id)}" aria-label="Forward in this panel"${p.historyIndex < p.history.length - 1 ? '' : ' disabled'}>${ICON.chevron}</button>` : '') +
      `<button type="button" class="pw__icon" data-menu="${esc(p.id)}" aria-haspopup="menu" aria-label="Panel menu: ${esc(resTitle(t.res))}">${glyph('more')}</button></header>`
  }

  function regionHtml(id: string, folded: string[] | null, plan: WorkspacePlan): string {
    const p = ws.panels[id]!
    const t = tabOf(p)
    const stack = folded && folded.length ? `<div class="pw__stack" role="tablist" aria-label="Panels in this region">${[id, ...folded].map((k) =>
      `<button type="button" role="tab" aria-selected="${k === id}" data-unfold="${esc(k)}">${badge(ws.panels[k]!)}<span>${esc(resShort(tabOf(ws.panels[k]!).res))}</span>${st.pulse.includes(k) ? '<i class="pw__dot" aria-label="moved"></i>' : ''}</button>`).join('')}</div>` : ''
    const docs = p.tabs.length > 1 ? `<div class="pw__docs" role="tablist" aria-label="Documents">${p.tabs.map((d, i) =>
      `<button type="button" role="tab" aria-selected="${i === p.activeTab}" data-doc="${esc(id)}:${i}">${esc(resTitle(d.res))}</button>`).join('')}</div>` : ''
    return `<section class="pw__panel${id === ws.activePanelId ? ' is-active' : ''}" data-region="${esc(id)}" aria-label="${esc(resTitle(t.res))}">${stack}${headHtml(p, plan)}${docs}` +
      `<div class="pw__body" data-body="${esc(id)}">${t.res === 'notes' ? notesHtml(p, conceptOf(t.loc)) : docHtml(t.res, t.loc)}</div></section>`
  }

  function nodeHtml(n: ViewNode, plan: WorkspacePlan): string {
    if (isLeaf(n)) return regionHtml(n.p, plan.folded[n.p] ?? [], plan)
    const k = viewSplits.push(n) - 1
    const flex = grow(n.sizes)
    return `<div class="pw__split pw__split--${n.dir}">${n.kids.map((kid, i) =>
      `<div class="pw__cell" style="flex:${flex[i]} 1 0">${nodeHtml(kid, plan)}</div>` +
      (i < n.kids.length - 1 ? `<div class="pw__splitter" role="separator" tabindex="0" aria-orientation="${n.dir === 'row' ? 'vertical' : 'horizontal'}" aria-label="Resize" data-splitter="${k}:${i}"></div>` : '')).join('')}</div>`
  }

  function toolHtml(kind: string): string {
    const P = ws.panels[ws.activePanelId]
    const loc = P ? tabOf(P).loc : firstLoc
    if (kind === 'library') {
      const res = ['equiv', 'notes', ...ports.map((x) => `api:${x}`)]
      return `<h3 class="pw__toolh">Library</h3><ul class="pw__toollist">${res.map((r) => `<li><button type="button" data-open="${esc(r)}">${esc(resTitle(r))}</button></li>`).join('')}</ul>`
    }
    if (kind === 'search') {
      return `<h3 class="pw__toolh">Concepts</h3><ul class="pw__toollist">${concepts.list.slice(0, 40).map((c) =>
        `<li><button type="button" data-goto-active="${esc(c.id)}"${c.id === loc ? ' aria-current="true"' : ''}><code>${esc(c.id)}</code><span>${esc(c.label)}</span></button></li>`).join('')}</ul><p class="pw__why">The command bar (/) searches all ${concepts.list.length}.</p>`
    }
    if (kind === 'notes') {
      const keys = Object.keys(notes).filter((k) => notes[k]!.length)
      return `<h3 class="pw__toolh">Notes</h3>${keys.length ? `<ul class="pw__toollist">${keys.map((k) => `<li><button type="button" data-goto-active="${esc(k)}"><code>${esc(k)}</code><span>${notes[k]!.length} ${notes[k]!.length === 1 ? 'note' : 'notes'}</span></button></li>`).join('')}</ul>` : '<p class="pw__why">No notes yet.</p>'}`
    }
    const tpl = (Object.keys(TEMPLATE_NAMES) as TemplateName[]).map((k) => `<li><button type="button" data-layout="tpl:${k}"><span>${esc(TEMPLATE_NAMES[k])}</span><small>template</small></button></li>`).join('')
    const saved = st.saved.map((s, i) => `<li><button type="button" data-layout="saved:${i}"><span>${esc(s.name)}</span><small>saved</small></button></li>`).join('')
    return `<h3 class="pw__toolh">Layouts</h3><ul class="pw__toollist">${tpl}${saved}<li><button type="button" data-layout="last"><span>Last session</span><small>auto-saved</small></button></li></ul>` +
      '<form class="pw__saveform" data-save-form><label class="sr-only" for="pw-save">Layout name</label><input id="pw-save" class="pw__input" placeholder="Name this layout" maxlength="40"><button type="submit" class="pw__btn">Save</button></form>'
  }

  function railHtml(plan: WorkspacePlan): string {
    const wide = plan.railWidth === 240
    const tool = st.tool ?? (wide ? 'layouts' : null)
    const btns = TOOLS.map(([k, label]) => `<button type="button" data-tool="${k}" aria-pressed="${tool === k}" title="${label}">${glyph(k)}${wide ? `<span>${label}</span>` : `<span class="sr-only">${label}</span>`}</button>`).join('')
    const pin = plan.tier.t >= 3 ? `<button type="button" class="pw__railpin" data-act="rail" title="${st.railPinned ? 'Collapse the sidebar' : 'Pin the sidebar'}">${st.railPinned ? '&laquo;' : '&raquo;'}</button>` : ''
    return `<nav class="pw__rail${wide ? ' is-wide' : ''}" style="width:${plan.railWidth}px" aria-label="Tools"><div class="pw__railbtns">${btns}${pin}</div>` +
      (wide ? `<div class="pw__toolbody">${toolHtml(tool!)}</div>` : tool ? `<div class="pw__tooloverlay" role="dialog" aria-label="${tool}">${toolHtml(tool)}</div>` : '') + '</nav>'
  }

  function pinnedHtml(plan: WorkspacePlan): string {
    return ws.pinned.map((pv, i) => {
      if (!known(pv.loc) || !validResource(pv.res, ports)) return ''
      const tight = plan.tier.t === 2 && plan.workWidth - plan.railWidth < 900
      if (pv.collapsed || tight) return `<button type="button" class="pw__pinchip" data-pin-open="${i}" style="right:${12 + i * 8}px;bottom:${12 + i * 40}px" title="Pinned preview: ${esc(resTitle(pv.res))} at ${esc(pv.loc)}">${glyph('pin')}<span>${esc(resShort(pv.res))} &middot; ${esc(pv.loc)}</span></button>`
      return `<aside class="pw__card" style="right:${16 + i * 16}px;bottom:${16 + i * 16}px" data-pin="${i}" aria-label="Pinned preview"><header class="pw__cardhead"><span>${glyph('pin')} ${esc(resTitle(pv.res))}</span><span class="pw__spacer"></span>` +
        (plan.tier.t >= 4 ? `<button type="button" class="pw__icon" data-act="dockpin:${i}" title="Dock as a panel">${glyph('side')}</button>` : '') +
        `<button type="button" class="pw__icon" data-act="collapsepin:${i}" title="Collapse to a chip">&ndash;</button><button type="button" class="pw__icon" data-act="unpin:${i}" aria-label="Close the pinned preview">${ICON.close}</button></header><div class="pw__cardbody">${docHtml(pv.res, pv.loc, true)}</div></aside>`
    }).join('')
  }

  function topHtml(plan: WorkspacePlan): string {
    const layers = `<span class="pw__layers" role="group" aria-label="Layers"><button type="button" data-act="filter:notes" aria-pressed="${st.filters.notes}">Notes</button><button type="button" data-act="filter:absent" aria-pressed="${st.filters.absent}">Absent ports</button></span>`
    if (plan.narrow) return `<header class="pw__top"><span class="pw__brand">${esc(ws.name)}</span><span class="pw__spacer"></span><button type="button" class="pw__icon" data-act="cmd" aria-label="Command bar">${glyph('search')}</button></header>`
    return `<header class="pw__top"><span class="pw__brand">Workspace</span><span class="pw__layoutname">${esc(ws.name)}</span>` +
      '<button type="button" class="pw__go" data-act="cmd"><span>Go to a concept, port or command</span><kbd>/</kbd></button><span class="pw__spacer"></span>' + layers +
      (plan.tier.t === 5 ? `<button type="button" class="pw__btn" data-act="fullwidth" aria-pressed="${st.fullWidth}">Full width</button>` : '') +
      (ws.maximized ? `<button type="button" class="pw__btn" data-act="max:${esc(ws.maximized)}">Restore layout</button>` : '') +
      '<button type="button" class="pw__btn" data-tool="layouts">Save layout</button></header>'
  }

  function wideHtml(plan: WorkspacePlan): string {
    viewSplits = []
    return `<div class="pw__app" style="max-width:${plan.workWidth}px">${topHtml(plan)}<div class="pw__main">${railHtml(plan)}<div class="pw__work" data-work>${plan.view ? nodeHtml(plan.view, plan) : ''}${pinnedHtml(plan)}</div></div>` +
      `<div class="pw__layer" data-layer>${layerHtml()}</div><div class="pw__toast" role="status" aria-live="polite">${esc(st.toast)}</div></div>`
  }

  function moreHtml(): string {
    return `<h3 class="pw__toolh">More</h3><ul class="pw__toollist"><li><button type="button" data-act="filter:notes" aria-pressed="${st.filters.notes}">Notes layer</button></li><li><button type="button" data-act="filter:absent" aria-pressed="${st.filters.absent}">Absent ports layer</button></li><li><button type="button" data-act="cmd">Command bar</button></li></ul>`
  }

  function narrowHtml(plan: WorkspacePlan): string {
    const order = plan.order
    const act = order.includes(ws.activePanelId) ? ws.activePanelId : order[0]!
    const partner = partners(ws, act).find((k) => order.includes(k))
    const chips = order.map((id) => {
      const P = ws.panels[id]!
      const on = id === act
      return `<span class="pw__chipwrap"><button type="button" class="pw__chip${st.pulse.includes(id) && !reduced ? ' is-pulse' : ''}" role="tab" aria-selected="${on}" data-chip="${esc(id)}">${badge(P)}<span>${esc(resShort(tabOf(P).res))}</span></button>` +
        (plan.tier.t === 1 && !on ? `<button type="button" class="pw__chipside" data-side="${esc(id)}" aria-label="Open ${esc(title(id))} beside">${glyph('side')}</button>` : '') + '</span>'
    }).join('') + ws.pinned.map((pv, i) => `<button type="button" class="pw__chip pw__chip--pin" data-pin-open="${i}">${glyph('pin')}<span>${esc(resShort(pv.res))} &middot; ${esc(pv.loc)}</span></button>`).join('')
    const canCompare = plan.tier.t === 0 && plan.height >= 640 && Boolean(partner)
    const work = st.compare && canCompare
      ? `<div class="pw__split pw__split--col"><div class="pw__cell" style="flex:1 1 0">${regionHtml(act, null, plan)}</div><div class="pw__splitter" aria-hidden="true"></div><div class="pw__cell" style="flex:1 1 0">${regionHtml(partner!, null, plan)}</div></div>`
      : regionHtml(act, null, plan)
    const side = plan.tier.t === 1 && st.side && ws.panels[st.side] && st.side !== act
      ? `<aside class="pw__sidesheet" aria-label="Beside: ${esc(title(st.side))}"><button type="button" class="pw__sheetclose" data-act="closeside" aria-label="Close the side sheet">${ICON.close}</button>${regionHtml(st.side, null, plan)}</aside>` : ''
    const tabbar = `<nav class="pw__tabbar${plan.short ? ' is-thin' : ''}" aria-label="Tools">${[...TOOLS, ['more', 'More'] as const].map(([k, label]) =>
      `<button type="button" data-tool="${k}" aria-pressed="${st.tool === k}">${glyph(k)}<span${plan.short ? ' class="sr-only"' : ''}>${label}</span></button>`).join('')}</nav>`
    let sheet = ''
    if (st.tool) sheet = `<div class="pw__sheet" role="dialog" aria-label="${esc(st.tool)}"><button type="button" class="pw__sheetclose" data-act="closetool" aria-label="Close">${ICON.close}</button>${st.tool === 'more' ? moreHtml() : toolHtml(st.tool)}</div>`
    else if (st.sheet) {
      const pv = st.sheet
      sheet = `<div class="pw__sheet${pv.full ? ' is-full' : ''}" role="dialog" aria-label="Preview"><div class="pw__sheetbar"><span>Preview &middot; ${esc(resTitle(pv.res))}</span><span class="pw__spacer"></span>${pv.full ? '' : '<button type="button" class="pw__btn" data-act="sheetpin">Pin</button>'}<button type="button" class="pw__btn" data-act="sheetopen">Open</button><button type="button" class="pw__sheetclose" data-act="closesheet" aria-label="Dismiss the preview">${ICON.close}</button></div>${docHtml(pv.res, pv.loc, true)}</div>`
    }
    return `<div class="pw__app is-narrow${plan.short ? ' is-short' : ''}">${topHtml(plan)}<div class="pw__chips" role="tablist" aria-label="Open panels">${chips}${canCompare ? `<button type="button" class="pw__chip pw__chip--mode" data-act="compare" aria-pressed="${st.compare}">Compare</button>` : ''}</div>` +
      `<div class="pw__work" data-work>${work}${side}</div>${tabbar}${sheet}<div class="pw__layer" data-layer>${layerHtml()}</div><div class="pw__toast" role="status" aria-live="polite">${esc(st.toast)}</div></div>`
  }

  function menuHtml(): string {
    const m = st.menu!
    const P = ws.panels[m.id]
    if (!P) return ''
    const t = tabOf(P)
    const others = panelIds(ws).filter((k) => k !== P.id)
    const item = (act: string, label: string, pressed: boolean | null = null, dis = false) =>
      `<li role="none"><button type="button" role="menuitem${pressed != null ? `radio" aria-checked="${pressed}` : ''}" data-act="${act}"${dis ? ' disabled' : ''}>${label}</button></li>`
    return `<div class="pw__menu" role="menu" aria-label="Panel menu" style="left:${m.x}px;top:${m.y}px"><p class="pw__menuh">Link set</p><ul>` +
      SET_NAMES.map((s) => item(`link:${P.id}:${s}`, `<span class="pw__badge pw__badge--${s.toLowerCase()}">${s}</span> ${ws.linkSets[s] ? `at ${esc(ws.linkSets[s]!)}` : 'new set'}`, P.linkSet === s)).join('') + item(`link:${P.id}:none`, 'Unlinked', !P.linkSet) +
      `</ul><p class="pw__menuh">Role</p><ul>${item(`role:${P.id}:bidirectional`, 'Drives and follows', P.linkRole === 'bidirectional', !P.linkSet)}${item(`role:${P.id}:follower`, 'Follows only', P.linkRole === 'follower', !P.linkSet)}</ul><ul>` +
      item(`lock:${P.id}`, P.locked ? 'Unlock' : 'Lock (ignore links and send-to)') + `</ul><p class="pw__menuh">Send ${esc(t.loc)} to</p><ul>` +
      others.map((k) => item(`send:${P.id}:${k}`, esc(title(k)) + (ws.panels[k]!.locked ? ' (locked)' : ''))).join('') + item(`sendnew:${P.id}`, 'A new panel') + '</ul><ul>' +
      item(`max:${P.id}`, ws.maximized === P.id ? 'Restore layout' : 'Maximize') + (last && !last.narrow && last.visible.length > 1 ? item(`fold:${P.id}`, 'Move into a tab stack') : '') +
      item(`close:${P.id}`, 'Close panel', null, panelIds(ws).length < 2) + '</ul></div>'
  }

  function popHtml(pv: Pop, i: number): string {
    return `<div class="pw__pop" role="dialog" aria-label="Preview: ${esc(resTitle(pv.res))}" data-pop="${i}" style="left:${pv.x}px;top:${pv.y}px"><div class="pw__popbar"><span>Preview &middot; ${esc(resTitle(pv.res))}</span><span class="pw__spacer"></span>` +
      `<button type="button" class="pw__icon" data-act="pinpop:${i}" title="Pin">${glyph('pin')}</button><button type="button" class="pw__icon" data-act="closepop:${i}" aria-label="Dismiss (Escape)">${ICON.close}</button></div>${docHtml(pv.res, pv.loc, true)}` +
      `<p class="pw__popfoot">Open in <button type="button" data-act="openpop:${i}:policy">the usual panel</button> &middot; <button type="button" data-act="openpop:${i}:panel">a new panel</button> &middot; <button type="button" data-act="openpop:${i}:tab">a new tab</button></p></div>`
  }

  const cmdHtml = () => `<div class="pw__cmd${last?.narrow ? ' is-full' : ''}" role="dialog" aria-label="Command bar"><input class="pw__input" data-cmd-input placeholder="A concept (send-keys), a port (Rust), or a command (save, link B, lock)" aria-label="Command" autocomplete="off" value="${esc(st.cmd!.q)}"><ul role="listbox" data-cmd-list>${cmdListHtml()}</ul></div>`
  const layerHtml = () => (st.menu ? menuHtml() : '') + st.pops.map(popHtml).join('') + (st.cmd ? cmdHtml() : '')
  const renderLayer = () => { const l = $('[data-layer]', stage); if (l) l.innerHTML = layerHtml() }

  // ---- Render

  function statusLine(plan: WorkspacePlan): string {
    const t = plan.tier
    const n = plan.all.length
    let s: string
    if (plan.narrow) s = `one panel at a time; ${n} open in the switcher${t.t === 1 ? ', a second can open beside as a side sheet' : ''}. Linked panels move in the background.`
    else if (ws.maximized) s = `${title(ws.maximized)} is maximized; Restore returns the exact layout.`
    else s = `${plan.visible.length} of ${plan.all.length} panels visible (cap ${plan.cap})${plan.hidden.length ? `; ${plan.hidden.map(title).join(', ')} ${plan.hidden.length === 1 ? 'is' : 'are'} folded into a tab stack` : ''}. Rail: ${plan.railWidth === 240 ? 'sidebar' : 'icons'}${plan.railAuto ? ' (collapsed so no panel folds)' : ''}.`
    return `${t.name} (${plan.width} x ${plan.height} px, ${st.pointer} pointer${plan.short ? ', short height' : ''}): ${s}`
  }

  function render(focus?: string) {
    if (destroyed) return
    // Keep each panel's scroll across renders unless its locator changed: the locator is the position, scroll only a hint.
    const scrolls: Record<string, number> = {}
    $$('[data-body]', stage).forEach((b) => { const P = ws.panels[b.dataset.body!]; if (P && b.dataset.loc === `${tabOf(P).loc}|${tabOf(P).res}`) { scrolls[b.dataset.body!] = b.scrollTop; tabOf(P).scrollHint = b.scrollTop } })
    const s = size()
    const plan = planWorkspace(ws, s.w, s.h, { prevTier: st.prevTier, railPinned: st.railPinned, fullWidth: st.fullWidth })
    st.prevTier = plan.tier
    last = plan
    root.dataset.tier = `T${plan.tier.t}`
    root.dataset.pointer = st.pointer
    root.dataset.short = String(plan.short)
    root.dataset.visible = String(plan.narrow ? 1 : plan.visible.length)
    root.dataset.folded = String(plan.narrow ? plan.order.length - 1 : plan.hidden.length)
    stage.innerHTML = plan.narrow ? narrowHtml(plan) : wideHtml(plan)
    $$('[data-body]', stage).forEach((b) => { const P = ws.panels[b.dataset.body!]; if (P) b.dataset.loc = `${tabOf(P).loc}|${tabOf(P).res}`; b.scrollTop = scrolls[b.dataset.body!] ?? (P ? tabOf(P).scrollHint : 0) })
    if (statusEl) statusEl.textContent = statusLine(plan)
    store.write(SESSION_KEY, ws)
    if (stateEl) stateEl.textContent = JSON.stringify({ name: ws.name, layoutTree: ws.layoutTree, panels: ws.panels, linkSets: ws.linkSets, activePanelId: ws.activePanelId, floating: ws.floating, pinned: ws.pinned }, null, 1)
    st.pulse = []
    const f = focusNext ?? focus ?? null
    focusNext = null
    if (f === 'panel') $<HTMLElement>(`[data-region="${ws.activePanelId}"] [data-head]`, stage)?.focus({ preventScroll: true })
    else if (f === 'cmd') { const inp = $<HTMLInputElement>('[data-cmd-input]', stage); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) } }
    options.onChange?.({ board: st.board, pointer: st.pointer, plan, ws })
  }

  let toastTimer = 0
  function toast(text: string) {
    st.toast = text
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { st.toast = ''; const t = $('.pw__toast', stage); if (t) t.textContent = '' }, 2600)
  }

  // ---- Navigation and linking: everything syncs on the locator, never on scroll.

  function navigate(id: string, loc: string, o: { nopush?: boolean; focus?: string } = {}): boolean {
    const result = go(ws, id, loc, known, o)
    if (!result.ok) {
      if (result.reason === 'locked') toast(`${title(id)} is locked, so it stays at ${tabOf(ws.panels[id]!).loc}`)
      render()
      return false
    }
    const hiddenMoved = result.moved.filter((k) => !last || last.narrow || !last.visible.includes(k))
    st.pulse = hiddenMoved
    if (hiddenMoved.length) toast(`${hiddenMoved.map(title).join(', ')} moved to ${loc} in the background`)
    announce(`${title(id)} at ${loc}${result.moved.length ? `; ${result.moved.length} linked ${result.moved.length === 1 ? 'panel' : 'panels'} followed` : ''}`)
    render(o.focus)
    return true
  }

  function open(res: string, loc: string, how: 'policy' | 'panel' | 'tab' = 'policy') {
    openResource(ws, res, loc, how, known)
    render('panel')
  }

  function loadLayout(snap: Workspace) {
    ws = clone(snap)
    ws.recent = []
    st.side = null; st.compare = false; st.pops = []; st.menu = null
    render('panel')
  }

  function saveLayout(name: string) {
    const snap = clone(ws)
    snap.name = name
    st.saved.push(snap)
    store.write(LAYOUTS_KEY, st.saved)
    ws.name = name
    toast(`Saved the layout "${name}"`)
    render()
  }

  // ---- Command bar: a concept, a port, a layout or a command, keyboard first.

  function cmdItems(query: string): Cmd['items'] {
    const q = query.trim().toLowerCase()
    const A = ws.panels[ws.activePanelId]!
    const items: Cmd['items'] = []
    let m: RegExpExecArray | null
    // A command word needs a space or the end after it: `send-keys` is a concept, not `send keys`.
    if ((m = /^send(?:\s+(.*))?$/.exec(q))) {
      panelIds(ws).filter((k) => k !== ws.activePanelId && title(k).toLowerCase().includes(m![1] ?? '')).forEach((k) => items.push({ label: `Send ${tabOf(A).loc} to ${title(k)}`, hint: 'send to', run: () => { navigate(k, tabOf(A).loc, { focus: 'panel' }) } }))
      return items
    }
    if ((m = /^save(?:\s+(.*))?$/.exec(q))) { const name = m[1] || `Layout ${st.saved.length + 1}`; return [{ label: `Save this layout as "${name}"`, hint: 'layout', run: () => saveLayout(name) }] }
    if ((m = /^link(?:\s+([abc]|none))?$/.exec(q))) {
      return (m[1] ? [m[1]] : ['a', 'b', 'c', 'none']).map((s) => { const S = s === 'none' ? 'none' : s.toUpperCase(); return { label: S === 'none' ? `Unlink ${title(A.id)}` : `Put ${title(A.id)} in link set ${S}`, hint: 'link', run: () => { setLink(ws, A.id, S); render('panel') } } })
    }
    const cmds: [string, string, () => void][] = [
      ['lock', 'Lock or unlock the active panel', () => { A.locked = !A.locked; render('panel') }],
      ['follower', 'Make the active panel follow only', () => { A.linkRole = 'follower'; render('panel') }],
      ['bidirectional', 'Let the active panel drive its set', () => { A.linkRole = 'bidirectional'; render('panel') }],
      ['maximize', 'Maximize or restore the active panel', () => toggleMax(A.id)],
    ]
    for (const [key, label, run] of cmds) if (q && key.startsWith(q)) items.push({ label, hint: 'command', run })
    for (const k of Object.keys(TEMPLATE_NAMES) as TemplateName[]) if (q && TEMPLATE_NAMES[k].toLowerCase().startsWith(q)) items.push({ label: `Load the ${TEMPLATE_NAMES[k]} layout`, hint: 'layout', run: () => loadLayout(fromTemplate(k, tabOf(A).loc)) })
    for (const x of concepts.ports) if (q && (x.name.toLowerCase().startsWith(q) || x.slug === q)) items.push({ label: `Open the ${x.name} API`, hint: 'port', run: () => open(`api:${x.slug}`, tabOf(A).loc) })
    concepts.list.filter((c) => !q || c.id.includes(q) || c.label.toLowerCase().includes(q)).slice(0, 8).forEach((c) => items.push({ label: c.label, code: c.id, hint: 'go to', run: () => { navigate(ws.activePanelId, c.id, { focus: 'panel' }) } }))
    return items.slice(0, 10)
  }

  function cmdListHtml(): string {
    const cmd = st.cmd!
    cmd.items = cmdItems(cmd.q)
    cmd.sel = clamp(cmd.sel, 0, Math.max(0, cmd.items.length - 1))
    if (!cmd.items.length) return '<li class="pw__cmdnone">Nothing matches. Try a concept id such as send-keys, a port name, save, link B or lock.</li>'
    return cmd.items.map((it, i) => `<li role="option" aria-selected="${i === cmd.sel}" data-cmd-item="${i}"><span>${it.code ? `<code>${esc(it.code)}</code> ` : ''}${esc(it.label)}</span><small>${esc(it.hint)}</small></li>`).join('')
  }

  function openCmd(q = '', forPanel?: string) {
    if (forPanel) activate(ws, forPanel)
    st.menu = null; st.pops = []; st.tool = null
    st.cmd = { q, sel: 0, items: [] }
    render('cmd')
  }
  function runCmd(i: number) { const it = st.cmd?.items[i]; st.cmd = null; if (it) it.run(); else render() }
  function toggleMax(id: string) { ws.maximized = ws.maximized === id ? null : id; activate(ws, id); render('panel') }

  // ---- Previews: read-only until pinned or opened.

  let hoverTimer = 0
  let leaveTimer = 0
  let press: { x: number; y: number; fired: boolean; timer: number } | null = null
  function stagePoint(rect: DOMRect) {
    const s = stage.getBoundingClientRect()
    const z = Number(root.dataset.zoom) || 1
    return { x: (rect.left - s.left) / z, y: (rect.bottom - s.top) / z, w: s.width / z, h: s.height / z }
  }
  function openPop(a: HTMLElement) {
    const [res, loc] = a.dataset.xref!.split('|') as [string, string]
    const inPop = a.closest<HTMLElement>('[data-pop]')
    const depth = inPop ? Number(inPop.dataset.pop) + 1 : 0
    if (depth > 1) return
    const pt = stagePoint(a.getBoundingClientRect())
    st.pops = st.pops.slice(0, depth)
    st.pops.push({ res, loc, x: Math.round(clamp(pt.x, 8, pt.w - 368)), y: Math.round(clamp(pt.y + 6, 8, pt.h - 260)) })
    renderLayer()
  }
  const closePops = (from = 0) => { st.pops = st.pops.slice(0, from); renderLayer() }
  function pin(res: string, loc: string) { ws.pinned.push({ res, loc }); st.pops = []; toast(`Pinned the preview of ${resTitle(res)} at ${loc}`); render() }
  function highlight(el: HTMLElement, on: boolean) {
    const region = el.closest<HTMLElement>('[data-region]')
    const P = region && ws.panels[region.dataset.region!]
    $$('.pw__xc-on', stage).forEach((x) => x.classList.remove('pw__xc-on'))
    if (!on || !P || !P.linkSet) return
    $$('[data-region]', stage).forEach((r) => { const Q = ws.panels[r.dataset.region!]; if (Q && Q.linkSet === P.linkSet) $$(`[data-xc="${el.dataset.xc}"]`, r).forEach((x) => x.classList.add('pw__xc-on')) })
  }
  const onOver = (e: PointerEvent) => {
    if (st.pointer !== 'hover') return
    const t = e.target as Element
    const a = t.closest<HTMLElement>('[data-xref]')
    if (a) { clearTimeout(leaveTimer); clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => openPop(a), 400) }
    if (t.closest('[data-pop]')) clearTimeout(leaveTimer)
    const xc = t.closest<HTMLElement>('[data-xc]')
    if (xc) highlight(xc, true)
  }
  const onOut = (e: PointerEvent) => {
    if (st.pointer !== 'hover') return
    const t = e.target as Element
    const rel = e.relatedTarget as Node | null
    const a = t.closest('[data-xref], [data-pop]')
    if (a && !(rel && a.contains(rel))) { clearTimeout(hoverTimer); clearTimeout(leaveTimer); if (st.pops.length) leaveTimer = window.setTimeout(() => closePops(0), 450) }
    const xc = t.closest<HTMLElement>('[data-xc]')
    if (xc && !(rel && xc.contains(rel))) highlight(xc, false)
  }

  // ---- Clicks

  const onClick = (e: MouseEvent) => {
    const t = e.target as Element
    let el: HTMLElement | null
    if (!stage.contains(t)) return
    if (press?.fired) { e.preventDefault(); press = null; return }
    if (t.closest('a[href="#"]')) e.preventDefault()
    if ((el = t.closest<HTMLElement>('[data-cmd-item]'))) { runCmd(Number(el.dataset.cmdItem)); return }
    if (st.menu && !t.closest('.pw__menu') && !t.closest('[data-menu]')) { st.menu = null; renderLayer() }
    if ((el = t.closest<HTMLElement>('[data-act]'))) { act(el.dataset.act!); return }
    if ((el = t.closest<HTMLElement>('[data-menu]'))) {
      const id = el.dataset.menu!
      if (st.menu?.id === id) { st.menu = null; renderLayer(); return }
      activate(ws, id)
      const pt = stagePoint(el.getBoundingClientRect())
      st.menu = { id, x: Math.round(clamp(pt.x - 220, 8, pt.w - 268)), y: Math.round(clamp(pt.y + 4, 8, pt.h - 420)) }
      renderLayer()
      $<HTMLElement>('.pw__menu button', stage)?.focus()
      return
    }
    if ((el = t.closest<HTMLElement>('[data-tool]'))) { const k = el.dataset.tool!; st.tool = st.tool === k && last?.railWidth !== 240 ? null : k; render(); return }
    if ((el = t.closest<HTMLElement>('[data-chip]'))) { activate(ws, el.dataset.chip!); render('panel'); return }
    if ((el = t.closest<HTMLElement>('[data-side]'))) { st.side = el.dataset.side!; render(); return }
    if ((el = t.closest<HTMLElement>('[data-unfold]'))) { const u = el.dataset.unfold!; ws.panels[u]!.preferredVisible = true; activate(ws, u); render('panel'); return }
    if ((el = t.closest<HTMLElement>('[data-doc]'))) { const [id, i] = el.dataset.doc!.split(':') as [string, string]; ws.panels[id]!.activeTab = Number(i); activate(ws, id); render('panel'); return }
    if ((el = t.closest<HTMLElement>('[data-pin-open]'))) {
      const pv = ws.pinned[Number(el.dataset.pinOpen)]
      if (!pv) return
      if (last?.narrow) st.sheet = { res: pv.res, loc: pv.loc, full: true }
      else pv.collapsed = false
      render()
      return
    }
    if ((el = t.closest<HTMLElement>('[data-xref]'))) { const [res, loc] = el.dataset.xref!.split('|') as [string, string]; st.pops = []; open(res, loc); return }
    if ((el = t.closest<HTMLElement>('[data-goto]'))) { const r = el.closest<HTMLElement>('[data-region]'); if (r) navigate(r.dataset.region!, el.dataset.goto!, { focus: 'panel' }); return }
    if ((el = t.closest<HTMLElement>('[data-goto-active]'))) { if (last?.railWidth !== 240) st.tool = null; navigate(ws.activePanelId, el.dataset.gotoActive!, { focus: 'panel' }); return }
    if ((el = t.closest<HTMLElement>('[data-open]'))) { if (last?.railWidth !== 240) st.tool = null; open(el.dataset.open!, tabOf(ws.panels[ws.activePanelId]!).loc); return }
    if ((el = t.closest<HTMLElement>('[data-layout]'))) {
      const v = el.dataset.layout!
      if (last?.railWidth !== 240) st.tool = null
      const last_ = store.read<Workspace | null>(SESSION_KEY, null)
      if (v === 'last') { if (last_) loadLayout(last_) } else if (v.startsWith('tpl:')) loadLayout(fromTemplate(v.slice(4) as TemplateName, tabOf(ws.panels[ws.activePanelId]!).loc)); else if (st.saved[Number(v.slice(6))]) loadLayout(st.saved[Number(v.slice(6))]!)
      return
    }
    const region = t.closest<HTMLElement>('[data-region]')
    if (region && region.dataset.region !== ws.activePanelId && !t.closest('button, a, textarea, input')) {
      activate(ws, region.dataset.region!)
      $$('[data-region]', stage).forEach((r) => r.classList.toggle('is-active', r.dataset.region === ws.activePanelId))
    }
  }

  function act(a: string) {
    const [k, id, arg] = a.split(':') as [string, string | undefined, string | undefined]
    const P = id ? ws.panels[id] : undefined
    const pv = (i: string | undefined) => ws.pinned[Number(i)]
    switch (k) {
      case 'cmd': return openCmd('', id)
      case 'resync': if (P) { resync(ws, id!, known); render('panel') } return
      case 'back': case 'fwd': { const r = step(ws, id!, k === 'back' ? -1 : 1, known); if (r) render('panel'); return }
      case 'filter': st.filters[id!] = !st.filters[id!]; return render()
      case 'fullwidth': st.fullWidth = !st.fullWidth; return render()
      case 'rail': st.railPinned = !st.railPinned; st.tool = null; return render()
      case 'compare': st.compare = !st.compare; return render()
      case 'closeside': st.side = null; return render()
      case 'closetool': st.tool = null; return render()
      case 'closesheet': st.sheet = null; return render()
      case 'sheetpin': { const s = st.sheet!; st.sheet = null; return pin(s.res, s.loc) }
      case 'sheetopen': { const s = st.sheet!; st.sheet = null; return open(s.res, s.loc) }
      case 'closepop': return closePops(Number(id))
      case 'pinpop': { const p = st.pops[Number(id)]; if (p) pin(p.res, p.loc); return }
      case 'openpop': { const p = st.pops[Number(id)]; st.pops = []; if (p) open(p.res, p.loc, arg as 'policy' | 'panel' | 'tab'); return }
      case 'unpin': ws.pinned.splice(Number(id), 1); return render()
      case 'collapsepin': { const p = pv(id); if (p) p.collapsed = true; return render() }
      case 'dockpin': { const p = ws.pinned.splice(Number(id), 1)[0]; if (p) open(p.res, p.loc, 'panel'); return }
      case 'link': if (P) { setLink(ws, id!, arg!); st.menu = null; render('panel') } return
      case 'role': if (P) { P.linkRole = arg as Panel['linkRole']; st.menu = null; render('panel') } return
      case 'lock': if (P) { P.locked = !P.locked; st.menu = null; render('panel') } return
      case 'send': if (P) { st.menu = null; navigate(arg!, tabOf(P).loc, { focus: 'panel' }) } return
      case 'sendnew': if (P) { st.menu = null; open(tabOf(P).res, tabOf(P).loc, 'panel') } return
      case 'max': st.menu = null; return toggleMax(id!)
      case 'fold': if (P) { st.menu = null; P.preferredVisible = false; if (ws.activePanelId === id) { const o = leaves(ws.layoutTree).find((x) => x !== id); if (o) activate(ws, o) } render('panel') } return
      case 'close': st.menu = null; if (closePanel(ws, id!)) render('panel'); return
    }
  }

  // ---- Forms

  const onSubmit = (e: Event) => {
    const f = e.target as HTMLFormElement
    if (f.matches('[data-note-form]')) {
      e.preventDefault()
      const P = ws.panels[f.dataset.noteForm!]
      const v = f.querySelector('textarea')!.value.trim()
      if (!v || !P) return
      const loc = tabOf(P).loc;
      (notes[loc] ??= []).push(v)
      store.write(NOTES_KEY, notes)
      render()
    }
    if (f.matches('[data-save-form]')) { e.preventDefault(); saveLayout(f.querySelector('input')!.value.trim() || `Layout ${st.saved.length + 1}`) }
  }
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement
    if (t.matches('[data-cmd-input]') && st.cmd) { st.cmd.q = t.value; st.cmd.sel = 0; const list = $('[data-cmd-list]', stage); if (list) list.innerHTML = cmdListHtml() }
  }

  // ---- Keyboard: panels, tabs, link sets, send-to and the command bar without a mouse.

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (!stage.contains(t)) return
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
    if (st.cmd && t.matches('[data-cmd-input]')) {
      const cmd = st.cmd
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cmd.sel = clamp(cmd.sel + (e.key === 'ArrowDown' ? 1 : -1), 0, cmd.items.length - 1); $('[data-cmd-list]', stage)!.innerHTML = cmdListHtml(); return }
      if (e.key === 'Enter') { e.preventDefault(); runCmd(cmd.sel); return }
      if (e.key === 'Escape') { e.preventDefault(); st.cmd = null; render('panel') }
      return
    }
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openCmd(); return }
    if (e.key === 'Escape') {
      if (st.pops.length) { e.preventDefault(); closePops(st.pops.length - 1); return }
      if (st.menu) { e.preventDefault(); st.menu = null; render('panel'); return }
      if (st.sheet || st.tool || st.side) { e.preventDefault(); st.sheet = null; st.tool = null; st.side = null; render('panel') }
      return
    }
    if (st.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = $$<HTMLButtonElement>('.pw__menu button:not([disabled])', stage)
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      e.preventDefault()
      items[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1)]?.focus()
      return
    }
    const sp = t.closest<HTMLElement>('[data-splitter]')
    if (sp && e.key.startsWith('Arrow')) { e.preventDefault(); nudgeSplit(sp, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.05 : -0.05); return }
    if (typing || !last) return
    const order = last.narrow ? last.order : last.visible
    if (e.key === 'F6') { e.preventDefault(); const j = order.indexOf(ws.activePanelId); activate(ws, order[(j + (e.shiftKey ? order.length - 1 : 1)) % order.length]!); render('panel'); return }
    if (e.altKey && (e.key === ']' || e.key === '[')) {
      e.preventDefault()
      const A = ws.panels[ws.activePanelId]!
      const dir = e.key === ']' ? 1 : -1
      if (A.tabs.length > 1) { A.activeTab = (A.activeTab + dir + A.tabs.length) % A.tabs.length; render('panel'); return }
      const stack = last.narrow ? last.order : [ws.activePanelId, ...(last.folded[ws.activePanelId] ?? [])]
      if (stack.length > 1) { const s = stack[(stack.indexOf(ws.activePanelId) + dir + stack.length) % stack.length]!; ws.panels[s]!.preferredVisible = true; activate(ws, s); render('panel') }
      return
    }
    if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); const P = ws.panels[ws.activePanelId]!; const cyc = [...SET_NAMES, 'none']; setLink(ws, P.id, cyc[(cyc.indexOf(P.linkSet ?? 'none') + 1) % cyc.length]!); render('panel'); return }
    if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); openCmd('send '); return }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); if (step(ws, ws.activePanelId, e.key === 'ArrowLeft' ? -1 : 1, known)) render('panel'); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') { e.preventDefault(); toggleMax(ws.activePanelId) }
  }

  // ---- Splitters: snap to 40, 50 and 60 percent, and refuse to squeeze a panel below 320 px.

  function setPair(spl: HTMLElement, ratio: number) {
    const [k, i] = spl.dataset.splitter!.split(':').map(Number) as [number, number]
    const n = viewSplits[k]
    if (!n) return
    const cells = Array.from(spl.parentElement!.children).filter((c) => c.classList.contains('pw__cell')) as HTMLElement[]
    const row = n.dir === 'row'
    const z = Number(root.dataset.zoom) || 1
    const a = cells[i]!.getBoundingClientRect()
    const b = cells[i + 1]!.getBoundingClientRect()
    const pairPx = (row ? a.width + b.width : a.height + b.height) / z
    const r = snapRatio(ratio, pairPx, row ? MIN_COL : 140, n.kids.length === 2)
    const sum = n.sizes[i]! + n.sizes[i + 1]!
    n.sizes[i] = sum * r
    n.sizes[i + 1] = sum * (1 - r)
    n.src.sizes[n.idx[i]!] = n.sizes[i]!
    n.src.sizes[n.idx[i + 1]!] = n.sizes[i + 1]!
    const g = grow(n.sizes)
    cells[i]!.style.flexGrow = String(g[i])
    cells[i + 1]!.style.flexGrow = String(g[i + 1])
    spl.setAttribute('aria-valuenow', String(Math.round(r * 100)))
  }
  function nudgeSplit(spl: HTMLElement, d: number) {
    const [k, i] = spl.dataset.splitter!.split(':').map(Number) as [number, number]
    const n = viewSplits[k]
    if (n) setPair(spl, n.sizes[i]! / (n.sizes[i]! + n.sizes[i + 1]!) + d)
  }

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as Element
    const spl = t.closest<HTMLElement>('[data-splitter]')
    if (spl?.dataset.splitter) {
      e.preventDefault()
      spl.setPointerCapture(e.pointerId)
      const [k, i] = spl.dataset.splitter.split(':').map(Number) as [number, number]
      const n = viewSplits[k]!
      const cells = Array.from(spl.parentElement!.children).filter((c) => c.classList.contains('pw__cell')) as HTMLElement[]
      const move = (ev: PointerEvent) => {
        const r1 = cells[i]!.getBoundingClientRect()
        const r2 = cells[i + 1]!.getBoundingClientRect()
        setPair(spl, n.dir === 'row' ? (ev.clientX - r1.left) / (r2.right - r1.left) : (ev.clientY - r1.top) / (r2.bottom - r1.top))
      }
      const up = () => { spl.removeEventListener('pointermove', move); spl.removeEventListener('pointerup', up); render() }
      spl.addEventListener('pointermove', move)
      spl.addEventListener('pointerup', up)
      return
    }
    const a = t.closest<HTMLElement>('[data-xref]')
    if (a && st.pointer === 'touch') {
      press = { x: e.clientX, y: e.clientY, fired: false, timer: 0 }
      press.timer = window.setTimeout(() => {
        if (!press) return
        press.fired = true
        const [res, loc] = a.dataset.xref!.split('|') as [string, string]
        if (last?.narrow) { st.sheet = { res, loc, full: false }; render() } else openPop(a)
      }, 500)
      return
    }
    if (t.closest('[data-body]') && last?.narrow) {
      const sx = e.clientX
      const sy = e.clientY
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up)
        const dx = ev.clientX - sx
        const dy = ev.clientY - sy
        if (Math.abs(dx) > 60 && Math.abs(dy) < 40 && last) {
          const j = last.order.indexOf(ws.activePanelId)
          const nj = j + (dx < 0 ? 1 : -1)
          if (nj >= 0 && nj < last.order.length) { activate(ws, last.order[nj]!); render() }
        }
      }
      document.addEventListener('pointerup', up)
    }
  }
  const onPointerMove = (e: PointerEvent) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); if (!press.fired) press = null } }
  const onPointerUp = () => { if (press && !press.fired) { clearTimeout(press.timer); press = null } }
  const onContext = (e: Event) => { if (press?.fired) e.preventDefault() }

  stage.addEventListener('pointerover', onOver)
  stage.addEventListener('pointerout', onOut)
  root.addEventListener('click', onClick)
  root.addEventListener('submit', onSubmit)
  root.addEventListener('input', onInput)
  root.addEventListener('keydown', onKeyDown)
  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('contextmenu', onContext)

  // Keep the workspace when the width changes: the same state renders at every tier.
  let roW = viewport.clientWidth
  let roFrame = 0
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const w = viewport.clientWidth
    if (!w || w === roW) return
    roW = w
    if (!roFrame) roFrame = requestAnimationFrame(() => { roFrame = 0; render() })
  }) : null
  observer?.observe(viewport)
  render()

  return {
    state: () => clone(ws),
    plan: () => last,
    render: () => render(),
    setBoard(board, custom) { st.board = board; st.custom = custom ?? null; render() },
    setPointer(pointer) { st.pointer = pointer; st.pops = []; render() },
    loadTemplate(name) { loadLayout(fromTemplate(name, tabOf(ws.panels[ws.activePanelId]!).loc)) },
    destroy() {
      destroyed = true
      observer?.disconnect()
      root.removeEventListener('click', onClick)
      root.removeEventListener('submit', onSubmit)
      root.removeEventListener('input', onInput)
      root.removeEventListener('keydown', onKeyDown)
      stage.removeEventListener('pointerover', onOver)
      stage.removeEventListener('pointerout', onOut)
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', onPointerUp)
      stage.removeEventListener('contextmenu', onContext)
    },
  }
}
