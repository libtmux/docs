/**
 * Every external API destination the site generates for a language's own
 * library or an SDK it builds on.
 *
 * The links come from these places, and each is read from the code that makes
 * it rather than restated, so the set cannot drift from the site:
 *
 * - the curated maps in `packages/api-model/src/builtins.ts`;
 * - the cached inventories (CPython, Julia, the JDK, the web platform and the
 *   SDKs), resolved the way the reference pages resolve a type annotation;
 * - the references and links written in the extracted doc comments;
 * - the language help `link.ts` attaches to a keyword.
 *
 * A destination is a URL plus the names that lead to it. The name matters: a
 * link to a real page is still wrong when the page documents something else,
 * so the verifier holds each page to the symbol each name asks for.
 */

import { globSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTINS } from '../../packages/api-model/src/builtins.ts'
import { Resolver, SymbolIndex, tokenizeDoc, looksLikeApiMention, notASymbol } from '../../packages/api-model/src/index.ts'
import { KEYWORD_HELP } from '../../packages/api-model/src/link.ts'
import { NATIVE_API_GLOSSARIES } from '../../site/src/lib/api-glossary-native.ts'
export { TYPE_ALIASES, addressSegments, arityOf, nameSegments, terminalSymbol } from './api-sources.mjs'
import { nameSegments } from './api-sources.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Inventories a port resolves against, scoped to the ports they describe.
 * `site/src/lib/api-models.ts` attaches the same list; a test holds the two
 * lists to one another.
 */
export const EXTERNAL_INVENTORIES = [
  { file: 'python', project: 'Python', baseUrl: 'https://docs.python.org/3/', langs: ['py'] },
  { file: 'jdk', project: 'Java SE', baseUrl: 'https://docs.oracle.com/en/java/javase/21/docs/api/', langs: ['java', 'kotlin', 'scala'] },
  { file: 'dom', project: 'MDN Web Docs', baseUrl: 'https://developer.mozilla.org/', langs: ['ts'] },
  { file: 'julia', project: 'Julia', baseUrl: 'https://docs.julialang.org/en/v1/', langs: ['julia'] },
]

/**
 * Hosts whose pages document a language, its standard library or an SDK. A
 * destination elsewhere (a repository, a registry, a tool's own manual) is
 * the header verifier's or nobody's business.
 */
export const API_HOSTS = new Set([
  'docs.python.org', 'doc.rust-lang.org', 'docs.rs', 'pkg.go.dev', 'go.dev', 'developer.mozilla.org', 'www.typescriptlang.org',
  'docs.oracle.com', 'docs.junit.org', 'kotlinlang.org', 'www.scala-lang.org', 'docs.scala-lang.org', 'typelevel.org', 'javadoc.io',
  'learn.microsoft.com', 'fsharp.github.io', 'en.cppreference.com', 'eel.is', 'developer.apple.com', 'docs.swift.org',
  'docs.ruby-lang.org', 'ruby-doc.org', 'www.lua.org', 'luals.github.io', 'docs.julialang.org', 'hexdocs.pm', 'www.erlang.org',
  'gofastmcp.com', 'csharp.sdk.modelcontextprotocol.io', 'modelcontextprotocol.io', 'cmake.org',
])

export const apiHostOf = (url) => {
  try {
    const { hostname } = new URL(url)
    return API_HOSTS.has(hostname) ? hostname : hostname.endsWith('.hexdocs.pm') && API_HOSTS.has('hexdocs.pm') ? hostname : undefined
  } catch {
    return undefined
  }
}

const CPP = 'https://en.cppreference.com/cpp/'
const MANUAL = 'https://www.lua.org/manual/5.4/manual.html#2.1'
const TYPESPECS = 'https://elixir.hexdocs.pm/typespecs.html'
const JLS = 'https://docs.oracle.com/javase/specs/jls/se21/html/'

