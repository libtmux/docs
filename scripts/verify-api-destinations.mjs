#!/usr/bin/env node
/**
 * Verify that each standard-library and SDK link lands on the symbol it names.
 *
 * `scripts/lib/api-destinations.mjs` reads every external API destination the
 * site generates: the curated maps, the cached inventories, the references in
 * the extracted doc comments, and the links written by hand. Each is requested
 * once, read-only and one at a time, and held to the page and the fragment it
 * names (`scripts/lib/api-destination-verification.mjs`). The answers are
 * written to `site/src/data/api-destination-evidence.json`.
 *
 * A link a person wrote (the text on it and its address) is a row of
 * `site/src/data/api-link-review.json` with the heading its page has there,
 * unless its text is exactly the name of the symbol its page declares
 * (`scripts/lib/api-links.mjs`). A run that finds a link with no row prints
 * the heading it found and the row to add; a person reads both.
 *
 * A destination the host cannot answer for (it blocks the request, throttles
 * it, or renders the page in the browser) is recorded as unverifiable with the
 * reason. It is never recorded as passing, and a live run reports every one.
 *
 * `--check` requests nothing: it re-reads the destinations from the source and
 * fails when one has no passing record, when a record is for a link nothing
 * generates any more, or when a name now leads to a page never checked for it.
 * It prints the unverifiable destinations and exits 0 for them, because no
 * change can make a host answer.
 *
 * The cached inventories (CPython, Julia, the JDK and the web platform)
 * are held to the index each host publishes in the same run.
 *
 * Usage:
 *   node scripts/verify-api-destinations.mjs [--missing] [--inventories] [--host <host>] [--out <path>] [--crawl <file>] [--cache <dir> | --no-cache] [--date <YYYY-MM-DD>]
 *   node scripts/verify-api-destinations.mjs --check [--fresh] [--out <path>] [--today <YYYY-MM-DD>]
 *
 *   --missing        Verify only the destinations without a passing record, keeping the rest.
 *   --inventories    Verify only the cached inventories against their hosts' indexes.
 *   --host <host>    Verify only this host, keeping the other records.
 *   --out <path>     The evidence file (default site/src/data/api-destination-evidence.json).
 *   --crawl <file>   Also verify the API links in a file of URLs read from an assembled site (see
 *                    `crawl`). Those records are marked `crawled`: they are the port-built pages this
 *                    repository does not generate, and only a crawl refreshes them.
 *   --cache <dir>    Where fetched pages are kept for 12 hours (default .build-cache/api-destinations).
 *   --no-cache       Ask every host again.
 *   --check          Request nothing; compare the evidence with the destinations the source generates.
 *   --fresh          With --check, also fail on evidence older than the bound.
 *   --date <date>    The day to record (default today, UTC). It may not be in the future.
 *   --today <date>   The day to measure age and future dates from (default today, UTC).
 *
 * LIBTMUX_DESTINATION_REWRITE holds a JSON object that maps an origin to a
 * replacement, so a test can answer the hosts from a local server.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiHostOf, collectApiDestinations } from './lib/api-destinations.mjs'
import { INVENTORY_SOURCES, checkApiEvidence, createCachedGet, needsCheck, serializeEvidence, usesOf, verifyApiDestination, verifyInventory } from './lib/api-destination-verification.mjs'
import { EVIDENCE_MAX_AGE_DAYS, createGet, dateProblem } from './lib/destination-verification.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(root, 'site', 'src', 'data', 'api-destination-evidence.json')

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10)
  const opts = { out: DEFAULT_OUT, check: false, fresh: false, missing: false, inventories: false, host: null, crawl: null, cache: join(root, '.build-cache', 'api-destinations'), date: today, today }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--host') opts.host = argv[++i]
    else if (arg === '--crawl') opts.crawl = argv[++i]
    else if (arg === '--cache') opts.cache = argv[++i]
    else if (arg === '--no-cache') opts.cache = null
    else if (arg === '--date') opts.date = argv[++i]
    else if (arg === '--today') opts.today = argv[++i]
    else if (arg === '--check') opts.check = true
    else if (arg === '--fresh') opts.fresh = true
    else if (arg === '--missing') opts.missing = true
    else if (arg === '--inventories') opts.inventories = true
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`unrecognised argument: ${arg}`)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
  process.exit(0)
}
for (const [flag, value] of [['--today', opts.today], ['--date', opts.date]]) {
  const problem = dateProblem(value, flag === '--today' ? undefined : new Date(`${opts.today}T12:00:00Z`))
  if (problem) {
    console.error(`${flag}: ${problem}`)
    process.exit(1)
  }
}

const today = new Date(`${opts.today}T12:00:00Z`)
const destinations = collectApiDestinations({ root })

/**
 * The API links an assembled site carries, as destinations that name no symbol.
 * The list is the site's own hrefs, one URL per line; an assembled tree is too
 * large to read here, and `rg` lists it in seconds:
 *
 *   rg -oN --no-filename -g '*.html' 'href="https://[^"]+"' _site/en | sed 's/^href="//; s/"$//' | sort -u > hrefs.txt
 */
function crawl(file) {
  const found = new Map()
  // The header links are the other verifier's: package pages and the API roots of each port.
  const header = new Set(JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'destination-evidence.json'), 'utf8')).destinations.map((record) => record.url))
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const url = line.trim().replaceAll('&amp;', '&')
    if (!apiHostOf(url) || destinations.has(url) || header.has(url)) continue
    const known = found.get(url) ?? { url, host: apiHostOf(url), uses: new Map(), crawled: true }
    known.uses.set(file, { port: '', name: 'an assembled page', source: 'authored' })
    found.set(url, known)
  }
  return found
}

