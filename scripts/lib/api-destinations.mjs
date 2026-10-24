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

/**
 * Names a language spells another way than the page that documents them: a
 * keyword for a library type, or a read-only view of one. The page is right
 * when it documents the target.
 */
export const TYPE_ALIASES = {
  csharp: { bool: 'Boolean', string: 'String', char: 'Char', int: 'Int32', long: 'Int64', double: 'Double', void: 'Void', object: 'Object', byte: 'Byte' },
  fsharp: { string: 'String', bool: 'Boolean', int: 'Int32', int64: 'Int64', seq: 'IEnumerable', None: 'option', Some: 'option' },
  // MDN has no page for TypeScript's read-only views or for its iterator interface; it documents the runtime
  // objects they view.
  // Scala's String is the alias `scala.Predef` declares, and its page is Predef's.
  scala: { String: 'Predef' },
  ts: { ReadonlyMap: 'Map', ReadonlySet: 'Set', IterableIterator: 'Iterator' },
}

/**
 * Names written with a package other than the one whose page documents them.
 * The Go SDK's examples import `mcp` as `sdk`, and cats-effect re-exports the
 * types of its kernel package from `cats.effect`, so both spellings reach the
 * same page. Each rewrites a name to the one the address spells.
 */
const NAME_ALIASES = {
  go: { sdk: 'mcp' },
  scala: Object.fromEntries(['Async', 'Deferred', 'Outcome', 'Resource', 'Fiber', 'Ref'].map((type) => [`cats.effect.${type}`, `cats.effect.kernel.${type}`])),
}

/** A name's segments as the address spells them: the root marker dropped, a package alias replaced. */
export function addressSegments(port, name) {
  const segments = nameSegments(name)
  const whole = NAME_ALIASES[port]?.[segments.join('.')]
  if (whole) return whole.split('.')
  const head = NAME_ALIASES[port]?.[segments[0]]
  return segments.length > 1 && head && !head.includes('.') ? [head, ...segments.slice(1)] : segments
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
    [`${CPP}language/bool_literal`, ['bool'], 'the boolean literals page is where cppreference documents the bool type'],
    [`${CPP}language/types`, ['int', 'long', 'double', 'char'], 'the fundamental types page documents each in a section of its own'],
  ].map(([url, names, reason]) => ({ tier: 'listed', url, names: names.map((name) => `cxx:${name}`), reason })),
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

const CALL = /\(.*$/s
const ARITY = /`\d+/g

/** The segments of a name, outermost first, without generics, arity, call syntax or an Elixir kind prefix. */
export function nameSegments(name) {
  let text = name.trim().replace(ARITY, '').replace(/^[tc]:/, '').replace(/\/\d+$/, '')
  if (!/^[A-Za-z_]+(?:-[A-Za-z]+)+$/.test(text)) text = text.replace(CALL, '').replace(/<.*$/s, '')
  text = text.replace(/\[.*$/s, '')
  return text.split(/::|[.#\\]/).filter((segment) => segment && segment !== '_root_')
}

/** The symbol a name asks for: its last segment, or the word its language spells for it. */
export function terminalSymbol(port, name) {
  const aliased = TYPE_ALIASES[port]?.[name]
  if (aliased) return aliased
  return nameSegments(name).at(-1) ?? name.trim()
}

/** The operand count a name writes after a slash, as Elixir does: `Enum.map/2`. */
export function arityOf(name) {
  return /\/(\d+)$/.exec(name.trim())?.[1]
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
  destination.uses.set(`${use.port}\0${use.name}\0${use.source}`, use)
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
    for (const [name, help] of Object.entries(words)) note(found, help.href, { port, name, source: 'keyword' })
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
    const link = (target, text, source, symbol) => {
      if (target?.external) note(found, target.href, { port, name: qualified(symbol, text), source })
    }
    const types = (symbol, signature, text) => {
      if (!text) return
      for (const span of index.linkType(text, symbol, signature)) link(span.link, span.text, 'type', symbol)
    }
    const prose = (symbol, text) => {
      if (!text) return
      for (const span of tokenizeDoc(text, port)) {
        if (span.kind === 'ref') link(index.resolve(span.target, span.role, symbol), span.target, 'doc', symbol)
        else if (span.kind === 'code' && looksLikeApiMention(span.text) && !notASymbol(span.text)) link(index.resolve(span.text, 'any', symbol), span.text, 'doc', symbol)
        else if (span.kind === 'link') note(found, span.href, { port, name: span.text, source: 'doc-link' })
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
      for (const related of symbol.command?.relatedLinks ?? []) note(found, related.href, { port, name: related.text, source: 'doc-link' })
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

/** Hand-written references: Markdown links in pages, guide data and the glossary. */
function collectAuthored(found, { root }) {
  const skip = new Set(JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'destination-evidence.json'), 'utf8')).destinations.map((record) => record.url))
  const add = (text, where) => {
    for (const url of urlsIn(text)) if (!skip.has(url)) note(found, url, { port: '', name: where, source: 'authored' })
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
      for (const reference of definition.references) add(reference.url, `glossary ${port} ${term}`)
    }
  }
}
