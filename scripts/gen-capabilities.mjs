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
 * A port that raises another port's types, as PowerShell raises .NET's
 * exceptions, resolves those names through the models in its
 * `apiDependencies`, by the inventory reference navigation links them with.
 *
 * Releases come from tmux's own refs: final tags, the version a release
 * branch names in `configure.ac` (3.7d shipped from a branch before it was
 * tagged), and the `next-X.Y` that master names. Only releases at or above the
 * lowest floor any manifest declares are kept.
 *
 * `--check` compares the committed file with what the manifests say. Hosted CI
 * clones this repository alone, so a port whose manifest cannot be read is
 * named, not skipped in silence: its committed entry is still validated and
 * every API name in it resolved through the committed API model, so a renamed
 * method fails there too. Releases are compared with tmux's refs when a clone
 * is present, and checked by form and order when it is not. Writing refuses
 * to drop a committed port it cannot read. `--port` rewrites that port's entry
 * and keeps the others as committed.
 *
 * A port's manifest is read from `capabilities.json` at the root of its
 * checkout. `LIBTMUX_DOCS_CHECKOUT_<PORT>` selects another checkout, and
 * `--manifest <slug>=<path>` selects the file itself.
 *
 * Usage: node scripts/gen-capabilities.mjs [--port <slug>] [--manifest <slug>=<path>]
 *        [--tmux <checkout>] [--out <path>] [--check]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS, PORT_BY_SLUG } from '../site/src/lib/ports.ts'
import { SymbolIndex } from '../packages/api-model/src/link.ts'
import { parentInventory } from '../packages/api-model/src/parent-inventory.ts'
import { CAPABILITY_SCHEMA, compareTmuxVersions, tmuxVersionKey, validateManifest } from '../packages/api-model/src/capabilities.ts'

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
  const checkout = process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.checkout
  return overrides[port.slug] ?? join(expand(checkout), 'capabilities.json')
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

const modelFile = (slug) => join(modelDir, `${slug}.json`)
const readModel = (slug) => JSON.parse(readFileSync(modelFile(slug), 'utf8'))

/**
 * Resolve a manifest's API name to the public id the reference pages use.
 * `missing` names an API model the port needs and this checkout lacks.
 */
function resolver(slug) {
  const dependencies = PORT_BY_SLUG[slug]?.apiDependencies ?? []
  const missing = [slug, ...dependencies].map(modelFile).find((file) => !existsSync(file))
  if (missing) return { missing }
  const index = new SymbolIndex(readModel(slug).symbols, () => '', slug)
  const inherited = dependencies.map((dependency) =>
    new Map(parentInventory(readModel(dependency), (symbol) => symbol.publicId ?? symbol.id).map((entry) => [entry.name, entry.uri])))
  const resolve = (name) => {
    const target = index.resolve(name)
    if (target?.symbol) return target.symbol.publicId ?? target.symbol.id
    return inherited.map((names) => names.get(name)).find(Boolean)
  }
  const scope = dependencies.length ? `the API model or the model of ${dependencies.join(', ')}` : 'the API model'
  return { resolve, scope }
}

/** The names a committed entry holds, as the places they appear. */
function committedNames(kind, list) {
  return list.flatMap((e) => [
    ...e.apis.map((name) => [`${kind} ${e.id}`, name]),
    ...(e.error ? [[`${kind} ${e.id} error`, e.error]] : []),
  ])
}

/**
 * Check a committed entry without its manifest: it still has to be a valid
 * manifest, and every name in it still has to resolve in the committed model.
 */
function verifyCommitted(slug, entry) {
  const held = entry && typeof entry === 'object' ? entry : {}
  const { errors: invalid } = validateManifest({
    schema: CAPABILITY_SCHEMA, port: slug, floor: held.floor, capabilities: held.capabilities, workarounds: held.workarounds,
  })
  if (invalid.length) return invalid.map((e) => `${slug}: committed entry: ${e}`)
  const { resolve, scope, missing } = resolver(slug)
  if (missing) return [`${slug}: no API model at ${missing}; run gen-api-model first`]
  return [...committedNames('capability', held.capabilities), ...committedNames('workaround', held.workarounds)]
    .filter(([, name]) => !resolve(name))
    .map(([where, name]) => `${slug}: committed ${where} names "${name}", which is not in ${scope}`)
}

