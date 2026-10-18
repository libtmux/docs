import { util } from 'prettier'
import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

/** One whitespace-free fragment, or a quoted literal whose content is opaque. */
interface Token { kind: 'run' | 'literal'; text: string; start: number; end: number; space: boolean }
interface Bracket {
  kind: 'bracket'; open: string; close: string; space: boolean
  /** Attached to a name, index base or earlier bracket: `f(x)`, `T{A}`, `(f)(x)`. */
  call: boolean
  /** A macro call keeps its arguments exactly; a trailing comma would change them. */
  macro: boolean
  /** The list opens with `;`, as in a keyword-only call `f(; a, b)`. */
  leading: boolean
  items: Piece[][]
  /** The separator after each item except the last. */
  separators: string[]
  /** Whether the source spaced the leading `;`, then each separator, from what follows. */
  spaced: boolean[]
  /** A separator typed before the closing bracket stays where the author put it. */
  trailing?: string
}
type Piece = Token | Bracket
interface Placed { text: string; column: number }

const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const identifierChar = /[\p{L}\p{N}\p{M}\p{Pc}!]/u
const operatorRun = /^[\p{S}\p{P}]+$/u
const prefixKeyword = /^(?:baremodule|begin|break|const|continue|do|export|for|function|global|if|import|let|local|macro|module|quote|return|struct|try|using|while|catch|finally|else|elseif)$/
const characterLiteral = /^'(?:\\(?:[0-7]{1,3}|[xuU][0-9a-fA-F]+|.)|[^'\\])'/u
const INDENT = 4
const layouts = new Map<string, Promise<CodeLayout>>()

/** Source headers keep every token; the documentation surface owns whitespace. */
export function juliaSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

/** A quote after an identifier is a string-macro prefix, which never interpolates. */
function quoteEnd(source: string, start: number): number {
  const interpolate = !(start > 0 && identifierChar.test(source[start - 1]!))
  const delimiter = source[start] === '"' && source.startsWith('"""', start) ? '"""' : source[start]!
  for (let i = start + delimiter.length; i < source.length; i++) {
    if (source[i] === '\\') i++
    else if (source.startsWith(delimiter, i)) return i + delimiter.length
    else if (interpolate && source.startsWith('$(', i)) {
      const end = interpolationEnd(source, i + 1)
      if (end === -1) return -1
      i = end - 1
    }
  }
  return -1
}

function interpolationEnd(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const char = source[i]!
    if (char === '(') depth++
    else if (char === ')' && --depth === 0) return i + 1
    else if (char === '"' || char === '`') {
      const end = quoteEnd(source, i)
      if (end === -1) return -1
      i = end - 1
    } else if (char === "'" && !isAdjoint(source, i)) {
      const literal = characterLiteral.exec(source.slice(i))
      if (literal) i += literal[0].length - 1
    }
  }
  return -1
}

/** A postfix adjoint follows an operand; a character literal follows an operator or keyword. */
function isAdjoint(source: string, at: number): boolean {
  const word = /[\p{L}\p{N}\p{M}\p{Pc}!]+$/u.exec(source.slice(0, at))?.[0]
  return Boolean(word && !prefixKeyword.test(word)) || /[)\]}'"`.]$/.test(source.slice(0, at))
}

