import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, swiftBaseName, type CodeLayout, type CodeSyntax, type SpanLayout } from './code-layout'

/*
 * Swift callable headers are laid out by swift-format's own printer. The
 * reference renders a declaration as `name(label: Type, ...) -> Result`, which
 * is the parameter clause and return clause of a function; this module builds
 * the token stream swift-format builds for those clauses and runs its
 * Oppen-style printer under libtmux-swift's configuration (four-space
 * indentation) at the API budget. The site needs no formatter at build time.
 */

const INDENT = 4

type TypeNode =
  | { kind: 'atom'; text: string }
  | { kind: 'name'; text: string; generics: TypeNode[] }
  | { kind: 'member'; base: TypeNode; name: string; generics: TypeNode[] }
  | { kind: 'optional'; inner: TypeNode; mark: string }
  | { kind: 'array'; element: TypeNode }
  | { kind: 'dictionary'; key: TypeNode; value: TypeNode }
  | { kind: 'tuple'; elements: Element[] }
  | { kind: 'function'; elements: Element[]; effects: string[]; result: TypeNode }
  | { kind: 'attributed'; prefix: string[]; type: TypeNode }
  | { kind: 'composition'; parts: TypeNode[] }
  | { kind: 'someOrAny'; specifier: string; type: TypeNode }
interface Element { label?: string; type: TypeNode }

const SPECIFIERS = new Set(['inout', 'isolated', 'borrowing', 'consuming', 'sending', '__shared', '__owned'])
const EFFECTS = new Set(['async', 'throws', 'rethrows'])

/** Parse the subset of Swift type syntax the reference spells; any other spelling stays one unbreakable token. */
function parseType(source: string): TypeNode | undefined {
  const tokens = source.match(/\s*(?:->|\.\.\.|[A-Za-z_$][\w$]*|[()[\]<>,:?!.&@]|\S)/g)?.map((token) => token.trim()) ?? []
  let at = 0
  const peek = () => tokens[at]
  const take = () => tokens[at++]
  const accept = (token: string) => (tokens[at] === token ? (at++, true) : false)
  class Failure extends Error {}
  const expect = (token: string) => { if (!accept(token)) throw new Failure() }
  const identifier = () => {
    const token = take()
    if (!token || !/^[A-Za-z_$][\w$]*$/.test(token)) throw new Failure()
    return token
  }
  const generics = (): TypeNode[] => {
    if (!accept('<')) return []
    const argumentTypes: TypeNode[] = [parseOne()]
    while (accept(',')) argumentTypes.push(parseOne())
    expect('>')
    return argumentTypes
  }
  const elements = (): Element[] => {
    expect('(')
    const result: Element[] = []
    if (!accept(')')) {
      do {
        const label = /^[A-Za-z_$][\w$]*$/.test(peek() ?? '') && tokens[at + 1] === ':' ? identifier() : undefined
        if (label) expect(':')
        result.push({ ...(label ? { label } : {}), type: parseOne() })
      } while (accept(','))
      expect(')')
    }
    return result
  }
  function primary(): TypeNode {
    if (accept('[')) {
      const first = parseOne()
      if (accept(':')) {
        const value = parseOne()
        expect(']')
        return { kind: 'dictionary', key: first, value }
      }
      expect(']')
      return { kind: 'array', element: first }
    }
    if (peek() === 'any' || peek() === 'some') {
      const specifier = take()!
      return { kind: 'someOrAny', specifier, type: composed() }
    }
    const text = identifier()
    return { kind: 'name', text, generics: generics() }
  }
  function postfix(): TypeNode {
    let node: TypeNode
    if (peek() === '(') {
      const items = elements()
      const effects: string[] = []
      while (EFFECTS.has(peek() ?? '')) effects.push(take()!)
      if (effects.length || peek() === '->') {
        expect('->')
        return { kind: 'function', elements: items, effects, result: parseOne() }
      }
      node = { kind: 'tuple', elements: items }
    } else node = primary()
    for (;;) {
      if (peek() === '?' || peek() === '!') node = { kind: 'optional', inner: node, mark: take()! }
      else if (accept('.')) { const name = identifier(); node = { kind: 'member', base: node, name, generics: generics() } }
      else return node
    }
  }
  function composed(): TypeNode {
    const parts = [postfix()]
    while (accept('&')) parts.push(postfix())
    return parts.length > 1 ? { kind: 'composition', parts } : parts[0]!
  }
  function parseOne(): TypeNode {
    const prefix: string[] = []
    for (;;) {
      if (peek() === '@') { take(); prefix.push(`@${identifier()}`) }
      else if (SPECIFIERS.has(peek() ?? '')) prefix.push(take()!)
      else break
    }
    const type = composed()
    return prefix.length ? { kind: 'attributed', prefix, type } : type
  }
  try {
    const node = parseOne()
    return at === tokens.length ? node : undefined
  } catch (error) {
    if (error instanceof Failure) return undefined
    throw error
  }
}

