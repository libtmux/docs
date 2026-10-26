#!/usr/bin/env node
/**
 * What each port's package registry actually carries right now.
 *
 * The agent prompts name an install command, and an install command that does
 * not resolve is worse than no prompt at all: the reader's agent runs it,
 * fails, and starts inventing. A port with only prereleases needs a different
 * spelling from one with a final release, and one port is not published at
 * all, so the right spelling differs per port and changes the day one ships.
 *
 * Two spellings are forced rather than chosen, and the rest are pinned so a
 * prompt's prose and its command agree:
 *
 *   - A Swift prerelease such as `0.1.0-alpha.4` sorts below `0.1.0`, so
 *     `from:` never selects one. `exact:` is the only form for a prerelease;
 *     a final release takes `from:`.
 *   - C++ has no vcpkg port, so a CMake FetchContent block at a tag is the
 *     only way in.
 *
 * Measured rather than assumed: `cargo add libtmux` and
 * `go get github.com/libtmux/libtmux-go` both resolve their alphas without a
 * pin, because a resolver with no release to prefer falls back to a
 * prerelease. The pins stay because the prompt names a version in prose beside
 * the command, and because a bare command changes what it installs the day a
 * release lands while a generated pin changes visibly.
 *
 * So which of `installForms.{release,prerelease,git}` applies is a fact about
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
 *   node scripts/gen-registry.mjs [--out <path>] [--baseline <path>] [--check] [--offline]
 *
 *   --out <path>       Write there (default: site/src/data/registry.json).
 *   --baseline <path>  The last known-good answer to fall back on, overlaid on
 *                      the committed file for newly added ports. The shell
 *                      deploy passes its last published copy, so an outage
 *                      keeps what the site already says rather than reverting
 *                      to whatever was last committed.
 *   --check            Write nothing; exit 1 if the committed file is out of date.
 *   --offline          Skip every probe and re-emit the baseline. For CI jobs
 *                      that must not depend on eight third-party services.
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
const { comparePackageVersions, newestPublishedTag, packageVersionIsPrerelease, releaseTag } = await import(
  `file://${join(siteLib, 'versions.ts')}`
)

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, baseline: null, check: false, offline: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--baseline') opts.baseline = argv[++i]
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
 * number with those regexes returns null, which would classify every final
 * release as unpublished. Normalise first, once, here.
 */
/** Whether a version string is a prerelease under this port's grammar. */
function isPrerelease(version, grammar) {
  return packageVersionIsPrerelease(version, grammar)
}

/** Newest first, under this port's grammar. */
const newestFirst = (versions, grammar) =>
  [...versions].sort((a, b) => comparePackageVersions(a, b, grammar))

/**
 * The prerelease stage a PyPI project declares in its Development Status
 * classifier. A later classifier declares nothing here: a final release is
 * named by its version's series, never by a claim of stability.
 */
const PYPI_STAGES = { '2 - Pre-Alpha': 'pre-alpha', '3 - Alpha': 'alpha', '4 - Beta': 'beta' }
const declaredStage = (classifiers) => PYPI_STAGES[
  classifiers?.find((entry) => entry.startsWith('Development Status :: '))?.slice('Development Status :: '.length)
]

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'libtmux-docs gen-registry.mjs', ...headers },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { missing: res.status === 404 || res.status === 403, body: null }
  return { missing: false, body: await res.json() }
}

/**
 * GitHub's tag API, authenticated when a token is around.
 *
 * Unauthenticated calls are rate limited to 60 an hour per IP, which a shared
 * CI runner exhausts long before this script runs. Distinguishing "no tags"
 * from "could not ask" is what the caller needs, so this returns null for the
 * second rather than folding it into an empty list.
 */
async function githubTags(repo) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const { body } = await getJson(`https://api.github.com/repos/${repo}/tags?per_page=100`, {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  })
  return Array.isArray(body) ? body.map((t) => t.name) : null
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'libtmux-docs gen-registry.mjs' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { missing: res.status === 404 || res.status === 403, status: res.status, body: null }
  return { missing: false, status: res.status, body: await res.text() }
}

