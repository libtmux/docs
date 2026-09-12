#!/usr/bin/env node
/**
 * What each port's package registry actually carries right now.
 *
 * The agent prompts name an install command, and an install command that does
 * not resolve is worse than no prompt at all: the reader's agent runs it,
 * fails, and starts inventing. Seven of the eight ports have no stable release
 * and one is not published at all, so the right spelling differs per port and
 * changes the day any of them ships.
 *
 * Two spellings are forced rather than chosen, and the rest are pinned so a
 * prompt's prose and its command agree:
 *
 *   - Swift tags only prereleases, and `0.1.0-alpha.4` sorts below `0.1.0`, so
 *     `from: "0.1.0"` has nothing in range. `exact:` is the only form.
 *   - C++ has no vcpkg port, so a CMake FetchContent block at a tag is the
 *     only way in.
 *
 * Measured rather than assumed: `cargo add libtmux` and
 * `go get github.com/libtmux/libtmux-go` both resolve their alphas without a
 * pin, because a resolver with no release to prefer falls back to a
 * prerelease. The pins stay because the prompt names a version in prose beside
 * the command, and because a bare command changes what it installs the day a
 * stable lands while a generated pin changes visibly.
 *
 * So which of `installForms.{stable,prerelease,git}` applies is a fact about
 * the registry today, not about the port, and it belongs in generated data
 * rather than in a hand-typed string that goes stale the next time anyone
 * publishes. `ports.ts` owns the spellings; this owns the state.
 *
 * Offline, or behind a rate limit, every probe falls back to the committed
 * file rather than writing a worse one. Same discipline as gen-versions.mjs's
 * seed: a build with no network reproduces the last known-good answer instead
 * of claiming every port is unpublished.
 *
 * Usage:
 *   node scripts/gen-registry.mjs [--out <path>] [--check] [--offline]
 *
 *   --out <path>  Write there (default: site/src/data/registry.json).
 *   --check       Write nothing; exit 1 if the committed file is out of date.
 *   --offline     Skip every probe and re-emit the committed file. For CI
 *                 jobs that must not depend on eight third-party services.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const siteLib = join(repoRoot, 'site', 'src', 'lib')
const DEFAULT_OUT = join(repoRoot, 'site', 'src', 'data', 'registry.json')

const { PORTS } = await import(`file://${join(siteLib, 'ports.ts')}`)
const { parseTag, compareTags } = await import(`file://${join(siteLib, 'versions.ts')}`)

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, check: false, offline: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--check') opts.check = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return opts
}

const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/**
 * Read a registry version under the port's own tag grammar.
 *
 * Both grammars in versions.ts anchor on a leading `v`, because they were
 * written for git tags. Registries mostly report the bare number: crates.io
 * says `0.1.0-alpha.10`, Maven Central says `0.0.1-alpha.10`, PyPI says
 * `0.62.0`, and only the Go proxy says `v0.0.1-alpha.6`. Parsing a bare
 * number with those regexes returns null, which would classify every stable
 * release as unpublished. Normalise first, once, here.
 */
const tagged = (version) => (version.startsWith('v') ? version : `v${version}`)

/** Whether a version string is a prerelease under this port's grammar. */
function isPrerelease(version, grammar) {
  const parsed = parseTag(tagged(version), grammar)
  if (!parsed || parsed.pre === null) return false
  // PEP 440 post-releases carry a suffix and are not prereleases.
  return !parsed.pre.startsWith('post')
}

/** Newest first, under this port's grammar. */
const newestFirst = (versions, grammar) =>
  [...versions].sort((a, b) => compareTags(tagged(a), tagged(b), grammar))

/**
 * The version part of a tag that names a release of this port's library, or
 * null for any other tag in the repository.
 *
 * Repositories that ship one library tag bare (`v0.1.0-alpha.7`). Two do not,
 * in opposite ways, and both are handled by `port.tagPrefix`: Rust's Cargo
 * workspace tags per crate (`libtmux@v0.1.0-alpha.10`), and Go's multi-module
 * layout tags submodules under a path (`mcp/v0.0.1-alpha.9`) while the library
 * tags bare. Requiring the declared prefix, and rejecting `/` and `@` when
 * none is declared, keeps a submodule's release from being read as the
 * library's. Swift tags without the leading `v`, which `tagged()` absorbs.
 */