/** The anchors the handbook gives each utility type: its name run into its parameters. */
const UTILITY_ANCHORS = {
  Awaited: 'awaitedtype', Partial: 'partialtype', Required: 'requiredtype', Readonly: 'readonlytype', Record: 'recordkeys-type',
  Pick: 'picktype-keys', Omit: 'omittype-keys', Exclude: 'excludeuniontype-excludedmembers', Extract: 'extracttype-union',
  NonNullable: 'nonnullabletype', Parameters: 'parameterstype', ConstructorParameters: 'constructorparameterstype',
  ReturnType: 'returntypetype', InstanceType: 'instancetypetype', NoInfer: 'noinfertype', ThisParameterType: 'thisparametertypetype',
  OmitThisParameter: 'omitthisparametertype', ThisType: 'thistypetype', Uppercase: 'uppercasestringtype', Lowercase: 'lowercasestringtype',
  Capitalize: 'capitalizestringtype', Uncapitalize: 'uncapitalizestringtype',
}

/**
 * Where a page documents a name somewhere other than its title or the
 * fragment's own spelling. Each entry pins names to one exact address, so it
 * covers nothing else on that page or any other, and gives the reason a reader
 * can check against the page.
 *
 * - `listed`: the page's text names the symbol. For a name documented beside
 *   its subject, as `milliseconds` is a typedef on the `duration` page.
 * - `section`: the section the anchor opens (the text up to the next heading
 *   or sibling entry) names the symbol. For an anchor that documents several,
 *   or whose spelling is a heading. `words` is what the section says when it
 *   is not the symbol's own spelling (`async iterable` for `AsyncIterable`).
 * - `label`: a link's own words name the concept, and the page it reaches
 *   documents the symbol that defines it (`authored:` names, the words as
 *   written). For a glossary term that links the function declaring it.
 */
