/**
 * Check that a standard-library or SDK link lands on the symbol it names.
 *
 * A 200 proves a page exists, and the JDK shows how little that is: the old
 * search-URL template and a module-less path both answered 200 from a generic
 * landing page. Nor is a symbol's name somewhere near the anchor evidence: a
 * CPython entry names the types its neighbours take, a rustdoc method calls its
 * siblings, and a javadoc page lists the types it inherits from. So every
 * destination is held to what the host's own page can answer:
 *
 * - The fragment is an `id` or `name` anchor on the page the URL names.
 * - A fragment spells the symbol the link was made for, as a whole word of the
 *   entry's own name, and a member sits on the page of the type that owns it.
 * - A page with no fragment names the symbol in its title or top heading, and
 *   where the address names a type, it is that type: `List` is not
 *   `ArrayList.html`, which carries a "Methods inherited from interface List"
 *   heading of its own.
 *
 * Two reviewed lists in `api-destinations.mjs` widen that for a stated reason:
 * the names a page documents beside its subject, and the pages that document
 * several symbols under one anchor, where the section the anchor opens (up to
 * the next heading or sibling entry) must still hold the symbol. A record says
 * when it rests on either.
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
import { EXTERNAL_INVENTORIES, PAGE_EXCEPTIONS, addressSegments, arityOf, exceptionFor, terminalSymbol } from './api-destinations.mjs'
import { addressOf, mismatch, namespaceMismatch, splitUrl } from './api-addresses.mjs'
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

/**
 * The words of a heading, title or kebab-case anchor compare case-insensitively
 * and whole: `Set` is not in `SetAlgebra`, nor `sort` in `sort!`. A host whose
 * fragments are identifiers is read from its address instead (`addressOf`),
 * because `_`, `-` and `.` are word breaks here and parts of a name there.
 */
export const mentions = (text, symbol) => new RegExp(`(?<![a-z0-9])${escapeRegExp(symbol.toLowerCase())}(?![a-z0-9!?])`).test(text.toLowerCase())
// `!` and `?` end names (`sort!`, `empty?`), so they are part of what is compared.
const compact = (text) => text.toLowerCase().replace(/[^a-z0-9!?]/g, '')

/**
 * What a rendered page offers to prove an identity: its title, headings, the
 * anchors it declares, and the text that sits under each anchor.
 */
export function readPage(html) {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: strip(match[2]) })).filter((heading) => heading.text)
  const anchors = []
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[2] ?? match[3]
    if (value) anchors.push({ id: decode(value), at: match.index, tag: match[1].toLowerCase() })
  }
  return { title, headings, anchors, html }
}

/**
 * The text a fragment opens, bounded by the entry it names. An anchor on a
 * heading, or on a wrapper just before one, opens the text after that heading
 * up to the next. An anchor on an entry (a `dt` in CPython's manual, a rustdoc
 * `section`, a Julia docstring) opens the text up to the next anchor on the
 * same kind of element, or the next heading, whichever comes first; a page
 * that lists its entries one after another has no heading between them.
 */
export function sectionAt(page, fragment) {
  const decoded = safeDecode(fragment)
  const index = page.anchors.findIndex((candidate) => candidate.id === fragment || candidate.id === decoded)
  if (index < 0) return undefined
  const anchor = page.anchors[index]
  const rest = page.html.slice(anchor.at)
  const headings = [...rest.matchAll(/<h[1-4]\b/gi)]
  const opens = headings[0]?.index
  const closes = rest.search(/<\/h[1-4]>/i)
  let from = 0
  let end
  if (closes >= 0 && (opens === undefined || closes < opens)) {
    // The anchor sits inside a heading (the JLS writes an empty `<a name>` there): the section follows it.
    from = closes
    end = opens
  } else if (opens !== undefined && strip(rest.slice(0, opens)).length <= 12) {
    end = headings[1]?.index
  } else {
    end = opens
    const sibling = page.anchors.slice(index + 1).find((candidate) => candidate.tag === anchor.tag && candidate.id !== anchor.id)
    if (sibling) end = end === undefined ? sibling.at - anchor.at : Math.min(end, sibling.at - anchor.at)
  }
  return strip(rest.slice(from, Math.min(end ?? 40_000, from + 40_000)))
}

