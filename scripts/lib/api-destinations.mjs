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
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { BUILTINS } from '../../packages/api-model/src/builtins.ts'
import { Resolver, SymbolIndex, conceptNotes, decideMention, proseTexts, looksLikeApiMention, notASymbol, sourceUrl } from '../../packages/api-model/src/index.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parseApiProse } from '../../site/src/lib/api-prose.ts'
import { SOURCE_GUIDE_PORTS } from '../../site/src/lib/port-documentation.ts'
import { stagedPortGuides } from '../stage-port-docs.mjs'
import { powerShellCommonParameterHref, powerShellCommonParameterLabel } from '../../site/src/lib/powershell-common-parameters.ts'
import { KNOWN_PORTS, resolvePortBody, resolvePortData } from '../../site/src/lib/workspace-shared-slots.ts'
import { PORTS as SITE_PORTS } from '../../site/src/lib/ports.ts'
import { KEYWORD_HELP } from '../../packages/api-model/src/link.ts'
import { NATIVE_API_GLOSSARIES } from '../../site/src/lib/api-glossary-native.ts'
export { TYPE_ALIASES, addressSegments, arityOf, nameSegments, terminalSymbol } from './api-sources.mjs'
import { nameSegments } from './api-sources.mjs'
import { dataLinks, markdownLinks, normalizeAddress, occurrencesIn } from './api-markdown-links.mjs'

/** The ports whose workspace pages the loader fills from the shared source. */
const PORTS_SHARED = SITE_PORTS.map((port) => port.slug).filter((slug) => KNOWN_PORTS.has(slug))

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
  'gofastmcp.com', 'csharp.sdk.modelcontextprotocol.io', 'ts.sdk.modelcontextprotocol.io', 'modelcontextprotocol.io', 'cmake.org',
])

