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

/**
 * The callables of a port's MCP product that are registered as tools. A Rust tool carries `#[tool(` on its declaration.
 * Elsewhere the registration names the tool and the file that registers it, and the declaration is the callable of that
 * name in that directory: Python registers `capture_pane` in `pane_tools/__init__.py` and declares it in
 * `pane_tools/io.py`. That match is used only when it is complete, one declaration for every registration and none left
 * over; a port whose registrations share names with other callables (Ruby's `close` and `run`) marks nothing by it.
 */
export function mcpToolSymbols<T extends { name: string; kind: string; product?: string; source: { file: string }; signatures: { raw?: string }[] }>(port: string, symbols: readonly T[]): T[] {
  const callables = symbols.filter((symbol) => symbol.product === 'mcp' && (symbol.kind === 'function' || symbol.kind === 'method'))
  const attributed = callables.filter((symbol) => symbol.signatures.some((signature) => signature.raw?.trimStart().startsWith('#[tool(')))
  const registrations = MCP_REFERENCE[port]?.registrations ?? []
  const named = registrations.map((tool) => {
    const directory = tool.source.file.slice(0, tool.source.file.lastIndexOf('/') + 1)
    return callables.filter((symbol) => symbol.name === tool.name && symbol.source.file.startsWith(directory))
  })
  const complete = registrations.length > 0 && named.every((found) => found.length === 1) && new Set(named.flat()).size === registrations.length
  return [...new Set([...attributed, ...(complete ? named.flat() : [])])]
}

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
      const identity = 'uriTemplate' in entry && entry.uriTemplate || 'uri' in entry && entry.uri || name
      const segment = kind === 'tool' ? name : name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')
      if (!segment) throw new Error(`MCP object needs a route: ${port}/${kind}/${name}`)
      const slug = `${kind === 'resource-template' ? 'templates/' : ''}${segment}`
      rows.push({ id: `mcp.${kind}.${identity}`, name, kind, section, slug,
        path: `mcp/${section}/${slug}`, description: entry.description ?? '',
        ...('wireName' in entry ? { tool: entry } : { item: entry }) })
    }
  }
  add('tool', reference.registrations)
  add('prompt', reference.protocol.prompts)
  add('resource', reference.protocol.resources)
  add('resource-template', reference.protocol.resourceTemplates)
  if (new Set(rows.map((row) => row.path)).size !== rows.length || new Set(rows.map((row) => row.id)).size !== rows.length) {
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
  const matches = mcpObjects(port).filter((entry) => (!family || entry.kind === family) &&
    [entry.name, entry.item?.uri, entry.item?.uriTemplate].includes(target))
  return matches.length === 1 ? matches[0] : undefined
}

export function mcpObjectAt(port: string, section: McpSection, slug?: string): McpObject | undefined {
  return slug === undefined ? undefined : mcpObjects(port).find((entry) => entry.section === section && entry.slug === slug)
}

export type McpMentionDecision =
  | { kind: 'link'; port: string; object: McpObject }
  | { kind: 'skip'; why: string }
  | { kind: 'unresolved'; why: string; tried: string[] }

/** A resource URI is never a library symbol, so the workspace guides that inspect through MCP can name it bare. */
const RESOURCE_URI = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i

/** Shared by the renderer and source lint; undefined delegates to the language API. */
export function decideMcpMention(text: string, context: Pick<MentionContext, 'pagePort' | 'before' | 'product'>): McpMentionDecision | undefined {
  const explicit = text.startsWith('mcp:')
  if (!explicit && context.product !== 'mcp' && !(context.product === 'workspace' && RESOURCE_URI.test(text))) return undefined
  const owner = (context.before && portFromSentence(context.before)) || context.pagePort
  const ports = owner ? [owner] : Object.keys(MCP_REFERENCE)
  const matches = ports.flatMap((port) => {
    const object = resolveMcpObject(port, text)
    return object ? [{ port, object }] : []
  })
  if (matches.length === 1) return { kind: 'link', ...matches[0]! }
  if (explicit) return { kind: 'unresolved',
    why: matches.length ? 'MCP reference needs a port' : 'MCP object not advertised in the stated port', tried: ports }
  if (matches.length > 1) return { kind: 'skip', why: 'MCP reference needs a port' }
  // A same-name tool and prompt need an explicit kind, even if a language
  // declaration also has that name.
  if (ports.some((port) => mcpObjects(port).filter((object) =>
    [object.name, object.item?.uri, object.item?.uriTemplate].includes(text)).length > 1)) {
    return { kind: 'skip', why: 'MCP reference needs an object kind' }
  }
  return undefined
}

export interface McpRunMention { start: number; end: number; object: McpObject }

/**
 * Tool and prompt names inside a longer code run, such as `--enable-tool
 * tmux_capture` or `list_sessions,capture_pane`. A whole-span name is
 * `decideMcpMention`'s; a call such as `capture_pane(...)` is code, not a name.
 */
export function mcpRunMentions(text: string, port: string): McpRunMention[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)].flatMap((token) => {
    const end = token.index + token[0].length
    if (/[\w./:$-]/.test(text[token.index - 1] ?? '') || /^[\w/(-]|^\.[A-Za-z]/.test(text.slice(end))) return []
    const object = resolveMcpObject(port, token[0])
    return object && object.kind !== 'resource' && object.kind !== 'resource-template' ? [{ start: token.index, end, object }] : []
  })
}
