#!/usr/bin/env node
/**
 * Verify the repository, package and API destinations the header links to.
 *
 * Every entry in `site/src/lib/port-inventory.ts` that is published or only
 * configured is requested once per distinct URL, read-only, and must name the
 * thing it claims to: the host's title or its own API has to agree with the
 * package, crate, module or repository in the URL, and a host that reports a
 * repository must report one of the repositories whose entries own the
 * destination. The answers are written to
 * `site/src/data/destination-evidence.json`, which the tests hold the inventory
 * to. A destination that fails stays in the file as the reason an entry is not
 * linked.
 *
 * The version each package's pinned manifest declares
 * (`site/src/data/manifest-packages.json`) must be on every host that lists
 * versions; a record says so, or says why the host could not. A published
 * entry whose destination fails makes this exit 1, and so does a configured one
 * whose destination now passes: either way the inventory's status is out of
 * date.
 *
 * Age is enforced here and nowhere else. A live run ends by requiring every
 * record to be within the bound, so evidence cannot be committed back-dated,
 * and `--check --fresh` is the explicit gate for a release or publication step.
 * Plain `--check`, which the tests and the publication audit run, prints stale
 * records as warnings with their dates and still exits 0: a change that touches
 * none of this should not fail because time passed, and the remedy is a live run.
 *
 * Every port in the port table must have an inventory entry with a published
 * library, in both modes and before any request: the header builds its links
 * from that entry, so a port without one would offer nothing and no other
 * check would say so.
 *
 * Usage:
 *   node scripts/verify-destinations.mjs [--out <path>] [--manifests <path>] [--inventory <path>] [--ports <slugs>] [--date <YYYY-MM-DD>]
 *   node scripts/verify-destinations.mjs --check [--fresh] [--out <path>] [--manifests <path>] [--inventory <path>] [--ports <slugs>] [--today <YYYY-MM-DD>]
 *
 *   --out <path>         The evidence file (default site/src/data/destination-evidence.json).
 *   --manifests <path>   The manifest packages naming each package's version.
 *   --inventory <path>   A JSON inventory in place of the committed one.
 *   --ports <slugs>      Comma-separated registered ports the inventory must cover (default: the port table).
 *   --check              Request nothing; compare the evidence file with the inventory.
 *   --fresh              With --check, also fail on evidence older than the bound.
 *   --date <date>        The day to record (default today, UTC). It may not be in the future.
 *   --today <date>       The day to measure age and future dates from (default today, UTC).
 *
 * LIBTMUX_DESTINATION_REWRITE holds a JSON object that maps an origin to a
 * replacement, so a test can answer the hosts from a local server.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INVENTORY } from '../site/src/lib/port-inventory.ts'
import { PORTS } from '../site/src/lib/ports.ts'
import { checkEvidence, collectDestinations, createGet, dateProblem, inventoryCoverage, staleRecords, staleWarnings, verifyDestination } from './lib/destination-verification.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(root, 'site', 'src', 'data', 'destination-evidence.json')
const DEFAULT_MANIFESTS = join(root, 'site', 'src', 'data', 'manifest-packages.json')

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10)
  const opts = { out: DEFAULT_OUT, manifests: DEFAULT_MANIFESTS, inventory: null, ports: PORTS.map((port) => port.slug), check: false, fresh: false, date: today, today }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--manifests') opts.manifests = argv[++i]
    else if (arg === '--today') opts.today = argv[++i]
    else if (arg === '--inventory') opts.inventory = argv[++i]
    else if (arg === '--ports') opts.ports = argv[++i].split(',').filter(Boolean)
    else if (arg === '--date') opts.date = argv[++i]
    else if (arg === '--check') opts.check = true
    else if (arg === '--fresh') opts.fresh = true
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

// A date a caller names is recorded or measured from, so it must be a real day that has happened.
for (const [flag, value] of [['--today', opts.today], ['--date', opts.date]]) {
  // The day to measure from is only a day; the day to record must also have happened by then.
  const problem = dateProblem(value, flag === '--today' ? undefined : new Date(`${opts.today}T12:00:00Z`))
  if (problem) {
    console.error(`${flag}: ${problem}`)
    process.exit(1)
  }
}

const inventory = opts.inventory ? JSON.parse(readFileSync(opts.inventory, 'utf8')) : INVENTORY

const uncovered = inventoryCoverage(inventory, opts.ports)
if (uncovered.length > 0) {
  for (const problem of uncovered) console.error(`  ${problem}`)
  console.error(`${uncovered.length} problem${uncovered.length === 1 ? '' : 's'} in the inventory`)
  process.exit(1)
}

function report(problems) {
  for (const problem of problems) console.error(`  ${problem}`)
  if (problems.length > 0) {
    console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'} in ${opts.out}`)
    process.exit(1)
  }
}

const manifests = existsSync(opts.manifests) ? JSON.parse(readFileSync(opts.manifests, 'utf8')) : { ports: {} }
const today = new Date(`${opts.today}T12:00:00Z`)

/**
 * Age is a failure where a live run is the remedy and a warning elsewhere.
 * Under GitHub Actions a warning is an annotation, so it shows on the run.
 */
function staleness(evidence, enforce) {
  const stale = staleRecords(evidence, { today })
  if (stale.length === 0) return []
  const lines = staleWarnings(stale)
  if (enforce) return lines.map((line) => line.replace(/: run node.*$/, ''))
  for (const line of lines) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Stale destination evidence::${line}`)
    else console.warn(`warning: ${line}`)
  }
  return []
}

if (opts.check) {
  if (!existsSync(opts.out)) {
    console.error(`${opts.out} does not exist. Run: node scripts/verify-destinations.mjs`)
    process.exit(1)
  }
  const evidence = JSON.parse(readFileSync(opts.out, 'utf8'))
  report([...checkEvidence(inventory, evidence, { manifests, today }), ...staleness(evidence, opts.fresh)])
  console.log(`${opts.out} agrees with the inventory`)
  process.exit(0)
}

const rewriteOrigins = JSON.parse(process.env.LIBTMUX_DESTINATION_REWRITE ?? '{}')
// The pause between requests keeps a live run polite to the hosts; a rewritten origin is a local server.
const get = createGet({ rewriteOrigins, ...(Object.keys(rewriteOrigins).length > 0 && { pauseMs: 0 }) })
const wanted = collectDestinations(inventory, manifests)

const records = []
for (const destination of wanted.values()) {
  const record = await verifyDestination(destination, { get })
  records.push({ ...record, checkedAt: opts.date, entries: destination.entries.map(({ port, id }) => `${port}:${id}`) })
  // A destination kept out of the links is meant to fail, so it reads as absent rather than broken.
  const absent = destination.entries.every(({ status }) => status !== 'published')
  console.log(`${record.ok ? 'ok  ' : absent ? 'none' : 'FAIL'} ${String(record.status ?? 0).padEnd(3)} ${destination.kinds.join('+').padEnd(11)} ${destination.url}${record.ok ? '' : `\n       ${record.failure}: ${record.detail}`}`)
}

records.sort((a, b) => a.url.localeCompare(b.url))
const evidence = { schema: 1, checkedAt: opts.date, destinations: records }
writeFileSync(opts.out, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(`wrote ${opts.out}`)
report([...checkEvidence(inventory, evidence, { manifests, today }), ...staleness(evidence, true)])
