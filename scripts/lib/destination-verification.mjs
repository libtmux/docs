/**
 * Check that a destination the header links to is the one it claims to be.
 *
 * A 200 is not evidence. Maven Central, crates.io and npm answer every package
 * name with the same application shell, PyPI answers with a client challenge,
 * and javadoc.io redirects an artifact it has no documentation for to a
 * version list. Each host therefore names the source of its identity: the page
 * title where the page is rendered on the server, the host's own JSON or XML
 * where it is not. The destination's URL decides what identity to expect, so a
 * link can only pass by naming the thing the host actually serves.
 *
 * A name alone is not enough either: registries share a namespace, so a host
 * that reports a repository must report one of the repositories whose entries
 * own the destination. And the version the pinned manifest declares must be on
 * the host wherever the host lists versions; where it cannot say, the record
 * says it could not.
 */

import { entryCandidates, entryDestinations } from '../../site/src/lib/port-inventory.ts'

export const USER_AGENT = 'libtmux-docs destination check (+https://libtmux.org)'

/**
 * Evidence older than this many days is stale: a host's answer is not permanent.
 * Staleness is enforced only where a live run is the natural remedy, which is
 * the verifier itself (`--check --fresh`, and the end of every live run). The
 * unit tests and the publication audit report it as a warning, because a PR
 * that touches none of this should not fail for the passage of time.
 */
export const EVIDENCE_MAX_AGE_DAYS = 60

/** Origins a test redirects to a local server, as `{ "https://pypi.org": "http://127.0.0.1:1234/pypi.org" }`. */
function rewrite(url, map) {
  for (const [origin, target] of Object.entries(map)) {
    if (url.startsWith(`${origin}/`) || url === origin) return `${target}${url.slice(origin.length)}`
  }
  return url
}
/** The inverse, so a redirect's final URL reads as the host it stands in for. */
function restore(url, map) {
  for (const [origin, target] of Object.entries(map)) {
    if (url.startsWith(`${target}/`) || url === target) return `${origin}${url.slice(target.length)}`
  }
  return url
}

/**
 * One GET with a deadline. A network error or a 5xx is retried; a 4xx is an answer.
 * Redirects are followed and `finalUrl` reports where they ended, because a
 * host that moves an unknown name elsewhere has said something about it.
 */
