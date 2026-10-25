import { apiTreeHref, searchApi, type ApiSearchResult, type ApiTreeBucket, type ApiTreeJson } from './api-search'

export const SIDEBAR_PRESENTATIONS = ['outline', 'focus', 'grouped'] as const
export type SidebarPresentation = typeof SIDEBAR_PRESENTATIONS[number]
export const SIDEBAR_PREFERENCE_KEY = 'libtmux:sidebar-presentation'

/** Kotlin quoting belongs in signatures; navigation shows the identifier itself. */
export const sidebarName = (name: string, port: string) => port === 'kotlin' ? name.replace(/`([^`]+)`/g, '$1') : name

export interface SidebarNode {
  id: string
  label: string
  kind?: string
  section?: string
  quiet?: boolean
  href?: string
  count?: number
  level: number
  current?: boolean
  shortcut?: boolean
  disabled?: boolean
  tab?: boolean
  expanded?: boolean
  lazy?: string
  children?: SidebarNode[]
}

/** Homogeneous protocol groups already name the kind; retain it for ARIA. */
export function quietSidebarKinds(nodes: SidebarNode[]) {
  if (new Set(nodes.map((node) => node.kind).filter(Boolean)).size <= 1) {
    for (const node of nodes) if (node.kind) node.quiet = true
  }
  for (const node of nodes) if (node.children) quietSidebarKinds(node.children)
}

/** What the C extractor calls a declaration that C never names: `anonymous enum`. */
const ANONYMOUS_DECLARATION = /^anonymous (?:enum|struct|union)$/

const inventories = new WeakMap<ApiTreeJson, ApiTreeJson>()

/**
 * The inventory the sidebar navigates: the reference's own, without anonymous
 * declarations or anything they hold. Nothing names them, so a row could only
 * repeat "anonymous enum" over a different member list. Search and the pages
 * themselves still reach them; only the sidebar leaves them out.
 */
export function sidebarInventory(json: ApiTreeJson): ApiTreeJson {
  const known = inventories.get(json)
  if (known) return known
  const hidden = new Set<string>()
  const hiddenSlugs = new Set<string>()
  const hide = (id: string, slug: string) => {
    hiddenSlugs.add(slug)
    if (hidden.has(id)) return
    hidden.add(id)
    for (const [name, slug, memberId] of json.members[id] ?? []) hide(memberId ?? `${id}.${name}`, slug)
  }
  const anonymous = (name: string, qualifiedName = '') => ANONYMOUS_DECLARATION.test(name) || ANONYMOUS_DECLARATION.test(qualifiedName)
  const find = (buckets: ApiTreeBucket[]) => {
    for (const bucket of buckets) {
      for (const entry of bucket.types) if (anonymous(entry.name, entry.qualifiedName)) hide(entry.id, entry.slug)
      find(bucket.children)
    }
  }
  find(json.buckets)
  for (const [owner, members] of Object.entries(json.members)) {
    for (const [name, slug, id, , , , qualifiedName] of members) if (anonymous(name, qualifiedName)) hide(id ?? `${owner}.${name}`, slug)
  }
  const strip = (buckets: ApiTreeBucket[]): ApiTreeBucket[] => buckets.map((bucket) => {
    const types = bucket.types.filter((entry) => !hidden.has(entry.id))
    const children = strip(bucket.children)
    return { ...bucket, types, children, count: types.length + children.reduce((sum, child) => sum + child.count, 0),
      slug: bucket.slug && hiddenSlugs.has(bucket.slug) ? types[0]?.slug ?? children.find((child) => child.slug)?.slug ?? null : bucket.slug }
  }).filter((bucket) => bucket.count > 0)
  const view: ApiTreeJson = hidden.size === 0 ? json : { ...json, buckets: strip(json.buckets), members: Object.fromEntries(
    Object.entries(json.members).filter(([owner]) => !hidden.has(owner))
      .map(([owner, members]) => [owner, members.filter(([name, , id]) => !hidden.has(id ?? `${owner}.${name}`))])) }
  inventories.set(json, view)
  inventories.set(view, view)
  return view
}

const catalogs = new WeakMap<ApiTreeJson, ReturnType<typeof createCatalog>>()

/**
 * Ownership is explicit: dots in a declaration name do not imply a parent.
 * Every page and every lazy branch asks for the same inventory's catalog, so
 * it is built once per inventory, as its filtered view is.
 */
export function sidebarCatalog(source: ApiTreeJson) {
  const json = sidebarInventory(source)
  const known = catalogs.get(json)
  if (known) return known
  const catalog = createCatalog(json)
  catalogs.set(json, catalog)
  return catalog
}

function createCatalog(json: ApiTreeJson) {
  const records = searchApi(json, '')
  const symbols = new Map(records.map((record) => [record.id, record]))
  const parent = new Map<string, string>()
  for (const [owner, members] of Object.entries(json.members)) {
    for (const [name, , id] of members) parent.set(id ?? `${owner}.${name}`, owner)
  }
  const owners = records.filter((record) => record.category === 'types' || record.category === 'pages')
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName, 'en'))
  const ownerOf = (id: string): ApiSearchResult | undefined => {
    const record = symbols.get(id)
    return record?.category === 'types' || record?.category === 'pages' ? record : symbols.get(parent.get(id) ?? '')
  }
  const membersOf = (id: string) => (json.members[id] ?? [])
    .map(([name, , memberId]) => symbols.get(memberId ?? `${id}.${name}`))
    .filter((record): record is ApiSearchResult => Boolean(record))
  const sections = owners.length > 0 && owners.every((record) => record.kind === 'section')
  return { records, symbols, parent, owners, ownerOf, membersOf,
    ownerLabel: json.ownerLabel ?? (sections ? 'section' : 'type'), ownerPlural: json.ownerPlural ?? (sections ? 'sections' : 'types') }
}

const groupName = (kind: string) => ({ property: 'Properties', method: 'Methods', class: 'Classes', object: 'Objects',
  constructor: 'Constructors', field: 'Fields', event: 'Events', function: 'Functions', interface: 'Interfaces',
  enum: 'Enums', 'enum-member': 'Enum members', typealias: 'Type aliases' }[kind] ?? `${kind[0]?.toUpperCase()}${kind.slice(1)}s`)

/** Curated buckets and declaration ownership share one projection for initial and lazy rows. */
export function sidebarNodes(source: ApiTreeJson, base: string, mode: SidebarPresentation, selected: string, allTypes = false,
  branch?: { lazy: string; level: number }): SidebarNode[] {
  const json = sidebarInventory(source)
  const catalog = sidebarCatalog(json)
  const ancestry = new Set<string>()
  for (let id: string | undefined = selected; id && !ancestry.has(id); id = catalog.parent.get(id)) ancestry.add(id)
  const buckets = new Map<string, ApiTreeBucket>()
  const placements = new Map<string, string[]>()
  const index = (list: ApiTreeBucket[], path: string[] = []) => {
    for (const bucket of list) {
      buckets.set(bucket.id, bucket)
      const here = [...path, bucket.id]
      for (const entry of bucket.types) if (!entry.shortcut) placements.set(entry.id, here)
      index(bucket.children, here)
    }
  }
  index(json.buckets)
  const currentBuckets = new Set([...ancestry].map((id) => placements.get(id)).find(Boolean) ?? [])
  let seq = 0
  const nextId = () => `api-presentation-${++seq}`
  const symbol = (record: ApiSearchResult, level: number, shortcut = false, expand = true): SidebarNode => {
    const members = catalog.membersOf(record.id)
    const open = expand && !shortcut && ancestry.has(record.id)
    return { id: nextId(), label: sidebarName(record.name, json.port), kind: record.kind, href: apiTreeHref(base, record, json.hrefs),
      level, current: !shortcut && record.id === selected, shortcut,
      ...(members.length && expand ? { count: members.length, lazy: `type:${record.id}`, expanded: open,
        ...(open ? { children: memberNodes(record.id, level + 1) } : {}) } : {}) }
  }
  const memberNodes = (owner: string, level: number): SidebarNode[] => {
    const members = catalog.membersOf(owner)
    if (mode !== 'grouped') return members.map((member) => symbol(member, level))
    const groups = new Map<string, ApiSearchResult[]>()
    for (const member of members) {
      const group = groups.get(member.kind) ?? []
      group.push(member)
      groups.set(member.kind, group)
    }
    return [...groups].sort(([a], [b]) => groupName(a).localeCompare(groupName(b), 'en')).map(([kind, records]) => ({
      id: nextId(), label: groupName(kind), count: records.length, level, expanded: true, lazy: `group:${owner}:${kind}`,
      children: records.toSorted((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'))
        .map((member) => symbol(member, level + 1)),
    }))
  }
  const rootName = (record: ApiSearchResult, peers: ApiSearchResult[]) => {
    if (record.name !== record.symbolName || peers.filter((other) => other.name === record.name).length < 2) return record.name
    const separator = record.qualifiedName.includes('::') ? '::' : '.'
    const parts = record.qualifiedName.split(separator)
    for (let length = 2; length <= parts.length; length++) {
      const name = parts.slice(-length).join(separator)
      if (peers.every((other) => other.id === record.id || other.qualifiedName.split(separator).slice(-length).join(separator) !== name)) return name
    }
    return record.symbolName
  }
  const bucketNodes = (bucket: ApiTreeBucket, level: number): SidebarNode[] => {
    const entries = bucket.types.flatMap((entry) => {
      const record = catalog.symbols.get(entry.id)
      return record ? [{ ...record, name: entry.name, shortcut: entry.shortcut }] : []
    })
    return [...entries.map((entry) => symbol({ ...entry, name: rootName(entry, entries) }, level, entry.shortcut)),
      ...bucket.children.map((child) => bucketNode(child, level))]
  }
  const bucketNode = (bucket: ApiTreeBucket, level: number): SidebarNode => ({
    id: nextId(), label: bucket.label, level, count: bucket.count, lazy: `bucket:${bucket.id}`,
    ...(bucket.slug ? { href: `${base}${bucket.slug}/` } : {}),
    expanded: currentBuckets.has(bucket.id),
    ...(currentBuckets.has(bucket.id) ? { children: bucketNodes(bucket, level + 1) } : {}),
  })
  if (branch) {
    if (branch.lazy.startsWith('bucket:')) {
      const bucket = buckets.get(branch.lazy.slice(7))
      return bucket ? bucketNodes(bucket, branch.level) : []
    }
    if (branch.lazy.startsWith('type:')) return memberNodes(branch.lazy.slice(5), branch.level)
    return []
  }
  if (allTypes) return catalog.owners.map((record) => ({ ...symbol({ ...record, name: record.qualifiedName }, 1, false, false), count: catalog.membersOf(record.id).length }))
  if (mode === 'focus' && catalog.symbols.has(selected)) {
    const owner = catalog.ownerOf(selected)
    if (!owner) return [symbol(catalog.symbols.get(selected)!, 1)]
    const members = catalog.membersOf(owner.id)
    return [{ ...symbol(owner, 1, false, false), count: members.length }, ...members.map((member) => symbol(member, 1))]
  }
  // Manuals and protocol catalogs already have section owners; avoid wrapping them in a second section row.
  if (json.buckets.length === 1 && !json.buckets[0]!.children.length && json.buckets[0]!.types.every((entry) => entry.kind === 'section')) {
    return bucketNodes(json.buckets[0]!, 1)
  }
  return json.buckets.map((bucket) => bucketNode(bucket, 1))
}
