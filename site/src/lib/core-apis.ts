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
const LANG: Record<string, string> = { rs: 'rust', go: 'go', ruby: 'ruby' }

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
const SYNTAX: Record<string, { line: string; block?: [string, string]; quotes: string[] }> = {
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
    if (rest.startsWith(syntax.line)) {
      const end = rest.indexOf('\n')
      blank(end < 0 ? rest.length : end)
    } else if (syntax.block && rest.startsWith(syntax.block[0])) {
      const end = rest.indexOf(syntax.block[1], syntax.block[0].length)
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
