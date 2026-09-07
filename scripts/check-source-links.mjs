#!/usr/bin/env node
/**
 * The "source" link on every reference entry, checked without the network.
 *
 * These are the only links on the site nothing else verifies: `check-links.mjs`
 * follows internal links, and a blob URL is external. That gap hid two
 * defects at once — 1,760 C++ and Swift links carrying a `../` the path
 * normalisation had introduced, and three ports naming a commit that exists
 * only on a private fork — and both were invisible in a green build.
 *
 * Checked against git rather than HTTP so it runs offline, in CI, and without
 * rate limits. git is also the stronger check: it can say the path exists *at
 * that commit*, which a 200 from a moved file would not.
 *
 * Usage: node scripts/check-source-links.mjs [--port py]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PORTS } from '../site/src/lib/ports.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const only = arg('--port')

/**
 * The repository each port's paths belong to.
 *
 * Not the `-docs` worktree several are extracted from: a Doxygen or symbol
 * graph path names the sources, and that is the repository the blob URL
 * addresses too.
 */
const CHECKOUT = Object.fromEntries(PORTS.map((port) => [port.slug, port.checkout]))
const PRODUCT_CHECKOUT = {
  'tmux-python/tmuxp': '~/work/python/tmuxp',
  'tmux-python/libtmux-mcp': '~/work/python/libtmux-mcp',
}

/**
 * A remote a reader cannot reach.
 *
 * `tony` is the private fork this estate develops on. A commit reachable only
 * from there renders a link that 404s for everyone but its author, which is
 * the failure this file exists to name.
 */
const PRIVATE_REMOTES = new Set(['tony'])

const git = (repo, ...args) => {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

let failed = 0
let skipped = 0
const report = (port, msg) => {
  console.error(`check-source-links: ${port}: ${msg}`)
  failed++
}

for (const [port, where] of Object.entries(CHECKOUT)) {
  if (only && only !== port) continue
  const modelPath = join(repoRoot, 'site/src/data/api', `${port}.json`)
  if (!existsSync(modelPath)) {
    console.log(`check-source-links: ${port} has no model — run gen-api-model.mjs`)
    skipped++
    continue
  }
  const fallbackRepo = expand(where)
  if (!existsSync(fallbackRepo)) {
    // A machine without the sibling checkouts cannot check this port, which
    // is not the same as the port being wrong.
    console.log(`check-source-links: ${port} skipped, no checkout at ${where}`)
    skipped++
    continue
  }

  const model = JSON.parse(readFileSync(modelPath, 'utf8'))
  const units = new Map()
  for (const symbol of model.symbols) {
    const repository = symbol.source.repo ?? model.repo
    const revision = symbol.source.revision ?? model.revision
    const key = `${repository}@${revision}`
    if (!units.has(key)) units.set(key, { repository, revision, symbols: [] })
    units.get(key).symbols.push(symbol)
  }
  for (const unit of units.values()) {
  const repo = expand(PRODUCT_CHECKOUT[unit.repository] ?? where)
  const rev = unit.revision
  if (!rev) {
    report(port, 'model records no revision, so every source link is unbuildable')
    continue
  }

  // 1. The commit has to exist here at all.
  if (git(repo, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`) === undefined) {
    report(port, `revision ${rev.slice(0, 8)} is not in ${where}`)
    continue
  }

  // 2. And it has to be reachable from a remote a reader can fetch.
  const remotes = (git(repo, 'branch', '-r', '--contains', rev) ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('/')[0])
  const publicRemotes = [...new Set(remotes)].filter((r) => !PRIVATE_REMOTES.has(r))
  if (!publicRemotes.length) {
    report(
      port,
      `revision ${rev.slice(0, 8)} is on no public remote (${[...new Set(remotes)].join(', ') || 'no remote'}) — ` +
        'every source link for this port 404s',
    )
    continue
  }

  // 3. Every path has to exist at that commit, and every line has to be
  //    inside the file. A line past the end scrolls nowhere and is the shape
  //    a bad remap would take.
  const lengths = new Map()
  let missing = 0
  let past = 0
  let firstMissing = ''
  let noLine = 0
  for (const s of unit.symbols) {
    const file = s.source?.file
    if (!file) continue
    if (file.startsWith('..') || file.startsWith('/')) {
      if (!firstMissing) firstMissing = file
      missing++
      continue
    }
    if (!lengths.has(file)) {
      const blob = git(repo, 'show', `${rev}:${file}`)
      lengths.set(file, blob === undefined ? null : blob.split('\n').length)
    }
    const n = lengths.get(file)
    if (n === null) {
      if (!firstMissing) firstMissing = file
      missing++
      continue
    }
    if (s.source.line === undefined) noLine++
    else if (s.source.line < 1 || s.source.line > n) past++
  }

  if (missing) report(port, `${missing} symbols name a path absent at ${rev.slice(0, 8)}, e.g. ${firstMissing}`)
  if (past) report(port, `${past} symbols point past the end of their file at ${rev.slice(0, 8)}`)
  if (!missing && !past) {
    console.log(
      `check-source-links: ${port} ${unit.repository} ${unit.symbols.length} symbols, ${lengths.size} files ` +
        `at ${rev.slice(0, 8)} (${publicRemotes.join(', ')})` +
        (noLine ? `, ${noLine} without a line` : ''),
    )
  }
  }
}

if (skipped) console.log(`check-source-links: ${skipped} port(s) skipped`)
if (failed) {
  console.error(`check-source-links: ${failed} failure(s)`)
  process.exit(1)
}
console.log('check-source-links: every source link resolves')
