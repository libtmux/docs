/**
 * Check that a standard-library or SDK link lands on the symbol it names.
 *
 * A 200 proves a page exists, and the JDK shows how little that is: the old
 * search-URL template and a module-less path both answered 200 from a generic
 * landing page. So every destination is held to two questions the host's own
 * page can answer:
 *
 * - Does the fragment exist on the page the URL names? An `id` or `name`
 *   anchor, read from the HTML the host serves.
 * - Does the page, or the section the fragment opens, document the symbol the
 *   link was made for? The name that leads to the destination must appear as a
 *   whole word in the page's title and headings, in its fragment, or in the
 *   section the fragment opens.
 *
 * A redirect is an answer too. A host that moves a page elsewhere has said the
 * URL is not the page's address, so anything beyond a locale, a trailing slash
 * or a documentation view is a failure that names the final URL.
 *
 * A host that cannot be read this way (it blocks the request, rate-limits it
 * or renders the page in the browser) leaves the destination unverifiable with
 * the reason. It is never recorded as passing.
 */

import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTERNAL_INVENTORIES, LISTED_ON_PAGE, terminalSymbol } from './api-destinations.mjs'
import { readInventory } from '../../packages/api-model/src/inventory.ts'
import { USER_AGENT, futureRecords, staleRecords } from './destination-verification.mjs'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', middot: '.', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' }
const decode = (text) => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === '#') {
    try { return String.fromCodePoint(name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))) } catch { return whole }
  }
  return ENTITIES[name.toLowerCase()] ?? whole
})
// `<wbr>` marks a place a long name may break, so it joins the words around it.
const strip = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<wbr\s*\/?>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The words of a symbol compare case-insensitively and whole: `Set` is not in `SetAlgebra`. */
export const mentions = (text, symbol) => new RegExp(`(?<![a-z0-9])${escapeRegExp(symbol.toLowerCase())}(?![a-z0-9])`).test(text.toLowerCase())
const compact = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * What a rendered page offers to prove an identity: its title, headings, the
 * anchors it declares, and the text that sits under each anchor.
 */
export function readPage(html) {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: strip(match[2]) })).filter((heading) => heading.text)
  const anchors = []
  for (const match of html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[1] ?? match[2]
    if (value) anchors.push({ id: decode(value), at: match.index })
  }
  return { title, headings, anchors, html }
}

/**
 * The text a fragment opens: from its anchor to the next heading, bounded. An
 * anchor on a wrapper around a heading, or on the heading itself, opens the
 * text after that heading, not the heading alone.
 */
function sectionAt(page, fragment) {
  const decoded = safeDecode(fragment)
  const anchor = page.anchors.find((candidate) => candidate.id === fragment || candidate.id === decoded)
  if (!anchor) return undefined
  const rest = page.html.slice(anchor.at)
  const headings = [...rest.matchAll(/<h[1-4]\b/gi)]
  let end = headings[0]?.index
  if (end !== undefined && strip(rest.slice(0, end)).length < 40) end = headings[1]?.index
  return strip(rest.slice(0, Math.min(end ?? 40_000, 40_000)))
}

const safeDecode = (text) => { try { return decodeURIComponent(text) } catch { return text } }

/** Where a URL asks to land, split into the page and the fragment. */
export function splitUrl(url) {
  const hash = url.indexOf('#')
  return hash < 0 ? { page: url, fragment: '' } : { page: url.slice(0, hash), fragment: url.slice(hash + 1) }
}

/** The documentation views and locales a host adds to an address without changing the page. */
export function sameAddress(requested, final) {
  const norm = (url) => {
    const { hostname, pathname, search } = new URL(url)
    const query = new URLSearchParams(search)
    for (const key of ['view', 'tabs', 'wt.mc_id']) query.delete(key)
    const path = pathname.replace(/^\/en-us(?=\/)/i, '').replace(/\/+$/, '').toLowerCase()
    const rest = [...query].map(([key, value]) => `${key}=${value}`).join('&')
    return `${hostname.toLowerCase()}${path}${rest ? `?${rest}` : ''}`
  }
  try { return norm(requested) === norm(final) } catch { return false }
}

