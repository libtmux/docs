#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const loop = process.argv[2]
const budget = { inner: 2, medium: 10, outer: 60 }[loop]
if (!budget) throw new Error('Usage: test-loop.mjs inner|medium|outer')
const started = performance.now()
const vitest = 'site/node_modules/vitest/vitest.mjs'
const children = new Set()
const stoppingGroups = new Set()
const pending = []
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
  stop()
  setTimeout(() => stop('SIGKILL'), 500).unref()
}
const deadline = setTimeout(cancel, budget * 1000)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, cancel)

function run(command, args) {
  if (cancelled) throw new Error(`${loop} cancelled or exceeded ${budget}s`)
  const promise = new Promise((resolve, reject) => {
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
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')}: ${signal ?? code}`))
    })
  })
  pending.push(promise)
  return promise
}
const node = (...args) => run(process.execPath, args)
const pnpm = (...args) => {
  const entry = process.env.npm_execpath ?? 'pnpm'
  return /\.[cm]?js$/.test(entry) ? node(entry, ...args) : run(entry, args)
}
const tests = (directory, names = []) => node(vitest, 'run', '--root', directory,
  ...names.map((name) => `test/${name}.test.ts`))

try {
  const checks = loop === 'inner' ? [
    tests('packages/api-model', ['concepts', 'resolver', 'mentions']),
    tests('site', ['native-switchers', 'normalize-native-shell']),
  ] : ['packages/api-model', 'packages/theme', 'site'].map((directory) => tests(directory))
  if (loop !== 'inner') checks.push(
    pnpm('run', '--recursive', 'lint'),
    pnpm('exec', 'oxlint', 'scripts'),
    node('scripts/gen-mentions.mjs', '--check'),
    node('scripts/gen-shell-ports.mjs', '--check'),
  )
  if (loop === 'outer') checks.push(pnpm('run', '--recursive', 'type-check'))
  await Promise.all(checks)
  // Astro check and dev both write .astro; keep their lifetimes separate.
  if (loop === 'outer') await node('site/scripts/check-dev.mjs')
  const elapsed = (performance.now() - started) / 1000
  if (cancelled || elapsed >= budget) throw new Error(`${loop} cancelled or exceeded ${budget}s: ${elapsed.toFixed(2)}s`)
  console.log(`${loop}: PASS in ${elapsed.toFixed(2)}s (budget <${budget}s; publication audit excluded)`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  if (children.size || stoppingGroups.size) {
    stop()
    await new Promise((resolve) => setTimeout(() => {
      stop('SIGKILL')
      resolve()
    }, 500))
  }
  await Promise.allSettled(pending)
}
