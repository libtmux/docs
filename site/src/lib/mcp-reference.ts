import data from '../data/mcp-tools.json'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { PORT_BY_SLUG, portPageUrl } from './ports'

export interface McpRegistration {
  name: string
  wireName: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  schemaStatus: string
  source: { repo: string; revision: string; file: string; line?: number }
}

interface ProtocolItem {
  name: string
  description?: string
  uri?: string
  uriTemplate?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
}

export interface McpReference {
  registrations: McpRegistration[]
  selection: Record<string, string>
  protocol: {
    protocolVersion: string
    resources: ProtocolItem[]
    resourceTemplates: ProtocolItem[]
    prompts: ProtocolItem[]
  }
}

export const MCP_REFERENCE = data.ports as unknown as Record<string, McpReference>

// These registrations perform the same operation with different argument/result shapes.
// Swift's raw tmux command and scrollback-only clearing must keep distinct identities.
const TOOL_OPERATIONS: Record<string, Record<string, string>> = {
  ts: { run_shell_command: 'run_command' },
  java: { run_shell_command: 'run_command' },
  rs: { new_window: 'create_window', split_pane: 'split_window', clear_pane: 'clear_pane_scrollback' },
  dotnet: { run: 'run_command', split_pane: 'split_window' },
  cxx: { new_window: 'create_window' },
  swift: { new_session: 'create_session', new_window: 'create_window', split_pane: 'split_window', run_shell: 'run_command', run_command: 'raw_tmux_command' },
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
    .flatMap(([port, catalog]) => [undefined, ...catalog.registrations.map((tool) => tool.wireName)].map((toolName) => {
      const version = buildPort ? buildVersion : (defaults[port] ?? 'latest')
      return { path: `${buildPort ? '' : `${port}/${version}/`}mcp/tools${toolName ? `/${toolName}` : ''}`, port, toolName, version }
    }))
}

let markdown: ReturnType<typeof createMarkdownProcessor> | undefined

interface ToolDescriptionContext { port: string; version: string; toolName?: string }
interface HtmlNode { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HtmlNode[] }

function rehypeMcpToolLinks() {
  return (tree: unknown, file: { data: { astro?: { frontmatter?: { mcp?: ToolDescriptionContext } } } }) => {
    const context = file.data.astro?.frontmatter?.mcp
    if (!context || !PORT_BY_SLUG[context.port]) return
    const names = new Set(MCP_REFERENCE[context.port]?.registrations.map((tool) => tool.wireName))
    const link = (name: string, node: HtmlNode): HtmlNode => ({
      type: 'element', tagName: 'a',
      properties: { href: portPageUrl(PORT_BY_SLUG[context.port], context.version, `mcp/tools/${name}`) },
      children: [node],
    })
    const known = (name: string) => names.has(name) && name !== context.toolName
    const walk = (node: HtmlNode) => {
      if (!node.children || ['a', 'pre', 'script', 'style'].includes(node.tagName ?? '')) return
      node.children = node.children.flatMap((child): HtmlNode[] => {
        if (child.tagName === 'code') {
          const name = child.children?.map((part) => part.value ?? '').join('') ?? ''
          return [known(name) ? link(name, child) : child]
        }
        if (child.type !== 'text') {
          walk(child)
          return [child]
        }
        const text = child.value ?? ''
        const parts: HtmlNode[] = []
        let start = 0
        for (const match of text.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)) {
          if (!known(match[0])) continue
          parts.push({ type: 'text', value: text.slice(start, match.index) }, link(match[0], { type: 'text', value: match[0] }))
          start = match.index + match[0].length
        }
        return [...parts, { type: 'text', value: text.slice(start) }]
      })
    }
    walk(tree as HtmlNode)
  }
}

/** Preserve paragraphs, lists, and examples in the server's description. */
export async function renderToolDescription(description: string, context?: ToolDescriptionContext): Promise<string> {
  markdown ??= createMarkdownProcessor({ rehypePlugins: [rehypeMcpToolLinks] })
  return (await (await markdown).render(description, { frontmatter: { mcp: context } })).code
}

export function toolSummary(description: string): string {
  return description.split(/\n\s*\n/, 1)[0].replace(/\s+/g, ' ').trim()
}
