#!/usr/bin/env node
/**
 * The proof that the API destination check can fail, and for the reason it
 * names.
 *
 * A check that cannot fail is worse than none, and this one asks hosts a
 * question whose wrong answers all look like success to a status code: a page
 * that exists, at a fragment that does not; the right fragment on the wrong
 * page; a redirect to a landing page that answers 200. The verifier reads what
 * a page says it documents (its package, kind, name, operand count and
 * parameters) and compares that with what the name that led there says it
 * means. Each case plants one difference on a local server standing in for a
 * documentation host, and requires the verifier to fail with the reason that
 * case is about. The clean control beside each must pass, or a failure would
 * prove only that the server was unreachable.
 *
 * The fixtures are shaped like the real pages, because the check reads the
 * markup each host uses to declare its subject: rustdoc's title and heading,
 * javadoc's package line and member anchors, Dokka's breadcrumbs and
 * declaration, Scaladoc's kind, cppreference's heading and declaration, ExDoc's
 * `c:` and `t:` anchors, fsdocs' Module and Type, Learn's namespace and generic
 * arity, CPython's `dl.py` role, pkg.go.dev's import path, and Documenter's
 * category. Each wrong link keeps, in the text a loose rule would read, the
 * name it asks for.
 *
 * The second half plants faults in a copy of the committed evidence and
 * requires `--check` to name each. The third changes the names the source
 * generates over an unchanged record, and requires the offline check to judge
 * them again from the identity the record saw.
 *
 * Usage: node scripts/verify-api-destinations.negative.mjs
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGet } from './lib/destination-verification.mjs'
import { collectApiDestinations } from './lib/api-destinations.mjs'
import { loadReviewedLinks, pairKey } from './lib/api-links.mjs'
import { judgeLabel } from './lib/api-identities.mjs'
import { checkApiEvidence, verifyApiDestination } from './lib/api-destination-verification.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JDK = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java'
const PY = 'https://docs.python.org/3/builtins'
const PYLIB = 'https://docs.python.org/3/library'
const RUST = 'https://doc.rust-lang.org/std'
const JULIA = 'https://docs.julialang.org/en/v1/base'
const HEXDOCS = 'https://elixir.hexdocs.pm'
const TS = 'https://www.typescriptlang.org/docs/handbook'
const CPPREF = 'https://en.cppreference.com/cpp'
const JLS = 'https://docs.oracle.com/javase/specs/jls/se21/html'
const KOTLIN = 'https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core'
const FSHARP = 'https://fsharp.github.io/fsharp-core-docs/reference'
const LEARN = 'https://learn.microsoft.com/dotnet/api'
const CATS = 'https://typelevel.org/cats-effect/api/3.x/cats/effect'
const MDN = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects'

const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

/*
 * Pages shaped like the real ones, because the real ones are where a loose rule
 * passes the wrong symbol and a strict one must still pass the right one.
 */