export function createGet({ rewriteOrigins = {}, timeoutMs = 25_000, retries = 2, pauseMs = 200 } = {}) {
  let last = 0
  return async function get(url, headers = {}) {
    const wait = last + pauseMs - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    let failure
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      last = Date.now()
      try {
        const response = await fetch(rewrite(url, rewriteOrigins), {
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,application/xml;q=0.8,*/*;q=0.7', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status >= 500 && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
          continue
        }
        return { status: response.status, finalUrl: restore(response.url, rewriteOrigins), text: await response.text() }
      } catch (error) {
        failure = error
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    return { status: 0, finalUrl: url, text: '', error: String(failure?.cause?.code ?? failure?.message ?? failure) }
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', middot: '·' }
const decode = (text) => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1)))
  return ENTITIES[name.toLowerCase()] ?? whole
})
export const titleOf = (html) => decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
const json = (text) => { try { return JSON.parse(text) } catch { return undefined } }
const pep503 = (name) => name.toLowerCase().replace(/[-_.]+/g, '-')
const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((match) => match[1])
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `owner/name` of the GitHub repository a URL, a `git+https` spec or an `scm:git:` string names. */
export function repoOf(value) {
  const match = /github\.com[/:]([^/\s"'<>]+)\/([^/\s"'<>#?]+?)(?:\.git)?(?=[/#?"'\s<>]|$)/i.exec(value ?? '')
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined
}
const reposOf = (values) => [...new Set(values.map(repoOf).filter(Boolean))]

const pass = (fields) => ({ ok: true, ...fields })
const fail = (failure, detail, fields = {}) => ({ ok: false, failure, detail, ...fields })

/** The status check shared by every host: anything but 200 is the answer. */
const answered = (response, requested) => response.status === 200
  ? undefined
  : fail('status', response.status === 0 ? `no response from ${requested}: ${response.error}` : `${requested} answered ${response.status}`,
    { status: response.status, requested })

/** The repository a Maven POM names: its `scm` and its project URL. */
async function pomRepositories(get, group, artifact, version) {
  const response = await get(`https://repo1.maven.org/maven2/${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}.pom`)
  return response.status === 200 ? reposOf([...tag(response.text, 'url'), ...tag(response.text, 'connection')]) : []
}

/**
 * Verifiers by host id. Each takes the destination and the shared `get`, and
 * returns `{ ok, status, requested, identity, version?, versions?, exact?,
 * repository? }` or a failure naming `status` (the host did not answer 200)
 * or `identity` (it answered, about something else). `versions` lists what the
 * host carries and `exact(version)` asks about one; `repository` lists the
 * repositories the host reports for the package, and `directory` the
 * subdirectory it reports.
 */
const VERIFIERS = {
  /** A host with no identity rule can show that a page is absent but never that it is the right one. */
  async unknown({ url }, { get }) {
    const response = await get(url)
    return answered(response, url) ?? fail('unverifiable', `${url} answered 200 and no identity rule exists for ${new URL(url).hostname}`, { status: 200, requested: url })
  },

  async github({ url }, { get }) {
    const [, owner, repo, view, ref, path] = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/(tree|blob)\/([^/]+)\/(.+))?$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    // GitHub follows a renamed repository to its new name, so where the request ended is part of the identity.
    const wanted = `/${owner}/${repo}${path ? `/${view}/${ref}/${path}` : ''}`.toLowerCase()
    const ended = new URL(response.finalUrl).pathname.replace(/\/$/, '').toLowerCase()
    if (ended !== wanted) return fail('identity', `${url} ended at ${response.finalUrl}: the repository was renamed or moved`, { status: 200, requested: url })
    const title = titleOf(response.text)
    // Titles read "repo/path at ref · owner/repo · GitHub" for a directory or a file, or "GitHub - owner/repo: summary · GitHub".
    const matches = path
      ? title.toLowerCase() === `${repo}/${path} at ${ref} · ${owner}/${repo} · GitHub`.toLowerCase()
      : new RegExp(`^GitHub - ${escapeRegExp(`${owner}/${repo}`)}(?:: .*)?(?: · GitHub)?$`, 'i').test(title)
    return matches ? pass({ status: 200, requested: url, identity: `${owner}/${repo}${path ? `/${path}` : ''}` })
      : fail('identity', `title is "${title}", expected one naming ${owner}/${repo}${path ? `/${path}` : ''}`, { status: 200, requested: url })
  },

  async pypi({ url }, { get }) {
    const name = /^https:\/\/pypi\.org\/project\/([^/]+)\/?$/.exec(url)?.[1]
    // The project page is behind a client challenge that answers 200 to every name.
    const requested = `https://pypi.org/pypi/${name}/json`
    const response = await get(requested)
    const missing = answered(response, requested)
    if (missing) return missing
    const body = json(response.text)
    if (pep503(body?.info?.name ?? '') !== pep503(name)) return fail('identity', `PyPI names the project "${body?.info?.name}", expected "${name}"`, { status: 200, requested })
    const versions = Object.entries(body.releases ?? {}).filter(([, files]) => files.length > 0).map(([version]) => version)
    return pass({ status: 200, requested, identity: body.info.name, version: body.info.version, versions, shell: true,
      repository: reposOf([body.info.home_page, ...Object.values(body.info.project_urls ?? {})]) })
  },

  async npm({ url }, { get }) {
    const name = decodeURIComponent(/^https:\/\/www\.npmjs\.com\/package\/(.+)$/.exec(url)?.[1] ?? '')
    // npmjs.com serves a bot challenge (403) to scripted clients; the registry names the package.
    const requested = `https://registry.npmjs.org/${name.replace('/', '%2f')}`
    const response = await get(requested)
    const missing = answered(response, requested)
    if (missing) return missing
    const body = json(response.text)
    if (body?.name !== name) return fail('identity', `npm names the package "${body?.name}", expected "${name}"`, { status: 200, requested })
    return pass({ status: 200, requested, identity: body.name, version: body['dist-tags']?.latest, versions: Object.keys(body.versions ?? {}), shell: true,
      repository: reposOf([typeof body.repository === 'string' ? body.repository : body.repository?.url]), directory: body.repository?.directory })
  },

  async crates({ url }, { get }) {
    const name = /^https:\/\/crates\.io\/crates\/([^/]+)$/.exec(url)?.[1]
    // The page is a client-rendered shell that answers 200 to any crate name.
    const requested = `https://crates.io/api/v1/crates/${name}`
    const response = await get(requested)
    const missing = answered(response, requested)
    if (missing) return missing
    const body = json(response.text)
    if (body?.crate?.name !== name) return fail('identity', `crates.io names the crate "${body?.crate?.name}", expected "${name}"`, { status: 200, requested })
    const live = (body.versions ?? []).filter((version) => !version.yanked)
    return pass({ status: 200, requested, identity: body.crate.name, version: body.crate.max_version, versions: live.map((version) => version.num), shell: true,
      repository: reposOf([body.crate.repository]) })
  },

  async rubygems({ url }, { get }) {
    const name = /^https:\/\/rubygems\.org\/gems\/([^/]+)$/.exec(url)?.[1]
    const requested = `https://rubygems.org/api/v1/gems/${name}.json`
    const response = await get(requested)
    const missing = answered(response, requested)
    if (missing) return missing
    const body = json(response.text)
    if (body?.name !== name) return fail('identity', `RubyGems names the gem "${body?.name}", expected "${name}"`, { status: 200, requested })
    const listing = await get(`https://rubygems.org/api/v1/versions/${name}.json`)
    const versions = (json(listing.text) ?? []).filter((release) => !release.yanked_at).map((release) => release.number)
    return pass({ status: 200, requested, identity: body.name, version: body.version, versions, repository: reposOf([body.source_code_uri, body.homepage_uri]) })
  },

  async 'powershell-gallery'({ url }, { get }) {
    const name = /^https:\/\/www\.powershellgallery\.com\/packages\/([^/]+)$/.exec(url)?.[1]
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const match = /^PowerShell Gallery \| (\S+) (\S+)$/.exec(title)
    if (match?.[1].toLowerCase() !== name.toLowerCase()) return fail('identity', `title is "${title}", expected the module ${name}`, { status: 200, requested: url })
    // The v2 feed answers an exact Id and Version, which a listing page cannot, and carries the project URL.
    const feed = (version) => get(`https://www.powershellgallery.com/api/v2/Packages(Id='${name}',Version='${version}')`)
    const latest = await feed(match[2])
    return pass({ status: 200, requested: url, identity: match[1], version: match[2],
      repository: reposOf(tag(latest.text.replaceAll(/<(\/?)d:/g, '<$1'), 'ProjectUrl')),
      exact: async (version) => (version === match[2] ? latest : await feed(version)).status === 200 })
  },

  async nuget({ url }, { get }) {
    const name = /^https:\/\/www\.nuget\.org\/packages\/([^/]+)$/.exec(url)?.[1]
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const match = /^NuGet Gallery \| (\S+) (\S+)$/.exec(title)
    if (match?.[1].toLowerCase() !== name.toLowerCase()) return fail('identity', `title is "${title}", expected the package ${name}`, { status: 200, requested: url })
    const id = name.toLowerCase()
    const listing = json((await get(`https://api.nuget.org/v3-flatcontainer/${id}/index.json`)).text)
    const nuspec = await get(`https://api.nuget.org/v3-flatcontainer/${id}/${match[2].toLowerCase()}/${id}.nuspec`)
    return pass({ status: 200, requested: url, identity: match[1], version: match[2], versions: listing?.versions,
      repository: reposOf([...tag(nuspec.text, 'projectUrl'), ...[...nuspec.text.matchAll(/<repository\b[^>]*\burl="([^"]+)"/g)].map((entry) => entry[1])]) })
  },

  async luarocks({ url }, { get }) {
    const [, owner, name] = /^https:\/\/luarocks\.org\/modules\/([^/]+)\/([^/]+)$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    if (title !== `${name} - LuaRocks`) return fail('identity', `title is "${title}", expected "${name} - LuaRocks"`, { status: 200, requested: url })
    // The page lists its versions and the rockspec's homepage.
    const versions = [...response.text.matchAll(new RegExp(`href="/modules/${escapeRegExp(owner)}/${escapeRegExp(name)}/([^"/]+)"`, 'g'))].map((entry) => entry[1])
    const homepage = /<h3>Homepage<\/h3><a[^>]*href="([^"]+)"/.exec(response.text)?.[1]
    return pass({ status: 200, requested: url, identity: `${owner}/${name}`, version: versions[0], versions, repository: reposOf([homepage]) })
  },

  async 'maven-central'({ url }, { get }) {
    const [, group, artifact] = /^https:\/\/central\.sonatype\.com\/artifact\/([^/]+)\/([^/]+)$/.exec(url) ?? []
    // The page answers 200 for any coordinate, so the repository's metadata decides.
    const requested = `https://repo1.maven.org/maven2/${group.replaceAll('.', '/')}/${artifact}/maven-metadata.xml`
    const response = await get(requested)
    const missing = answered(response, requested)
    if (missing) return missing
    const [groupId] = tag(response.text, 'groupId')
    const [artifactId] = tag(response.text, 'artifactId')
    if (groupId !== group || artifactId !== artifact) return fail('identity', `Central names ${groupId}:${artifactId}, expected ${group}:${artifact}`, { status: 200, requested })
    const release = tag(response.text, 'release')[0]
    return pass({ status: 200, requested, identity: `${groupId}:${artifactId}`, version: release, versions: tag(response.text, 'version'), shell: true,
      repository: await pomRepositories(get, group, artifact, release) })
  },

  async 'swift-package-index'({ url }, { get }) {
    const [, owner, repo, target] = /^https:\/\/swiftpackageindex\.com\/([^/]+)\/([^/]+)(?:\/documentation\/([^/]+))?$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const base = `https://swiftpackageindex.com/${owner}/${repo}`
    if (target) {
      // Documentation redirects to the release it was built for, so the final path names the version.
      const version = new RegExp(`^${escapeRegExp(base)}/([^/]+)/documentation/${escapeRegExp(target)}/?$`, 'i').exec(response.finalUrl)?.[1]
      return version && title.endsWith('Documentation – Swift Package Index')
        ? pass({ status: 200, requested: url, identity: `${owner}/${repo} ${target}`, version, repository: [`${owner}/${repo}`.toLowerCase()],
          exact: async (wanted) => (await get(`${base}/${wanted}/documentation/${target}`)).status === 200 })
        : fail('identity', `${url} ended at ${response.finalUrl} titled "${title}"`, { status: 200, requested: url })
    }
    const names = response.text.toLowerCase().includes(`github.com/${owner}/${repo}`.toLowerCase())
    return title.endsWith('Swift Package Index') && names
      // The page lists only the newest releases, but the index keeps the documentation of each release it has built,
      // and a SwiftPM release is a Git tag.
      ? pass({ status: 200, requested: url, identity: `${owner}/${repo}`, repository: [`${owner}/${repo}`.toLowerCase()],
        exact: async (version) => {
          if (new RegExp(`(?<![\\w.-])${escapeRegExp(version)}(?![\\w.-])`).test(response.text)) return true
          const docs = await get(`${base}/${version}/documentation`)
          return docs.status === 200 && titleOf(docs.text).endsWith('Documentation – Swift Package Index')
        } })
      : fail('identity', `title is "${title}" and the page does not name ${owner}/${repo}`, { status: 200, requested: url })
  },

  async 'pkg-go-dev'({ url }, { get }) {
    const path = new URL(url).pathname.slice(1)
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    // "tmux package - github.com/…/tmux - Go Packages", or "module" or "command" for those.
    return title.endsWith(` - ${path} - Go Packages`)
      ? pass({ status: 200, requested: url, identity: path,
        // A package path is inside a module and the proxy knows only the module. The module is the longest prefix
        // that lists versions at all; asking a shorter one for the version would let a parent's tag confirm a nested module.
        exact: async (version) => {
          const segments = path.split('/')
          for (let length = segments.length; length >= 3; length -= 1) {
            const modulePath = segments.slice(0, length).join('/')
            if ((await get(`https://proxy.golang.org/${modulePath}/@v/list`)).status !== 200) continue
            const info = await get(`https://proxy.golang.org/${modulePath}/@v/v${version}.info`)
            // The proxy reports where in the repository the module lives; it must be the directory the path names.
            const subdir = json(info.text)?.Origin?.Subdir ?? ''
            return info.status === 200 && subdir === segments.slice(3, length).join('/')
          }
          return false
        } })
      : fail('identity', `title is "${title}", expected one naming ${path}`, { status: 200, requested: url })
  },

  async 'docs-rs'({ url }, { get }) {
    const name = /^https:\/\/docs\.rs\/([^/]+)$/.exec(url)?.[1]
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const version = new RegExp(`^https://docs\\.rs/${escapeRegExp(name)}/([^/]+)/`).exec(response.finalUrl)?.[1]
    return title === `${name.replaceAll('-', '_')} - Rust` && version
      ? pass({ status: 200, requested: url, identity: name, ...(version !== 'latest' && { version }),
        exact: async (wanted) => (await get(`https://docs.rs/${name}/${wanted}/`)).status === 200 })
      : fail('identity', `title is "${title}" at ${response.finalUrl}, expected the crate ${name}`, { status: 200, requested: url })
  },

  async 'javadoc-io'({ url }, { get }) {
    const [, group, artifact] = /^https:\/\/javadoc\.io\/doc\/([^/]+)\/([^/]+)$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    // An artifact without documentation lands on a version list titled "group:artifact versions".
    const named = (version) => new RegExp(`^${escapeRegExp(artifact)} ${escapeRegExp(version)} javadoc \\(${escapeRegExp(group)}\\)$`)
    const match = new RegExp(`^${escapeRegExp(artifact)} (\\S+) javadoc \\(${escapeRegExp(group)}\\)$`).exec(title)
    return match ? pass({ status: 200, requested: url, identity: `${group}:${artifact}`, version: match[1],
      repository: await pomRepositories(get, group, artifact, match[1]),
      exact: async (wanted) => { const page = await get(`${url}/${wanted}`); return page.status === 200 && named(wanted).test(titleOf(page.text)) } })
      : fail('identity', `title is "${title}" at ${response.finalUrl}, expected ${artifact} documentation`, { status: 200, requested: url })
  },

  async hex({ url }, { get }) {
    const name = /^https:\/\/hex\.pm\/packages\/([^/]+)$/.exec(url)?.[1]
    // The page is rendered on the server and answers 404 for an unknown name, so its title is the identity.
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    if (title !== `${name} | Hex`) return fail('identity', `title is "${title}", expected "${name} | Hex"`, { status: 200, requested: url })
    // The API lists the releases and the links the package's owner declared.
    const requested = `https://hex.pm/api/packages/${name}`
    const listing = await get(requested, { accept: 'application/json' })
    const refused = answered(listing, requested)
    if (refused) return refused
    const body = json(listing.text)
    return pass({ status: 200, requested: url, identity: name, version: body?.latest_version, versions: (body?.releases ?? []).map((release) => release.version),
      repository: reposOf(Object.values(body?.meta?.links ?? {})) })
  },

  async hexdocs({ url }, { get }) {
    // HexDocs serves each package from its own subdomain: the newest release at the root, each release under its version.
    const name = /^https:\/\/([^./]+)\.hexdocs\.pm\/?$/.exec(url)?.[1]
    if (!name) return fail('identity', `${url} is not a package's subdomain of hexdocs.pm`)
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    // ExDoc titles every page "name vVERSION", an em dash (U+2014) and "Documentation".
    const titled = (version) => `${name} v${version} \u2014 Documentation`
    const version = new RegExp(`^${escapeRegExp(name)} v(\\S+) \\u2014 Documentation$`).exec(title)?.[1]
    return version
      ? pass({ status: 200, requested: url, identity: name, version,
        exact: async (wanted) => { const page = await get(`https://${name}.hexdocs.pm/${wanted}/`); return page.status === 200 && titleOf(page.text) === titled(wanted) } })
      : fail('identity', `title is "${title}", expected the documentation of ${name}`, { status: 200, requested: url })
  },
}

/**
 * How many times a host's answer must agree before it counts as stable.
 * javadoc.io builds documentation on first request and has changed its answer
 * between requests for one artifact; the others are static.
 */
const SAMPLES = { 'javadoc-io': 3 }

/**
 * Whether a host can say if a version exists. Every host here can except a
 * branch link on GitHub, which names no release; a record for any other host
 * that declined to confirm a version it was asked about is a defect.
 */
export const VERSION_SUPPORT = {
  github: false, pypi: true, npm: true, crates: true, rubygems: true, 'powershell-gallery': true, nuget: true, luarocks: true,
  'maven-central': true, 'swift-package-index': true, 'pkg-go-dev': true, 'docs-rs': true, 'javadoc-io': true, hex: true, hexdocs: true,
}
/** Hosts whose records must name the repository the host reports. */
export const REPOSITORY_HOSTS = new Set(['pypi', 'npm', 'crates', 'rubygems', 'powershell-gallery', 'nuget', 'luarocks', 'maven-central', 'swift-package-index', 'javadoc-io', 'hex'])

const HOSTNAMES = {
  'pypi.org': 'pypi', 'www.npmjs.com': 'npm', 'crates.io': 'crates', 'rubygems.org': 'rubygems',
  'www.powershellgallery.com': 'powershell-gallery', 'www.nuget.org': 'nuget', 'luarocks.org': 'luarocks',
  'central.sonatype.com': 'maven-central', 'swiftpackageindex.com': 'swift-package-index', 'pkg.go.dev': 'pkg-go-dev',
  'docs.rs': 'docs-rs', 'javadoc.io': 'javadoc-io', 'github.com': 'github', 'hex.pm': 'hex',
}
/** The host id of a URL; HexDocs serves each package from a subdomain of `hexdocs.pm`. */
export const hostOf = (url) => {
  const { hostname } = new URL(url)
  return HOSTNAMES[hostname] ?? (hostname.endsWith('.hexdocs.pm') ? 'hexdocs' : undefined)
}

/**
 * What a host said about each version a manifest declares for the destination.
 * Ports that pin different releases of one package (NuGet's LibTmux is
 * pinned to different prereleases by C# and F#) each get a check of their own.
 */
async function versionChecks(result, destination) {
  const expected = destination.expected ?? []
  if (expected.length === 0) {
    return [{ check: 'unsupported', note: destination.kinds.every((kind) => kind === 'source') ? 'a branch link names no release' : 'no manifest declares a version for this destination' }]
  }
  const checks = []
  for (const { version, source, ports } of expected) {
    const base = { version, source, ports }
    if (typeof result.exact === 'function') checks.push({ ...base, check: (await result.exact(version)) ? 'confirmed' : 'absent' })
    else if (Array.isArray(result.versions)) checks.push({ ...base, check: result.versions.includes(version) ? 'confirmed' : 'absent' })
    else checks.push({ ...base, check: 'unsupported', note: `${destination.host} does not list versions` })
  }
  return checks
}

/**
 * Verify one destination, taking the host's answer as many times as it asks for.
 * `destination` is `{ url, host, kinds, repos, paths, expected }`: the
 * repositories and directories of the entries that own it, and the versions
 * their distributions' manifests declare, one per distinct release.
 */
export async function verifyDestination(destination, { get, samples = SAMPLES }) {
  const verifier = VERIFIERS[destination.host] ?? VERIFIERS.unknown
  const count = samples[destination.host] ?? 1
  const answers = []
  for (let attempt = 0; attempt < count; attempt += 1) answers.push(await verifier(destination, { get }))
  const [first] = answers
  const unstable = answers.some((answer) => answer.ok !== first.ok || answer.identity !== first.identity)
  const base = { url: destination.url, kinds: destination.kinds, host: destination.host }
  if (unstable) {
    return { ...base, ok: false, failure: 'unstable', status: first.status, detail: `${count} requests disagreed: ${answers.map((answer) => (answer.ok ? answer.identity : answer.detail)).join(' | ')}`, samples: count }
  }
  const { exact: _exact, versions: _versions, shell, repository, directory, ...rest } = first
  if (!first.ok) return { ...base, ...rest, ...(count > 1 && { samples: count }) }
  // A shared namespace names its owner: the host must report a repository, and one that an owning entry lives in.
  if (REPOSITORY_HOSTS.has(destination.host) && !repository?.length) {
    return { ...base, ...rest, ok: false, failure: 'repository', detail: `${destination.host} names no repository for ${destination.url}` }
  }
  const expected = (destination.repos ?? []).map((repo) => repo.toLowerCase())
  if (repository && expected.length > 0 && !repository.some((repo) => expected.includes(repo))) {
    return { ...base, ...rest, ok: false, failure: 'repository', detail: `${destination.host} reports ${repository.join(', ')} for ${destination.url}, expected ${expected.join(' or ')}`, repository }
  }
  if (directory && (destination.paths ?? []).length > 0 && !destination.paths.includes(directory)) {
    return { ...base, ...rest, ok: false, failure: 'repository', detail: `${destination.host} reports the directory ${directory} for ${destination.url}, expected ${destination.paths.join(' or ')}`, repository }
  }
  const checks = await versionChecks(first, destination)
  const pageStatus = shell ? (await get(destination.url)).status : undefined
  return { ...base, ...rest, ...(repository && { repository: repository.find((repo) => expected.includes(repo)) ?? repository[0] }), ...(directory && { directory }),
    // These hosts answer the destination page with a shell or a challenge, so what it returns is kept beside the proof.
    ...(pageStatus !== undefined && { pageStatus }), versionChecks: checks, ...(count > 1 && { samples: count }) }
}

/**
 * The distribution an entry ships in: itself, or the entry that holds it.
 * A `within` that names no entry, or that leads back to where it began, is a
 * mistake in the inventory, so it throws with the chain.
 */
function distributionOf(entries, entry) {
  const chain = [entry.id]
  let current = entry
  while (current.within) {
    const next = entries.find((candidate) => candidate.id === current.within)
    if (!next) throw new Error(`${chain.join(' -> ')}: within names ${current.within}, which is not an entry`)
    chain.push(next.id)
    if (chain.indexOf(next.id) !== chain.length - 1) throw new Error(`${chain.join(' -> ')}: within leads back to ${next.id}`)
    current = next
  }
  return current
}

/**
 * The version the pinned manifest declares for the distribution an entry
 * belongs to, and the manifest file it came from.
 */
export function manifestVersion(manifests, port, entries, entry) {
  const distribution = distributionOf(entries, entry)
  const found = manifests?.ports?.[port]?.distributions?.find((candidate) => candidate.name === distribution.coordinate)
  return found ? { version: found.version, source: `${found.repo}:${found.manifest}` } : undefined
}

/**
 * The destinations to request, once per URL.
 *
 * A published entry is requested everywhere it names. An entry that is only
 * configured or planned is requested at its package and API pages, which are
 * what its status says are absent; its source directory is not linked, so it
 * is not asked about. Candidates an entry lists as unavailable are requested
 * too. Entries that share a URL share its verification, so the record names
 * them all, the repositories and directories they live in, and the version
 * the manifest declares for their distribution.
 */
export function collectDestinations(inventory, manifests) {
  /** @type {Map<string, { url: string, host: string, kinds: string[], entries: { port: string, id: string, status: string }[], repos: string[], paths: string[], expected: { version: string, source: string, ports: string[] }[] }>} */
  const found = new Map()
  const add = (port, entry, { kind, url, host }, status) => {
    const known = found.get(url) ?? { url, host, kinds: [], entries: [], repos: [], paths: [], expected: [] }
    if (!known.kinds.includes(kind)) known.kinds.push(kind)
    // An entry whose package page is also its reference names the URL twice.
    if (!known.entries.some((owner) => owner.port === port && owner.id === entry.id)) known.entries.push({ port, id: entry.id, status })
    if (!known.repos.includes(entry.repo)) known.repos.push(entry.repo)
    if (entry.path && !known.paths.includes(entry.path)) known.paths.push(entry.path)
    // Each port that owns the destination pins its own release, so each is checked.
    if (status === 'published' && kind !== 'source') {
      const declared = manifestVersion(manifests, port, inventory[port], entry)
      const same = known.expected.find((candidate) => candidate.version === declared?.version)
      if (declared && same) { if (!same.ports.includes(port)) same.ports.push(port) }
      else if (declared) known.expected.push({ version: declared.version, source: declared.source, ports: [port] })
    }
    found.set(url, known)
  }
  for (const [port, entries] of Object.entries(inventory)) {
    for (const entry of entries) {
      const unlinked = entry.status !== 'published'
      for (const destination of entryDestinations(entry)) {
        if (!unlinked || destination.kind !== 'source') add(port, entry, destination, entry.status)
      }
      for (const destination of entryCandidates(entry)) add(port, entry, destination, 'candidate')
    }
  }
  for (const destination of found.values()) destination.expected.sort((a, b) => a.version.localeCompare(b.version))
  return found
}

const DAY = 24 * 60 * 60 * 1000
const daysSince = (date, today) => Math.floor((today.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / DAY)
/** A check date may run a day ahead of the reader's clock; further than that was not a day that had happened. */
const FUTURE_TOLERANCE_DAYS = 1

/**
 * The records last checked more than `maxAgeDays` before `today`, oldest first.
 * This is a measurement, not a verdict: `checkEvidence` never fails on it.
 */
export function staleRecords(evidence, { today = new Date(), maxAgeDays = EVIDENCE_MAX_AGE_DAYS } = /** @type {{ today?: Date, maxAgeDays?: number }} */ ({})) {
  return evidence.destinations.filter((record) => daysSince(record.checkedAt, today) > maxAgeDays)
    .map((record) => ({ url: record.url, checkedAt: record.checkedAt, days: daysSince(record.checkedAt, today) }))
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt) || a.url.localeCompare(b.url))
}

/** The records dated later than `today` and a day's tolerance, which no run could have written. */
export function futureRecords(evidence, { today = new Date() } = /** @type {{ today?: Date }} */ ({})) {
  return evidence.destinations.filter((record) => daysSince(record.checkedAt, today) < -FUTURE_TOLERANCE_DAYS)
    .map((record) => ({ url: record.url, checkedAt: record.checkedAt }))
}

/**
 * Why a date a caller names cannot be used, if it cannot: it is not a day, or
 * with a `today` to measure from, it has not happened.
 */
export function dateProblem(date, today) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return `${date} is not a date (YYYY-MM-DD)`
  return today && daysSince(date, today) < -FUTURE_TOLERANCE_DAYS ? `${date} is in the future` : undefined
}

/** One line per check date for the stale records, with how to refresh them. */
export function staleWarnings(stale, maxAgeDays = EVIDENCE_MAX_AGE_DAYS) {
  const byDate = new Map()
  for (const record of stale) byDate.set(record.checkedAt, (byDate.get(record.checkedAt) ?? 0) + 1)
  return [...byDate].map(([date, count]) => `${count} destination record${count === 1 ? ' was' : 's were'} last checked ${date}, more than ${maxAgeDays} days ago: run node scripts/verify-destinations.mjs`)
}

/**
 * Where the inventory and the port table disagree, as sentences.
 *
 * A registered port the inventory omits gets no header links and no
 * verification, and nothing else notices: the header just offers nothing. So
 * each registered port must have an entry whose library is published, which is
 * what the header builds its links from, and each entry must belong to a
 * registered port.
 */
export function inventoryCoverage(inventory, registered) {
  const missing = registered.filter((slug) => !inventory[slug]?.length)
    .map((slug) => `${slug} is registered in ports.ts but has no inventory entry, so its header offers nothing`)
  const unlinked = registered.filter((slug) => inventory[slug]?.length && !inventory[slug].some((entry) => entry.kind === 'library' && entry.status === 'published'))
    .map((slug) => `${slug} has no published library entry, so its header offers nothing`)
  const orphaned = Object.keys(inventory).filter((slug) => !registered.includes(slug))
    .map((slug) => `${slug} has inventory entries but is not registered in ports.ts`)
  return [...missing, ...unlinked, ...orphaned]
}

/**
 * Every way the evidence and the inventory can disagree, as sentences.
 *
 * A published entry needs a passing record for each of its destinations. A
 * configured-but-unpublished one needs a failing record, so the day its host
 * starts serving it this reports that it can be enabled. A record that no
 * entry owns is stale, and every record carries a check date that is not in
 * the future. A registry's record must name a repository one of the owning
 * entries lives in, and an npm directory one of their directories: the
 * verifier refuses a mismatch when it runs, and this refuses an edited record.
 * A record whose manifest version the host lacks means the code the docs
 * describe was never released; a host that can list versions may not decline
 * to confirm one, and every version a record checked must be one the manifests
 * declare now, for every port that pins one. How old a record is does not
 * appear here: see `staleRecords`.
 */
export function checkEvidence(inventory, evidence, { manifests, today = new Date() } = /** @type {{ manifests?: any, today?: Date }} */ ({})) {
  const records = new Map(evidence.destinations.map((record) => [record.url, record]))
  const problems = []
  for (const record of evidence.destinations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.checkedAt ?? '')) problems.push(`${record.url} has no valid check date (${record.checkedAt ?? 'none'})`)
  }
  for (const { url, checkedAt } of futureRecords(evidence, { today })) problems.push(`${url} was checked ${checkedAt}, which is in the future`)
  const wanted = collectDestinations(inventory, manifests)
  for (const [url, destination] of wanted) {
    const record = records.get(url)
    const published = destination.entries.some(({ status }) => status === 'published')
    const owners = destination.entries.map(({ port, id }) => `${port}:${id}`).join(', ')
    if (!record) { problems.push(`${url} has no evidence (${owners})`); continue }
    if (published && !record.ok) { problems.push(`${url} is linked by ${owners} but failed verification: ${record.failure}, ${record.detail}`); continue }
    // A host with no identity rule cannot call a page absent when it answers 200.
    if (!published) {
      if (record.ok || record.failure === 'unverifiable') problems.push(`${url} answers, so ${owners} can be published`)
      continue
    }
    const checks = record.versionChecks ?? []
    if (checks.length === 0) problems.push(`${url} says nothing of its version; record why a host cannot confirm one`)
    for (const check of checks) {
      if (check.check === 'absent') problems.push(`${url} does not carry ${check.version}, the version ${check.source} declares for ${check.ports.join(', ')}`)
      else if (check.check !== 'confirmed' && check.version && VERSION_SUPPORT[destination.host]) {
        problems.push(`${url} could not confirm ${check.version} on ${destination.host}, which lists versions (${check.check}: ${check.note ?? 'no reason given'})`)
      }
    }
    if (manifests) {
      const checked = checks.filter((check) => check.version).map((check) => check.version).sort((a, b) => a.localeCompare(b))
      const declared = destination.expected.map((entry) => entry.version)
      if (JSON.stringify(checked) !== JSON.stringify(declared)) {
        problems.push(`${url} was checked for ${checked.join(', ') || 'no version'} but the manifests now declare ${declared.join(', ') || 'none'}`)
      }
    }
    if (REPOSITORY_HOSTS.has(destination.host)) {
      const repos = destination.repos.map((repo) => repo.toLowerCase())
      if (!record.repository) problems.push(`${url} names no owning repository`)
      else if (!repos.includes(record.repository)) problems.push(`${url} was verified against ${record.repository}, but ${owners} live in ${repos.join(', ')}`)
      if (record.directory && destination.paths.length > 0 && !destination.paths.includes(record.directory)) {
        problems.push(`${url} reports the directory ${record.directory}, but ${owners} live in ${destination.paths.join(', ')}`)
      }
    }
  }
  for (const url of records.keys()) if (!wanted.has(url)) problems.push(`${url} has evidence but no entry names it`)
  return problems
}
