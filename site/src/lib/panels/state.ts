/**
 * The workspace state: dockable panels over cross-port concepts.
 *
 * The locator is a concept id; it is the truth. Linked panels share one
 * locator through a link set, a locked panel ignores links, and a follower
 * moves with its set without ever moving it. One state renders at every tier,
 * so nothing here depends on width.
 */
import { insertBeside, leaf, leaves, removeLeaf, split, type Node } from './layout'

export const SET_NAMES = ['A', 'B', 'C'] as const
export type LinkRole = 'bidirectional' | 'follower'
export const HISTORY_LIMIT = 50

export interface PanelTab { res: string; loc: string; scrollHint: number }

export interface Panel {
  id: string
  tabs: PanelTab[]
  activeTab: number
  linkSet: string | null
  linkRole: LinkRole
  locked: boolean
  preferredVisible: boolean
  history: string[]
  historyIndex: number
  /** The set a panel left, so Re-sync can bring it back. */
  formerSet: string | null
}

export interface Pinned { res: string; loc: string; collapsed?: boolean }

export interface Workspace {
  name: string
  layoutTree: Node
  panels: Record<string, Panel>
  linkSets: Record<string, string>
  activePanelId: string
  floating: { panelId: string }[]
  pinned: Pinned[]
  /** Panel ids, most recently active first. */
  recent: string[]
  maximized: string | null
  /** Panels the reader closed, newest first, which the Closed list can bring back. */
  closed: Panel[]
}

export const CLOSED_LIMIT = 12

/** A resource a panel can show: a port's API, every port, or the notes. */
export type Resource = 'equiv' | 'notes' | `api:${string}`
export const apiOf = (res: string): string | null => (res.startsWith('api:') ? res.slice(4) : null)
export const validResource = (res: string, ports: readonly string[]): boolean => res === 'equiv' || res === 'notes' || ports.includes(apiOf(res) ?? '')

export const DEFAULT_LOCATOR = 'capture-pane'

export function newPanel(id: string, res: string, loc: string, linkSet: string | null = null, linkRole: LinkRole = 'bidirectional'): Panel {
  return { id, tabs: [{ res, loc, scrollHint: 0 }], activeTab: 0, linkSet, linkRole, locked: false, preferredVisible: true, history: [loc], historyIndex: 0, formerSet: null }
}

export const activeTab = (p: Panel): PanelTab => p.tabs[p.activeTab]!

export type TemplateName = 'read' | 'compare' | 'study'
export const TEMPLATE_NAMES: Record<TemplateName, string> = { read: 'Read', compare: 'Compare', study: 'Study' }

/** The three starting layouts: Read (API and notes), Compare (three APIs in one set), Study (two APIs, All ports as a follower, notes, a pinned preview). */
export function fromTemplate(name: TemplateName, loc: string = DEFAULT_LOCATOR): Workspace {
  const base = { name: TEMPLATE_NAMES[name], linkSets: { A: loc }, floating: [], pinned: [] as Pinned[], recent: [] as string[], maximized: null, closed: [] as Panel[] }
  if (name === 'read') {
    return { ...base, layoutTree: split('row', [[leaf('p1'), 0.68], [leaf('p4'), 0.32]]), activePanelId: 'p1',
      panels: { p1: newPanel('p1', 'api:go', loc, 'A'), p4: newPanel('p4', 'notes', loc) } }
  }
  if (name === 'compare') {
    return { ...base, layoutTree: split('row', [[leaf('p1'), 1], [leaf('p2'), 1], [leaf('p5'), 1]]), activePanelId: 'p1',
      panels: { p1: newPanel('p1', 'api:go', loc, 'A'), p2: newPanel('p2', 'api:py', loc, 'A'), p5: newPanel('p5', 'api:rs', loc, 'A') } }
  }
  return {
    ...base, pinned: [{ res: 'api:rs', loc }], activePanelId: 'p1',
    layoutTree: split('row', [[leaf('p1'), 0.34], [leaf('p2'), 0.33], [split('col', [[leaf('p3'), 0.6], [leaf('p4'), 0.4]]), 0.33]]),
    panels: { p1: newPanel('p1', 'api:go', loc, 'A'), p2: newPanel('p2', 'api:py', loc, 'A'), p3: newPanel('p3', 'equiv', loc, 'A', 'follower'), p4: newPanel('p4', 'notes', loc) },
  }
}

