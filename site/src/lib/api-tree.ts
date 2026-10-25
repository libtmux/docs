/**
 * The API reference's navigation tree, shared by the page that renders its
 * own branch and the JSON the other branches load when a reader opens them.
 *
 * Buckets and their contents are decided once per port in
 * `scripts/gen-api-model.mjs`; this only shapes them for a tree.
 */
import { membersOf, memberSignals, symbolsForProduct, type ApiModel, type ApiModelBase, type ApiSymbol } from '@libtmux/api-model'
import mentions from '../data/mentions.json'
import { API_MODELS, API_NAV, OWNER_KINDS, isMemberOwner, pageSlug, referenceHref, topLevelTypesOf, type NavEntry, type PortNavData, type NavBucket } from './api-models'
import type { ApiTreeBucket, ApiTreeJson } from './api-search'
import { createHash } from 'node:crypto'
import { PORT_BY_SLUG, type ApiDependencyNavigation } from './ports'
import type { BreadcrumbItem } from './sidebar'
import { nativeQualifiedName, nativeShortName } from './native-name'

export interface TreeBucket {
  id: string
  label: string
  collapsed: boolean
  entries: NavEntry[]
  children: TreeBucket[]
  /** Retain a native category destination when adding dependency types. */
  target?: NavEntry
}

export interface TreeMember {
  id: string
  name: string
  slug: string
}

const treeVersions = new WeakMap<ApiModelBase, string>()
/** Invalidate saved rows when their schema, declarations, ordering or dependency URLs change. */
export function apiTreeVersion(model: ApiModelBase, tree: TreeBucket[], hrefs?: Record<string, string>): string {
  let version = treeVersions.get(model)
  if (!version) {
    version = `2:${createHash('sha256').update(JSON.stringify([model, tree, hrefs, mentions])).digest('hex').slice(0, 20)}`
    treeVersions.set(model, version)
  }
  return version
}

export interface NavTreeOptions {
  /** Library-specific labels and member semantics, when applicable. */
  scope?: string
  excludeProducts?: boolean
  primaryObjectsFirst?: boolean
}

/** Use a declaration's curated bucket before falling back to its nearest owner. */
export function bucketForSymbol(model: ApiModelBase | undefined, nav: PortNavData | undefined, symbol: ApiSymbol | undefined): string | undefined {
  const seen = new Set<string>()
  while (symbol && !seen.has(symbol.id)) {
    seen.add(symbol.id)
    const bucket = nav?.placement[symbol.publicId ?? symbol.id]
    if (bucket !== undefined) return bucket
    const parent = symbol.parent
    symbol = parent ? model?.symbols.find((candidate) => candidate.id === parent) : undefined
  }
  return undefined
}

/** The same category ancestry opens the sidebar and names the page's location. */
export function bucketAncestors(tree: TreeBucket[], id: string | undefined): TreeBucket[] {
  if (id === undefined) return []
  for (const bucket of tree) {
    if (bucket.id === id) return [bucket]
    const children = bucketAncestors(bucket.children, id)
    if (children.length) return [bucket, ...children]
  }
  return []
}

/** Canonical sidebar categories and declaration owners, without shortcut duplicates. */
export function referenceBreadcrumbs(
  model: ApiModelBase, nav: PortNavData, tree: TreeBucket[], symbol: ApiSymbol,
  base: string, hrefFor: (symbol: ApiSymbol) => string,
): BreadcrumbItem[] {
  const buckets = bucketAncestors(tree, bucketForSymbol(model, nav, symbol))
  const anchors = new Set(referenceIndexSectionsFor(model, tree).map((entry) => entry.id))
  const crumbs: BreadcrumbItem[] = buckets.map((bucket) => ({ name: bucket.label,
    ...(anchors.has(bucket.id) ? { url: `${base}#section-${encodeURIComponent(bucket.id)}` } : {}),
  }))
  const entries = buckets.at(-1)?.entries.filter((entry) => !entry.shortcut) ?? []
  const lineage: ApiSymbol[] = []
  const seen = new Set<string>()
  let current: ApiSymbol | undefined = symbol
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    lineage.unshift(current)
    if (entries.some((entry) => entry.id === (current!.publicId ?? current!.id))) break
    current = current.parent ? model.symbols.find((entry) => entry.id === current!.parent) : undefined
  }
  const root = entries.find((entry) => entry.id === (lineage[0]?.publicId ?? lineage[0]?.id))
  // An explicitly placed member can be a root even when its module is elsewhere.
  if (!root) lineage.splice(0, Math.max(0, lineage.length - 1))
  return [...crumbs, ...lineage.map((entry, i) => ({ name: i === 0 && root ? root.name : entry.name,
    url: hrefFor(entry), symbol: true,
  }))]
}

