#!/usr/bin/env node
/*
 * Every stage of the publication audit has a job in test.yml, and the `test`
 * job answers for all of them.
 *
 * The audit in scripts/test-all.sh is split into stages, one `# stage: NAME`
 * marker above the guard that selects it, and CI runs each stage as its own
 * job. Splitting made a new way to lose a check without any step failing: a
 * job renamed, dropped, pointed at another stage, or left out of the `test`
 * job's needs, and every remaining job still passes. This reads both files and
 * fails when:
 *
 *   - a check in test-all.sh sits outside every stage, or a marker has no
 *     guard, or the `--stage` option does not accept exactly the markers;
 *   - no job in test.yml runs `--stage NAME` for a stage, counting only a
 *     `run:` command that starts with the audit (a comment, an `echo` or a
 *     `false &&` before it does not count);
 *   - a job that runs a stage can be skipped: its `if:` must be absent or one
 *     of the exact expressions its stage allows (a preview-only stage may be
 *     limited to pull requests; a job that waits on others must say
 *     `!cancelled()` and require each of them), the step that runs it has an
 *     `if:`, or either continues on error;
 *   - the `test` job does not need every such job or does not run after a
 *     failure.
 *
 * It reads which job names which stage. It cannot prove the command runs, so
 * the workflow tests in site/test/deploy-workflow.test.ts pin the steps.
 *
 * Usage: node scripts/check-ci-coverage.mjs [--audit FILE] [--workflow FILE]
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : process.argv[at + 1]
}
const auditPath = option('--audit', join(root, 'scripts/test-all.sh'))
const workflowPath = option('--workflow', join(root, '.github/workflows/test.yml'))

/** The stages of test-all.sh in order, each with the checks it holds. */
function stagesOf(text, problems) {
  const lines = text.split('\n')
  const stages = []
  lines.forEach((line, index) => {
    const marker = /^# stage: (\w+)$/.exec(line)
    if (marker) {
      const guard = lines.slice(index + 1, index + 3).find((next) => next.includes(`stage_wanted ${marker[1]}`))
      if (!guard) problems.push(`stage "${marker[1]}" in ${auditPath} has no \`stage_wanted ${marker[1]}\` guard under its marker`)
      stages.push({ name: marker[1], steps: [], previewOnly: Boolean(guard?.includes('"$preview"')) })
      return
    }
    const step = /^\s*step '([^']+)'\s*$/.exec(line)
    if (!step) return
    if (stages.length === 0) problems.push(`check "${step[1]}" in ${auditPath} comes before the first \`# stage:\` marker, so no job is known to run it`)
    else stages.at(-1).steps.push(step[1])
  })
  const accepted = /--stage\)\s*\n\s*\[\[ "\$\{2:-\}" =~ \^\(([^)]*)\)\$ \]\]/.exec(text)?.[1]
  if (accepted?.split('|').join() !== stages.map((stage) => stage.name).join()) {
    problems.push(`\`--stage\` accepts ${accepted ?? 'nothing readable'}, not the markers ${stages.map((stage) => stage.name).join('|')}`)
  }
  return stages
}

/** A line without its comment: a full-line one, or one after whitespace outside quotes. */
function uncommented(line) {
  let quote = ''
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#' && (at === 0 || /\s/.test(line[at - 1]))) return line.slice(0, at).trimEnd()
  }
  return line
}

/** The lines of a key's value: the inline text, or the block scalar beneath it. */
function valueLines(lines, indent, name) {
  const prefix = `${' '.repeat(indent)}${name}:`
  const at = lines.findIndex((line) => line.startsWith(prefix))
  if (at === -1) return undefined
  const inline = lines[at].slice(prefix.length).trim()
  if (!/^[>|]/.test(inline)) return [inline]
  const block = []
  for (const next of lines.slice(at + 1)) {
    if (next.trim() !== '' && !next.startsWith(' '.repeat(indent + 2))) break
    block.push(next)
  }
  return block
}
const normalised = (lines) => lines?.map((line) => line.trim()).join(' ').trim().replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\s+/g, ' ')