/**
 * The symbol a URL's own address names, for a page-only link whose name could
 * not say. Compared compactly, so `to-kotlin-duration.html` and
 * `toKotlinDuration` agree. Hosts that address by fragment need none.
 */
export function slugSymbol(url) {
  const { page } = splitUrl(url)
  const { hostname, pathname } = new URL(page)
  const last = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
  const stem = last.replace(/\.(?:html|htm)$/i, '')
  if (!stem) return undefined
  if (hostname === 'doc.rust-lang.org' || hostname === 'docs.rs') {
    const rustdoc = /^(?:struct|enum|trait|fn|macro|type|constant|primitive|union|attr|derive|keyword|static)\.(.+)$/.exec(stem)
    return rustdoc ? rustdoc[1] : stem === 'index' ? undefined : stem
  }
  if (hostname === 'learn.microsoft.com') {
    if (!pathname.toLowerCase().includes('/dotnet/api/') && !pathname.toLowerCase().includes('/powershell/module/')) return undefined
    return stem.replace(/-\d+$/, '').split('.').at(-1)
  }
  if (hostname === 'docs.oracle.com' && pathname.includes('/api/')) return stem === 'index' ? undefined : stem.replace(/\$$/, '')
  if (hostname === 'www.scala-lang.org' || hostname === 'typelevel.org' || hostname === 'javadoc.io') return stem === 'index' ? undefined : stem.replace(/\$$/, '')
  if (hostname === 'kotlinlang.org' && pathname.includes('/api/')) return stem === 'index' ? (pathname.split('/').filter(Boolean).at(-1) === 'index.html' ? pathname.split('/').filter(Boolean).at(-2) : undefined) : stem
  if (hostname === 'developer.apple.com' || hostname.endsWith('hexdocs.pm') || hostname === 'eel.is') return stem
  if (hostname === 'developer.mozilla.org' && pathname.includes('/Web/')) return stem
  return undefined
}

/**
 * Where the host serves a page's identity as data, when the page itself is a
 * shell. DocC renders in the browser from a JSON document per page.
 */
function machineSource(url) {
  const { hostname, pathname } = new URL(splitUrl(url).page)
  if (hostname === 'developer.apple.com' && pathname.startsWith('/documentation/')) return `https://developer.apple.com/tutorials/data${pathname.replace(/\/+$/, '')}.json`
  const book = /^\/(latest|swift-book)\/documentation\/(.+?)\/*$/.exec(pathname)
  if (hostname === 'docs.swift.org' && book) return `https://docs.swift.org/${book[1]}/data/documentation/${book[2]}.json`
  return undefined
}

/** Every anchor a DocC document declares, wherever it nests. */
function doccAnchors(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) doccAnchors(item, found)
  else if (value && typeof value === 'object') {
    if (typeof value.anchor === 'string') found.add(value.anchor)
    for (const item of Object.values(value)) doccAnchors(item, found)
  }
  return found
}

/**
 * A GET that remembers what it was told. Hosts publish nothing that changes
 * between a run and its rerun a minute later, and a rerun should not ask again.
 */
