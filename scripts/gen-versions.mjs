#!/usr/bin/env node
// Derive site/public/versions.json's shape (VersionManifest, see
// site/src/lib/versions.ts) from git refs in each port's checkout, falling
// back to the two-entry seed for a port whose checkout is not present on
// this machine. Never invents the manifest shape independently of
// versions.ts — it imports PORTS, sortVersions and compareTags directly so
// ordering and the field set cannot drift from what the switcher reads.
//
// Usage:
//   node scripts/gen-versions.mjs [--out <path>] [--seed] [--overrides <path>]
//
//   --out <path>        Write the manifest there (default: stdout).
//   --seed              Skip git derivation entirely; emit only 'latest'
//                        (trunk) and 'stable' (alias -> latest) per port.
//                        This is how site/public/versions.json itself is
//                        produced — a committed fallback the switcher can
//                        read before any real deploy has run this script.
//   --overrides <path>  A partial manifest JSON merged over the derived
//                        one: entries merge by slug within each port,
//                        defaultVersion keys replace outright.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const siteLib = join(repoRoot, 'site', 'src', 'lib')

const { PORTS } = await import(`file://${join(siteLib, 'ports.ts')}`)
const { sortVersions, compareTags, parseTag } = await import(`file://${join(siteLib, 'versions.ts')}`)

function parseArgs(argv) {
  const opts = { out: undefined, seed: false, overrides: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--seed') opts.seed = true
    else if (arg === '--overrides') opts.overrides = argv[++i]
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return opts
}

function expandHome(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

const BRANCH_RE = /^v\d+\.x$/

/** The two entries every port gets even with no checkout to inspect. */
function seedEntries() {
  return [
    { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
    { slug: 'stable', label: 'stable', kind: 'alias', resolvesTo: 'latest', supported: true },
  ]
}

function deriveEntries(port) {
  const { checkout, tagGrammar } = port
  const dir = expandHome(checkout)
  if (!existsSync(dir)) {
    return { entries: seedEntries(), defaultVersion: 'stable', note: `checkout not found at ${checkout}` }
  }

  let refs
  try {
    refs = git(dir, ['for-each-ref', '--format=%(refname:short)\t%(creatordate:iso-strict)', 'refs/tags', 'refs/heads'])
  } catch {
    return {
      entries: seedEntries(),
      defaultVersion: 'stable',
      note: `git for-each-ref failed in ${checkout} (not a git repo?)`,
    }
  }

  const tags = []
  const branches = []
  for (const line of refs.split('\n').filter(Boolean)) {
    const [name, date] = line.split('\t')
    const parsed = parseTag(name, tagGrammar)
    if (parsed) tags.push({ name, date, pre: parsed.pre })
    else if (BRANCH_RE.test(name)) branches.push({ name, date })
  }
  tags.sort((a, b) => compareTags(a.name, b.name, tagGrammar))

  let headDate
  try {
    headDate = git(dir, ['log', '-1', '--format=%cI'])
  } catch {
    headDate = undefined
  }

  // `tags` is already newest-first, so the first match in each case is the one
  // the alias should name. A suffix decides these, not a hyphen: `v0.11.0b0`
  // has no hyphen and is not a release.
  const stableTag = tags.find((t) => t.pre === null)?.name
  const preTag = tags.find((t) => t.pre !== null)?.name

  const entries = [
    { slug: 'latest', label: 'latest', kind: 'trunk', supported: true, ...(headDate ? { published: headDate } : {}) },
    // Absent, not pointed at trunk. An alias called `stable` that resolves to
    // an unreleased HEAD tells a reader — and, through robotsFor, a search
    // engine — the opposite of the truth.
    ...(stableTag ? [{ slug: 'stable', label: 'stable', kind: 'alias', resolvesTo: stableTag, supported: true }] : []),
    ...(preTag ? [{ slug: 'next', label: 'next', kind: 'alias', resolvesTo: preTag, supported: true }] : []),
    ...tags.map((t) => ({ slug: t.name, label: t.name, kind: 'tag', supported: true, ...(t.date ? { published: t.date } : {}) })),
    ...branches.map((b) => ({ slug: b.name, label: b.name, kind: 'branch', supported: true, ...(b.date ? { published: b.date } : {}) })),
  ]
  return { entries, defaultVersion: stableTag ? 'stable' : 'latest', note: undefined }
}

function mergeOverrides(manifest, overridesPath) {
  if (!overridesPath) return manifest
  const raw = JSON.parse(readFileSync(overridesPath, 'utf8'))
  const merged = { ...manifest, ports: { ...manifest.ports }, defaultVersion: { ...manifest.defaultVersion } }

  for (const [slug, entries] of Object.entries(raw.ports ?? {})) {
    const existing = merged.ports[slug] ?? []
    const bySlug = new Map(existing.map((e) => [e.slug, e]))
    for (const entry of entries) bySlug.set(entry.slug, entry)
    merged.ports[slug] = [...bySlug.values()]
  }
  Object.assign(merged.defaultVersion, raw.defaultVersion ?? {})
  return merged
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    process.stdout.write(
      'Usage: node scripts/gen-versions.mjs [--out <path>] [--seed] [--overrides <path>]\n',
    )
    return
  }

  const manifest = { schema: 1, ports: {}, defaultVersion: {} }

  for (const port of PORTS) {
    const derived = opts.seed
      ? { entries: seedEntries(), defaultVersion: 'stable' }
      : deriveEntries(port)
    if (derived.note) process.stderr.write(`gen-versions: ${port.slug}: ${derived.note}\n`)
    manifest.ports[port.slug] = sortVersions(derived.entries, port.tagGrammar)
    // Not unconditionally 'stable' any more: a port with no release has no
    // stable entry to point at, and naming one anyway is what made seven of
    // eight ports advertise trunk as their released version.
    manifest.defaultVersion[port.slug] = derived.defaultVersion
  }

  const final = mergeOverrides(manifest, opts.overrides)
  const json = `${JSON.stringify(final, null, 2)}\n`

  if (opts.out) writeFileSync(opts.out, json)
  else process.stdout.write(json)
}

main()