const productSymbols = (model: ApiModelBase) =>
  [...symbolsForProduct(model, 'mcp'), ...symbolsForProduct(model, 'workspace')]

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
    const label = scope === 'scala'
      ? `${entry.name} (${entry.id.includes('.cats.') ? 'Cats Effect' : entry.id.includes('.ox.') ? 'Ox' : 'Direct API'})`
      : model.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === entry.id)?.qualifiedName ?? entry.id
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
  const products = new Set(options.excludeProducts
    ? productSymbols(model).map((s) => s.publicId ?? s.id)
    : [])
  const core = (entries: NavEntry[]) => entries.filter((e) => !products.has(e.id))
  const displayEntries = (bucket: { id: string; label: string }, entries: NavEntry[]) => {
    const distinctEntries = distinct(core(entries), model, options.scope ?? '')
    return options.primaryObjectsFirst ? primaryObjectFirst(bucket, distinctEntries) : distinctEntries
  }
  const bucket = (b: NavBucket): TreeBucket => ({
    id: b.id,
    label: b.label,
    collapsed: b.collapsed,
    ...(b.target ? { target: b.target } : {}),
    entries: displayEntries(b, [
      ...(b.shortcuts ?? []).map((entry) => ({ ...entry, shortcut: true })),
      ...(nav.assignments[b.id] ?? []),
    ]),
    children: (b.children ?? []).map(bucket).filter((child) => child.entries.length > 0 || child.children.length > 0),
  })
  return [
    ...nav.buckets.map(bucket)
      .filter((b) => b.entries.length > 0 || b.children.length > 0),
    ...(nav.unplaced.length > 0
      ? [{ id: '__unplaced', label: 'Other', collapsed: true, entries: displayEntries({ id: '__unplaced', label: 'Other' }, nav.unplaced), children: [] }]
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
  const modules = new Set(model.symbols.filter((symbol) => symbol.kind === 'module').map((symbol) => symbol.id))
  const symbols = new Map(model.symbols.filter((symbol) => !symbol.parent || modules.has(symbol.parent))
    .map((symbol) => [symbol.publicId ?? symbol.id, symbol]))
  const section = (bucket: TreeBucket, name: string, collapsed: boolean) => {
    const entries = bucket.entries.filter((entry) => !entry.shortcut).map((entry) => symbols.get(entry.id))
      .filter((symbol): symbol is NonNullable<typeof symbol> => symbol !== undefined)
    return {
      id: bucket.id, name, collapsed,
      types: entries.filter((symbol) => cards.has(symbol.id)),
      free: entries.filter((symbol) => !cards.has(symbol.id)),
    }
  }
  const sections = (bucket: TreeBucket, label: string, collapsed: boolean): ReturnType<typeof section>[] => [
    section(bucket, label, collapsed),
    ...bucket.children.flatMap((child) => sections(child, `${label} — ${child.label}`, collapsed || child.collapsed)),
  ]
  return tree.flatMap((bucket) => sections(bucket, bucket.label, bucket.collapsed))
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
export const bucketTarget = <T extends { name: string; slug: string }>(label: string, entries: T[]) =>
  entries.find((e) => e.name.split(/[.:/]+/).pop()?.toLowerCase() === label.toLowerCase()) ?? entries[0]

/**
 * The entry a bucket's link lands on: a type, from the bucket itself or else
 * its first child that holds one, and a function or constant only where no
 * type is under it. TypeScript's Workspaces holds two type aliases of its own
 * beside Plan's types, and still opens on `PanePlans`.
 */
export const firstEntry = (b: TreeBucket) => {
  if (b.target) return b.target
  const lists = (bucket: TreeBucket): NavEntry[][] => [bucket.entries, ...bucket.children.flatMap(lists)]
  const entries = lists(b)
  const types = entries.map((list) => list.filter((entry) => OWNER_KINDS.has(entry.kind))).find((list) => list.length > 0)
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
  for (const owner of model.symbols.filter(isMemberOwner)) {
    const members = membersOf(model, owner, signals)
    if (members.length) out.set(owner.publicId ?? owner.id, members.map((symbol) => ({
      id: symbol.id, name: symbol.name, slug: symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id),
    })))
  }
  return out
}

export interface ReferenceTreeOptions {
  excludeProducts?: boolean
  members?: Map<string, TreeMember[]>
  hrefs?: Record<string, string>
}

export interface ReferenceNavigation {
  model: ApiModel
  tree: TreeBucket[]
  members: Map<string, TreeMember[]>
  hrefs: Record<string, string>
}

/** Reject dependency navigation when its reviewed package or source changes. */
export function validateNavigationDependency(consumer: ApiModel, dependency: ApiModel, selection: ApiDependencyNavigation): void {
  const declaration = consumer.nativeProvenance?.files.find((file) => file.path === selection.declaration.path)
  const source = dependency.sources?.find((entry) => entry.product === 'core' && entry.package === selection.package)
  if (declaration?.sha256 !== selection.declaration.sha256) {
    throw new Error(`${consumer.port} navigation: review the changed ${selection.declaration.path} dependency declaration`)
  }
  if (dependency.port !== selection.port || source?.version !== selection.version ||
    dependency.revision !== selection.revision || (source?.extractedRevision ?? source?.revision) !== selection.revision) {
    throw new Error(`${consumer.port} navigation requires ${selection.package} ${selection.version} from ${selection.revision}`)
  }
}

/** Compose navigation without adding dependency declarations to a port's API model. */
export function referenceNavigation(port: string): ReferenceNavigation | undefined {
  const model = API_MODELS[port]
  if (!model) return undefined
  const tree = navTree(port)
  const members = new Map(membersByType(port))
  const hrefs: Record<string, string> = {}
  const metadata = PORT_BY_SLUG[port]
  if (!metadata?.apiDependencyNavigation?.length) return { model, tree, members, hrefs }
  const symbols = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
  const buckets = new Map<string, TreeBucket>()
  const visit = (entries: TreeBucket[]) => {
    for (const bucket of entries) { buckets.set(bucket.id, bucket); visit(bucket.children) }
  }
  visit(tree)
  for (const selection of metadata?.apiDependencyNavigation ?? []) {
    const dependency = API_MODELS[selection.port]
    if (!dependency || !metadata.apiDependencies?.includes(selection.port)) {
      throw new Error(`${port} navigation has no declared ${selection.port} API dependency`)
    }
    validateNavigationDependency(model, dependency, selection)
    const signals = memberSignals(selection.port, mentions.mentions)
    const add = (symbol: ApiSymbol) => {
      if (symbols.has(symbol.id)) throw new Error(`${port} navigation repeats dependency symbol ${symbol.id}`)
      const id = symbol.publicId ?? symbol.id
      const href = referenceHref(selection.port, id)
      if (!href) throw new Error(`${port} navigation has no canonical page for ${id}`)
      symbols.set(symbol.id, symbol)
      hrefs[symbol.id] = href
      hrefs[id] = href
      if (isMemberOwner(symbol)) {
        const children = membersOf(dependency, symbol, signals)
        if (children.length) {
          members.set(id, children.map((child) => ({ id: child.id, name: child.name, slug: child.slug ?? pageSlug(child.publicId ?? child.id) })))
          for (const child of children) add(child)
        }
      }
    }
    for (const [bucketId, ids] of Object.entries(selection.sections)) {
      const bucket = buckets.get(bucketId)
      if (!bucket) throw new Error(`${port} navigation has no ${bucketId} category for dependency types`)
      bucket.target ??= firstEntry(bucket)
      const entries = ids.map((id) => {
        const owner = dependency.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === id)
        if (!owner || !OWNER_KINDS.has(owner.kind) || (owner.product ?? 'core') !== 'core') {
          throw new Error(`${port} navigation has no public dependency type ${id}`)
        }
        add(owner)
        return { id, name: `${owner.name} (${selection.label})`, kind: owner.kind, slug: owner.slug ?? pageSlug(id) }
      })
      bucket.entries = [...entries, ...bucket.entries]
    }
  }
  return { model: { ...model, symbols: [...symbols.values()] }, tree, members, hrefs }
}