/** A grammar word, not a reference: a keyword, or a type Swift spells as one. */
type Syntax = 'keyword' | 'literal'

type Piece =
  | { kind: 'text'; text: string; role?: 'name' | number; syntax?: Syntax }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'break'; style: 'open' | 'close' | 'continue' | 'same'; size: number; mustBreak?: boolean }
  | { kind: 'space'; size: number }

const text = (value: string, role?: 'name' | number): Piece => ({ kind: 'text', text: value, ...(role === undefined ? {} : { role }) })
const word = (value: string, syntax: Syntax): Piece => ({ kind: 'text', text: value, syntax })
const open: Piece = { kind: 'open' }
const close: Piece = { kind: 'close' }
const space: Piece = { kind: 'space', size: 1 }
const lineBreak = (style: 'open' | 'close' | 'continue' | 'same' = 'continue', size = 1, mustBreak = false): Piece => ({ kind: 'break', style, size, ...(mustBreak ? { mustBreak } : {}) })

/** The name a member chain starts from: `Self` in `Self.Element.Index`. */
function rootName(node: TypeNode): string | undefined {
  let at = node
  while (at.kind === 'member') at = at.base
  return at.kind === 'name' ? at.text : undefined
}

/** The token stream swift-format's TokenStreamCreator builds for a type. */
function typePieces(node: TypeNode, out: Piece[]): void {
  const list = (items: TypeNode[]) => {
    out.push(lineBreak('open', 0), open)
    items.forEach((item, index) => {
      out.push(open)
      typePieces(item, out)
      if (index < items.length - 1) out.push(text(','), close, lineBreak('same'))
      else out.push(close)
    })
    out.push(lineBreak('close', 0, true), close)
  }
  const tuple = (items: Element[]) => {
    out.push(text('('), lineBreak('open', 0), open)
    items.forEach((item, index) => {
      out.push(open)
      if (item.label) out.push(text(item.label), text(':'), lineBreak())
      typePieces(item.type, out)
      if (index < items.length - 1) out.push(text(','), close, lineBreak('same'))
      else out.push(close)
    })
    out.push(lineBreak('close', 0, true), close, text(')'))
  }
  switch (node.kind) {
    case 'atom': out.push(text(node.text)); break
    case 'name':
      // `Self` is a keyword written where a type goes, not a name to look up.
      out.push(node.text === 'Self' ? word(node.text, 'literal') : text(node.text))
      if (node.generics.length) { out.push(text('<')); list(node.generics); out.push(text('>')) }
      break
    case 'member': {
      typePieces(node.base, out)
      // A member of `Self` is the conforming type's own, which no entry documents.
      const ofSelf = rootName(node) === 'Self'
      out.push(lineBreak('continue', 0), ofSelf ? word('.', 'literal') : text('.'), ofSelf ? word(node.name, 'literal') : text(node.name))
      if (node.generics.length) { out.push(text('<')); list(node.generics); out.push(text('>')) }
      break
    }
    case 'optional': typePieces(node.inner, out); out.push(text(node.mark)); break
    case 'array': out.push(text('[')); typePieces(node.element, out); out.push(text(']')); break
    case 'dictionary': out.push(text('[')); typePieces(node.key, out); out.push(text(':'), lineBreak()); typePieces(node.value, out); out.push(text(']')); break
    case 'tuple': tuple(node.elements); break
    case 'function': {
      tuple(node.elements)
      node.effects.forEach((effect, index) => {
        out.push(lineBreak())
        if (index === 0 && node.effects.length > 1) out.push(open)
        out.push(word(effect, 'keyword'))
        if (index === node.effects.length - 1 && node.effects.length > 1) out.push(close)
      })
      out.push(lineBreak(), text('->'), lineBreak())
      // A member type keeps its base, dot and name together when they fit.
      if (node.result.kind === 'member') out.push(open)
      typePieces(node.result, out)
      if (node.result.kind === 'member') out.push(close)
      break
    }
    case 'attributed':
      out.push(open)
      for (const item of node.prefix) {
        if (item.startsWith('@')) out.push(open, word('@', 'keyword'), word(item.slice(1), 'keyword'), close)
        else out.push(word(item, 'keyword'))
        out.push(lineBreak())
      }
      typePieces(node.type, out)
      out.push(close)
      break
    case 'composition':
      node.parts.forEach((part, index) => {
        if (index) out.push(lineBreak(), text('&'), space)
        typePieces(part, out)
      })
      break
    case 'someOrAny': out.push(word(node.specifier, 'keyword'), space); typePieces(node.type, out); break
  }
}