/** javadoc: the package line, "Class Name", headings for every type whose members it inherits, and a detail section per member. */
const javadoc = (name, kind, pkg, { inherited = [], members = [], section = 'method' } = {}) => html(`${name} (Java SE 21 &amp; JDK 21)`,
  `<div class="sub-title"><span class="package-label-in-type">Package</span>&nbsp;<a href="package-summary.html">${pkg}</a></div>
<h1 class="title">${kind} ${name}</h1>${inherited.map((owner) => `<h3>Methods inherited from ${owner}</h3>`).join('')}
<section class="${section}-details" id="${section}-detail">${members.map(([id, text]) => `<section class="detail" id="${id}"><h3>${id.replace(/\(.*/, '')}</h3><div class="block">${text}</div></section>`).join('')}</section>`)

/** rustdoc: "Name in std::module" and "Kind Name", a code-header per method, and bodies that call each other. */
const rustdoc = (name, module, kind, entries = [], headers = []) => html(`${name} in std::${module} - Rust`,
  `<h1>${kind} <span>${name}</span></h1>${headers.map((header) => `<h2>${header}</h2>`).join('')}${entries.map(([id, signature, text]) => `<section id="${id}" class="method"><h4 class="code-header">${signature}</h4></section><div class="docblock">${text}</div>`).join('')}`)

/** CPython: a `dl.py <role>` per entry, a `dt` with the id, and no heading between entries. */
const cpython = (title, entries) => html(`${title} — Python 3.15 documentation`,
  `<h1>${title}</h1><section id="entries">${entries.map(([id, text, role = 'function']) => `<dl class="py ${role}"><dt class="sig sig-object py" id="${id}"><span class="pre">${id}</span>(<em>x</em>)</dt><dd><p>${text}</p></dd></dl>`).join('')}<section id="a-section"><h2>A section</h2></section></section>`)

/** Documenter: a `details` per docstring whose `summary` carries the binding as its id and the category beside it. */
const documenter = (title, entries) => html(`${title} · The Julia Language`,
  `<h1 id="lib"><a class="docs-heading-anchor" href="#lib">${title}</a></h1>${entries.map(([id, text, category = 'Function']) => `<details class="docstring" open><summary id="${id}"><a class="docstring-binding" href="#${id}"><code>${id}</code></a> — <span class="docstring-category">${category}</span></summary><section><div><p>${text}</p></div></section></details>`).join('')}`)

/** ExDoc: the module in the heading, and a section per entry whose link says whether it is a function, callback or type. */
const exdoc = (name, entries, small = '(Elixir v1.20.4)') => html(`${name} — Elixir v1.20.4`,
  `<h1> <span translate="no">${name}</span> <small class="app-vsn" translate="no">${small}</small> </h1>${entries.map(([id, label, text]) => `<section class="detail" id="${id}"><div class="detail-header"><a href="#${id}" class="detail-link" data-no-tooltip="" aria-label="Link to this ${label}">link</a><h1 class="signature"><span>${id}</span></h1></div><section class="docstring"><p>${text}</p></section></section>`).join('')}`)

/** pkg.go.dev: "name package - import/path", and a heading per declaration that says its kind. */
const godoc = (name, path, entries) => html(`${name} package - ${path} - Go Packages`,
  `<h1>${name}</h1>${entries.map(([id, kind, text]) => `<div class="Documentation-${kind}"><h4 id="${id}" data-kind="${kind}">${kind} ${id}</h4><p>${text}</p></div>`).join('')}`)

/** Learn: "Name Class" with its generic parameters, and the namespace in the facts. */
const learn = (heading, namespace) => html(`${heading} (${namespace}) | Microsoft Learn`,
  `<h1>${heading}</h1><dl><dt>Namespace:</dt><dd><span class="break-text"><a href="/dotnet/api/${namespace.toLowerCase()}">${namespace}</a></span></dd></dl>`)

/** fsdocs: "Name Module" or "Name<'T> Type", the namespace, and a heading per member. */
const fsdocs = (heading, namespace, members = []) => html(`${heading.replace(/ (Module|Type)$/, '')} (FSharp.Core) | FSharp.Core`,
  `<h2 id="top" data-fsdocs-heading="1">\n    ${heading}\n  </h2><dl class="fsdocs-metadata"><dt>Namespace: <a href="../reference/ns.html">${namespace}</a></dt></dl>${members.map((id) => `<h3 id="${id}">${id}</h3><p>${id}</p>`).join('')}`)

/** cppreference: the title names the subject, and the first declaration says what it is. */
const cppref = (title, declaration, body = '') => html(`${title} - cppreference.com`,
  `<h1 id="firstHeading">${title}</h1><table class="t-dcl-begin"><tbody><tr class="t-dsc-header"><td>Defined in header &lt;x&gt;</td></tr><tr class="t-dcl"><td><div><pre>${declaration}</pre></div></td></tr></tbody></table><p>${body}</p>`)

/** Dokka: breadcrumbs for the package and name, and a declaration whose keywords say what it is. */
const dokka = (crumbs, keywords, name) => html(`${name} | kotlinx.coroutines – Kotlin Programming Language`,
  `<div class="breadcrumbs"><a href="../index.html">${crumbs[0]}</a><span class="delimiter">/</span><a href="index.html">${crumbs[1]}</a><span class="delimiter">/</span><span class="current">${name}</span></div><div class="cover"><h1 class="cover">${name}</h1></div><div class="symbol monospace">${keywords.map((word) => `<span class="token keyword">${word} </span>`).join('')}<a href="x.html">${name}</a></div>`)

/** Scaladoc 2: a paragraph of owner links, the name in a heading, and the kind in the signature. */
const scaladoc = (owner, name, kind) => html(name,
  `<div id="definition"><p id="owner">${owner.split('.').map((part) => `<a href="x.html">${part}</a>`).join(' . ')}</p><h1>${name}<span class="permalink"></span></h1></div><h4 id="signature"><span class="modifier_kind"><span class="kind">${kind}</span></span> <span class="symbol">${name}</span></h4>`)

/** Scaladoc 3: the qualified name and the kind. */
const scaladoc3 = (qualified, kind) => html(qualified.split('.').at(-1), `<div class="fqname"><span>${qualified}</span></div><span class="kind"><span t="k">${kind}</span></span>`)

/** MDN: the title names the object or the member. */
const mdn = (title) => html(`${title} | MDN`, `<h1>${title}</h1>`)

/** A page with a title, a top heading and a body, for the hosts whose structure matters less than their addresses. */
const plain = (title, heading, body = '') => html(title, `<h1>${heading}</h1>${body}`)
/** A heading-owned section: an anchor on the heading and the text under it. */
const part = (id, heading, text, level = 3) => `<h${level} id="${id}">${heading}</h${level}><p>${text}</p>`

const JBASE = '/oracle/en/java/javase/21/docs/api/java.base/java'
/** What the stand-in hosts serve, by path under `/oracle`, `/python`, `/rust` and the rest. */
const pages = {
  [`${JBASE}/util/Optional.html`]: { body: javadoc('Optional&lt;T&gt;', 'Class', 'java.util', { members: [['of(T)', 'Returns an Optional describing the given non-null value.'], ['orElseThrow()', 'If a value is present, returns the value.']] }) },
  [`${JBASE}/util/Vector.html`]: { body: javadoc('Vector&lt;E&gt;', 'Class', 'java.util', { members: [['add(E)', 'Appends the element.']] }) },
  // The page exists and the anchor exists, but the section under it documents another method.
  [`${JBASE}/util/List.html`]: { body: javadoc('List&lt;E&gt;', 'Interface', 'java.util', { inherited: ['interface Collection', 'interface Iterable'], members: [['get(int)', 'Returns the element at the specified position.'], ['add(E)', 'Appends the specified element.']] }) },
  // An address the host moves to its generic landing page.
  [`${JBASE}/util/Stream.html`]: { status: 302, location: '/oracle/en/java/javase/21/docs/api/index.html' },
  '/oracle/en/java/javase/21/docs/api/index.html': { body: plain('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification') },
  // A search address answers 200 with the landing page and never the type.
  [`${JBASE}/util/Map.html`]: { body: plain('Overview (Java SE 21 &amp; JDK 21)', 'Java Platform, Standard Edition 21 API Specification') },
  [`${JBASE}/util/Set.html`]: { status: 429 },
  // The classes the wrong links point at, with the headings that name the types they inherit from.
  [`${JBASE}/util/ArrayList.html`]: { body: javadoc('ArrayList&lt;E&gt;', 'Class', 'java.util', { inherited: ['class AbstractList', 'interface List', 'interface Collection'] }) },
  [`${JBASE}/util/HashMap.html`]: { body: javadoc('HashMap&lt;K,V&gt;', 'Class', 'java.util', { inherited: ['class AbstractMap', 'interface Map'] }) },
  [`${JBASE}/nio/file/Files.html`]: { body: javadoc('Files', 'Class', 'java.nio.file', { members: [['newBufferedReader(Path)', 'Opens a file for reading.'], ['walk(Path,int,FileVisitOption...)', 'Return a Stream that is lazily populated with Path.']] }) },
  [`${JBASE}/nio/file/Path.html`]: { body: javadoc('Path', 'Interface', 'java.nio.file', { members: [['resolve(String)', 'Converts a given path string to a Path and resolves it.']] }) },
  [`${JBASE}/io/InputStream.html`]: { body: javadoc('InputStream', 'Class', 'java.io', { inherited: ['interface AutoCloseable'], members: [['close()', 'Closes this input stream and releases any system resources.']] }) },
  [`${JBASE}/lang/AutoCloseable.html`]: { body: javadoc('AutoCloseable', 'Interface', 'java.lang', { members: [['close()', 'Closes this resource, relinquishing any underlying resources.']] }) },
  // One name, two overloads, and two packages that both name a Duration.
  [`${JBASE}/lang/Process.html`]: { body: javadoc('Process', 'Class', 'java.lang', { members: [['waitFor()', 'Causes the current thread to wait until the process has terminated.'], ['waitFor(long,java.util.concurrent.TimeUnit)', 'Causes the current thread to wait, if necessary, until the process has terminated, or the specified waiting time elapses.']] }) },
  [`${JBASE}/time/Duration.html`]: { body: javadoc('Duration', 'Class', 'java.time', { members: [['ofSeconds(long)', 'Obtains a Duration representing a number of seconds.']] }) },
  '/oracle/en/java/javase/21/docs/api/java.xml/javax/xml/datatype/Duration.html': { body: javadoc('Duration', 'Class', 'javax.xml.datatype') },
  [`${JBASE}/lang/System.html`]: { body: javadoc('System', 'Class', 'java.lang', { members: [['getenv()', 'Returns an unmodifiable string map view of the current system environment.'], ['getenv(java.lang.String)', 'Gets the value of the specified environment variable.']] }) },
  '/oracle/en/java/javase/21/docs/api/com.example/com/example/Widget.html': { body: javadoc('Widget', 'Class', 'com.example') },
  '/python/3/builtins/functions.html': { body: cpython('Built-in Functions', [
    ['abs', 'Return the absolute value of a number. The argument may be an int, a float or an object implementing __abs__(); an int subclass is accepted.'],
    ['aiter', 'Return an asynchronous iterator for an asynchronous iterable.'],
    ['int', 'Return an integer object constructed from a number or a string.', 'class'],
    ['classmethod', 'Transform a method into a class method.', 'class'],
    ['open', 'Open file and return a corresponding file object.'],
  ]) },
  '/python/3/library/functions.html': { status: 301, location: '/python/3/builtins/functions.html' },
  '/python/3/builtins/exceptions.html': { body: cpython('Built-in Exceptions', [
    ['IndexError', 'Raised when a sequence subscript is out of range. See also OSError and LookupError.', 'exception'],
    ['OSError', 'This exception is raised when a system function returns a system-related error.', 'exception'],
  ]) },
  '/python/3/library/os.html': { body: cpython('os', [['os.open', 'Open the file path and set various flags according to flags.']]) },
  '/python/3/library/subprocess.html': { body: cpython('subprocess', [['subprocess.run', 'Run the command described by args.']]) },
  '/python/3/search.html': { body: html('Search — Python 3.15 documentation', '<h1 id="search">Search</h1><p>Searching for multiple words only shows matches that contain all words.</p>') },
  '/python/3/library/argparse.html': { body: html('argparse — Python 3.15 documentation', `<h1>argparse</h1><section id="default"><h2>default</h2><p>The default value.</p></section>${'<dl class="py function"><dt class="sig" id="argparse.ArgumentParser">ArgumentParser</dt></dl>'}`) },
  '/rust/std/iter/trait.Iterator.html': { body: rustdoc('Iterator', 'iter', 'Trait', [
    ['tymethod.next', 'fn <a>next</a>(&amp;mut self) -&gt; Option&lt;Self::Item&gt;', 'Advances the iterator and returns the next value.'],
    ['method.filter', 'fn <a>filter</a>&lt;P&gt;(self, predicate: P) -&gt; Filter&lt;Self, P&gt;', 'Creates an iterator which uses a closure to decide if an element is yielded. Calls next until a match.'],
    ['method.next_chunk', 'fn <a>next_chunk</a>&lt;const N: usize&gt;(&amp;mut self) -&gt; Result&lt;[Self::Item; N], _&gt;', 'Advances the iterator and returns an array containing the next N values.'],
  ], ['Required Methods', 'Provided Methods']) },
  '/rust/std/result/enum.Result.html': { body: rustdoc('Result', 'result', 'Enum', [['method.ok', 'pub fn ok(self) -&gt; <a>Option</a>&lt;T&gt;', 'Converts from Result&lt;T, E&gt; to Option&lt;T&gt;.'], ['method.map', 'pub fn map&lt;U, F&gt;(self, op: F) -&gt; Result&lt;U, E&gt;', 'Maps a Result&lt;T, E&gt; to Result&lt;U, E&gt;.']], ['Implementations']) },
  '/rust/std/fmt/type.Result.html': { body: rustdoc('Result', 'fmt', 'Type Alias') },
  '/rust/std/primitive.str.html': { body: html('str - Rust', '<h1>Primitive Type <span>str</span></h1>') },
  '/rust/std/str/index.html': { body: html('std::str - Rust', '<h1>Module <span>str</span></h1>') },
  '/rust/std/option/enum.Option.html': { body: rustdoc('Option', 'option', 'Enum', [['variant.None', 'None', 'No value.'], ['method.map', 'pub fn map&lt;U, F&gt;(self, f: F) -&gt; Option&lt;U&gt;', 'Maps an Option&lt;T&gt; to Option&lt;U&gt;.'], ['method.map_or', 'pub fn map_or&lt;U, F&gt;(self, default: U, f: F) -&gt; U', 'Returns the provided default, or applies a function to the contained value.']]) },
  '/rust/std/vec/struct.Vec.html': { body: rustdoc('Vec', 'vec', 'Struct', [['method.push', 'pub fn push(&amp;mut self, value: T)', 'Appends an element to the back of a collection.']]) },
  '/rust/std/io/struct.Error.html': { body: rustdoc('Error', 'io', 'Struct', [['method.kind', 'pub fn kind(&amp;self) -&gt; ErrorKind', 'Returns the corresponding ErrorKind for this error.'], ['method.source', 'fn <a>source</a>(&amp;self) -&gt; Option&lt;&amp;(dyn Error + \'static)&gt;', 'Returns the lower-level source of this error, if any.']]) },
  '/rust/std/fmt/struct.Error.html': { body: rustdoc('Error', 'fmt', 'Struct', [['impl-Display-for-Error', 'impl Display for Error', 'The error type which is returned from formatting a message into a stream.']]) },
  '/rust/std/fs/fn.read_to_string.html': { body: html('read_to_string in std::fs - Rust', '<h1>Function <span>read_to_string</span></h1>') },
  '/rust/std/fs/fn.remove_file.html': { body: html('remove_file in std::fs - Rust', '<h1>Function <span>remove_file</span></h1>') },
  // Identifier-addressed hosts: the wrong entry exists, one word away from the right one.
  '/python/3/library/warnings.html': { body: cpython('warnings', [['warnings.warn', 'Issue a warning.'], ['warnings.warn_explicit', 'This is a low-level interface to the functionality of warn(), passing in explicitly the message, category, filename and line number.']]) },
  '/python/3/library/os.path.html': { body: cpython('os.path', [['os.path.join', 'Join one or more path segments intelligently.']]) },
  '/python/3/builtins/stdtypes.html': { body: cpython('Built-in Types', [['str.join', 'Return a string which is the concatenation of the strings in iterable. Compare os.path.join.', 'method'], ['str.split', 'Return a list of the words in the string.', 'method']]) },
  '/python/3/library/pdb.html': { body: html('pdb — Python 3.15 documentation', `<h1>pdb</h1><dl class="std pdbcommand"><dt class="sig" id="pdbcommand-run">run</dt><dd><p>Restart the debugged Python program. Compare the run method of a thread.</p></dd></dl>`) },
  '/hexdocs/Enum.html': { body: exdoc('Enum', [['map/2', 'function', 'Returns a list where each element is the result of invoking fun on each corresponding element of enumerable.'], ['map_every/3', 'function', 'Returns a list of results of invoking fun on every nth element.'], ['member?/2', 'function', 'Checks if element exists within the enumerable.'], ['member?/3', 'function', 'A different operand count.'], ['reduce/2', 'function', 'Invokes fun for each element.'], ['reduce/3', 'function', 'Invokes fun for each element with an accumulator.']]) },
  '/hexdocs/Application.html': { body: exdoc('Application', [['start/2', 'function', 'Starts the given app.'], ['c:start/2', 'callback', 'Called when an application is started.']], 'behaviour') },
  '/hexdocs/Supervisor.html': { body: exdoc('Supervisor', [['t:child_spec/0', 'type', 'A child specification.'], ['child_spec/2', 'function', 'Builds a child specification.']], 'behaviour') },
  '/hexdocs/typespecs.html': { body: plain('Typespecs reference — Elixir v1.20.4', 'Typespecs reference', `${part('basic-types', 'Basic types', 'any(), none(), atom(), map(), pid(), port(), reference(), struct() and tuple().')}${part('literals', 'Literals', 'Atoms such as :ok, integers, lists and maps are written as literals.')}`) },
  '/go/errors': { body: godoc('errors', 'errors', [['Join', 'function', 'Join returns an error that wraps the given errors.'], ['Is', 'function', 'Is reports whether any error in err matches target.']]) },
  '/go/strings': { body: godoc('strings', 'strings', [['Join', 'function', 'Join concatenates the elements of its first argument to create a single string.']]) },
  '/go/text/template': { body: godoc('template', 'text/template', [['New', 'function', 'New allocates a new, undefined template with the given name.']]) },
  '/go/html/template': { body: godoc('template', 'html/template', [['New', 'function', 'New allocates a new HTML template with the given name.']]) },
  '/go/github.com/pkg/errors': { body: godoc('errors', 'github.com/pkg/errors', [['Is', 'function', 'Is reports whether any error in err matches target.']]) },
  '/learn/dotnet/api/system.threading.timer': { body: learn('Timer Class', 'System.Threading') },
  '/learn/dotnet/api/system.timers.timer': { body: learn('Timer Class', 'System.Timers') },
  '/learn/dotnet/api/microsoft.extensions.logging.ilogger': { body: learn('ILogger Interface', 'Microsoft.Extensions.Logging') },
  '/learn/dotnet/api/microsoft.extensions.logging.ilogger-1': { body: learn('ILogger&lt;TCategoryName&gt; Interface', 'Microsoft.Extensions.Logging') },
  '/learn/dotnet/api/system.collections.generic.ienumerable-1': { body: learn('IEnumerable&lt;T&gt; Interface', 'System.Collections.Generic') },
  '/learn/dotnet/api/system.collections.ienumerable': { body: learn('IEnumerable Interface', 'System.Collections') },
  // Pages of hosts that declare nothing: a manual, a tutorial, a reference. The words on a link must be the page's subject.
  '/kotlin/docs/classes.html': { body: html('Classes | Kotlin Documentation', '<h1>Classes</h1><p>Classes in Kotlin are declared using the keyword class.</p>') },
  '/kotlin/docs/functions.html': { body: html('Functions | Kotlin Documentation', '<h1>Functions</h1><p>Kotlin functions are declared using the fun keyword.</p>') },
  '/rust/reference/items/structs.html': { body: html('Structs - The Rust Reference', '<h1>The Rust Reference</h1><h1>Structs</h1><p>A struct is a nominal struct type defined with the keyword struct.</p>') },
  '/rust/reference/items/enumerations.html': { body: html('Enumerations - The Rust Reference', '<h1>The Rust Reference</h1><h1>Enumerations</h1><p>An enumeration, also referred to as an enum, is a simultaneous definition of a nominal enumerated type and its variants.</p>') },
  '/eel/c++draft/dcl.attr.nodiscard': { body: html('[dcl.attr.nodiscard]', '<h1>9 Declarations [dcl]</h1><h2>9.12.9 Nodiscard attribute [dcl.attr.nodiscard]</h2><p>The attribute-token nodiscard may be applied to the declarator-id in a function declaration.</p>') },
  '/eel/c++draft/dcl.attr.noreturn': { body: html('[dcl.attr.noreturn]', '<h1>9 Declarations [dcl]</h1><h2>9.12.8 Noreturn attribute [dcl.attr.noreturn]</h2><p>The attribute-token noreturn specifies that a function does not return.</p>') },
  '/eel/c++draft/class.union': { body: html('[class.union]', '<h1>11 Classes [class]</h1><h2>11.5 Unions [class.union]</h2><p>A union is a class defined with the class-key union.</p>') },
  '/scalatour/tour/basics.html': { body: html('Basics | Tour of Scala | Scala Documentation', `<h1>Basics</h1>${part('values', 'Values', 'You can name the results of expressions with the val keyword.', 3)}${part('methods', 'Methods', 'Method declarations look and behave very similar to functions, and begin with the def keyword.', 3)}`) },
  '/learn/en-us/dotnet/fsharp/language-reference/signature-files': { body: html('Signature files - F# | Microsoft Learn', '<h1>Signature files</h1><p>A signature file contains information about the public signatures of a set of F# program elements. Each val declares a value.</p>') },
  '/learn/en-us/dotnet/fsharp/language-reference/records': { body: html('Records - F# | Microsoft Learn', '<h1>Records</h1><p>Records represent simple aggregates of named values.</p>') },
  '/learn/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-classes-and-static-class-members': { body: html('Static Classes and Static Class Members - C# | Microsoft Learn', '<h1>Static Classes and Static Class Members</h1><p>A static class is basically the same as a non-static class.</p>') },
  '/learn/en-us/dotnet/fsharp/language-reference/classes': { body: html('Classes - F# | Microsoft Learn', '<h1>Classes</h1><p>Classes are types that represent objects that can have properties, methods, and events.</p>') },
  '/learn/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters': { body: html('about_CommonParameters - PowerShell | Microsoft Learn', `<h1 id="about_commonparameters">about_CommonParameters</h1>${part('-erroraction', '-ErrorAction', 'Determines how the cmdlet responds to a non-terminating error.')}${part('-verbose', '-Verbose', 'Displays detailed information about the operation.')}`) },
  '/learn/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts': { body: html('Basic concepts - C# language specification | Microsoft Learn', `<h1>7 Basic concepts</h1>${part('75-signatures-and-overloading', '7.5 Signatures and overloading', 'Methods, instance constructors, indexers, and operators are characterized by their signatures.', 2)}`) },
  '/learn/en-us/dotnet/core/tools/dotnet-tool-install': { body: html('dotnet tool install command - .NET CLI | Microsoft Learn', '<h1>dotnet tool install</h1><p>Installs the specified .NET tool on your machine.</p>') },
  '/learn/en-us/cpp/cpp/classes-and-structs-cpp': { body: html('Classes and structs (C++) | Microsoft Learn', '<h1>Classes and structs (C++)</h1><p>This article introduces classes and structs in C++.</p>') },
  '/learn/en-us/dotnet/visual-basic/programming-guide/language-features/objects-and-classes/': { body: html('Objects and classes - Visual Basic | Microsoft Learn', '<h1>Objects and classes</h1><p>Visual Basic classes.</p>') },
  '/learn/en-us/powershell/module/microsoft.powershell.core/about/about_functions': { body: html('about_Functions - PowerShell | Microsoft Learn', '<h1>about_Functions</h1><p>Describes how to create and use functions in PowerShell.</p>') },
  '/rust/std/error/trait.Error.html': { body: rustdoc('Error', 'error', 'Trait', [['method.source', 'fn <a>source</a>(&amp;self) -&gt; Option&lt;&amp;(dyn Error + \'static)&gt;', 'Returns the lower-level source of this error, if any.']]) },
  '/rust/std/macro.println.html': { body: html('println in std - Rust', '<h1>Macro <span>println</span></h1>') },
  '/rust/std/macro.print.html': { body: html('print in std - Rust', '<h1>Macro <span>print</span></h1>') },
  '/scala3/api/3.x/scala/collection/immutable/Map.html': { body: scaladoc3('scala.collection.immutable.Map', 'trait') },
  '/scala3/api/3.x/scala/collection/Map.html': { body: scaladoc3('scala.collection.Map', 'trait') },
  '/scala3/api/3.x/scala/collection/Iterator.html': { body: scaladoc3('scala.collection.Iterator', 'trait') },
  '/kotlin/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow-collector/': { body: dokka(['kotlinx-coroutines-core', 'kotlinx.coroutines.flow'], ['fun', 'interface'], 'FlowCollector') },
  '/python/3/library/collections.abc.html': { body: cpython('collections.abc', [['collections.abc.Mapping', 'ABC for read-only mapping classes.', 'class']]) },
  '/python/3/library/typing.html': { body: cpython('typing', [['typing.Mapping', 'Deprecated alias to collections.abc.Mapping.', 'class']]) },
  '/learn/dotnet/api/system.threading.barrier': { body: learn('Barrier Class', 'System.Threading') },
  '/kotlin/docs/data-classes.html': { body: html('Data classes | Kotlin Documentation', '<h1>Data classes</h1><p>It is not unusual to create classes whose main purpose is to hold data.</p>') },
  '/godev/ref/spec': { body: html('The Go Programming Language Specification - The Go Programming Language', `<h1>The Go Programming Language Specification</h1>${part('Constants', 'Constants', 'There are boolean constants, rune constants, integer constants and string constants.', 3)}${part('Variables', 'Variables', 'A variable is a storage location for holding a value.', 3)}`) },
  [`${JBASE}/io/File.html`]: { body: javadoc('File', 'Class', 'java.io', { members: [['delete()', 'Deletes the file or directory denoted by this abstract pathname.']] }) },
  '/ts/docs/handbook/utility-types.html': { body: plain('Documentation - Utility Types', 'Utility Types', `${part('omittype-keys', 'Omit&lt;Type, Keys&gt;', 'Constructs a type by picking all properties from Type and then removing Keys.')}${part('omitthisparametertype', 'OmitThisParameter&lt;Type&gt;', 'Removes the this parameter from Type.')}`) },
  // cppreference: a title that names one subject, a declaration that says what it is, and text that names the rest.
  '/cppref/cpp/container/vector': { body: cppref('std::vector', 'template&lt; class T, class Allocator = std::allocator&lt;T&gt; &gt; class vector;', 'std::vector&lt;bool&gt; is a space-efficient specialization. The int and char element types are common.') },
  '/cppref/cpp/container/vector/push_back': { body: cppref('std::vector&lt;T,Allocator&gt;::push_back', 'void push_back( const T&amp; value );') },
  '/cppref/cpp/container/vector/pop_back': { body: cppref('std::vector&lt;T,Allocator&gt;::pop_back', 'void pop_back();') },
  '/cppref/cpp/container/vector/swap': { body: cppref('std::vector&lt;T,Allocator&gt;::swap', 'void swap( vector&amp; other );') },
  '/cppref/cpp/algorithm/swap': { body: cppref('std::swap', 'template&lt; class T &gt; void swap( T&amp; a, T&amp; b );') },
  '/cppref/cpp/container/map': { body: cppref('std::map', 'template&lt; class Key, class T &gt; class map;') },
  '/cppref/cpp/container/unordered_map': { body: cppref('std::unordered_map', 'template&lt; class Key, class T &gt; class unordered_map;') },
  '/cppref/cpp/utility/optional': { body: cppref('std::optional', 'template&lt; class T &gt; class optional;') },
  '/cppref/cpp/utility/optional/bad_optional_access': { body: cppref('std::bad_optional_access', 'class bad_optional_access;') },
  '/cppref/cpp/string/basic_string': { body: cppref('std::basic_string', 'template&lt; class CharT &gt; class basic_string;', 'A string of char holds an int length. See std::string_view. Typedefs: std::string for char.') },
  '/cppref/cpp/chrono/duration': { body: cppref('std::chrono::duration', 'template&lt; class Rep, class Period &gt; class duration;', '<table><tr><td>std::chrono::milliseconds</td></tr><tr><td>std::chrono::seconds</td></tr></table>') },
  '/cppref/cpp/chrono/steady_clock': { body: cppref('std::chrono::steady_clock', 'class steady_clock;', 'The clock counts in seconds since an unspecified epoch. The time_point member type is a time_point.') },
  '/cppref/cpp/types/remove_cv': { body: cppref('std::remove_cv, std::remove_const, std::remove_volatile', 'template&lt; class T &gt; struct remove_cv;', 'Helper types: remove_cv_t, remove_const_t, remove_volatile_t.') },
  '/cppref/cpp/types/remove_cvref': { body: cppref('std::remove_cvref', 'template&lt; class T &gt; struct remove_cvref;', 'Like remove_cv, but also removes the reference. Possible implementation: remove_cv_t&lt;remove_reference_t&lt;T&gt;&gt;. Helper type: remove_cvref_t.') },
  '/cppref/cpp/keyword/bool': { body: html('C++ keyword: bool - cppreference.com', '<h1 id="firstHeading">C++ keyword: bool</h1>') },
  '/cppref/cpp/keyword/int': { body: html('C++ keyword: int - cppreference.com', '<h1 id="firstHeading">C++ keyword: int</h1>') },
  '/fsharp/fsharp-core-docs/reference/fsharp-collections-seqmodule.html': { body: fsdocs('Seq Module', 'FSharp.Collections', ['filter']) },
  '/fsharp/fsharp-core-docs/reference/fsharp-collections-seq-1.html': { body: fsdocs("seq&lt;'T&gt; Type", 'FSharp.Collections') },
  '/fsharp/fsharp-core-docs/reference/fsharp-collections-listmodule.html': { body: fsdocs('List Module', 'FSharp.Collections', ['filter']) },
  '/fsharp/fsharp-core-docs/reference/fsharp-core-fsharpresult-2.html': { body: fsdocs("Result&lt;'T, 'TError&gt; Type", 'FSharp.Core') },
  '/kotlin/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/': { body: dokka(['kotlinx-coroutines-core', 'kotlinx.coroutines'], ['interface'], 'CoroutineScope') },
  '/kotlin/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/coroutine-scope.html': { body: dokka(['kotlinx-coroutines-core', 'kotlinx.coroutines'], ['suspend', 'fun'], 'coroutineScope') },
  '/kotlin/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-flow/': { body: dokka(['kotlinx-coroutines-core', 'kotlinx.coroutines.flow'], ['interface'], 'Flow') },
  '/kotlin/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/flow.html': { body: dokka(['kotlinx-coroutines-core', 'kotlinx.coroutines.flow'], ['fun'], 'flow') },
  '/typelevel/cats-effect/api/3.x/cats/effect/IO.html': { body: scaladoc('cats.effect', 'IO', 'class') },
  '/typelevel/cats-effect/api/3.x/cats/effect/IO$.html': { body: scaladoc('cats.effect', 'IO', 'object') },
  '/mdn/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map': { body: mdn('Map - JavaScript') },
  '/mdn/en-US/docs/Web/JavaScript/Reference/Global_Objects/map': { status: 301, location: '/mdn/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map' },
  '/mdn/en-US/docs/Web/JavaScript/Reference/Global_Objects/String': { body: mdn('String - JavaScript') },
  '/mdn/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number': { body: mdn('Number - JavaScript') },
  // Pages that document several symbols under one anchor.
  '/oracle/javase/specs/jls/se21/html/jls-4.html': { body: plain('Chapter 4. Types, Values, and Variables', 'Chapter 4. Types, Values, and Variables', '<h3 class="title"><a name="jls-4.2.5"></a>4.2.5. The boolean Type and boolean Values</h3><p>The boolean type represents a logical quantity with two possible values, indicated by the literals true and false.</p>') },
  '/oracle/javase/specs/jls/se21/html/jls-14.html': { body: plain('Chapter 14. Blocks, Statements, and Patterns', 'Chapter 14. Blocks, Statements, and Patterns', '<h3 class="title"><a name="jls-14.9"></a>14.9. The if Statement</h3><p>The Expression must have type boolean, or a compile-time error occurs.</p>') },
  '/kotlin/docs/coroutines-basics.html': { body: plain('Coroutines basics', 'Coroutines basics', `${part('suspending-functions', 'Extract function refactoring', 'The suspend modifier marks a suspending function.', 2)}${part('runblocking', 'Scope builder', 'runBlocking blocks the thread until a suspend block completes.', 2)}${part('coroutine-dispatchers', 'Coroutine dispatchers', 'A dispatcher decides which thread runs a suspend block.', 2)}`) },
  '/julia/en/v1/base/sort/': { body: documenter('Sorting and Related Functions', [['Base.sort', 'sort(v; alg, lt, by, rev, order) returns a sorted copy of v.'], ['Base.sort!', 'sort!(v; alg, lt, by, rev, order) sorts v in place. Compare sort.']]) },
  '/julia/en/v1/base/arrays/': { body: documenter('Arrays', [
    ['Core.Array', 'Array{T,N} &lt;: AbstractArray{T,N}. N-dimensional dense array with elements of type T.', 'Type'],
    ['Base.Vector', 'Vector{T} is an alias for Array{T,1}: a one-dimensional dense Array.', 'Type'],
  ]) },
  '/julia/en/v1/base/base/': { body: documenter('Essentials', [['import', 'import Foo makes the module available, and its names reachable by qualified name.', 'Keyword'], ['for', 'for loops repeat a block of statements.', 'Keyword'], ['Base.in', 'in(item, collection) determines whether an item is in a collection.']]) },
  '/julia/en/v1/base/strings/': { body: documenter('Strings', [['Base.strip', 'Remove leading and trailing whitespace.'], ['Base.lstrip', 'Remove leading whitespace. Compare strip.']]) },
  '/julia/en/v1/base/collections/': { body: documenter('Collections', [['Base.map', 'Transform collection by applying f to each element.'], ['Base.map!', 'Like map, but stores the result in the destination.']]) },
  '/julia/en/v1/manual/types/': { body: plain('Types · The Julia Language', 'Types', part('Composite-Types', 'Composite Types', 'Composite types are called records, structs, or objects in various languages.')) },
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
  'https://www.typescriptlang.org': `${origin}/ts`, 'https://fsharp.github.io': `${origin}/fsharp`,
  'https://typelevel.org': `${origin}/typelevel`, 'https://go.dev': `${origin}/godev`, 'https://developer.mozilla.org': `${origin}/mdn`, 'https://kotlinlang.org': `${origin}/kotlin`, 'https://docs.scala-lang.org': `${origin}/scalatour`, 'https://eel.is': `${origin}/eel`, 'https://www.scala-lang.org': `${origin}/scala3`,
}
const get = createGet({ rewriteOrigins, pauseMs: 0, retries: 0 })

let failures = 0
const fail = (message) => {
  failures += 1
  console.error(`FAIL ${message}`)
}

/** The reviewed link table a case is judged against: the rows its fixtures have headings for. */
const table = (...rows) => ({ rows: rows.map(([label, url, heading]) => ({ label, url, heading })), byPair: new Map(rows.map(([label, url, heading]) => [pairKey(label, url), { label, url, heading }])) })
const ROWS = [
  ['Kotlin classes', 'https://kotlinlang.org/docs/classes.html', 'Classes'],
  ['Rust structs', 'https://doc.rust-lang.org/reference/items/structs.html', 'Structs'],
  ['Rust enum variants', 'https://doc.rust-lang.org/reference/items/enumerations.html', 'Enumerations'],
  ['C++ nodiscard attribute', 'https://eel.is/c++draft/dcl.attr.nodiscard', '9.12.9 Nodiscard attribute [dcl.attr.nodiscard]'],
  ['Scala method declarations', 'https://docs.scala-lang.org/tour/basics.html#methods', 'Methods'],
  ['F# value signatures', 'https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/signature-files', 'Signature files'],
  ['F# classes', 'https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/classes', 'Classes'],
  ['Python class methods', 'https://docs.python.org/3/builtins/functions.html#classmethod', 'classmethod'],
  ['Go constants', 'https://go.dev/ref/spec#Constants', 'Constants'],
  ['Java booleans', 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.5', '4.2.5. The boolean Type and boolean Values'],
  ['Julia composite types', 'https://docs.julialang.org/en/v1/manual/types/#Composite-Types', 'Composite Types'],
  ['PowerShell error action', 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters#-erroraction', '-ErrorAction'],
  ['C# signatures and overloading', 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts#75-signatures-and-overloading', '7.5 Signatures and overloading'],
  ['.NET tool install', 'https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install', 'dotnet tool install'],
  ['crate API', 'https://docs.rs/tmux-mcp', 'tmux-mcp'],
]
const TABLE = table(...ROWS)
const at = (url, port, name, source = 'builtin', extra = {}) => ({ url, host: new URL(url).hostname, uses: [{ port, name, source, ...extra }] })
const authored = (url, label, from) => ({ url, host: new URL(url).hostname, uses: [{ port: '', name: 'site/src/content/docs/example.md', source: 'authored', label, ...(from && { from }) }] })
/** One pair written by the pages of several ports: the uses merge into one expectation, and each port's language is held to the address. */
const written = (url, label, ...froms) => ({ url, host: new URL(url).hostname, uses: froms.map((from, index) => ({ port: '', name: `site/src/content/docs/ports/${from}/page-${index}.md`, source: 'authored', label, from })) })
const STRUCTS = 'https://doc.rust-lang.org/reference/items/structs.html'
/** A pair at a libtmux package page, which the header verifier owns: the verifier holds the port that writes it and the package it names. */
const packaged = (url, label, from, identity, ports) => ({ url, host: new URL(url).hostname, uses: [{ port: '', name: 'site/src/content/docs/ports/x/page.md', source: 'authored', label, from, package: { identity, ports } }] })
const COMMON = 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters'

const cases = [
  { name: 'control: the page names the symbol', destination: at(`${JDK}/util/Optional.html`, 'java', 'Optional', 'type'), ok: true },
  { name: 'control: the fragment exists under the symbol', destination: at(`${JDK}/util/Optional.html#of(T)`, 'java', 'Optional.of', 'type'), ok: true },
  { name: 'wrong fragment', destination: at(`${JDK}/util/Optional.html#ofNullable(T)`, 'java', 'Optional.ofNullable', 'type'), failure: 'fragment' },
  { name: 'wrong page', destination: at(`${JDK}/util/Vector.html`, 'java', 'Optional', 'type'), failure: 'symbol' },
  { name: 'removed symbol: the fragment is there and documents another method', destination: at(`${JDK}/util/List.html#get(int)`, 'java', 'List.remove', 'type'), failure: 'symbol' },
  { name: 'redirect to a generic page', destination: at(`${JDK}/util/Stream.html`, 'java', 'Stream', 'type'), failure: 'moved' },
  { name: 'generic page that answers 200', destination: at(`${JDK}/util/Map.html`, 'java', 'Map', 'type'), failure: 'kind' },
  { name: 'the old search address for a member the JDK does not list', destination: at('https://docs.oracle.com/en/java/javase/21/docs/api/index.html?q=Stream.noSuchMember', 'java', 'Stream.noSuchMember', 'prose'), failure: 'kind' },
  { name: 'page that is gone', destination: at(`${JDK}/util/Gone.html`, 'java', 'Gone', 'type'), failure: 'status' },
  { name: 'rate-limited host is unresolved, never passing', destination: at(`${JDK}/util/Set.html`, 'java', 'Set', 'type'), unverifiable: /rate-limited/ },

  // CPython-shaped: entries are `dt`s with no heading between them, and a neighbour's text names the symbol.
  { name: 'CPython control: int at #int', destination: at(`${PY}/functions.html#int`, 'py', 'int'), ok: true },
  { name: 'CPython: int at the entry for abs, whose text says int', destination: at(`${PY}/functions.html#abs`, 'py', 'int'), failure: 'symbol' },
  { name: 'CPython control: OSError at #OSError', destination: at(`${PY}/exceptions.html#OSError`, 'py', 'OSError'), ok: true },
  { name: 'CPython: OSError at the entry for IndexError, whose text says OSError', destination: at(`${PY}/exceptions.html#IndexError`, 'py', 'OSError'), failure: 'symbol' },
  { name: 'CPython control: open at the builtin', destination: at(`${PY}/functions.html#open`, 'py', 'open'), ok: true },
  { name: 'CPython: the builtin open at os.open', destination: at(`${PYLIB}/os.html#os.open`, 'py', 'open'), failure: 'owner' },
  { name: 'CPython control: subprocess.run at its entry', destination: at(`${PYLIB}/subprocess.html#subprocess.run`, 'py', 'subprocess.run'), ok: true },
  { name: 'CPython: a bare run at subprocess.run, which no import of py gives that name', destination: at(`${PYLIB}/subprocess.html#subprocess.run`, 'py', 'run'), failure: 'owner' },
  { name: 'CPython: the search page of the manual is no function named search', destination: at('https://docs.python.org/3/search.html', 'py', 'search', 'doc'), failure: 'kind' },
  { name: 'CPython: a section of the argparse manual is no function named default', destination: at(`${PYLIB}/argparse.html#default`, 'py', 'default', 'doc'), failure: 'kind' },

  // rustdoc-shaped: a code-header per method, and a body that mentions the other.
  { name: 'rustdoc control: Iterator::next at #tymethod.next', destination: at(`${RUST}/iter/trait.Iterator.html#tymethod.next`, 'rs', 'Iterator::next'), ok: true },
  { name: 'rustdoc: Iterator::next at the entry for filter, whose text says next', destination: at(`${RUST}/iter/trait.Iterator.html#method.filter`, 'rs', 'Iterator::next'), failure: 'symbol' },
  { name: 'rustdoc control: Option at its own page', destination: at(`${RUST}/option/enum.Option.html`, 'rs', 'Option'), ok: true },
  { name: 'rustdoc: Option at Result, whose method headers return Option', destination: at(`${RUST}/result/enum.Result.html`, 'rs', 'Option'), failure: 'symbol' },
  { name: 'rustdoc control: Result is the one in std::result', destination: at(`${RUST}/result/enum.Result.html`, 'rs', 'Result'), ok: true },
  { name: 'rustdoc: Result at the alias in std::fmt', destination: at(`${RUST}/fmt/type.Result.html`, 'rs', 'Result'), failure: 'owner' },
  { name: 'rustdoc control: the primitive str', destination: at(`${RUST}/primitive.str.html`, 'rs', 'str'), ok: true },
  { name: 'rustdoc: the primitive str at the module std::str', destination: at(`${RUST}/str/index.html`, 'rs', 'str'), failure: 'owner' },
  { name: 'rustdoc control: Option<T>::map at #method.map', destination: at(`${RUST}/option/enum.Option.html#method.map`, 'rs', 'Option<T>::map', 'doc'), ok: true },
  { name: 'tail: Option<T>::map at the Option page, with its member dropped', destination: at(`${RUST}/option/enum.Option.html`, 'rs', 'Option<T>::map', 'doc'), failure: 'symbol' },
  { name: 'tail: Vec<u8>::push at the Vec page, with its member dropped', destination: at(`${RUST}/vec/struct.Vec.html`, 'rs', 'Vec<u8>::push', 'doc'), failure: 'symbol' },
  { name: 'tail: Vec<u8>::push at the entry for push', destination: at(`${RUST}/vec/struct.Vec.html#method.push`, 'rs', 'Vec<u8>::push', 'doc'), ok: true },

  // Documenter-shaped: a docstring per binding, and a docstring that names the type it aliases.
  { name: 'Documenter control: Array at #Core.Array', destination: at(`${JULIA}/arrays/#Core.Array`, 'julia', 'Array'), ok: true },
  { name: 'Documenter: Array at the docstring for Vector, which names Array', destination: at(`${JULIA}/arrays/#Base.Vector`, 'julia', 'Array'), failure: 'symbol' },
  { name: 'Documenter keyword control: import at the keyword the manual lists with the language', destination: at(`${JULIA}/base/#import`, 'julia', 'import', 'doc'), ok: true },
  { name: 'Documenter keyword: import at the keyword for', destination: at(`${JULIA}/base/#for`, 'julia', 'import', 'doc'), failure: 'symbol' },
  { name: 'Documenter keyword: a name that is no keyword, written bare, at the keyword page', destination: at(`${JULIA}/base/#for`, 'julia', 'forall', 'doc'), failure: 'symbol' },
  { name: 'Documenter control: map at Base.map', destination: at(`${JULIA}/collections/#Base.map`, 'julia', 'map'), ok: true },
  { name: 'Documenter: map at Base.map!, a different function', destination: at(`${JULIA}/collections/#Base.map%21`, 'julia', 'map'), failure: 'symbol' },

  // javadoc-shaped: headings name the types a page inherits from, and anchors spell their parameter types.
  { name: 'javadoc control: AutoCloseable.close at AutoCloseable', destination: at(`${JDK}/lang/AutoCloseable.html#close()`, 'java', 'AutoCloseable.close'), ok: true },
  { name: 'javadoc: AutoCloseable.close at InputStream, which has its own close()', destination: at(`${JDK}/io/InputStream.html#close()`, 'java', 'AutoCloseable.close'), failure: 'owner' },
  { name: 'javadoc control: List at its own page', destination: at(`${JDK}/util/List.html`, 'java', 'List'), ok: true },
  { name: 'javadoc: List at ArrayList, headed "Methods inherited from interface List"', destination: at(`${JDK}/util/ArrayList.html`, 'java', 'List'), failure: 'symbol' },
  { name: 'javadoc: Map at HashMap, headed "Methods inherited from interface Map"', destination: at(`${JDK}/util/HashMap.html`, 'java', 'Map'), failure: 'symbol' },
  { name: 'javadoc: Collection at List, headed "Methods inherited from interface Collection"', destination: at(`${JDK}/util/List.html`, 'java', 'Collection'), failure: 'symbol' },
  { name: 'javadoc control: Path at its own page', destination: at(`${JDK}/nio/file/Path.html`, 'java', 'Path'), ok: true },
  { name: 'javadoc: Path at Files, whose anchors spell Path', destination: at(`${JDK}/nio/file/Files.html`, 'java', 'Path'), failure: 'symbol' },
  { name: 'javadoc control: java.time.Duration at its page', destination: at(`${JDK}/time/Duration.html`, 'java', 'java.time.Duration'), ok: true },
  { name: 'owner: java.time.Duration at the Duration of javax.xml.datatype', destination: at('https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/datatype/Duration.html', 'java', 'java.time.Duration'), failure: 'owner' },
  { name: 'bare: Duration at the Duration of javax.xml.datatype, which java imports from java.time', destination: at('https://docs.oracle.com/en/java/javase/21/docs/api/java.xml/javax/xml/datatype/Duration.html', 'java', 'Duration'), failure: 'owner' },
  { name: 'bare control: Duration at java.time, which java imports', destination: at(`${JDK}/time/Duration.html`, 'java', 'Duration'), ok: true },
  { name: 'bare: Widget at com.example, in no scope the table names', destination: at('https://docs.oracle.com/en/java/javase/21/docs/api/com.example/com/example/Widget.html', 'java', 'Widget'), failure: 'owner' },
  { name: 'bare: List written in Scala, at the List of java.util', destination: at(`${JDK}/util/List.html`, 'scala', 'List'), failure: 'owner' },
  { name: 'params control: Process.waitFor() at the overload that takes nothing', destination: at(`${JDK}/lang/Process.html#waitFor()`, 'java', 'Process.waitFor()', 'doc'), ok: true },
  { name: 'params: Process.waitFor() at the overload that takes a timeout', destination: at(`${JDK}/lang/Process.html#waitFor(long,java.util.concurrent.TimeUnit)`, 'java', 'Process.waitFor()', 'doc'), failure: 'params' },
  { name: 'params control: Process.waitFor(long,TimeUnit) at its own overload', destination: at(`${JDK}/lang/Process.html#waitFor(long,java.util.concurrent.TimeUnit)`, 'java', 'Process.waitFor(long,TimeUnit)', 'doc'), ok: true },
  { name: 'params: Process.waitFor(long,TimeUnit) at the overload that takes nothing', destination: at(`${JDK}/lang/Process.html#waitFor()`, 'java', 'Process.waitFor(long,TimeUnit)', 'doc'), failure: 'params' },
  { name: 'params: System.getenv() at getenv(String), the case the record once held', destination: at(`${JDK}/lang/System.html#getenv(java.lang.String)`, 'java', 'System.getenv()', 'doc'), failure: 'params' },
  { name: 'params control: Process.waitFor with no parentheses accepts any overload', destination: at(`${JDK}/lang/Process.html#waitFor(long,java.util.concurrent.TimeUnit)`, 'java', 'Process.waitFor', 'doc'), ok: true },

  // Class: a fragment that merely contains the word. Where fragments are identifiers, the identifier is compared whole.
  { name: 'CPython control: warnings.warn at #warnings.warn', destination: at(`${PYLIB}/warnings.html#warnings.warn`, 'py', 'warnings.warn'), ok: true },
  { name: 'identifier: warnings.warn at #warnings.warn_explicit', destination: at(`${PYLIB}/warnings.html#warnings.warn_explicit`, 'py', 'warnings.warn'), failure: 'symbol' },
  { name: 'rustdoc control: Option::map at #method.map', destination: at(`${RUST}/option/enum.Option.html#method.map`, 'rs', 'Option::map'), ok: true },
  { name: 'identifier: Option::map at #method.map_or', destination: at(`${RUST}/option/enum.Option.html#method.map_or`, 'rs', 'Option::map'), failure: 'symbol' },
  { name: 'identifier: Iterator::next at #method.next_chunk', destination: at(`${RUST}/iter/trait.Iterator.html#method.next_chunk`, 'rs', 'Iterator::next'), failure: 'symbol' },
  { name: 'ExDoc control: Enum.map/2 at #map/2', destination: at(`${HEXDOCS}/Enum.html#map/2`, 'elixir', 'Enum.map/2'), ok: true },
  { name: 'identifier: Enum.map/2 at #map_every/3', destination: at(`${HEXDOCS}/Enum.html#map_every/3`, 'elixir', 'Enum.map/2'), failure: 'symbol' },
  { name: 'identifier: Enum.member?/2 at #member?/3, the same name with another operand count', destination: at(`${HEXDOCS}/Enum.html#member?/3`, 'elixir', 'Enum.member?/2'), failure: 'arity' },
  { name: 'arity control: Enum.reduce/3 at #reduce/3', destination: at(`${HEXDOCS}/Enum.html#reduce/3`, 'elixir', 'Enum.reduce/3'), ok: true },
  { name: 'arity: Enum.reduce/2 at #reduce/3', destination: at(`${HEXDOCS}/Enum.html#reduce/3`, 'elixir', 'Enum.reduce/2'), failure: 'arity' },
  { name: 'ExDoc control: Application.start/2 as a function', destination: at(`${HEXDOCS}/Application.html#start/2`, 'elixir', 'Application.start/2'), ok: true },
  { name: 'kind: the function Application.start/2 at the callback c:start/2', destination: at(`${HEXDOCS}/Application.html#c:start/2`, 'elixir', 'Application.start/2'), failure: 'kind' },
  { name: 'ExDoc control: the type Supervisor.child_spec at t:child_spec/0', destination: at(`${HEXDOCS}/Supervisor.html#t:child_spec/0`, 'elixir', 'Supervisor.child_spec'), ok: true },
  { name: 'kind: the type Supervisor.child_spec at the function child_spec/2', destination: at(`${HEXDOCS}/Supervisor.html#child_spec/2`, 'elixir', 'Supervisor.child_spec'), failure: 'kind' },
  { name: 'Documenter control: Base.sort at #Base.sort', destination: at(`${JULIA}/sort/#Base.sort`, 'julia', 'Base.sort'), ok: true },
  { name: 'identifier: Base.sort at #Base.sort!', destination: at(`${JULIA}/sort/#Base.sort!`, 'julia', 'Base.sort'), failure: 'symbol' },
  { name: 'identifier: py run(self.x) at #pdbcommand-run, a pdb command and no symbol', destination: at(`${PYLIB}/pdb.html#pdbcommand-run`, 'py', 'run(self.x)', 'doc'), failure: 'kind' },
  { name: 'handbook control: Omit at its own anchor, a reviewed exception', destination: at(`${TS}/utility-types.html#omittype-keys`, 'ts', 'Omit'), ok: true },
  { name: 'handbook: Omit at the anchor for OmitThisParameter, which starts with Omit', destination: at(`${TS}/utility-types.html#omitthisparametertype`, 'ts', 'Omit'), failure: 'symbol' },

  // Class: a package, module or type before the symbol that the address does not carry.
  { name: 'rustdoc control: std::io::Error at std/io', destination: at(`${RUST}/io/struct.Error.html`, 'rs', 'std::io::Error'), ok: true },
  { name: 'owner: std::io::Error at the Error of std::fmt', destination: at(`${RUST}/fmt/struct.Error.html`, 'rs', 'std::io::Error'), failure: 'owner' },
  { name: 'pkg.go.dev control: errors.Join at errors', destination: at('https://pkg.go.dev/errors#Join', 'go', 'errors.Join'), ok: true },
  { name: 'owner: errors.Join at the Join of strings', destination: at('https://pkg.go.dev/strings#Join', 'go', 'errors.Join'), failure: 'owner' },
  { name: 'pkg.go.dev control: errors.Is at the standard package', destination: at('https://pkg.go.dev/errors#Is', 'go', 'errors.Is'), ok: true },
  { name: 'owner: errors.Is at github.com/pkg/errors, another package of that name', destination: at('https://pkg.go.dev/github.com/pkg/errors#Is', 'go', 'errors.Is'), failure: 'owner' },
  { name: 'pkg.go.dev control: template.New at text/template', destination: at('https://pkg.go.dev/text/template#New', 'go', 'template.New'), ok: true },
  { name: 'owner: template.New at html/template, the other package of that name', destination: at('https://pkg.go.dev/html/template#New', 'go', 'template.New'), failure: 'owner' },
  { name: 'Learn control: System.Threading.Timer at its page', destination: at(`${LEARN}/system.threading.timer`, 'csharp', 'System.Threading.Timer'), ok: true },
  { name: 'owner: System.Threading.Timer at System.Timers.Timer, with no fragment', destination: at(`${LEARN}/system.timers.timer`, 'csharp', 'System.Threading.Timer'), failure: 'owner' },
  { name: 'Learn control: ILogger at the non-generic interface', destination: at(`${LEARN}/microsoft.extensions.logging.ilogger`, 'csharp', 'ILogger'), ok: true },
  { name: 'arity: ILogger at ILogger<TCategoryName>, a type of its own', destination: at(`${LEARN}/microsoft.extensions.logging.ilogger-1`, 'csharp', 'ILogger'), failure: 'arity' },
  { name: 'Learn control: IEnumerable, written with one operand, at ienumerable-1', destination: at(`${LEARN}/system.collections.generic.ienumerable-1`, 'csharp', 'IEnumerable'), ok: true },
  { name: 'owner: IEnumerable, written with one operand, at the non-generic interface of System.Collections', destination: at(`${LEARN}/system.collections.ienumerable`, 'csharp', 'IEnumerable'), failure: 'owner' },
  { name: 'F# control: Seq.filter at the Seq module', destination: at(`${FSHARP}/fsharp-collections-seqmodule.html#filter`, 'fsharp', 'Seq.filter'), ok: true },
  { name: 'owner: Seq.filter at the filter of the List module', destination: at(`${FSHARP}/fsharp-collections-listmodule.html#filter`, 'fsharp', 'Seq.filter'), failure: 'owner' },
  { name: 'identifier: Seq.filter! at the filter of Seq, a name that ends differently', destination: at(`${FSHARP}/fsharp-collections-seqmodule.html#filter`, 'fsharp', 'Seq.filter!'), failure: 'symbol' },
  { name: 'F# control: the module Seq at the Seq module', destination: at(`${FSHARP}/fsharp-collections-seqmodule.html`, 'fsharp', 'Seq'), ok: true },
  { name: 'spelling: the module Seq at the type seq<T>, whose name is spelled in lowercase', destination: at(`${FSHARP}/fsharp-collections-seq-1.html`, 'fsharp', 'Seq'), failure: 'symbol' },
  { name: 'spelling: the type list at the List module', destination: at(`${FSHARP}/fsharp-collections-listmodule.html`, 'fsharp', 'list'), failure: 'symbol' },
  { name: 'F# control: Result written with two operands at fsharpresult-2', destination: at(`${FSHARP}/fsharp-core-fsharpresult-2.html`, 'fsharp', 'Result'), ok: true },
  { name: 'cppreference control: std::vector at its page', destination: at(`${CPPREF}/container/vector`, 'cxx', 'std::vector'), ok: true },
  { name: 'owner: std::ranges::vector at std::vector, a namespace neither the address nor the title names', destination: at(`${CPPREF}/container/vector`, 'cxx', 'std::ranges::vector'), failure: 'owner' },
  { name: 'owner: Keyword::vector at std::vector', destination: at(`${CPPREF}/container/vector`, 'cxx', 'Keyword::vector'), failure: 'owner' },
  { name: 'owner: str.join written os.path.join, at the join of str', destination: at(`${PY}/stdtypes.html#str.join`, 'py', 'os.path.join'), failure: 'owner' },
  { name: 'CPython control: os.path.join at os.path', destination: at(`${PYLIB}/os.path.html#os.path.join`, 'py', 'os.path.join'), ok: true },

  // Class: the words of a name that are not the name. An underscore, a dash, a prefix or a suffix joins words into another symbol.
  { name: 'cppreference control: std::swap, the free function', destination: at(`${CPPREF}/algorithm/swap`, 'cxx', 'std::swap'), ok: true },
  { name: 'owner: the free std::swap at the swap member of std::vector', destination: at(`${CPPREF}/container/vector/swap`, 'cxx', 'std::swap'), failure: 'owner' },
  { name: 'cppreference control: std::map at its page', destination: at(`${CPPREF}/container/map`, 'cxx', 'std::map'), ok: true },
  { name: 'underscore: std::map at std::unordered_map, whose name is another word', destination: at(`${CPPREF}/container/unordered_map`, 'cxx', 'std::map'), failure: 'symbol' },
  { name: 'cppreference control: std::optional at its page', destination: at(`${CPPREF}/utility/optional`, 'cxx', 'std::optional'), ok: true },
  { name: 'underscore: std::optional at std::bad_optional_access', destination: at(`${CPPREF}/utility/optional/bad_optional_access`, 'cxx', 'std::optional'), failure: 'symbol' },
  { name: 'tail control: std::vector<int>::push_back at its page', destination: at(`${CPPREF}/container/vector/push_back`, 'cxx', 'std::vector<int>::push_back', 'doc'), ok: true },
  { name: 'tail: std::vector<int>::push_back at the vector page, with its member dropped', destination: at(`${CPPREF}/container/vector`, 'cxx', 'std::vector<int>::push_back', 'doc'), failure: 'symbol' },
  { name: 'tail: std::vector<int>::push_back at the pop_back page', destination: at(`${CPPREF}/container/vector/pop_back`, 'cxx', 'std::vector<int>::push_back', 'doc'), failure: 'symbol' },
  { name: 'cppreference control: the keyword bool at its page', destination: at(`${CPPREF}/keyword/bool`, 'cxx', 'bool'), ok: true },
  { name: 'keyword: int at the page for the keyword bool', destination: at(`${CPPREF}/keyword/bool`, 'cxx', 'int'), failure: 'symbol' },
  { name: 'keyword control: int at the page for the keyword int', destination: at(`${CPPREF}/keyword/int`, 'cxx', 'int'), ok: true },
  { name: 'Dokka control: the interface CoroutineScope at its page', destination: at(`${KOTLIN}/kotlinx.coroutines/-coroutine-scope/`, 'kotlin', 'CoroutineScope', 'type'), ok: true },
  { name: 'Dokka control: the function coroutineScope at its page', destination: at(`${KOTLIN}/kotlinx.coroutines/coroutine-scope.html`, 'kotlin', 'coroutineScope', 'doc'), ok: true },
  { name: 'spelling: the function coroutineScope at the interface CoroutineScope', destination: at(`${KOTLIN}/kotlinx.coroutines/-coroutine-scope/`, 'kotlin', 'coroutineScope', 'doc'), failure: 'symbol' },
  { name: 'Dokka control: the interface Flow at its page', destination: at(`${KOTLIN}/kotlinx.coroutines.flow/-flow/`, 'kotlin', 'Flow', 'type'), ok: true },
  { name: 'spelling: the interface Flow at the function flow()', destination: at(`${KOTLIN}/kotlinx.coroutines.flow/flow.html`, 'kotlin', 'Flow', 'type'), failure: 'symbol' },
  { name: 'Scala control: the class IO at IO.html', destination: at(`${CATS}/IO.html`, 'scala', 'IO'), ok: true },
  { name: 'kind: the class IO at the companion object IO$', destination: at(`${CATS}/IO$.html`, 'scala', 'IO'), failure: 'kind' },
  { name: 'MDN control: Map at Map', destination: at(`${MDN}/Map`, 'ts', 'Map'), ok: true },
  { name: 'case: Map at /map, which MDN moves to /Map', destination: at(`${MDN}/map`, 'ts', 'Map'), failure: 'moved' },
  { name: 'MDN control: the primitive string, which MDN documents as String', destination: at(`${MDN}/String`, 'ts', 'string'), ok: true },
  { name: 'alias: the primitive string at Number', destination: at(`${MDN}/Number`, 'ts', 'string'), failure: 'symbol' },

  // Class: the words on a link to a page that documents a symbol are that symbol's name, exactly. No plural, stem or synonym stands for it.
  { name: 'authored control: [strip] at Base.strip', destination: authored(`${JULIA}/strings/#Base.strip`, 'strip'), ok: true },
  { name: 'authored: [strip] swapped to Base.lstrip, a different function', destination: authored(`${JULIA}/strings/#Base.lstrip`, 'strip'), failure: 'label' },
  { name: 'authored control: [std::fs::read_to_string] at read_to_string', destination: authored(`${RUST}/fs/fn.read_to_string.html`, '`std::fs::read_to_string`'), ok: true },
  { name: 'authored: [std::fs::read_to_string] swapped to remove_file', destination: authored(`${RUST}/fs/fn.remove_file.html`, '`std::fs::read_to_string`'), failure: 'label' },
  { name: 'exact control: `Files` at the Files class', destination: authored(`${JDK}/nio/file/Files.html`, '`Files`'), ok: true },
  { name: 'exact: `Files` at File, the singular of it', destination: authored(`${JDK}/io/File.html`, '`Files`'), failure: 'label' },
  { name: 'exact: `Paths` at Path, the plural of it', destination: authored(`${JDK}/nio/file/Path.html`, '`Paths`'), failure: 'label' },
  { name: 'exact: `Lists` at List, the plural of it', destination: authored(`${JDK}/util/List.html`, '`Lists`'), failure: 'label' },
  { name: 'exact control: `List` at List', destination: authored(`${JDK}/util/List.html`, '`List`'), ok: true },
  { name: 'label control: `Option::map` at Option::map', destination: authored(`${RUST}/option/enum.Option.html#method.map`, '`Option::map`'), ok: true },
  { name: 'label: `Option::map` at Result::map, the same member of another owner', destination: authored(`${RUST}/result/enum.Result.html#method.map`, '`Option::map`'), failure: 'label' },
  { name: 'label control: a bare `Result` at the one in std::result, which Rust code imports', destination: authored(`${RUST}/result/enum.Result.html`, '`Result`'), ok: true },
  { name: 'label: a bare `Result` at the alias in std::fmt', destination: authored(`${RUST}/fmt/type.Result.html`, '`Result`'), failure: 'label' },
  { name: 'label: a call written out is its callee, so `map!(f)` is not Base.map', destination: authored(`${JULIA}/collections/#Base.map`, '`map!(f)`'), failure: 'label' },
  { name: 'label control: a call written out is its callee, `map(f)` is Base.map', destination: authored(`${JULIA}/collections/#Base.map`, '`map(f)`'), ok: true },
  { name: 'words: "Julia arrays" at Base.Vector, which describe a page and name nothing', destination: authored(`${JULIA}/arrays/#Base.Vector`, 'Julia arrays'), failure: 'label' },
  { name: 'row control: "Python class methods" at classmethod, which a reviewed row says', destination: authored(`${PY}/functions.html#classmethod`, 'Python class methods'), ok: true },
  { name: 'row: "Python class methods" at int, where no row says it', destination: authored(`${PY}/functions.html#int`, 'Python class methods'), failure: 'label' },
  { name: 'row: "Python classmethod" at classmethod, words that are not exactly the name and not a row', destination: authored(`${PY}/functions.html#classmethod`, 'Python classmethod'), failure: 'label' },

  // Class: a scope a language binds per name, a hint that is a whole owner, a declaration that is a modifier before a keyword.
  { name: 'Scala control: a bare Map is the immutable one, which Predef binds', destination: at('https://www.scala-lang.org/api/3.x/scala/collection/immutable/Map.html', 'scala', 'Map'), ok: true },
  { name: 'Scala: a bare Map at scala.collection.Map, which Predef does not bind', destination: at('https://www.scala-lang.org/api/3.x/scala/collection/Map.html', 'scala', 'Map'), failure: 'owner' },
  { name: 'Scala control: a bare Iterator is scala.collection.Iterator', destination: at('https://www.scala-lang.org/api/3.x/scala/collection/Iterator.html', 'scala', 'Iterator'), ok: true },
  { name: 'hint control: a member written bare in a type that extends Error, at the Error trait', destination: at(`${RUST}/error/trait.Error.html#method.source`, 'rs', 'source', 'doc', { owners: ['Error'] }), ok: true },
  { name: 'hint: the same member at io::Error, whose name only ends the same', destination: at(`${RUST}/io/struct.Error.html#method.source`, 'rs', 'source', 'doc', { owners: ['Error'] }), failure: 'owner' },
  { name: 'Dokka control: a fun interface is an interface', destination: at(`${KOTLIN}/kotlinx.coroutines.flow/-flow-collector/`, 'kotlin', 'FlowCollector', 'type'), ok: true },
  { name: 'opens control: a bare Barrier in a file that opens System.Threading', destination: at(`${LEARN}/system.threading.barrier`, 'fsharp', 'Barrier', 'type', { opens: ['System.Threading'] }), ok: true },
  { name: 'opens: a bare Barrier in a file that opens nothing of System.Threading', destination: at(`${LEARN}/system.threading.barrier`, 'fsharp', 'Barrier', 'type', { opens: ['System.IO'] }), failure: 'owner' },
  { name: 'py control: a bare Mapping is collections.abc', destination: at('https://docs.python.org/3/library/collections.abc.html#collections.abc.Mapping', 'py', 'Mapping'), ok: true },
  { name: 'py: a bare Mapping at typing.Mapping, the alias', destination: at(`${PYLIB}/typing.html#typing.Mapping`, 'py', 'Mapping'), failure: 'owner' },
  { name: 'py control: typing.Mapping written with typing', destination: at(`${PYLIB}/typing.html#typing.Mapping`, 'py', 'typing.Mapping'), ok: true },
  { name: 'rustdoc control: println is in scope everywhere', destination: at(`${RUST}/macro.println.html`, 'rs', 'println'), ok: true },
  { name: 'rustdoc: println at print!', destination: at(`${RUST}/macro.print.html`, 'rs', 'println'), failure: 'symbol' },

  // Class: the words on a link to any other page are a row of the reviewed link table: the exact text, the exact address and the heading the page has there.
  { name: 'row control: "Kotlin classes" at the page headed Classes', destination: authored('https://kotlinlang.org/docs/classes.html', 'Kotlin classes'), ok: true },
  { name: 'unlisted: "Kotlin classes" at the page headed Functions', destination: authored('https://kotlinlang.org/docs/functions.html', 'Kotlin classes'), failure: 'unlisted' },
  { name: 'unlisted: "Kotlin classes" at a narrower page, Data classes', destination: authored('https://kotlinlang.org/docs/data-classes.html', 'Kotlin classes'), failure: 'unlisted' },
  { name: 'unlisted: "Kotlin class" at the page headed Classes, a text that is not the row\'s', destination: authored('https://kotlinlang.org/docs/classes.html', 'Kotlin class'), failure: 'unlisted' },
  { name: 'unlisted: "Kotlin documentation" at the page headed Classes, words every page of the site shares', destination: authored('https://kotlinlang.org/docs/classes.html', 'Kotlin documentation'), failure: 'unlisted' },
  { name: 'unlisted: "The Rust Reference" at the Structs page', destination: authored('https://doc.rust-lang.org/reference/items/structs.html', 'The Rust Reference'), failure: 'unlisted' },
  { name: 'row control: "Rust structs" at the Structs page of the reference', destination: authored('https://doc.rust-lang.org/reference/items/structs.html', 'Rust structs'), ok: true },
  { name: 'unlisted: "Rust structs" at the Enumerations page of the reference', destination: authored('https://doc.rust-lang.org/reference/items/enumerations.html', 'Rust structs'), failure: 'unlisted' },
  { name: 'row control: "Rust enum variants" at Enumerations, which the row says', destination: authored('https://doc.rust-lang.org/reference/items/enumerations.html', 'Rust enum variants'), ok: true },
  { name: 'unlisted: "Rust enum variants" at Structs, where no row says it', destination: authored('https://doc.rust-lang.org/reference/items/structs.html', 'Rust enum variants'), failure: 'unlisted' },
  { name: 'drift: "Kotlin classes" whose row records another heading than the page has', destination: authored('https://kotlinlang.org/docs/classes.html', 'Kotlin classes'), links: table(['Kotlin classes', 'https://kotlinlang.org/docs/classes.html', 'Classes and objects']), failure: 'drift' },
  { name: 'drift: a section whose row records the heading it had before the page was edited', destination: authored('https://docs.scala-lang.org/tour/basics.html#methods', 'Scala method declarations'), links: table(['Scala method declarations', 'https://docs.scala-lang.org/tour/basics.html#methods', 'Defining methods']), failure: 'drift' },
  { name: 'keyword control: C++ nodiscard at its attribute', destination: at('https://eel.is/c++draft/dcl.attr.nodiscard', 'cxx', 'nodiscard', 'keyword'), ok: true },
  { name: 'keyword: C++ nodiscard at the noreturn attribute', destination: at('https://eel.is/c++draft/dcl.attr.noreturn', 'cxx', 'nodiscard', 'keyword'), failure: 'unlisted' },
  { name: 'keyword control: Scala def at the Methods section', destination: at('https://docs.scala-lang.org/tour/basics.html#methods', 'scala', 'def', 'keyword'), ok: true },
  { name: 'keyword: Scala def at the Values section', destination: at('https://docs.scala-lang.org/tour/basics.html#values', 'scala', 'def', 'keyword'), failure: 'unlisted' },
  { name: 'keyword control: F# val at the signature files page', destination: at('https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/signature-files', 'fsharp', 'val', 'keyword'), ok: true },
  { name: 'keyword: F# val at the records page', destination: at('https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/records', 'fsharp', 'val', 'keyword'), failure: 'unlisted' },
  { name: 'language: "F# classes" at the C# page for static classes, a pair no row lists', destination: authored('https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-classes-and-static-class-members', 'F# classes'), failure: 'unlisted' },
  { name: 'language control: "F# classes" at the F# page', destination: authored('https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/classes', 'F# classes', 'fsharp'), ok: true },
  { name: 'language: a link the Rust docs write to the Go specification', destination: authored('https://go.dev/ref/spec#Constants', 'Go constants', 'rs'), failure: 'language' },
  { name: 'language control: the same link written by the Go docs', destination: authored('https://go.dev/ref/spec#Constants', 'Go constants', 'go'), ok: true },
  { name: 'language: a name the Rust port writes, at the TypeScript handbook', destination: at(`${TS}/utility-types.html#omittype-keys`, 'rs', 'Omit'), failure: 'language' },
  { name: 'language control: a link the Kotlin docs write to the JLS, a JVM port\'s own platform', destination: authored(`${JLS}/jls-4.html#jls-4.2.5`, 'Java booleans', 'kotlin'), ok: true },
  { name: 'language: the same link written by the Python docs', destination: authored(`${JLS}/jls-4.html#jls-4.2.5`, 'Java booleans', 'py'), failure: 'language' },
  { name: 'language: one pair written by a Rust page and then a Python page is held for the Python page too', destination: written(STRUCTS, 'Rust structs', 'rs', 'py'), failure: 'language' },
  { name: 'language: the same pair written by a Python page and then a Rust page', destination: written(STRUCTS, 'Rust structs', 'py', 'rs'), failure: 'language' },
  { name: 'language control: the pair written by two Rust pages', destination: written(STRUCTS, 'Rust structs', 'rs', 'rs'), ok: true },
  { name: 'language: a link written for a port the language table does not know', destination: authored(STRUCTS, 'Rust structs', 'zig'), failure: 'language' },
  { name: 'language: a C# link to the C++ documentation on Learn', destination: authored('https://learn.microsoft.com/en-us/cpp/cpp/classes-and-structs-cpp', 'C# classes', 'csharp'), failure: 'language' },
  { name: 'language: a C# link to the Visual Basic documentation on Learn', destination: authored('https://learn.microsoft.com/en-us/dotnet/visual-basic/programming-guide/language-features/objects-and-classes/', 'C# classes', 'csharp'), failure: 'language' },
  { name: 'language: a PowerShell link to the C# language specification', destination: authored('https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts#75-signatures-and-overloading', 'C# signatures and overloading', 'powershell'), failure: 'language' },
  { name: 'language control: a C# link to the C# language specification', destination: authored('https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/basic-concepts#75-signatures-and-overloading', 'C# signatures and overloading', 'csharp'), ok: true },
  { name: 'language control: a C# link to the platform both C# and F# share', destination: authored('https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install', '.NET tool install', 'csharp'), ok: true },
  // Class: the heading a fragment opens, on a page that declares a symbol.
  { name: 'fragment control: PowerShell error action at the section its fragment opens', destination: authored(`${COMMON}#-erroraction`, 'PowerShell error action', 'powershell'), ok: true },
  { name: 'fragment: a row that records the page-level name, not the heading the fragment opens', destination: authored(`${COMMON}#-erroraction`, 'PowerShell error action', 'powershell'), links: table(['PowerShell error action', `${COMMON}#-erroraction`, 'microsoft.powershell.core.CommonParameters']), failure: 'drift' },
  { name: 'fragment: a row that records the section the fragment opened before it moved', destination: authored(`${COMMON}#-erroraction`, 'PowerShell error action', 'powershell'), links: table(['PowerShell error action', `${COMMON}#-erroraction`, '-Verbose']), failure: 'drift' },
  { name: 'fragment: the same words at another section of the page, which no row lists', destination: authored(`${COMMON}#-verbose`, 'PowerShell error action', 'powershell'), failure: 'label' },
  // Class: the link under each of PowerShell's common parameters, which the command page builds from the parameter's name.
  { name: 'common parameter control: the words for -Verbose at the heading -Verbose', destination: authored(`${COMMON}#-verbose`, 'Microsoft Learn reference for -Verbose', 'powershell'), links: table(['Microsoft Learn reference for -Verbose', `${COMMON}#-verbose`, '-Verbose']), ok: true },
  { name: 'common parameter: the words for -Debug at the heading -Verbose', destination: authored(`${COMMON}#-verbose`, 'Microsoft Learn reference for -Debug', 'powershell'), links: table(['Microsoft Learn reference for -Debug', `${COMMON}#-verbose`, '-Debug']), failure: 'drift' },
  { name: 'common parameter: a parameter whose heading the page does not have', destination: authored(`${COMMON}#-debug`, 'Microsoft Learn reference for -Debug', 'powershell'), links: table(['Microsoft Learn reference for -Debug', `${COMMON}#-debug`, '-Debug']), failure: 'fragment' },
  { name: 'common parameter: the words for -Verbose with no row to review them', destination: authored(`${COMMON}#-verbose`, 'Microsoft Learn reference for -Verbose', 'powershell'), failure: 'label' },
  // Class: a link to the page of a libtmux package is held to the port that publishes it and the package it names.
  { name: 'package control: the Rust page links the crate it publishes, with the reviewed words', destination: packaged('https://docs.rs/tmux-mcp', 'crate API', 'rs', 'tmux-mcp', ['rs']), ok: true },
  { name: 'package: a Go page links the Rust crate', destination: packaged('https://docs.rs/tmux-mcp', 'crate API', 'go', 'tmux-mcp', ['rs']), failure: 'language' },
  { name: 'package: the same pair written by a Rust page and a Go page', destination: { ...packaged('https://docs.rs/tmux-mcp', 'crate API', 'rs', 'tmux-mcp', ['rs']), uses: [packaged('https://docs.rs/tmux-mcp', 'crate API', 'rs', 'tmux-mcp', ['rs']).uses[0], { ...packaged('https://docs.rs/tmux-mcp', 'crate API', 'go', 'tmux-mcp', ['rs']).uses[0], name: 'site/src/content/docs/ports/go/page.md' }] }, failure: 'language' },
  { name: 'package: words no row lists, on a link to the crate', destination: packaged('https://docs.rs/tmux-mcp', 'the workspace crate', 'rs', 'tmux-mcp', ['rs']), failure: 'unlisted' },
  { name: 'package: a reviewed row for another package than the page is', destination: packaged('https://docs.rs/tmux-mcp', 'crate API', 'rs', 'libtmux', ['rs']), failure: 'drift' },
  { name: 'package: the address written outside a link', destination: { url: 'https://docs.rs/tmux-mcp', host: 'docs.rs', uses: [{ port: '', name: 'site/src/content/docs/ports/rs/page.md', source: 'authored', unmatched: true, from: 'rs', package: { identity: 'tmux-mcp', ports: ['rs'] } }] }, failure: 'unlisted' },

  // Class: an exception that names a word, not an address. Each is pinned to the one address it was reviewed for.
  { name: 'cppreference control: std::chrono::seconds at the duration page that lists it', destination: at(`${CPPREF}/chrono/duration`, 'cxx', 'std::chrono::seconds'), ok: true },
  { name: 'cppreference control: std::string at the basic_string page that lists the typedef', destination: at(`${CPPREF}/string/basic_string`, 'cxx', 'std::string'), ok: true },
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
  { name: 'section: atom at the literals, which write atoms', destination: at(`${HEXDOCS}/typespecs.html#literals`, 'elixir', 'atom'), failure: 'kind' },
]

for (const testCase of cases) {
  const record = await verifyApiDestination(testCase.destination, { get, links: testCase.links ?? TABLE })
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

// Class: every form a Markdown link takes yields its pair, and an address written outside a link is held as one with no words.
// Each page is planted in a root of its own whose data and libraries are this checkout's, so the collector reads it as it reads the site.
const planted = mkdtempSync(join(tmpdir(), 'api-destination-forms-'))
const plantedDocs = join(planted, 'site', 'src', 'content', 'docs', 'ports', 'rs', 'concepts')
mkdirSync(plantedDocs, { recursive: true })
symlinkSync(join(root, 'site', 'src', 'data'), join(planted, 'site', 'src', 'data'))
symlinkSync(join(root, 'site', 'src', 'lib'), join(planted, 'site', 'src', 'lib'))
const LISTED = 'Rust structs'
const UNLISTED = 'Rust enums'
const CODED = '`Rust structs[0]`'
const formsOf = [
  ['an inline link', (label) => `See [${label}](${STRUCTS}) here.`],
  ['an inline link with a title', (label) => `See [${label}](${STRUCTS} "A title") here.`],
  ['an inline link with a title in single quotes', (label) => `See [${label}](${STRUCTS} 'A title') here.`],
  ['an inline link with the address in angle brackets', (label) => `See [${label}](<${STRUCTS}>) here.`],
  ['a reference link with a titled definition', (label) => `See [${label}][o] here.\n\n[o]: ${STRUCTS} "A title"`],
  ['a collapsed reference link', (label) => `See [${label}][] here.\n\n[${label}]: ${STRUCTS}`],
  ['a shortcut reference link', (label) => `See [${label}] here.\n\n[${label}]: ${STRUCTS}`],
  ['a definition with the address in angle brackets', (label) => `See [${label}][o] here.\n\n[o]: <${STRUCTS}>`],
  ['a raw anchor', (label) => `See <a href="${STRUCTS}">${label}</a> here.`],
  ['a raw anchor with single quotes and attributes', (label) => `<p><a class="x" href='${STRUCTS}' target="_blank">${label}</a></p>`],
  ['a link inside emphasis', (label) => `See *[${label}](${STRUCTS})* here.`],
  ['a link in a list item', (label) => `- [${label}](${STRUCTS})`],
  ['a link in a table cell', (label) => `| a | b |\n| - | - |\n| [${label}](${STRUCTS}) | x |`],
]
const spellings = [
  ['a protocol-relative address', (label) => `See [${label}](//doc.rust-lang.org/reference/items/structs.html) here.`],
  ['an address in capitals', (label) => `See [${label}](HTTPS://DOC.RUST-LANG.ORG/reference/items/structs.html) here.`],
  ['a host with a dot after it', (label) => `See [${label}](https://doc.rust-lang.org./reference/items/structs.html) here.`],
  ['a raw anchor to a protocol-relative address', (label) => `See <a href="//doc.rust-lang.org/reference/items/structs.html">${label}</a> here.`],
  ['a raw anchor whose address is written with an entity', (label) => `See <a href="https&#58;//doc.rust-lang.org/reference/items/structs.html">${label}</a> here.`],
  ['a raw anchor whose words are written with an entity', (label) => `See <a href="${STRUCTS}">${label.replace(' ', '&nbsp;')}</a> here.`],
]
const looseForms = [
  ['an address in a sentence', `See ${STRUCTS} here.`],
  ['an address in a code span', `Run \`curl ${STRUCTS}\` here.`],
  ['an address in a fence', `\`\`\`sh\ncurl ${STRUCTS}\n\`\`\``],
  ['an address in an image', `![diagram](${STRUCTS})`],
  ['a definition nothing uses', `See nothing here.\n\n[o]: ${STRUCTS}`],
  ['an address written as a link and again in a sentence', `See [${LISTED}](${STRUCTS}) and also ${STRUCTS} for more.`],
  ['an address in front matter', `FRONT:source: ${STRUCTS}\nSee nothing here.`],
  ['a raw anchor with an unquoted address, which a Markdown parser reads as text', `See <a href=https://doc.rust-lang.org/reference/items/structs.html>${LISTED}</a> here.`],
  ['a protocol-relative address in a sentence', 'See //doc.rust-lang.org/reference/items/structs.html here.'],
  ['an address in capitals in a sentence', 'See HTTPS://DOC.RUST-LANG.ORG/reference/items/structs.html here.'],
  ['a host with a dot after it in a sentence', 'See https://doc.rust-lang.org./reference/items/structs.html here.'],
  ['an address a reader sees only after its entities decode', 'See https:&#47;&#47;doc.rust-lang.org/reference/items/structs.html here.'],
  ['an address with its scheme written in an entity', 'See https&#58;//doc.rust-lang.org/reference/items/structs.html here.'],
]
// Addresses the check cannot fetch from the stand-in server are held at the collector: they are found, and found loose.
const looseCollected = [
  ['an http address in a sentence', 'See http://doc.rust-lang.org/reference/items/structs.html here.', 'http://doc.rust-lang.org/reference/items/structs.html'],
  ['a bare www address in a sentence', 'See www.lua.org/manual/5.4/manual.html here.', 'http://www.lua.org/manual/5.4/manual.html'],
  ['an http address as a link destination', `See [${LISTED}](http://doc.rust-lang.org/reference/items/structs.html) here.`, 'http://doc.rust-lang.org/reference/items/structs.html'],
  ['an http address in a raw anchor with an unquoted address', `See <a href=http://doc.rust-lang.org/reference/items/structs.html>${LISTED}</a> here.`, 'http://doc.rust-lang.org/reference/items/structs.html'],
]
const plants = []
const plant = (name, body, expectation) => {
  const file = `form-${plants.length}.md`
  const front = body.startsWith('FRONT:') ? `${body.slice(6).split('\n')[0]}\n` : ''
  const text = body.startsWith('FRONT:') ? body.slice(6).split('\n').slice(1).join('\n') : body
  writeFileSync(join(plantedDocs, file), `---\nport: rs\ntitle: planted\n${front}---\n${text}\n`)
  plants.push({ name, where: `site/src/content/docs/ports/rs/concepts/${file}`, ...expectation })
}
for (const [name, write] of formsOf) {
  plant(`${name}, its words listed`, write(LISTED), { ok: true })
  plant(`${name}, its words not listed`, write(UNLISTED), { failure: 'unlisted', mentions: JSON.stringify(UNLISTED) })
}
for (const [name, write] of spellings) {
  plant(`${name}, its words listed`, write(LISTED), { ok: true })
  plant(`${name}, its words not listed`, write(UNLISTED), { failure: 'unlisted', mentions: JSON.stringify(UNLISTED) })
}
plant('an inline link whose words are code with brackets in it', `See [${CODED}](${STRUCTS}) here.`, { failure: 'unlisted', mentions: JSON.stringify(CODED) })
plant('an autolink', `See <${STRUCTS}> here.`, { failure: 'unlisted', mentions: JSON.stringify(STRUCTS) })
for (const [name, body] of looseForms) plant(name, body, { failure: 'unlisted', mentions: 'outside a Markdown link' })
for (const [name, body] of looseCollected) plant(name, body, { collected: true })
const found = collectApiDestinations({ root: planted })
for (const planting of plants) {
  const uses = [...found.values()].flatMap((destination) => [...destination.uses.values()].filter((use) => use.name === planting.where).map((use) => ({ destination, use })))
  const destination = uses[0]?.destination
  if (!destination) { fail(`markdown: ${planting.name}: the collector found no address in the page`); continue }
  if (planting.collected) {
    // Held at the collector: an http address is a destination of its own, and it is written outside a link or reaches the page by a redirect.
    const url = looseCollected.find(([title]) => planting.name === title)[2]
    if (destination.url === url && uses.some(({ use }) => use.unmatched || use.label)) console.log(`ok   markdown: ${planting.name}: found at ${url}`)
    else fail(`markdown: ${planting.name}: expected the collector to find ${url}, found ${destination.url}`)
    continue
  }
  const record = await verifyApiDestination({ url: destination.url, host: destination.host, uses: uses.map(({ use }) => use) }, { get, links: TABLE })
  if (planting.ok) {
    if (!record.ok) fail(`markdown: ${planting.name}: expected a pass, got ${record.failure ?? record.unverifiable}: ${record.detail ?? ''}`)
    else console.log(`ok   markdown: ${planting.name}`)
  } else if (record.ok || record.failure !== planting.failure || !String(record.detail).includes(planting.mentions)) {
    fail(`markdown: ${planting.name}: expected ${planting.failure} naming ${planting.mentions}, got ${record.ok ? 'a pass' : `${record.failure}: ${record.detail}`}`)
  } else {
    console.log(`ok   markdown: ${planting.name}: ${record.failure}`)
  }
}

// Class: a page the site builds from somewhere else is read as the site reads it. A guide staged from a port's artifact, and a workspace
// page written once for every port, are planted in a root whose data is this checkout's, and the destinations they link must be found and
// then held to the committed evidence like any other.
const STAGED_URL = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Objects.html#requireNonNull(T,java.util.function.Supplier)'
const SHARED_URL = 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Objects.html#hash(java.lang.Object...)'
const built = mkdtempSync(join(tmpdir(), 'api-destination-staged-'))
const builtData = join(built, 'site', 'src', 'data')
mkdirSync(builtData, { recursive: true })
for (const entry of readdirSync(join(root, 'site', 'src', 'data'))) if (entry !== 'port-guides') symlinkSync(join(root, 'site', 'src', 'data', entry), join(builtData, entry))
mkdirSync(join(builtData, 'port-guides'))
for (const entry of readdirSync(join(root, 'site', 'src', 'data', 'port-guides'))) {
  const guides = JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'port-guides', entry), 'utf8'))
  if (entry === 'scala.json') guides.guides[0].content += "\n\nThe record's own Java accessor (`Objects.requireNonNull`) answers.\n"
  writeFileSync(join(builtData, 'port-guides', entry), JSON.stringify(guides))
}
symlinkSync(join(root, 'site', 'src', 'lib'), join(built, 'site', 'src', 'lib'))
mkdirSync(join(built, 'site', 'src', 'content', 'docs'), { recursive: true })
mkdirSync(join(built, 'site', 'src', 'content', '_workspace-shared'), { recursive: true })
writeFileSync(join(built, 'site', 'src', 'content', '_workspace-shared', 'zz-planted.md'), '---\ntitle: planted\n---\nIn Java, `Objects.hash` combines values.\n')
const evidenceOf = () => JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'api-destination-evidence.json'), 'utf8'))
const builtFound = collectApiDestinations({ root: built })
const realFound = collectApiDestinations({ root })
for (const [name, url] of [['a guide staged from a port artifact', STAGED_URL], ['a workspace page shared by every port', SHARED_URL]]) {
  const uses = [...(builtFound.get(url)?.uses.values() ?? [])]
  if (realFound.has(url)) fail(`staged: ${name}: control failed, the committed pages already link ${url}`)
  else if (uses.length === 0) fail(`staged: ${name}: expected the collector to find ${url}`)
  else if (!checkApiEvidence(builtFound, evidenceOf(), { root: built }).problems.some((problem) => problem.includes(url) && /has no evidence/.test(problem))) fail(`staged: ${name}: expected --check to name ${url} as having no evidence`)
  else console.log(`ok   staged: ${name}: found, and held to the evidence`)
}
rmSync(built, { recursive: true, force: true })
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
const firstIdentified = evidence.destinations.findIndex((record) => record.ok && record.identity && record.terminal?.some((entry) => entry.at === 'identity'))
const firstRead = evidence.destinations.findIndex((record) => record.ok && !record.identity && record.terminal?.some((entry) => !entry.key))
const unverifiable = { ok: false, unverifiable: 'the host blocks the request (403)', status: 403, terminal: undefined, identity: undefined, fragment: undefined }