export const PAGE_EXCEPTIONS = [
  ...[
    [`${CPP}chrono`, ['std::chrono'], 'the date and time library page introduces the namespace under a title that does not name it'],
    [`${CPP}chrono/duration`, ['std::chrono::milliseconds', 'std::chrono::nanoseconds', 'std::chrono::seconds'], 'the duration page lists the unit typedefs'],
    [`${CPP}chrono/system_clock`, ['std::chrono::sys_seconds'], 'the system_clock page lists sys_seconds among its typedefs'],
    [`${CPP}chrono/steady_clock`, ['std::chrono::steady_clock::time_point'], 'the steady_clock page lists time_point among its member types'],
    [`${CPP}types/integer`, ['std::int64_t', 'std::uint8_t', 'std::uint32_t', 'std::uint64_t'], 'the fixed width integer types page lists every width in one table'],
    [`${CPP}types/is_lvalue_reference`, ['std::is_lvalue_reference_v'], 'the is_lvalue_reference page lists the _v helper variable template'],
    [`${CPP}types/remove_cv`, ['std::remove_cv_t'], 'the remove_cv page lists the _t helper alias'],
    [`${CPP}types/remove_cvref`, ['std::remove_cvref_t'], 'the remove_cvref page lists the _t helper alias'],
    [`${CPP}types/remove_pointer`, ['std::remove_pointer_t'], 'the remove_pointer page lists the _t helper alias'],
    [`${CPP}types/result_of`, ['std::invoke_result_t'], 'the result_of page covers invoke_result and its _t helper alias'],
  ].map(([url, names, reason]) => ({ tier: 'listed', url, names: names.map((name) => `cxx:${name}`), reason })),
  // A link whose words go past the heading of the page it reaches, on a host that declares no symbol. The verifier also
  // requires the page's text to say the words the heading lacks; each row names the heading and what the link adds.
  ...[
    ['https://docs.scala-lang.org/tour/basics.html#methods', 'authored:Scala functions and methods', 'Methods', 'functions'],
    ['https://docs.scala-lang.org/tour/basics.html#methods', 'keyword:Scala method declarations', 'Methods', 'method declarations'],
    ['https://docs.scala-lang.org/tour/basics.html#methods', 'authored:Scala method declarations', 'Methods', 'method declarations'],
    ['https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/static', 'authored:C# static members', 'static', 'static members'],
    ['https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/abstract', 'authored:C# abstract declarations', 'abstract', 'abstract declarations'],
    ['https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly', 'authored:C# readonly declarations', 'readonly', 'readonly declarations'],
    ['https://www.typescriptlang.org/docs/handbook/2/classes.html#private', 'authored:TypeScript private members', 'private', 'private members'],
    ['https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html#jls-9.6', 'authored:Java annotation interfaces and elements', 'Annotation Interfaces', 'the elements of an annotation interface'],
    ['https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.1.1.2', 'authored:Java final declarations', 'sealed, non-sealed, and final Classes', 'final declarations'],
    ['https://kotlinlang.org/docs/functions.html#function-scope', 'authored:Kotlin member functions', 'Function scope', 'member functions'],
    ['https://eel.is/c++draft/dcl.fct', 'authored:C++ function declarations', 'Functions', 'function declarations'],
    ['https://doc.rust-lang.org/reference/items/associated-items.html', 'authored:Rust associated declarations', 'Associated items', 'associated declarations'],
    ['https://docs.swift.org/latest/documentation/the-swift-programming-language/functions/', 'authored:Swift function declarations', 'Functions', 'function declarations'],
    ['https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/signature-files', 'keyword:F# value signatures', 'Signature files', 'the values a signature declares'],
    ['https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install#global-tools', 'authored:`$HOME/.dotnet/tools`', 'Global tools', 'where they are installed, under the home directory'],
    ['https://doc.rust-lang.org/error_codes/E0117.html', 'authored:orphan rules', 'E0117', 'the orphan rules'],
    ['https://docs.python.org/3/tutorial/classes.html', 'authored:Python class and instance attributes', '9. Classes', 'class and instance attributes'],
    ['https://eel.is/c++draft/class.pre', 'authored:C++ class keys', 'Preamble', 'class keys'],
    ['https://eel.is/c++draft/class.pre', 'authored:C++ classes', 'Preamble', 'classes, which it introduces'],
    ['https://eel.is/c++draft/class.pre', 'authored:C++ class declarations', 'Preamble', 'class declarations'],
    ['https://docs.julialang.org/en/v1/manual/types/#Composite-Types', 'authored:Julia immutable composite types', 'Composite Types', 'immutable composite types'],
    ['https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/discriminated-unions', 'authored:F# union cases', 'Discriminated Unions', 'union cases'],
    ['https://doc.rust-lang.org/reference/items/enumerations.html', 'authored:Rust enum variants', 'Enumerations', 'enum variants'],
    ['https://docs.julialang.org/en/v1/manual/methods/', 'authored:Julia method dispatch', 'Methods', 'method dispatch'],
    ['https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/async', 'authored:C# async methods', 'async', 'async methods'],
    ['https://kotlinlang.org/docs/coroutines-basics.html', 'authored:Kotlin suspending functions', 'Coroutines basics', 'suspending functions'],
    ['https://eel.is/c++draft/dcl.type.cv', 'authored:C++ const qualification', 'The cv-qualifiers', 'const qualification'],
    ['https://eel.is/c++draft/dcl.type.cv', 'authored:C++ cv-qualification', 'The cv-qualifiers', 'cv-qualification'],
    ['https://docs.scala-lang.org/tour/basics.html#values', 'authored:Scala values and variables', 'Values', 'variables'],
    ['https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.12.4', 'authored:Java constant variables', 'final Variables', 'constant variables'],
    ['https://elixir.hexdocs.pm/typespecs.html#behaviours', 'authored:Elixir behaviour callbacks', 'Behaviours', 'behaviour callbacks'],
    ['https://elixir.hexdocs.pm/typespecs.html#defining-a-specification', 'authored:Elixir function specifications', 'Defining a specification', 'function specifications'],
    ['https://www.typescriptlang.org/docs/handbook/2/classes.html#getters--setters', 'authored:TypeScript properties', 'Getters / Setters', 'properties'],
    ['https://www.typescriptlang.org/docs/handbook/release-notes/typescript-1-7.html#asyncawait-support-in-es6-targets-node-v4', 'authored:TypeScript async functions', 'async / await support', 'async functions'],
    ['https://www.typescriptlang.org/docs/handbook/2/classes.html#readonly', 'authored:TypeScript readonly fields', 'readonly', 'readonly fields'],
    ['https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/methods', 'authored:C# method overloading', 'Methods', 'overloading'],
    ['https://learn.microsoft.com/en-us/nuget/what-is-nuget', 'authored:NuGet packages', 'An introduction to NuGet', 'packages'],
    ['https://learn.microsoft.com/en-us/powershell/scripting/developer/module/writing-a-windows-powershell-module', 'authored:PowerShell module distribution', 'Writing a Windows PowerShell Module', 'distribution'],
    ['https://go.dev/doc/modules/layout', 'authored:Go modules and packages', 'Organizing a Go module', 'packages'],
    ['https://eel.is/c++draft/class.mem', 'authored:C++ data members', 'Class members', 'data members'],
    ['https://eel.is/c++draft/dcl.typedef', 'authored:C++ type aliases', 'The typedef specifier', 'type aliases'],
    ['https://doc.rust-lang.org/reference/items/structs.html', 'authored:Rust fields', 'Structs', 'fields'],
    ['https://doc.rust-lang.org/cargo/reference/cargo-targets.html', 'authored:Cargo packages and targets', 'Cargo Targets', 'packages'],
    ['https://docs.ruby-lang.org/en/3.4/syntax/methods_rdoc.html', 'authored:Ruby singleton methods', 'methods', 'singleton methods'],
    ['https://www.lua.org/manual/5.4/manual.html#pdf-require', 'authored:Lua modules', 'require (modname)', 'modules'],
    ['https://www.lua.org/manual/5.4/manual.html#3.4.10', 'authored:Lua method calls', 'Function Calls', 'method calls'],
    ['https://www.lua.org/manual/5.4/manual.html#2.4', 'authored:Lua table access', 'Metatables and Metamethods', 'table access'],
    ['https://luals.github.io/wiki/annotations/#alias', 'authored:Lua type aliases', '@alias', 'type aliases'],
    ['https://luals.github.io/wiki/annotations/#class', 'authored:Lua class inheritance', '@class', 'inheritance'],
    ['https://luals.github.io/wiki/annotations/#class', 'authored:Lua class annotations', '@class', 'class annotations'],
    ['https://luals.github.io/wiki/annotations/#overload', 'authored:Lua overload annotations', '@overload', 'overload annotations'],
    ['https://docs.swift.org/latest/documentation/the-swift-programming-language/methods/', 'authored:Swift type methods', 'Methods', 'type methods'],
    ['https://docs.swift.org/latest/documentation/the-swift-programming-language/thebasics/', 'authored:Swift constants', 'The Basics', 'constants'],
    ['https://www.lua.org/manual/5.4/manual.html#6.3', 'authored:Lua packages and require', 'Modules', 'packages and require'],
  ].map(([url, key, heading, adds]) => ({ tier: 'label', url, names: [key], reason: `the page, headed "${heading}", also covers ${adds}` })),
  // The same, where the page documents a symbol and the link's words name a part of it or a way to reach it.
  ...[
    ['https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4#-erroraction', 'doc-link:-ErrorAction Continue', '-ErrorAction is one of the common parameters this about topic documents'],
    ['https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4#-erroraction', 'doc-link:-ErrorAction Stop', '-ErrorAction is one of the common parameters this about topic documents'],
    ['https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#CallToolResult', 'authored:`CallToolResult.IsError`', 'pkg.go.dev documents a struct\'s fields in the declaration of its type, with no anchor of their own'],
    ['https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk@v1.6.1/mcp#CallToolResult', 'authored:`CallToolResult.StructuredContent`', 'pkg.go.dev documents a struct\'s fields in the declaration of its type, with no anchor of their own'],
    ['https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.errorrecord.exception?view=powershellsdk-7.4.0', 'authored:`$_.Exception`', '`$_` is the ErrorRecord of a catch block, and this page documents its Exception property'],
  ].map(([url, key, reason]) => ({ tier: 'label', url, names: [key], reason })),
  ...[
    ['https://docs.python.org/3/builtins/functions.html#classmethod', 'Python class methods', 'the classmethod builtin is the decorator that makes a class method, and its entry is where Python documents them'],
    ['https://docs.python.org/3/builtins/functions.html#property', 'Python properties', 'the property builtin is the descriptor class that makes a property, and its entry is where Python documents them'],
    ['https://docs.python.org/3/library/typing.html#typing.overload', 'Python typing overloads', 'typing.overload is the decorator that declares an overload for a type checker'],
    ['https://docs.julialang.org/en/v1/base/base/#Base.getproperty', 'Julia fields and properties', 'getproperty is the function that dot access calls, and Base documents field and property access in its entry'],
    ['https://docs.julialang.org/en/v1/base/base/#Base.getproperty', 'Julia property access', 'getproperty is the function that dot access calls, and Base documents property access in its entry'],
    ['https://elixir.hexdocs.pm/Kernel.html#defexception/1', 'Elixir exceptions', 'defexception is the macro that declares an exception, and its entry is where Elixir documents them'],
    ['https://elixir.hexdocs.pm/Kernel.html#defmacro/2', 'Elixir macros', 'defmacro is the macro that defines a macro, and its entry is where Elixir documents them'],
    ['https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_advanced', 'PowerShell advanced functions', 'the about topic for advanced functions is titled Functions_Advanced'],
    ['https://elixir.hexdocs.pm/Module.html', 'Elixir deprecations', 'the Module page documents the @deprecated attribute among its module attributes'],
  ].map(([url, label, reason]) => ({ tier: 'label', url, names: [`authored:${label}`], reason })),
  ...[['string/basic_string', 'std::string'], ['string/basic_string_view', 'std::string_view']].map(([page, name]) => ({
    tier: 'listed', url: `${CPP}${page}`, names: [`cxx:${name}`], words: name,
    reason: `the page lists the ${name} typedef for char beside the template`,
  })),
  {
    tier: 'listed', url: `${CPP}chrono/time_point/max`, names: ['cxx:std::chrono::steady_clock::time_point::max'], words: 'time_point',
    reason: 'max is documented once for time_point of any clock, and the name picks steady_clock, which the title does not',
  },
  ...[
    [`${TYPESPECS}#basic-types`, 'elixir', ['any', 'none', 'atom', 'map', 'pid', 'port', 'reference', 'tuple', 'float', 'integer', 'neg_integer', 'non_neg_integer',
      'pos_integer', 'list', 'nonempty_list', 'maybe_improper_list', 'nonempty_improper_list', 'nonempty_maybe_improper_list'], 'the typespec reference lists the basic types in one section'],
    [`${TYPESPECS}#built-in-types`, 'elixir', ['term', 'arity', 'as_boolean', 'binary', 'bitstring', 'boolean', 'byte', 'char', 'charlist', 'nonempty_charlist', 'fun',
      'function', 'identifier', 'iodata', 'iolist', 'keyword', 'mfa', 'module', 'no_return', 'node', 'number', 'struct', 'timeout'], 'the typespec reference lists the built-in types in one section'],
    [`${TYPESPECS}#literals`, 'elixir', ['nil', 'required'], 'the literals section lists nil and writes required(key_type) among the map forms'],
    [`${TYPESPECS}#maps`, 'elixir', ['optional'], 'the maps section explains optional(any) as the open map key'],
    [`${MANUAL}`, 'lua', ['nil', 'boolean', 'number', 'integer', 'string', 'function', 'table', 'thread', 'userdata'], 'the manual documents its value types together in section 2.1'],
    ['https://luals.github.io/wiki/annotations/#documenting-types', 'lua', ['any'], 'the wiki lists the recognized types in one section'],
    [`${JLS}jls-4.html#jls-4.2.1`, 'java', ['byte', 'int', 'long'], 'JLS 4.2.1 documents the integral types and their values together'],
    [`${JLS}jls-4.html#jls-4.2.5`, 'java', ['boolean'], 'JLS 4.2.5 documents the boolean type and its values'],
    [`${JLS}jls-8.html#jls-8.4.5`, 'java', ['void'], 'JLS 8.4.5 documents the void result of a method'],
    ['https://kotlinlang.org/docs/coroutines-basics.html#suspending-functions', 'kotlin', ['suspend'], 'the section on suspending functions is where the keyword is documented, under a gerund heading'],
    ['https://kotlinlang.org/docs/exceptions.html#the-finally-block', 'kotlin', ['finally'], 'the section titled for the finally block documents the keyword'],
    ['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_iterable_protocol', 'ts', ['Iterable'], 'MDN documents the iterable protocol in the section titled for it, and has no page for the interface'],
    ...Object.entries(UTILITY_ANCHORS).map(([name, anchor]) => [`https://www.typescriptlang.org/docs/handbook/utility-types.html#${anchor}`, 'ts', [name], 'the handbook spells a utility type\'s anchor as its name run into its parameters']),
  ].map(([url, port, names, reason]) => ({ tier: 'section', url, names: names.map((name) => `${port}:${name}`), reason })),
  {
    tier: 'section', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols',
    names: ['ts:AsyncIterable'], words: 'async iterable', reason: 'MDN documents the async iterable protocol in the section titled for it, and has no page for the interface',
  },
]

