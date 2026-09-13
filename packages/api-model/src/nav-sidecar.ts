import { CONCEPTS } from './concepts.ts'
import type { ApiModel, ApiSymbol } from './model.ts'
import { moduleOf } from './modules.ts'
import { NAV } from './nav-config.ts'
import { compileNav, type Bucket } from './nav.ts'
import { OWNER_KINDS } from './prose.ts'

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
  const navTypes = model.symbols.filter((s) => !s.parent && OWNER_KINDS.has(s.kind))
  const conceptIds = Object.fromEntries(
    Object.entries(CONCEPTS)
      .map(([k, c]) => [k, c.symbols[port]] as const)
      .filter((e): e is readonly [string, string] => typeof e[1] === 'string'),
  )
  const compiled = compileNav(nav, navTypes, { conceptIds, moduleOf })
  const byId = new Map(model.symbols.map((s) => [s.publicId ?? s.id, s]))
  const entries = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((sym): sym is ApiSymbol => sym !== undefined)
      .map((sym) => ({ id: sym.publicId ?? sym.id, name: sym.name, slug: sym.slug, kind: sym.kind }))
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