interface Head {
  /** The `func` keyword, which swift-format keeps with the name; the reference omits it. */
  keyword?: string
  name: string
  parameters: { name: string; type: string }[]
  returns?: string
}

/** A variadic parameter's ellipsis follows its type inside the parameter's group. Reports whether the type parsed; one that did not stays a single token. */
function parameterTypePieces(type: string, out: Piece[]): boolean {
  const variadic = type.endsWith('...')
  const written = variadic ? type.slice(0, -3) : type
  const node = parseType(written)
  typePieces(node ?? { kind: 'atom', text: written }, out)
  if (variadic) out.push(text('...'))
  return node !== undefined
}

function headPieces(head: Head): Piece[] {
  const out: Piece[] = [open, open]
  if (head.keyword) out.push(text(head.keyword), lineBreak())
  out.push(text(head.name, 'name'), text('('))
  const hasParameters = head.parameters.length > 0
  if (hasParameters) {
    out.push(close, lineBreak('open', 0), open)
    head.parameters.forEach((parameter, index) => {
      out.push(open, text(parameter.name, index), text(':'), lineBreak())
      parameterTypePieces(parameter.type, out)
      if (index < head.parameters.length - 1) out.push(text(','), close, lineBreak('same'))
      else out.push(close)
    })
    out.push(lineBreak('close', 0, head.returns !== undefined), close, text(')'))
  } else out.push(text(')'), close)
  if (head.returns !== undefined) {
    out.push(lineBreak(), text('->'), space)
    const result = parseType(head.returns) ?? { kind: 'atom', text: head.returns }
    if (result.kind === 'member') out.push(open)
    typePieces(result, out)
    if (result.kind === 'member') out.push(close)
  }
  out.push(close)
  return out
}

interface Printed {
  text: string
  roles: Map<'name' | number, { start: number; end: number }>
  /** Grammar words, in order; the words of one token that print together are one range. */
  words: { start: number; end: number; kind: Syntax }[]
}

/** swift-format's PrettyPrinter: Oppen's scan for token lengths, then printing with breaks and indentation. */
function printPieces(pieces: Piece[], lineLength: number): Printed {
  const lengths: number[] = []
  const delimiters: number[] = []
  let total = 0
  pieces.forEach((piece, index) => {
    switch (piece.kind) {
      case 'open':
        lengths.push(-total)
        delimiters.push(index)
        break
      case 'close': {
        lengths.push(0)
        let at = delimiters.pop()!
        lengths[at]! += total
        if (pieces[at]!.kind === 'break') {
          at = delimiters.pop()!
          lengths[at]! += total
        }
        break
      }
      case 'break': {
        const last = delimiters.at(-1)
        if (last !== undefined && pieces[last]!.kind === 'break') {
          lengths[last]! += total
          delimiters.pop()
        }
        lengths.push(-total)
        delimiters.push(index)
        total += piece.size
        break
      }
      case 'space': lengths.push(piece.size); total += piece.size; break
      case 'text': lengths.push(piece.text.length); total += piece.text.length; break
    }
  })
  const trailing = delimiters.pop()
  if (trailing !== undefined) lengths[trailing]! += total

  interface ActiveOpenBreak { lineNumber: number; contributesContinuationIndent: boolean; contributesBlockIndent: boolean }
  let output = ''
  let column = 0
  let atStartOfLine = true
  let pendingSpaces = 0
  let lineNumber = 1
  let consecutiveNewlines = 0
  let continuation = false
  const forceBreak = [false]
  const activeOpenBreaks: ActiveOpenBreak[] = []
  const continuationStack: boolean[] = []
  const roles: Printed['roles'] = new Map()
  const words: Printed['words'] = []
  const indentation = () => activeOpenBreaks.reduce((units, active) => units + (active.contributesBlockIndent ? 1 : 0) + (active.contributesContinuationIndent ? 1 : 0), 0) + (continuation ? 1 : 0)
  const canFit = (length = 1) => atStartOfLine || length <= lineLength - column
  const compensatingLine = () => lineNumber - (atStartOfLine ? 1 : 0)

  pieces.forEach((piece, index) => {
    const length = lengths[index]!
    switch (piece.kind) {
      case 'open': forceBreak.push(false); break
      case 'close': forceBreak.pop(); break
      case 'space': pendingSpaces += piece.size; column += piece.size; break
      case 'text': {
        if (atStartOfLine) {
          output += ' '.repeat(INDENT * indentation())
          column = INDENT * indentation()
          atStartOfLine = false
        } else if (pendingSpaces > 0) output += ' '.repeat(pendingSpaces)
        if (piece.role !== undefined) roles.set(piece.role, { start: output.length, end: output.length + piece.text.length })
        if (piece.syntax) {
          const previous = words.at(-1)
          if (previous?.kind === piece.syntax && previous.end === output.length) previous.end += piece.text.length
          else words.push({ start: output.length, end: output.length + piece.text.length, kind: piece.syntax })
        }
        output += piece.text
        consecutiveNewlines = 0
        pendingSpaces = 0
        column += piece.text.length
        break
      }
      case 'break': {
        let mustBreak = forceBreak.at(-1) ?? false
        let continuationIfBreakFires = false
        if (piece.style === 'open') {
          const lastOpen = activeOpenBreaks.at(-1)
          const currentLine = compensatingLine()
          if (lastOpen && currentLine === lastOpen.lineNumber) lastOpen.contributesBlockIndent = false
          activeOpenBreaks.push({ lineNumber: currentLine, contributesContinuationIndent: continuation, contributesBlockIndent: true })
          continuationStack.push(continuation)
          continuation = false
        } else if (piece.style === 'close') {
          const matching = activeOpenBreaks.pop()!
          const openedOnDifferentLine = compensatingLine() !== matching.lineNumber
          if (matching.contributesBlockIndent && matching.lineNumber === lineNumber) {
            const previous = activeOpenBreaks.at(-1)
            if (previous && !previous.contributesBlockIndent) previous.contributesBlockIndent = true
          }
          if (piece.mustBreak) mustBreak = openedOnDifferentLine
          else if (!canFit()) mustBreak = true
          else continuation = (matching.contributesContinuationIndent || matching.contributesBlockIndent) && openedOnDifferentLine
          const wasContinuationWhenOpened = (continuationStack.pop() ?? false) || matching.contributesContinuationIndent
          continuation = continuation || wasContinuationWhenOpened
          continuationIfBreakFires = wasContinuationWhenOpened
        } else if (piece.style === 'continue') continuationIfBreakFires = true
        if (!canFit(length) || mustBreak) {
          continuation = continuationIfBreakFires
          if (consecutiveNewlines === 0) {
            output += '\n'
            lineNumber++
            atStartOfLine = true
            consecutiveNewlines++
            pendingSpaces = 0
            column = 0
          }
        } else {
          if (atStartOfLine) continuation = continuationIfBreakFires
          pendingSpaces += piece.size
          column += piece.size
        }
        break
      }
    }
  })
  return { text: output, roles, words }
}

