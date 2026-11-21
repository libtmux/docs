#!/usr/bin/env node
/**
 * The source link on every MCP tool page, checked against the commit it names.
 *
 * `gen-mcp-tools.mjs` records where each tool is registered, and a tool page
 * links that file and line at the revision of the port's API model. When the
 * snapshot is ahead of the model, a tool that is new in the snapshot has no
 * file at the model's revision, and its link 404s. `check-source-links.mjs`
 * reads the model's declarations; this reads the registrations.
 *
 * Each port is read from its checkout (`LIBTMUX_DOCS_CHECKOUT_<PORT>`, else its
 * worktree, else its standard checkout). A port with no checkout, or whose
 * checkout lacks the revision, fails: its links were not checked. A run that
 * cannot have every checkout names the ports that may lack one with
 * `--allow-missing`; those are reported as skipped, not as passing.
 *
 * Usage: node scripts/check-mcp-source-links.mjs [--port ts] [--allow-missing go,py]
 *        [--tools path/to/mcp-tools.json]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { allowMissingPorts, checkoutCandidates, sourceGate } from './lib/port-checkout.mjs'
import { registrationLinkProblems } from './lib/mcp-source-links.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const only = option('--port')
const allowMissing = allowMissingPorts()
const matrix = JSON.parse(readFileSync(option('--tools') ?? join(root, 'site/src/data/mcp-tools.json'), 'utf8'))

const git = (checkout, ...args) => {
  try {
    return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

let failed = 0
let unchecked = 0
const skipped = []
for (const [slug, entry] of Object.entries(matrix.ports)) {
  if (only && only !== slug) continue
  const port = PORTS.find((candidate) => candidate.slug === slug)
  const candidates = slug === 'py'
    ? [process.env.LIBTMUX_DOCS_MCP_PY, '~/work/python/libtmux-mcp']
    : port ? checkoutCandidates(port) : []
  const checkout = candidates.filter(Boolean).map(expand).find((path) => existsSync(path))
  const revisions = [...new Set(entry.registrations.map((row) => row.source.revision))]
  const absent = checkout ? revisions.filter((revision) => git(checkout, 'cat-file', '-e', `${revision}^{commit}`) === undefined) : []
  const gate = sourceGate(slug, !checkout ? 'no checkout' : absent.length ? `${absent.map((revision) => revision.slice(0, 9)).join(', ')} not in ${checkout}` : undefined, allowMissing)
  if (gate.outcome === 'skipped') {
    skipped.push(gate.message)
    continue
  }
  if (gate.outcome === 'failed') {
    console.error(`check-mcp-source-links: ${gate.message}`)
    unchecked += 1
    continue
  }
  const problems = registrationLinkProblems(slug, entry.registrations, (revision, file) => git(checkout, 'show', `${revision}:${file}`))
  for (const problem of problems) console.error(`check-mcp-source-links: ${problem}`)
  failed += problems.length
  if (!problems.length) console.log(`check-mcp-source-links: ${slug} ${entry.registrations.length} registrations resolve at ${revisions.map((revision) => revision.slice(0, 9)).join(', ')}`)
}
if (skipped.length) console.log(`check-mcp-source-links: skipped ${skipped.join('; ')}`)
if (failed) console.error(`check-mcp-source-links: ${failed} link(s) do not resolve`)
if (unchecked) console.error(`check-mcp-source-links: ${unchecked} port(s) not checked`)
if (failed || unchecked) process.exit(1)
