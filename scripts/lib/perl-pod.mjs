/**
 * What a CPAN release's POD offers, as MetaCPAN's own API reports it.
 *
 * MetaCPAN answers scripted clients' page requests with a challenge, so a link
 * into a release's POD cannot be checked on the page. Its API can: `release`
 * lists the modules a distribution provides, `module` says which file documents
 * each, `pod` renders that file's POD with the same renderer as the page, and
 * `source` returns the file. A rendered heading's `id` is the fragment the page
 * answers to, and the file's SHA-256 is what lets a reference page show that it
 * documents the same bytes the release shipped.
 *
 * The functions take a `get(url)` that answers `{ status, text, bytes }`, so a
 * test can serve them offline.
 */
import { createHash } from 'node:crypto'
import { readPage } from './api-html.mjs'
import { pageIdentity } from './api-identities.mjs'

export const API = 'https://fastapi.metacpan.org/v1'
export const SCHEMA = 1

const SHA256 = /^[a-f0-9]{64}$/
const MODULE = /^[A-Za-z_]\w*(?:::\w+)*$/
const FRAGMENT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt'])

async function json(get, url) {
  const response = await get(url)
  if (response.status !== 200) throw new Error(`${url} answered ${response.status}`)
  try {
    return JSON.parse(response.text)
  } catch {
    throw new Error(`${url} did not answer JSON`)
  }
}

/**
 * The fragments a rendered POD page answers to: the `id` of each heading and
 * each `=item`, in document order. A repeated heading is suffixed by the
 * renderer, so `new` and `new-1` are different fragments.
 */
export function podAnchors(html) {
  return [...new Set(readPage(html).anchors.filter((anchor) => FRAGMENT_TAGS.has(anchor.tag)).map((anchor) => anchor.id))]
}

/**
 * One distribution's latest release: the document each provided package
 * belongs to, and for each document its file, the file's SHA-256 and the
 * fragments of its rendered POD.
 *
 * A distribution that is not the latest released one, a package MetaCPAN lists
 * in another release, and a POD whose NAME section names another module all
 * throw: a link built from such a record would open the wrong page.
 */
export async function observeDistribution(get, dist) {
  const release = await json(get, `${API}/release/${dist}`)
  if (release?.distribution !== dist || release.status !== 'latest' || release.maturity !== 'released'
      || !/^\d+\.\d+$/.test(release.version ?? '') || !/^[A-Z0-9]+$/.test(release.author ?? '') || !Array.isArray(release.provides)) {
    throw new Error(`${dist}: MetaCPAN does not name it as a released distribution (${release?.distribution} ${release?.version} ${release?.status})`)
  }
  const packages = {}
  const files = new Map()
  for (const name of [...release.provides].sort()) {
    if (!MODULE.test(name)) throw new Error(`${dist}: ${name} is not a module name`)
    const module = await json(get, `${API}/module/${name}`)
    if (module?.distribution !== dist || module.release !== release.name) {
      throw new Error(`${dist}: MetaCPAN files ${name} under ${module?.release}, not ${release.name}`)
    }
    // A package without POD of its own, and one documented in another's file, are both recorded as the file says.
    const documented = module.documentation ?? null
    if (documented !== null && !MODULE.test(documented)) throw new Error(`${dist}: ${name} is documented as "${documented}"`)
    packages[name] = documented
    if (documented !== null) {
      if (files.has(documented) && files.get(documented) !== module.path) throw new Error(`${dist}: ${documented} is documented in two files`)
      files.set(documented, module.path)
    }
  }
  const documents = {}
  for (const [name, path] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^lib\/.+\.(?:pm|pod)$/.test(path)) throw new Error(`${dist}: ${name} is documented in ${path}, outside lib/`)
    const pod = await get(`${API}/pod/${name}`)
    if (pod.status !== 200) throw new Error(`${API}/pod/${name} answered ${pod.status}`)
    // The page's own NAME section decides what it documents, not its address.
    const identity = pageIdentity(`https://metacpan.org/pod/${name}`, readPage(pod.text))
    if (identity?.via !== 'pod' || identity.path.join('::') !== name) {
      throw new Error(`${dist}: the POD for ${name} names "${identity?.path?.join('::') ?? ''}" in its NAME section`)
    }
    const source = await get(`${API}/source/${release.author}/${release.name}/${path}`)
    if (source.status !== 200) throw new Error(`${API}/source/${release.author}/${release.name}/${path} answered ${source.status}`)
    documents[name] = { path, sha256: createHash('sha256').update(source.bytes).digest('hex'), anchors: podAnchors(pod.text) }
  }
  return { author: release.author, release: release.version, documents, packages }
}

/**
 * Everything wrong with a recorded observation, as sentences: the schema, a
 * package that names a document the record lacks, a document no package
 * names, a fragment listed twice, and a digest that is not one.
 */
export function problemsWith(data, expected) {
  const problems = []
  if (data?.schema !== SCHEMA) return [`schema is ${data?.schema}, expected ${SCHEMA}`]
  const recorded = Object.keys(data.distributions ?? {})
  for (const dist of expected) if (!recorded.includes(dist)) problems.push(`${dist} has no recorded release`)
  for (const dist of recorded) if (!expected.includes(dist)) problems.push(`${dist} is recorded but not a package of the port`)
  for (const [dist, release] of Object.entries(data.distributions ?? {})) {
    if (!/^\d+\.\d+$/.test(release.release ?? '')) problems.push(`${dist}: release "${release.release}" is not a decimal version`)
    for (const [name, document] of Object.entries(release.documents ?? {})) {
      if (!SHA256.test(document.sha256 ?? '')) problems.push(`${dist}: ${name} has no SHA-256`)
      if (!(document.path ?? '').startsWith('lib/')) problems.push(`${dist}: ${name} is documented outside lib/`)
      if (new Set(document.anchors).size !== document.anchors?.length || !document.anchors?.includes('NAME')) problems.push(`${dist}: ${name} lists its fragments wrongly`)
      if (!Object.values(release.packages ?? {}).includes(name)) problems.push(`${dist}: no package is documented by ${name}`)
    }
    for (const [name, documented] of Object.entries(release.packages ?? {})) {
      if (documented !== null && !(documented in (release.documents ?? {}))) problems.push(`${dist}: ${name} is documented by ${documented}, which the record lacks`)
    }
  }
  return problems
}
