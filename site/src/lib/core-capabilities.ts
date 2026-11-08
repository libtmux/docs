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
import { landingCacheKey, workflowRuns, type CachedSource, type LandingCi } from './port-landing.ts'

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
  { id: 'typed-values', label: 'Validate tmux IDs, dimensions and releases' },
] as const
export type CapabilityId = (typeof CAPABILITIES)[number]['id']

/** One thing the port's tests assert or its runner does with the result. */
export interface ExitEvidence {
  /** A file in the port repository, cached with the example sources. */
  file: string
  /** Text the file holds; the check that the program or test fails when the result is wrong. */
  contains: string
}

export interface CapabilityEntry {
  file: string
  lang: string
  /** Excerpt anchors. A showcase entry is a whole program, so a recorded anchor is refused. */
  from?: string
  to?: string
  more?: readonly unknown[]
  ci: LandingCi & {
    /** The workflow job's key. */
    job: string
    /** The step's name, absent when the step has none. */
    step?: string
    /** The step's working directory, absent for the repository root. */
    directory?: string
    /** What the caption names instead, when the directory is a template. */
    where?: string
    /**
     * The output of a job this one needs that gates it, such as `run_cells`
     * for `needs.plan.outputs.run_cells == 'true'`. It is the only job-level
     * `if` the check accepts, and the plan job must publish it from a step.
     */
    planOutput?: string
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
  if (entry.from !== undefined || entry.to !== undefined || entry.more !== undefined) problems.push('quotes an excerpt; a showcase entry is a whole program')
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(entry.ci?.workflow ?? '')) problems.push('names no workflow')
  if (!entry.ci?.command?.trim()) problems.push('names no CI command')
  if (!entry.ci?.job?.trim()) problems.push('names no CI job')
  if (!entry.checkedBy?.length) problems.push('records no evidence that the exit status or output is checked')
  for (const item of entry.checkedBy ?? []) if (!item.file || !item.contains?.trim()) problems.push('records evidence with no file or text')
  if (entry.tmux !== undefined && !/^\d+\.\d+[a-z]?\+$/.test(entry.tmux)) problems.push('writes the tmux version unlike 3.8+')
  if (entry.ci?.planOutput !== undefined && !/^[A-Za-z_][\w-]*$/.test(entry.ci.planOutput)) problems.push('names a plan output that is not a workflow output name')
  return problems
}

/** The most lines a whole program may run; the page shows the file in full. */
export const MAX_PROGRAM_LINES = 150

/**
 * What a reader needs to paste a program and build it: its imports and its
 * entry point, with no helper module of the repository. Empty when the file
 * qualifies. The check is per language; a language with no rule here has no
 * entry, so a new port must say what makes its program complete.
 */
