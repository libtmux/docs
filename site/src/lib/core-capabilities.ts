/**
 * The Core Library capability showcase: what the library does, each shown by
 * an excerpt of a program or test the port's own CI executes.
 *
 * `data/core-capabilities.json` records, per port and capability, the file, the
 * anchors of the excerpt, the workflow command that runs it and the evidence
 * that its exit status or expected output is checked. `validateCapability`
 * refuses an entry without that evidence, and `test/core-capabilities.test.ts`
 * reads every claim back from the revision-bound example cache. A capability a
 * port has no executed example for has no entry and is not offered.
 */

// gen-example-sources.mjs imports this module with bare Node; local imports need `.ts`.
import { sliceExcerpt } from './example-excerpt.ts'
import { landingCacheKey, workflowRuns, type CachedSource, type LandingCi, type LandingRange } from './port-landing.ts'

/** The showcase's capabilities, in the order a reader sees them. */
export const CAPABILITIES = [
  { id: 'typed-graph', label: 'Navigate tmux via a typed object graph' },
  { id: 'watch', label: 'Watch for changes' },
  { id: 'send-keys', label: 'Send keys' },
  { id: 'run-applications', label: 'Run applications' },
  { id: 'rename-windows', label: 'Rename windows' },
  { id: 'create-windows', label: 'Create windows' },
  { id: 'move-windows', label: 'Move windows' },
  { id: 'set-layouts', label: 'Set layouts' },
] as const
export type CapabilityId = (typeof CAPABILITIES)[number]['id']

/** One thing the port's tests assert or its runner does with the result. */
export interface ExitEvidence {
  /** A file in the port repository, cached with the example sources. */
  file: string
  /** Text the file holds; the check that the program or test fails when the result is wrong. */
  contains: string
}

export interface CapabilityEntry extends LandingRange {
  file: string
  lang: string
  more?: readonly LandingRange[]
  ci: LandingCi & {
    /** The workflow job's key. */
    job: string
    /** The step's name, absent when the step has none. */
    step?: string
    /** The step's working directory, absent for the repository root. */
    directory?: string
    /** What the caption names instead, when the directory is a template. */
    where?: string
  }
  /** Why a wrong exit status or missing expected output fails the CI run. At least one. */
  checkedBy: readonly ExitEvidence[]
  /** The oldest tmux the capability needs, shown as a badge, such as `3.8+`. */
  tmux?: string
}

export type CapabilityTable = Readonly<Record<string, Partial<Record<CapabilityId, CapabilityEntry>>>>

export const capabilityCacheKey = (owner: string, file: string) => landingCacheKey(owner, 'core' as never, file).replace('/core:', ':')

/** Every file an entry relies on: the example and what checks it. */
export const capabilityFiles = (entry: CapabilityEntry): string[] => [entry.file, ...entry.checkedBy.map((item) => item.file)]

/** Problems with an entry's record, empty when it states its evidence. */
export function validateCapability(entry: Partial<CapabilityEntry>): string[] {
  const problems: string[] = []
  if (!entry.file) problems.push('names no file')
  if (!entry.from) problems.push('names no first line')
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(entry.ci?.workflow ?? '')) problems.push('names no workflow')
  if (!entry.ci?.command?.trim()) problems.push('names no CI command')
  if (!entry.ci?.job?.trim()) problems.push('names no CI job')
  if (!entry.checkedBy?.length) problems.push('records no evidence that the exit status or output is checked')
  for (const item of entry.checkedBy ?? []) if (!item.file || !item.contains?.trim()) problems.push('records evidence with no file or text')
  if (entry.tmux !== undefined && !/^\d+\.\d+[a-z]?\+$/.test(entry.tmux)) problems.push('writes the tmux version unlike 3.8+')
  return problems
}

export interface ShownCapability {
  id: CapabilityId
  label: string
  code: string
  lang: string
  file: string
  sourceUrl: string
  ci: CapabilityEntry['ci']
  tmux?: string
}

type Cache = Readonly<Record<string, CachedSource | undefined>>