export function createCachedGet(get, { dir, maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  if (!dir) return get
  mkdirSync(dir, { recursive: true })
  return async function cachedGet(url, headers) {
    const file = join(dir, `${createHash('sha1').update(`${url}\0${JSON.stringify(headers ?? {})}`).digest('hex')}.json`)
    if (existsSync(file)) {
      try {
        const cached = JSON.parse(readFileSync(file, 'utf8'))
        if (Date.now() - cached.at < maxAgeMs) return cached.answer
      } catch { /* an unreadable entry is a miss */ }
    }
    const answer = await get(url, headers)
    // A transport failure or a throttle is not an answer worth keeping.
    if (answer.status !== 0 && answer.status !== 429 && answer.status < 500) writeFileSync(file, JSON.stringify({ at: Date.now(), answer }))
    return answer
  }
}

/**
 * Uses whose destination documents a concept rather than the symbol the name
 * spells: a keyword, or a language feature the name stands for. The page is
 * still held to its fragment; the symbol check does not apply.
 */
const CONCEPT_SOURCES = new Set(['keyword', 'doc-link', 'authored'])

/**
 * The names the destination must document, one per distinct symbol that
 * leads to it. A destination reached only by concepts has none.
 */
export function expectedSymbols(destination) {
  const symbols = new Map()
  for (const use of destination.uses) {
    if (CONCEPT_SOURCES.has(use.source)) continue
    if (use.concept) continue
    const symbol = terminalSymbol(use.port, use.name)
    if (!symbol || symbol.length < 1) continue
    symbols.set(symbol.toLowerCase(), symbol)
  }
  return [...symbols.values()].sort()
}

/** Where a symbol was found on a page, strongest first. */
function locate(page, fragment, symbol, extras) {
  const { title, headings } = page
  if (fragment) {
    const decoded = safeDecode(fragment)
    if (mentions(decoded, symbol) || mentions(fragment, symbol)) return 'fragment'
    const near = headings.find((heading) => mentions(heading.text, symbol))
    const section = sectionAt(page, fragment)
    if (section !== undefined && mentions(section, symbol)) return near ? 'heading' : 'section'
    return undefined
  }
  const top = headings.filter((heading) => heading.level === 1).map((heading) => heading.text)
  if (mentions(title, symbol) || top.some((text) => mentions(text, symbol))) return 'title'
  if (headings.some((heading) => mentions(heading.text, symbol)) || page.anchors.some((anchor) => mentions(anchor.id, symbol))) return 'heading'
  if (extras?.listed && extras.listed(symbol)) return 'listed'
  return undefined
}

/** Whether a page's text names the symbol: for a symbol the page lists beside its subject. */
const listedIn = (html, symbol) => mentions(strip(html), symbol)

const SHELL = /enable javascript|you need to enable javascript/i

/**
 * Verify one destination. `destination` is `{ url, host, uses: [...] }` where
 * each use is `{ port, name, source, concept? }`. `listed` names the
 * `port:name` pairs that a page documents among its siblings rather than under
 * a heading of their own (`std::chrono::milliseconds` on the `duration` page).
 */
export async function verifyApiDestination(destination, { get, listed = LISTED_ON_PAGE }) {
  const { url } = destination
  const { page: pageUrl, fragment } = splitUrl(url)
  const symbols = expectedSymbols({ ...destination, uses: [...destination.uses] })
  const base = { url, host: destination.host }
  const source = machineSource(url)
  const answer = await get(source ?? pageUrl)
  if (answer.status === 0) return { ...base, ok: false, unverifiable: `the request failed (${answer.error ?? 'no answer'})`, status: 0 }
  if (answer.status === 429) return { ...base, ok: false, unverifiable: 'the host rate-limited the request (429)', status: 429 }
  if (answer.status === 403 || answer.status === 401) return { ...base, ok: false, unverifiable: `the host blocks the request (${answer.status})`, status: answer.status }
  if (answer.status !== 200) return { ...base, ok: false, failure: 'status', status: answer.status, detail: `${answer.status} for ${source ?? pageUrl}` }

  if (source) {
    let data
    try { data = JSON.parse(answer.text) } catch { return { ...base, ok: false, unverifiable: 'the documentation data is not JSON', status: 200 } }
    const title = data?.metadata?.title ?? ''
    const found = { ...base, status: 200, via: 'docc-json', title }
    if (!sameAddress(source, answer.finalUrl ?? source)) return { ...found, ok: false, failure: 'moved', finalUrl: answer.finalUrl, detail: `${pageUrl} is now documented at ${answer.finalUrl}` }
    if (!title) return { ...found, ok: false, failure: 'generic', detail: 'the documentation data names no symbol' }
    if (fragment && !doccAnchors(data).has(safeDecode(fragment))) return { ...found, ok: false, failure: 'fragment', detail: `#${fragment} is not an anchor in the documentation data for ${pageUrl}` }
    const wanted = [...symbols, ...(fragment || new URL(pageUrl).hostname !== 'developer.apple.com' ? [] : [slugSymbol(url)])].filter(Boolean)
    const missing = wanted.filter((symbol) => compact(title) !== compact(symbol) && !mentions(title, symbol) && !(fragment && mentions(safeDecode(fragment), symbol)))
    if (missing.length) return { ...found, ok: false, failure: 'symbol', detail: `the page documents ${title}, not ${missing.join(', ')}` }
    return { ...found, ok: true, ...(fragment && { fragment: 'found' }), terminal: symbols.map((symbol) => ({ symbol, at: fragment ? 'fragment' : 'title' })) }
  }

  const finalUrl = answer.finalUrl ?? pageUrl
  const redirect = sameAddress(pageUrl, finalUrl) ? undefined : finalUrl
  const page = readPage(answer.text)
  const found = { ...base, status: 200, via: 'html', title: page.title, ...(redirect && { finalUrl: redirect }) }
  if (SHELL.test(answer.text.slice(0, 4000)) && page.headings.length === 0) {
    return { ...found, ok: false, unverifiable: 'the page is rendered in the browser and serves no readable content' }
  }
  if (redirect) {
    return { ...found, ok: false, failure: 'moved', detail: `${pageUrl} redirects to ${redirect}` }
  }
  if (fragment) {
    const decoded = safeDecode(fragment)
    const present = page.anchors.some((anchor) => anchor.id === fragment || anchor.id === decoded)
    if (!present) {
      if (page.anchors.length === 0) return { ...found, ok: false, unverifiable: 'the page declares no anchors to check a fragment against' }
      return { ...found, ok: false, failure: 'fragment', detail: `#${fragment} is not an anchor on ${pageUrl}` }
    }
  }
  const extras = { listed: (symbol) => destination.uses.some((use) => listed.has(`${use.port}:${use.name}`)) && listedIn(page.html, symbol) }
  const wanted = [...symbols]
  const slug = fragment ? undefined : slugSymbol(url)
  const terminal = []
  const missing = []
  for (const symbol of wanted) {
    const at = locate(page, fragment, symbol, extras)
    if (at) terminal.push({ symbol, at })
    else missing.push(symbol)
  }
  if (slug) {
    const identity = compact(`${page.title} ${page.headings.filter((heading) => heading.level === 1).map((heading) => heading.text).join(' ')}`)
    if (identity.includes(compact(slug))) terminal.push({ symbol: slug, at: 'address' })
    else missing.push(slug)
  }
  if (missing.length) {
    const heading = page.headings.find((candidate) => candidate.level === 1)?.text ?? page.title
    return { ...found, ok: false, failure: 'symbol', detail: `${missing.join(', ')} not documented by ${JSON.stringify(heading)} at ${pageUrl}${fragment ? `#${fragment}` : ''}`, ...(terminal.length && { terminal }) }
  }
  if (wanted.length === 0 && !slug && !fragment) {
    return { ...found, ok: true, terminal: [], note: 'a language reference page; the page exists and is not a redirect' }
  }
  return { ...found, ok: true, ...(fragment && { fragment: 'found' }), terminal }
}


/** The symbols the destination's names ask for that its passing record was never checked against. */
export function unprovenSymbols(destination, record) {
  const verified = new Set((record.terminal ?? []).map((entry) => entry.symbol.toLowerCase()))
  return expectedSymbols({ ...destination, uses: [...destination.uses.values()] }).filter((symbol) => !verified.has(symbol.toLowerCase()))
}

const daysAhead = (date, today) => Math.floor((new Date(`${date}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000)

/** Cap the names a record keeps: enough to read why the page is linked, not every spelling. */
const NAMES_KEPT = 8

/** What a record says about a destination: who links to it, and for what. */
export function usesOf(destination) {
  const uses = [...destination.uses.values?.() ?? destination.uses]
  const names = [...new Set(uses.map((use) => (use.port ? `${use.port}:${use.name}` : use.name)))].sort()
  return { names: names.slice(0, NAMES_KEPT), sources: [...new Set(uses.map((use) => use.source))].sort() }
}

/**
 * Where the evidence and the destinations the site generates disagree, as
 * sentences. A record that is not ok because the host could not be read is
 * `unresolved`, never a pass and never a failure of the change under test.
 */
/**
 * @param {Map<string, any>} destinations
 * @param {any} evidence
 * @param {{ today?: Date, root?: string }} [options] `root` is the checkout whose inventories the records were made from.
 */
export function checkApiEvidence(destinations, evidence, { today = new Date(), root } = {}) {
  const problems = []
  const unresolved = []
  for (const name of Object.keys(INVENTORY_SOURCES)) {
    const record = (evidence.inventories ?? []).find((candidate) => candidate.name === name)
    if (!record) {
      problems.push(`the ${name} inventory has no record against its host's index: run node scripts/verify-api-destinations.mjs --inventories`)
      continue
    }
    if (record.unverifiable) {
      unresolved.push(`the ${name} inventory: ${record.unverifiable}`)
      continue
    }
    if (!record.ok) problems.push(`the ${name} inventory names ${record.missing} page${record.missing === 1 ? '' : 's'} its host's index lacks, such as ${(record.examples ?? []).slice(0, 3).join('; ')}`)
    const count = root ? JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'inventories', `${name}.entries.json`), 'utf8')).e.length : record.entries
    if (count !== record.entries) problems.push(`the ${name} inventory now has ${count} entries and was verified with ${record.entries}: run node scripts/verify-api-destinations.mjs --inventories`)
  }
  const records = new Map(evidence.destinations.map((record) => [record.url, record]))
  const wanted = new Map([...destinations.values()].map((destination) => [destination.url, destination]))
  for (const destination of wanted.values()) {
    const record = records.get(destination.url)
    const who = usesOf(destination).names.slice(0, 3).join(', ')
    if (!record) {
      problems.push(`${destination.url} has no evidence (${who}): run node scripts/verify-api-destinations.mjs --missing`)
      continue
    }
    if (record.unverifiable) {
      unresolved.push(`${destination.url}: ${record.unverifiable}`)
      continue
    }
    if (!record.ok) {
      problems.push(`${destination.url} does not land on its symbol (${record.failure}): ${record.detail}`)
      continue
    }
    const unproven = unprovenSymbols(destination, record)
    if (unproven.length) problems.push(`${destination.url} was never checked for ${unproven.join(', ')} (${who}): run node scripts/verify-api-destinations.mjs --missing`)
  }
  for (const record of evidence.destinations) {
    if (!wanted.has(record.url) && !record.crawled) problems.push(`${record.url} is in the evidence but no source generates it: run node scripts/verify-api-destinations.mjs`)
  }
  for (const record of futureRecords(evidence, { today })) problems.push(`${record.url} is dated ${record.checkedAt}, which is in the future`)
  for (const record of evidence.inventories ?? []) {
    if (daysAhead(record.checkedAt, today) > 1) problems.push(`the ${record.name} inventory record is dated ${record.checkedAt}, which is in the future`)
  }
  return { problems, unresolved, stale: staleRecords(evidence, { today }) }
}