/** The exception that lets one name's page document it elsewhere than its title or fragment, if one was reviewed. */
export function exceptionFor(url, key, exceptions = PAGE_EXCEPTIONS) {
  const entry = exceptions.find((candidate) => candidate.url === url && candidate.names.includes(key))
  return entry && { tier: entry.tier, reason: entry.reason, ...(entry.words && { words: entry.words }) }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function entriesOf(inventory) {
  return inventory.e.map(([name, uri]) => ({ name: name ?? '', type: 'std:label', priority: 1, uri: uri ?? '', dispname: '-' }))
}

/** A fragment the host did not mint is the verifier's to check; the URL is kept exactly as the site links it. */
function note(found, url, use) {
  const host = apiHostOf(url)
  if (!host) return
  const destination = found.get(url) ?? { url, host, uses: new Map() }
  const key = `${use.port}\0${use.name}\0${use.source}\0${use.label ?? ''}`
  const known = destination.uses.get(key)
  // The same name written in several places is one use; the types its places extend, and the namespaces their
  // files open, are all the owners it may mean.
  const owners = [...new Set([...(known?.owners ?? []), ...(use.owners ?? [])])]
  const opens = [...new Set([...(known?.opens ?? []), ...(use.opens ?? [])])]
  destination.uses.set(key, { ...known, ...use, ...(owners.length && { owners }), ...(opens.length && { opens }) })
  found.set(url, destination)
}

/**
 * The destinations, as `Map<url, { url, host, uses: Map }>`, where each use is
 * `{ port, name, source }` and `source` says which part of the site makes it.
 */
export function collectApiDestinations({ root = ROOT } = {}) {
  const found = new Map()
  const data = join(root, 'site', 'src', 'data')

  for (const [port, names] of Object.entries(BUILTINS)) {
    for (const [name, href] of Object.entries(names)) note(found, href, { port, name, source: 'builtin' })
  }
  for (const [port, words] of Object.entries(KEYWORD_HELP)) {
    for (const [name, help] of Object.entries(words)) note(found, help.href, { port, name, source: 'keyword', label: help.title })
  }

  const inventories = EXTERNAL_INVENTORIES.map((entry) => ({ ...entry, entries: entriesOf(readJson(join(data, 'inventories', `${entry.file}.entries.json`))) }))
  const dependencies = readJson(join(data, 'inventories', 'dependencies.entries.json'))

  const models = {}
  for (const file of readdirSync(join(data, 'api')).sort()) {
    if (!/^[a-z]+\.json$/.test(file) || file.endsWith('.nav.json') || file.endsWith('.paths.json')) continue
    const model = readJson(join(data, 'api', file))
    if (Array.isArray(model.symbols)) models[file.replace(/\.json$/, '')] = model
  }

  for (const [port, model] of Object.entries(models)) {
    const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.slug ?? symbol.id}/`, port)
    for (const inventory of inventories) {
      if (inventory.langs.includes(port)) index.addInventory(inventory.baseUrl, inventory.entries, inventory.langs, inventory.project)
    }
    for (const dependency of dependencies) {
      if (dependency.langs.includes(port)) index.addInventory(dependency.baseUrl, entriesOf(dependency), dependency.langs, dependency.project)
    }
    const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
    // A member written bare in a type's docs may belong to a type it extends, or that its parent extends.
    const basesOf = (symbol) => [...new Set([symbol, byId.get(symbol.parent)].flatMap((owner) => owner?.extends ?? []).map((base) => nameSegments(base).join('.')).filter(Boolean))]
    const link = (target, text, source, symbol, role) => {
      if (target?.external) note(found, target.href, { port, name: qualified(symbol, text), source, ...(role && role !== 'any' && { role }), ...(basesOf(symbol).length && { owners: basesOf(symbol) }), ...(symbol.namespaceImports?.length && { opens: symbol.namespaceImports }) })
    }
    const types = (symbol, signature, text) => {
      if (!text) return
      for (const span of index.linkType(text, symbol, signature)) link(span.link, span.text, 'type', symbol)
    }
    const prose = (symbol, text) => {
      if (!text) return
      for (const span of tokenizeDoc(text, port)) {
        if (span.kind === 'ref') link(index.resolve(span.target, span.role, symbol), span.target, 'doc', symbol, span.role)
        else if (span.kind === 'code' && looksLikeApiMention(span.text) && !notASymbol(span.text)) link(index.resolve(span.text, 'any', symbol), span.text, 'doc', symbol)
        else if (span.kind === 'link') note(found, span.href, { port, name: span.text, source: 'doc-link', label: span.text })
      }
    }
    for (const symbol of model.symbols) {
      types(symbol, undefined, symbol.type)
      for (const base of symbol.extends ?? []) types(symbol, undefined, base)
      for (const signature of symbol.signatures ?? []) {
        types(symbol, signature, signature.raw)
        types(symbol, signature, signature.returns)
        types(symbol, signature, signature.receiver?.type)
        for (const param of signature.params ?? []) types(symbol, signature, param.type)
        for (const raised of signature.raises ?? []) types(symbol, signature, raised.type)
        for (const parameter of signature.typeParameters ?? []) {
          types(symbol, signature, parameter.bound)
          types(symbol, signature, parameter.default)
        }
        for (const param of signature.params ?? []) prose(symbol, param.doc)
        prose(symbol, signature.returnsDoc)
        for (const raised of signature.raises ?? []) prose(symbol, raised.doc)
      }
      prose(symbol, symbol.doc?.summary)
      prose(symbol, symbol.doc?.body)
      for (const related of symbol.command?.relatedLinks ?? []) note(found, related.href, { port, name: related.text, source: 'doc-link', label: related.text })
    }
  }

  collectProse(found, { root, models, inventories })
  collectAuthored(found, { root })
  return found
}

/**
 * A name as the resolver reads it. The first segment is replaced by what the
 * symbol's imports bind it to, so `t.Generic` under `import typing as t` is
 * `typing.Generic`, the name the destination documents.
 */
export function qualified(symbol, text) {
  const [head, ...tail] = text.split('.')
  const imported = symbol.imports?.[head]
  return imported ? [imported, ...tail].join('.') : text
}

/** The URLs a text names, without the punctuation of the sentence or markup around them. */
export function urlsIn(text) {
  return [...text.matchAll(/https:\/\/[^\s'"`)<>\]\\|]+/g)]
    .map((match) => match[0].replace(/[.,;:*_]+$/, ''))
    .filter((url) => !url.includes('${'))
}