/** Print the problems and mark the run failed. The exit code is set, not forced, so a long report reaches a pipe whole. */
function report(problems) {
  for (const problem of problems) console.error(`  ${problem}`)
  if (problems.length > 0) {
    console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in ${opts.out}`)
    process.exitCode = 1
  }
  return problems.length > 0
}

/** Every destination a host left open, one line each: an unread page is a fact to see, not a number. */
function showUnresolved(unresolved) {
  for (const line of unresolved) console.warn(`unresolved: ${line}`)
}

if (opts.check) {
  if (!existsSync(opts.out)) {
    console.error(`${opts.out} does not exist. Run: node scripts/verify-api-destinations.mjs`)
    process.exitCode = 1
  } else {
    const evidence = JSON.parse(readFileSync(opts.out, 'utf8'))
    const { problems, unresolved, stale } = checkApiEvidence(destinations, evidence, { today, root })
    showUnresolved(unresolved)
    if (stale.length > 0) {
      const line = `${stale.length} destination record${stale.length === 1 ? ' was' : 's were'} last checked more than ${EVIDENCE_MAX_AGE_DAYS} days ago (oldest ${stale[0].checkedAt}): run node scripts/verify-api-destinations.mjs`
      if (opts.fresh) problems.push(line)
      else if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Stale API destination evidence::${line}`)
      else console.warn(`warning: ${line}`)
    }
    if (!report(problems)) console.log(`${opts.out} agrees with the ${destinations.size} destinations the source generates${unresolved.length ? ` (${unresolved.length} unresolved)` : ''}`)
  }
} else {
  await live()
}

async function live() {
  const rewriteOrigins = JSON.parse(process.env.LIBTMUX_DESTINATION_REWRITE ?? '{}')
  const local = Object.keys(rewriteOrigins).length > 0
  // One request at a time with a pause between, so a live run stays polite; a rewritten origin is a local server.
  const get = createCachedGet(createGet({ rewriteOrigins, timeoutMs: 40_000, pauseMs: local ? 0 : 700 }), { dir: opts.cache })

  const previous = existsSync(opts.out) ? JSON.parse(readFileSync(opts.out, 'utf8')) : { destinations: [] }
  const kept = new Map(previous.destinations.map((record) => [record.url, record]))
  const wanted = [...destinations.values(), ...(opts.crawl ? [...crawl(opts.crawl).values()] : [])]
  const queue = wanted.filter((destination) => {
    if (opts.inventories) return false
    if (opts.host && destination.host !== opts.host) return false
    if (opts.missing) {
      return needsCheck(destination, kept.get(destination.url))
    }
    return true
  })

  const records = new Map(opts.missing || opts.host || opts.inventories ? kept : [])
  let failed = 0
  let unverifiable = 0
  for (const destination of queue) {
    const result = await verifyApiDestination({ ...destination, uses: [...destination.uses.values()] }, { get })
    const record = { ...result, checkedAt: opts.date, ...usesOf(destination), ...(destination.crawled && { crawled: true }) }
    records.set(destination.url, record)
    if (record.unverifiable) unverifiable += 1
    else if (!record.ok) failed += 1
    const mark = record.ok ? 'ok  ' : record.unverifiable ? 'unv ' : 'FAIL'
    console.log(`${mark} ${String(record.status ?? 0).padEnd(3)} ${destination.url}${record.ok ? '' : `\n       ${record.failure ?? 'unverifiable'}: ${record.detail ?? record.unverifiable}`}`)
  }

  const inventoryRecords = new Map((previous.inventories ?? []).map((record) => [record.name, record]))
  if (opts.inventories || !(opts.missing || opts.host)) {
    for (const name of Object.keys(INVENTORY_SOURCES)) {
      const record = { ...(await verifyInventory(name, { root, ...(local && { bytes: async (url) => Buffer.from(await (await fetch(url.replace(/^https:\/\/[^/]+/, (origin) => rewriteOrigins[origin] ?? origin))).arrayBuffer()) }) })), checkedAt: opts.date }
      inventoryRecords.set(name, record)
      if (!record.ok && !record.unverifiable) failed += 1
      if (record.unverifiable) unverifiable += 1
      console.log(`${record.ok ? 'ok  ' : record.unverifiable ? 'unv ' : 'FAIL'}     inventory ${name}: ${record.entries} entries${record.ok ? '' : `\n       ${record.unverifiable ?? `${record.missing} not in the host's index, such as ${(record.examples ?? []).slice(0, 3).join('; ')}`}`}`)
    }
  }

  // Records for links the source stopped generating go with them, except the crawled ones, which only a crawl can refresh.
  const generated = new Set(destinations.keys())
  const evidence = {
    schema: 2,
    checkedAt: opts.date,
    inventories: Object.keys(INVENTORY_SOURCES).map((name) => inventoryRecords.get(name)).filter(Boolean),
    destinations: [...records.values()].filter((record) => generated.has(record.url) || record.crawled).sort((a, b) => a.url.localeCompare(b.url)),
  }
  writeFileSync(opts.out, serializeEvidence(evidence))
  console.log(`wrote ${opts.out}: ${queue.length} verified, ${failed} failing, ${unverifiable} unverifiable`)
  const { problems } = checkApiEvidence(destinations, evidence, { today, root })
  if (failed > 0 || problems.length > 0) {
    report(problems)
    process.exitCode = 1
  }
}