export const clone = <T>(value: T): T => structuredClone(value)
export const panelIds = (ws: Workspace): string[] => Object.keys(ws.panels)

/** A panel whose locator differs from its set's, or from the set it left. */
export function isStale(ws: Workspace, p: Panel): boolean {
  const here = activeTab(p).loc
  if (p.linkSet) return here !== ws.linkSets[p.linkSet]
  return Boolean(p.formerSet && ws.linkSets[p.formerSet] && here !== ws.linkSets[p.formerSet])
}

/** The panels that share this panel's link set, most recently active first. */
export function partners(ws: Workspace, id: string): string[] {
  const p = ws.panels[id]
  if (!p?.linkSet) return []
  const same = panelIds(ws).filter((k) => k !== id && ws.panels[k]!.linkSet === p.linkSet)
  return [...ws.recent.filter((k) => same.includes(k)), ...same]
}

export function activate(ws: Workspace, id: string): void {
  if (!ws.panels[id]) return
  ws.activePanelId = id
  ws.recent = [id, ...ws.recent.filter((k) => k !== id)]
}

function setLoc(p: Panel, loc: string, push: boolean): void {
  const tab = activeTab(p)
  if (tab.loc !== loc) tab.scrollHint = 0
  tab.loc = loc
  if (push) {
    p.history = [...p.history.slice(0, p.historyIndex + 1), loc].slice(-HISTORY_LIMIT)
    p.historyIndex = p.history.length - 1
  }
}

export interface GoResult { ok: boolean; reason?: 'locked' | 'unknown'; moved: string[] }

/**
 * Take a panel to a concept. A driving panel moves its link set and every
 * unlocked panel in it; a follower or an unlinked panel moves alone; a locked
 * panel does not move.
 */
export function go(ws: Workspace, id: string, loc: string, known: (loc: string) => boolean, o: { nopush?: boolean } = {}): GoResult {
  const p = ws.panels[id]
  if (!p || !known(loc)) return { ok: false, reason: 'unknown', moved: [] }
  if (p.locked) return { ok: false, reason: 'locked', moved: [] }
  setLoc(p, loc, !o.nopush)
  activate(ws, id)
  const moved: string[] = []
  if (p.linkSet && p.linkRole === 'bidirectional') {
    ws.linkSets[p.linkSet] = loc
    for (const q of Object.values(ws.panels)) {
      if (q !== p && q.linkSet === p.linkSet && !q.locked && activeTab(q).loc !== loc) { setLoc(q, loc, true); moved.push(q.id) }
    }
  }
  return { ok: true, moved }
}

/** Back or forward in one panel's history; a driving panel's step moves its set too. */
export function step(ws: Workspace, id: string, dir: -1 | 1, known: (loc: string) => boolean): GoResult | null {
  const p = ws.panels[id]
  if (!p) return null
  const i = p.historyIndex + dir
  if (i < 0 || i >= p.history.length) return null
  p.historyIndex = i
  return go(ws, id, p.history[i]!, known, { nopush: true })
}

/** Join a link set, or leave with 'none'. A new set starts at the panel's own locator. */
export function setLink(ws: Workspace, id: string, set: string): void {
  const p = ws.panels[id]
  if (!p) return
  if (set === 'none') {
    if (p.linkSet) p.formerSet = p.linkSet
    p.linkSet = null
    return
  }
  p.formerSet = null
  p.linkSet = set
  if (!ws.linkSets[set]) ws.linkSets[set] = activeTab(p).loc
  else if (!p.locked) setLoc(p, ws.linkSets[set]!, true)
}

/** Re-sync: relink a panel that left its set, then jump it back to the set's locator. */
export function resync(ws: Workspace, id: string, known: (loc: string) => boolean): GoResult | null {
  const p = ws.panels[id]
  if (!p) return null
  if (!p.linkSet && p.formerSet) { p.linkSet = p.formerSet; p.formerSet = null }
  const loc = p.linkSet ? ws.linkSets[p.linkSet] : undefined
  if (!loc) return null
  // A locked panel re-syncs on request: the reader asked for it.
  const wasLocked = p.locked
  p.locked = false
  const result = go(ws, id, loc, known)
  p.locked = wasLocked
  return result
}