/** Format a function head as swift-format does at `columns`. */
export function formatSwiftHead(head: Head, columns: number): string {
  return printPieces(headPieces(head), columns).text
}

/** The rendered reference declaration, in the text the page displays: the base name, then the parameter list that spells the labels. */
function declarationHead(symbol: ApiSymbol, signature: Signature): Head {
  for (const parameter of signature.params) {
    if (parameter.variadic || parameter.optional || parameter.default !== undefined || !parameter.type) {
      throw new Error(`Unsupported Swift parameter ${symbol.id}.${parameter.name}`)
    }
  }
  return { name: swiftBaseName(symbol.name), parameters: signature.params.map(({ name, type }) => ({ name, type: type! })), ...(signature.returns ? { returns: signature.returns } : {}) }
}

const layouts = new Map<string, Promise<CodeLayout>>()

/** Lay out a Swift callable's rendered declaration at the API budget. */
export function swiftSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([swiftBaseName(symbol.name), signature.params, signature.returns, CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = (async () => {
      const printed = printPieces(headPieces(declarationHead(symbol, signature)), CODE_COLUMNS.api)
      const syntax: CodeSyntax[] = [...[...printed.roles].map(([role, range]): CodeSyntax => role === 'name'
        ? { ...range, kind: 'name' }
        : { ...range, kind: 'parameter', parameter: role }), ...printed.words]
      return { text: printed.text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(printed.text, 'api'), syntax: syntax.sort((a, b) => a.start - b.start) }
    })()
    layouts.set(key, pending)
  }
  return pending
}

const typeLayouts = new Map<string, SpanLayout | undefined>()

/**
 * A type on its own, as a parameter list prints it, with the roles it has in a
 * declaration. A type this grammar does not read, or would respell beyond its
 * whitespace, stays unmarked.
 */
export function swiftTypeLayout(type: string): SpanLayout | undefined {
  if (!typeLayouts.has(type)) {
    const pieces: Piece[] = []
    // No width forces a break, so the type prints on one line.
    const printed = parameterTypePieces(type, pieces) ? printPieces(pieces, Number.MAX_SAFE_INTEGER) : undefined
    typeLayouts.set(type, printed && printed.text.replace(/\s+/g, '') === type.replace(/\s+/g, '')
      ? { text: printed.text, syntax: printed.words } : undefined)
  }
  return typeLayouts.get(type)
}