export const apiHostOf = (url) => {
  try {
    const { hostname } = new URL(normalizeAddress(url))
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
function note(found, written, use) {
  const url = normalizeAddress(written)
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
 * The runs of text `ApiDoc` receives for a prose field: the text itself, or the paragraphs and list items
 * `ApiProse` splits it into, which leave fenced code alone.
 */
export function proseRuns(text, form) {
  const items = (list) => list.flatMap((item) => [item.text, ...items(item.children)])
  const blocks = () => parseApiProse(text).flatMap((block) => (block.kind === 'p' ? [block.text] : block.kind === 'ul' || block.kind === 'ol' ? items(block.items) : []))
  return form === 'inline' ? [text] : form === 'blocks' ? blocks() : [text, ...blocks()]
}

/** Every type the site draws for a symbol, with the signature it is drawn in: what `ApiType` is given. */
export function typeInputs(symbol) {
  const found = []
  const add = (signature, text) => { if (text) found.push({ signature, text }) }
  add(undefined, symbol.type)
  for (const base of symbol.extends ?? []) add(undefined, base)
  for (const signature of symbol.signatures ?? []) {
    add(signature, signature.raw)
    add(signature, signature.returns)
    add(signature, signature.receiver?.type)
    for (const param of signature.params ?? []) add(signature, param.type)
    for (const raised of signature.raises ?? []) add(signature, raised.type)
    for (const parameter of signature.typeParameters ?? []) {
      add(signature, parameter.bound)
      add(signature, parameter.default)
    }
  }
  return found
}

/**
 * The extracted API models of a checkout and, for each port, the index the site links its prose with:
 * the port's own symbols, the inventories it resolves against, and its source files. This is the site's
 * `createApiIndex` (which a script cannot import) read from the same data; the parent and dependency
 * libraries are the sidecar the build writes from the same models, and they resolve to pages of this site.
 * A test holds the two indexes to the same links over every prose field of every symbol.
 */
export function apiIndexes({ root = ROOT } = {}) {
  const data = join(root, 'site', 'src', 'data')
  const inventories = EXTERNAL_INVENTORIES.map((entry) => ({ ...entry, entries: entriesOf(readJson(join(data, 'inventories', `${entry.file}.entries.json`))) }))
  const dependencies = readJson(join(data, 'inventories', 'dependencies.entries.json'))

  const models = {}
  for (const file of readdirSync(join(data, 'api')).sort()) {
    if (!/^[a-z]+\.json$/.test(file) || file.endsWith('.nav.json') || file.endsWith('.paths.json')) continue
    const model = readJson(join(data, 'api', file))
    if (Array.isArray(model.symbols)) models[file.replace(/\.json$/, '')] = model
  }

  const indexes = {}
  for (const [port, model] of Object.entries(models)) {
    const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.slug ?? symbol.id}/`, port)
    for (const inventory of inventories) {
      if (inventory.langs.includes(port)) index.addInventory(inventory.baseUrl, inventory.entries, inventory.langs, inventory.project)
    }
    for (const dependency of dependencies) {
      if (dependency.langs.includes(port)) index.addInventory(dependency.baseUrl, entriesOf(dependency), dependency.langs, dependency.project)
    }
    // The files the site's `createApiIndex` resolves a name to: a source file of the model is one entry, by its path and by its base name.
    const sourceFiles = new Map()
    for (const symbol of model.symbols) {
      const file = symbol.source.file
      const href = sourceUrl(model, { ...symbol, source: { ...symbol.source, line: undefined } }, '/')
      if (!href || !file) continue
      for (const name of [file, file.split('/').at(-1)]) {
        const targets = sourceFiles.get(name) ?? new Map()
        targets.set(file, href)
        sourceFiles.set(name, targets)
      }
    }
    const filesByBase = new Map()
    for (const [name, candidates] of sourceFiles) {
      if (candidates.size !== 1) continue
      const href = [...candidates.values()][0]
      const base = href.startsWith('https://github.com/') ? 'https://github.com/' : ''
      const entries = filesByBase.get(base) ?? []
      entries.push({ name, uri: href.slice(base.length), type: 'std:label', priority: 1, dispname: '-' })
      filesByBase.set(base, entries)
    }
    for (const [base, entries] of filesByBase) index.addInventory(base, entries, [port], 'Source')
    indexes[port] = index
  }
  return { models, inventories, indexes }
}

/**
 * The destinations, as `Map<url, { url, host, uses: Map }>`, where each use is
 * `{ port, name, source }` and `source` says which part of the site makes it.
 */
export function collectApiDestinations({ root = ROOT } = {}) {
  const found = new Map()

  for (const [port, names] of Object.entries(BUILTINS)) {
    for (const [name, href] of Object.entries(names)) note(found, href, { port, name, source: 'builtin' })
  }
  for (const [port, words] of Object.entries(KEYWORD_HELP)) {
    for (const [name, help] of Object.entries(words)) note(found, help.href, { port, name, source: 'keyword', label: help.title })
  }

  const { models, inventories, indexes } = apiIndexes({ root })

  for (const [port, model] of Object.entries(models)) {
    const index = indexes[port]
    const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
    // A member written bare in a type's docs may belong to a type it extends, or that its parent extends.
    const basesOf = (symbol) => [...new Set([symbol, byId.get(symbol.parent)].flatMap((owner) => owner?.extends ?? []).map((base) => nameSegments(base).join('.')).filter(Boolean))]
    const link = (target, text, source, symbol, role) => {
      if (target?.external) note(found, target.href, { port, name: symbol ? qualified(symbol, text) : text, source, ...(role && role !== 'any' && { role }), ...(symbol && basesOf(symbol).length && { owners: basesOf(symbol) }), ...(symbol?.namespaceImports?.length && { opens: symbol.namespaceImports }) })
    }
    const types = (symbol, signature, text) => {
      if (!text) return
      for (const span of index.linkType(text, symbol, signature)) link(span.link, span.text, 'type', symbol)
    }
    // What `ApiDoc` renders: the spans `docSpans` gives, and the linked parts of the literal of a reference that resolves nowhere.
    // A fact the site writes from the model links the builtin it names, which is already a destination of its own; only an author's link is a pair to review.
    const builtinHrefs = new Set(Object.values(BUILTINS[port] ?? {}))
    const rendered = (symbol, text, derived = false) => {
      for (const span of index.docSpans(text, symbol)) {
        if (span.kind === 'link') {
          if (!(derived && builtinHrefs.has(span.href))) note(found, span.href, { port, name: span.text, source: 'doc-link', label: span.text })
        }
        else if (span.kind === 'ref' && span.link) link(span.link, span.target, 'doc', symbol, span.role)
        else if (span.kind === 'ref') for (const part of span.parts ?? []) link(part.link, part.text, 'doc', symbol)
      }
    }
    // The Markdown copy of a symbol links its prose through `docSpans` too, so the one pass reads what both renderers link.
    const prose = (symbol, text, form = 'inline', derived = false) => {
      for (const run of proseRuns(text, form)) rendered(symbol, run, derived)
    }
    for (const symbol of model.symbols) {
      for (const { signature, text } of typeInputs(symbol)) types(symbol, signature, text)
      // Every string the site renders as documentation, read as the site reads it.
      for (const { text, form, derived } of proseTexts(symbol)) prose(symbol, text, form, derived)
      for (const related of symbol.command?.relatedLinks ?? []) note(found, related.href, { port, name: related.text, source: 'doc-link', label: related.text })
    }
    // A note on an alternative in this port is shown on the pages of the others, read in this port's index.
    for (const { port: notePort, text } of conceptNotes()) if (notePort === port) rendered(undefined, text)
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
export const urlsIn = (text) => occurrencesIn(text).map((occurrence) => occurrence.url)

/** The words each address is linked with in a text, as `Map<url, Set<label>>`: Markdown links, and `{ title, url }` pairs. */
export function linksIn(text) {
  const labels = new Map()
  for (const { pairs } of [markdownLinks(text), dataLinks(text)]) {
    for (const { label, url } of pairs) labels.set(url, (labels.get(url) ?? new Set()).add(label))
  }
  return labels
}

const portOf = (file, source) => /^port:\s*['"]?([a-z]+)['"]?\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '')?.[1]
  ?? /(?:^|\/)ports\/([^/]+)\//.exec(file)?.[1]

/**
 * The pages the site renders as prose, as the entries the site builds from them: the content tree, the guides it stages
 * from each port's cached artifact (`stage-port-docs --cached`), and the workspace pages every port shares, written once and
 * resolved for each port by the loader. Each is `{ file, path, id, data, body, source }`: the entry's id, front matter and body
 * as the site reads them, where it is written, and the source text as the collector reads it. A file that starts with `_` is not built, except
 * the staged guides, which are, and `meta/` is the site's own credits and licences.
 */
export function proseSources({ root = ROOT, meta = false } = {}) {
  // The parser is the site's own, from this checkout's site package, whichever tree's pages are read.
  const { parseFrontmatter } = createRequire(join(ROOT, 'site', 'package.json'))('@astrojs/markdown-remark')
  const idOf = (file) => file.replace(/\.mdx?$/, '').replace(/\/index$/, '')
  const content = join(root, 'site', 'src', 'content', 'docs')
  const pages = []
  const entry = (file, source) => {
    const { frontmatter, content: body } = parseFrontmatter(source)
    return { file, path: `site/src/content/docs/${file}`, id: idOf(file), data: frontmatter, body, source }
  }
  for (const file of globSync('**/*.{md,mdx}', { cwd: content }).sort()) {
    if (file.startsWith('_') || (!meta && file.startsWith('meta/'))) continue
    pages.push(entry(file, readFileSync(join(content, file), 'utf8')))
  }
  for (const port of SOURCE_GUIDE_PORTS) {
    const artifact = readJson(join(root, 'site', 'src', 'data', 'port-guides', `${port}.json`))
    for (const [file, source] of stagedPortGuides(port, artifact)) pages.push(entry(`_staged/${file}`, source))
  }
  // A page a port writes for itself keeps its id; the shared source fills the ids no page claims.
  const claimed = new Set(pages.map((page) => page.id))
  const shared = join(root, 'site', 'src', 'content', '_workspace-shared')
  for (const file of globSync('**/*.{md,mdx}', { cwd: shared }).sort()) {
    const { frontmatter, content: body } = parseFrontmatter(readFileSync(join(shared, file), 'utf8'))
    for (const port of PORTS_SHARED) {
      const id = `ports/${port}/${idOf(file)}`
      if (claimed.has(id)) continue
      const data = resolvePortData(frontmatter, port, 'workspace')
      const resolved = resolvePortBody(body, port)
      pages.push({ file: `_workspace-shared/${port}/${file}`, path: `site/src/content/_workspace-shared/${file}`, id, data, body: resolved,
        source: `---\nport: ${JSON.stringify(port)}\nproduct: "workspace"\n---\n${resolved}` })
    }
  }
  return pages
}

/** The text before each code span in its paragraph, cell or heading, as the page linker reads a sentence. */
function codeSpans(tree) {
  const found = []
  const phrasing = (node, scope, inLink) => {
    if (node.type === 'inlineCode') {
      if (!inLink) found.push({ text: node.value.trim(), before: scope.text })
      scope.text += node.value
    } else if (node.type === 'text') {
      scope.text += node.value
    } else if (node.type === 'html' || node.type === 'image' || node.type === 'imageReference') {
      // Not prose.
    } else {
      for (const child of node.children ?? []) phrasing(child, scope, inLink || node.type === 'link' || node.type === 'linkReference')
    }
  }
  const walk = (node) => {
    if (node.type === 'code' || node.type === 'html') return
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      const scope = { text: '' }
      for (const child of node.children ?? []) phrasing(child, scope, false)
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return found
}

/**
 * The name a code span claims when it links. A call written with a value (`Optional.of(false)`) names the method and uses it: the
 * value is not a parameter type, so the method is what the link says, and the page it lands on is held to that.
 */
export function claimedName(text) {
  return /\(\s*(?:true|false|null|nil|None|undefined|-?\d[\w.]*|"[^"]*"|'[^']*')\s*[,)]/.test(text) ? text.replace(/\(.*$/s, '') : text
}

/**
 * What prose pins to a name outside the project: every code span the page linker would link, asked of the page
 * linker's own function (`decideMention`) with what the page tells it. A page of a port is read as that port. A
 * page shared by every port is rendered in the build of each, where the port says only where it is read, so
 * it is asked once for each port, saying so, and once for none.
 */
function collectProse(found, { root, models, inventories }) {
  const resolver = new Resolver(Object.values(models))
  for (const inventory of inventories) resolver.addInventory(inventory.project, inventory.baseUrl, inventory.entries, inventory.langs)
  for (const { file, source } of proseSources({ root })) {
    const own = portOf(file, source)
    if (own && !models[own]) continue
    const product = /^product:\s*['"]?(core|workspace|mcp)['"]?\s*$/m.exec(source)?.[1] ?? /^(?:_staged\/)?ports\/[^/]+\/(workspace|mcp)\//.exec(file)?.[1]
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    const spans = codeSpans(fromMarkdown(body))
    for (const { text, before } of spans) {
      if (!looksLikeApiMention(text) || notASymbol(text)) continue
      for (const pagePort of own ? [own] : [undefined, ...Object.keys(models)]) {
        const decision = decideMention(text, { pagePort, product, before, languageSaid: Boolean(own) }, resolver, models)
        if (decision.kind === 'link' && /^https?:\/\//i.test(decision.href)) note(found, decision.href, { port: decision.port, name: claimedName(text), source: 'prose' })
      }
    }
  }
}

/** Hand-written references: Markdown links in pages, guide data and the glossary. */
function collectAuthored(found, { root }) {
  // The pages of the libtmux packages themselves are read by the header verifier, which records the package each is and the
  // ports that publish it. A link to one is held here to that: the port that writes it, and the package it names.
  const owned = new Map(JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'destination-evidence.json'), 'utf8')).destinations
    .map((record) => [record.url, { identity: record.identity, ports: [...new Set((record.entries ?? []).map((entry) => entry.split(':')[0]))] }]))
  // `from` is the port whose page or data wrote the link, when one did: a link that port writes reaches only its own languages' documentation.
  const origin = (from) => (from ? { from } : {})
  const pair = (url, label, where, from) => {
    const package_ = owned.get(normalizeAddress(url))
    note(found, url, { port: '', name: where, source: 'authored', label, ...origin(from), ...(package_ && { package: package_ }) })
  }
  // An address written outside any link has no words to review: it is held as a use that fails until it is written as a link.
  const loose = (url, where, from) => {
    note(found, url, { port: '', name: where, source: 'authored', unmatched: true, ...origin(from) })
  }
  const read = ({ pairs, loose: stray }, where, from) => {
    for (const { label, url } of pairs) pair(url, label, where, from)
    for (const url of stray) loose(url, where, from)
  }
  // The pages the site renders: the content tree, the guides staged from each port's artifact, and the workspace pages filtered for
  // each port. `meta/` is the site's own credits and licences: its links to a language's website are logo, trademark and licence terms
  // (and a zip of a logo), which are not API documentation and have no symbol to name. The links it makes to the pages of libtmux's
  // own packages are read, as they are anywhere.
  for (const { file, path, source: text } of proseSources({ root, meta: true })) {
    const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0] ?? ''
    const links = markdownLinks(text, { front: front.length })
    const ours = (url) => owned.has(normalizeAddress(url))
    read(file.startsWith('meta/') ? { pairs: links.pairs.filter(({ url }) => ours(url)), loose: links.loose.filter(ours) } : links, path, portOf(file, text))
  }
  const walk = (value, where, from) => {
    if (typeof value === 'string') read(markdownLinks(value), where, from)
    else if (Array.isArray(value)) for (const item of value) walk(item, where, from)
    else if (value && typeof value === 'object') for (const item of Object.values(value)) walk(item, where, from)
  }
  for (const file of globSync('site/src/data/port-guides/*.json', { cwd: root }).sort()) walk(readJson(join(root, file)), file, /([a-z]+)\.json$/.exec(file)?.[1])
  for (const file of ['site/src/lib/api-glossary.ts', 'site/src/lib/powershell-common-parameters.ts']) {
    read(dataLinks(readFileSync(join(root, file), 'utf8')), file)
  }
  // Each of PowerShell's common parameters links to its own heading of the page that documents them: the component builds the address
  // from the name a command lists, so the names are read from the commands and the address from the builder it uses.
  const common = new Set()
  for (const symbol of readJson(join(root, 'site', 'src', 'data', 'api', 'powershell.json')).symbols) {
    for (const signature of symbol.signatures ?? []) for (const param of signature.params ?? []) if (param.binding?.common) common.add(param.name)
  }
  for (const name of [...common].sort()) pair(powerShellCommonParameterHref(name), powerShellCommonParameterLabel(name), 'site/src/components/api/ApiCommandParameters.astro', 'powershell')
  // The native glossary builds its addresses with helpers, so it is read as data.
  for (const [port, terms] of Object.entries(NATIVE_API_GLOSSARIES)) {
    for (const [term, definition] of Object.entries(terms)) {
      for (const reference of definition.references) pair(reference.url, reference.title, `glossary ${port} ${term}`, port)
    }
  }
}