export function newPanelId(ws: Workspace): string {
  let n = 1
  while (ws.panels[`p${n}`]) n++
  return `p${n}`
}

/**
 * Target policy: a clicked port link opens in a panel already showing that
 * resource, else as a new tab in the active panel; `how` forces a new panel or
 * a new tab. Returns the panel that now shows it.
 */
export function openResource(ws: Workspace, res: string, loc: string, how: 'policy' | 'panel' | 'tab', known: (loc: string) => boolean): string | null {
  if (!known(loc)) return null
  if (how === 'policy') {
    const hit = panelIds(ws).find((k) => activeTab(ws.panels[k]!).res === res)
    if (hit) { go(ws, hit, loc, known); return hit }
  }
  const active = ws.panels[ws.activePanelId]
  if (how === 'panel' || !active) {
    const id = newPanelId(ws)
    ws.panels[id] = newPanel(id, res, loc)
    ws.layoutTree = active ? insertBeside(ws.layoutTree, ws.activePanelId, id, 'right') : leaf(id)
    activate(ws, id)
    return id
  }
  active.tabs.push({ res, loc, scrollHint: 0 })
  active.activeTab = active.tabs.length - 1
  return active.id
}

/** Close a panel; the last one stays. The closed panel keeps its tabs and history for `reopenPanel`. */
export function closePanel(ws: Workspace, id: string): boolean {
  if (!ws.panels[id] || panelIds(ws).length < 2) return false
  ws.closed = [ws.panels[id]!, ...ws.closed].slice(0, CLOSED_LIMIT)
  ws.floating = ws.floating.filter((f) => f.panelId !== id)
  if (leaves(ws.layoutTree).includes(id)) ws.layoutTree = removeLeaf(ws.layoutTree, id) ?? leaf(panelIds(ws).find((k) => k !== id)!)
  delete ws.panels[id]
  if (ws.maximized === id) ws.maximized = null
  ws.recent = ws.recent.filter((k) => k !== id)
  if (!ws.panels[ws.activePanelId]) activate(ws, panelIds(ws)[0]!)
  return true
}

/** Bring a closed panel back beside the active one, under a fresh id when its own has been reused. Returns the id it has now. */
export function reopenPanel(ws: Workspace, id: string): string | null {
  const p = ws.closed.find((c) => c.id === id)
  if (!p) return null
  ws.closed = ws.closed.filter((c) => c !== p)
  if (ws.panels[p.id]) p.id = newPanelId(ws)
  ws.panels[p.id] = p
  ws.layoutTree = ws.panels[ws.activePanelId] ? insertBeside(ws.layoutTree, ws.activePanelId, p.id, 'right') : leaf(p.id)
  activate(ws, p.id)
  return p.id
}

/** A state read back from storage, with the fields older sessions lacked. */
export const revive = (ws: Workspace): Workspace => ({ ...ws, closed: ws.closed ?? [] })

/**
 * Whether the state is whole: every panel is in the layout once or floating,
 * every leaf has a panel, the active panel exists, and every locator is known.
 * Returns the violations; an empty list is a valid workspace.
 */
export function violations(ws: Workspace, known: (loc: string) => boolean): string[] {
  const out: string[] = []
  const inTree = leaves(ws.layoutTree)
  const floating = ws.floating.map((f) => f.panelId)
  for (const id of inTree) if (!ws.panels[id]) out.push(`leaf ${id} has no panel`)
  for (const id of panelIds(ws)) {
    const places = inTree.filter((k) => k === id).length + floating.filter((k) => k === id).length
    if (places !== 1) out.push(`panel ${id} is placed ${places} times`)
    const p = ws.panels[id]!
    if (!p.tabs.length || p.activeTab < 0 || p.activeTab >= p.tabs.length) out.push(`panel ${id} has no active tab`)
    for (const t of p.tabs) if (!known(t.loc)) out.push(`panel ${id} is at unknown ${t.loc}`)
    if (p.linkSet && !(p.linkSet in ws.linkSets)) out.push(`panel ${id} is in missing set ${p.linkSet}`)
  }
  if (!ws.panels[ws.activePanelId]) out.push('no active panel')
  if (ws.maximized && !ws.panels[ws.maximized]) out.push('maximized panel is missing')
  return out
}