/** The port-scoped inventory served to lazy branches and symbol search. */
export function referenceTree(port: string): ApiTreeJson {
  const navigation = referenceNavigation(port)
  if (!navigation) return { port, buckets: [], members: {} }
  return referenceTreeFor(port, navigation.model, navigation.tree, { excludeProducts: true, members: navigation.members, hrefs: navigation.hrefs })
}

/** Protocol and command catalogs use their published sections as owners. */
export function referenceSectionTree(json: ApiTreeJson): ApiTreeJson {
  const hrefs = { ...json.hrefs }
  const members = { ...json.members }
  const section = (bucket: ApiTreeBucket, parentPath?: string): ApiTreeBucket['types'][number] => {
    const id = `section:${bucket.id}`
    const path = parentPath ?? bucket.slug ?? ''
    hrefs[id] = parentPath ? `${path}/#${bucket.id}` : `${path}/`
    const children = [...bucket.types, ...bucket.children.map((child) => section(child, path))]
    members[id] = children.map((child) => [child.name, child.slug, child.id, child.kind, child.category, child.summary, child.qualifiedName, child.shortName])
    return { id, name: bucket.label, slug: path, kind: 'section', category: 'types', m: children.length ? 1 : 0 }
  }
  const types = json.buckets.map((bucket) => section(bucket))
  return { ...json, buckets: [{ id: 'sections', label: 'Sections', count: types.length, slug: null, types, children: [] }], members, hrefs }
}