/**
 * The cached inventories are not destinations one at a time: thousands of
 * names, each a link the resolver may produce. Every one is held to the index
 * its host publishes, so a name that leads nowhere is found before a page
 * mentions it.
 *
 * - CPython and Julia publish `objects.inv`; an entry must still be there, at
 *   the same address.
 * - The JDK's class pages are listed by `allclasses-index.html`; the page of
 *   every class and member entry must be one of them.
 * - MDN lists every page in its sitemap; the web-platform inventory is read
 *   from TypeScript's declarations, which name far more than MDN documents.
 */
export const INVENTORY_SOURCES = {
  python: { source: 'https://docs.python.org/3/objects.inv', kind: 'objects.inv' },
  julia: { source: 'https://docs.julialang.org/en/v1/objects.inv', kind: 'objects.inv' },
  jdk: { source: 'https://docs.oracle.com/en/java/javase/21/docs/api/allclasses-index.html', kind: 'allclasses' },
  dom: { source: 'https://developer.mozilla.org/sitemaps/en-us/sitemap.xml.gz', kind: 'sitemap' },
}

async function fetchBytes(url, { pauseMs = 700 } = {}) {
  await new Promise((resolve) => setTimeout(resolve, pauseMs))
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** `{ name, entries, source, missing, examples }` for one cached inventory, read against its host's index. */
export async function verifyInventory(name, { root, bytes = fetchBytes }) {
  const { source, kind } = INVENTORY_SOURCES[name]
  const sidecar = JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'inventories', `${name}.entries.json`), 'utf8'))
  const entries = sidecar.e
  const base = { name, source, kind, entries: entries.length }
  let raw
  try { raw = await bytes(source) } catch (error) { return { ...base, ok: false, unverifiable: String(error.message ?? error) } }
  const missing = []
  if (kind === 'objects.inv') {
    // A name may be listed under several domains (`__future__` is a module and a label), so an entry is
    // compared as the pair, not by name.
    const live = readInventory(raw).entries
    const pairs = new Set(live.map((entry) => `${entry.name}\0${entry.uri}`))
    const names = new Map(live.map((entry) => [entry.name, entry.uri]))
    for (const [entry, uri] of entries) if (!pairs.has(`${entry}\0${uri}`)) missing.push(names.has(entry) ? `${entry} moved to ${names.get(entry)}` : entry)
  } else if (kind === 'allclasses') {
    const pages = new Set([...raw.toString('utf8').matchAll(/href="([^"#]+\.html)"/g)].map((match) => match[1]))
    // The index leaves out some nested classes that have pages (`AbstractQueuedSynchronizer.ConditionObject`),
    // so a page it does not list is asked for, once, and must be that class's.
    const asked = new Map()
    for (const [entry, uri] of entries) {
      const path = uri.split('#')[0]
      if (pages.has(path)) continue
      if (!asked.has(path)) {
        const wanted = path.split('/').at(-1).replace(/\.html$/, '')
        let ok = false
        try { ok = readPage((await bytes(new URL(path, source).href)).toString('utf8')).title.toLowerCase().includes(wanted.split('.').at(-1).toLowerCase()) } catch { /* a page that cannot be had is missing */ }
        asked.set(path, ok)
      }
      if (!asked.get(path)) missing.push(`${entry} (${path})`)
    }
  } else {
    const xml = (source.endsWith('.gz') && raw[0] === 0x1f ? gunzipSync(raw) : raw).toString('utf8')
    const pages = new Set([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]))
    for (const [entry, uri] of entries) if (!pages.has(`https://developer.mozilla.org/${uri.split('#')[0]}`)) missing.push(`${entry} (${uri})`)
  }
  return { ...base, ok: missing.length === 0, missing: missing.length, ...(missing.length && { examples: missing.slice(0, 12) }) }
}

export const inventoryNames = () => EXTERNAL_INVENTORIES.map((inventory) => inventory.file)

/**
 * The evidence as text, one record to a line, so a refresh reads as the
 * records that changed and the file stays a few hundred kilobytes.
 */
export function serializeEvidence(evidence) {
  const rows = (records) => records.map((record) => `    ${JSON.stringify(record)}`).join(',\n')
  return `{\n  "schema": ${evidence.schema},\n  "checkedAt": ${JSON.stringify(evidence.checkedAt)},\n  "inventories": [\n${rows(evidence.inventories)}\n  ],\n  "destinations": [\n${rows(evidence.destinations)}\n  ]\n}\n`
}
