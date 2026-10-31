import { mcpObjects } from './mcp-catalog'
import { PORT_BY_SLUG, portPageUrl } from './ports'

/**
 * The tools a port's MCP server advertises, grouped the way libtmux-mcp groups
 * them, with a worked prompt.
 *
 * Everything about a tool comes from the `tools/list` snapshot in
 * `data/mcp-protocol/<port>.json`, so a port shows the tools it has. A server
 * that declares no toolsets, which is how the Ruby and Julia servers are
 * built, lists its tools ungrouped and without tier badges: the annotations
 * they advertise are conservative consent hints, not a tier.
 */

export type TierId = 'inspect' | 'manage' | 'execute' | 'teardown'

export interface Tier {
  id: TierId
  label: string
  /** What the group's tools do, in libtmux-mcp's words. */
  summary: string
  /** The badge's tooltip. */
  tooltip: string
}

/** Least to most consequential, as libtmux-mcp lists them. */
export const TIERS: readonly Tier[] = [
  { id: 'inspect', label: 'Inspect', summary: 'Request tmux state and terminal output.', tooltip: 'Inspect: reads tmux state and terminal output' },
  { id: 'manage', label: 'Manage', summary: 'Change tmux structure or presentation.', tooltip: 'Manage: changes tmux structure or presentation' },
  { id: 'execute', label: 'Execute', summary: 'Start or drive pane processes, or store state that can control later execution.', tooltip: 'Execute: starts or drives a pane process' },
  { id: 'teardown', label: 'Teardown', summary: 'Delete tmux objects or retained scrollback. Not reversible.', tooltip: 'Teardown: deletes tmux objects or scrollback' },
]

/** One tool as `tools/list` advertises it. */
export interface ProtocolTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface ProtocolSnapshot {
  repo: string
  revision: string
  selection: Record<string, string>
  protocol: { tools: ProtocolTool[] }
}

/** Where a capability-model server records a tool's toolset. */
export const CAPABILITY_KEY = 'com.git-pull.libtmux-mcp/capability'

const isTier = (value: unknown): value is TierId => TIERS.some((tier) => tier.id === value)

/**
 * The tier a tool belongs to, or nothing when its server declares none.
 *
 * Servers built on the capability model name a `toolset` in the tool's
 * metadata; the FastMCP server tags each tool with it.
 */
export function toolTier(tool: Pick<ProtocolTool, '_meta'>): TierId | undefined {
  const capability = tool._meta?.[CAPABILITY_KEY] as { toolset?: unknown } | undefined
  if (isTier(capability?.toolset)) return capability.toolset
  const tags = (tool._meta?.fastmcp as { tags?: unknown } | undefined)?.tags
  return Array.isArray(tags) ? tags.find(isTier) : undefined
}

/** A sentence ends after two word characters, so `e.g.` and `i.e.` stay whole. */
const SENTENCE = /(?<=\w\w['")\]]?[.!?])\s+(?=\S)/

/** Markup left in a docstring or description once its first sentence is plain text. */
const plain = (text: string) => text
  .replace(/:[a-z]+:`([^`]+)`/g, '$1')
  .replace(/``([^`]+)``/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * What a tool does, in one sentence.
 *
 * Servers that generate part of every description repeat that opening across
 * tools, such as the policy sentence in front of each reader. A sentence that
 * several tools share says nothing about this one, so the first sentence that
 * is its own is the purpose. A clause after a semicolon is a separate fact and
 * stays on the reference page.
 */
export function toolPurposes(tools: readonly Pick<ProtocolTool, 'name' | 'description'>[]): Map<string, string> {
  const sentences = new Map(tools.map((tool) => [tool.name, plain(tool.description.split(/\n\s*\n/, 1)[0] ?? '').split(SENTENCE).filter(Boolean)]))
  const uses = new Map<string, number>()
  for (const own of sentences.values()) for (const sentence of new Set(own)) uses.set(sentence, (uses.get(sentence) ?? 0) + 1)
  return new Map(tools.map((tool) => {
    const own = sentences.get(tool.name)!
    const sentence = own.find((candidate) => (uses.get(candidate) ?? 0) < 3) ?? own[0] ?? ''
    const clause = sentence.split(';', 1)[0]!.trim().replace(/[.:,]$/, '')
    return [tool.name, clause ? `${clause}.` : '']
  }))
}

export interface ShowcaseTool {
  name: string
  tier?: TierId
  purpose: string
  /** The tool's reference page. */
  href: string
}

export interface ShowcaseGroup {
  tier?: Tier
  tools: ShowcaseTool[]
}

export interface ShowcaseStep {
  tool: ShowcaseTool
  arguments: Record<string, unknown>
  caption: string
}

export interface WorkedExample {
  prompt: string
  steps: ShowcaseStep[]
}

export interface McpShowcase {
  port: string
  groups: ShowcaseGroup[]
  example?: WorkedExample
  /** Whether the server takes `LIBTMUX_TOOLSETS` to offer only some tiers. */
  selectsToolsets: boolean
  /** The reference page for every tool. */
  toolsHref: string
  repo: string
  revision: string
}

interface ExampleStep { tool: string; arguments: Record<string, unknown>; caption: string }
interface ExampleDefinition { prompt: string; steps: ExampleStep[] }

