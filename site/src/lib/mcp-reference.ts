import data from '../data/mcp-tools.json'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'

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

/** Shared route identity for rendered tools and downloadable protocol data. */
export function mcpReferenceRoutes(buildPort: string | undefined, defaults: Record<string, string>, buildVersion: string) {
  return Object.entries(MCP_REFERENCE).filter(([port]) => !buildPort || port === buildPort)
    .flatMap(([port, catalog]) => [undefined, ...catalog.registrations.map((tool) => tool.wireName)].map((toolName) => {
      const version = buildPort ? buildVersion : (defaults[port] ?? 'latest')
      return { path: `${buildPort ? '' : `${port}/${version}/`}mcp/tools${toolName ? `/${toolName}` : ''}`, port, toolName, version }
    }))
}

let markdown: ReturnType<typeof createMarkdownProcessor> | undefined

/** Preserve paragraphs, lists, and examples in the server's description. */
export async function renderToolDescription(description: string): Promise<string> {
  markdown ??= createMarkdownProcessor()
  return (await (await markdown).render(description)).code
}

export function toolSummary(description: string): string {
  return description.split(/\n\s*\n/, 1)[0].replace(/\s+/g, ' ').trim()
}
