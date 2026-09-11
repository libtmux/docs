#!/usr/bin/env node
/*
 * Compare what a page shows against what the arena runs.
 *
 * docs-arena.mjs counts a quoted source as run by matching a `slug:path` key,
 * and a key says nothing about content: a port's `tmux-arena` worktree is free
 * to diverge from the `-docs` worktree the site quotes, and nothing noticed.
 * Two of them had, silently.
 *
 * Region-aware, because a file may legitimately differ outside the region a
 * page quotes — arena evidence plumbing wrapped around a reader-facing body is
 * exactly that — while the region itself must match byte for byte. A region
 * missing from the run side is its own failure, never a quiet pass.
 *
 * Reads files and nothing else: no tmux, no toolchain, so it belongs in the
 * gate every run executes rather than the port lane.
 *
 * Usage:
 *   node scripts/arena/check-quote-drift.mjs          # check the worktrees
 *   node scripts/arena/check-quote-drift.mjs --json   # machine-readable
 */import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sources from '../../site/src/data/example-sources.json' with { type: 'json' }
import { LANG_TO_PORT, checkoutFor, parseMeta, sliceRegion } from '../../site/src/plugins/remark-port-code.mjs'
import { ARTIFACTS, arenaWorktree } from './artifacts.mjs'

const root = resolve(fileURLToPath(import.meta.url), '../../..')
const CONTENT = join(root, 'site/src/content/docs')

function markdownFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full))
    else if (/\.mdx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * Every region a `file="..."` fence names for a given `slug:path` key, kept
 * (unlike gen-example-sources.mjs's cache, which deliberately drops the
 * region and caches whole files). A key with no region here is quoted whole.
 * @returns {Map<string, Set<string>>}
 */
export function regionsByKey(contentDir = CONTENT) {
  const out = new Map()
  for (const md of markdownFiles(contentDir)) {
    const text = readFileSync(md, 'utf8')
    for (const m of text.matchAll(/^```(\w+)([^\n]*)$/gm)) {
      const owner = LANG_TO_PORT[m[1]]
      if (!owner) continue
      const meta = parseMeta(m[2])
      if (!meta.file) continue
      const key = `${owner}:${meta.file}`
      if (!meta.region) continue
      if (!out.has(key)) out.set(key, new Set())
      out.get(key).add(meta.region)
    }
  }
  return out
}

const norm = (text) => text.replace(/\s+$/, '')

/**
 * Mismatches this repository has not closed yet, and why.
 *
 * A listed key reports `known` instead of failing. An unlisted mismatch fails,
 * and a listed key that now matches fails too, so the list can only shrink —
 * the same shape as the other ratchets here. Closing one means marking the
 * region the page quotes on that port's `docs-site` branch, so the page shows
 * the part the arena runs rather than a whole file that has grown plumbing.
 */
export const KNOWN_DRIFT = new Map([
  [
    'java:examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java',
    'the arena copy wraps the body the page quotes in evidence plumbing; needs a region marker',
  ],
  [
    'dotnet:examples/LibTmux.Examples/Snippets/OneShot.cs',
    'the same shape: the page quotes the whole file, the arena copy adds its adapter',
  ],
])

/**
 * Fold a comparison into the record above.
 * @param {{key: string, status: string, reason: string}} result
 */
export function applyKnownDrift(result) {
  const known = KNOWN_DRIFT.get(result.key)
  if (known === undefined) return result
  if (result.status === 'fail') return { ...result, status: 'known', reason: known }
  return {
    ...result,
    status: 'fail',
    reason: `listed in KNOWN_DRIFT but it matches now — delete the entry: ${result.reason}`,
  }
}

/**
 * Compare one quoted key against the file the arena runs.
 * @param {string} key `slug:path`
 * @param {string} quoted the cached/checkout content example-sources.json (or a live checkout) resolved
 * @param {string} runPath absolute path to the file the arena executes
 * @param {Set<string>} [regions]
 */
export function compareOne(key, quoted, runPath, regions) {
  if (!existsSync(runPath)) return { key, status: 'fail', reason: `the arena has no file at ${runPath}` }
  const run = readFileSync(runPath, 'utf8')

  if (!regions || regions.size === 0) {
    return norm(quoted) === norm(run)
      ? { key, status: 'pass', reason: 'whole file matches' }
      : { key, status: 'fail', reason: 'whole file content differs between the quoted source and the file the arena runs' }
  }

  for (const region of regions) {
    const quotedSlice = sliceRegion(quoted, region)
    const runSlice = sliceRegion(run, region)
    if (quotedSlice === null) return { key, status: 'fail', reason: `region "${region}" not found in the quoted source itself` }
    if (runSlice === null) return { key, status: 'fail', reason: `region "${region}" exists in the quoted source but not in the file the arena runs` }
    if (norm(quotedSlice) !== norm(runSlice)) {
      return { key, status: 'fail', reason: `region "${region}" content differs between the quoted source and the file the arena runs` }
    }
  }
  return { key, status: 'pass', reason: `region(s) ${[...regions].join(', ')} match` }
}

/**
 * Resolve what a `slug:path` key currently shows a reader.
 *
 * "Quoted" means some page's `file="..."` fence actually resolved this key —
 * recorded as a key in example-sources.json by gen-example-sources.mjs — not
 * merely that a same-named file happens to exist in the port's checkout.
 * rs:crates/libtmux/examples/inspect.rs and cxx:examples/01-tour.cpp are both
 * real, readable files the arena runs, but no page fences them, so they must
 * report as unquoted rather than being silently treated as quoted-and-run.
 * Mirrors readFence's own precedence once a key is known to be quoted: the
 * live checkout wins when present, the cache is the CI fallback.
 */
function resolveQuoted(key) {
  if (!Object.hasOwn(sources, key)) return undefined
  const [owner, ...rest] = key.split(':')
  const path = rest.join(':')
  const abs = join(checkoutFor(owner), path)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : sources[key]
}

export function runCheck() {
  const regions = regionsByKey()
  const results = []
  for (const entry of ARTIFACTS) {
    const worktree = arenaWorktree(entry.slug)
    if (!existsSync(worktree)) {
      // A port whose worktree is not here was not compared. Reporting it as
      // drift would make an absent checkout look like a defect in the page.
      results.push({ key: entry.slug, status: 'not run', reason: `no tmux-arena worktree at ${worktree}` })
      continue
    }
    for (const key of entry.runs) {
      if (key.startsWith(`${entry.slug}:page:`)) {
        // A page artifact is the executable unit itself, so no quoted-file
        // entry can exist for it: python's doctest pages live in its own
        // Sphinx tree, which gen-example-sources never scans.
        results.push({ key, status: 'skip', reason: 'page artifact, not a quoted file — no example-sources.json entry can exist for it' })
        continue
      }
      const path = key.slice(entry.slug.length + 1)
      const quoted = resolveQuoted(key)
      if (quoted === undefined) {
        results.push({ key, status: 'unquoted', reason: 'run by the arena but not quoted by any page' })
        continue
      }
      const runPath = join(worktree, path)
      results.push(applyKnownDrift(compareOne(key, quoted, runPath, regions.get(key))))
    }
  }
  return results
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runCheck()
  const asJson = process.argv.includes('--json')
  if (asJson) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) console.log(`${r.status.padEnd(9)} ${r.key} — ${r.reason}`)
  }
  const failed = results.filter((r) => r.status === 'fail')
  console.log(`\nquote-drift: ${results.length} run source(s) checked; ${failed.length} mismatch(es)`)
  if (failed.length) process.exitCode = 1
}
