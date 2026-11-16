#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { cpuBudget } from './lib/cpu-budget.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Reuse child-process compilation without changing per-file test isolation.
process.env.NODE_COMPILE_CACHE ??= fileURLToPath(new URL('../node_modules/.cache/node-compile', import.meta.url))
const loop = process.argv[2]
const budget = { inner: 2, medium: 10, outer: 60 }[loop]
if (!budget) throw new Error('Usage: test-loop.mjs inner|medium|outer')
const tiers = JSON.parse(readFileSync(new URL('./test-tiers.json', import.meta.url), 'utf8'))
const listed = Object.values(tiers).flatMap((groups) => groups.flatMap((group) => group.files))
if (new Set(listed).size !== listed.length || listed.some((file) => !existsSync(new URL(`../${file}`, import.meta.url)))) {
  throw new Error('test-tiers.json contains duplicate or missing suites')
}
const excluded = (tier, directory) => (tiers[tier] ?? []).flatMap((group) => group.files)
  .filter((file) => file.startsWith(`${directory}/`)).map((file) => file.slice(directory.length + 1))
const started = performance.now()
const vitest = 'site/node_modules/vitest/vitest.mjs'
const children = new Set()
const stoppingGroups = new Set()
const pending = []
// Node reads the cgroup CPU quota, so a limited job gets its own share and not the host's.
const cpus = availableParallelism()
const cpuSlots = cpuBudget(cpus)
let cancelled = false
const stop = (signal = 'SIGTERM') => {
  for (const child of children) if (child.pid) stoppingGroups.add(child.pid)
  for (const pid of stoppingGroups) {
    try { process.kill(-pid, signal) } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
const cancel = () => {
  cancelled = true
  cpuSlots.cancel(new Error(`${loop} cancelled or exceeded ${budget}s`))
  stop()
  setTimeout(() => stop('SIGKILL'), 500).unref()
}
const deadline = setTimeout(cancel, budget * 1000)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, cancel)

function run(command, args, cost = 1) {
  if (cancelled) throw new Error(`${loop} cancelled or exceeded ${budget}s`)
  const promise = cpuSlots.run(cost, () => new Promise((resolve, reject) => {
    const taskStarted = performance.now()
    const child = spawn(command, args, {
      cwd: root, stdio: 'inherit', detached: true,
      env: { ...process.env, LIBTMUX_DOCS_TEST_SOURCE_ONLY: '1' },
    })
    children.add(child)
    child.on('error', (error) => {
      children.delete(child)
      reject(error)
    })
    child.on('close', (code, signal) => {
      children.delete(child)
      if (process.env.LIBTMUX_DOCS_LOOP_TIMINGS) console.error(`loop timing ${(performance.now() - taskStarted).toFixed(0)}ms: ${command} ${args.join(' ')}`)
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')}: ${signal ?? code}`))
    })
  }))
  pending.push(promise)
  return promise
}
const node = (...args) => run(process.execPath, args)
const pnpm = (...args) => {
  const entry = process.env.npm_execpath ?? 'pnpm'
  return /\.[cm]?js$/.test(entry) ? node(entry, ...args) : run(entry, args)
}
// A suite keeps one CPU busy per worker, and never more workers than the job has CPUs.
const tests = (directory, names = []) => {
  const workers = Math.min(directory === 'site' ? 6 : directory === 'packages/api-model' ? 4 : 2, cpus)
  return run(process.execPath, [vitest, 'run', '--root', directory,
    '--maxWorkers', String(workers), '--pool', 'threads', '--fsModuleCache',
    ...((loop === 'medium' ? ['**/*.outer.test.ts', ...excluded('outer', directory)] : [])
      .concat(['**/*.publication.test.ts', ...excluded('publication', directory)])
      .flatMap((pattern) => ['--exclude', pattern])),
    ...names.map((name) => `test/${name}.test.ts`)], names.length ? Math.min(workers, names.length) : workers)
}

try {
  if (loop !== 'inner') await node('scripts/stage-port-docs.mjs', '--integrated')
  // Checks start in this order as CPUs free up: short ones first, the long site suite, type checks and browser last.
  const checks = loop === 'inner' ? [
    tests('packages/api-model', ['concepts', 'resolver', 'mentions']),
    tests('site', ['native-switchers', 'native-shell-context', 'normalize-native-shell']),
  ] : [tests('packages/api-model'), tests('packages/theme')]
  if (loop !== 'inner') checks.push(
    pnpm('run', '--recursive', 'lint'),
    pnpm('exec', 'oxlint', 'scripts'),
    pnpm('run', 'lint:python'),
    node('scripts/check-api-links.mjs'),
    node('scripts/check-nav.mjs'),
    node('scripts/check-example-blocks.mjs'),
    node('scripts/gen-mentions.mjs', '--check'),
    node('scripts/gen-workspace-entities.mjs', '--check'),
    node('scripts/gen-workspace-showcase.mjs', '--check'),
    node('scripts/gen-product-copy.mjs', '--check'),
    node('scripts/gen-tmux-catalog.mjs', '--check'),
    node('scripts/gen-tmux-usage.mjs', '--check'),
    node('scripts/gen-shell-ports.mjs', '--check'),
    node('scripts/gen-brand-css.mjs', '--check'),
  )
  // Adversarial CLI fixtures spawn subprocesses and temporary Git repositories; keep them in outer.
  if (loop === 'outer') checks.push(
    node('scripts/check-example-blocks.negative.mjs'),
    node('scripts/gen-workspace-showcase.negative.mjs'),
    node('scripts/gen-product-copy.negative.mjs'),
    node('scripts/gen-example-sources.mjs', '--check'),
  )
  if (loop !== 'inner') checks.push(tests('site'))
  if (loop === 'outer') checks.push(
    pnpm('run', '--recursive', 'type-check'),
    pnpm('run', 'type-check:python'),
    node('site/scripts/check-dev.mjs', '--sample'),
  )
  await Promise.all(checks)
  const elapsed = (performance.now() - started) / 1000
  if (cancelled || elapsed >= budget) throw new Error(`${loop} cancelled or exceeded ${budget}s: ${elapsed.toFixed(2)}s`)
  console.log(`${loop}: PASS in ${elapsed.toFixed(2)}s (budget <${budget}s; publication audit excluded)`)
} catch (error) {
  console.error(cancelled ? `${loop} cancelled or exceeded ${budget}s: ${((performance.now() - started) / 1000).toFixed(2)}s` : error.message)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  cpuSlots.cancel(new Error(`${loop} stopped`))
  if (children.size || stoppingGroups.size) {
    stop()
    await new Promise((resolve) => setTimeout(() => {
      stop('SIGKILL')
      resolve()
    }, 500))
  }
  await Promise.allSettled(pending)
}
