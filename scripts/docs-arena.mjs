#!/usr/bin/env node
/*
 * Run the port examples these docs quote against a tmux server this script
 * owns, through each port's arena adapter, then prove every adapter fails
 * closed when its contract is incomplete.
 *
 * A port runs when its `tmux-arena` worktree and toolchain are present. One
 * without them is reported as not run, never as passed; `--require` turns
 * that into a failure. It starts with the quote coverage: which quoted
 * sources an arena artifact executes, and which have no adapter yet.
 *
 * Usage: node scripts/docs-arena.mjs [--port <slug>]... [--require] [--no-prepare]
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import sources from '../site/src/data/example-sources.json' with { type: 'json' }
import { ARTIFACTS, arenaWorktree } from './arena/artifacts.mjs'
import { ArenaFailure, resolveTmux, runFailClosed, runInArena } from './arena/supervisor.mjs'

const argv = process.argv.slice(2)
const only = new Set(argv.flatMap((arg, index) => (argv[index - 1] === '--port' ? [arg] : [])))
const requireAll = argv.includes('--require')
const prepare = !argv.includes('--no-prepare')

const onPath = (tool) => (process.env.PATH ?? '').split(delimiter).filter(Boolean).some((dir) => {
  try {
    accessSync(join(dir, tool), constants.X_OK)
    return true
  } catch {
    return false
  }
})

function step(worktree, { cwd, command }) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: resolve(worktree, cwd), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`.trim()
    throw new ArenaFailure(`preparing failed: ${command.join(' ')}\n${output.slice(-2000)}`)
  }
}

// Coverage has two kinds of key and they can never match each other. A quoted
// file is `slug:path`, recorded by gen-example-sources when a page fences it.
// A doctest page is `slug:page:path`: there the page is the executable unit,
// and it lives in the port's own documentation tree, which gen-example-sources
// never scans. Counted in one bucket, a page looked like a quoted file nothing
// quoted, and a file the arena runs but no page shows looked like coverage.
const isPage = (key) => key.split(':')[1] === 'page'
const executed = new Set(ARTIFACTS.flatMap((entry) => entry.runs))
const executedFiles = [...executed].filter((key) => !isPage(key))
const executedPages = [...executed].filter(isPage).sort()
const runFiles = new Set(executedFiles)
const quoted = Object.keys(sources).sort()
console.log(`quoted and run in the arena: ${quoted.filter((key) => runFiles.has(key)).join(', ') || 'none'}`)
console.log(`quoted with no arena adapter yet: ${quoted.filter((key) => !runFiles.has(key)).join(', ') || 'none'}`)
console.log(`run in the arena but quoted by no page: ${executedFiles.filter((key) => !Object.hasOwn(sources, key)).sort().join(', ') || 'none'}`)
console.log(`pages run in the arena: ${executedPages.join(', ') || 'none'}`)

let tmuxBin
let tmuxProblem
try {
  tmuxBin = resolveTmux()
} catch (error) {
  tmuxProblem = error.message
}

const results = []
for (const entry of ARTIFACTS) {
  if (only.size && !only.has(entry.slug)) continue
  const worktree = arenaWorktree(entry.slug)
  const absent = tmuxProblem
    ?? (existsSync(worktree) ? undefined : `no tmux-arena worktree at ${worktree}`)
    ?? entry.tools.filter((tool) => !onPath(tool)).map((tool) => `${tool} is not on PATH`)[0]
  if (absent) {
    results.push({ slug: entry.slug, status: 'not run', detail: absent })
    continue
  }
  const build = join(tmpdir(), 'libtmux-docs-arena', entry.slug)
  mkdirSync(build, { recursive: true })
  try {
    if (prepare) for (const buildStep of entry.prepare(build)) step(worktree, buildStep)
    const { cwd, command } = entry.run(build)
    const target = { tmuxBin, artifact: entry.artifact, command, cwd: resolve(worktree, cwd) }
    const evidence = await runInArena(target)
    await runFailClosed(target)
    results.push({ slug: entry.slug, status: 'pass', detail: `${entry.artifact} reached server ${evidence.server_pid}; failed closed without its socket` })
  } catch (error) {
    if (!(error instanceof ArenaFailure)) throw error
    results.push({ slug: entry.slug, status: 'fail', detail: `${entry.artifact}: ${error.message}` })
  }
}

for (const { slug, status, detail } of results) console.log(`${status.padEnd(7)} ${slug.padEnd(6)} ${detail}`)
const count = (status) => results.filter((result) => result.status === status).map((result) => result.slug)
const notRun = count('not run')
console.log(`docs arena: passed ${count('pass').join(', ') || 'none'}; failed ${count('fail').join(', ') || 'none'}; not run: ${notRun.join(', ') || 'none'}`)
if (count('fail').length || (requireAll && notRun.length)) process.exitCode = 1
