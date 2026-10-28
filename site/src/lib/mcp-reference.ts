import { MCP_REFERENCE, MCP_SECTIONS, mcpObjects, resolveMcpObject, type McpRegistration, type McpObject, type McpSection } from './mcp-catalog'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { docSummaryText } from '@libtmux/api-model'
import { PORT_BY_SLUG, portPageUrl } from './ports'
import { restToMarkdown } from './mcp-rest'
import { rehypeApiLinks } from '../plugins/rehype-api-links'
import { createHash } from 'node:crypto'
import type { TreeBucket } from './api-tree'
import type { ApiTreeJson } from './api-search'
import { referenceSectionTree } from './api-tree'
import { mentionBadge } from './mention-badge'
import { mentionBadgeHast } from './mention-badge-hast'

export * from './mcp-catalog'

/** Resources match by advertised URI, never by a coincidental display name. */
export function equivalentMcpObject(sourcePort: string, object: McpObject, targetPort: string): McpObject | undefined {
  if (object.kind === 'tool') {
    const tool = equivalentMcpTool(sourcePort, object.name, targetPort)
    return tool && mcpObjects(targetPort).find((entry) => entry.tool === tool)
  }
  return mcpObjects(targetPort).find((entry) => entry.id === object.id)
}

const TOOL_GROUPS = [
  ['Server', /(?:server|^list_sessions$|^create_session$|^tmux_capabilities$|^tmux_snapshot$)/],
  ['Session', /(?:session|^list_windows$|^create_window$)/],
  ['Window', /(?:window|layout|^list_panes$)/],
  ['Pane', /(?:pane|capture|snapshot|keys|paste_text|run_(?:shell_)?command|^tmux_(?:capture|wait|create|send|close|run)$)/],
  ['Buffers', /buffer/], ['Hooks', /hook/], ['Options and environment', /option|environment|history_limit|mouse|synchronize/],
  ['Coordination', /channel/],
] as const
export function mcpObjectGroup(object: McpObject): string {
  if (object.kind === 'prompt') return 'Workflows'
  if (object.kind === 'resource') return 'Fixed resources'
  if (object.kind === 'resource-template') return 'Resource templates'
  return TOOL_GROUPS.find(([, pattern]) => pattern.test(object.name))?.[0] ?? 'Other tools'
}

/** The existing API tree, lazy loading and search consume this same catalog. */
export function mcpNavigation(port: string): { tree: TreeBucket[]; json: ApiTreeJson; version: string } {
  const entries = mcpObjects(port)
  const tree: TreeBucket[] = Object.entries(MCP_SECTIONS).map(([section, label]) => {
    const selected = entries.filter((entry) => entry.section === section)
    const order: string[] = [...TOOL_GROUPS.map(([name]) => name), 'Other tools', 'Workflows', 'Fixed resources', 'Resource templates']
    const groups = [...new Set(selected.map(mcpObjectGroup))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    return { id: section, label, collapsed: false, entries: [],
      target: { id: `mcp.${section}`, name: label, slug: section, kind: 'mcp-section' },
      children: groups.map((group) => ({ id: `${section}-${group.toLowerCase().replaceAll(' ', '-')}`, label: group,
        collapsed: false, children: [], entries: selected.filter((entry) => mcpObjectGroup(entry) === group)
          .map((entry) => ({ id: entry.id, name: entry.name, slug: entry.path.slice(4), kind: entry.kind })) })) }
  })
  const bucket = (entry: TreeBucket): ApiTreeJson['buckets'][number] => ({
    id: entry.id, label: entry.label, count: entry.entries.length + entry.children.reduce((n, child) => n + child.entries.length, 0),
    slug: entry.target?.slug ?? entry.entries[0]?.slug ?? null,
    types: entry.entries.map((row) => {
      const object = entries.find((entry) => entry.id === row.id)!
      return { ...row, m: 0, category: object.section, summary: plainSummary(object.description, port) }
    }), children: entry.children.map(bucket),
  })
  const json = referenceSectionTree({ port, buckets: tree.map(bucket), members: {} })
  const version = `mcp-1:${createHash('sha256').update(JSON.stringify([MCP_REFERENCE[port], json])).digest('hex').slice(0, 20)}`
  return { tree, json, version }
}

// These registrations perform the same operation with different argument/result shapes.
// Scrollback-only clearing must remain distinct from clearing the visible pane.
const TOOL_OPERATIONS: Record<string, Record<string, string>> = {
  py: { run_command: 'run_shell_command' },
}

/** Resolve an equivalent operation to the target port's actual wire registration. */
export function equivalentMcpTool(sourcePort: string, wireName: string, targetPort: string): McpRegistration | undefined {
  const source = MCP_REFERENCE[sourcePort]?.registrations.find((tool) => tool.wireName === wireName)
  if (!source) return undefined
  const operation = TOOL_OPERATIONS[sourcePort]?.[source.name] ?? source.name
  return MCP_REFERENCE[targetPort]?.registrations.find((tool) => (TOOL_OPERATIONS[targetPort]?.[tool.name] ?? tool.name) === operation)
}

/** Shared route identity for rendered tools and downloadable protocol data. */
export function mcpReferenceRoutes(buildPort: string | undefined, defaults: Record<string, string>, buildVersion: string) {
  return Object.entries(MCP_REFERENCE).filter(([port]) => !buildPort || port === buildPort)
    .flatMap(([port]) => (Object.keys(MCP_SECTIONS) as McpSection[]).flatMap((section) => [undefined, ...mcpObjects(port).filter((entry) => entry.section === section)].map((object) => {
      const version = buildPort ? buildVersion : (defaults[port] ?? 'latest')
      return { path: `${buildPort ? '' : `${port}/${version}/`}${object?.path ?? `mcp/${section}`}`,
        port, section, itemSlug: object?.slug, toolName: object?.tool?.wireName, version }
    })))
}

let markdown: ReturnType<typeof createMarkdownProcessor> | undefined

export interface ToolDescriptionContext { port: string; version: string; toolName?: string; objectId?: string }
interface HtmlNode { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HtmlNode[] }

function rehypeMcpToolLinks() {
  return (tree: unknown, file: { data: { astro?: { frontmatter?: { mcp?: ToolDescriptionContext } } } }) => {
    const context = file.data.astro?.frontmatter?.mcp
    if (!context || !PORT_BY_SLUG[context.port]) return
    const target = (name: string) => {
      const object = resolveMcpObject(context.port, name)
      return object && object.id !== context.objectId && !(object.kind === 'tool' && object.name === context.toolName) ? object : undefined
    }
    const link = (object: McpObject, node: HtmlNode): HtmlNode => ({
      type: 'element', tagName: 'a',
      properties: { href: portPageUrl(PORT_BY_SLUG[context.port], context.version, object.path) },
      children: [mentionBadgeHast(mentionBadge(object.kind, object.kind)!) as HtmlNode,
      { type: 'element', tagName: 'span', properties: { className: ['api-symbol-link__name'] }, children: [node] }],
    })
    const walk = (node: HtmlNode) => {
      if (!node.children || ['a', 'pre', 'script', 'style'].includes(node.tagName ?? '')) return
      node.children = node.children.flatMap((child): HtmlNode[] => {
        if (child.tagName === 'code') {
          const name = child.children?.map((part) => part.value ?? '').join('') ?? ''
          const object = target(name)
          return [object ? link(object, child) : child]
        }
        if (child.type !== 'text') {
          walk(child)
          return [child]
        }
        const text = child.value ?? ''
        const parts: HtmlNode[] = []
        let start = 0
        for (const match of text.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)) {
          const object = target(match[0])
          if (!object) continue
          parts.push({ type: 'text', value: text.slice(start, match.index) }, link(object, { type: 'text', value: match[0] }))
          start = match.index + match[0].length
        }
        return [...parts, { type: 'text', value: text.slice(start) }]
      })
    }
    walk(tree as HtmlNode)
  }
}

