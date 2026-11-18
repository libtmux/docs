#!/usr/bin/env node
/**
 * The library call a tool page says its tool makes, checked against the line it cites.
 *
 * `site/src/data/mcp-wraps.json` records, by hand, the library call an MCP tool
 * makes and the line of the server's source that makes it. The tool page links
 * that line at the revision of the port's MCP snapshot. Nothing else reads the
 * source behind the entry, so a line number that is wrong, or that moves when
 * the revision does, reads as proof and proves nothing.
 *
 * Each port is read from its checkout (`LIBTMUX_DOCS_CHECKOUT_<PORT>`, else its
 * worktree, else its standard checkout). A port with no checkout, or whose
 * checkout lacks the revision, is reported as skipped, not as passing.
 *
 * Usage: node scripts/check-mcp-wraps.mjs [--port go]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { checkoutCandidates } from './lib/port-checkout.mjs'
import { wrapsProblems } from './lib/mcp-wraps.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const only = option('--port')
const data = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const wraps = data('site/src/data/mcp-wraps.json')
const matrix = data('site/src/data/mcp-tools.json')

const git = (checkout, ...args) => {
  try {
    return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

let failed = 0
const skipped = []
for (const [slug, entry] of Object.entries(wraps)) {
  if (only && only !== slug) continue
  const snapshot = matrix.ports[slug]
  const problems = []
  if (!snapshot) problems.push(`${slug}: no MCP snapshot for the port`)
  else {
    if (snapshot.repo !== entry.repo) problems.push(`${slug}: records ${entry.repo}, but the MCP snapshot is of ${snapshot.repo}`)
    if (snapshot.revision !== entry.revision) problems.push(`${slug}: records ${entry.revision.slice(0, 9)}, but the MCP snapshot is of ${snapshot.revision.slice(0, 9)}`)
    for (const tool of Object.keys(entry.tools)) {
      if (!snapshot.registrations.some((registration) => registration.wireName === tool)) problems.push(`${slug}: ${tool} is not a registered tool`)
    }
  }
  const port = PORTS.find((candidate) => candidate.slug === slug)
  const candidates = slug === 'py'
    ? [process.env.LIBTMUX_DOCS_MCP_PY, '~/work/python/libtmux-mcp']
    : port ? checkoutCandidates(port) : []
  const checkout = candidates.filter(Boolean).map(expand).find((path) => existsSync(path))
  if (!checkout) skipped.push(`${slug} (no checkout)`)
  else if (git(checkout, 'cat-file', '-e', `${entry.revision}^{commit}`) === undefined) skipped.push(`${slug} (${entry.revision.slice(0, 9)} not in ${checkout})`)
  else {
    const symbols = data(`site/src/data/api/${slug}.json`).symbols
    problems.push(...wrapsProblems(slug, entry, symbols, (revision, file) => git(checkout, 'show', `${revision}:${file}`)))
    if (!problems.length) console.log(`check-mcp-wraps: ${slug} ${Object.keys(entry.tools).length} calls are made on the lines cited at ${entry.revision.slice(0, 9)}`)
  }
  for (const problem of problems) console.error(`check-mcp-wraps: ${problem}`)
  failed += problems.length
}
if (skipped.length) console.log(`check-mcp-wraps: skipped ${skipped.join('; ')}`)
if (failed) {
  console.error(`check-mcp-wraps: ${failed} problem(s)`)
  process.exit(1)
}
