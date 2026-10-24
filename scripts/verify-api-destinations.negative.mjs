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
 * The fixtures are shaped like the real pages, because a loose rule passes the
 * wrong symbol only on those: CPython's one `dt` per entry with no heading
 * between, rustdoc's code-header per method, Documenter's article per
 * docstring, and javadoc's headings for the types a page inherits from. Each
 * wrong link plants, in the text a loose rule reads, the name it asks for.
 *
 * The second half plants faults in a copy of the committed evidence and
 * requires `--check` to name each: a destination with no record, a record that
 * failed, a record for a link nothing generates, a name never checked against
 * its page, a pass that rests on no reviewed exception, an inventory that lost
 * its record, and a date no run could have written.
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
const JDK = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java'
const PY = 'https://docs.python.org/3/builtins'
const RUST = 'https://doc.rust-lang.org/std'
const JULIA = 'https://docs.julialang.org/en/v1/base/arrays/'

const page = (title, heading, ids = []) => `<!doctype html><html><head><title>${title}</title></head><body>
<h1>${heading}</h1>${ids.map((id) => `<section id="${id}"><h3>${id}</h3><p>${id}</p></section>`).join('')}</body></html>`

/*
 * Pages shaped like the real ones, because the real ones are where a loose rule
 * passes the wrong symbol. Each plants, in the text a loose rule reads, the
 * name of the symbol the wrong link asks for.
 */

/** CPython's manual: one `dt` per entry, no heading between entries, and entries that name each other. */
const cpython = (title, entries) => `<!doctype html><html><head><title>${title} — Python 3.15 documentation</title></head><body>
<h1>${title}</h1><section id="entries"><dl class="py">${entries.map(([id, text]) => `<dt class="sig sig-object py" id="${id}"><span class="pre">${id}</span>(<em>x</em>)</dt><dd><p>${text}</p></dd>`).join('')}</dl></section></body></html>`

/** rustdoc: a heading per group, a code-header per method, and bodies that call each other. */
const rustdoc = (name, module, kind, entries, headers = []) => `<!doctype html><html><head><title>${name} in std::${module} - Rust</title></head><body>
<h1>${kind} <span>${name}</span></h1>${headers.map((header) => `<h2>${header}</h2>`).join('')}${entries.map(([id, signature, text]) => `<section id="${id}" class="method"><h4 class="code-header">${signature}</h4></section><div class="docblock">${text}</div>`).join('')}</body></html>`

/** Documenter: an article per docstring with its binding as an anchor, and no heading between articles. */
const documenter = (entries) => `<!doctype html><html><head><title>Arrays · The Julia Language</title></head><body>
<h1 id="lib-arrays"><a class="docs-heading-anchor" href="#lib-arrays">Arrays</a></h1>${entries.map(([id, text]) => `<article class="docstring"><header><a class="docstring-binding" id="${id}" href="#${id}"><code>${id}</code></a></header><section><div><p>${text}</p></div></section></article>`).join('')}</body></html>`

