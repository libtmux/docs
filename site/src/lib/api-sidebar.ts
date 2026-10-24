import { apiTreeHref, searchApi, type ApiSearchResult, type ApiTreeJson } from './api-search'

export const SIDEBAR_PRESENTATIONS = ['outline', 'focus', 'grouped'] as const
export type SidebarPresentation = typeof SIDEBAR_PRESENTATIONS[number]

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

/** Ownership is explicit: dots in a declaration name do not imply a parent. */
export function sidebarCatalog(json: ApiTreeJson) {
  const records = searchApi(json, '')
  const symbols = new Map(records.map((record) => [record.id, record]))
  const parent = new Map<string, string>()
  for (const [owner, members] of Object.entries(json.members)) {
    for (const [name, , id] of members) parent.set(id ?? `${owner}.${name}`, owner)
  }
  const owners = records.filter((record) => record.category === 'types')
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName, 'en'))
  const ownerOf = (id: string): ApiSearchResult | undefined => {
    const record = symbols.get(id)
    return record?.category === 'types' ? record : symbols.get(parent.get(id) ?? '')
  }
  const membersOf = (id: string) => (json.members[id] ?? [])
    .map(([name, , memberId]) => symbols.get(memberId ?? `${id}.${name}`))
    .filter((record): record is ApiSearchResult => Boolean(record))
  return { records, symbols, parent, owners, ownerOf, membersOf }
}

const groupName = (kind: string) => ({ property: 'Properties', method: 'Methods', class: 'Classes', object: 'Objects',
  constructor: 'Constructors', field: 'Fields', event: 'Events', function: 'Functions', interface: 'Interfaces',
  enum: 'Enums', 'enum-member': 'Enum members', typealias: 'Type aliases' }[kind] ?? `${kind[0]?.toUpperCase()}${kind.slice(1)}s`)

/** A projection of the same inventory used by ordinary reference navigation. */
export function sidebarNodes(json: ApiTreeJson, base: string, mode: SidebarPresentation, selected: string, allTypes = false): SidebarNode[] {
  const catalog = sidebarCatalog(json)
  const ancestry = new Set<string>()
  for (let id: string | undefined = selected; id && !ancestry.has(id); id = catalog.parent.get(id)) ancestry.add(id)
  let seq = 0
  const nextId = () => `api-presentation-${++seq}`
  const symbol = (record: ApiSearchResult, level: number, shortcut = false, expand = true): SidebarNode => {
    const members = catalog.membersOf(record.id)
    const open = expand && ancestry.has(record.id)
    return { id: nextId(), label: sidebarName(record.name, json.port), kind: record.kind, href: apiTreeHref(base, record, json.hrefs),
      level, current: !shortcut && record.id === selected, shortcut,
      ...(members.length && expand ? { count: members.length, lazy: `type:${record.id}`, expanded: open,
        ...(open ? { children: members.map((member) => symbol(member, level + 1)) } : {}) } : {}) }
  }
  if (allTypes) return catalog.owners.map((record) => ({ ...symbol({ ...record, name: record.qualifiedName }, 1, false, false), count: catalog.membersOf(record.id).length }))
  if (mode === 'outline') {
    const roots = catalog.records.filter((record) => !catalog.parent.has(record.id))
    const rootName = (record: ApiSearchResult) => {
      const peers = roots.filter((other) => other.symbolName === record.symbolName)
      if (peers.length < 2) return record.symbolName
      const parts = record.qualifiedName.split('.')
      for (let length = 2; length <= parts.length; length++) {
        const name = parts.slice(-length).join('.')
        if (peers.every((other) => other.id === record.id || other.qualifiedName.split('.').slice(-length).join('.') !== name)) return name
      }
      return record.id
    }
    const core = ['Server', 'Session', 'Window', 'Pane', 'Client']
      .flatMap((name) => roots.filter((record) => record.symbolName === name))
    const support = roots.filter((record) => !core.includes(record) && record.category === 'types')
    const other = roots.filter((record) => !core.includes(record) && record.category !== 'types')
    const section = (label: string, records: ApiSearchResult[], unit = 'types'): SidebarNode[] => records.length ? [
      { id: nextId(), label, section: unit, count: records.length, level: 1 },
      ...records.map((record) => symbol({ ...record, name: rootName(record) }, 1)),
    ] : []
    return [...section('Core objects', core), ...section('Supporting types', support),
      ...section(other.every((record) => record.kind === 'function') ? 'Functions' : 'Other declarations', other, 'declarations')]
  }
  const owner = catalog.ownerOf(selected)
  if (!owner) {
    const record = catalog.symbols.get(selected)
    return record ? [symbol(record, 1)] : []
  }
  const members = catalog.membersOf(owner.id)
  const head = symbol(owner, 1, false, false)
  head.count = members.length
  if (mode === 'focus') return [head, ...members.map((member) => symbol(member, 1))]
  const groups = new Map<string, ApiSearchResult[]>()
  for (const member of members) {
    const group = groups.get(member.kind) ?? []
    group.push(member)
    groups.set(member.kind, group)
  }
  return [head, ...[...groups].sort(([a], [b]) => groupName(a).localeCompare(groupName(b), 'en')).map(([kind, records]) => ({
    id: nextId(), label: groupName(kind), count: records.length, level: 1, expanded: true, lazy: `group:${owner.id}:${kind}`,
    children: records.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en')).map((member) => symbol(member, 2)),
  }))]
}
