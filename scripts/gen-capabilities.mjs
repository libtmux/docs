#!/usr/bin/env node
/**
 * Read each port's capability manifest and write site/src/data/capabilities.json.
 *
 * A port's `capabilities.json` is emitted by that port from the typed
 * `support.capabilities` registry its library refuses with, and the port's own
 * drift test keeps the two equal. This script does not interpret prose or
 * keep a table: it validates each manifest, resolves every API name in it
 * through the port's generated API model, and records the tmux releases the
 * matrix columns come from. A name that does not resolve fails the run, so a
 * renamed method cannot leave a capability pointing at nothing.
 *
 * Releases come from tmux's own refs: final tags, the version a release
 * branch names in `configure.ac` (3.7d shipped from a branch before it was
 * tagged), and the `next-X.Y` that master names. Only releases at or above the
 * lowest floor any manifest declares are kept.
 *
 * Usage: node scripts/gen-capabilities.mjs [--port <slug>] [--manifest <slug>=<path>]
 *        [--tmux <checkout>] [--out <path>] [--check]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { SymbolIndex } from '../packages/api-model/src/link.ts'
import { compareTmuxVersions, tmuxVersionKey, validateManifest } from '../packages/api-model/src/capabilities.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
const values = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
const checking = args.includes('--check')
const only = value('--port')
const out = resolve(value('--out', join(repoRoot, 'site/src/data/capabilities.json')))
const tmuxCheckout = expand(value('--tmux', '~/study/c/tmux'))
const modelDir = resolve(value('--models', join(repoRoot, 'site/src/data/api')))

/** `--manifest py=path/to/capabilities.json` overrides where a port's manifest is read. */
const overrides = Object.fromEntries(values('--manifest').map((pair) => pair.split('=')))

/** The manifest sits at the root of the port's checkout, emitted and drift-checked there. */
function manifestPath(port) {
  return overrides[port.slug] ?? join(expand(port.checkout), 'capabilities.json')
}

function git(...a) {
  return execFileSync('git', ['-C', tmuxCheckout, ...a], { encoding: 'utf8' }).trim()
}

/** Every tmux release a reader can run, from tmux's own refs. */
function tmuxReleases() {
  const versions = new Set()
  const add = (v) => {
    try {
      tmuxVersionKey(v)
      versions.add(v)
    } catch {
      // A ref that names something tmux never prints (a topic branch) is not a release.
    }
  }
  for (const tag of git('tag', '-l').split('\n')) if (/^\d+\.\d+[a-z]?$/.test(tag)) add(tag)
  const refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes').split('\n')
  const named = (ref) => /AC_INIT\(\[tmux\], ([^)]+)\)/.exec(git('show', `${ref}:configure.ac`))?.[1]
  for (const ref of refs.filter((r) => /\/release_[\d.]+[a-z]?$/.test(r))) {
    const v = named(ref)
    if (v && /^\d+\.\d+[a-z]?$/.test(v)) add(v)
  }
  const master = refs.find((r) => r === 'upstream/master') ?? refs.find((r) => r === 'origin/master')
  const next = master && named(master)
  if (next?.startsWith('next-')) add(next)
  return [...versions].sort(compareTmuxVersions)
}

/** Resolve a manifest's API name to the public id the reference pages use. */
function resolver(slug) {
  const file = join(modelDir, `${slug}.json`)
  if (!existsSync(file)) return undefined
  const model = JSON.parse(readFileSync(file, 'utf8'))
  const index = new SymbolIndex(model.symbols, () => '', slug)
  return (name) => {
    const target = index.resolve(name)
    return target?.symbol ? (target.symbol.publicId ?? target.symbol.id) : undefined
  }
}

const errors = []
const ports = {}
for (const port of PORTS) {
  if (only && port.slug !== only) continue
  // A wrapper library shares its parent's checkout, where the manifest names the parent.
  if (port.parentLibrary) continue
  const path = manifestPath(port)
  if (!existsSync(path)) continue
  const { manifest, errors: invalid } = validateManifest(JSON.parse(readFileSync(path, 'utf8')))
  if (!manifest) {
    errors.push(...invalid.map((e) => `${port.slug}: ${e}`))
    continue
  }
  if (manifest.port !== port.slug) errors.push(`${port.slug}: manifest names port "${manifest.port}"`)
  const resolve = resolver(port.slug)
  if (!resolve) {
    errors.push(`${port.slug}: no API model at ${join(modelDir, `${port.slug}.json`)}; run gen-api-model first`)
    continue
  }
  const link = (where, name) => {
    const id = resolve(name)
    if (!id) errors.push(`${port.slug}: ${where} names "${name}", which is not in the API model`)
    return id ?? name
  }
  const entries = (list, kind) => list.map((e) => ({
    ...e,
    apis: e.apis.map((name) => link(`${kind} ${e.id}`, name)),
    ...(e.error ? { error: link(`${kind} ${e.id} error`, e.error) } : {}),
  }))
  ports[port.slug] = {
    revision: (() => {
      try {
        return execFileSync('git', ['-C', dirname(path), 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        return undefined
      }
    })(),
    floor: manifest.floor,
    capabilities: entries(manifest.capabilities, 'capability'),
    workarounds: entries(manifest.workarounds, 'workaround'),
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

const floors = Object.values(ports).map((p) => p.floor.minimum)
const lowest = floors.sort(compareTmuxVersions)[0]
const releases = lowest ? tmuxReleases().filter((v) => compareTmuxVersions(v, lowest) >= 0) : []
const data = `${JSON.stringify({ generated: 'scripts/gen-capabilities.mjs', releases, ports }, null, 2)}\n`

if (checking) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (current !== data) {
    console.error(`${out} is stale; run node scripts/gen-capabilities.mjs`)
    process.exit(1)
  }
} else {
  writeFileSync(out, data)
  console.log(`wrote ${out}: ${Object.keys(ports).length} ports, ${releases.length} releases`)
}