const portOf = (file, source) => /^port:\s*['"]?([a-z]+)['"]?\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '')?.[1]
  ?? /(?:^|\/)ports\/([^/]+)\//.exec(file)?.[1]

/**
 * What prose pins to a standard-library name: every code span in a port's own
 * pages, resolved the way the linker resolves it, plus the links written by
 * hand. A page that belongs to no single port names no language, so its spans
 * are left to the pages that do.
 */
function collectProse(found, { root, models, inventories }) {
  const content = join(root, 'site', 'src', 'content', 'docs')
  const resolver = new Resolver(Object.values(models))
  for (const inventory of inventories) resolver.addInventory(inventory.project, inventory.baseUrl, inventory.entries, inventory.langs)
  for (const file of globSync('**/*.{md,mdx}', { cwd: content }).sort()) {
    if (file.startsWith('meta/') || file.startsWith('_')) continue
    const source = readFileSync(join(content, file), 'utf8')
    const port = portOf(file, source)
    if (!port || !models[port]) continue
    const product = /^product:\s*['"]?(core|workspace|mcp)['"]?\s*$/m.exec(source)?.[1] ?? /^ports\/[^/]+\/(workspace|mcp)\//.exec(file)?.[1]
    const body = source.replace(/^---[\s\S]*?\n---\n/, '').replace(/^(`{3,}|~{3,})[\s\S]*?^\1[ \t]*$/gm, '')
    for (const match of body.matchAll(/`([^`\n]+)`/g)) {
      const text = match[1].trim()
      if (!looksLikeApiMention(text) || notASymbol(text)) continue
      const resolution = resolver.resolve(port, text, product)
      if (resolution.how === 'federated') note(found, resolution.href, { port, name: text, source: 'prose' })
    }
  }
}

/**
 * The links a text writes with words, as `Map<url, Set<label>>`: inline Markdown
 * (`[label](url)`), reference style (`[label][ref]` with `[ref]: url`), and the
 * glossary's `{ title, url }` pairs. A bare URL has no words to compare.
 */
export function linksIn(text) {
  const labels = new Map()
  const add = (url, label) => {
    const clean = url.replace(/[.,;:*_]+$/, '')
    const words = label.replace(/\s+/g, ' ').trim()
    if (words) labels.set(clean, (labels.get(clean) ?? new Set()).add(words))
  }
  for (const match of text.matchAll(/\[((?:[^\]\\]|\\.)+)\]\((https:\/\/[^\s)]+)\)/g)) add(match[2], match[1])
  const references = new Map([...text.matchAll(/^\[([^\]]+)\]:\s*(https:\/\/\S+)/gm)].map((match) => [match[1].toLowerCase(), match[2]]))
  for (const match of text.matchAll(/\[((?:[^\]\\]|\\.)+)\]\[([^\]]+)\]/g)) {
    const url = references.get(match[2].toLowerCase())
    if (url) add(url, match[1])
  }
  for (const match of text.matchAll(/title:\s*'([^']+)',\s*url:\s*'(https:\/\/[^']+)'/g)) add(match[2], match[1])
  return labels
}

