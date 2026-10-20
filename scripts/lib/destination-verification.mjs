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
 */

import { entryCandidates, entryDestinations } from '../../site/src/lib/port-inventory.ts'

export const USER_AGENT = 'libtmux-docs destination check (+https://libtmux.org)'

/** Origins a test redirects to a local server, as `{ "https://pypi.org": "http://127.0.0.1:1234/pypi.org" }`. */
function rewrite(url, map) {
  for (const [origin, target] of Object.entries(map)) {
    if (url.startsWith(`${origin}/`) || url === origin) return `${target}${url.slice(origin.length)}`
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
        return { status: response.status, finalUrl: response.url, text: await response.text() }
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

const pass = (fields) => ({ ok: true, ...fields })
const fail = (failure, detail, fields = {}) => ({ ok: false, failure, detail, ...fields })

/** The status check shared by every host: anything but 200 is the answer. */
const answered = (response, requested) => response.status === 200
  ? undefined
  : fail('status', response.status === 0 ? `no response from ${requested}: ${response.error}` : `${requested} answered ${response.status}`,
    { status: response.status, requested })

/**
 * Verifiers by host id. Each takes the destination and the shared `get`, and
 * returns `{ ok, status, requested, identity, version?, versions? }` or a
 * failure naming `status` (the host did not answer 200) or `identity` (it
 * answered, about something else).
 */
const VERIFIERS = {
  /** A host with no identity rule can show that a page is absent but never that it is the right one. */
  async unknown({ url }, { get }) {
    const response = await get(url)
    return answered(response, url) ?? fail('unverifiable', `${url} answered 200 and no identity rule exists for ${new URL(url).hostname}`, { status: 200, requested: url })
  },

  async github({ url }, { get }) {
    const [, owner, repo, ref, path] = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+)\/(.+))?$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    // Titles read "repo/path at ref · owner/repo · GitHub", or "GitHub - owner/repo: summary".
    const expected = path ? `${repo}/${path} at ${ref} · ${owner}/${repo} · GitHub` : `GitHub - ${owner}/${repo}`
    const matches = path ? title === expected : title.startsWith(expected)
    return matches ? pass({ status: 200, requested: url, identity: `${owner}/${repo}${path ? `/${path}` : ''}` })
      : fail('identity', `title is "${title}", expected "${expected}"`, { status: 200, requested: url })
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
    return pass({ status: 200, requested, identity: body.info.name, version: body.info.version, versions, shell: true })
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
    return pass({ status: 200, requested, identity: body.name, version: body['dist-tags']?.latest, versions: Object.keys(body.versions ?? {}), shell: true })
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
    return pass({ status: 200, requested, identity: body.crate.name, version: body.crate.max_version, versions: live.map((version) => version.num), shell: true })
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
    return pass({ status: 200, requested, identity: body.name, version: body.version, versions })
  },

  async 'powershell-gallery'({ url }, { get }) {
    const name = /^https:\/\/www\.powershellgallery\.com\/packages\/([^/]+)$/.exec(url)?.[1]
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const match = /^PowerShell Gallery \| (\S+) (\S+)$/.exec(title)
    if (match?.[1].toLowerCase() !== name.toLowerCase()) return fail('identity', `title is "${title}", expected the module ${name}`, { status: 200, requested: url })
    return pass({ status: 200, requested: url, identity: match[1], version: match[2],
      // The v2 feed answers an exact Id and Version, which a listing page cannot.
      exact: async (version) => (await get(`https://www.powershellgallery.com/api/v2/Packages(Id='${name}',Version='${version}')`)).status === 200 })
  },

  async nuget({ url }, { get }) {
    const name = /^https:\/\/www\.nuget\.org\/packages\/([^/]+)$/.exec(url)?.[1]
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    const match = /^NuGet Gallery \| (\S+) (\S+)$/.exec(title)
    if (match?.[1].toLowerCase() !== name.toLowerCase()) return fail('identity', `title is "${title}", expected the package ${name}`, { status: 200, requested: url })
    const listing = json((await get(`https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`)).text)
    return pass({ status: 200, requested: url, identity: match[1], version: match[2], versions: listing?.versions })
  },

  async luarocks({ url }, { get }) {
    const [, owner, name] = /^https:\/\/luarocks\.org\/modules\/([^/]+)\/([^/]+)$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    if (title !== `${name} - LuaRocks`) return fail('identity', `title is "${title}", expected "${name} - LuaRocks"`, { status: 200, requested: url })
    return pass({ status: 200, requested: url, identity: `${owner}/${name}`,
      exact: async (version) => (await get(`${url}/${version}`)).status === 200 })
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
    return pass({ status: 200, requested, identity: `${groupId}:${artifactId}`, version: tag(response.text, 'release')[0], versions: tag(response.text, 'version'), shell: true })
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
      const version = new RegExp(`^${base.replaceAll('.', '\\.')}/([^/]+)/documentation/${target}/?$`, 'i').exec(response.finalUrl)?.[1]
      return version && title.endsWith('Documentation – Swift Package Index')
        ? pass({ status: 200, requested: url, identity: `${owner}/${repo} ${target}`, version })
        : fail('identity', `${url} ended at ${response.finalUrl} titled "${title}"`, { status: 200, requested: url })
    }
    return title.endsWith('Swift Package Index') && response.text.includes(`github.com/${owner}/${repo}`)
      // The index lists the releases it has built, and a SwiftPM release is a Git tag.
      ? pass({ status: 200, requested: url, identity: `${owner}/${repo}`,
        exact: async (version) => new RegExp(`(?<![\\w.-])${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`).test(response.text) })
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
        // A package path is inside a module; the proxy knows only the module, so try the longest prefix first.
        exact: async (version) => {
          const segments = path.split('/')
          for (let length = segments.length; length >= 3; length -= 1) {
            if ((await get(`https://proxy.golang.org/${segments.slice(0, length).join('/')}/@v/${version}.info`)).status === 200) return true
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
    const version = new RegExp(`^https://docs\\.rs/${name}/([^/]+)/`).exec(response.finalUrl)?.[1]
    return title === `${name.replaceAll('-', '_')} - Rust` && version
      ? pass({ status: 200, requested: url, identity: name, version })
      : fail('identity', `title is "${title}" at ${response.finalUrl}, expected the crate ${name}`, { status: 200, requested: url })
  },

  async 'javadoc-io'({ url }, { get }) {
    const [, group, artifact] = /^https:\/\/javadoc\.io\/doc\/([^/]+)\/([^/]+)$/.exec(url) ?? []
    const response = await get(url)
    const missing = answered(response, url)
    if (missing) return missing
    const title = titleOf(response.text)
    // An artifact without documentation lands on a version list titled "group:artifact versions".
    const match = new RegExp(`^${artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\S+) javadoc \\(${group.replaceAll('.', '\\.')}\\)$`).exec(title)
    return match ? pass({ status: 200, requested: url, identity: `${group}:${artifact}`, version: match[1] })
      : fail('identity', `title is "${title}" at ${response.finalUrl}, expected ${artifact} documentation`, { status: 200, requested: url })
  },
}

/**
 * How many times a host's answer must agree before it counts as stable.
 * javadoc.io builds documentation on first request and has changed its answer
 * between requests for one artifact; the others are static.
 */
const SAMPLES = { 'javadoc-io': 3 }

/** Where each page host's package is named when it differs from the destination's own host id. */
const HOST_OF_PACKAGE = {
  'pypi.org': 'pypi', 'www.npmjs.com': 'npm', 'crates.io': 'crates', 'rubygems.org': 'rubygems',
  'www.powershellgallery.com': 'powershell-gallery', 'www.nuget.org': 'nuget', 'luarocks.org': 'luarocks',
  'central.sonatype.com': 'maven-central', 'swiftpackageindex.com': 'swift-package-index', 'pkg.go.dev': 'pkg-go-dev',
  'docs.rs': 'docs-rs', 'javadoc.io': 'javadoc-io', 'github.com': 'github',
}

export const hostOf = (url) => HOST_OF_PACKAGE[new URL(url).hostname]

/** Compare a host's versions with the one the registry snapshot records. */
async function versionEvidence(result, expected) {
  if (!expected) return {}
  if (typeof result.exact === 'function') return { expectedVersion: expected, versionFound: await result.exact(expected) }
  if (Array.isArray(result.versions)) return { expectedVersion: expected, versionFound: result.versions.includes(expected) }
  return {}
}

/**
 * Verify one destination, taking the host's answer as many times as it asks for.
 * `date` stays out of this function so a test can compare records.
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
  const { exact: _exact, versions: _versions, shell, ...rest } = first
  const evidence = await versionEvidence(first, destination.expectedVersion)
  // These hosts answer the destination page with a shell or a challenge, so what it returns is kept beside the proof.
  const pageStatus = shell ? (await get(destination.url)).status : undefined
  return { ...base, ...rest, ...(pageStatus !== undefined && { pageStatus }), ...evidence, ...(count > 1 && { samples: count }) }
}

/**
 * The destinations to request, once per URL.
 *
 * A published entry is requested everywhere it names. An entry that is only
 * configured or planned is requested at its package and API pages, which are
 * what its status says are absent; its source directory is not linked, so it
 * is not asked about. Candidates an entry lists as unavailable are requested
 * too. Entries that share a URL share its verification, so the record names
 * them all.
 */
export function collectDestinations(inventory) {
  const found = new Map()
  const add = (port, entry, { kind, url, host }, status) => {
    const known = found.get(url) ?? { url, host, kinds: [], entries: [] }
    if (!known.kinds.includes(kind)) known.kinds.push(kind)
    // An entry whose package page is also its reference names the URL twice.
    if (!known.entries.some((owner) => owner.port === port && owner.id === entry.id)) known.entries.push({ port, id: entry.id, status })
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
  return found
}

/**
 * Every way the evidence and the inventory can disagree, as sentences.
 *
 * A published entry needs a passing record for each of its destinations. A
 * configured-but-unpublished one needs a failing record, so the day its host
 * starts serving it this reports that it can be enabled. A record that no
 * entry owns is stale. A record whose registry version is absent from the host
 * means the host and the snapshot disagree about what was released.
 */
export function checkEvidence(inventory, evidence) {
  const records = new Map(evidence.destinations.map((record) => [record.url, record]))
  const problems = []
  const wanted = collectDestinations(inventory)
  for (const [url, destination] of wanted) {
    const record = records.get(url)
    const published = destination.entries.some(({ status }) => status === 'published')
    const owners = destination.entries.map(({ port, id }) => `${port}:${id}`).join(', ')
    if (!record) problems.push(`${url} has no evidence (${owners})`)
    else if (published && !record.ok) problems.push(`${url} is linked by ${owners} but failed verification: ${record.failure}, ${record.detail}`)
    // A host with no identity rule cannot call a page absent when it answers 200.
    else if (!published && (record.ok || record.failure === 'unverifiable')) problems.push(`${url} answers, so ${owners} can be published`)
    else if (record.versionFound === false) problems.push(`${url} does not carry ${record.expectedVersion}, the registry snapshot's version`)
  }
  for (const url of records.keys()) if (!wanted.has(url)) problems.push(`${url} has evidence but no entry names it`)
  return problems
}
