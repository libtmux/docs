/**
 * What a documentation page says it is.
 *
 * Every host declares the identity of the thing a page documents in its own
 * markup, and says it more exactly than the address or a word in a title can:
 * rustdoc's title and heading ("Error in std::io", "Struct Error"), javadoc's
 * package line, "Class Process" and the signature a member's anchor spells,
 * Dokka's breadcrumbs and declaration keyword, Scaladoc's qualified name and
 * kind, cppreference's heading and declaration, ExDoc's module and the
 * `c:`/`t:`/`name/arity` anchor, fsdocs' "Type" or "Module", Learn's name,
 * generic arity and namespace, CPython's role, pkg.go.dev's full import path,
 * Documenter's category, and DocC's symbol kind.
 *
 * `pageIdentity` reads it. `judge` compares it with what the source says the
 * link is for (`api-sources.mjs`): the same kind, owner, name, and operand count
 * or parameter list where the source writes one. Two things that share a name
 * and differ in anything else are different symbols.
 */

import { sourceIdentity, BARE_OWNERS, DEFAULT_SCOPES, GO_PACKAGES } from './api-sources.mjs'
import { compact, decode, mentions, splitTop, stripGroups, strip, safeDecode } from './api-html.mjs'
import { splitUrl } from './api-addresses.mjs'

/** The buckets a declared kind falls in; a source and a page agree when theirs do. */
const BUCKETS = new Map(Object.entries({
  class: 'type', interface: 'type', struct: 'type', enum: 'type', trait: 'type', union: 'type', record: 'type', typealias: 'type', type: 'type',
  'type alias': 'type', 'primitive type': 'type', 'foreign type': 'type', protocol: 'type', annotation: 'type', 'annotation interface': 'type', delegate: 'type',
  'enum class': 'type', 'record class': 'type', concept: 'type', abbreviation: 'type', behaviour: 'module', exception: 'type', trait_alias: 'type', 'associated type': 'type',
  object: 'object', 'companion object': 'object',
  module: 'module', namespace: 'module', package: 'module', crate: 'module',
  function: 'member', method: 'member', property: 'member', field: 'member', constant: 'member', variable: 'member', macro: 'member', constructor: 'member',
  event: 'member', operator: 'member', value: 'member', static: 'member', 'enum constant': 'member', variant: 'member', cmdlet: 'member', member: 'member',
  callback: 'callback', macrocallback: 'callback',
  keyword: 'keyword', topic: 'topic',
}))
const bucket = (declared) => BUCKETS.get(String(declared).toLowerCase()) ?? 'other'

/** What a source of each kind accepts a page to be. Fundamental types are keywords on cppreference. */
const ACCEPTS = { type: ['type', 'keyword'], object: ['object'], module: ['module'], member: ['member'], callback: ['callback'], keyword: ['keyword', 'type'], qualified: ['type', 'member', 'module'] }

const generics = (text) => {
  const group = stripGroups(text, '<', '>')
  return { name: group.text.trim(), arity: group.first === undefined ? 0 : splitTop(group.first).length }
}
const dotted = (text) => text.split('.').filter(Boolean)

function rustdoc(url, page, fragment) {
  const title = page.title.replace(/\s*-\s*Rust$/, '')
  const h1 = page.headings.find((heading) => heading.level === 1)?.text ?? ''
  const declared = ['Primitive Type', 'Type Alias', 'Attribute Macro', 'Derive Macro', 'Foreign Type', 'Struct', 'Enum', 'Trait', 'Union', 'Function', 'Macro', 'Constant', 'Static', 'Module', 'Keyword', 'Crate']
    .find((word) => h1.startsWith(word))
  if (!declared) return undefined
  const inside = /^(.+?) in (.+)$/.exec(title)
  const path = inside ? [...inside[2].split('::'), inside[1]] : title.split('::')
  const base = { via: 'rustdoc', declared: declared.toLowerCase(), kind: bucket(declared), path, title }
  if (!fragment) return base
  const member = /^(method|tymethod|variant|structfield|associatedtype|associatedconstant|constant|static)\.(.+)$/.exec(fragment)
  if (!member) return { ...base, declared: 'fragment', kind: 'other' }
  const kind = member[1] === 'associatedtype' ? 'type' : 'member'
  return { ...base, declared: member[1], kind, path: [...path, member[2]] }
}