function releaseTag(tag, port) {
  if (port.tagPrefix) {
    if (!tag.startsWith(port.tagPrefix)) return null
    const rest = tag.slice(port.tagPrefix.length)
    return parseTag(tagged(rest), port.tagGrammar) ? rest : null
  }
  if (tag.includes('/') || tag.includes('@')) return null
  return parseTag(tagged(tag), port.tagGrammar) ? tag : null
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'libtmux-docs gen-registry.mjs', ...headers },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { missing: res.status === 404 || res.status === 403, body: null }
  return { missing: false, body: await res.json() }
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'libtmux-docs gen-registry.mjs' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { missing: res.status === 404 || res.status === 403, body: null }
  return { missing: false, body: await res.text() }
}

/**
 * Every version a registry carries for one port, or `null` for a package it
 * does not have.
 *
 * `null` and `[]` mean different things and the caller acts on both:
 * `null` is "this registry has no such package", which sends the prompt to
 * the git install form. A thrown error is a third case, handled by the
 * caller as "keep whatever the committed file said".
 */
const PROBES = {
  async py() {
    const { missing, body } = await getJson('https://pypi.org/pypi/libtmux/json')
    if (missing || !body) return null
    return Object.keys(body.releases ?? {}).filter((v) => (body.releases[v] ?? []).length > 0)
  },
  async ts() {
    const { missing, body } = await getJson('https://registry.npmjs.org/@libtmux%2flibtmux')
    if (missing || !body || body.error) return null
    return Object.keys(body.versions ?? {})
  },
  async rs() {
    const { missing, body } = await getJson('https://crates.io/api/v1/crates/libtmux')
    if (missing || !body || body.errors) return null
    return (body.versions ?? []).filter((v) => !v.yanked).map((v) => v.num)
  },
  async go() {
    const { missing, body } = await getText(
      'https://proxy.golang.org/github.com/libtmux/libtmux-go/@v/list',
    )
    if (missing || body === null) return null
    const versions = body.split('\n').filter(Boolean)
    return versions.length > 0 ? versions : null
  },
  async java() {
    const { missing, body } = await getText(
      'https://repo1.maven.org/maven2/io/github/libtmux/libtmux/maven-metadata.xml',
    )
    if (missing || !body) return null
    return [...body.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  },
  async dotnet() {
    const { missing, body } = await getJson(
      'https://api.nuget.org/v3-flatcontainer/libtmux/index.json',
    )
    if (missing || !body) return null
    return body.versions ?? []
  },
  async cxx() {
    // vcpkg has no version API; the port directory's manifest is the fact.
    const { missing, body } = await getText(
      'https://raw.githubusercontent.com/microsoft/vcpkg/master/ports/libtmux-cxx/vcpkg.json',
    )
    if (missing || !body) return null
    try {
      const version = JSON.parse(body)['version-semver'] ?? JSON.parse(body).version
      return version ? [version] : null
    } catch {
      return null
    }
  },
  async swift(port, tags) {
    // SwiftPM has no central registry: it resolves a dependency straight from
    // the repository, so the repository's release tags ARE this port's
    // registry. Reporting `unpublished` here would be a category error — it
    // would say Swift is missing something it never had, and send the prompt
    // down the "install from git" branch to say what the normal branch
    // already says.
    const releases = tags.map((t) => releaseTag(t, port)).filter(Boolean)
    return releases.length > 0 ? releases : null
  },
}

/**
 * The port's newest git tag, for the install form that names one.
 *
 * The local checkout first, because it needs no network and no token, then
 * the GitHub API for a machine that has not cloned that port. CI has neither
 * checkout nor, usually, a token, so a failure here is normal and falls back
 * to the committed value rather than blanking it.
 */
async function allTags(port) {
  const checkout = expand(port.checkout)
  if (existsSync(join(checkout, '.git'))) {
    try {
      const out = execFileSync('git', ['tag', '--list'], {
        cwd: checkout,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const names = out.split('\n').filter(Boolean)
      if (names.some((name) => releaseTag(name, port))) return names
    } catch {
      // Fall through to the API.
    }
  }
  const { body } = await getJson(`https://api.github.com/repos/${port.repo}/tags?per_page=100`)
  return Array.isArray(body) ? body.map((t) => t.name) : []
}

/** The newest tag naming a release of this library, full name included. */
function newestTagFrom(tags, port) {
  const releases = tags
    .map((name) => ({ name, version: releaseTag(name, port) }))
    .filter((entry) => entry.version !== null)
  if (releases.length === 0) return null
  const newest = newestFirst(releases.map((r) => r.version), port.tagGrammar)[0]
  // The full tag, not the version: `cargo --tag` and `git clone --branch`
  // need the name that exists in the repository.
  return releases.find((r) => r.version === newest).name
}

/** Classify one port from the versions its registry carries. */
function classify(port, versions, tag) {
  if (versions === null || versions.length === 0) {
    return { status: 'unpublished', version: null, stable: null, tag }
  }
  const ordered = newestFirst(versions, port.tagGrammar)
  const stable = ordered.find((v) => !isPrerelease(v, port.tagGrammar)) ?? null
  return stable
    ? { status: 'stable', version: stable, stable, tag }
    : { status: 'prerelease', version: ordered[0], stable: null, tag }
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(0)
}

/**
 * The last known-good answer, always read from the committed file rather than
 * from `--out`. They are the same path by default and are not when a caller
 * writes elsewhere: reading the target meant `--offline --out /tmp/x` had no
 * baseline to re-emit and threw, which is the one mode that exists precisely
 * to avoid needing the network.
 */
const committed = existsSync(DEFAULT_OUT)
  ? JSON.parse(readFileSync(DEFAULT_OUT, 'utf8'))
  : existsSync(opts.out)
    ? JSON.parse(readFileSync(opts.out, 'utf8'))
    : { ports: {} }

const ports = {}
const notes = []
for (const port of PORTS) {
  const previous = committed.ports?.[port.slug]
  if (opts.offline) {
    if (!previous) throw new Error(`--offline needs a committed entry for ${port.slug}`)
    ports[port.slug] = previous
    continue
  }
  let tags = []
  try {
    tags = await allTags(port)
  } catch {
    tags = []
  }
  let versions
  try {
    versions = await PROBES[port.slug](port, tags)
  } catch (error) {
    if (!previous) throw new Error(`${port.slug}: probe failed and nothing committed: ${error}`)
    notes.push(`${port.slug}: probe failed (${error.message}), kept committed value`)
    ports[port.slug] = previous
    continue
  }
  let tag = newestTagFrom(tags, port)
  if (!tag) {
    tag = previous?.tag ?? null
    if (!tag) notes.push(`${port.slug}: no git tag found`)
  }
  ports[port.slug] = classify(port, versions, tag)
}

const payload = {
  schema: 1,
  /**
   * Deliberately not a timestamp of this run. A field that changes on every
   * invocation makes `--check` fail for no reason and turns a no-op refresh
   * into a diff, which is how generated files stop being regenerated.
   */
  ports,
}

const text = `${JSON.stringify(payload, null, 2)}\n`

if (opts.check) {
  const current = existsSync(opts.out) ? readFileSync(opts.out, 'utf8') : ''
  if (current !== text) {
    console.error(`${opts.out} is out of date. Run: node scripts/gen-registry.mjs`)
    const a = JSON.parse(current || '{"ports":{}}').ports ?? {}
    for (const [slug, entry] of Object.entries(ports)) {
      const before = a[slug]
      if (JSON.stringify(before) !== JSON.stringify(entry)) {
        console.error(`  ${slug}: ${JSON.stringify(before)} -> ${JSON.stringify(entry)}`)
      }
    }
    process.exit(1)
  }
  console.log(`${opts.out} is current`)
} else {
  writeFileSync(opts.out, text)
  console.log(`wrote ${opts.out}`)
  for (const [slug, entry] of Object.entries(ports)) {
    console.log(`  ${slug.padEnd(7)} ${entry.status.padEnd(12)} ${entry.version ?? '-'} (tag ${entry.tag ?? '-'})`)
  }
}
for (const note of notes) console.error(`note: ${note}`)