/** Split a header into tokens and bracket groups. Nothing outside a literal may be a comment. */
function parse(source: string): Piece[] {
  let at = 0
  const fail = (): never => { throw new Error(`Invalid Julia callable header grammar: ${source}`) }
  const startsCharacter = (): boolean => source[at] === "'" && !isAdjoint(source, at) && characterLiteral.test(source.slice(at))
  const list = (close?: string): Pick<Bracket, 'leading' | 'items' | 'separators' | 'spaced' | 'trailing'> => {
    const items: Piece[][] = [[]]
    const separators: string[] = []
    const spaced: boolean[] = []
    let space = false
    while (at < source.length) {
      const char = source[at]!
      if (/\s/.test(char)) { space = true; at++; continue }
      if (char === close) break
      if (')]}'.includes(char)) fail()
      const current = items.at(-1)!
      if (close && (char === ',' || char === ';')) {
        separators.push(char); items.push([]); spaced.push(/\s/.test(source[at + 1] ?? '')); space = false; at++
        continue
      }
      if (char in closers) {
        const previous = current.at(-1)
        at++
        const inner = list(closers[char])
        if (source[at] !== closers[char]) fail()
        at++
        const call = Boolean(previous && !space && (previous.kind === 'bracket' || (previous.kind === 'run' && (
          identifierChar.test(previous.text.at(-1)!) || operatorRun.test(previous.text)))))
        const macro = call && char === '(' && previous?.kind === 'run' && /(?:^|\.)@[\p{L}_][\p{L}\p{N}_!]*$/u.test(previous.text)
        current.push({ kind: 'bracket', open: char, close: closers[char]!, space, call, macro, ...inner })
        space = false
        continue
      }
      const start = at
      if (char === '"' || char === '`' || startsCharacter()) {
        const end = char === "'" ? at + characterLiteral.exec(source.slice(at))![0].length : quoteEnd(source, at)
        if (end === -1) fail()
        at = end
        current.push({ kind: 'literal', text: source.slice(start, at), start, end: at, space })
        space = false
        continue
      }
      if (char === '#') throw new Error(`Unsupported Julia comment in callable header: ${source}`)
      while (at < source.length && !/[\s()[\]{}"`#]/.test(source[at]!) && !startsCharacter() &&
        !(close && (source[at] === ',' || source[at] === ';'))) at++
      current.push({ kind: 'run', text: source.slice(start, at), start, end: at, space })
      space = false
    }
    // A leading `;` and a trailing separator belong to the brackets, not to an item.
    const leading = items.length > 1 && !items[0]!.length && separators[0] === ';'
    if (leading) { items.shift(); separators.shift() }
    const trailing = items.length > 1 && !items.at(-1)!.length ? separators.pop() : undefined
    if (trailing) { items.pop(); spaced.pop() }
    if (items.length === 1 && !items[0]!.length) items.pop()
    if (items.some((item) => !item.length)) fail()
    return { leading, items, separators, spaced, trailing }
  }
  const top = list()
  if (at < source.length || top.items.length !== 1) fail()
  return top.items[0]!
}

const width = (text: string): number => util.getStringWidth(text)
const lastRow = (text: string): string => text.slice(text.lastIndexOf('\n') + 1)

function flatBracket(bracket: Bracket): string {
  const { leading, items, separators, spaced } = bracket
  const offset = leading ? 1 : 0
  return bracket.open + (leading ? `;${spaced[0] ? ' ' : ''}` : '') + items.map((item, i) =>
    flatSequence(item) + (i < separators.length ? separators[i] + (spaced[i + offset] ? ' ' : '') : '')).join('') +
    (bracket.trailing ?? '') + bracket.close
}

function flatSequence(pieces: Piece[]): string {
  return pieces.map((piece, i) => (i && piece.space ? ' ' : '') + (piece.kind === 'bracket' ? flatBracket(piece) : piece.text)).join('')
}

/** An empty list has nothing to put on its own lines. */
const breakable = (piece: Piece): piece is Bracket => piece.kind === 'bracket' && (piece.items.length > 0 || piece.leading)

/**
 * JuliaFormatter nests the argument list of the final call before anything else
 * on the line, then the leftmost remaining bracket.
 */
function chooseBracket(pieces: Piece[]): Bracket | undefined {
  const brackets = pieces.filter(breakable)
  return brackets.findLast((bracket) => bracket.open === '(' && bracket.call) ?? brackets[0]
}

/** Place a piece sequence at `column`, leaving `tail` columns for what must follow it. */
function place(pieces: Piece[], indent: number, column: number, tail: number): Placed {
  const flat = flatSequence(pieces)
  if (!flat.includes('\n') && column + width(flat) + tail <= CODE_COLUMNS.api) return { text: flat, column: column + width(flat) }
  const target = chooseBracket(pieces)
  if (!target) return { text: flat, column: flat.includes('\n') ? width(lastRow(flat)) : column + width(flat) }
  const at = pieces.indexOf(target)
  const before = pieces.slice(0, at)
  const after = pieces.slice(at + 1)
  const opener = `${at && target.space ? ' ' : ''}${target.open}${target.leading ? ';' : ''}`
  const prefix = flatSequence(before)
  // The text before the bracket shares its first row; nest that text when it cannot fit.
  const head: Placed = before.length && column + width(prefix + opener) > CODE_COLUMNS.api
    ? place(before, indent, column, width(opener)) : { text: prefix, column: column + width(prefix) }
  const inner = indent + INDENT
  const comma = !target.macro && (target.call || target.open !== '(' || target.separators.includes(','))
  const rows = target.items.map((item, i) => {
    const separator = i < target.separators.length ? target.separators[i]! : target.trailing ?? (comma ? ',' : '')
    return ' '.repeat(inner) + place(item, inner, inner, width(separator)).text + separator
  })
  const gap = after[0]?.space ? ' ' : ''
  const closed = indent + width(target.close) + width(gap)
  const rest = after.length ? place(after, indent, closed, tail) : { text: '', column: closed }
  return {
    text: `${head.text}${opener}\n${rows.join('\n')}\n${' '.repeat(indent)}${target.close}${gap}${rest.text}`,
    column: rest.column,
  }
}

/** Only layout-owned whitespace and list separators may differ from the source. */
function fingerprint(text: string): string {
  return text.replace(/\s/g, '').replace(/,(?=[)\]}])/g, '')
}

/** Only the declared name is a grammar role; other roles resolve from the text, as before layout. */
function syntaxRanges(text: string, symbol: ApiSymbol): CodeSyntax[] {
  const callee = parse(text)[0]
  return callee?.kind === 'run' && (callee.text === symbol.name || callee.text.endsWith(`.${symbol.name}`))
    ? [{ start: callee.end - symbol.name.length, end: callee.end, kind: 'name' }] : []
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const raw = signature.raw!.trim()
  const text = place(parse(raw), 0, 0, 0).text
  if (fingerprint(text) !== fingerprint(raw)) throw new Error(`Formatting changed Julia callable header tokens: ${raw}`)
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), syntax: syntaxRanges(text, symbol) }
}