/** Serialize the same tree consumed by initial HTML, without registry lookups. */
export function referenceTreeFor(scope: string, model: ApiModelBase, tree: TreeBucket[], options: ReferenceTreeOptions = {}): ApiTreeJson {
  const naming = { port: scope.split(':')[0], symbols: model.symbols }
  const products = new Set(options.excludeProducts ? productSymbols(model).map((symbol) => symbol.id) : [])
  const symbols = new Map(model.symbols.filter((symbol) => !products.has(symbol.id)).flatMap((symbol) =>
    [[symbol.id, symbol], [symbol.publicId ?? symbol.id, symbol]] as const))
  // The shared cache includes product declarations; scope only this core inventory.
  const members = new Map([...(options.members ?? membersByTypeFor(scope, model))].flatMap(([id, list]) => {
    if (!symbols.has(id)) return []
    const core = list.filter((member) => symbols.has(member.id))
    return core.length ? [[id, core] as const] : []
  }))
  const category = (kind: string) => OWNER_KINDS.has(kind) ? 'types' as const : 'members' as const
  const bucket = (b: TreeBucket): ApiTreeBucket => ({
    id: b.id,
    label: b.label,
    count: bucketTotal(b),
    slug: firstEntry(b)?.slug ?? null,
    types: b.entries.map((t) => ({ id: t.id, name: t.name, symbolName: symbols.get(t.id)?.name ?? t.name,
      qualifiedName: symbols.get(t.id) ? nativeQualifiedName(naming, symbols.get(t.id)!) : t.id,
      shortName: symbols.get(t.id) ? nativeShortName(naming, symbols.get(t.id)!) : t.name,
      slug: t.slug, m: members.has(t.id) ? 1 : 0,
      ...(t.shortcut ? { shortcut: true } : {}),
      kind: t.kind, category: category(t.kind), summary: symbols.get(t.id)?.doc?.summary ?? '' })),
    children: b.children.map(bucket),
  })
  const relationships = Object.fromEntries(model.symbols.flatMap((symbol) => {
    const edges = symbol.references?.filter((edge) => symbols.has(edge.target)) ?? []
    return symbols.has(symbol.id) && edges.length ? [[symbol.id, edges]] : []
  }))
  return {
    port: scope,
    buckets: tree.map(bucket),
    ...(Object.keys(options.hrefs ?? {}).length ? { hrefs: options.hrefs } : {}),
    ...(Object.keys(relationships).length ? { relationships } : {}),
    members: Object.fromEntries([...members].map(([id, list]) => [id, list.map((m) => {
      const symbol = symbols.get(m.id)
      const kind = symbol?.kind ?? 'member'
      return [m.name, m.slug, m.id, kind, category(kind), symbol?.doc?.summary ?? '',
        symbol ? nativeQualifiedName(naming, symbol) : m.id, symbol ? nativeShortName(naming, symbol) : m.name]
    })])),
  }
}