const drives = [
  { name: 'control: the committed evidence', mutate: () => {}, status: 0 },
  { name: 'a destination with no record', mutate: (copy) => { copy.destinations.splice(firstChecked, 1) }, expect: /has no evidence/ },
  { name: 'a record that failed', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { ok: false, failure: 'fragment', detail: 'planted' }) }, expect: /does not land on its symbol \(fragment\): planted/ },
  { name: 'a record for a link nothing generates', mutate: (copy) => { copy.destinations.push({ ...copy.destinations[firstChecked], url: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Gone.html' }) }, expect: /no source generates it/ },
  { name: 'two records for one link, the second failing', mutate: (copy) => { copy.destinations.push({ ...copy.destinations[firstChecked], ok: false, failure: 'symbol', detail: 'planted' }) }, expect: /has more than one record/ },
  { name: 'a name never checked against its page', mutate: (copy) => { copy.destinations[firstRead].terminal = [] }, expect: /was never checked for/ },
  { name: 'a pass by the page text that no reviewed exception allows', mutate: (copy) => { copy.destinations[firstIdentified].terminal.find((entry) => entry.at === 'identity').at = 'listed' }, expect: /by listed, which no reviewed exception/ },
  { name: 'a pass by identity with the identity removed', mutate: (copy) => { delete copy.destinations[firstIdentified].identity }, expect: /found by identity without the identity it was found in/ },
  { name: 'an identity that is not a path and a kind', mutate: (copy) => { copy.destinations[firstIdentified].identity = { declared: 'class' } }, expect: /records an identity that is not a path and a kind/ },
  { name: 'an identity edited to another symbol than the address names', mutate: (copy) => { const record = copy.destinations.find((candidate) => candidate.url === 'https://doc.rust-lang.org/std/vec/struct.Vec.html'); record.identity.path = ['std', 'vec', 'Option'] }, expect: /records the identity std\.vec\.Option, but its address names/ },
  { name: 'an identity that no longer fits the name that leads there', mutate: (copy) => { const record = copy.destinations.find((candidate) => candidate.url === 'https://doc.rust-lang.org/std/vec/struct.Vec.html'); Object.assign(record.identity, { path: ['std', 'vec', 'Vec'], kind: 'module' }) }, expect: /\(kind\)/ },
  { name: 'a passing record with the status 404', mutate: (copy) => { copy.destinations[firstChecked].status = 404 }, expect: /passing with the status 404/ },
  { name: 'a passing record that carries a failure', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { failure: 'fragment', detail: 'planted' }) }, expect: /passing yet carries failure/ },
  { name: 'a passing record that redirects', mutate: (copy) => { copy.destinations[firstChecked].finalUrl = 'https://example.org/moved' }, expect: /passing yet carries finalUrl/ },
  { name: 'a passing record that is also unverifiable', mutate: (copy) => { copy.destinations[firstChecked].unverifiable = 'the host blocks the request (403)' }, expect: /passing yet carries unverifiable/ },
  { name: 'a record under another host', mutate: (copy) => { copy.destinations[firstChecked].host = 'example.org' }, expect: /recorded under the host example\.org/ },
  { name: 'a symbol recorded as found where the verifier never looks', mutate: (copy) => { copy.destinations[firstChecked].terminal[0].at = 'heading' }, expect: /found "heading", which the verifier never reports/ },
  { name: 'an unverifiable record that gives a reason of its own', mutate: (copy) => { Object.assign(copy.destinations[firstChecked], { ...unverifiable, unverifiable: 'n/a' }) }, expect: /is unverifiable for "n\/a", which is no reason the verifier gives/ },
  { name: 'every destination unverifiable, so nothing was checked', mutate: (copy) => { for (const record of copy.destinations) Object.assign(record, unverifiable) }, expect: /destinations are unverifiable, more than the \d+ a blocked or throttled host explains/ },
  { name: 'a few destinations unverifiable is unresolved, not a failure', mutate: (copy) => { for (const record of copy.destinations.slice(0, 5)) Object.assign(record, unverifiable) }, status: 0 },
  { name: 'every unverifiable destination is printed, not a count', mutate: (copy) => { for (const record of copy.destinations.slice(0, 30)) Object.assign(record, unverifiable) }, status: 0, printed: { pattern: /unresolved: https:/g, count: 30 } },
  { name: 'a reviewed link whose record lost the heading it was compared at', mutate: (copy) => { delete copy.destinations.find((record) => record.url === 'https://doc.rust-lang.org/reference/items/structs.html').heading }, expect: /as a reviewed link without the heading it was compared at/ },
  { name: 'a heading that is not the words of one', mutate: (copy) => { copy.destinations.find((record) => record.url === 'https://doc.rust-lang.org/reference/items/structs.html').heading = '' }, expect: /records a heading that is not the words of one/ },
  { name: 'a record that saw another heading than the reviewed row records', mutate: (copy) => { copy.destinations.find((record) => record.url === 'https://doc.rust-lang.org/reference/items/structs.html').heading = 'Enumerations' }, expect: /names \(drift\): the reviewed link records the heading "Structs", and the record saw "Enumerations"/ },
  { name: 'an inventory without a record', mutate: (copy) => { copy.inventories = copy.inventories.filter((record) => record.name !== 'jdk') }, expect: /the jdk inventory has no record/ },
  { name: 'an inventory that names pages its host lacks', mutate: (copy) => { Object.assign(copy.inventories[0], { ok: false, missing: 3, examples: ['Planted'] }) }, expect: /names 3 pages its host's index lacks/ },
  { name: 'an inventory rebuilt since it was verified', mutate: (copy) => { copy.inventories[0].digest = '0'.repeat(40) }, expect: /entries are not the ones its record was verified with/ },
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
  } else if (drive.printed && (output.match(drive.printed.pattern) ?? []).length !== drive.printed.count) {
    fail(`${drive.name}: expected ${drive.printed.count} lines matching ${drive.printed.pattern}, got ${(output.match(drive.printed.pattern) ?? []).length}`)
  } else {
    console.log(`ok   ${drive.name}`)
  }
}

// The third half changes what the source generates over a record that stays as it was, and checks offline.
const destinations = collectApiDestinations({ root })
const clone = () => new Map([...destinations].map(([url, destination]) => [url, { ...destination, uses: new Map(destination.uses) }]))
const rename = (url, from, to, extra = {}) => {
  const map = clone()
  const destination = map.get(url)
  const [key, use] = [...destination.uses].find(([, candidate]) => `${candidate.port}:${candidate.name}` === from)
  destination.uses.delete(key)
  const [port, ...name] = to.split(':')
  destination.uses.set(`${port}\0${name.join(':')}\0${use.source}\0`, { ...use, port, name: name.join(':'), ...extra })
  return map
}
const VEC = 'https://doc.rust-lang.org/std/vec/struct.Vec.html'
const reviewed = loadReviewedLinks(root)
const asTable = (rows) => ({ rows, byPair: new Map(rows.map((row) => [pairKey(row.label, row.url), row])) })
const without = (label) => asTable(reviewed.rows.filter((row) => row.label !== label))
const edited = (label, heading) => asTable(reviewed.rows.map((row) => (row.label === label ? { ...row, heading } : row)))
const withRow = (row) => asTable([...reviewed.rows, row])
// A text that is exactly the symbol its page declares, which a row would only repeat.
const exactRow = (() => {
  const record = new Map(evidence.destinations.map((candidate) => [candidate.url, candidate]))
  for (const destination of destinations.values()) {
    const found = record.get(destination.url)
    for (const use of destination.uses.values()) {
      if (use.label !== undefined && found?.identity && ['type', 'object', 'module', 'member', 'callback', 'keyword'].includes(found.identity.kind) && !judgeLabel(use.label, found.identity)) {
        return { label: use.label, url: destination.url, heading: found.heading ?? found.identity.path.join('.') }
      }
    }
  }
  return undefined
})()
const recompute = [
  { name: 'control: the destinations the source generates', destinations: clone(), expect: undefined },
  { name: 'a builtin renamed to another symbol over the same address', destinations: rename(VEC, 'rs:Vec', 'rs:Option'), expect: /not what rs:Option names \(symbol\)/ },
  { name: 'a builtin renamed to a member of the type the address documents', destinations: rename(VEC, 'rs:Vec', 'rs:Vec::push'), expect: /not what rs:Vec::push names \(symbol\)/ },
  { name: 'a builtin renamed into another module', destinations: rename(VEC, 'rs:Vec', 'rs:std::collections::Vec'), expect: /not what rs:std::collections::Vec names \(owner\)/ },
  { name: 'a type written with another operand count over the same address', destinations: rename('https://learn.microsoft.com/dotnet/api/microsoft.extensions.logging.ilogger', 'csharp:ILogger', 'csharp:ILogger<TCategoryName>'), expect: /not what csharp:ILogger<TCategoryName> names \(arity\)/ },
  { name: 'a link text edited over the same address: a pair no row lists', destinations: (() => { const map = clone(); map.get('https://doc.rust-lang.org/reference/items/structs.html').uses.set('x', { port: '', name: 'site/src/content/docs/example.md', source: 'authored', label: 'Rust enums' }); return map })(), expect: /not what the link text "Rust enums" names \(unlisted\)/ },
  { name: 'a link whose words now name another symbol', destinations: (() => { const map = clone(); const url = 'https://docs.julialang.org/en/v1/base/strings/#Base.strip'; map.get(url).uses.set('x', { port: '', name: 'site/src/content/docs/example.md', source: 'authored', label: 'lstrip' }); return map })(), expect: /not what the link text "lstrip" names \(label\)/ },
  { name: 'a row removed from the table', links: without('Rust structs'), expect: /not what the link text "Rust structs" names \(unlisted\)/ },
  { name: 'a row whose heading was edited', links: edited('Rust structs', 'Enumerations'), expect: /names \(drift\): the reviewed link records the heading "Enumerations", and the record saw "Structs"/ },
  { name: 'a row for a link nothing generates', links: withRow({ label: 'Rust traits', url: 'https://doc.rust-lang.org/reference/items/unions.html', heading: 'Unions' }), expect: /has a row for "Rust traits" at https:\/\/doc\.rust-lang\.org\/reference\/items\/unions\.html, which nothing the source generates writes/ },
  { name: 'a row listed twice', links: withRow(reviewed.rows.find((row) => row.label === 'Rust structs')), expect: /has "Rust structs" at https:\/\/doc\.rust-lang\.org\/reference\/items\/structs\.html twice/ },
  { name: 'a row for a text that is exactly the symbol its page declares', links: withRow(exactRow), expect: /has a reviewed row for .*which is exactly the symbol the page declares: remove the row/ },
]
for (const drive of recompute) {
  const { problems } = checkApiEvidence(drive.destinations ?? destinations, evidence, { root, links: drive.links ?? reviewed })
  const text = problems.join('\n')
  if (drive.expect === undefined) {
    if (problems.length > 0) fail(`${drive.name}: expected no problems, got ${text.slice(0, 600)}`)
    else console.log(`ok   ${drive.name}`)
  } else if (!drive.expect.test(text)) {
    fail(`${drive.name}: expected a problem matching ${drive.expect}, got ${text.slice(0, 600) || 'none'}`)
  } else {
    console.log(`ok   ${drive.name}`)
  }
}

// The pages planted above, read as the committed `--check` reads them: an address the committed evidence has no record of, or one written
// outside a link, is a problem, so a form that cannot be fetched from the stand-in server still cannot pass.
const plantedProblems = checkApiEvidence(found, evidence, { root: planted }).problems.join('\n')
for (const planting of plants.filter((candidate) => candidate.collected)) {
  const url = looseCollected.find(([title]) => planting.name === title)[2]
  if (plantedProblems.includes(url)) console.log(`ok   --check: ${planting.name}`)
  else fail(`--check: ${planting.name}: expected a problem naming ${url}, got ${plantedProblems.slice(0, 400) || 'none'}`)
}
rmSync(planted, { recursive: true, force: true })

// An inventory whose entries were swapped keeps its count and loses its digest.
const swapped = mkdtempSync(join(tmpdir(), 'api-destination-inventories-'))
mkdirSync(join(swapped, 'site', 'src', 'data', 'inventories'), { recursive: true })
cpSync(join(root, 'site', 'src', 'data', 'inventories'), join(swapped, 'site', 'src', 'data', 'inventories'), { recursive: true })
const sidecar = join(swapped, 'site', 'src', 'data', 'inventories', 'python.entries.json')
const body = JSON.parse(readFileSync(sidecar, 'utf8'))
body.e[0] = ['planted.name', body.e[0][1]]
writeFileSync(sidecar, JSON.stringify(body))
const swap = checkApiEvidence(destinations, evidence, { root: swapped })
if (swap.problems.some((problem) => /python inventory's entries are not the ones/.test(problem))) console.log('ok   an inventory entry swapped for another keeps its count and loses its digest')
else fail('an inventory entry swapped for another: expected the digest to differ')
rmSync(swapped, { recursive: true, force: true })
rmSync(dir, { recursive: true, force: true })

if (failures > 0) {
  console.error(`${failures} negative case${failures === 1 ? '' : 's'} did not fail for the reason they name`)
  process.exitCode = 1
} else {
  console.log('every planted fault failed for its named reason')
}
