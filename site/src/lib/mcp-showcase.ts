import { mcpObjects } from './mcp-catalog'
import { PORT_BY_SLUG, portPageUrl } from './ports'
import { EXAMPLES, STALE_TARGET, type ExampleStep } from './mcp-examples.ts'
import { contractOf, sameContract, statesOutputs, type ToolContract } from './mcp-contract.ts'
import { replayFrames, runAnswers, type Frame } from './mcp-replay'
import { hasState, recordingStateProblems, type TmuxState } from './mcp-tmux-state.ts'

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
  outputSchema?: Record<string, unknown>
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
  /** The tmux state after each call (frame 0 is before the first): the recording's own tmux server when it stored one, else what the results state. */
  frames: Frame[]
  /** Whether the frames are the recording's own tmux server, read after each call. */
  tmuxState: boolean
  /** Whether any result is shown shortened. */
  shortened: boolean
  /** The revision the page documents, when it is not the one recorded. The page does not say which of the two is newer. */
  documentedRevision?: string
  /** Whether every tool the recording calls states an output schema, so that matching schemas covers what the calls return as well as what they take. */
  outputsChecked: boolean
  /** The directory the sandbox ran in was replaced by this fixed path. */
  projectDirectory?: string
  /**
   * The server's generation, which differs on every run, was replaced by a fixed
   * token. A real call sends the generation `listedBy` returned, and the server
   * refuses the token itself, with the error code `refusedAs`.
   */
  generation?: { token: string; listedBy: string; refusedAs: string }
  /** What each command run left in its pane, as the last line with text, with the pane it ran in. */
  answers: { pane?: string; line: string }[]
}

export interface WorkedExample {
  prompt: string
  steps: ShowcaseStep[]
  /** Present only when every step has a recorded result from a session whose tools still take and return what they did when recorded. */
  recording?: Recording
}

/** `data/mcp-transcripts/<port>.json`, written by `scripts/gen-mcp-transcript.mjs` for each port it has recorded; the glob below picks up a new one (vitest caches the transform by its text, so a new recording needs an edit to this line to be seen). */
export interface Transcript {
  repo: string
  revision: string
  /** The input and output schemas of each tool the session called, as the server advertised them when it was recorded. */
  contracts?: Record<string, ToolContract>
  sandbox: { tmux: string; pytest: string; rewritten?: { projectDirectory?: string; generation?: string; generationListedBy?: string; generationRefusedAs?: string } }
  /** The recording's own tmux server before the first call; present with the `tmux` of every step, or with none. */
  tmuxBefore?: TmuxState
  steps: { tool: string; arguments: Record<string, unknown>; isError: boolean; content: { type: string; text?: string }[]; structuredContent?: unknown; tmux?: TmuxState }[]
}

const TRANSCRIPTS = import.meta.glob<Transcript>('../data/mcp-transcripts/*.json', { import: 'default' })

/** The transcript recorded for a port, if any. */
export async function transcriptFor(port: string): Promise<Transcript | undefined> {
  return TRANSCRIPTS[`../data/mcp-transcripts/${port}.json`]?.()
}

const LONG_TEXT = 240
const LONG_LIST = 4
const LONG_OBJECT = 12
const DEEP = 5

/**
 * A recorded value shortened for the page: a string past 240 characters is cut
 * with an ellipsis, a list past four entries keeps its first four and says how
 * many it left out, an object past twelve keys keeps its first twelve, and
 * anything nested more than five levels deep is replaced by an ellipsis. The
 * recording keeps everything.
 */
export function abbreviate(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > LONG_TEXT ? `${value.slice(0, LONG_TEXT)}…` : value
  const nested = value !== null && typeof value === 'object' && Object.keys(value as object).length > 0
  if (nested && depth >= DEEP) return '…'
  if (Array.isArray(value)) {
    const shown = value.slice(0, LONG_LIST).map((item) => abbreviate(item, depth + 1))
    return value.length > LONG_LIST ? [...shown, `… ${value.length - LONG_LIST} more`] : shown
  }
  if (value && typeof value === 'object') {
    const keys = Object.entries(value)
    const shown = Object.fromEntries(keys.slice(0, LONG_OBJECT).map(([key, item]) => [key, abbreviate(item, depth + 1)]))
    return keys.length > LONG_OBJECT ? { ...shown, '…': `${keys.length - LONG_OBJECT} more` } : shown
  }
  return value
}