function javadoc(url, page, fragment) {
  const html = page.html
  const pkg = /package-label-in-type[^>]*>Package<\/span>(?:&nbsp;|\s)*<a[^>]*>([^<]+)<\/a>/.exec(html)?.[1]
  const h1 = page.headings.find((heading) => heading.level === 1)?.text ?? ''
  const head = /^(Annotation Interface|Enum Class|Record Class|Interface|Class|Enum|Record|Exception|Error)\s+(.+)$/.exec(h1)
  if (!pkg || !head) return undefined
  const named = generics(head[2])
  const path = [...pkg.split('.'), ...dotted(named.name)]
  const base = { via: 'javadoc', declared: head[1].toLowerCase(), kind: bucket(head[1]), path, arity: named.arity, title: h1 }
  if (!fragment) return base
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  if (!anchor) return { ...base, declared: 'fragment', kind: 'other' }
  const section = [...html.slice(0, anchor.at).matchAll(/id="(constructor|method|field|enum-constant|annotation-interface-element)-detail"/g)].at(-1)?.[1] ?? 'method'
  const call = /^([^(]+)\((.*)\)$/.exec(fragment)
  const name = call ? call[1] : fragment
  const params = call ? splitTop(call[2]).map((type) => generics(type).name.split('.').at(-1)) : undefined
  return {
    ...base, declared: section, kind: 'member', path: [...path, section === 'constructor' ? path.at(-1) : name], ...(params && { params }),
  }
}

function scaladoc(url, page, fragment) {
  const html = page.html
  let fq = /class="fqname[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/.exec(html)?.[1]
  let kind = /<span class="kind"><span t="k">([^<]+)<\/span>/.exec(html)?.[1]?.trim()
  if (!fq) {
    // Scaladoc 2: the owner package is a paragraph of links, the name a heading, the kind a span in the signature.
    const definition = /<div id="definition">([\s\S]*?)<h4 id="signature"/.exec(html)?.[1]
    const owner = definition && strip(/<p id="owner">([\s\S]*?)<\/p>/.exec(definition)?.[1] ?? '').replace(/\s*\.\s*/g, '.')
    const name = definition && strip(/<h1>([\s\S]*?)<span class="permalink"/.exec(definition)?.[1] ?? '')
    kind = /<h4 id="signature"[\s\S]*?<span class="kind">([^<]+)<\/span>/.exec(html)?.[1]?.trim()
    if (!name || !kind) return undefined
    fq = owner ? `${owner}.${name}` : name
  }
  if (!fq || !kind) return undefined
  const path = fq.split('.')
  const base = { via: 'scaladoc', declared: kind, kind: kind === 'object' ? 'object' : bucket(['class', 'trait', 'enum', 'type', 'given'].includes(kind) ? 'class' : kind), path, title: page.title }
  if (!fragment) return base
  const name = fragment.replace(/-[0-9a-f]{8}$/, '').replace(/[:(].*$/, '')
  return { ...base, declared: 'member', kind: 'member', path: [...path, name] }
}

function dokka(url, page) {
  const crumbs = /<div class="breadcrumbs">([\s\S]*?)<\/div>/.exec(page.html)?.[1]
  if (!crumbs) return undefined
  const parts = [...crumbs.matchAll(/<(?:a|span)\b[^>]*>([^<]+)<\/(?:a|span)>/g)].map((match) => match[1].trim()).filter((part) => part && part !== '/')
  if (parts.length < 2) return undefined
  const path = [...parts[1].split('.'), ...parts.slice(2)]
  // The declaration is the first signature block; annotations before it sit in blocks of their own.
  let block = /<div class="symbol monospace">([\s\S]{0,4000})/.exec(page.html)?.[1] ?? ''
  for (let before = ''; before !== block;) {
    before = block
    block = block.replace(/<div class="block">(?:(?!<div)[\s\S])*?<\/div>/g, '')
  }
  block = block.slice(0, block.indexOf('</div>') < 0 ? undefined : block.indexOf('</div>'))
  const keywords = [...block.matchAll(/<span class="token keyword">([^<]+)<\/span>/g)].map((match) => match[1].trim())
  let declared = 'module'
  if (keywords.includes('fun')) declared = 'function'
  else if (keywords.includes('val') || keywords.includes('var')) declared = 'property'
  else if (keywords.includes('typealias')) declared = 'typealias'
  else if (keywords.includes('interface')) declared = 'interface'
  else if (keywords.includes('object')) declared = 'object'
  else if (keywords.includes('class')) declared = 'class'
  return { via: 'dokka', declared, kind: bucket(declared), path: parts.length === 2 ? [parts[1]] : path, title: page.title }
}

/** A declaration without its `template<...>` head. */
function withoutTemplate(text) {
  const head = /^template\s*</.exec(text)
  if (!head) return text
  let depth = 0
  for (let at = head[0].length - 1; at < text.length; at += 1) {
    if (text[at] === '<') depth += 1
    if (text[at] === '>') {
      depth -= 1
      if (depth === 0) return text.slice(at + 1).trim()
    }
  }
  return text
}

/** The declaration rows a cppreference page opens with, as text. */
function declarations(html) {
  return [...html.matchAll(/<tr class="t-dcl[^"]*">([\s\S]*?)<\/tr>/g)].map((row) => strip(row[1])).filter(Boolean)
}

function cppreference(url, page) {
  const title = page.title.replace(/\s*-\s*cppreference\.com$/, '')
  const keyword = /^C\+\+ keyword:\s*(.+)$/.exec(title)
  if (keyword) return { via: 'cppreference', declared: 'keyword', kind: 'keyword', path: [keyword[1].trim()], title }
  const entries = splitTop(title).map((entry) => generics(entry).name)
  const first = entries[0]
  if (!first || !first.includes('::')) return { via: 'cppreference', declared: 'topic', kind: 'topic', path: [], title }
  // What the first declaration is: the page's subject. A `template<...>` head and leading specifiers are not it.
  const declaration = withoutTemplate(declarations(page.html)[0] ?? '').replace(/^(?:(?:constexpr|inline|static|explicit|consteval|constinit|extern)\s+)+/, '')
  let declared = 'function'
  if (/^(?:class|struct|union|enum(?: class| struct)?)\s+\w+/.test(declaration)) declared = 'class'
  else if (/^concept\s+\w+/.test(declaration)) declared = 'concept'
  else if (/^(?:using\s+\w+\s*=|typedef\b)/.test(declaration)) declared = 'type'
  else if (!declaration) declared = 'topic'
  else if (!/\(/.test(declaration.split(/[;=]/)[0])) declared = 'constant'
  return { via: 'cppreference', declared, kind: bucket(declared), path: entries[0].split('::'), alternatives: entries.slice(1).map((entry) => entry.split('::')), title }
}

function exdoc(url, page, fragment) {
  const h1 = /<h1>\s*<span translate="no">([^<]+)<\/span>\s*(?:<small[^>]*>([^<]*)<\/small>)?/.exec(page.html)
  if (!h1) return undefined
  const path = h1[1].trim().split('.')
  // The small text is the package version, or `behaviour`, `protocol`, `exception` and the like.
  const word = (h1[2] ?? '').trim()
  const base = { via: 'exdoc', declared: word && !word.startsWith('(') ? word : 'module', kind: 'module', path, title: page.title }
  if (!fragment) return base
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const entry = /^(?:[tc]:)?(.+?)(?:\/(\d+))?$/.exec(fragment)
  const label = anchor && /aria-label="Link to this (\w+)"/.exec(page.html.slice(anchor.at, anchor.at + 800))?.[1]
  if (!anchor || !entry || !label) return { ...base, declared: 'fragment', kind: 'other' }
  return {
    ...base, declared: label, kind: bucket(label), path: [...path, entry[1]], ...(entry[2] !== undefined && { arity: Number(entry[2]) }),
  }
}

function fsdocs(url, page, fragment) {
  // The heading writes its type parameters bare (`Result<'T, 'TError> Type`), so it is text, not markup.
  const heading = decode(/<h2 id="[^"]*" data-fsdocs-heading="1">([\s\S]*?)<\/h2>/.exec(page.html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const ns = /Namespace:\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/.exec(page.html)?.[1]
  if (!heading || !ns) return undefined
  const word = /\s(Type|Module|Record|Union|Interface|Class|Struct|Enum|Delegate)$/.exec(heading)?.[1]
  if (!word) return undefined
  const text = heading.slice(0, -word.length - 1).trim()
  const vars = [...text.matchAll(/'[A-Za-z_]\w*/g)].length
  const name = generics(text.replace(/'[A-Za-z_]\w*\s*/g, ' ').trim()).name.trim()
  const path = [...ns.split('.'), name]
  const declared = word === 'Module' ? 'module' : 'type'
  const base = { via: 'fsdocs', declared: word.toLowerCase(), kind: declared, path, arity: vars || generics(text).arity, title: page.title }
  return fragment ? { ...base, declared: 'member', kind: 'member', path: [...path, fragment], arity: undefined } : base
}

function learn(url, page, fragment) {
  const { pathname } = new URL(splitUrl(url).page)
  const lower = pathname.toLowerCase()
  const h1 = page.headings.find((heading) => heading.level === 1)?.text ?? ''
  if (lower.includes('/powershell/module/')) {
    const parts = pathname.split('/').filter(Boolean)
    const at = parts.findIndex((part) => part.toLowerCase() === 'module')
    const module = parts[at + 1]?.split('.') ?? []
    // An about topic documents one language concept by name, as a keyword's page does.
    if (parts.includes('about')) return { via: 'learn', declared: 'about topic', kind: 'keyword', path: [...module, h1.replace(/^about_/i, '')], title: page.title }
    return { via: 'learn', declared: 'cmdlet', kind: 'member', path: [...module, h1.trim()], title: page.title }
  }
  if (!lower.includes('/dotnet/api/')) return undefined
  const ns = /<dt>Namespace:<\/dt>\s*<dd>\s*<span[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(page.html)?.[1]
  const word = /\s(Class|Struct|Interface|Enum|Delegate|Method|Property|Field|Event|Constructor|Operator|Namespace|Record)$/.exec(h1)?.[1]
  if (!word) return undefined
  const named = generics(h1.slice(0, -word.length - 1))
  const path = word === 'Namespace' ? named.name.split('.') : [...(ns?.split('.') ?? []), ...named.name.split('.')]
  const base = { via: 'learn', declared: word.toLowerCase(), kind: bucket(word === 'Namespace' ? 'namespace' : word), path, arity: named.arity, title: page.title }
  if (!fragment) return base
  // A member's anchor is its type's dashed name and then the member; the element it sits on spells the member.
  const dashed = `${path.join('-').toLowerCase()}-`
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const member = anchor && fragment.toLowerCase().startsWith(dashed) ? anchorText(page, anchor).match(/^[A-Za-z_]\w*/)?.[0] : undefined
  return member ? { ...base, declared: 'member', kind: 'member', path: [...path, member], arity: undefined } : { ...base, declared: 'fragment', kind: 'other' }
}

/** The words of the element an anchor sits on. */
function anchorText(page, anchor) {
  const rest = page.html.slice(anchor.at)
  const closes = new RegExp(`^<${anchor.tag}\\b[^>]*>([\\s\\S]*?)</${anchor.tag}>`).exec(rest)
  return closes ? strip(closes[1]) : ''
}

function docfx(url, page, fragment) {
  const h1 = page.headings.find((heading) => heading.level === 1)?.text ?? ''
  const word = /^(Class|Struct|Interface|Enum|Delegate|Namespace|Record)\s+(.+)$/.exec(h1)
  // A nested namespace is a run of links joined by dots.
  const ns = strip(/<dt>Namespace<\/dt><dd>([\s\S]*?)<\/dd>/.exec(page.html)?.[1] ?? '').replace(/\s*\.\s*/g, '.') || undefined
  if (!word) return undefined
  const named = generics(word[2])
  const path = word[1] === 'Namespace' ? named.name.split('.') : [...(ns?.split('.') ?? []), ...named.name.split('.')]
  const base = { via: 'docfx', declared: word[1].toLowerCase(), kind: bucket(word[1] === 'Namespace' ? 'namespace' : word[1]), path, arity: named.arity, title: page.title }
  if (!fragment) return base
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const member = anchor && fragment.startsWith(`${path.join('_')}_`) ? anchorText(page, anchor).match(/^[A-Za-z_]\w*/)?.[0] : undefined
  return member ? { ...base, declared: 'member', kind: 'member', path: [...path, member], arity: undefined } : { ...base, declared: 'fragment', kind: 'other' }
}

function cpython(url, page, fragment) {
  const { pathname } = new URL(splitUrl(url).page)
  if (!fragment) {
    const module = /^([\w.]+)\s+(?:[—-]|&#8212;)/.exec(page.title)?.[1]
    return module && pathname.includes('/library/') ? { via: 'cpython', declared: 'module', kind: 'module', path: module.split('.'), title: page.title } : undefined
  }
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const moduleAnchor = /^module-(.+)$/.exec(fragment)
  if (moduleAnchor) return { via: 'cpython', declared: 'module', kind: 'module', path: moduleAnchor[1].split('.'), title: page.title }
  if (!anchor) return undefined
  // An entry is the `dt` of a `dl.py <role>`; a section, a label or a paragraph that happens to follow one is not.
  const role = anchor.tag === 'dt' ? [...page.html.slice(0, anchor.at).matchAll(/<dl class="[^"]*\bpy (\w+)/g)].at(-1)?.[1] : undefined
  if (!role || !/^[\w.]+$/.test(fragment)) return { via: 'cpython', declared: 'fragment', kind: 'other', path: fragment.split('.'), title: page.title }
  return { via: 'cpython', declared: role, kind: bucket(['classmethod', 'staticmethod', 'decorator'].includes(role) ? 'method' : role === 'attribute' || role === 'data' ? 'variable' : role), path: fragment.split('.'), title: page.title }
}

function godoc(url, page, fragment) {
  const title = /^(.+?) package - (.+?) - Go Packages$/.exec(page.title)
  if (!title) return undefined
  const base = { via: 'godoc', declared: 'package', kind: 'module', path: [title[2]], title: page.title }
  if (!fragment) return base
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const kind = anchor && /data-kind="(\w+)"/.exec(page.html.slice(anchor.at, anchor.at + 200))?.[1]
  if (!kind) return { ...base, declared: 'fragment', kind: 'other' }
  return { ...base, declared: kind, kind: kind === 'type' ? 'type' : 'member', path: [title[2], ...fragment.split('.')] }
}

function documenter(url, page, fragment) {
  if (!fragment) return undefined
  const anchor = page.anchors.find((candidate) => candidate.id === fragment)
  const summary = anchor && new RegExp(`<summary id="${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?docstring-category">([^<]+)<`).exec(page.html)?.[1]
  if (!summary) return { via: 'documenter', declared: 'fragment', kind: 'other', path: [], title: page.title }
  const name = fragment.replace(/-(?:Tuple|Union|Type|Vararg)\b.*$/, '')
  const declared = summary.toLowerCase()
  return { via: 'documenter', declared, kind: declared === 'type' ? 'type' : bucket(declared === 'constant' ? 'constant' : declared), path: name.split('.'), title: page.title }
}

function mdn(url, page) {
  const { pathname } = new URL(splitUrl(url).page)
  const parts = decodeURIComponent(pathname).split('/').filter(Boolean)
  const section = ['Global_Objects', 'API', 'Operators', 'Statements', 'Functions', 'Classes', 'Iteration_protocols'].find((part) => parts.includes(part))
  if (!section) return undefined
  // "Map - JavaScript | MDN", "AbortSignal: timeout() static method - Web APIs | MDN".
  const head = page.title.replace(/\s*\|\s*MDN$/, '').replace(/\s+-\s+[^-]+$/, '').trim()
  const member = /^([\w.]+):\s+([\w$]+)(?:\(\))?\s+(?:static |instance )?(?:method|property|constructor|event|accessor property|data property)$/.exec(head)
  if (member) return { via: 'mdn', declared: 'method', kind: 'member', path: [member[1], member[2]], title: page.title }
  const kind = section === 'Operators' || section === 'Statements' ? 'keyword' : section === 'Iteration_protocols' ? 'topic' : /^[A-Z]/.test(head) ? 'type' : 'member'
  return { via: 'mdn', declared: section === 'Global_Objects' || section === 'API' ? 'object' : section, kind, path: head ? [head] : [], title: page.title }
}

/** DocC's symbol kinds, as its JSON names them. */
const DOCC_KINDS = { struct: 'type', class: 'type', enum: 'type', protocol: 'type', typealias: 'type', associatedtype: 'type', func: 'member', method: 'member', init: 'member', var: 'member', property: 'member', case: 'member', module: 'module' }

/** The identity a DocC document declares. */
export function doccIdentity(url, data) {
  const kind = data?.metadata?.symbolKind
  const path = /\/documentation\/(.+)$/.exec(data?.identifier?.url ?? '')?.[1]?.split('/').map((segment) => segment.replace(/\(.*$/, ''))
  if (!path) return undefined
  return { via: 'docc', declared: kind ?? 'topic', kind: DOCC_KINDS[kind] ?? (kind ? 'other' : 'topic'), path, title: data.metadata?.title ?? '' }
}

/**
 * The identity a page declares, or `undefined` when the host publishes none we
 * read (a handbook, a manual, a wiki): those links stand on the rules of
 * `hold` in the verification module and on reviewed exceptions.
 */
export function pageIdentity(url, page, fragment = splitUrl(url).fragment) {
  const { hostname, pathname } = new URL(splitUrl(url).page)
  const decoded = safeDecode(fragment)
  const parser = parserFor(hostname, pathname, page)
  if (!parser) return undefined
  // A page of a host we read that declares no symbol is a page about something else: a manual, a search, a tutorial.
  return parser(url, page, decoded) ?? { via: 'page', declared: 'page', kind: 'other', path: [], title: page.title }
}

/** The reader for a host's symbol pages, if the host has one. */
function parserFor(hostname, pathname, page) {
  if (hostname === 'doc.rust-lang.org' || hostname === 'docs.rs') return rustdoc
  if (hostname === 'docs.oracle.com' && pathname.includes('/api/')) return javadoc
  if (hostname === 'docs.junit.org') return javadoc
  if (hostname === 'javadoc.io' || hostname === 'www.scala-lang.org' || hostname === 'typelevel.org') return /class="fqname|id="definition"/.test(page.html) ? scaladoc : javadoc
  if (hostname === 'kotlinlang.org' && pathname.includes('/api/')) return dokka
  if (hostname === 'en.cppreference.com') return cppreference
  if (hostname.endsWith('hexdocs.pm')) return exdoc
  if (hostname === 'fsharp.github.io') return fsdocs
  if (hostname === 'csharp.sdk.modelcontextprotocol.io') return docfx
  if (hostname === 'learn.microsoft.com' && /\/(dotnet\/api|powershell\/module)\//i.test(pathname)) return learn
  if (hostname === 'docs.python.org') return cpython
  if (hostname === 'pkg.go.dev') return godoc
  if (hostname === 'docs.julialang.org') return documenter
  if (hostname === 'developer.mozilla.org') return mdn
  return undefined
}

const owner = (path) => path.slice(0, -1).join('.')

/** Simple names of parameter types: `java.util.concurrent.TimeUnit` is `TimeUnit`. */
const simple = (params) => params.map((param) => generics(param.trim().split(/\s+/).at(-1) === param.trim() ? param : param.trim().split(/\s+/).slice(0, -1).join(' ')).name.split('.').at(-1))

/**
 * Whether a name is right for a page, by identity. Returns `undefined` when it
 * is, else `{ failure, detail }` naming the first thing that differs: `symbol`
 * (the name), `owner` (the package, module or type before it), `kind`, `arity`
 * or `params`.
 *
 * @param {ReturnType<typeof sourceIdentity>} source
 * @param {any} identity
 */
export function judge(source, identity) {
  const path = identity.path ?? []
  if (identity.kind === 'other' || identity.kind === 'topic') {
    return { failure: 'kind', detail: `${source.segments.join('.')} names a ${source.kind ?? 'symbol'}, and the page declares ${identity.declared === 'page' ? 'no symbol' : `a ${identity.declared}`}${path.length ? ` (${path.join('.')})` : ''}` }
  }
  const names = [path, ...(identity.alternatives ?? [])]
  const said = `${source.segments.join('.')}`
  const shown = (candidate) => candidate.join(candidate.length > 1 && candidate[0] === 'std' ? '::' : '.')
  // The name itself.
  const candidates = names.filter((candidate) => candidate.at(-1) === source.symbol)
  if (candidates.length === 0) return { failure: 'symbol', detail: `${said} is not what the page documents: it declares ${shown(path)} (${identity.declared})` }
  // The package, module or type before it.
  const qualifier = source.port === 'go' && source.segments.length > 1 ? [GO_PACKAGES[source.segments[0]] ?? source.segments[0], ...source.segments.slice(1, -1)] : source.segments.slice(0, -1)
  let ownerMatch = false
  for (const candidate of candidates) {
    const before = candidate.slice(0, -1)
    if (qualifier.length > 0) {
      if (qualifier.length <= before.length && qualifier.every((segment, index) => segment === before[before.length - qualifier.length + index])) ownerMatch = true
    } else {
      const wanted = BARE_OWNERS[source.port]?.[source.symbol]
      const dots = owner(candidate)
      if (wanted !== undefined ? wanted === dots : (DEFAULT_SCOPES[source.port] ?? []).includes(dots)) ownerMatch = true
      // A member written bare in the docs of a type that is, or extends, its owner.
      else if ((source.owners ?? []).some((hint) => dots === hint || dots.endsWith(`.${hint}`))) ownerMatch = true
    }
  }
  if (!ownerMatch) {
    const where = shown(path.slice(0, -1)) || 'the top level'
    return { failure: 'owner', detail: qualifier.length > 0
      ? `${said} is written under ${shown(qualifier)}, but the page declares ${shown(path)}`
      : `${said} is written bare, and ${where} is not where ${source.port} puts it: ${BARE_OWNERS[source.port]?.[source.symbol] ? `it imports it from ${BARE_OWNERS[source.port][source.symbol]}` : 'no scope in api-sources.mjs names it'}` }
  }
  // What kind of thing it is.
  if (source.kind && identity.kind && !(ACCEPTS[source.kind] ?? [source.kind]).includes(identity.kind)) {
    return { failure: 'kind', detail: `${said} is a ${source.kind}, and the page declares a ${identity.declared} (${identity.kind})` }
  }
  // How many operands, and which parameters.
  if (identity.arity !== undefined && (identity.via === 'learn' || identity.via === 'exdoc' || identity.via === 'fsdocs')) {
    const wanted = source.arity ?? (identity.via === 'learn' ? 0 : undefined)
    if (wanted !== undefined && wanted !== identity.arity) return { failure: 'arity', detail: `${said} takes ${wanted}, and the page declares ${identity.arity}` }
  }
  if (source.params && identity.params) {
    const wanted = simple(source.params)
    if (wanted.length !== identity.params.length || wanted.some((type, index) => type !== identity.params[index])) {
      return { failure: 'params', detail: `${said}(${source.params.join(',')}) is not ${path.at(-1)}(${identity.params.join(',')})` }
    }
  }
  return undefined
}

/**
 * Whether the words a person wrote on a link name what the page documents.
 * The text must say the symbol the page declares, as a whole word of its
 * spelling or the end of its full name: `[strip](#Base.strip)` documents
 * `Base.strip`, and `[strip](#Base.lstrip)` does not.
 *
 * @returns {{ failure: string, detail: string } | undefined}
 */
export function judgeLabel(label, identity) {
  const text = label.replace(/[`*]/g, '').replace(/\(\)/g, '').trim()
  const names = [identity.path, ...(identity.alternatives ?? [])].map((path) => path.at(-1)).filter(Boolean)
    .flatMap((name) => (identity.declared === 'macro' ? [name, `${name}!`] : [name]))
  if (names.some((name) => mentions(text, name))) return undefined
  const compactText = compact(text)
  if (names.some((name) => compactText === compact(name))) return undefined
  return { failure: 'label', detail: `the link says ${JSON.stringify(label)}, and the page documents ${(identity.path ?? []).join('.') || JSON.stringify(identity.title)} (${identity.declared})` }
}

export { sourceIdentity }
