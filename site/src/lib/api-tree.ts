/**
 * The API reference's navigation tree, shared by the page that renders its
 * own branch and the JSON the other branches load when a reader opens them.
 *
 * Buckets and their contents are decided once per port in
 * `scripts/gen-api-model.mjs`; this only shapes them for a tree.
 */
import { membersOf, memberSignals, qualifiedNameOf, symbolsForProduct, type ApiModelBase } from '@libtmux/api-model'
import mentions from '../data/mentions.json'
import {
  API_MODELS,
  API_NAV,
  OWNER_KINDS,
  pageSlug,
  topLevelTypesOf,
  type NavEntry,
  type PortNavData,
  type NavBucket,
} from './api-models'
import type { ApiTreeBucket, ApiTreeJson } from './api-search'

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

export interface NavTreeOptions {
  /** Library-specific labels and member semantics, when applicable. */
  scope?: string
  excludeProducts?: boolean
  primaryObjectsFirst?: boolean
}

const productSymbols = (model: ApiModelBase) => [
  ...symbolsForProduct(model, 'mcp'),
  ...symbolsForProduct(model, 'workspace'),
]

/**
 * A bucket's rows, with a name that repeats among them shown as its id.
 *
 * Python's Internal holds ten module loggers and its MCP bucket eleven
 * functions called `register`, and ten rows reading `logger` ask a reader to
 * pick one by guessing.
 */
const distinct = (entries: NavEntry[], model: ApiModelBase, scope: string): NavEntry[] => {
  const count = new Map<string, number>()
  for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1)
  return entries.map((entry) => {
    if ((count.get(entry.name) ?? 0) < 2) return entry
    const label =
      scope === 'scala'
        ? `${entry.name} (${entry.id.includes('.cats.') ? 'Cats Effect' : entry.id.includes('.ox.') ? 'Ox' : 'Direct API'})`
        : (model.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === entry.id)?.qualifiedName ?? entry.id)
    return { ...entry, name: label }
  })
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
  const model = API_MODELS[port]
  if (!nav || !model) return []
  return navTreeFor(model, nav, { scope: port, excludeProducts: true, primaryObjectsFirst: true })
}

/** Shape an explicit catalog and compiled navigation without a registered port. */
export function navTreeFor(model: ApiModelBase, nav: PortNavData, options: NavTreeOptions = {}): TreeBucket[] {
  // The core library's tree lists the core library. A Workspace Manager or
  // MCP declaration has a page in its own package's reference, so a row for
  // it here would point out of this tree — and did, at a URL that no longer
  // exists.
  const products = new Set(options.excludeProducts ? productSymbols(model).map((s) => s.publicId ?? s.id) : [])
  const core = (entries: NavEntry[]) => entries.filter((e) => !products.has(e.id))
  const displayEntries = (bucket: { id: string; label: string }, entries: NavEntry[]) => {
    const distinctEntries = distinct(core(entries), model, options.scope ?? '')
    return options.primaryObjectsFirst ? primaryObjectFirst(bucket, distinctEntries) : distinctEntries
  }
  const bucket = (b: NavBucket): TreeBucket => ({
    id: b.id,
    label: b.label,
    collapsed: b.collapsed,
    entries: displayEntries(b, nav.assignments[b.id] ?? []),
    children: (b.children ?? []).map(bucket).filter((child) => child.entries.length > 0 || child.children.length > 0),
  })
  return [
    ...nav.buckets.map(bucket).filter((b) => b.entries.length > 0 || b.children.length > 0),
    ...(nav.unplaced.length > 0
      ? [
          {
            id: '__unplaced',
            label: 'Other',
            collapsed: true,
            entries: displayEntries({ id: '__unplaced', label: 'Other' }, nav.unplaced),
            children: [],
          },
        ]
      : []),
  ]
}

/** The same ordered declarations and section anchors serve HTML and exports. */
export function referenceIndexSections(port: string) {
  const model = API_MODELS[port]
  if (!model) return []
  return referenceIndexSectionsFor(model, navTree(port))
}

/** Index cards and export headings share the supplied tree's exact ordering. */
export function referenceIndexSectionsFor(model: ApiModelBase, tree: TreeBucket[]) {
  const cards = new Set(topLevelTypesOf(model).map((symbol) => symbol.id))
  const symbols = new Map(
    model.symbols.filter((symbol) => !symbol.parent).map((symbol) => [symbol.publicId ?? symbol.id, symbol]),
  )
  const section = (bucket: TreeBucket, name: string, collapsed: boolean) => {
    const entries = bucket.entries
      .map((entry) => symbols.get(entry.id))
      .filter((symbol): symbol is NonNullable<typeof symbol> => symbol !== undefined)
    return {
      id: bucket.id,
      name,
      collapsed,
      types: entries.filter((symbol) => cards.has(symbol.id)),
      free: entries.filter((symbol) => !cards.has(symbol.id)),
    }
  }
  const sections = (bucket: TreeBucket, label: string, collapsed: boolean): ReturnType<typeof section>[] => [
    section(bucket, label, collapsed),
    ...bucket.children.flatMap((child) => sections(child, `${label} — ${child.label}`, collapsed || child.collapsed)),
  ]
  return tree
    .flatMap((bucket) => sections(bucket, bucket.label, bucket.collapsed))
    .filter((entry) => entry.types.length || entry.free.length)
}

/** Everything a bucket holds, its children included, for the count beside it. */
export const bucketTotal = (b: TreeBucket): number =>
  b.entries.length + b.children.reduce((n, c) => n + bucketTotal(c), 0)

