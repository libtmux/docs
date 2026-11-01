import { mcpObjects } from './mcp-catalog'
import { PORT_BY_SLUG, portPageUrl } from './ports'
import { EXAMPLES } from './mcp-examples.ts'
import { replayFrames, runAnswers, type Frame } from './mcp-replay'

export { EXAMPLES }

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

/** The tier a tool belongs to, or nothing for a server that declares no toolsets. */
export const tierFor = (tool: { tier?: TierId }): Tier | undefined => TIERS.find((entry) => entry.id === tool.tier)

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
  /** What the server answered in the recorded session, abbreviated for the page. Absent without a recording. */
  result?: unknown
}

/** The recorded session behind a worked example's results. */
export interface Recording {
  repo: string
  revision: string
  tmux: string
  /** The test runner the sandbox ran, which produced the output below. */
  runner: string
  /** The tmux state after each call (frame 0 is before the first), read from the recorded results only. */
  frames: Frame[]
  /** Whether any result is shown shortened. */
  shortened: boolean
  /** The directory the sandbox ran in was replaced by this fixed path. */
  projectDirectory?: string
  /** What each command run left in its pane, as the last line with text, with the pane it ran in. */
  answers: { pane?: string; line: string }[]
}

export interface WorkedExample {
  prompt: string
  steps: ShowcaseStep[]
  /** Present only when every step has a recorded result from a session checked against the snapshot's revision. */
  recording?: Recording
}

/** `data/mcp-transcripts/<port>.json`, written by `scripts/gen-mcp-transcript.mjs` for each port it has recorded; the glob below picks up a new one (vitest caches the transform, so touching this comment refreshes it). */
export interface Transcript {
  repo: string
  revision: string
  sandbox: { tmux: string; pytest: string; rewritten?: { projectDirectory?: string } }
  steps: { tool: string; arguments: Record<string, unknown>; isError: boolean; content: { type: string; text?: string }[]; structuredContent?: unknown }[]
}

const TRANSCRIPTS = import.meta.glob<Transcript>('../data/mcp-transcripts/*.json', { import: 'default' })

/** The transcript recorded for a port, if any. */
export async function transcriptFor(port: string): Promise<Transcript | undefined> {
  return TRANSCRIPTS[`../data/mcp-transcripts/${port}.json`]?.()
}

const LONG_TEXT = 240
const LONG_LIST = 4

/**
 * A recorded value shortened for the page: a string past 240 characters is cut
 * with an ellipsis and a list past four entries keeps its first four and says
 * how many it left out. The recording keeps everything.
 */
export function abbreviate(value: unknown): unknown {
  if (typeof value === 'string') return value.length > LONG_TEXT ? `${value.slice(0, LONG_TEXT)}…` : value
  if (Array.isArray(value)) {
    const shown = value.slice(0, LONG_LIST).map(abbreviate)
    return value.length > LONG_LIST ? [...shown, `… ${value.length - LONG_LIST} more`] : shown
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, abbreviate(item)]))
  return value
}

/** What a step answered: the structured result when the server sent one, else its text. */
function stepResult(step: Transcript['steps'][number]): unknown {
  if (step.structuredContent !== undefined) return step.structuredContent
  return step.content.map((part) => part.text ?? '').join('\n')
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
export function buildShowcase(port: string, version: string, snapshot: ProtocolSnapshot, transcript?: Transcript): McpShowcase {
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
  // A recording counts only for the same calls, on the revision the snapshot describes, with no step that failed.
  const recorded = definition && transcript && transcript.revision === snapshot.revision
    && transcript.steps.length === definition.steps.length
    && transcript.steps.every((step, index) => !step.isError && step.tool === definition.steps[index]!.tool
      && JSON.stringify(step.arguments) === JSON.stringify(definition.steps[index]!.arguments))
    ? transcript : undefined
  const full = recorded?.steps.map(stepResult) ?? []
  const shown = full.map(abbreviate)
  const example: WorkedExample | undefined = definition && definition.steps.every((step) => tools.has(step.tool))
    ? {
      prompt: definition.prompt,
      steps: definition.steps.map((step, index) => ({
        tool: tools.get(step.tool)!, arguments: step.arguments, caption: step.caption,
        ...(recorded ? { result: shown[index] } : {}),
      })),
      ...(recorded ? { recording: { repo: recorded.repo, revision: recorded.revision, tmux: recorded.sandbox.tmux, runner: recorded.sandbox.pytest, frames: replayFrames(recorded.steps), shortened: shown.some((value, index) => JSON.stringify(value) !== JSON.stringify(full[index])), ...(recorded.sandbox.rewritten?.projectDirectory ? { projectDirectory: recorded.sandbox.rewritten.projectDirectory } : {}), answers: runAnswers(recorded.steps) } } : {}),
    }
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
  return snapshot && PORT_BY_SLUG[port] ? buildShowcase(port, version, snapshot, await transcriptFor(port)) : undefined
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

/**
 * One sentence on what a port's server offers an agent, from its snapshot: how
 * many tools it advertises and the tiers they fall in.
 */
export function showcaseSentence(showcase: McpShowcase): string {
  const name = PORT_BY_SLUG[showcase.port]!.name
  const count = showcase.groups.reduce((total, group) => total + group.tools.length, 0)
  const tiers = showcase.groups.flatMap((group) => (group.tier ? [group.tier.label] : []))
  const grouped = tiers.length ? `, grouped as ${tiers.slice(0, -1).join(', ')}${tiers.length > 1 ? ' and ' : ''}${tiers.at(-1)}` : ''
  return `The ${name} server lets an agent work with tmux through ${count} tools${grouped}.`
}