/** The steps of a job body, each re-indented so its keys sit at eight spaces. */
function stepsOf(body) {
  const from = body.findIndex((line) => line === '    steps:')
  const steps = []
  for (const line of from === -1 ? [] : body.slice(from + 1)) {
    if (/^ {6}- /.test(line)) steps.push([line.replace(/^ {6}- /, '        ')])
    else steps.at(-1)?.push(line)
  }
  return steps
}

/** The jobs of a workflow file: id, `needs`, `if`, and the commands each step runs. */
function jobsOf(text) {
  const lines = text.split('\n')
  const start = lines.indexOf('jobs:')
  if (start === -1) return []
  const jobs = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (key) jobs.push({ id: key[1], lines: [] })
    else if (!/^\s*#/.test(line)) jobs.at(-1)?.lines.push(uncommented(line))
  }
  return jobs.map(({ id, lines: body }) => {
    const needs = normalised(valueLines(body, 4, 'needs'))
    return {
      id,
      text: body.join('\n'),
      condition: normalised(valueLines(body, 4, 'if')),
      needs: needs === undefined ? [] : needs.replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean),
      steps: stepsOf(body).map((step) => ({
        text: step.join('\n'),
        condition: normalised(valueLines(step, 8, 'if')),
        commands: (valueLines(step, 8, 'run') ?? []).map(uncommented),
      })),
    }
  })
}

const problems = []
const stages = stagesOf(readFileSync(auditPath, 'utf8'), problems)
const jobs = jobsOf(readFileSync(workflowPath, 'utf8'))
const running = new Map(stages.map((stage) => [stage.name, []]))
const audit = /^\s*(?:pnpm test:publication|(?:bash )?(?:\.\/)?scripts\/test-all\.sh)\b.*?--stage\s+(\w+)/
for (const job of jobs) {
  const named = new Map()
  for (const step of job.steps) {
    for (const command of step.commands) {
      const name = audit.exec(command)?.[1]
      if (name) named.set(name, step)
    }
  }
  for (const [name, step] of named) {
    if (!running.has(name)) {
      problems.push(`job "${job.id}" runs \`--stage ${name}\`, which test-all.sh does not define`)
      continue
    }
    running.get(name).push(job)
    if (step.condition !== undefined) problems.push(`job "${job.id}" runs \`--stage ${name}\` in a step that can skip it: \`if: ${step.condition}\``)
  }
}
const previewJobs = new Set(stages.filter((stage) => stage.previewOnly).flatMap((stage) => running.get(stage.name).map((job) => job.id)))

const aggregator = jobs.find((job) => job.id === 'test')
if (!aggregator) problems.push('test.yml has no `test` job to answer for the stages')
else if (aggregator.condition !== '!cancelled()') {
  problems.push(`the \`test\` job has \`if: ${aggregator.condition ?? ''}\`, not \`!cancelled()\`, so a failed or skipped audit could skip it and leave no red check`)
}

for (const stage of stages) {
  const owners = running.get(stage.name)
  if (owners.length === 0) {
    problems.push(`no job in test.yml runs \`--stage ${stage.name}\`, so ${stage.steps.length ? stage.steps.map((step) => `"${step}"`).join(', ') : 'its checks'} never run`)
  }
  for (const job of owners) {
    const allowed = ['', ...(stage.previewOnly ? ["github.event_name == 'pull_request'"] : [])]
    if (job.needs.length > 0) {
      allowed.push(['!cancelled()', ...job.needs.map((need) => previewJobs.has(need)
        ? `(needs.${need}.result == 'success' || github.event_name != 'pull_request')`
        : `needs.${need}.result == 'success'`)].join(' && '))
    }
    if (!allowed.includes(job.condition ?? '')) {
      problems.push(`job "${job.id}" runs \`--stage ${stage.name}\` but can skip it: \`if: ${job.condition ?? ''}\` is not one of ${allowed.map((condition) => (condition === '' ? 'no `if:`' : `\`${condition}\``)).join(', ')}`)
    }
    if (/continue-on-error/.test(job.text)) problems.push(`job "${job.id}" runs \`--stage ${stage.name}\` with continue-on-error`)
    if (aggregator && !aggregator.needs.includes(job.id)) {
      problems.push(`the \`test\` job does not need "${job.id}", which runs \`--stage ${stage.name}\``)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-ci-coverage: ${problem}`)
  process.exit(1)
}
console.log(`check-ci-coverage: ${stages.length} stages, each run by a job the test job needs`)
