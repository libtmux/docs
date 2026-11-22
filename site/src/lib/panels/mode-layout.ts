/**
 * The arrangement of the mode's panels, kept per browser and shared by every page.
 *
 * Panel ids name a role, not a page: `main` is the page itself and `link:<port>` is that port's
 * equivalent, so one saved arrangement applies on every page that offers those panels.
 */
import { isLeaf, leaf, leaves, removeLeaf, split, type Node } from './layout'

export const LAYOUT_KEY = 'libtmux-docs.panel-layout'
export const MAIN_PANEL = 'main'
/** Linked panels open beside the page by default; the rest wait in the Panels list. */
export const LINKED_OPEN_BY_DEFAULT = 2

export interface ModeLayout { v: 1; tree: Node; closed: string[] }

const isNode = (value: unknown, depth = 0): value is Node => {
  if (!value || typeof value !== 'object' || depth > 8) return false
  const n = value as Record<string, unknown>
  if (typeof n.p === 'string') return true
  return (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.kids) && Array.isArray(n.sizes) && n.kids.length === n.sizes.length
    && n.kids.length > 0 && n.sizes.every((s) => typeof s === 'number' && s > 0) && n.kids.every((k) => isNode(k, depth + 1))
}

/** What storage held, if it is a layout this code wrote. */
export function parseLayout(value: unknown): ModeLayout | undefined {
  const v = value as Partial<ModeLayout> | null
  if (!v || v.v !== 1 || !isNode(v.tree) || !Array.isArray(v.closed) || !v.closed.every((id) => typeof id === 'string')) return undefined
  // A panel is in the layout once, so a tree that holds one twice is not one this code wrote.
  const shown = leaves(v.tree)
  if (new Set(shown).size !== shown.length) return undefined
  return { v: 1, tree: v.tree, closed: v.closed.filter((id) => !shown.includes(id)) }
}

/** One row: the page takes twice a linked panel's width. */
export function defaultTree(open: readonly string[]): Node {
  const [first, ...rest] = open
  if (!first) return leaf(MAIN_PANEL)
  return rest.length ? split('row', [[leaf(first), 2], ...rest.map((id): [Node, number] => [leaf(id), 1])]) : leaf(first)
}

/** A panel docked at the right edge of the whole layout. */
function appendRight(tree: Node, id: string): Node {
  if (isLeaf(tree) || tree.dir !== 'row') return split('row', [[tree, 1], [leaf(id), 1]])
  tree.kids.push(leaf(id))
  tree.sizes.push(tree.sizes.reduce((a, b) => a + b, 0) / tree.sizes.length)
  return tree
}

/**
 * The layout for the panels this page offers: the saved arrangement where it still applies, else the default.
 * `closed` is the panels the reader closed; a panel in neither the tree nor `closed` is one the page did not open,
 * which waits in the Panels list. A saved panel this page lacks is dropped, and a panel the page opens by default
 * that the tree lacks opens at the right edge. A panel the reader closed stays closed. The page is never closed.
 */
export function reconcile(saved: ModeLayout | undefined, ids: readonly string[], open: readonly string[]): ModeLayout {
  let tree: Node | null = saved ? structuredClone(saved.tree) : null
  if (saved) for (const id of leaves(saved.tree)) if (!ids.includes(id)) tree = tree && removeLeaf(tree, id)
  if (!tree) return { v: 1, tree: defaultTree(open.filter((id) => ids.includes(id))), closed: [] }
  const closed = saved!.closed.filter((id) => ids.includes(id) && id !== MAIN_PANEL)
  for (const id of ids) {
    if (leaves(tree).includes(id) || closed.includes(id)) continue
    if (id === MAIN_PANEL || open.includes(id)) tree = appendRight(tree, id)
  }
  return { v: 1, tree, closed }
}
