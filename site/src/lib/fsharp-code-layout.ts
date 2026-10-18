import type { Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

/**
 * F# signature headers laid out as Fantomas prints a signature file.
 *
 * The printer follows Fantomas' decisions for the type grammar of a `val` or
 * `member` signature, with the width measured from column zero because the
 * page shows the declaration without its module indentation. A type that fits
 * stays on its line, otherwise it moves under the name, and a function type
 * that still does not fit puts each argument on its own line with a trailing
 * `->` and the result one level deeper. Fantomas measures each fragment by
 * itself, so a closing token can land past the budget; the width check then
 * reports that line like any other. `fsharp-fantomas-signatures.json` pins the
 * agreement with the formatter release it was captured from.
 */

const layouts = new Map<string, Promise<CodeLayout>>()

interface Token { text: string; start: number; end: number; spaced: boolean }

type Type =
  | { kind: 'ident' | 'var'; text: string }
  | { kind: 'app'; name: Type; args: Type[] }
  | { kind: 'postfix'; first: Type; last: Type }
  | { kind: 'array'; element: Type; rank: number }
  | { kind: 'tuple'; items: Type[] }
  | { kind: 'funs'; params: Type[]; returns: Type }
  | { kind: 'paren' | 'flexible'; inner: Type }
  | { kind: 'param'; name: string; token: number; optional: boolean; inner: Type }
  | { kind: 'constrained'; inner: Type; constraints: Constraint[] }
type Constraint = { typar: string; kind: 'single'; text: string } | { typar: string; kind: 'subtype'; type: Type }
interface Declaration { keyword: string; name: string; nameTokens: [number, number]; type: Type; accessors?: string }

const TOKEN = /\s+|(``[^`]+``|[A-Za-z_][A-Za-z0-9_']*|'[A-Za-z_][A-Za-z0-9_]*|->|:>|[:*<>,()[\]?#.|=])/y

function tokenize(raw: string): Token[] {
  if (raw.includes('//') || raw.includes('(*')) throw new Error(`Unsupported F# signature comment: ${raw}`)
  const tokens: Token[] = []
  let spaced = false
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < raw.length) {
    const start = TOKEN.lastIndex
    const match = TOKEN.exec(raw)
    if (!match) throw new Error(`Unsupported F# signature syntax at ${JSON.stringify(raw.slice(start, start + 12))}: ${raw}`)
    if (match[1] === undefined) { spaced = true; continue }
    tokens.push({ text: match[1], start, end: TOKEN.lastIndex, spaced })
    spaced = false
  }
  return tokens
}

/** Parse the forms the F# extractor writes for values and members: `val name: type` and `member name: type`. */
function parseDeclaration(tokens: Token[], raw: string): Declaration {
  let at = 0
  const fail = (): never => { throw new Error(`Unsupported F# signature syntax near ${JSON.stringify(tokens[at]?.text ?? 'the end')}: ${raw}`) }
  const peek = (offset = 0) => tokens[at + offset]?.text
  const take = (text?: string): Token => {
    const token = tokens[at]
    if (!token || (text !== undefined && token.text !== text)) return fail()
    at++
    return token
  }
  const isName = (text?: string) => text !== undefined && /^(?:``[^`]+``|[A-Za-z_][\w']*)$/.test(text)
  const isTypar = (text?: string) => text !== undefined && /^'[A-Za-z_]\w*$/.test(text)
  const longIdent = (): string => {
    let text = take().text
    while (peek() === '.' && isName(peek(1))) text += take().text + take().text
    return text
  }
  const constraints = (): Constraint[] => {
    const found: Constraint[] = []
    do {
      if (!isTypar(peek())) fail()
      const typar = take().text
      if (peek() === ':>') {
        take()
        found.push({ typar, kind: 'subtype', type: postfix() })
        continue
      }
      take(':')
      const words: string[] = []
      while (isName(peek()) && peek() !== 'and') words.push(take().text)
      if (!words.length) fail()
      found.push({ typar, kind: 'single', text: words.join(' ') })
    } while (peek() === 'and' && take())
    return found
  }
  function atom(): Type {
    const text = peek()
    if (text === '(') {
      take()
      const inner = funs()
      take(')')
      return { kind: 'paren', inner }
    }
    if (text === '#') { take(); return { kind: 'flexible', inner: postfix() } }
    if (isTypar(text)) return { kind: 'var', text: take().text }
    if (!isName(text) || text === 'when' || text === 'with') return fail()
    const name: Type = { kind: 'ident', text: longIdent() }
    if (peek() !== '<' || tokens[at]!.spaced) return name
    take('<')
    const args: Type[] = []
    do args.push(funs()); while (peek() === ',' && take())
    take('>')
    return { kind: 'app', name, args }
  }
  function postfix(): Type {
    let type = atom()
    for (;;) {
      if (peek() === '[') {
        take()
        let rank = 1
        while (peek() === ',') { take(); rank++ }
        take(']')
        type = { kind: 'array', element: type, rank }
      } else if (isName(peek()) && !['when', 'with', 'and'].includes(peek()!)) {
        type = { kind: 'postfix', first: type, last: { kind: 'ident', text: longIdent() } }
      } else return type
    }
  }
  function labelled(): Type {
    const optional = peek() === '?'
    if (!isName(peek(optional ? 1 : 0)) || peek(optional ? 2 : 1) !== ':') return optional ? fail() : postfix()
    if (optional) take()
    const token = at
    const name = take().text
    take(':')
    return { kind: 'param', name, token, optional, inner: postfix() }
  }
  function tuple(): Type {
    const items = [labelled()]
    while (peek() === '*') { take(); items.push(labelled()) }
    return items.length > 1 ? { kind: 'tuple', items } : items[0]!
  }
  function funs(): Type {
    const params: Type[] = []
    let type = tuple()
    while (peek() === '->') { take(); params.push(type); type = tuple() }
    return params.length ? { kind: 'funs', params, returns: type } : type
  }

  const keyword = peek()
  if (keyword !== 'val' && keyword !== 'member') return fail()
  take()
  // A name is the unbroken run before the colon. That includes an active pattern, whose
  // opening parenthesis the extractor drops, but not modifiers or explicit type parameters.
  const first = at
  at++
  while (at < tokens.length && peek() !== ':' && !tokens[at]!.spaced) at++
  const last = at - 1
  if (peek() !== ':' || tokens.slice(first, at).some((token) => token.text === '<')) fail()
  const name = raw.slice(tokens[first]!.start, tokens[last]!.end)
  take(':')
  let type = funs()
  if (peek() === 'when') {
    take()
    type = { kind: 'constrained', inner: type, constraints: constraints() }
  }
  let accessors: string | undefined
  if (peek() === 'with') {
    accessors = tokens.slice(at).map((token) => token.text).join(' ').replace(/ ,/g, ',')
    at = tokens.length
  }
  if (at < tokens.length) fail()
  return { keyword, name, nameTokens: [first, last], type, accessors }
}

type Mode = readonly { maxWidth: number; startColumn: number; multiline: boolean }[] | null
interface Snapshot { out: string; column: number; indent: number; lines: number; mode: Mode }

/**
 * Output with Fantomas' tentative measurement. A fragment is first written in
 * short mode, where a line break or a column past the limit marks it failed,
 * and a failed attempt is rolled back before its long form is written.
 */
class Writer {
  out = ''
  column = 0
  indent = 0
  lines = 0
  mode: Mode = null
  constructor(readonly limit: number) {}

  snapshot(): Snapshot { return { out: this.out, column: this.column, indent: this.indent, lines: this.lines, mode: this.mode } }
  restore(snapshot: Snapshot) { Object.assign(this, snapshot) }
  tooLong(info: { maxWidth: number; startColumn: number }) {
    return this.column - info.startColumn > info.maxWidth || this.column > this.limit
  }
  failed() { return this.mode?.some((info) => info.multiline || this.tooLong(info)) ?? false }
  frozen() { return this.mode?.some((info) => info.multiline) ?? false }

  /** Apply an event, or record that a short attempt can no longer succeed. */
  private event(breaks: boolean, apply: () => void) {
    if (this.mode) {
      if (this.frozen()) return
      if (breaks || this.mode.some((info) => this.tooLong(info))) {
        this.mode = this.mode.map((info) => ({ ...info, multiline: this.tooLong(info) || breaks }))
        return
      }
    }
    apply()
  }
  put(text: string) { this.event(false, () => { this.out += text; this.column += text.length }) }
  break() {
    this.event(true, () => {
      this.out = `${this.out.replace(/ +$/, '')}\n${' '.repeat(this.indent)}`
      this.column = this.indent
      this.lines++
    })
  }
  deeper() { this.event(false, () => { this.indent += 4 }) }
  shallower() { this.event(false, () => { this.indent = Math.max(0, this.indent - 4) }) }
}

type Gen = (w: Writer) => void
const text = (value: string): Gen => (w) => w.put(value)
const newline: Gen = (w) => w.break()
const indent: Gen = (w) => w.deeper()
const unindent: Gen = (w) => w.shallower()
const nothing: Gen = () => {}
const space: Gen = (w) => { if (w.out !== '' && !/[ \n]$/.test(w.out)) w.put(' ') }
const seq = (...gens: Gen[]): Gen => (w) => { for (const gen of gens) { gen(w); if (w.frozen()) return } }
const join = <T>(separator: Gen, items: T[], print: (item: T) => Gen): Gen => (w) =>
  items.forEach((item, index) => { if (index) separator(w); print(item)(w) })
const indentNewlineUnindent = (gen: Gen): Gen => seq(indent, newline, gen, unindent)

/** Write the short form from column zero when it fits on the line, otherwise the long form. */
function fitsOnRestOfLine(short: Gen, long: Gen): Gen {
  return (w) => {
    if (w.failed()) return
    const before = w.snapshot()
    const info = { maxWidth: w.limit, startColumn: 0, multiline: false }
    w.mode = !w.mode ? [info] : w.mode.some((entry) => entry.maxWidth === info.maxWidth && entry.startColumn === 0 && !entry.multiline) ? w.mode : [info, ...w.mode]
    short(w)
    if (w.failed()) { w.restore(before); long(w) } else w.mode = before.mode
  }
}

/** Keep a type on its line, or indent it under the previous line. */
function breakBeforeIfTooLong(gen: Gen, spaceBefore = false): Gen {
  return (w) => {
    if (w.failed()) return
    if (w.mode) { seq(spaceBefore ? space : nothing, gen)(w); return }
    const before = w.snapshot()
    w.mode = [{ maxWidth: w.limit, startColumn: 0, multiline: false }]
    seq(spaceBefore ? space : nothing, gen)(w)
    if (w.failed()) { w.restore(before); indentNewlineUnindent(gen)(w) } else w.mode = before.mode
  }
}

const printConstraint = (constraint: Constraint): Gen => constraint.kind === 'single'
  ? text(`${constraint.typar}: ${constraint.text}`) : seq(text(`${constraint.typar} :> `), printType(constraint.type))
const printWhen = (constraints: Constraint[], spaced = false): Gen => fitsOnRestOfLine(
  seq(spaced ? space : nothing, text('when '), join(seq(space, text('and ')), constraints, printConstraint)),
  // Fantomas omits the space here, which can join `when` to the type before it.
  seq(spaced ? space : nothing, text('when '), join(seq(newline, text('and'), space), constraints, printConstraint)),
)

function printTuple(items: Type[]): Gen {
  const segments = (breaks: boolean): Gen => join(space, items.flatMap((item, index) => index
    ? [breaks ? seq(text('*'), newline) : text('*'), printType(item)] : [printType(item)]), (gen) => gen)
  return fitsOnRestOfLine(segments(false), segments(true))
}

/** The closing angle bracket of a broken argument list sits one column inside the type name. */
function printApplication(type: Extract<Type, { kind: 'app' }>): Gen {
  return (w) => {
    const start = w.column
    const arguments_ = (separator: Gen) => join(separator, type.args, printType)
    seq(printType(type.name), text('<'),
      fitsOnRestOfLine(arguments_(seq(text(','), space)), seq(indentNewlineUnindent(arguments_(seq(text(','), newline))), newline)),
      (writer) => { if (start + 1 > writer.column) writer.put(' '.repeat(start + 1 - writer.column)) },
      text('>'))(w)
  }
}

function printType(type: Type): Gen {
  switch (type.kind) {
    case 'ident': case 'var': return text(type.text)
    case 'app': return printApplication(type)
    case 'postfix': return seq(printType(type.first), space, printType(type.last))
    case 'array': return seq(printType(type.element), text(`[${','.repeat(type.rank - 1)}]`))
    case 'tuple': return printTuple(type.items)
    case 'flexible': return seq(text('#'), printType(type.inner))
    case 'param': return seq(text(`${type.optional ? '?' : ''}${type.name}: `), breakBeforeIfTooLong(printType(type.inner)))
    case 'constrained': return seq(printType(type.inner), breakBeforeIfTooLong(printWhen(type.constraints, true)))
    case 'paren': return type.inner.kind === 'funs'
      ? fitsOnRestOfLine(seq(text('('), printType(type.inner), text(')')), seq(text('('), indent, printType(type.inner), unindent, text(')')))
      : seq(text('('), printType(type.inner), text(')'))
    case 'funs': {
      const [first, ...rest] = type.params
      return fitsOnRestOfLine(printChain(type), seq(printType(first!), indentNewlineUnindent(seq(text('-> '),
        ...rest.flatMap((param) => [printType(param), newline, text('-> ')]), printType(type.returns)))))
    }
  }
}

const printChain = (type: Extract<Type, { kind: 'funs' }>): Gen =>
  seq(join(space, type.params, (param) => seq(printType(param), space, text('->'))), space, printType(type.returns))

/** One argument per line with a trailing arrow, then the result one level deeper. */
function printArguments(type: Extract<Type, { kind: 'funs' }>): Gen {
  const long: Gen = (w) => {
    // A tupled argument indents everything after it.
    let levels = 0
    type.params.forEach((param, index) => {
      printType(param)(w)
      if (index === type.params.length - 1) return seq(space, text('->'), indent, newline, printType(type.returns))(w)
      const tupled = param.kind === 'tuple'
      seq(space, text('->'), tupled ? indent : nothing, newline)(w)
      if (tupled) levels++
    })
    for (let level = 0; level <= levels; level++) unindent(w)
  }
  return fitsOnRestOfLine(printChain(type), long)
}

function printSignatureType(type: Type): Gen {
  if (type.kind === 'constrained' && type.inner.kind === 'funs') {
    const constraints = printWhen(type.constraints)
    const chain = printArguments(type.inner)
    return breakBeforeIfTooLong((w) => {
      const before = w.lines
      chain(w)
      if (w.lines > before) indentNewlineUnindent(constraints)(w)
      else breakBeforeIfTooLong(constraints, true)(w)
    })
  }
  return breakBeforeIfTooLong(type.kind === 'funs' ? printArguments(type) : printType(type))
}

function printDeclaration(declaration: Declaration, limit: number): string {
  const writer = new Writer(limit)
  seq(text(`${declaration.keyword} ${declaration.name}: `), printSignatureType(declaration.type),
    declaration.accessors ? seq(space, text(declaration.accessors)) : nothing)(writer)
  return writer.out.replace(/ +$/gm, '')
}

/** Link the declared name and each named argument of the callable's own function type. */
function syntaxRanges(declaration: Declaration, tokens: Token[], signature: Signature, raw: string): CodeSyntax[] {
  const [first, last] = declaration.nameTokens
  const syntax: CodeSyntax[] = [{ start: tokens[first]!.start, end: tokens[last]!.end, kind: 'name' }]
  const type = declaration.type.kind === 'constrained' ? declaration.type.inner : declaration.type
  const params = type.kind === 'funs' ? type.params : []
  if (params.length !== signature.params.length) throw new Error(`F# callable header binding disagrees with the model: ${raw}`)
  params.forEach((param, index) => {
    if (param.kind !== 'param') return
    if (signature.params[index]!.name !== param.name) throw new Error(`F# callable header binding disagrees with the model: ${raw}`)
    syntax.push({ start: tokens[param.token]!.start, end: tokens[param.token]!.end, kind: 'parameter', parameter: index })
  })
  return syntax.sort((a, b) => a.start - b.start)
}

/** Print a signature header at the given width, preserving its tokens. */
export function formatFSharpSignature(raw: string, limit: number = CODE_COLUMNS.api): string {
  const declaration = parseDeclaration(tokenize(raw), raw)
  return printDeclaration(declaration, limit)
}

async function formatSignature(signature: Signature): Promise<CodeLayout> {
  const raw = signature.raw!
  const input = tokenize(raw)
  const declaration = parseDeclaration(input, raw)
  const formatted = printDeclaration(declaration, CODE_COLUMNS.api)
  const output = tokenize(formatted)
  if (JSON.stringify(input.map((token) => token.text)) !== JSON.stringify(output.map((token) => token.text))) {
    throw new Error(`Formatting changed F# signature tokens: ${raw}`)
  }
  return { text: formatted, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(formatted, 'api'), syntax: syntaxRanges(declaration, output, signature, raw) }
}

/** Lay out one F# `val` or `member` signature at the shared API width. */
export function fsharpSignatureLayout(signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatSignature(signature)
    layouts.set(key, pending)
  }
  return pending
}