/**
 * The entry a bucket's own link lands on: the type the bucket is named for
 * when there is one, so Window opens `libtmux.Window` rather than whichever of
 * `WindowDirection` and `WindowOptions` sorted first. A row shown by its id
 * still counts, so Go's Window opens `tmux.Window` before `workspace.Window`.
 */
export const bucketTarget = (label: string, entries: { name: string; slug: string }[]) =>
  entries.find(
    (e) =>
      e.name
        .split(/[.:/]+/)
        .pop()
        ?.toLowerCase() === label.toLowerCase(),
  ) ?? entries[0]

/**
 * The entry a bucket's link lands on: a type, from the bucket itself or else
 * its first child that holds one, and a function or constant only where no
 * type is under it. TypeScript's Workspaces holds two type aliases of its own
 * beside Plan's types, and still opens on `PanePlans`.
 */
export const firstEntry = (b: TreeBucket) => {
  const lists = (bucket: TreeBucket): NavEntry[][] => [bucket.entries, ...bucket.children.flatMap(lists)]
  const entries = lists(b)
  const types = entries
    .map((list) => list.filter((entry) => OWNER_KINDS.has(entry.kind)))
    .find((list) => list.length > 0)
  return bucketTarget(b.label, types ?? entries.find((list) => list.length > 0) ?? [])
}

const membersCache = new Map<string, Map<string, TreeMember[]>>()

/** Every owner's members, in the same useful-first order as its reference page. */
export function membersByType(port: string): Map<string, TreeMember[]> {
  const cached = membersCache.get(port)
  if (cached) return cached
  const model = API_MODELS[port]
  const out = model ? membersByTypeFor(port, model) : new Map<string, TreeMember[]>()
  membersCache.set(port, out)
  return out
}

/** Compute each catalog independently; same-scope versions never share cached members. */
export function membersByTypeFor(scope: string, model: ApiModelBase): Map<string, TreeMember[]> {
  const out = new Map<string, TreeMember[]>()
  const signals = memberSignals(scope, mentions.mentions)
  for (const owner of model.symbols.filter((symbol) => OWNER_KINDS.has(symbol.kind))) {
    const members = membersOf(model, owner, signals)
    if (members.length)
      out.set(
        owner.publicId ?? owner.id,
        members.map((symbol) => ({
          id: symbol.id,
          name: symbol.name,
          slug: symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id),
        })),
      )
  }
  return out
}

export interface ReferenceTreeOptions {
  excludeProducts?: boolean
  members?: Map<string, TreeMember[]>
}

/** The port-scoped inventory served to lazy branches and symbol search. */
export function referenceTree(port: string): ApiTreeJson {
  const model = API_MODELS[port]
  if (!model) return { port, buckets: [], members: {} }
  return referenceTreeFor(port, model, navTree(port), { excludeProducts: true, members: membersByType(port) })
}

/** Serialize the same tree consumed by initial HTML, without registry lookups. */
export function referenceTreeFor(
  scope: string,
  model: ApiModelBase,
  tree: TreeBucket[],
  options: ReferenceTreeOptions = {},
): ApiTreeJson {
  const products = new Set(options.excludeProducts ? productSymbols(model).map((symbol) => symbol.id) : [])
  const symbols = new Map(
    model.symbols
      .filter((symbol) => !products.has(symbol.id))
      .flatMap(
        (symbol) =>
          [
            [symbol.id, symbol],
            [symbol.publicId ?? symbol.id, symbol],
          ] as const,
      ),
  )
  // The shared cache includes product declarations; scope only this core inventory.
  const members = new Map(
    [...(options.members ?? membersByTypeFor(scope, model))].flatMap(([id, list]) => {
      if (!symbols.has(id)) return []
      const core = list.filter((member) => symbols.has(member.id))
      return core.length ? [[id, core] as const] : []
    }),
  )
  const category = (kind: string) => (OWNER_KINDS.has(kind) ? ('types' as const) : ('members' as const))
  const bucket = (b: TreeBucket): ApiTreeBucket => ({
    id: b.id,
    label: b.label,
    count: bucketTotal(b),
    slug: firstEntry(b)?.slug ?? null,
    types: b.entries.map((t) => ({
      id: t.id,
      name: t.name,
      symbolName: symbols.get(t.id)?.name ?? t.name,
      qualifiedName: symbols.get(t.id) ? qualifiedNameOf(symbols.get(t.id)!) : t.id,
      slug: t.slug,
      m: members.has(t.id) ? 1 : 0,
      kind: t.kind,
      category: category(t.kind),
      summary: symbols.get(t.id)?.doc?.summary ?? '',
    })),
    children: b.children.map(bucket),
  })
  const relationships = Object.fromEntries(
    model.symbols.flatMap((symbol) => {
      const edges = symbol.references?.filter((edge) => symbols.has(edge.target)) ?? []
      return symbols.has(symbol.id) && edges.length ? [[symbol.id, edges]] : []
    }),
  )
  return {
    port: scope,
    buckets: tree.map(bucket),
    ...(Object.keys(relationships).length ? { relationships } : {}),
    members: Object.fromEntries(
      [...members].map(([id, list]) => [
        id,
        list.map((m) => {
          const symbol = symbols.get(m.id)
          const kind = symbol?.kind ?? 'member'
          return [
            m.name,
            m.slug,
            m.id,
            kind,
            category(kind),
            symbol?.doc?.summary ?? '',
            symbol ? qualifiedNameOf(symbol) : m.id,
          ]
        }),
      ]),
    ),
  }
}
