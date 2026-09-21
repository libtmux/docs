/**
 * The API reference's navigation tree, shared by the page that renders its
 * own branch and the JSON the other branches load when a reader opens them.
 *
 * Buckets and their contents are decided once per port in
 * `scripts/gen-api-model.mjs`; this only shapes them for a tree.
 */
import { symbolsForProduct } from '@libtmux/api-model'
import { API_MODELS, API_NAV, OWNER_KINDS, pageSlug, type NavEntry } from './api-models'

export interface TreeBucket {
  id: string
  label: string
  collapsed: boolean
  entries: NavEntry[]
  children: TreeBucket[]
}

export interface TreeMember {
  id: string
  name: string
  slug: string
}

/**
 * A bucket's rows, with a name that repeats among them shown as its id.
 *
 * Python's Internal holds ten module loggers and its MCP bucket eleven
 * functions called `register`, and ten rows reading `logger` ask a reader to
 * pick one by guessing.
 */
const distinct = (entries: NavEntry[]): NavEntry[] => {
  const count = new Map<string, number>()
  for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1)
  return entries.map((e) => ((count.get(e.name) ?? 0) > 1 ? { ...e, name: e.id } : e))
}

/** tmux's five primary objects lead their own reader-facing domains. */
const PRIMARY_OBJECT_BUCKETS = new Set(['server', 'session', 'window', 'pane', 'client'])

const identitySegments = (id: string) => id.split(/::|[.:/]/).filter(Boolean)

/**
 * Put a domain's actual tmux object before its helpers.
 *
 * The nav sidecar preserves source order, which is useful curation data, but
 * that can put `CommandOutcome` or `Fields.Server` ahead of `libtmux.Server`.
 * In the reader tree, an exact object identity wins; equal names choose the
 * shallowest public identity, so `libtmux.Server` precedes
 * `libtmux.Fields.Server`. All other entries retain their curated order.
 */
const primaryObjectFirst = (bucket: { id: string; label: string }, entries: NavEntry[]): NavEntry[] => {
  if (!PRIMARY_OBJECT_BUCKETS.has(bucket.id)) return entries
  const rank = (entry: NavEntry) =>
    OWNER_KINDS.has(entry.kind) && identitySegments(entry.id).at(-1)?.toLowerCase() === bucket.label.toLowerCase()
      ? 0
      : 1
  return entries.toSorted((left, right) => {
    const order = rank(left) - rank(right)
    return order || (rank(left) === 0 ? identitySegments(left.id).length - identitySegments(right.id).length : 0)
  })
}

/**
 * A port's buckets, each with the types it holds and the children it splits
 * into.
 *
 * A bucket of 55 is a list rather than a grouping, so the ones that grow are
 * divided. Children carry symbols of their own, so a tree that rendered only
 * the top level would drop 83 of Rust's. Unplaced symbols are named "Other"
 * rather than hidden: every one is listed in `unsettled` in nav-config.ts,
 * and a symbol with a page and no way to reach it is worse than an honest
 * bucket at the bottom.
 */
export function navTree(port: string): TreeBucket[] {
  const nav = API_NAV[port]
  if (!nav) return []
  // The core library's tree lists the core library. A Workspace Manager or
  // MCP declaration has a page in its own package's reference, so a row for
  // it here would point out of this tree — and did, at a URL that no longer
  // exists.
  const model = API_MODELS[port]
  const products = new Set(model
    ? [...symbolsForProduct(model, 'mcp'), ...symbolsForProduct(model, 'workspace')].map((s) => s.publicId ?? s.id)
    : [])
  const core = (entries: NavEntry[]) => entries.filter((e) => !products.has(e.id))
  const displayEntries = (bucket: { id: string; label: string }, entries: NavEntry[]) =>
    primaryObjectFirst(bucket, distinct(core(entries)))
  return [
    ...nav.buckets
      .map((b) => ({
        id: b.id,
        label: b.label,
        collapsed: b.collapsed,
        entries: displayEntries(b, nav.assignments[b.id] ?? []),
        children: (b.children ?? [])
          .map((c) => ({ id: c.id, label: c.label, collapsed: c.collapsed, entries: displayEntries(c, nav.assignments[c.id] ?? []), children: [] }))
          .filter((c) => c.entries.length > 0),
      }))
      .filter((b) => b.entries.length > 0 || b.children.length > 0),
    ...(nav.unplaced.length > 0
      ? [{ id: '__unplaced', label: 'Other', collapsed: true, entries: displayEntries({ id: '__unplaced', label: 'Other' }, nav.unplaced), children: [] }]
      : []),
  ]
}

/** Everything a bucket holds, its children included, for the count beside it. */
export const bucketTotal = (b: TreeBucket): number =>
  b.entries.length + b.children.reduce((n, c) => n + c.entries.length, 0)

/**
 * The entry a bucket's own link lands on: the type the bucket is named for
 * when there is one, so Window opens `libtmux.Window` rather than whichever of
 * `WindowDirection` and `WindowOptions` sorted first. A row shown by its id
 * still counts, so Go's Window opens `tmux.Window` before `workspace.Window`.
 */
export const bucketTarget = (label: string, entries: { name: string; slug: string }[]) =>
  entries.find((e) => e.name.split(/[.:/]+/).pop()?.toLowerCase() === label.toLowerCase()) ?? entries[0]

/**
 * The entry a bucket's link lands on: a type, from the bucket itself or else
 * its first child that holds one, and a function or constant only where no
 * type is under it. TypeScript's Workspaces holds two type aliases of its own
 * beside Plan's types, and still opens on `PanePlans`.
 */
export const firstEntry = (b: TreeBucket) => {
  const isType = (e: NavEntry) => OWNER_KINDS.has(e.kind)
  const types = [b.entries, ...b.children.map((c) => c.entries)].map((list) => list.filter(isType)).find((list) => list.length > 0)
  return bucketTarget(b.label, types ?? (b.entries.length > 0 ? b.entries : (b.children[0]?.entries ?? [])))
}

const membersCache = new Map<string, Map<string, TreeMember[]>>()

/** Every owner's members, sorted by name and keyed by the id the nav uses for the owner. */
export function membersByType(port: string): Map<string, TreeMember[]> {
  const cached = membersCache.get(port)
  if (cached) return cached
  const out = new Map<string, TreeMember[]>()
  const model = API_MODELS[port]
  if (model) {
    const byId = new Map(model.symbols.map((s) => [s.id, s]))
    for (const s of model.symbols) {
      const owner = s.parent ? byId.get(s.parent) : undefined
      if (!owner || !OWNER_KINDS.has(owner.kind)) continue
      const key = owner.publicId ?? owner.id
      const list = out.get(key) ?? []
      list.push({ id: s.id, name: s.name, slug: s.slug ?? pageSlug(s.publicId ?? s.id) })
      out.set(key, list)
    }
    for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  }
  membersCache.set(port, out)
  return out
}
