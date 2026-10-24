#!/usr/bin/env node
/**
 * The proof that the API destination check can fail, and for the reason it
 * names.
 *
 * A check that cannot fail is worse than none, and this one asks hosts a
 * question whose wrong answers all look like success to a status code: a page
 * that exists, at a fragment that does not; the right fragment on the wrong
 * page; a redirect to a landing page that answers 200. Each case plants one of
 * those on a local server standing in for the JDK's documentation, and
 * requires the verifier to fail with the reason that case is about. The clean
 * controls beside them must pass, or a failure would prove only that the
 * server was unreachable.
 *
 * The second half plants faults in a copy of the committed evidence and
 * requires `--check` to name each: a destination with no record, a record that
 * failed, a record for a link nothing generates, a name never checked against
 * its page, an inventory that lost its record, and a date no run could have
 * written.
 *
 * Usage: node scripts/verify-api-destinations.negative.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGet } from './lib/destination-verification.mjs'
import { verifyApiDestination } from './lib/api-destination-verification.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util'

const page = (title, heading, ids = []) => `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${heading}</h1>${ids.map((id) => `<section id="${id}"><h3>${id}</h3><p>${id}</p></section>`).join('')}</body></html>`

/** What the stand-in JDK serves, by path under `/oracle`. */
const pages = {
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/Optional.html': { body: page('Optional (Java SE 21 &amp; JDK 21)', 'Class Optional&lt;T&gt;', ['of(T)', 'orElseThrow()']) },
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/Vector.html': { body: page('Vector (Java SE 21 &amp; JDK 21)', 'Class Vector&lt;E&gt;', ['add(E)']) },
  // The page exists and the anchor exists, but the section under it documents another method.
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/List.html': { body: page('List (Java SE 21 &amp; JDK 21)', 'Interface List&lt;E&gt;', ['get(int)']) },
  // An address the host moves to its generic landing page.
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/Stream.html': { status: 302, location: '/oracle/en/java/javase/21/docs/api/index.html' },
  '/oracle/en/java/javase/21/docs/api/index.html': { body: page('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification', []) },
  // A search address answers 200 with the landing page and never the type.
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/Map.html': { body: page('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification', []) },
  '/oracle/en/java/javase/21/docs/api/java.base/java/util/Set.html': { status: 429 },
}