/** Gallery v2 retains unlisted releases with a Published date in 1900. */
async function galleryVersions(name, port) {
  let url = `https://www.powershellgallery.com/api/v2/FindPackagesById()?id=%27${name}%27`
  const seen = new Set()
  const versions = []
  while (url) {
    if (seen.has(url) || seen.size >= 100) throw new Error('Gallery pagination did not finish')
    seen.add(url)
    const { status, body } = await getText(url)
    if (body === null) throw new Error(`Gallery ${name}: HTTP ${status}`)
    if (!/<feed\b[^>]*>/.test(body) || !/<\/feed>\s*$/.test(body)) throw new Error(`Gallery ${name}: invalid feed`)
    const entries = [...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)]
    if ((body.match(/<entry\b/g)?.length ?? 0) !== entries.length) throw new Error(`Gallery ${name}: incomplete entries`)
    for (const [, entry] of entries) {
      const property = (key) => new RegExp(`<d:${key}\\b[^>]*>([^<]*)<\\/d:${key}>`).exec(entry)?.[1]
      const id = property('Id')
      const version = property('Version')
      const published = property('Published')
      if (id?.toLowerCase() !== name.toLowerCase() || !version || !releaseTag(version, port)
          || !published || !/^\d{4}-\d{2}-\d{2}T/.test(published)) {
        throw new Error(`Gallery ${name}: invalid package entry`)
      }
      if (!published.startsWith('1900-')) versions.push(version)
    }
    const next = [...body.matchAll(/<link\b[^>]*>/g)].find(([link]) => /\brel="next"/.test(link))?.[0]
    if (!next) break
    const href = /\bhref="([^"]+)"/.exec(next)?.[1]
    if (!href) throw new Error(`Gallery ${name}: missing next page URL`)
    const target = new URL(href.replaceAll('&amp;', '&'), url)
    if (target.origin !== 'https://www.powershellgallery.com') throw new Error(`Gallery ${name}: unexpected next page origin`)
    url = target.href
  }
  return [...new Set(versions)]
}