const CREATE = 'Create the session.'
const RUN = 'Run the command and wait for its output.'
const RUN_IN_CREATED = 'Run the command in the pane the create result returned (%0).'
const RUN_IN_LISTED = 'Run the command in the pane the list returned (%0).'
const REMOVE = 'Remove the session once the result is read.'
const REMOVE_BY_ID = 'Remove the session by the id the create result returned ($0).'
const CHECKS = 'Create a tmux session called checks, run pytest -q in it, show me the result, then remove the session.'
const RUN_COMMAND = { command: 'pytest -q' }

/**
 * A prompt, and the calls an agent makes for it, in each server's own tools and
 * argument names. `site/test/mcp-showcase.test.ts` checks every call against
 * the tool's input schema in the port's snapshot.
 *
 * A session (`$0`) or pane (`%0`) id in a call is not something the prompt
 * supplies: an earlier result returned it, and the call's caption says so. A
 * server whose `create_session` result carries no pane id is followed by a
 * listing that does. The test checks each id against the earlier tools'
 * output schemas.
 */
export const EXAMPLES: Record<string, ExampleDefinition> = {
  py: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'run_command', arguments: { session_name: 'checks', ...RUN_COMMAND }, caption: RUN },
    { tool: 'kill_session', arguments: { session_name: 'checks' }, caption: REMOVE },
  ] },
  ts: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_CREATED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  swift: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: { session: 'checks' }, caption: 'List the panes in the new session.' },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  csharp: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_CREATED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  cxx: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its session id.' },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  rs: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_windows', arguments: {}, caption: 'List the windows, each with its session id.' },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its window id.' },
    { tool: 'run_shell_command', arguments: { pane: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  go: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  java: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  ruby: { prompt: 'List the panes on my tmux server.', steps: [
    { tool: 'tmux_capabilities', arguments: {}, caption: 'Ask the server which tools and limits are enabled.' },
    { tool: 'tmux_snapshot', arguments: { entity: 'pane', limit: 20 }, caption: 'List the panes.' },
  ] },
  julia: { prompt: 'Show me what the first pane is displaying.', steps: [
    { tool: 'list_panes', arguments: { limit: 10 }, caption: 'List the panes. Each result carries a target.' },
    { tool: 'capture_pane', arguments: { target: { paneId: '%0', generation: '3f9a1c' } }, caption: 'Read the pane through the target the list returned (%0).' },
  ] },
}

const SNAPSHOTS = import.meta.glob<ProtocolSnapshot>('../data/mcp-protocol/*.json', { import: 'default' })

/** The `tools/list` snapshot committed for a port. */
export async function protocolSnapshot(port: string): Promise<ProtocolSnapshot | undefined> {
  return SNAPSHOTS[`../data/mcp-protocol/${port}.json`]?.()
}

/**
 * Group a port's tools and attach its worked example.
 *
 * @throws {Error} When a tool the server advertises has no reference page.
 */
export function buildShowcase(port: string, version: string, snapshot: ProtocolSnapshot): McpShowcase {
  const info = PORT_BY_SLUG[port]!
  const pages = new Map(mcpObjects(port).filter((object) => object.kind === 'tool').map((object) => [object.name, object.path]))
  const purposes = toolPurposes(snapshot.protocol.tools)
  const tools = new Map(snapshot.protocol.tools.map((tool): [string, ShowcaseTool] => {
    const path = pages.get(tool.name)
    if (!path) throw new Error(`${port}: ${tool.name} has no reference page`)
    const tier = toolTier(tool)
    return [tool.name, { name: tool.name, ...(tier ? { tier } : {}), purpose: purposes.get(tool.name) ?? '', href: portPageUrl(info, version, path) }]
  }))
  const sorted = [...tools.values()].sort((a, b) => a.name.localeCompare(b.name))
  const groups: ShowcaseGroup[] = sorted.some((tool) => tool.tier)
    ? TIERS.map((tier) => ({ tier, tools: sorted.filter((tool) => tool.tier === tier.id) })).filter((group) => group.tools.length)
    : [{ tools: sorted }]
  const definition = EXAMPLES[port]
  const example = definition && definition.steps.every((step) => tools.has(step.tool))
    ? { prompt: definition.prompt, steps: definition.steps.map((step) => ({ tool: tools.get(step.tool)!, arguments: step.arguments, caption: step.caption })) }
    : undefined
  return {
    port, groups, ...(example ? { example } : {}),
    selectsToolsets: 'LIBTMUX_TOOLSETS' in snapshot.selection,
    toolsHref: portPageUrl(info, version, 'mcp/tools'),
    repo: snapshot.repo, revision: snapshot.revision,
  }
}

/** A port's showcase, or nothing for a port with no committed `tools/list` snapshot. */
export async function mcpShowcase(port: string, version: string): Promise<McpShowcase | undefined> {
  const snapshot = await protocolSnapshot(port)
  return snapshot && PORT_BY_SLUG[port] ? buildShowcase(port, version, snapshot) : undefined
}

/** The headings the showcase adds to a page's table of contents. */
export function showcaseHeadings(showcase: McpShowcase): { depth: number; slug: string; text: string }[] {
  const tiers = showcase.groups.flatMap((group) => (group.tier ? [group.tier] : []))
  return [
    { depth: 2, slug: tiers.length ? 'tools-by-tier' : 'tools', text: tiers.length ? 'Tools by tier' : 'Tools' },
    ...tiers.map((tier) => ({ depth: 3, slug: `tier-${tier.id}`, text: tier.label })),
    ...(showcase.example ? [{ depth: 2, slug: 'worked-example', text: 'Worked example' }] : []),
  ]
}