/** javadoc: the title names the type; headings name every type whose members it inherits. */
const javadoc = (name, kind, { inherited = [], members = [] } = {}) => `<!doctype html><html><head><title>${name} (Java SE 21 &amp; JDK 21)</title></head><body>
<h1 class="title">${kind} ${name}</h1>${inherited.map((owner) => `<h3>Methods inherited from ${owner}</h3>`).join('')}${members.map(([id, text]) => `<section class="detail" id="${id}"><h3>${id.replace(/\(.*/, '')}</h3><div class="block">${text}</div></section>`).join('')}</body></html>`

const BASE = '/oracle/en/java/javase/21/docs/api/java.base/java'
/** What the stand-in hosts serve, by path under `/oracle`, `/python`, `/rust` and `/julia`. */
const pages = {
  [`${BASE}/util/Optional.html`]: { body: page('Optional (Java SE 21 &amp; JDK 21)', 'Class Optional&lt;T&gt;', ['of(T)', 'orElseThrow()']) },
  [`${BASE}/util/Vector.html`]: { body: page('Vector (Java SE 21 &amp; JDK 21)', 'Class Vector&lt;E&gt;', ['add(E)']) },
  // The page exists and the anchor exists, but the section under it documents another method.
  [`${BASE}/util/List.html`]: { body: javadoc('List&lt;E&gt;', 'Interface', { inherited: ['interface Collection', 'interface Iterable'], members: [['get(int)', 'Returns the element at the specified position.']] }) },
  // An address the host moves to its generic landing page.
  [`${BASE}/util/Stream.html`]: { status: 302, location: '/oracle/en/java/javase/21/docs/api/index.html' },
  '/oracle/en/java/javase/21/docs/api/index.html': { body: page('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification', []) },
  // A search address answers 200 with the landing page and never the type.
  [`${BASE}/util/Map.html`]: { body: page('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification', []) },
  [`${BASE}/util/Set.html`]: { status: 429 },
  // The classes the wrong links point at, with the headings that name the types they inherit from.
  [`${BASE}/util/ArrayList.html`]: { body: javadoc('ArrayList&lt;E&gt;', 'Class', { inherited: ['class AbstractList', 'interface List', 'interface Collection'] }) },
  [`${BASE}/util/HashMap.html`]: { body: javadoc('HashMap&lt;K,V&gt;', 'Class', { inherited: ['class AbstractMap', 'interface Map'] }) },
  [`${BASE}/nio/file/Files.html`]: { body: javadoc('Files', 'Class', { members: [['newBufferedReader(Path)', 'Opens a file for reading.'], ['walk(Path,int,FileVisitOption...)', 'Return a Stream that is lazily populated with Path.']] }) },
  [`${BASE}/nio/file/Path.html`]: { body: javadoc('Path', 'Interface', { members: [['resolve(String)', 'Converts a given path string to a Path and resolves it.']] }) },
  [`${BASE}/io/InputStream.html`]: { body: javadoc('InputStream', 'Class', { inherited: ['interface AutoCloseable'], members: [['close()', 'Closes this input stream and releases any system resources.']] }) },
  [`${BASE}/lang/AutoCloseable.html`]: { body: javadoc('AutoCloseable', 'Interface', { members: [['close()', 'Closes this resource, relinquishing any underlying resources.']] }) },
  '/python/3/builtins/functions.html': { body: cpython('Built-in Functions', [
    ['abs', 'Return the absolute value of a number. The argument may be an int, a float or an object implementing __abs__(); an int subclass is accepted.'],
    ['aiter', 'Return an asynchronous iterator for an asynchronous iterable.'],
    ['int', 'Return an integer object constructed from a number or a string.'],
  ]) },
  '/python/3/builtins/exceptions.html': { body: cpython('Built-in Exceptions', [
    ['IndexError', 'Raised when a sequence subscript is out of range. See also OSError and LookupError.'],
    ['OSError', 'This exception is raised when a system function returns a system-related error.'],
  ]) },
  '/rust/std/iter/trait.Iterator.html': { body: rustdoc('Iterator', 'iter', 'Trait', [
    ['tymethod.next', 'fn <a>next</a>(&amp;mut self) -&gt; Option&lt;Self::Item&gt;', 'Advances the iterator and returns the next value.'],
    ['method.filter', 'fn <a>filter</a>&lt;P&gt;(self, predicate: P) -&gt; Filter&lt;Self, P&gt;', 'Creates an iterator which uses a closure to decide if an element is yielded. Calls next until a match.'],
  ], ['Required Methods', 'Provided Methods']) },
  '/rust/std/option/enum.Option.html': { body: rustdoc('Option', 'option', 'Enum', [['variant.None', 'None', 'No value.']], ['Variants']) },
  '/rust/std/result/enum.Result.html': { body: rustdoc('Result', 'result', 'Enum', [['method.ok', 'pub fn ok(self) -&gt; <a>Option</a>&lt;T&gt;', 'Converts from Result&lt;T, E&gt; to Option&lt;T&gt;.']], ['Implementations']) },
  '/julia/en/v1/base/arrays/': { body: documenter([
    ['Core.Array', 'Array{T,N} &lt;: AbstractArray{T,N}. N-dimensional dense array with elements of type T.'],
    ['Base.Vector', 'Vector{T} is an alias for Array{T,1}: a one-dimensional dense Array.'],
  ]) },
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
const rewriteOrigins = {
  'https://docs.oracle.com': `${origin}/oracle`, 'https://docs.python.org': `${origin}/python`,
  'https://doc.rust-lang.org': `${origin}/rust`, 'https://docs.julialang.org': `${origin}/julia`,
}
const get = createGet({ rewriteOrigins, pauseMs: 0, retries: 0 })

let failures = 0
const fail = (message) => {
  failures += 1
  console.error(`FAIL ${message}`)
}

const at = (url, port, name, source = 'builtin') => ({ url, host: new URL(url).hostname, uses: [{ port, name, source }] })
const destination = (path, name, source = 'type') => at(`${API}/${path}`, 'java', name, source)

const cases = [
  { name: 'control: the page names the symbol', destination: destination('Optional.html', 'Optional'), ok: true },
  { name: 'control: the fragment exists under the symbol', destination: destination('Optional.html#of(T)', 'Optional.of'), ok: true },
  { name: 'wrong fragment', destination: destination('Optional.html#ofNullable(T)', 'Optional.ofNullable'), failure: 'fragment' },
  { name: 'wrong page', destination: destination('Vector.html', 'Optional'), failure: 'symbol' },
  { name: 'removed symbol: the fragment is there and documents another method', destination: destination('List.html#get(int)', 'List.remove'), failure: 'symbol' },
  { name: 'redirect to a generic page', destination: destination('Stream.html', 'Stream'), failure: 'moved' },
  { name: 'generic page that answers 200', destination: destination('Map.html', 'Map'), failure: 'symbol' },
  { name: 'the old search address for a member the JDK does not list', destination: at('https://docs.oracle.com/en/java/javase/21/docs/api/index.html?q=Stream.noSuchMember', 'java', 'Stream.noSuchMember', 'prose'), failure: 'symbol' },
  { name: 'page that is gone', destination: destination('Gone.html', 'Gone'), failure: 'status' },
  { name: 'rate-limited host is unresolved, never passing', destination: destination('Set.html', 'Set'), unverifiable: /rate-limited/ },

  // CPython-shaped: entries are `dt`s with no heading between them, and a neighbour's text names the symbol.
  { name: 'CPython control: int at #int', destination: at(`${PY}/functions.html#int`, 'py', 'int'), ok: true },
  { name: 'CPython: int at the entry for abs, whose text says int', destination: at(`${PY}/functions.html#abs`, 'py', 'int'), failure: 'symbol' },
  { name: 'CPython control: OSError at #OSError', destination: at(`${PY}/exceptions.html#OSError`, 'py', 'OSError'), ok: true },
  { name: 'CPython: OSError at the entry for IndexError, whose text says OSError', destination: at(`${PY}/exceptions.html#IndexError`, 'py', 'OSError'), failure: 'symbol' },

  // rustdoc-shaped: a code-header per method, and a body that mentions the other.
  { name: 'rustdoc control: Iterator::next at #tymethod.next', destination: at(`${RUST}/iter/trait.Iterator.html#tymethod.next`, 'rs', 'Iterator::next'), ok: true },
  { name: 'rustdoc: Iterator::next at the entry for filter, whose text says next', destination: at(`${RUST}/iter/trait.Iterator.html#method.filter`, 'rs', 'Iterator::next'), failure: 'symbol' },
  { name: 'rustdoc control: Option at its own page', destination: at(`${RUST}/option/enum.Option.html`, 'rs', 'Option'), ok: true },
  { name: 'rustdoc: Option at Result, whose method headers return Option', destination: at(`${RUST}/result/enum.Result.html`, 'rs', 'Option'), failure: 'symbol' },

  // Documenter-shaped: an article per docstring, and a docstring that names the type it aliases.
  { name: 'Documenter control: Array at #Core.Array', destination: at(`${JULIA}#Core.Array`, 'julia', 'Array'), ok: true },
  { name: 'Documenter: Array at the docstring for Vector, which names Array', destination: at(`${JULIA}#Base.Vector`, 'julia', 'Array'), failure: 'symbol' },

  // javadoc-shaped: headings name the types a page inherits from, and anchors spell their parameter types.
  { name: 'javadoc control: AutoCloseable.close at AutoCloseable', destination: at(`${JDK}/lang/AutoCloseable.html#close()`, 'java', 'AutoCloseable.close'), ok: true },
  { name: 'javadoc: AutoCloseable.close at InputStream, which has its own close()', destination: at(`${JDK}/io/InputStream.html#close()`, 'java', 'AutoCloseable.close'), failure: 'owner' },
  { name: 'javadoc control: List at its own page', destination: at(`${JDK}/util/List.html`, 'java', 'List'), ok: true },
  { name: 'javadoc: List at ArrayList, headed "Methods inherited from interface List"', destination: at(`${JDK}/util/ArrayList.html`, 'java', 'List'), failure: 'symbol' },
  { name: 'javadoc: Map at HashMap, headed "Methods inherited from interface Map"', destination: at(`${JDK}/util/HashMap.html`, 'java', 'Map'), failure: 'symbol' },
  { name: 'javadoc: Collection at List, headed "Methods inherited from interface Collection"', destination: at(`${JDK}/util/List.html`, 'java', 'Collection'), failure: 'symbol' },
  { name: 'javadoc control: Path at its own page', destination: at(`${JDK}/nio/file/Path.html`, 'java', 'Path'), ok: true },
  { name: 'javadoc: Path at Files, whose anchors spell Path', destination: at(`${JDK}/nio/file/Files.html`, 'java', 'Path'), failure: 'symbol' },
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
const firstTitled = evidence.destinations.findIndex((record) => record.ok && record.terminal?.some((entry) => entry.at === 'title'))

const drives = [
  { name: 'control: the committed evidence', mutate: () => {}, status: 0 },
  { name: 'a destination with no record', mutate: (copy) => { copy.destinations.splice(firstChecked, 1) }, expect: /has no evidence/ },
  { name: 'a record that failed', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { ok: false, failure: 'fragment', detail: 'planted' }) }, expect: /does not land on its symbol \(fragment\): planted/ },
  { name: 'a record for a link nothing generates', mutate: (copy) => { copy.destinations.push({ ...copy.destinations[firstChecked], url: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Gone.html' }) }, expect: /no source generates it/ },
  { name: 'a name never checked against its page', mutate: (copy) => { copy.destinations[firstChecked].terminal = [] }, expect: /was never checked for/ },
  { name: 'a pass by the page text that no reviewed exception allows', mutate: (copy) => { copy.destinations[firstTitled].terminal.find((entry) => entry.at === 'title').at = 'listed' }, expect: /by listed, which no reviewed exception/ },
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
