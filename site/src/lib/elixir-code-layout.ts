import { ELIXIR_DECLARATION_COLUMNS, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

/**
 * Elixir declarations arrive laid out.
 *
 * The exporter formats every head, `@spec`, `@type` and `@callback` with the
 * language's own formatter at the reference's width, so there is one Elixir
 * layout and the language defines it. This module reads that layout instead of
 * redoing it: it checks the declaration fits, and records where names,
 * parameters, attributes and atoms sit so that the renderer links types and
 * leaves values alone.
 */

const ATTRIBUTE = /@(?:spec|type|opaque|callback|macrocallback)\b/g
const ATOM = /(?<![:\w]):(?:[A-Za-z_]\w*[!?]?|"(?:\\.|[^"\\])*")/g
const KEY = /(?<![\w.:])[a-z_]\w*[!?]?(?=:(?!:))/g
const STRING = /"(?:\\.|[^"\\])*"/g
const WHEN = /\bwhen\b/g

const layouts = new Map<string, Promise<CodeLayout>>()

/** The arguments of the first call in `head`, as the offsets of each argument's first character. */
function argumentStarts(head: string): number[] {
  const open = head.indexOf('(')
  if (open < 0) return []
  const starts: number[] = []
  let depth = 0
  let at = open + 1
  for (let i = open; i < head.length; i++) {
    const char = head[i]!
    if ('([{'.includes(char)) { depth++; continue }
    if (')]}'.includes(char)) {
      depth--
      if (depth === 0) {
        if (/\S/.test(head.slice(at, i))) starts.push(at)
        break
      }
      continue
    }
    if (char === ',' && depth === 1) {
      starts.push(at)
      at = i + 1
    }
  }
  return starts
}

export function elixirSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = layOut(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

async function layOut(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const text = signature.raw!.trim()
  if (CODE_COLUMNS.api !== ELIXIR_DECLARATION_COLUMNS) {
    throw new Error(`Elixir declarations are formatted for ${String(ELIXIR_DECLARATION_COLUMNS)} columns; the reference budget is ${String(CODE_COLUMNS.api)}`)
  }
  const syntax: CodeSyntax[] = []
  const claimed = (start: number, end: number) => syntax.some((range) => range.start < end && range.end > start)
  const add = (start: number, end: number, kind: 'name' | 'literal' | 'keyword') => {
    if (!claimed(start, end)) syntax.push({ start, end, kind })
  }
  for (const match of text.matchAll(ATTRIBUTE)) add(match.index, match.index + match[0].length, 'keyword')
  for (const match of text.matchAll(WHEN)) add(match.index, match.index + match[0].length, 'keyword')
  for (const match of text.matchAll(STRING)) add(match.index, match.index + match[0].length, 'literal')
  for (const match of text.matchAll(ATOM)) add(match.index, match.index + match[0].length, 'literal')
  for (const match of text.matchAll(KEY)) add(match.index, match.index + match[0].length, 'literal')

  // The declared name opens a line, after the attribute on a spec or type.
  const bare = symbol.name.replace(/\/\d+$/, '')
  const declared = new RegExp(String.raw`(?:^|\n)[ \t]*(?:@\w+[ \t]+)?(${bare.replace(/[!?]/g, '\\$&')})(?=\s*[(\s:]|$)`, 'g')
  for (const match of text.matchAll(declared)) add(match.index + match[0].length - match[1]!.length, match.index + match[0].length, 'name')

  // The parameters are named once, in the head that precedes the first attribute.
  const headEnd = text.search(/@\w+/)
  const head = headEnd < 0 ? text : text.slice(0, headEnd)
  if (symbol.kind !== 'typealias' && !text.startsWith('@')) {
    argumentStarts(head).forEach((start, parameter) => {
      const name = /^\s*([a-z_]\w*)/.exec(head.slice(start))
      const declaredParameter = signature.params[parameter]
      if (!name || declaredParameter?.name !== name[1]) return
      const from = start + name[0].length - name[1]!.length
      if (!claimed(from, from + name[1]!.length)) syntax.push({ start: from, end: from + name[1]!.length, kind: 'parameter', parameter })
    })
  }
  syntax.sort((a, b) => a.start - b.start)
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), syntax }
}
