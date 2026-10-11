import { CONCEPTS } from './concepts.ts'
import type { ApiModel, ApiModelBase, ApiSymbol } from './model.ts'
import { moduleOf } from './modules.ts'
import { NAV } from './nav-config.ts'
import { compileNav, type Bucket, type PortNav } from './nav.ts'
import { OWNER_KINDS } from './prose.ts'

/** Where a symbol that is not a type sits among a bucket's rows. */
const FREE_ORDER: Record<string, number> = {
  typealias: 0,
  constant: 1,
  attribute: 1,
  property: 1,
  function: 2,
  method: 2,
  module: 3,
}

/** An explicit navigation plan, independent of the library port registry. */
export type NavConfig = Omit<PortNav, 'port'>

export interface NavSidecarBucket {
  id: string
  label: string
  collapsed: boolean
  children?: NavSidecarBucket[]
}

/**
 * A port's compiled sidebar, exactly as `<port>.nav.json` holds it.
 *
 * A function of the model alone. The sidecar used to be written only beside a
 * full extraction, which needs all eight port checkouts, so an edit to
 * nav-config.ts could not be applied without re-extracting every model, and
 * CI, which has no checkouts, could not tell a stale sidecar from a fresh one.
 * `gen-api-model.mjs --nav` writes this and `check-nav.mjs` compares it.
 */
export function navSidecar(port: string, model: ApiModel) {
  const nav = NAV[port]
  if (!nav) return undefined
  return navSidecarFor(port, model, nav)
}

/** Compile the same navigation contract for an explicitly supplied catalog. */
export function navSidecarFor(scope: string, model: ApiModelBase, nav: NavConfig) {
  // Every top-level symbol, not only the types: a free function, constant or
  // type alias has a page, and a sidebar that placed only types gave 1,282 of
  // those pages no row.
  const topLevel = model.symbols.filter((s) => !s.parent)
  const conceptIds = Object.fromEntries(
    Object.entries(CONCEPTS)
      .map(([k, c]) => [k, c.symbols[scope]] as const)
      .filter((e): e is readonly [string, string] => typeof e[1] === 'string'),
  )
  const compiled = compileNav({ ...nav, port: scope }, topLevel, { conceptIds, moduleOf })
  const byId = new Map(model.symbols.map((s) => [s.publicId ?? s.id, s]))
  const orders = new Map<string, string[]>()
  const collectOrders = (buckets: Bucket[]) => {
    for (const bucket of buckets) {
      if (bucket.order) orders.set(bucket.id, bucket.order)
      collectOrders(bucket.children ?? [])
    }
  }
  collectOrders(nav.buckets)
  /*
   * Explicitly ordered declarations lead. The remaining types keep their
   * order, then type aliases, values and functions follow by name. Types are what a reader scans a
   * bucket for, and Rust's Options holds 218 generated constants beside them.
   * Overloads share an id and are one row.
   */
  const entries = (ids: string[], order: string[] = []) => {
    const symbols = [...new Set(ids)].map((id) => byId.get(id)).filter((sym): sym is ApiSymbol => sym !== undefined)
    const ranks = new Map([...new Set(order)].map((id, rank) => [id, rank]))
    const ordered = symbols
      .filter((sym) => ranks.has(sym.publicId ?? sym.id))
      .sort((a, b) => ranks.get(a.publicId ?? a.id)! - ranks.get(b.publicId ?? b.id)!)
    const remaining = symbols.filter((sym) => !ranks.has(sym.publicId ?? sym.id))
    const free = remaining
      .filter((sym) => !OWNER_KINDS.has(sym.kind))
      .sort((a, b) => FREE_ORDER[a.kind] - FREE_ORDER[b.kind] || a.name.localeCompare(b.name))
    return [...ordered, ...remaining.filter((sym) => OWNER_KINDS.has(sym.kind)), ...free].map((sym) => ({
      id: sym.publicId ?? sym.id,
      name: sym.name,
      slug: sym.slug,
      kind: sym.kind,
    }))
  }
  const shape = (buckets: Bucket[]): NavSidecarBucket[] =>
    buckets.map((b) => ({
      id: b.id,
      label: b.label,
      collapsed: b.collapsed ?? false,
      ...(b.children ? { children: shape(b.children) } : {}),
    }))
  return {
    port: scope,
    buckets: shape(nav.buckets),
    assignments: Object.fromEntries(
      Object.entries(compiled.assignments).map(([bucket, ids]) => [bucket, entries(ids, orders.get(bucket))]),
    ),
    // Every symbol, including the unplaced: a page looks its bucket up and
    // never scans a list to discover it has none.
    placement: Object.fromEntries([
      ...Object.entries(compiled.assignments).flatMap(([bucket, ids]) => ids.map((id) => [id, bucket])),
      ...compiled.unplaced.map((id) => [id, '__unplaced']),
    ]),
    unplaced: entries(compiled.unplaced),
    diagnostics: compiled.diagnostics,
  }
}