const safeDecode = (text) => { try { return decodeURIComponent(text) } catch { return text } }

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
    return stem.replace(/-\d+$/, '').split('.').at(-1).replace(/^about_/, '')
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
 * What each name that leads to the destination asks of its page: the symbol,
 * the name written in full (a package, module or type before it is part of
 * what the address must say), its operand count, and the exception, if one
 * was reviewed for this name at this exact address.
 * A destination reached only by concepts has none.
 */
export function expectationsOf(destination, { exceptions = PAGE_EXCEPTIONS } = {}) {
  const found = new Map()
  for (const use of destination.uses) {
    if (CONCEPT_SOURCES.has(use.source) || use.concept) continue
    const symbol = terminalSymbol(use.port, use.name)
    if (!symbol) continue
    const key = `${use.port}:${use.name}`
    const written = addressSegments(use.port, use.name)
    const segments = symbol === written.at(-1) ? written : [symbol]
    const exception = exceptionFor(destination.url, key, exceptions)
    found.set(key, { key, symbol, segments, ...(arityOf(use.name) !== undefined && { arity: arityOf(use.name) }), ...(exception && { exception }) })
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** The distinct symbols the destination's names ask for. */
export function expectedSymbols(destination, options) {
  const symbols = new Map(expectationsOf(destination, options).map(({ symbol }) => [symbol.toLowerCase(), symbol]))
  return [...symbols.values()].sort()
}

/** Whether the page's title or a top heading names the symbol. */
const titledBy = (page, symbol) => [page.title, ...page.headings.filter((heading) => heading.level === 1).map((heading) => heading.text)].some((text) => mentions(text, symbol))

/**
 * Hold one name to the page it leads to.
 *
 * Where the host puts a symbol's package, type and member in its address, the
 * name written in full must be the end of that path (`addressOf`): the last
 * segment is the entry, and what precedes it is its package, module or type.
 * The page's title or top heading must then name the symbol too. Where the
 * address says nothing, a fragment that is a heading must be the symbol's own
 * spelling, and a page without a fragment must name it in its title or top
 * heading. Text near an anchor is never evidence of which entry it is.
 *
 * An exception reviewed for this name at this exact address is the only way
 * past those: its page lists the symbol (`listed`), or the section the anchor
 * opens does (`section`). The evidence records it with its reason.
 *
 * @returns {{ at: string, reason?: string } | { failure: string, detail: string }}
 */
function hold(page, { url, fragment }, expectation) {
  const { symbol, segments, arity, exception } = expectation
  const address = addressOf(url)
  const decoded = safeDecode(fragment)
  const where = `${url.split('#')[0]}${fragment ? `#${fragment}` : ''}`
  let failure
  if (address && address.fragment !== 'heading') {
    const differs = mismatch(segments, address)
    if (differs) {
      failure = { failure: differs, detail: differs === 'symbol'
        ? `${segments.join('.')} is not what ${where} documents: its address names ${address.path.at(-1) ?? 'no symbol'}`
        : `${segments.join('.')} is written with ${segments.slice(0, -1).join('.')}, but ${where} sits under ${address.path.slice(0, -1).join('.')}` }
    } else if (address.arity !== undefined && arity !== undefined && address.arity !== arity) {
      failure = { failure: 'symbol', detail: `${segments.join('.')}/${arity} is not what ${where} documents: it takes ${address.arity}` }
    } else if (!fragment && !titledBy(page, symbol)) {
      failure = { failure: 'symbol', detail: `${symbol} is not in the title or top heading ${JSON.stringify(page.headings.find((heading) => heading.level === 1)?.text ?? page.title)} of ${where}` }
    } else {
      return { at: fragment ? 'fragment' : 'title' }
    }
  } else if (!address || !address.exact) {
    // A heading-style fragment, or an address that says nothing: the page's own words.
    if (fragment) {
      // A heading's anchor is the heading's words, so only the symbol's own spelling is the symbol's anchor:
      // `#void` is `void`, and `#the_async_iterator_and_async_iterable_protocols` is not `Iterable`.
      if (compact(decoded) === compact(symbol)) return { at: 'fragment' }
      failure = { failure: 'symbol', detail: `${symbol} is not what #${fragment} documents at ${url.split('#')[0]}` }
    } else if (titledBy(page, symbol)) {
      const scope = new URL(url).hostname === 'en.cppreference.com' ? namespaceMismatch(url, segments, page.title) : undefined
      if (!scope) return { at: 'title' }
      failure = { failure: scope, detail: `${segments.join('::')} is written with namespaces that neither the address nor the title ${JSON.stringify(page.title)} of ${where} names` }
    } else {
      failure = { failure: 'symbol', detail: `${symbol} is not in the title or top heading ${JSON.stringify(page.headings.find((heading) => heading.level === 1)?.text ?? page.title)} of ${where}` }
    }
  } else {
    failure = { failure: 'symbol', detail: `#${fragment} is not an entry name at ${url.split('#')[0]}, so it cannot say it documents ${symbol}` }
  }
  const words = exception?.words ?? symbol
  if (exception?.tier === 'section' && fragment && mentions(sectionAt(page, fragment) ?? '', words)) return { at: 'section', reason: exception.reason }
  if (exception?.tier === 'listed' && mentions(strip(page.html), words)) return { at: 'listed', reason: exception.reason }
  return failure
}

const SHELL = /enable javascript|you need to enable javascript/i

/**
 * Verify one destination. `destination` is `{ url, host, uses: [...] }` where
 * each use is `{ port, name, source, concept? }`. `exceptions` is the reviewed
 * list in `api-destinations.mjs`: names a page documents elsewhere than its
 * title or fragment, each pinned to one address with its reason.
 */
export async function verifyApiDestination(destination, { get, exceptions = PAGE_EXCEPTIONS }) {
  const { url } = destination
  const { page: pageUrl, fragment } = splitUrl(url)
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
    const slug = fragment ? undefined : slugSymbol(url)
    const terminal = []
    const address = addressOf(url)
    for (const { symbol, segments } of expectationsOf(destination, { exceptions })) {
      if (compact(title) !== compact(symbol) && !mentions(title, symbol) && !(fragment && compact(safeDecode(fragment)) === compact(symbol))) {
        return { ...found, ok: false, failure: 'symbol', detail: `the page documents ${title}, not ${symbol}` }
      }
      const differs = address && !fragment ? mismatch(segments, address) : undefined
      if (differs) return { ...found, ok: false, failure: differs, detail: `${segments.join('.')} is not what ${pageUrl} documents: its address names ${address.path.join('.')}` }
      if (!terminal.some((entry) => entry.symbol === symbol)) terminal.push({ symbol, at: fragment ? 'fragment' : 'title' })
    }
    if (slug && !terminal.length && compact(title) !== compact(slug)) return { ...found, ok: false, failure: 'address', detail: `${pageUrl} names ${slug}, which the page ${JSON.stringify(title)} does not document` }
    return { ...found, ok: true, ...(fragment && { fragment: 'found' }), terminal }
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
  const slug = slugSymbol(url)
  const terminal = []
  let failed
  for (const expectation of expectationsOf(destination, { exceptions })) {
    const held = hold(page, { url, fragment }, expectation)
    if (held.failure) {
      failed ??= held
    } else if (!terminal.some((entry) => entry.symbol === expectation.symbol)) {
      terminal.push({ symbol: expectation.symbol, ...held })
    }
  }
  // The page must be the one its address names, whatever the names say.
  if (slug) {
    const identity = compact(`${page.title} ${page.headings.filter((heading) => heading.level === 1).map((heading) => heading.text).join(' ')}`)
    if (!identity.includes(compact(slug))) failed ??= { failure: 'address', detail: `${pageUrl} names ${slug}, which its title ${JSON.stringify(page.title)} does not` }
    else if (!fragment) terminal.push({ symbol: slug, at: 'address' })
  }
  if (failed) return { ...found, ok: false, failure: failed.failure, detail: failed.detail, ...(terminal.length && { terminal }) }
  if (terminal.length === 0 && !slug && !fragment) {
    return { ...found, ok: true, terminal: [], note: 'a language reference page; the page exists and is not a redirect' }
  }
  return { ...found, ok: true, ...(fragment && { fragment: 'found' }), terminal }
}

/** The symbols the destination's names ask for that its passing record was never checked against. */
export function unprovenSymbols(destination, record) {
  const verified = new Set((record.terminal ?? []).map((entry) => entry.symbol.toLowerCase()))
  return expectedSymbols({ ...destination, uses: [...destination.uses.values()] }).filter((symbol) => !verified.has(symbol.toLowerCase()))
}

/** The share of destinations a run may leave unverifiable before the evidence stops counting as a check. */
export const MAX_UNVERIFIABLE_SHARE = 0.05

/** Where the verifier reports finding a symbol. */
const FOUND_AT = new Set(['fragment', 'title', 'address', 'listed', 'section'])

/** A passing record carries none of these; a failing one carries a reason, and an unverifiable one only its own. */
const FAILURE_FIELDS = ['failure', 'detail', 'unverifiable', 'finalUrl']

/** Where one record contradicts itself, as sentences. */
export function recordProblems(record) {
  const problems = []
  let host
  try { host = new URL(record.url).hostname } catch { return [`${record.url} is not an address`] }
  if (record.host !== host) problems.push(`${record.url} is recorded under the host ${record.host}`)
  if (record.ok === true) {
    if (record.status !== 200) problems.push(`${record.url} is recorded as passing with the status ${record.status}`)
    for (const field of FAILURE_FIELDS) if (record[field] !== undefined) problems.push(`${record.url} is recorded as passing yet carries ${field}: ${JSON.stringify(record[field])}`)
    if (!['html', 'docc-json'].includes(record.via)) problems.push(`${record.url} is recorded as passing without saying how the host was read`)
    for (const entry of record.terminal ?? []) {
      if (!FOUND_AT.has(entry.at)) problems.push(`${record.url} records ${entry.symbol} as found ${JSON.stringify(entry.at)}, which the verifier never reports`)
    }
  } else if (record.unverifiable) {
    if (record.failure !== undefined) problems.push(`${record.url} is recorded as both unverifiable and failing`)
    if (typeof record.unverifiable !== 'string' || record.unverifiable.length < 9) problems.push(`${record.url} is unverifiable without a reason`)
  } else if (!record.failure || !record.detail) {
    problems.push(`${record.url} neither passes nor says why not`)
  }
  return problems
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
  let unverifiableInventories = 0
  for (const name of Object.keys(INVENTORY_SOURCES)) {
    const record = (evidence.inventories ?? []).find((candidate) => candidate.name === name)
    if (!record) {
      problems.push(`the ${name} inventory has no record against its host's index: run node scripts/verify-api-destinations.mjs --inventories`)
      continue
    }
    if (record.unverifiable) {
      if (record.ok !== false) problems.push(`the ${name} inventory is recorded as passing and unverifiable at once`)
      unverifiableInventories += 1
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
    const malformed = recordProblems(record)
    if (malformed.length) {
      problems.push(...malformed)
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
    // A pass by the page's text, not its title or the fragment's spelling, rests on a reviewed exception.
    for (const entry of record.terminal ?? []) {
      if (!['section', 'listed'].includes(entry.at)) continue
      const reviewed = expectationsOf({ ...destination, uses: [...destination.uses.values()] }).some((expectation) => expectation.symbol === entry.symbol && expectation.exception?.tier === entry.at)
      if (!reviewed) problems.push(`${record.url} passes ${entry.symbol} by ${entry.at}, which no reviewed exception in api-destinations.mjs allows at this address (${who})`)
    }
    const unproven = unprovenSymbols(destination, record)
    if (unproven.length) problems.push(`${destination.url} was never checked for ${unproven.join(', ')} (${who}): run node scripts/verify-api-destinations.mjs --missing`)
  }
  // A host or two that blocks a request leaves a few destinations open. Most of them open is a run that
  // asked nothing, and passing it would be passing a check that checked nothing.
  const open = [...wanted.keys()].filter((url) => records.get(url)?.unverifiable).length
  const allowed = Math.floor(wanted.size * MAX_UNVERIFIABLE_SHARE)
  if (open > allowed) problems.push(`${open} of ${wanted.size} destinations are unverifiable, more than the ${allowed} a blocked or throttled host explains: run node scripts/verify-api-destinations.mjs when the hosts answer`)
  if (unverifiableInventories > 1) problems.push(`${unverifiableInventories} of ${Object.keys(INVENTORY_SOURCES).length} inventories are unverifiable: run node scripts/verify-api-destinations.mjs --inventories when the hosts answer`)
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
