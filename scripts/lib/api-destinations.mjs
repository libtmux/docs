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
  // MDN has no page for TypeScript's read-only views or for its iterable interfaces; it documents the runtime
  // objects and the iteration protocols they implement.
  ts: { ReadonlyMap: 'Map', ReadonlySet: 'Set', IterableIterator: 'Iterator', AsyncIterable: 'async_iterable' },
}

/**
 * Names a page documents beside its subject rather than under a heading of
 * their own, so the page's text is where to find them: `milliseconds` is a
 * typedef on the `duration` page, `remove_cv_t` an alias on `remove_cv`'s.
 * Every entry was read on its page; a name not listed here must be in a title,
 * a heading or the fragment it links to.
 */
export const LISTED_ON_PAGE = new Set([
  'std::chrono', 'std::chrono::milliseconds', 'std::chrono::nanoseconds', 'std::chrono::seconds', 'std::chrono::sys_seconds',
  'std::chrono::steady_clock::time_point', 'std::int64_t', 'std::uint8_t', 'std::uint32_t', 'std::uint64_t', 'std::is_lvalue_reference_v',
  'std::remove_cv_t', 'std::remove_cvref_t', 'std::remove_pointer_t', 'std::invoke_result_t', 'bool', 'int', 'long', 'double', 'char',
].map((name) => `cxx:${name}`))

const CALL = /\(.*$/s
const ARITY = /`\d+/g

/** The symbol a name asks for: its last segment, without generics, arity or call syntax. */
export function terminalSymbol(port, name) {
  const keyword = TYPE_ALIASES[port]?.[name]
  if (keyword) return keyword
  let text = name.trim().replace(ARITY, '').replace(/^[tc]:/, '').replace(/\/\d+$/, '')
  if (!/^[A-Za-z_]+(?:-[A-Za-z]+)+$/.test(text)) text = text.replace(CALL, '').replace(/<.*$/s, '')
  text = text.replace(/\[.*$/s, '')
  const segments = text.split(/::|[.#\\]/).filter(Boolean)
  const last = segments.at(-1) ?? text
  return TYPE_ALIASES[port]?.[last] ?? last
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
    const link = (target, text, source) => {
      if (target?.external) note(found, target.href, { port, name: text, source })
    }
    const types = (symbol, signature, text) => {
      if (!text) return
      for (const span of index.linkType(text, symbol, signature)) link(span.link, span.text, 'type')
    }
    const prose = (symbol, text) => {
      if (!text) return
      for (const span of tokenizeDoc(text, port)) {
        if (span.kind === 'ref') link(index.resolve(span.target, span.role, symbol), span.target, 'doc')
        else if (span.kind === 'code' && looksLikeApiMention(span.text) && !notASymbol(span.text)) link(index.resolve(span.text, 'any', symbol), span.text, 'doc')
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
