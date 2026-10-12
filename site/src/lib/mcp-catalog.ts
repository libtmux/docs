import data from '../data/mcp-tools.json' with { type: 'json' }
import { portFromSentence } from '../../../packages/api-model/src/prose.ts'
import type { MentionContext } from '../../../packages/api-model/src/prose.ts'

export interface McpRegistration {
  name: string
  wireName: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  enabledByDefault?: boolean
  enableOption?: string
  schemaStatus: string
  source: { repo: string; revision: string; extractedRevision?: string; file: string; line?: number }
}

export interface ProtocolItem {
  name: string
  title?: string
  description?: string
  uri?: string
  uriTemplate?: string
  mimeType?: string
  annotations?: Record<string, unknown>
  arguments?: { name: string; description?: string; required?: boolean }[]
}

export interface McpReference {
  repo: string
  revision: string
  extractedRevision?: string
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

export const MCP_SECTIONS = { tools: 'Tools', prompts: 'Prompts', resources: 'Resources' } as const
export type McpSection = keyof typeof MCP_SECTIONS
export type McpKind = 'tool' | 'prompt' | 'resource' | 'resource-template'
export interface McpObject {
  id: string
  name: string
  kind: McpKind
  section: McpSection
  /** Path within the port and version, with no trailing slash. */
  path: string
  slug: string
  description: string
  tool?: McpRegistration
  item?: ProtocolItem
}

const objects = new Map<string, McpObject[]>()
/** Protocol identities retain their kind, so a tool and prompt can share a name. */
export function mcpObjects(port: string): McpObject[] {
  if (objects.has(port)) return objects.get(port)!
  const reference = MCP_REFERENCE[port]
  if (!reference) return []
  const rows: McpObject[] = []
  const add = (kind: McpKind, entries: (McpRegistration | ProtocolItem)[]) => {
    const section = kind === 'tool' ? 'tools' : kind === 'prompt' ? 'prompts' : 'resources'
    for (const entry of entries) {
      const name = 'wireName' in entry ? entry.wireName : entry.name
      const identity = ('uriTemplate' in entry && entry.uriTemplate) || ('uri' in entry && entry.uri) || name
      const segment =
        kind === 'tool'
          ? name
          : name
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, '-')
              .replace(/^-|-$/g, '')
      if (!segment) throw new Error(`MCP object needs a route: ${port}/${kind}/${name}`)
      const slug = `${kind === 'resource-template' ? 'templates/' : ''}${segment}`
      rows.push({
        id: `mcp.${kind}.${identity}`,
        name,
        kind,
        section,
        slug,
        path: `mcp/${section}/${slug}`,
        description: entry.description ?? '',
        ...('wireName' in entry ? { tool: entry } : { item: entry }),
      })
    }
  }
  add('tool', reference.registrations)
  add('prompt', reference.protocol.prompts)
  add('resource', reference.protocol.resources)
  add('resource-template', reference.protocol.resourceTemplates)
  if (
    new Set(rows.map((row) => row.path)).size !== rows.length ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error(`Duplicate MCP object identity or route in ${port}`)
  }
  objects.set(port, rows)
  return rows
}

/** Resolve explicit domain names everywhere; bare names only in MCP prose. */
export function resolveMcpObject(port: string, text: string, kind?: McpKind): McpObject | undefined {
  const explicit = /^mcp:(tool|prompt|resource|resource-template):(.+)$/.exec(text)
  const target = explicit?.[2] ?? text
  const family = explicit?.[1] ?? kind
  const matches = mcpObjects(port).filter(
    (entry) =>
      (!family || entry.kind === family) && [entry.name, entry.item?.uri, entry.item?.uriTemplate].includes(target),
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function mcpObjectAt(port: string, section: McpSection, slug?: string): McpObject | undefined {
  return slug === undefined
    ? undefined
    : mcpObjects(port).find((entry) => entry.section === section && entry.slug === slug)
}

export type McpMentionDecision =
  | { kind: 'link'; port: string; object: McpObject }
  | { kind: 'skip'; why: string }
  | { kind: 'unresolved'; why: string; tried: string[] }

/** Shared by the renderer and source lint; undefined delegates to the language API. */
export function decideMcpMention(
  text: string,
  context: Pick<MentionContext, 'pagePort' | 'before' | 'product'>,
): McpMentionDecision | undefined {
  const explicit = text.startsWith('mcp:')
  if (!explicit && context.product !== 'mcp') return undefined
  const owner = (context.before && portFromSentence(context.before)) || context.pagePort
  const ports = owner ? [owner] : Object.keys(MCP_REFERENCE)
  const matches = ports.flatMap((port) => {
    const object = resolveMcpObject(port, text)
    return object ? [{ port, object }] : []
  })
  if (matches.length === 1) return { kind: 'link', ...matches[0]! }
  if (explicit)
    return {
      kind: 'unresolved',
      why: matches.length ? 'MCP reference needs a port' : 'MCP object not advertised in the stated port',
      tried: ports,
    }
  if (matches.length > 1) return { kind: 'skip', why: 'MCP reference needs a port' }
  // A same-name tool and prompt need an explicit kind, even if a language
  // declaration also has that name.
  if (
    ports.some(
      (port) =>
        mcpObjects(port).filter((object) => [object.name, object.item?.uri, object.item?.uriTemplate].includes(text))
          .length > 1,
    )
  ) {
    return { kind: 'skip', why: 'MCP reference needs an object kind' }
  }
  return undefined
}
