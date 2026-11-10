/**
 * The library symbols a capability's example uses, linked to the API reference.
 *
 * `data/core-apis.json` names candidate symbols per port and capability. A
 * candidate is listed only if the shown program mentions its name and the
 * port's API model has it as a public core symbol, so a renamed or removed
 * symbol, or one the example does not use, fails `apisUsed` and
 * `test/core-apis.test.ts`. The list is ordered by the symbol's first use in
 * the program and holds no standard-library items, because the model holds
 * none.
 */
import DATA from '../data/core-apis.json'
import { API_MODELS, referenceHref } from './api-models.ts'
import { PORT_BY_SLUG, referenceUrl } from './ports.ts'

/** The language each port's examples are written in. */
const LANG: Record<string, string> = { rs: 'rust', go: 'go', ruby: 'ruby', ocaml: 'ocaml', haskell: 'haskell' }

/** Entries shown before "+N more". */
export const MAX_APIS = 10

export const CORE_APIS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = DATA

export interface ApiUsed {
  id: string
  label: string
  href: string
  /** Offset of the first use in the program. */
  at: number
}

export interface ApisUsed {
  shown: ApiUsed[]
  more: number
  moreHref: string
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Languages the examples are written in, and what starts a comment or a string in each. */
const SYNTAX: Record<string, { line?: string; block?: [string, string]; quotes: string[] }> = {
  ocaml: { block: ['(*', '*)'], quotes: ['"'] },
  haskell: { line: '--', block: ['{-', '-}'], quotes: ['"'] },
  rust: { line: '//', block: ['/*', '*/'], quotes: ['"'] },
  go: { line: '//', block: ['/*', '*/'], quotes: ['"', '`', "'"] },
  ruby: { line: '#', quotes: ['"', "'"] },
}

/** The program with its comments and string literals blanked, so a name in either does not count as a use. */
export function withoutLiterals(code: string, lang: string): string {
  const syntax = SYNTAX[lang]
  if (!syntax) throw new Error(`core-apis: no comment and string rules for ${lang}`)
  let out = ''
  for (let i = 0; i < code.length;) {
    const rest = code.slice(i)
    const blank = (length: number) => { out += code.slice(i, i + length).replace(/[^\n]/g, ' '); i += length }
    if (syntax.line && rest.startsWith(syntax.line)) {
      const end = rest.indexOf('\n')
      blank(end < 0 ? rest.length : end)
    } else if (syntax.block && rest.startsWith(syntax.block[0])) {
      let end = rest.indexOf(syntax.block[1], syntax.block[0].length)
      if (lang === 'ocaml' || lang === 'haskell') {
        let depth = 1
        let at = syntax.block[0].length
        while (at < rest.length && depth > 0) {
          if (rest.startsWith(syntax.block[0], at)) { depth++; at += syntax.block[0].length }
          else if (rest.startsWith(syntax.block[1], at)) { depth--; at += syntax.block[1].length }
          else at++
        }
        end = depth ? -1 : at - syntax.block[1].length
      }
      blank(end < 0 ? rest.length : end + syntax.block[1].length)
    } else if (syntax.quotes.includes(rest[0]!)) {
      const quote = rest[0]!
      let j = 1
      // Ruby runs the code in `#{...}` inside a double-quoted string, so a call there is a use.
      let interpolated = ''
      while (j < rest.length && rest[j] !== quote) {
        if (lang === 'ruby' && quote === '"' && rest.startsWith('#{', j)) {
          let depth = 0
          let k = j + 1
          for (; k < rest.length; k++) {
            if (rest[k] === '{') depth++
            else if (rest[k] === '}' && --depth === 0) break
          }
          interpolated += ' '.repeat(j - interpolated.length) + rest.slice(j + 2, k)
          j = k + 1
        } else j += rest[j] === '\\' && quote !== '`' ? 2 : 1
      }
      const length = Math.min(j + 1, rest.length)
      if (interpolated) { out += (interpolated + ' ').padEnd(length, ' '); i += length } else blank(length)
    } else { out += code[i]; i++ }
  }
  return out
}

const CALLED = new Set(['method', 'function', 'property'])

/** The symbols `ids` name, as the program uses them, in order of first use. */
export function apisUsed(port: string, ids: readonly string[], code: string, version: string, what = port, lang = LANG[port] ?? 'rust'): ApisUsed {
  const info = PORT_BY_SLUG[port]
  const model = API_MODELS[port]
  if (!info || !model) throw new Error(`core-apis: unknown port ${port}`)
  const seen = new Set<string>()
  const found = ids.map((id): ApiUsed => {
    if (seen.has(id)) throw new Error(`core-apis: ${what} lists ${id} twice`)
    seen.add(id)
    const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === id)
    if (!symbol) throw new Error(`core-apis: ${what} names ${id}, which is not in the ${port} API model`)
    if (symbol.apiScope === 'internal' || (symbol.product ?? 'core') !== 'core') throw new Error(`core-apis: ${what} names ${id}, which has no core reference page`)
    // A call is written `.name(` or `Type::name`; a type or constant is written bare. Comments and strings do not count.
    const name = escape(symbol.name)
    const pattern = CALLED.has(symbol.kind) ? `(?:\\.|::|&:)${name}(?![\\w])` : `(?<![\\w])${name}(?![\\w])`
    const at = new RegExp(pattern).exec(withoutLiterals(code, lang))?.index
    if (at === undefined) throw new Error(`core-apis: ${what} names ${id}, but the program never uses ${symbol.name}`)
    const href = referenceHref(port, id, version)
    if (!href) throw new Error(`core-apis: ${what} has no reference page for ${id}`)
    const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
    const separator = port === 'rs' ? '::' : /[#.]/.exec(id.slice(id.lastIndexOf(parent?.name ?? '') + (parent?.name.length ?? 0)))?.[0] ?? '.'
    return { id, label: parent ? `${parent.name}${separator}${symbol.name}` : symbol.name, href, at }
  }).sort((a, b) => a.at - b.at)
  return { shown: found.slice(0, MAX_APIS), more: Math.max(0, found.length - MAX_APIS), moreHref: referenceUrl(info, version) }
}

/** Part of a call's name or returned type as the Core player prints it, with the reference page of the API it names. */
export interface ApiText { text: string; href?: string }

/** What a recorded program's names resolve against: this build's version on the port's own site, and the program's text, which says which of two same-named APIs it means. */
export interface ApiLinkContext { version?: string; code?: string }

type Symbol = (typeof API_MODELS)[string]['symbols'][number]
// What holds a value rather than names a type: such a symbol never answers to a name in a returned type.
const VALUE_KINDS = new Set(['method', 'function', 'field', 'property', 'attribute', 'constant', 'variable', 'parameter'])
const indexes = new Map<string, { symbols: Symbol[]; byId: Map<string, Symbol> }>()
function indexOf(port: string) {
  const model = API_MODELS[port]
  if (!model) return undefined
  if (!indexes.has(port)) indexes.set(port, {
    symbols: model.symbols.filter((symbol) => symbol.apiScope !== 'internal' && (symbol.product ?? 'core') === 'core'),
    byId: new Map(model.symbols.map((symbol) => [symbol.id, symbol])),
  })
  return indexes.get(port)!
}
// A name as a program writes it: no Swift argument labels, no Elixir arity.
const bare = (name: string) => name.replace(/\(.*$/s, '').replace(/\/\d+$/, '')
const lastSegment = (name: string) => name.split(/::|[.:]/).at(-1) ?? name
// The namespace words of a symbol's public id, such as LibTmux, Async and Server for LibTmux::Async::Server#start.
const words = (symbol: Symbol) => (symbol.publicId ?? symbol.id).replace(/\(.*$/s, '').split(/::|[.#:/]/).filter((word) => word !== '' && !/^\d+$/.test(word))

/**
 * One page for the symbols a name could mean, or none. Overloads of one
 * function (Swift argument labels, Elixir arities, Julia methods) are one
 * name, so the first is its page. Of a type or call a library defines twice,
 * such as Ruby's LibTmux::Server and LibTmux::Async::Server or Scala's plain
 * and Cats APIs, the program means the one whose extra namespace it writes,
 * else the one with none. A name still left with two meanings is text.
 */
function pick(found: readonly Symbol[], code: string | undefined): Symbol | undefined {
  // Overloads share a public id but for their argument labels or arity.
  const family = (symbols: readonly Symbol[]) => symbols.length > 0 && symbols.every((symbol) => words(symbol).join('.') === words(symbols[0]!).join('.')) ? symbols[0] : undefined
  if (found.length === 0) return undefined
  const one = family(found)
  if (one) return one
  const shared = found.map(words).reduce((common, list) => common.filter((word) => list.includes(word)))
  const extra = (symbol: Symbol) => words(symbol).filter((word) => !shared.includes(word))
  const written = new Set(code?.match(/[A-Za-z_]\w*/g) ?? [])
  const named = found.filter((symbol) => extra(symbol).length > 0 && extra(symbol).every((word) => written.has(word)))
  return family(named) ?? family(found.filter((symbol) => extra(symbol).length === 0))
}

// The models a port's programs call into: its own, then the library it wraps or depends on, such as F#'s and PowerShell's .NET LibTmux.
const modelsOf = (port: string) => [port, ...(PORT_BY_SLUG[port]?.parentLibrary ? [PORT_BY_SLUG[port]!.parentLibrary!.slug] : []), ...(PORT_BY_SLUG[port]?.apiDependencies ?? [])]

function resolve(port: string, context: ApiLinkContext, find: (index: NonNullable<ReturnType<typeof indexOf>>) => Symbol[]): string | undefined {
  for (const model of modelsOf(port)) {
    const index = indexOf(model)
    const found = index ? find(index) : []
    if (found.length === 0) continue
    const symbol = pick(found, context.code)
    return symbol ? referenceHref(model, symbol.publicId ?? symbol.id, model === port ? context.version : undefined) : undefined
  }
  return undefined
}

const typeNamed = (index: NonNullable<ReturnType<typeof indexOf>>, name: string) => index.symbols.filter((symbol) => !VALUE_KINDS.has(symbol.kind) && bare(symbol.name) === name)

/**
 * The reference page of the call a player step names, such as
 * `Server.new_session`, `Pane:split`, `Pane#send_keys`, `tmux.NewServer` or a
 * bare `new_window`, when the port's models hold one API by that name. An
 * index into a value, such as Julia's `Snapshot[PaneRef]`, is that type's page.
 */
export function callHref(port: string, label: string, context: ApiLinkContext = {}): string | undefined {
  const indexed = /^(\w+)\[.+\]$/.exec(label)
  if (indexed) return resolve(port, context, (index) => typeNamed(index, indexed[1]!))
  // A Swift label can carry the argument labels or type of the overload it called: `windows(of:)`, `select(Pane)`.
  const signature = /\(.*\)$/s.exec(label)?.[0] ?? ''
  const parts = label.slice(0, label.length - signature.length).split(/::|[.#:]/)
  const name = parts.at(-1)!
  const owner = parts.length > 1 ? parts.at(-2)! : undefined
  // A package function is written with its package, which is no parent: Go's tmux.NewServer.
  const qualified = owner ? new RegExp(`(?:^|[.:#/])${escape(owner)}[.:#]${escape(name)}(?:$|[(/])`) : undefined
  return resolve(port, context, (index) => {
    const found = index.symbols.filter((symbol) => {
      if (bare(symbol.name) !== name) return false
      const parent = symbol.parent ? index.byId.get(symbol.parent) : undefined
      // A bare name is a top-level function, or one a module exports, such as PowerShell's New-TmuxServer.
      if (owner === undefined) return parent === undefined || parent.kind === 'module'
      return parent !== undefined ? parent.name === owner || lastSegment(parent.name) === owner : qualified!.test(symbol.publicId ?? symbol.id)
    })
    const exact = found.filter((symbol) => symbol.name === name + signature)
    return exact.length > 0 ? exact : found
  })
}

/** A returned type as text, each name in it that is one type of the port's models linked to its page; `expected`, `Result<T, E>`'s `Result` and the like stay text unless the library defines them. */
export function typeText(port: string, type: string, context: ApiLinkContext = {}): ApiText[] {
  return type.split(/([A-Za-z_]\w*)/).filter((text) => text !== '').map((text) => {
    const href = /^[A-Za-z_]/.test(text) ? resolve(port, context, (index) => typeNamed(index, text)) : undefined
    return href ? { text, href } : { text }
  })
}