export function programProblems(lang: string, content: string): string[] {
  const rules: Record<string, { imports: RegExp; entry: RegExp; local?: RegExp }> = {
    rust: { imports: /^use /m, entry: /^(?:async )?fn main\(|^(?:#\[[^\]]+\]\s*)+(?:async )?fn main\(/m },
    go: { imports: /^import[ (]/m, entry: /^func main\(\)/m },
    // A port may indent its require inside the begin block so excerpts of that block carry it.
    ruby: { imports: /^[ \t]*require ["']/m, entry: /^(?:begin\b|[A-Za-z_][\w:]*[.(]|[A-Za-z_]\w* = )/m, local: /require_relative|Example\./ },
    typescript: { imports: /^import /m, entry: /^(?:await |void |main\()|^(?:async )?function main\(/m },
  }
  const rule = rules[lang]
  if (!rule) return [`has no completeness rule for ${lang}`]
  const problems: string[] = []
  if (!rule.imports.test(content)) problems.push('has no import lines')
  if (!rule.entry.test(content)) problems.push('has no entry point')
  if (rule.local?.test(content)) problems.push('uses a helper of the repository')
  if (content.trimEnd().split('\n').length > MAX_PROGRAM_LINES) problems.push(`runs past ${MAX_PROGRAM_LINES} lines`)
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
    const incomplete = programProblems(entry.lang, cached.content)
    if (incomplete.length) throw new Error(`core-capabilities: ${owner}/${id} ${incomplete.join('; ')}`)
    return [{
      id, label, lang: entry.lang, file: entry.file, ci: entry.ci,
      code: cached.content.replace(/\n$/, ''),
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
  const job = jobLines(lines, ci.job)
  if (!job) return false
  // A job that may not run, or may fail without failing the workflow, proves nothing.
  if (job.some((line) => mayNotRun(line) && !plannedRun(lines, job, line, ci))) return false
  const parsed = jobSteps(job)
  if (!parsed) return false
  const { indent, steps } = parsed
  return steps.some((step) => {
    const stepName = stepKey(indent, step, 'name')
    const directory = stepKey(indent, step, 'working-directory')
    return !mayNotRunStep(indent, step)
      && (ci.step === undefined || (stepName !== undefined && unquote(stepName) === ci.step))
      && (directory === undefined ? ci.directory === undefined : unquote(directory) === ci.directory)
      && runsCommand(step, ci.command)
  })
}

const stripComment = (value: string) => value.replace(/\s+#.*$/, '')
const unquote = (value: string) => stripComment(value).trim().replace(/^(['"])(.*)\1$/, '$2')

/** A job-level line that lets the job skip or fail quietly: any `if`, and any `continue-on-error` but false. */
const mayNotRun = (line: string) => /^ {4}(?:if|continue-on-error):/.test(line)
  && !(/^ {4}continue-on-error:/.test(line) && unquote(line.replace(/^ {4}continue-on-error:/, '')) === 'false')

/** The lines under a top-level job's key, or undefined when the workflow has no such job. */
function jobLines(lines: string[], name: string): string[] | undefined {
  const start = lines.findIndex((line) => stripComment(line).trimEnd() === `  ${name}:`)
  if (start < 0) return undefined
  let end = lines.findIndex((line, index) => index > start && /^ {0,2}[^\s#]/.test(line))
  if (end < 0) end = lines.length
  return lines.slice(start + 1, end)
}

/** A job's steps, each as its lines, and the indent their `- ` starts at; undefined when the job has none. */
function jobSteps(job: string[]): { indent: string, steps: string[][] } | undefined {
  const first = job.findIndex((line) => /^\s*steps:\s*$/.test(line))
  if (first < 0) return undefined
  const body = job.slice(first + 1)
  const indent = /^(\s*)-\s/.exec(body.find((line) => /^\s*-\s/.test(line)) ?? '')?.[1]
  if (indent === undefined) return undefined
  const steps: string[][] = []
  for (const line of body) {
    if (line.startsWith(`${indent}- `)) steps.push([line])
    else if (steps.length) steps.at(-1)!.push(line)
  }
  return { indent, steps }
}

/** A key of the step itself, not one nested under `with:` or `env:`. */
const stepKey = (indent: string, step: string[], name: string) => step.map((line) =>
  new RegExp(`^${indent}(?:- | {2})${name}:\\s*(.+)$`).exec(line)?.[1]).find((value) => value !== undefined)

/** Whether a step carries a condition, or may fail without failing the job. */
function mayNotRunStep(indent: string, step: string[]): boolean {
  const tolerated = stepKey(indent, step, 'continue-on-error')
  return stepKey(indent, step, 'if') !== undefined || (tolerated !== undefined && unquote(tolerated) !== 'false')
}

/**
 * The jobs a job lists in `needs`: `needs: a`, a flow list `needs: [a, b]`, which may wrap onto
 * further lines up to its closing bracket, or a block list of `- a` lines. A comment names nothing.
 */
function neededJobs(job: string[]): string[] {
  const needs = job.findIndex((line) => /^ {4}needs:/.test(line))
  if (needs < 0) return []
  const first = stripComment(job[needs]!.replace(/^ {4}needs:/, ''))
  const after = job.slice(needs + 1)
  const wrapped = first.includes('[') && !first.includes(']')
  // A wrapped flow list ends with the line that closes it, a block list before its first line that is not an item.
  const stop = (found: number) => (found < 0 ? after.length : found)
  const items = wrapped
    ? after.slice(0, stop(after.findIndex((line) => stripComment(line).includes(']'))) + 1)
    : after.slice(0, stop(after.findIndex((line) => !/^ {6}- |^\s*(?:#|$)/.test(line))))
  return [first, ...items].map((line) => stripComment(line).replace(/^\s*-\s+/, '')).join(' ').split(/[\s,[\]]+/).filter(Boolean)
}

/** Whether a job runs whenever the workflow does: no `if`, no tolerated failure, and every job it needs the same. */
function alwaysRuns(lines: string[], name: string, path: ReadonlySet<string>): boolean {
  const body = path.has(name) ? undefined : jobLines(lines, name)
  return body !== undefined && !body.some(mayNotRun)
    && neededJobs(body).every((next) => alwaysRuns(lines, next, new Set([...path, name])))
}

/**
 * Whether a job-level `if` only asks the plan whether the workflow has cells
 * to run. The entry names the flag (`ci.planOutput`). The condition must be
 * `needs.<plan>.outputs.<flag> == 'true'`, where `<plan>` is a job this one
 * lists in `needs`, and that job must have no `needs`, `if` or
 * `continue-on-error` of its own and publish `<flag>` as
 * `${{ steps.<id>.outputs.<flag> }}` of a step that has no condition. A plan
 * that can be skipped, or whose flag is not read from a step, can leave the
 * job unrun. So can any other job it needs that has an `if`, is tolerated or
 * needs such a job. Any other condition proves nothing either.
 */
function plannedRun(lines: string[], job: string[], condition: string, ci: CapabilityEntry['ci']): boolean {
  const flag = ci.planOutput
  if (!flag || !/^[A-Za-z_][\w-]*$/.test(flag)) return false
  const match = /^ {4}if:\s*['"]?\$?\{?\{?\s*needs\.([\w-]+)\.outputs\.([\w-]+)\s*==\s*'true'\s*\}?\}?['"]?$/.exec(stripComment(condition).trimEnd())
  if (!match || match[2] !== flag) return false
  const plan = match[1]!
  const listed = neededJobs(job)
  if (!listed.includes(plan) || plan === ci.job) return false
  if (!listed.filter((name) => name !== plan).every((name) => alwaysRuns(lines, name, new Set([ci.job])))) return false
  const planned = jobLines(lines, plan)
  if (!planned || planned.some((line) => /^ {4}needs:/.test(line) || mayNotRun(line))) return false
  const outputs = planned.findIndex((line) => /^ {4}outputs:\s*$/.test(line))
  if (outputs < 0) return false
  const block = planned.slice(outputs + 1)
  const blockEnd = block.findIndex((line) => !/^ {6}\S/.test(line))
  const published = block.slice(0, blockEnd < 0 ? undefined : blockEnd)
    .map((line) => new RegExp(`^ {6}${flag}:\\s*(.+)$`).exec(stripComment(line))?.[1])
    .find((value) => value !== undefined)
  const stepId = published === undefined ? undefined : new RegExp(`^\\$\\{\\{\\s*steps\\.([\\w-]+)\\.outputs\\.${flag}\\s*\\}\\}$`).exec(unquote(published))?.[1]
  if (!stepId) return false
  const parsed = jobSteps(planned)
  return parsed !== undefined && parsed.steps.some((step) => {
    const id = stepKey(parsed.indent, step, 'id')
    return id !== undefined && unquote(id) === stepId && !mayNotRunStep(parsed.indent, step)
  })
}

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
  return runs.some((run) => new RegExp(`(?:^|&& |; )${escaped}(?: &&|;|$| -)`).test(run) || run === wanted)
}

export { workflowRuns }