/**
 * A route to this object's own page needs no link on that page.
 *
 * The shared mention linker has no notion of a current object, so its links
 * to the page being rendered are unwrapped here.
 */
function rehypeMcpSelfLinks() {
  return (tree: unknown, file: { data: { astro?: { frontmatter?: { mcp?: ToolDescriptionContext } } } }) => {
    const context = file.data.astro?.frontmatter?.mcp
    const own = context && (context.objectId ? mcpObjects(context.port).find((object) => object.id === context.objectId)
      : context.toolName ? resolveMcpObject(context.port, context.toolName, 'tool') : undefined)
    if (!own) return
    const suffix = `/${own.path}/`
    const walk = (node: HtmlNode) => {
      node.children = node.children?.flatMap((child): HtmlNode[] => {
        walk(child)
        const href = child.properties?.href
        if (child.tagName !== 'a' || typeof href !== 'string' || !href.endsWith(suffix)) return [child]
        const label = child.children?.find((part) => (part.properties?.className as string[] | undefined)?.includes('api-symbol-link__name'))
        return label?.children ?? child.children?.filter((part) => !part.properties?.dataApiKind) ?? []
      })
    }
    walk(tree as HtmlNode)
  }
}

/** Inline literals take the chip that API doc comments give theirs. */
function rehypeLiteralChips() {
  return (tree: unknown) => {
    const walk = (node: HtmlNode, linked: boolean) => {
      for (const child of node.children ?? []) {
        if (child.tagName === 'pre') continue
        if (child.tagName === 'code') {
          const classes = (child.properties ??= {}).className
          child.properties!.className = [...(Array.isArray(classes) ? classes : []), 'api-literal', ...(linked ? ['api-literal--link'] : [])]
        }
        walk(child, linked || child.tagName === 'a')
      }
    }
    walk(tree as HtmlNode, false)
  }
}

/**
 * Preserve paragraphs, lists, and examples in the server's description.
 *
 * Sphinx roles become Markdown first, then the same mention pipeline as
 * prose pages links tmux names, MCP objects and API symbols.
 */
export async function renderToolDescription(description: string, context?: ToolDescriptionContext): Promise<string> {
  markdown ??= createMarkdownProcessor({ rehypePlugins: [rehypeMcpToolLinks, rehypeApiLinks, rehypeMcpSelfLinks, rehypeLiteralChips] })
  const frontmatter = { mcp: context, ...(context ? { port: context.port, product: 'mcp', symbols: false } : {}) }
  return (await (await markdown).render(restToMarkdown(description, context), { frontmatter })).code
}

export function toolSummary(description: string): string {
  return description.split(/\n\s*\n/, 1)[0].replace(/\s+/g, ' ').trim()
}

/** The summary as plain text, for places that cannot render Markdown: meta tags and search. */
export function plainSummary(description: string, port: string): string {
  return docSummaryText(toolSummary(description), port)
}
