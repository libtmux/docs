/**
 * The API reference as a hierarchy: group (a navigation bucket), type, member.
 *
 * It reads the port's tree inventory, the same JSON that feeds the sidebar
 * tree, so both views list the same declarations in the same order. Nothing is
 * invented: a bucket nests as the tree nests it, a type lists the members the
 * tree lists, and a type with no members is a leaf.
 */
import { apiTreeHref, type ApiTreeBucket, type ApiTreeEntry, type ApiTreeJson } from '../api-search'
import type { ColumnNode, ColumnSource } from './types'

export interface ApiSource extends ColumnSource {
  readonly port: string
  /** The declaration whose page lives at `href` (a path, with or without the origin), if any. */
  nodeForHref(href: string): ColumnNode | undefined
}

export interface ApiSourceOptions {
  /** The reference's root path, ending in a slash. */
  base: string
  /** The port's display name: `Go`. */
  portName?: string
}

export const apiRootId = (port: string) => `s:${port}:core:api`

/** A doc summary as plain text: link brackets, `{@link}` tags and backticks dropped. */
export function plainSummary(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/\{@(?:link|linkplain|code|literal)\s+([^}]*)\}/g, (_, body: string) => body.trim().split(/\s+/).pop() ?? '')
    .replace(/\[`?([^\]`]+)`?\](?:\([^)]*\))?/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

type MemberTuple = ApiTreeJson['members'][string][number]

export function apiSource(json: ApiTreeJson, options: ApiSourceOptions): ApiSource {
  const { base } = options
  const root = apiRootId(json.port)
  const nodes = new Map<string, ColumnNode>()
  const kids = new Map<string, ColumnNode[]>()
  const byHref = new Map<string, ColumnNode>()
  const aliases = new Map<string, string>()

  const add = (node: ColumnNode, children: ColumnNode[]) => {
    nodes.set(node.id, node)
    kids.set(node.id, children)
    if (node.href && !byHref.has(node.href)) byHref.set(node.href, node)
  }

  const memberNodes = (ownerId: string, parent: string, seen: Set<string>): ColumnNode[] => {
    const out: ColumnNode[] = []
    for (const tuple of json.members[ownerId] ?? []) {
      const [name, slug, id = `${ownerId}.${name}`, kind = 'member', , summary = '', qualifiedName = id, shortName = name] = tuple as MemberTuple
      const nodeId = `sym:${id}`
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      const children = memberNodes(id, nodeId, seen)
      const node: ColumnNode = {
        id: nodeId, label: name, kind, parent, leaf: children.length === 0, count: children.length || undefined,
        href: apiTreeHref(base, { id, slug }, json.hrefs), summary: plainSummary(summary), data: { symbol: id, qualifiedName, shortName, member: true },
      }
      add(node, children)
      out.push(node)
    }
    return out
  }

  const entryNode = (entry: ApiTreeEntry, parent: string, seen: Set<string>): ColumnNode | undefined => {
    const nodeId = `sym:${entry.id}`
    if (entry.shortcut || seen.has(nodeId)) return undefined
    seen.add(nodeId)
    const children = memberNodes(entry.id, nodeId, seen)
    const node: ColumnNode = {
      id: nodeId, label: entry.name, kind: entry.kind ?? 'symbol', parent, leaf: children.length === 0, count: children.length || undefined,
      href: apiTreeHref(base, entry, json.hrefs), summary: plainSummary(entry.summary),
      data: { symbol: entry.id, qualifiedName: entry.qualifiedName ?? entry.id, shortName: entry.shortName ?? entry.name },
    }
    add(node, children)
    return node
  }

  const bucketNode = (bucket: ApiTreeBucket, parent: string, seen: Set<string>): ColumnNode => {
    const id = `b:${bucket.id}`
    aliases.set(`b:${bucket.label.toLowerCase()}`, id)
    // The node exists before its children so they can name it as their parent.
    const children: ColumnNode[] = []
    const node: ColumnNode = {
      id, label: bucket.label, kind: 'group', parent, leaf: false, count: bucket.count || undefined,
      href: `${base}#section-${encodeURIComponent(bucket.id)}`, data: { bucket: bucket.id },
    }
    add(node, children)
    for (const entry of bucket.types) { const child = entryNode(entry, id, seen); if (child) children.push(child) }
    for (const child of bucket.children) children.push(bucketNode(child, id, seen))
    node.leaf = children.length === 0
    return node
  }

  const seen = new Set<string>()
  const groups: ColumnNode[] = []
  const rootNode: ColumnNode = {
    id: root, label: 'API reference', kind: 'root', leaf: false, href: base,
    data: { title: `${options.portName ?? json.port} API reference` },
  }
  add(rootNode, groups)
  for (const bucket of json.buckets) groups.push(bucketNode(bucket, root, seen))
  rootNode.count = groups.length || undefined
  rootNode.leaf = groups.length === 0

  const hrefKey = (href: string) => {
    const path = href.replace(/^[a-z]+:\/\/[^/]+/i, '').split('#')[0]!.split('?')[0]!
    return path.endsWith('/') ? path : `${path}/`
  }
  const pathIndex = new Map<string, ColumnNode>()
  for (const node of nodes.values()) {
    if (node.id.startsWith('sym:') && node.href) pathIndex.set(hrefKey(node.href), node)
  }
  pathIndex.set(hrefKey(base), rootNode)

  return {
    root,
    port: json.port,
    find: (id) => nodes.get(id) ?? nodes.get(aliases.get(id.toLowerCase()) ?? ''),
    children: (node) => kids.get(node.id) ?? [],
    nodeForHref: (href) => pathIndex.get(hrefKey(href)),
  }
}