const errors = []
const ports = {}
/** Ports considered, and the ones whose manifest this machine cannot read. */
const considered = []
const unread = []
for (const port of PORTS) {
  if (only && port.slug !== only) continue
  // A wrapper library shares its parent's checkout, where the manifest names the parent.
  if (port.parentLibrary) continue
  considered.push(port.slug)
  const path = manifestPath(port)
  if (!existsSync(path)) {
    unread.push(port.slug)
    continue
  }
  const { manifest, errors: invalid } = validateManifest(JSON.parse(readFileSync(path, 'utf8')))
  if (!manifest) {
    errors.push(...invalid.map((e) => `${port.slug}: ${e}`))
    continue
  }
  if (manifest.port !== port.slug) errors.push(`${port.slug}: manifest names port "${manifest.port}"`)
  const { resolve, scope, missing } = resolver(port.slug)
  if (missing) {
    errors.push(`${port.slug}: no API model at ${missing}; run gen-api-model first`)
    continue
  }
  const link = (where, name) => {
    const id = resolve(name)
    if (!id) errors.push(`${port.slug}: ${where} names "${name}", which is not in ${scope}`)
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

let committed
if (existsSync(out)) {
  try {
    committed = JSON.parse(readFileSync(out, 'utf8'))
  } catch (error) {
    if (checking) {
      console.error(`${out} is not valid JSON: ${error.message}`)
      process.exit(1)
    }
  }
}
/** Ports that read a manifest of their own; a wrapper library takes its parent's. */
const owners = PORTS.filter((p) => !p.parentLibrary).map((p) => p.slug)
/** Unread ports the committed file holds an entry for. */
const kept = unread.filter((slug) => committed?.ports?.[slug])
/** What the file holds for a port once this run is done: what the run read, else the entry it already has. */
const entryOf = (slug) => ports[slug] ?? committed?.ports?.[slug]
const printable = (v) => {
  try {
    tmuxVersionKey(v)
    return true
  } catch {
    return false
  }
}
const lowestOf = (floors) => floors.filter(printable).sort(compareTmuxVersions)[0]
const haveTmux = existsSync(tmuxCheckout)

if (checking) {
  const problems = []
  if (!committed) problems.push(`${out} does not exist; run node scripts/gen-capabilities.mjs`)
  else {
    const registered = new Set(PORTS.map((p) => p.slug))
    for (const slug of Object.keys(committed.ports ?? {})) if (!registered.has(slug)) problems.push(`${slug}: committed, but not a registered port`)
    for (const slug of Object.keys(ports)) {
      if (!committed.ports?.[slug]) problems.push(`${slug}: missing from the file`)
      else if (JSON.stringify(ports[slug]) !== JSON.stringify(committed.ports[slug])) problems.push(`${slug}: differs from its manifest`)
    }
    for (const slug of kept) problems.push(...verifyCommitted(slug, committed.ports[slug]))
    const lowest = lowestOf(owners.map((slug) => entryOf(slug)?.floor?.minimum))
    const held = committed.releases ?? []
    if (haveTmux) {
      const expected = lowest ? tmuxReleases().filter((v) => compareTmuxVersions(v, lowest) >= 0) : []
      if (JSON.stringify(expected) !== JSON.stringify(held)) problems.push(`releases differ from the tmux refs: the file has ${held.join(', ') || 'none'}, the refs give ${expected.join(', ') || 'none'}`)
    } else if (!Array.isArray(held)) problems.push('releases: expected an array')
    else {
      for (const v of held) if (!printable(v)) problems.push(`releases: ${JSON.stringify(v)} is not a version tmux prints`)
      const valid = held.filter(printable)
      if (valid.some((v, i) => i > 0 && compareTmuxVersions(valid[i - 1], v) >= 0)) problems.push('releases are not in ascending order')
      for (const v of valid) if (lowest && compareTmuxVersions(v, lowest) < 0) problems.push(`release ${v} is below the lowest floor ${lowest}`)
      if (!lowest && held.length) problems.push('releases: the file holds releases but no port with a floor')
    }
  }
  if (problems.length) {
    console.error(`${out} is out of date or invalid. Fix the entries below, or run node scripts/gen-capabilities.mjs with every checkout present.`)
    console.error(problems.map((p) => `  ${p}`).join('\n'))
    process.exit(1)
  }
  const notes = [`gen-capabilities: ${out} is current for ${Object.keys(ports).length} of ${considered.length} ports`]
  if (kept.length) notes.push(`  committed entry verified against the API model, manifest not compared: ${kept.join(', ')}`)
  const bare = unread.filter((slug) => !kept.includes(slug))
  if (bare.length) notes.push(`  no manifest here and none committed: ${bare.join(', ')}`)
  if (!haveTmux) notes.push(`  tmux releases not compared: no tmux checkout at ${tmuxCheckout}`)
  console.log(notes.join('\n'))
} else {
  if (kept.length) {
    console.error(`gen-capabilities: no manifest for ${kept.join(', ')}; refusing to write a partial file that drops ${kept.length === 1 ? 'its' : 'their'} committed ${kept.length === 1 ? 'entry' : 'entries'}`)
    process.exit(1)
  }
  // A run that selects one port rewrites its entry and leaves the others as committed.
  const written = Object.fromEntries(owners.filter(entryOf).map((slug) => [slug, entryOf(slug)]))
  const lowest = lowestOf(Object.values(written).map((p) => p.floor?.minimum))
  if (lowest && !haveTmux) {
    console.error(`gen-capabilities: no tmux checkout at ${tmuxCheckout}; pass --tmux <checkout>`)
    process.exit(1)
  }
  const releases = lowest ? tmuxReleases().filter((v) => compareTmuxVersions(v, lowest) >= 0) : []
  writeFileSync(out, `${JSON.stringify({ generated: 'scripts/gen-capabilities.mjs', releases, ports: written }, null, 2)}\n`)
  const dropped = Object.keys(committed?.ports ?? {}).filter((slug) => !(slug in written))
  console.log(`wrote ${out}: ${Object.keys(written).length} ports, ${releases.length} releases${dropped.length ? `; dropped entries no port publishes: ${dropped.join(', ')}` : ''}`)
}