/** Read General's version tables; reject unfamiliar data rather than erase a good baseline. */
function generalVersions(body, port) {
  const releases = []
  let current
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s*#.*$/, '').trim()
    if (!line) continue
    const header = /^\["([^"]+)"\]$/.exec(line)
    if (header && releaseTag(header[1], port)) {
      current = { version: header[1], tree: false, yanked: false }
      releases.push(current)
    } else if (current && /^git-tree-sha1\s*=\s*"[a-f0-9]{40}"$/.test(line)) {
      current.tree = true
    } else if (current && /^yanked\s*=\s*(true|false)$/.test(line)) {
      current.yanked = /true$/.test(line)
    } else {
      throw new Error('General: invalid version table')
    }
  }
  if (!releases.length || releases.some((release) => !release.tree)) throw new Error('General: missing version trees')
  return releases.filter((release) => !release.yanked).map((release) => release.version)
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
    // The MCP server and tmuxp are separate PyPI projects with their own stage.
    const packages = {}
    const declared = {}
    for (const name of ['libtmux', 'libtmux-mcp', 'tmuxp']) {
      const { missing, body } = await getJson(`https://pypi.org/pypi/${name}/json`)
      packages[name] = missing || !body
        ? null
        : Object.keys(body.releases ?? {}).filter((v) => (body.releases[v] ?? []).length > 0)
      declared[name] = declaredStage(body?.info?.classifiers)
    }
    // Only libtmux is tagged in this repository; the others release from their own.
    return { versions: packages.libtmux, packages, declared, tagged: ['libtmux'] }
  },
  async ruby() {
    const names = ['libtmux', 'libtmux-async', 'libtmux-mcp', 'libtmux-workspace']
    const packages = {}
    for (const name of names) {
      const { missing, body } = await getJson(`https://rubygems.org/api/v1/versions/${name}.json`)
      packages[name] = missing || !Array.isArray(body)
        ? null
        : body
            .filter((release) => release.yanked_at === null || release.yanked_at === undefined)
            .map((release) => release.number)
    }
    return { versions: packages.libtmux, packages }
  },
  async lua() {
    const { missing, body } = await getText('https://luarocks.org/manifests/tony')
    if (missing || !body) return null
    const start = body.search(/^\s{3}libtmux\s*=\s*{/m)
    if (start < 0) return null
    const rest = body.slice(start)
    const next = rest.slice(rest.indexOf('\n') + 1).search(/^\s{3}[\w.-]+\s*=\s*{/m)
    const section = next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next)
    const versions = [...section.matchAll(/^\s{6}\["([^"]+)"\]\s*=\s*{/gm)].map((match) => match[1])
    return versions.length > 0 ? versions : null
  },
  async powershell(port) {
    const packages = {}
    for (const name of ['LibTmux', 'LibTmux.Workspace']) packages[name] = await galleryVersions(name, port)
    return { versions: packages.LibTmux, packages }
  },
  async julia(port) {
    const { status, body } = await getText(
      'https://raw.githubusercontent.com/JuliaRegistries/General/master/L/LibTmux/Versions.toml',
    )
    if (status === 404) return null
    if (body === null) throw new Error(`General: HTTP ${status}`)
    return generalVersions(body, port)
  },
  async elixir() {
    // Hex lists every release and the retirements beside them. A retired
    // release stays installable, but no reader should be sent to one.
    const { missing, body } = await getJson('https://hex.pm/api/packages/libtmux')
    if (missing || !body || body.status === 404) return null
    const retired = new Set(Object.keys(body.retirements ?? {}))
    return (body.releases ?? []).map((release) => release.version).filter((version) => !retired.has(version))
  },
  async ts() {
    // `libtmux`, not the scoped `@libtmux/libtmux` this probe used to ask for.
    // The scoped name 404s, which classified a published package as having
    // nothing on npm and sent the prompt down the git install branch.
    const { missing, body } = await getJson('https://registry.npmjs.org/libtmux')
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
  async java(port) {
    const { missing, body } = await getText(
      `https://repo.maven.apache.org/maven2/${port.packageName.split(':')[0].replaceAll('.', '/')}/${port.packageName.split(':')[1]}/maven-metadata.xml`,
    )
    if (missing || !body) return null
    return [...body.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  },
  async kotlin(port) { return PROBES.java(port) },
  async scala(port) { return PROBES.java(port) },
  async fsharp(port) { return PROBES.csharp(port) },
  async csharp(port) {
    const { missing, body } = await getJson(
      `https://api.nuget.org/v3-flatcontainer/${port.packageName.toLowerCase()}/index.json`,
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
  return githubTags(port.repo)
}

/** Classify one port from the versions its registry carries. */
function classify(port, versions, tag) {
  if (versions === null || versions.length === 0) {
    return { status: 'unpublished', version: null, release: null, tag }
  }
  const ordered = newestFirst(versions, port.tagGrammar)
  const release = ordered.find((v) => !isPrerelease(v, port.tagGrammar)) ?? null
  return release
    ? { status: 'release', version: release, release, tag }
    : { status: 'prerelease', version: ordered[0], release: null, tag }
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(0)
}

/**
 * Preserve each published entry when --baseline is supplied. A newly added
 * port may not be published yet, so fill only missing entries from the seed.
 * Reading --out alone would leave a fresh output path without any fallback.
 */
const SCHEMA = 2
/** A file written under another schema is no fallback: its entries name other fields. */
const read = (path) => {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  return data.schema === SCHEMA ? data : { ports: {} }
}
const seed = existsSync(DEFAULT_OUT) ? read(DEFAULT_OUT) : existsSync(opts.out) ? read(opts.out) : { ports: {} }
const baseline = opts.baseline ? read(opts.baseline) : seed
const committed = { ports: { ...seed.ports, ...baseline.ports } }

const ports = {}
const notes = []
for (const port of PORTS) {
  if (!opts.offline && typeof PROBES[port.slug] !== 'function') throw new Error(`${port.slug}: no registry probe`)
  const previous = committed.ports?.[port.slug]
  if (opts.offline) {
    if (!previous) throw new Error(`--offline needs a committed entry for ${port.slug}`)
    ports[port.slug] = previous
    continue
  }
  let tags = null
  try {
    tags = await allTags(port)
  } catch {
    tags = null
  }
  /*
   * Not knowing is not the same as knowing there is nothing.
   *
   * Swift's registry is its own repository, so its status is read from tags.
   * With no checkout and no GitHub token the tag read fails, and folding that
   * into an empty list classified Swift `unpublished` in CI while a machine
   * with the checkout wrote `prerelease`: the generated file depended on where
   * it ran, which `--check` then reported as staleness on every CI run.
   */
  if (tags === null) {
    if (!previous) {
      throw new Error(`${port.slug}: could not read tags and nothing committed to fall back to`)
    }
    notes.push(`${port.slug}: could not read release tags, kept the committed entry`)
    ports[port.slug] = previous
    continue
  }
  let probe
  try {
    probe = await PROBES[port.slug](port, tags)
  } catch (error) {
    if (!previous) throw new Error(`${port.slug}: probe failed and nothing committed: ${error}`)
    notes.push(`${port.slug}: probe failed (${error.message}), kept committed value`)
    ports[port.slug] = previous
    continue
  }
  const versions = Array.isArray(probe) || probe === null ? probe : probe.versions
  // The full tag, not the version: `cargo --tag` and `git clone --branch`
  // need the name that exists in the repository. Only a published version's
  // tag counts, so a release caught between its tag and its package is not
  // recorded until the package lands.
  let tag = newestPublishedTag(tags, port, versions)
  if (!tag) {
    // A tag recorded before its package landed stays. One the repository does
    // not carry is stale, and would send readers to a ref that does not exist.
    tag = previous?.tag && tags.includes(previous.tag) ? previous.tag : null
    if (!tag) notes.push(`${port.slug}: no git tag found`)
  }
  const entry = classify(port, versions, tag)
  // A registry's own declaration outranks the stage a version string implies.
  const declared = (name) => (probe && !Array.isArray(probe) ? probe.declared?.[name] : undefined)
  const withStage = (classified, name) => (declared(name) ? { ...classified, maturity: declared(name) } : classified)
  if (declared(port.packageName)) entry.maturity = declared(port.packageName)
  if (probe && !Array.isArray(probe) && probe.packages) {
    entry.packages = Object.fromEntries(
      Object.entries(probe.packages).map(([name, packageVersions]) => [
        name,
        withStage(classify(port, packageVersions, probe.tagged && !probe.tagged.includes(name) ? null : tag), name),
      ]),
    )
  }
  ports[port.slug] = entry
}

const payload = {
  schema: SCHEMA,
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