/** The capabilities a port shows, in order. An unresolvable anchor or missing cache throws. */
export function portCapabilities(owner: string, table: CapabilityTable, cache: Cache): ShownCapability[] {
  return CAPABILITIES.flatMap(({ id, label }): ShownCapability[] => {
    const entry = table[owner]?.[id]
    if (!entry) return []
    const problems = validateCapability(entry)
    if (problems.length) throw new Error(`core-capabilities: ${owner}/${id} ${problems.join('; ')}`)
    const key = capabilityCacheKey(owner, entry.file)
    const cached = cache[key]
    if (!cached) throw new Error(`core-capabilities: ${key} is not in the example cache; run node scripts/gen-example-sources.mjs`)
    const ranges = [{ from: entry.from, to: entry.to }, ...(entry.more ?? [])]
    return [{
      id, label, lang: entry.lang, file: entry.file, ci: entry.ci,
      code: ranges.map((range) => sliceExcerpt(cached.content, range, key)).join('\n\n'),
      sourceUrl: `https://github.com/${cached.repository}/blob/${cached.revision}/${entry.file}`,
      ...(entry.tmux ? { tmux: entry.tmux } : {}),
    }]
  })
}

/**
 * Whether the workflow's job holds a step that matches: the step's name when it
 * has one, its working directory, and a `run` that holds the command. A command
 * that only appears in another step or job does not count.
 */
export function workflowStep(workflow: string, ci: CapabilityEntry['ci']): boolean {
  const lines = workflow.replaceAll('\r', '').split('\n')
  const start = lines.findIndex((line) => stripComment(line).trimEnd() === `  ${ci.job}:`)
  if (start < 0) return false
  let end = lines.findIndex((line, index) => index > start && /^ {0,2}[^\s#]/.test(line))
  if (end < 0) end = lines.length
  const job = lines.slice(start + 1, end)
  // A job that may not run, or may fail without failing the workflow, proves nothing.
  if (job.some((line) => /^ {4}(?:if|continue-on-error):/.test(line) && !/continue-on-error:\s*false/.test(line))) return false
  const first = job.findIndex((line) => /^\s*steps:\s*$/.test(line))
  if (first < 0) return false
  const body = job.slice(first + 1)
  const indent = /^(\s*)-\s/.exec(body.find((line) => /^\s*-\s/.test(line)) ?? '')?.[1]
  if (indent === undefined) return false
  const steps: string[][] = []
  for (const line of body) {
    if (line.startsWith(`${indent}- `)) steps.push([line])
    else if (steps.length) steps.at(-1)!.push(line)
  }
  const unquote = (value: string) => stripComment(value).trim().replace(/^(['"])(.*)\1$/, '$2')
  // A key of the step itself, not one nested under `with:` or `env:`.
  const key = (step: string[], name: string) => step.map((line) =>
    new RegExp(`^${indent}(?:- | {2})${name}:\\s*(.+)$`).exec(line)?.[1]).find((value) => value !== undefined)
  return steps.some((step) => {
    const stepName = key(step, 'name')
    const directory = key(step, 'working-directory')
    const guard = key(step, 'if')
    const tolerated = key(step, 'continue-on-error')
    return guard === undefined && (tolerated === undefined || unquote(tolerated) === 'false')
      && (ci.step === undefined || (stepName !== undefined && unquote(stepName) === ci.step))
      && (directory === undefined ? ci.directory === undefined : unquote(directory) === ci.directory)
      && runsCommand(step, ci.command)
  })
}

const stripComment = (value: string) => value.replace(/\s+#.*$/, '')

/** Whether a step's `run` holds the command as whole commands, not as a prefix of another or inside a string. */
function runsCommand(step: string[], command: string): boolean {
  if (!workflowRuns(step.join('\n'), command)) return false
  const flat = (text: string) => text.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim()
  const wanted = flat(command)
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const runs = step.join('\n').split('\n').flatMap((line, index, all) => {
    const m = /^\s*(?:-\s+)?run:[ \t]*(.*)$/.exec(line)
    if (!m) return []
    const text = /^[|>][+-]?\d*$/.test(m[1]!.trim()) ? [] : [m[1]!]
    const column = /^\s*/.exec(line)![0].length
    for (const next of all.slice(index + 1)) {
      if (next.trim() && /^\s*/.exec(next)![0].length <= column) break
      text.push(next)
    }
    const kept = text.filter((part) => !part.trim().startsWith('#')).join('\n')
    // A block scalar's lines are separate commands; a folded one is a single line.
    return [flat(kept), ...kept.replace(/\\\n/g, ' ').split('\n').map((part) => flat(part))]
  })
  return runs.some((run) => new RegExp(`(?:^|&& |; |\\|\\| )${escaped}(?: &&|;| \\||$| -)`).test(run) || run === wanted)
}

export { workflowRuns }