/** Hand-written references: Markdown links in pages, guide data and the glossary. */
function collectAuthored(found, { root }) {
  const skip = new Set(JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'destination-evidence.json'), 'utf8')).destinations.map((record) => record.url))
  const add = (text, where, title) => {
    const labels = linksIn(text)
    for (const url of urlsIn(text)) {
      if (skip.has(url)) continue
      const words = title ? new Set([title]) : labels.get(url)
      if (words) for (const label of words) note(found, url, { port: '', name: where, source: 'authored', label })
      else note(found, url, { port: '', name: where, source: 'authored' })
    }
  }
  const content = join(root, 'site', 'src', 'content', 'docs')
  for (const file of globSync('**/*.{md,mdx}', { cwd: content }).sort()) {
    if (file.startsWith('meta/') || file.startsWith('_')) continue
    add(readFileSync(join(content, file), 'utf8'), `site/src/content/docs/${file}`)
  }
  const walk = (value, where) => {
    if (typeof value === 'string') add(value, where)
    else if (Array.isArray(value)) for (const item of value) walk(item, where)
    else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, where)
  }
  for (const file of globSync('site/src/data/port-guides/*.json', { cwd: root }).sort()) walk(readJson(join(root, file)), file)
  for (const file of ['site/src/lib/api-glossary.ts', 'site/src/lib/api-sections.ts']) {
    add(readFileSync(join(root, file), 'utf8'), file)
  }
  // The native glossary builds its addresses with helpers, so it is read as data.
  for (const [port, terms] of Object.entries(NATIVE_API_GLOSSARIES)) {
    for (const [term, definition] of Object.entries(terms)) {
      for (const reference of definition.references) add(reference.url, `glossary ${port} ${term}`, reference.title)
    }
  }
}
