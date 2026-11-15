/**
 * How the constant workspace renders at a width: which panels show, which fold
 * into which tab stack. The tree is never edited, so widening restores the
 * exact arrangement.
 *
 * Panels stay visible in this order when they do not all fit: the active
 * panel, its link partners by recency, panels not moved into a stack, then
 * layout order. Each folded panel joins the nearest visible region.
 */
import { MAX_WORK, NESTING, TIERS, columnCap, effectiveTier, railWidth, type Tier } from './tiers'
import { leaves, limitDepth, prune, type ViewNode } from './layout'
import { partners, type Workspace } from './state'

export interface PlanUi {
  /** The tier the last render used, for the dead band. */
  prevTier?: Tier | null
  railPinned: boolean
  fullWidth: boolean
}

export interface WorkspacePlan {
  tier: Tier
  width: number
  height: number
  /** T0 and T1: one panel at a time, a switcher of the rest. */
  narrow: boolean
  short: boolean
  all: string[]
  floats: string[]
  /** Narrow only: every panel, in switcher order. */
  order: string[]
  workWidth: number
  railWidth: number
  /** The rail collapsed to icons so no panel had to fold. */
  railAuto: boolean
  cap: number
  view: ViewNode | null
  visible: string[]
  hidden: string[]
  /** For each visible panel, the panels folded into its region. */
  folded: Record<string, string[]>
  /** T4 and up float these as windows; below T4 they fold. */
  floated: string[]
}

export function planWorkspace(ws: Workspace, width: number, height: number, ui: PlanUi): WorkspacePlan {
  const tier = effectiveTier(width, height, ui.prevTier)
  const all = leaves(ws.layoutTree)
  const floats = ws.floating.map((f) => f.panelId).filter((id) => ws.panels[id])
  const base = {
    tier, width, height, narrow: tier.t <= 1, short: height < 500, all, floats, order: [] as string[],
    workWidth: width, railWidth: 0, railAuto: false, cap: 1, view: null as ViewNode | null, visible: [] as string[], hidden: [] as string[],
    folded: {} as Record<string, string[]>, floated: [] as string[],
  }
  if (base.narrow) return { ...base, order: [...all, ...floats], visible: [], cap: 1 }

  const workWidth = tier.t === 5 && !ui.fullWidth ? Math.min(width, MAX_WORK) : width
  let rail = railWidth(tier, ui.railPinned)
  let cap = columnCap(tier, workWidth, rail)
  let railAuto = false
  // The tool rail collapses before any panel folds.
  if (rail === 240 && all.length > cap && columnCap(tier, workWidth, 48) > cap) { rail = 48; railAuto = true; cap = columnCap(tier, workWidth, rail) }
  const floated = tier.t >= 4 ? floats : []
  const out = { ...base, workWidth, railWidth: rail, railAuto, cap, floated }

  if (ws.maximized && ws.panels[ws.maximized] && all.includes(ws.maximized)) {
    return { ...out, view: { p: ws.maximized }, folded: { [ws.maximized]: [] }, visible: [ws.maximized], hidden: [] }
  }
  let visible = [...all]
  if (all.length > cap) {
    visible = []
    const want = [ws.activePanelId, ...partners(ws, ws.activePanelId), ...all.filter((id) => ws.panels[id]!.preferredVisible), ...all]
    for (const id of want) if (all.includes(id) && !visible.includes(id) && visible.length < cap) visible.push(id)
  }
  const pruned = prune(ws.layoutTree, visible)
  const view = pruned ? limitDepth(pruned, NESTING[tier.t] ?? 3, ws.activePanelId) : null
  const shown = view ? leaves(view) : []
  const hidden = [...all.filter((id) => !shown.includes(id)), ...(tier.t >= 4 ? [] : floats)]
  const folded: Record<string, string[]> = Object.fromEntries(shown.map((id) => [id, [] as string[]]))
  for (const id of hidden) {
    const i = all.indexOf(id)
    let best: string | undefined
    for (let j = i - 1; i >= 0 && j >= 0 && !best; j--) if (shown.includes(all[j]!)) best = all[j]
    for (let j = i + 1; i >= 0 && j < all.length && !best; j++) if (shown.includes(all[j]!)) best = all[j]
    folded[best ?? shown[shown.length - 1]!]!.push(id)
  }
  return { ...out, view, visible: shown, hidden, folded }
}

export { TIERS }
