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
const JULIA_BASE = 'https://docs.julialang.org/en/v1/base'
const PYLIB = 'https://docs.python.org/3/library'
const HEXDOCS = 'https://elixir.hexdocs.pm'
const TS = 'https://www.typescriptlang.org/docs/handbook'
const CPPREF = 'https://en.cppreference.com/cpp'
const JLS = 'https://docs.oracle.com/javase/specs/jls/se21/html'

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

/** A page with a title, a top heading and a body, for the hosts whose structure matters less than their addresses. */
const plain = (title, heading, body = '') => `<!doctype html><html><head><title>${title}</title></head><body><h1>${heading}</h1>${body}</body></html>`
/** A heading-owned section: an anchor on the heading and the text under it. */
const part = (id, heading, text, level = 3) => `<h${level} id="${id}">${heading}</h${level}><p>${text}</p>`
/** A function or type entry on a package page: pkg.go.dev's heading with an id, ExDoc's section with an id. */
const entry = (tag, id, text = '') => `<${tag} id="${id}">${id}</${tag}><p>${text}</p>`

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
    ['method.next_chunk', 'fn <a>next_chunk</a>&lt;const N: usize&gt;(&amp;mut self) -&gt; Result&lt;[Self::Item; N], _&gt;', 'Advances the iterator and returns an array containing the next N values.'],
  ], ['Required Methods', 'Provided Methods']) },
  '/rust/std/result/enum.Result.html': { body: rustdoc('Result', 'result', 'Enum', [['method.ok', 'pub fn ok(self) -&gt; <a>Option</a>&lt;T&gt;', 'Converts from Result&lt;T, E&gt; to Option&lt;T&gt;.']], ['Implementations']) },
  // Identifier-addressed hosts: the wrong entry exists, one word away from the right one.
  '/python/3/library/warnings.html': { body: cpython('warnings', [['warnings.warn', 'Issue a warning.'], ['warnings.warn_explicit', 'This is a low-level interface to the functionality of warn(), passing in explicitly the message, category, filename and line number.']]) },
  '/python/3/library/os.path.html': { body: cpython('os.path', [['os.path.join', 'Join one or more path segments intelligently.']]) },
  '/python/3/builtins/stdtypes.html': { body: cpython('Built-in Types', [['str.join', 'Return a string which is the concatenation of the strings in iterable. Compare os.path.join.'], ['str.split', 'Return a list of the words in the string.']]) },
  '/python/3/library/pdb.html': { body: cpython('pdb', [['pdbcommand-run', 'Restart the debugged Python program. Compare the run method of a thread.'], ['pdbcommand-step', 'Execute the current line.']]) },
  '/rust/std/option/enum.Option.html': { body: rustdoc('Option', 'option', 'Enum', [['variant.None', 'None', 'No value.'], ['method.map', 'pub fn map&lt;U, F&gt;(self, f: F) -&gt; Option&lt;U&gt;', 'Maps an Option&lt;T&gt; to Option&lt;U&gt;.'], ['method.map_or', 'pub fn map_or&lt;U, F&gt;(self, default: U, f: F) -&gt; U', 'Returns the provided default, or applies a function to the contained value. Compare map.']], ['Variants']) },
  '/rust/std/io/struct.Error.html': { body: rustdoc('Error', 'io', 'Struct', [['method.kind', 'pub fn kind(&amp;self) -&gt; ErrorKind', 'Returns the corresponding ErrorKind for this error.']]) },
  '/rust/std/fmt/struct.Error.html': { body: rustdoc('Error', 'fmt', 'Struct', [['impl-Display-for-Error', 'impl Display for Error', 'The error type which is returned from formatting a message into a stream.']]) },
  '/hexdocs/Enum.html': { body: `<!doctype html><html><head><title>Enum (Elixir v1.20.4)</title></head><body><h1>Enum</h1>${['map/2', 'map_every/3', 'member?/2', 'member?/3'].map((id) => entry('section', id, `${id} of Enum`)).join('')}</body></html>` },
  '/hexdocs/typespecs.html': { body: plain('Typespecs reference \u2014 Elixir v1.20.4', 'Typespecs reference', `${part('basic-types', 'Basic types', 'any(), none(), atom(), map(), pid(), port(), reference(), struct() and tuple().')}${part('literals', 'Literals', 'Atoms: :atom, Integers: 1, Lists: [], nil, and maps: %{required(key_type) => value_type}.')}`) },
  '/go/errors': { body: plain('errors package - errors - Go Packages', 'errors', `${entry('h4', 'Join', 'Join returns an error that wraps the given errors.')}${entry('h4', 'Is', 'Is reports whether any error in err matches target.')}`) },
  '/go/strings': { body: plain('strings package - strings - Go Packages', 'strings', `${entry('h4', 'Join', 'Join concatenates the elements of its first argument to create a single string.')}`) },
  '/learn/dotnet/api/system.threading.timer': { body: plain('Timer Class (System.Threading) | Microsoft Learn', 'Timer Class', 'Provides a mechanism for executing a method on a thread pool thread at specified intervals.') },
  '/learn/dotnet/api/system.timers.timer': { body: plain('Timer Class (System.Timers) | Microsoft Learn', 'Timer Class', 'Generates recurring events in an application.') },
  '/ts/docs/handbook/utility-types.html': { body: plain('Documentation - Utility Types', 'Utility Types', `${part('omittype-keys', 'Omit&lt;Type, Keys&gt;', 'Constructs a type by picking all properties from Type and then removing Keys.')}${part('omitthisparametertype', 'OmitThisParameter&lt;Type&gt;', 'Removes the this parameter from Type.')}`) },
  // cppreference: a title that names one subject, and text that names the rest.
  '/cppref/cpp/container/vector': { body: plain('std::vector - cppreference.com', 'std::vector', 'std::vector&lt;bool&gt; is a space-efficient specialization. The int and char element types are common.') },
  '/cppref/cpp/string/basic_string': { body: plain('std::basic_string - cppreference.com', 'std::basic_string', 'A string of char holds an int length. See std::string_view.') },
  '/cppref/cpp/chrono/duration': { body: plain('std::chrono::duration - cppreference.com', 'std::chrono::duration', '<table><tr><td>std::chrono::milliseconds</td></tr><tr><td>std::chrono::seconds</td></tr></table>') },
  '/cppref/cpp/chrono/steady_clock': { body: plain('std::chrono::steady_clock - cppreference.com', 'std::chrono::steady_clock', 'The clock counts in seconds since an unspecified epoch. The time_point member type is a time_point.') },
  '/cppref/cpp/types/remove_cv': { body: plain('std::remove_cv, std::remove_const, std::remove_volatile - cppreference.com', 'std::remove_cv', 'Helper types: remove_cv_t, remove_const_t, remove_volatile_t.') },
  '/cppref/cpp/types/remove_cvref': { body: plain('std::remove_cvref - cppreference.com', 'std::remove_cvref', 'Like remove_cv, but also removes the reference. Possible implementation: remove_cv_t&lt;remove_reference_t&lt;T&gt;&gt;. Helper type: remove_cvref_t.') },
  '/fsharp/fsharp-core-docs/reference/fsharp-collections-seqmodule.html': { body: plain('Seq (FSharp.Core) | FSharp.Core', 'Seq Module', part('filter', 'filter', 'Returns a new collection containing only the elements of the collection for which the given predicate returns true.')) },
  '/fsharp/fsharp-core-docs/reference/fsharp-collections-listmodule.html': { body: plain('List (FSharp.Core) | FSharp.Core', 'List Module', part('filter', 'filter', 'Returns a new list containing only the elements of the list for which the given predicate returns true.')) },
  '/cppref/cpp/language/bool_literal': { body: plain('Boolean literals - cppreference.com', 'Boolean literals', 'The boolean literals are the keywords true and false, of type bool.') },
  // Pages that document several symbols under one anchor.
  '/oracle/javase/specs/jls/se21/html/jls-4.html': { body: plain('Chapter 4. Types, Values, and Variables', 'Chapter 4. Types, Values, and Variables', '<h3 class="title"><a name="jls-4.2.5"></a>4.2.5. The boolean Type and boolean Values</h3><p>The boolean type represents a logical quantity with two possible values, indicated by the literals true and false.</p>') },
  '/oracle/javase/specs/jls/se21/html/jls-14.html': { body: plain('Chapter 14. Blocks, Statements, and Patterns', 'Chapter 14. Blocks, Statements, and Patterns', '<h3 class="title"><a name="jls-14.9"></a>14.9. The if Statement</h3><p>The Expression must have type boolean, or a compile-time error occurs.</p>') },
  '/kotlin/docs/coroutines-basics.html': { body: plain('Coroutines basics', 'Coroutines basics', `${part('suspending-functions', 'Extract function refactoring', 'The suspend modifier marks a suspending function.', 2)}${part('runblocking', 'Scope builder', 'runBlocking blocks the thread until a suspend block completes.', 2)}${part('coroutine-dispatchers', 'Coroutine dispatchers', 'A suspend call may resume on another dispatcher.', 2)}`) },
  '/julia/en/v1/base/sort/': { body: documenter([['Base.sort', 'sort(v; alg, lt, by, rev, order) returns a sorted copy of v.'], ['Base.sort!', 'sort!(v; alg, lt, by, rev, order) sorts v in place. Compare sort.']]).replace('Arrays \u00b7 The Julia Language', 'Sorting and Related Functions \u00b7 The Julia Language') },
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
  'https://elixir.hexdocs.pm': `${origin}/hexdocs`, 'https://pkg.go.dev': `${origin}/go`,
  'https://learn.microsoft.com': `${origin}/learn`, 'https://en.cppreference.com': `${origin}/cppref`,
  'https://www.typescriptlang.org': `${origin}/ts`, 'https://kotlinlang.org': `${origin}/kotlin`, 'https://fsharp.github.io': `${origin}/fsharp`,
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

  // Class: a fragment that merely contains the word. Where fragments are identifiers, the identifier is compared whole.
  { name: 'CPython control: warnings.warn at #warnings.warn', destination: at(`${PYLIB}/warnings.html#warnings.warn`, 'py', 'warnings.warn'), ok: true },
  { name: 'identifier: warnings.warn at #warnings.warn_explicit', destination: at(`${PYLIB}/warnings.html#warnings.warn_explicit`, 'py', 'warnings.warn'), failure: 'symbol' },
  { name: 'rustdoc control: Option::map at #method.map', destination: at(`${RUST}/option/enum.Option.html#method.map`, 'rs', 'Option::map'), ok: true },
  { name: 'identifier: Option::map at #method.map_or', destination: at(`${RUST}/option/enum.Option.html#method.map_or`, 'rs', 'Option::map'), failure: 'symbol' },
  { name: 'identifier: Iterator::next at #method.next_chunk', destination: at(`${RUST}/iter/trait.Iterator.html#method.next_chunk`, 'rs', 'Iterator::next'), failure: 'symbol' },
  { name: 'ExDoc control: Enum.map/2 at #map/2', destination: at(`${HEXDOCS}/Enum.html#map/2`, 'elixir', 'Enum.map/2'), ok: true },
  { name: 'identifier: Enum.map/2 at #map_every/3', destination: at(`${HEXDOCS}/Enum.html#map_every/3`, 'elixir', 'Enum.map/2'), failure: 'symbol' },
  { name: 'identifier: Enum.member?/2 at #member?/3, the same name with another operand count', destination: at(`${HEXDOCS}/Enum.html#member?/3`, 'elixir', 'Enum.member?/2'), failure: 'symbol' },
  { name: 'Documenter control: Base.sort at #Base.sort', destination: at(`${JULIA_BASE}/sort/#Base.sort`, 'julia', 'Base.sort'), ok: true },
  { name: 'identifier: Base.sort at #Base.sort!', destination: at(`${JULIA_BASE}/sort/#Base.sort!`, 'julia', 'Base.sort'), failure: 'symbol' },
  { name: 'identifier: py run(self.x) at #pdbcommand-run, a pdb command and no symbol', destination: at(`${PYLIB}/pdb.html#pdbcommand-run`, 'py', 'run(self.x)', 'doc'), failure: 'symbol' },
  { name: 'handbook control: Omit at its own anchor, a reviewed exception', destination: at(`${TS}/utility-types.html#omittype-keys`, 'ts', 'Omit'), ok: true },
  { name: 'handbook: Omit at the anchor for OmitThisParameter, which starts with Omit', destination: at(`${TS}/utility-types.html#omitthisparametertype`, 'ts', 'Omit'), failure: 'symbol' },

  // Class: a package, module or type before the symbol that the address does not carry.
  { name: 'rustdoc control: std::io::Error at std/io', destination: at(`${RUST}/io/struct.Error.html`, 'rs', 'std::io::Error'), ok: true },
  { name: 'owner: std::io::Error at the Error of std::fmt', destination: at(`${RUST}/fmt/struct.Error.html`, 'rs', 'std::io::Error'), failure: 'owner' },
  { name: 'pkg.go.dev control: errors.Join at errors', destination: at('https://pkg.go.dev/errors#Join', 'go', 'errors.Join'), ok: true },
  { name: 'owner: errors.Join at the Join of strings', destination: at('https://pkg.go.dev/strings#Join', 'go', 'errors.Join'), failure: 'owner' },
  { name: 'Learn control: System.Threading.Timer at its page', destination: at('https://learn.microsoft.com/dotnet/api/system.threading.timer', 'csharp', 'System.Threading.Timer'), ok: true },
  { name: 'owner: System.Threading.Timer at System.Timers.Timer, with no fragment', destination: at('https://learn.microsoft.com/dotnet/api/system.timers.timer', 'csharp', 'System.Threading.Timer'), failure: 'owner' },
  { name: 'F# control: Seq.filter at the Seq module', destination: at('https://fsharp.github.io/fsharp-core-docs/reference/fsharp-collections-seqmodule.html#filter', 'fsharp', 'Seq.filter'), ok: true },
  { name: 'owner: Seq.filter at the filter of the List module', destination: at('https://fsharp.github.io/fsharp-core-docs/reference/fsharp-collections-listmodule.html#filter', 'fsharp', 'Seq.filter'), failure: 'owner' },
  { name: 'identifier: Seq.filter! at the filter of Seq, a name that ends differently', destination: at('https://fsharp.github.io/fsharp-core-docs/reference/fsharp-collections-seqmodule.html#filter', 'fsharp', 'Seq.filter!'), failure: 'symbol' },
  { name: 'cppreference control: std::vector at its page', destination: at(`${CPPREF}/container/vector`, 'cxx', 'std::vector'), ok: true },
  { name: 'owner: std::ranges::vector at std::vector, a namespace neither the address nor the title names', destination: at(`${CPPREF}/container/vector`, 'cxx', 'std::ranges::vector'), failure: 'owner' },
  { name: 'owner: Keyword::vector at std::vector', destination: at(`${CPPREF}/container/vector`, 'cxx', 'Keyword::vector'), failure: 'owner' },
  { name: 'owner: str.join written os.path.join, at the join of str', destination: at(`${PY}/stdtypes.html#str.join`, 'py', 'os.path.join'), failure: 'owner' },
  { name: 'CPython control: os.path.join at os.path', destination: at(`${PYLIB}/os.path.html#os.path.join`, 'py', 'os.path.join'), ok: true },

  // Class: an exception that names a word, not an address. Each is pinned to the one address it was reviewed for.
  { name: 'cppreference control: std::chrono::seconds at the duration page that lists it', destination: at(`${CPPREF}/chrono/duration`, 'cxx', 'std::chrono::seconds'), ok: true },
  { name: 'cppreference control: bool at the boolean literals page', destination: at(`${CPPREF}/language/bool_literal`, 'cxx', 'bool'), ok: true },
  { name: 'listed: bool at std::vector, whose text says vector<bool>', destination: at(`${CPPREF}/container/vector`, 'cxx', 'bool'), failure: 'symbol' },
  { name: 'listed: int at std::basic_string, whose text says int', destination: at(`${CPPREF}/string/basic_string`, 'cxx', 'int'), failure: 'symbol' },
  { name: 'listed: std::chrono::seconds at steady_clock, whose text says seconds', destination: at(`${CPPREF}/chrono/steady_clock`, 'cxx', 'std::chrono::seconds'), failure: 'symbol' },
  { name: 'listed: std::remove_cv_t at remove_cvref, whose text says remove_cv', destination: at(`${CPPREF}/types/remove_cvref`, 'cxx', 'std::remove_cv_t'), failure: 'symbol' },
  { name: 'cppreference control: std::remove_cv_t at remove_cv, a reviewed exception', destination: at(`${CPPREF}/types/remove_cv`, 'cxx', 'std::remove_cv_t'), ok: true },
  { name: 'section control: boolean at JLS 4.2.5', destination: at(`${JLS}/jls-4.html#jls-4.2.5`, 'java', 'boolean'), ok: true },
  { name: 'section: boolean at JLS 14.9, the if statement, whose text says boolean', destination: at(`${JLS}/jls-14.html#jls-14.9`, 'java', 'boolean'), failure: 'symbol' },
  { name: 'section control: suspend at the section on suspending functions', destination: at('https://kotlinlang.org/docs/coroutines-basics.html#suspending-functions', 'kotlin', 'suspend'), ok: true },
  { name: 'section: suspend at runBlocking, whose text says suspend', destination: at('https://kotlinlang.org/docs/coroutines-basics.html#runblocking', 'kotlin', 'suspend'), failure: 'symbol' },
  { name: 'section: suspend at the dispatchers section, whose text says suspend', destination: at('https://kotlinlang.org/docs/coroutines-basics.html#coroutine-dispatchers', 'kotlin', 'suspend'), failure: 'symbol' },
  { name: 'section control: atom at the basic types of the typespec reference', destination: at(`${HEXDOCS}/typespecs.html#basic-types`, 'elixir', 'atom'), ok: true },
  { name: 'section: atom at the literals, which write atoms', destination: at(`${HEXDOCS}/typespecs.html#literals`, 'elixir', 'atom'), failure: 'symbol' },
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
  { name: 'a passing record with the status 404', mutate: (copy) => { copy.destinations[firstChecked].status = 404 }, expect: /passing with the status 404/ },
  { name: 'a passing record that carries a failure', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { failure: 'fragment', detail: 'planted' }) }, expect: /passing yet carries failure/ },
  { name: 'a passing record that redirects', mutate: (copy) => { copy.destinations[firstChecked].finalUrl = 'https://example.org/moved' }, expect: /passing yet carries finalUrl/ },
  { name: 'a passing record that is also unverifiable', mutate: (copy) => { copy.destinations[firstChecked].unverifiable = 'the host blocks the request (403)' }, expect: /passing yet carries unverifiable/ },
  { name: 'a record under another host', mutate: (copy) => { copy.destinations[firstChecked].host = 'example.org' }, expect: /recorded under the host example\.org/ },
  { name: 'a symbol recorded as found where the verifier never looks', mutate: (copy) => { copy.destinations[firstChecked].terminal[0].at = 'heading' }, expect: /found "heading", which the verifier never reports/ },
  { name: 'every destination unverifiable, so nothing was checked', mutate: (copy) => { for (const record of copy.destinations) Object.assign(record, { ok: false, unverifiable: 'the host blocks the request (403)', status: 403, terminal: undefined }) }, expect: /destinations are unverifiable, more than the \d+ a blocked or throttled host explains/ },
  { name: 'a few destinations unverifiable is unresolved, not a failure', mutate: (copy) => { for (const record of copy.destinations.slice(0, 5)) Object.assign(record, { ok: false, unverifiable: 'the host blocks the request (403)', status: 403, terminal: undefined }) }, status: 0 },
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