const server = createServer((request, response) => {
  const entry = pages[request.url?.split('?')[0] ?? '']
  if (!entry) {
    response.writeHead(404).end('not found')
  } else if (entry.location) {
    response.writeHead(entry.status, { location: entry.location }).end()
  } else if (entry.status) {
    response.writeHead(entry.status).end('')
  } else {
    response.writeHead(200, { 'content-type': 'text/html' }).end(entry.body)
  }
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const origin = `http://127.0.0.1:${server.address().port}`
const rewriteOrigins = { 'https://docs.oracle.com': `${origin}/oracle` }
const get = createGet({ rewriteOrigins, pauseMs: 0, retries: 0 })

let failures = 0
const fail = (message) => {
  failures += 1
  console.error(`FAIL ${message}`)
}

const destination = (path, name, source = 'type') => ({ url: `${API}/${path}`, host: 'docs.oracle.com', uses: [{ port: 'java', name, source }] })

const cases = [
  { name: 'control: the page names the symbol', destination: destination('Optional.html', 'Optional'), ok: true },
  { name: 'control: the fragment exists under the symbol', destination: destination('Optional.html#of(T)', 'Optional.of'), ok: true },
  { name: 'wrong fragment', destination: destination('Optional.html#ofNullable(T)', 'Optional.ofNullable'), failure: 'fragment' },
  { name: 'wrong page', destination: destination('Vector.html', 'Optional'), failure: 'symbol' },
  { name: 'removed symbol: the fragment is there and documents another method', destination: destination('List.html#get(int)', 'List.remove'), failure: 'symbol' },
  { name: 'redirect to a generic page', destination: destination('Stream.html', 'Stream'), failure: 'moved' },
  { name: 'generic page that answers 200', destination: destination('Map.html', 'Map'), failure: 'symbol' },
  { name: 'the old search address for a member the JDK does not list', destination: { url: 'https://docs.oracle.com/en/java/javase/21/docs/api/index.html?q=Stream.noSuchMember', host: 'docs.oracle.com', uses: [{ port: 'java', name: 'Stream.noSuchMember', source: 'prose' }] }, failure: 'symbol' },
  { name: 'page that is gone', destination: destination('Gone.html', 'Gone'), failure: 'status' },
  { name: 'rate-limited host is unresolved, never passing', destination: destination('Set.html', 'Set'), unverifiable: /rate-limited/ },
]

for (const testCase of cases) {
  const record = await verifyApiDestination(testCase.destination, { get })
  if (testCase.ok) {
    if (!record.ok) fail(`${testCase.name}: expected a pass, got ${record.failure ?? record.unverifiable}: ${record.detail ?? ''}`)
    else console.log(`ok   ${testCase.name}`)
  } else if (testCase.unverifiable) {
    if (record.ok || !testCase.unverifiable.test(record.unverifiable ?? '')) fail(`${testCase.name}: expected unverifiable, got ${JSON.stringify(record)}`)
    else console.log(`ok   ${testCase.name}: ${record.unverifiable}`)
  } else if (record.ok || record.failure !== testCase.failure) {
    fail(`${testCase.name}: expected failure ${testCase.failure}, got ${record.ok ? 'a pass' : `${record.failure}: ${record.detail}`}`)
  } else {
    console.log(`ok   ${testCase.name}: ${record.failure}`)
  }
}
server.close()

// The second half drives the real command over a copy of the committed evidence.
const dir = mkdtempSync(join(tmpdir(), 'api-destination-negative-'))
const committed = join(root, 'site', 'src', 'data', 'api-destination-evidence.json')
const evidence = JSON.parse(readFileSync(committed, 'utf8'))
const check = (mutate) => {
  const copy = JSON.parse(JSON.stringify(evidence))
  mutate(copy)
  const file = join(dir, 'evidence.json')
  writeFileSync(file, `${JSON.stringify(copy)}\n`)
  return spawnSync(process.execPath, [join(root, 'scripts', 'verify-api-destinations.mjs'), '--check', '--out', file], { encoding: 'utf8' })
}
const firstChecked = evidence.destinations.findIndex((record) => record.ok && record.terminal?.length > 0)

const drives = [
  { name: 'control: the committed evidence', mutate: () => {}, status: 0 },
  { name: 'a destination with no record', mutate: (copy) => { copy.destinations.splice(firstChecked, 1) }, expect: /has no evidence/ },
  { name: 'a record that failed', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { ok: false, failure: 'fragment', detail: 'planted' }) }, expect: /does not land on its symbol \(fragment\): planted/ },
  { name: 'a record for a link nothing generates', mutate: (copy) => { copy.destinations.push({ ...copy.destinations[firstChecked], url: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Gone.html' }) }, expect: /no source generates it/ },
  { name: 'a name never checked against its page', mutate: (copy) => { copy.destinations[firstChecked].terminal = [] }, expect: /was never checked for/ },
  { name: 'an inventory without a record', mutate: (copy) => { copy.inventories = copy.inventories.filter((record) => record.name !== 'jdk') }, expect: /the jdk inventory has no record/ },
  { name: 'an inventory that names pages its host lacks', mutate: (copy) => { Object.assign(copy.inventories[0], { ok: false, missing: 3, examples: ['Planted'] }) }, expect: /names 3 pages its host's index lacks/ },
  { name: 'an inventory rebuilt since it was verified', mutate: (copy) => { copy.inventories[0].entries += 1 }, expect: /was verified with/ },
  { name: 'a date no run could have written', mutate: (copy) => { copy.destinations[firstChecked].checkedAt = '2999-01-01' }, expect: /is dated 2999-01-01, which is in the future/ },
]
for (const drive of drives) {
  const result = check(drive.mutate)
  const output = `${result.stdout}${result.stderr}`
  if (drive.expect) {
    if (result.status !== 1 || !drive.expect.test(output)) fail(`${drive.name}: expected exit 1 matching ${drive.expect}, got ${result.status}\n${output.slice(0, 600)}`)
    else console.log(`ok   ${drive.name}`)
  } else if (result.status !== drive.status) {
    fail(`${drive.name}: expected exit ${drive.status}, got ${result.status}\n${output.slice(0, 600)}`)
  } else {
    console.log(`ok   ${drive.name}`)
  }
}
rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`${failures} negative case${failures === 1 ? '' : 's'} did not fail for the reason they name`)
  process.exit(1)
}
console.log('every planted fault failed for its named reason')
