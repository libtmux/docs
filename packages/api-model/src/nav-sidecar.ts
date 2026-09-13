import { CONCEPTS } from './concepts.ts'
import type { ApiModel, ApiSymbol } from './model.ts'
import { moduleOf } from './modules.ts'
import { NAV } from './nav-config.ts'
import { compileNav, type Bucket } from './nav.ts'
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
  // Every top-level symbol, not only the types: a free function, constant or
  // type alias has a page, and a sidebar that placed only types gave 1,282 of
  // those pages no row.
  const topLevel = model.symbols.filter((s) => !s.parent)
  const conceptIds = Object.fromEntries(
    Object.entries(CONCEPTS)
      .map(([k, c]) => [k, c.symbols[port]] as const)
      .filter((e): e is readonly [string, string] => typeof e[1] === 'string'),
  )
  const compiled = compileNav(nav, topLevel, { conceptIds, moduleOf })
  const byId = new Map(model.symbols.map((s) => [s.publicId ?? s.id, s]))
  /*
   * A bucket's types first, in the order they always had, then its type
   * aliases, values and functions by name. Types are what a reader scans a
   * bucket for, and Rust's Options holds 218 generated constants beside them.
   * Overloads share an id and are one row.
   */
  const entries = (ids: string[]) => {
    const symbols = [...new Set(ids)].map((id) => byId.get(id)).filter((sym): sym is ApiSymbol => sym !== undefined)
    const free = symbols
      .filter((sym) => !OWNER_KINDS.has(sym.kind))
      .sort((a, b) => FREE_ORDER[a.kind] - FREE_ORDER[b.kind] || a.name.localeCompare(b.name))
    return [...symbols.filter((sym) => OWNER_KINDS.has(sym.kind)), ...free].map((sym) => ({
      id: sym.publicId ?? sym.id,
      name: sym.name,
      slug: sym.slug,
      kind: sym.kind,
    }))
  }
  const shape = (buckets: Bucket[]): unknown[] =>
    buckets.map((b) => ({
      id: b.id,
      label: b.label,
      collapsed: b.collapsed ?? false,
      ...(b.children ? { children: shape(b.children) } : {}),
    }))
  return {
    port,
    buckets: shape(nav.buckets),
    assignments: Object.fromEntries(
      Object.entries(compiled.assignments).map(([bucket, ids]) => [bucket, entries(ids)]),
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