/** What a step answered: the structured result when the server sent one, else its text. */
function stepResult(step: Transcript['steps'][number]): unknown {
  if (step.structuredContent !== undefined) return step.structuredContent
  return step.content.map((part) => part.text ?? '').join('\n')
}

/**
 * The lists of tool names a recorded result states, such as the enabled tools
 * Ruby's `tmux_capabilities` returns: a list of strings, at any depth, that
 * names every tool the session called. A tool the session called was enabled
 * when it was recorded, so a list of the server's tools includes it.
 */
function listedTools(value: unknown, called: readonly string[]): string[][] {
  if (Array.isArray(value)) {
    const lists = value.length > 1 && value.every((item) => typeof item === 'string') && called.every((name) => value.includes(name)) ? [value as string[]] : []
    return [...lists, ...value.flatMap((item) => listedTools(item, called))]
  }
  return value && typeof value === 'object' ? Object.values(value).flatMap((item) => listedTools(item, called)) : []
}

/**
 * Whether a recording still describes the server a snapshot documents.
 *
 * The snapshot's revision need not be the recording's. A port's own build
 * regenerates the snapshot at the port's head (`gen-mcp-protocol.mjs
 * --source-bound`), which need not be the commit the session was recorded
 * at. The recording stays shown while the calls are the example's, none
 * failed, every tool it called is still advertised with the input and output
 * schemas the transcript recorded, and any list of tools a result states is
 * the set the snapshot advertises. Matching schemas do not make the values
 * equal; the page says so.
 *
 * A recording that stores tmux's state holds only if every step and the start
 * store one and each describes the session the calls made
 * (`recordingStateProblems`); a recording that stores none is drawn from its
 * results. One that rewrites the generation holds only if it also says which
 * tool listed it and that the server refuses the token as `stale_target`.
 */
export function recordingHolds(transcript: Transcript, steps: readonly ExampleStep[], advertised: ReadonlyMap<string, ProtocolTool>): boolean {
  const called = [...new Set(transcript.steps.map((step) => step.tool))]
  const rewritten = transcript.sandbox.rewritten
  return transcript.steps.length === steps.length
    && recordingStateProblems(transcript).length === 0
    && (!rewritten?.generation || (called.includes(rewritten.generationListedBy ?? '') && rewritten.generationRefusedAs === STALE_TARGET))
    && transcript.steps.every((step, index) => {
      const tool = advertised.get(step.tool)
      return !step.isError && step.tool === steps[index]!.tool
        && JSON.stringify(step.arguments) === JSON.stringify(steps[index]!.arguments)
        && sameContract(transcript.contracts?.[step.tool], tool && contractOf(tool))
        && listedTools(stepResult(step), called).every((list) => new Set(list).size === advertised.size && list.every((name) => advertised.has(name)))
    })
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
  const advertised = new Map(snapshot.protocol.tools.map((tool) => [tool.name, tool]))
  const recorded = definition && transcript && recordingHolds(transcript, definition.steps, advertised) ? transcript : undefined
  const full = recorded?.steps.map(stepResult) ?? []
  const shown = full.map((value) => abbreviate(value))
  const example: WorkedExample | undefined = definition && definition.steps.every((step) => tools.has(step.tool))
    ? {
      prompt: definition.prompt,
      steps: definition.steps.map((step, index) => ({
        tool: tools.get(step.tool)!, arguments: step.arguments, caption: step.caption,
        ...(recorded ? { result: shown[index] } : {}),
      })),
      ...(recorded ? { recording: { repo: recorded.repo, revision: recorded.revision, tmux: recorded.sandbox.tmux, runner: recorded.sandbox.pytest, frames: replayFrames(recorded.steps, recorded.tmuxBefore), tmuxState: hasState(recorded), shortened: shown.some((value, index) => JSON.stringify(value) !== JSON.stringify(full[index])), ...(recorded.revision === snapshot.revision ? {} : { documentedRevision: snapshot.revision }), outputsChecked: statesOutputs(recorded.contracts), ...(recorded.sandbox.rewritten?.projectDirectory ? { projectDirectory: recorded.sandbox.rewritten.projectDirectory } : {}), ...(recorded.sandbox.rewritten?.generation ? { generation: { token: recorded.sandbox.rewritten.generation, listedBy: recorded.sandbox.rewritten.generationListedBy!, refusedAs: recorded.sandbox.rewritten.generationRefusedAs! } } : {}), answers: runAnswers(recorded.steps) } } : {}),
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
