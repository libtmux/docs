import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

/*
 * C++ declarations are laid out by clang-format's own search. The generator
 * formats `raw` as a struct member under the project `.clang-format` (LLVM
 * base, left pointer alignment); this module runs the same search at the API
 * budget. It ports the parts of TokenAnnotator, ContinuationIndenter and the
 * line formatter that govern one declaration, so the site needs no formatter
 * at build time.
 */

type Kind = 'identifier' | 'keyword' | 'number' | 'string' | 'punct'
type TokenType =
  | 'unknown' | 'templateOpener' | 'templateCloser' | 'pointerOrReference' | 'startOfName'
  | 'functionDeclarationName' | 'ctorDtorDeclName' | 'functionDeclarationLParen' | 'trailingAnnotation'
  | 'binaryOperator' | 'unaryOperator' | 'attributeLSquare' | 'attributeRSquare' | 'requiresClause'
  | 'trailingReturnArrow' | 'typeDeclarationParen'

interface Tok {
  index: number
  text: string
  kind: Kind
  start: number
  end: number
  type: TokenType
  prev?: Tok
  next?: Tok
  matching?: Tok
  parentBracket: string
  nesting: number
  binding: number
  spaces: number
  mustBreak: boolean
  canBreak: boolean
  splitPenalty: number
  fakeL: number[]
  fakeR: number
  parameterCount: number
  closesTemplate: boolean
  closesRequires: boolean
  operatorIndex: number
  nextOperator?: Tok
  startsBinaryExpression: boolean
  endsBinaryExpression: boolean
}

// LLVM style as the project configures it. The generator formats members of a
// struct, so a declaration starts one indent in and its limit counts that.
// Penalties are LLVM's defaults; clang-format picks the cheapest set of breaks.
const INDENT = 2
const CONTINUATION = 4
const PENALTY_RETURN_TYPE = 60
const PENALTY_ASSIGNMENT = 2
const PENALTY_TEMPLATE_DECLARATION = 10
const PENALTY_SCOPE_RESOLUTION = 500
const PENALTY_EXCESS = 1_000_000
const PENALTY_FIRST_PARAMETER = 19
const ASSIGNMENT = 2
/** Past this many candidate states clang-format stops comparing bracket stacks. */
const SEARCH_LIMIT = 50_000

const KEYWORDS = new Set([
  'alignas', 'alignof', 'auto', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'concept', 'const',
  'consteval', 'constexpr', 'constinit', 'decltype', 'default', 'delete', 'double', 'enum', 'explicit', 'export',
  'extern', 'false', 'float', 'friend', 'inline', 'int', 'long', 'mutable', 'namespace', 'noexcept', 'nullptr',
  'operator', 'private', 'protected', 'public', 'requires', 'short', 'signed', 'sizeof', 'static', 'static_assert',
  'struct', 'template', 'this', 'thread_local', 'true', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
  'virtual', 'void', 'volatile', 'wchar_t',
])
const TYPE_KEYWORDS = new Set(['bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'decltype', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void', 'wchar_t'])
const NON_KEYWORD_TYPES = new Set(['clock_t', 'int16_t', 'int32_t', 'int64_t', 'int8_t', 'intptr_t', 'ptrdiff_t', 'size_t', 'time_t', 'uint16_t', 'uint32_t', 'uint64_t', 'uint8_t', 'uintptr_t'])
const SPECIFIERS = new Set(['friend', 'inline', 'virtual', 'constexpr', 'consteval', 'explicit'])
const SUPPORTED_PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '=', '&', '&&', '||', '*', '!', '~', '::', '->', '...'])

function unsupported(raw: string, why: string): never {
  throw new Error(`Unsupported C++ callable header grammar (${why}): ${raw}`)
}

function lex(raw: string): Tok[] {
  const tokens: Tok[] = []
  const pattern = /\s+|(?<identifier>[A-Za-z_]\w*)|(?<number>\d(?:[eEpP][+-]|[\w.'])*)|(?<string>(?:u8|u|U|L)?(?:"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'))|(?<punct>\.\.\.|->\*|<=>|->|::|&&|\|\||==|!=|<=|<<|[-+*/%^|&~!=<>,;:.?#()[\]{}@\\`$])/y
  let at = 0
  while (at < raw.length) {
    pattern.lastIndex = at
    const match = pattern.exec(raw)
    if (!match) unsupported(raw, `character ${JSON.stringify(raw[at])}`)
    at = pattern.lastIndex
    const text = match[0]
    if (/^\s/.test(text)) continue
    const groups = match.groups!
    const kind: Kind = groups.identifier !== undefined ? (KEYWORDS.has(text) ? 'keyword' : 'identifier')
      : groups.number !== undefined ? 'number' : groups.string !== undefined ? 'string' : 'punct'
    if (kind === 'punct' && !SUPPORTED_PUNCTUATION.has(text)) unsupported(raw, `operator ${text}`)
    if (text === 'operator') unsupported(raw, 'operator overload')
    tokens.push({
      index: tokens.length, text, kind, start: match.index, end: match.index + text.length, type: 'unknown',
      parentBracket: '', nesting: 0, binding: 1, spaces: 0, mustBreak: false, canBreak: false, splitPenalty: 0,
      fakeL: [], fakeR: 0, parameterCount: 0, closesTemplate: false, closesRequires: false, operatorIndex: 0,
      startsBinaryExpression: false, endsBinaryExpression: false,
    })
  }
  tokens.forEach((token, index) => { token.prev = tokens[index - 1]; token.next = tokens[index + 1] })
  return tokens
}

const is = (token: Tok | undefined, ...texts: string[]): boolean => token !== undefined && texts.includes(token.text)
const width = (token: Tok): number => token.end - token.start
const opensScope = (token: Tok): boolean => is(token, '(', '{', '[') || token.type === 'templateOpener'
const closesScope = (token: Tok): boolean => is(token, ')', '}', ']') || token.type === 'templateCloser'
const isPointerOrReferenceKind = (token: Tok | undefined): boolean => is(token, '*', '&', '&&')
const isTypeName = (token: Tok): boolean => TYPE_KEYWORDS.has(token.text) || (token.kind === 'identifier' && NON_KEYWORD_TYPES.has(token.text))
const isWordLike = (token: Tok): boolean => token.kind === 'identifier' || token.kind === 'keyword'
const isLiteral = (token: Tok): boolean => token.kind === 'number' || token.kind === 'string'
const qualifiesPointer = (token: Tok): boolean => is(token, 'const', 'volatile')

/** Operator precedence by token spelling, as clang's getBinOpPrecedence reports it. */
function precedence(token: Tok): number {
  switch (token.text) {
    case ',': return 1
    case '=': return 2
    case '||': return 4
    case '&&': return 5
    case '|': return 6
    case '^': return 7
    case '&': return 8
    case '==': case '!=': return 9
    case '<': case '>': case '<=': case '>=': return 10
    case '<=>': return 11
    case '<<': return 12
    case '+': case '-': return 13
    case '*': case '/': case '%': return 14
    default: return 0
  }
}
const isBinaryOperatorKind = (token: Tok): boolean => precedence(token) > 1

/** Match brackets, assign nesting and binding strength, and tell template angles from comparisons. */
function structure(raw: string, tokens: Tok[]): void {
  const stack: { open?: Tok; strength: number }[] = [{ strength: 1 }]
  for (const token of tokens) {
    const top = stack.at(-1)!
    const open = top.open
    const closes = (token.text === ')' && open?.text === '(') || (token.text === '}' && open?.text === '{') ||
      (token.text === ']' && open?.text === '[') || (token.text === '>' && open?.text === '<')
    if (!closes && is(token, ')', '}', ']', '>')) unsupported(raw, token.text === '>' ? 'comparison' : 'unbalanced brackets')
    token.nesting = stack.length - 1
    token.binding = top.strength
    token.parentBracket = open?.text ?? ''
    if (closes) {
      open!.matching = token
      token.matching = open
      if (open!.text === '<') { open!.type = 'templateOpener'; token.type = 'templateCloser' }
      stack.pop()
      continue
    }
    if (open) {
      if (token.text === ',') open.parameterCount++
      else if (open.parameterCount === 0) open.parameterCount = 1
    }
    if (token.text === '(' || token.text === '{') stack.push({ open: token, strength: top.strength + 1 })
    else if (token.text === '[') {
      if (token.next?.text !== '[' && token.prev?.text !== '[') unsupported(raw, 'array declarator')
      stack.push({ open: token, strength: top.strength + 1 })
    } else if (token.text === '<') {
      if (token.prev?.kind !== 'identifier' && token.prev?.text !== 'template') unsupported(raw, 'comparison')
      stack.push({ open: token, strength: top.strength + 12 })
    }
  }
  if (stack.length !== 1) unsupported(raw, 'unbalanced brackets')
  for (const token of tokens) {
    if (token.text === '[' && token.next?.text === '[' && token.prev?.text !== '[') {
      token.type = 'attributeLSquare'
      token.matching!.type = 'attributeRSquare'
    }
  }
}

/** The last token of a requires clause, following UnwrappedLineParser::parseConstraintExpression. */
function constraintEnd(raw: string, tokens: Tok[], from: number): number {
  let at = from
  let topParens = true
  scan: while (at < tokens.length) {
    const token = tokens[at]!
    switch (token.text) {
      case 'requires': return unsupported(raw, 'requires expression')
      case '(':
        if (!topParens) break scan
        for (let inner = at + 1; inner < token.matching!.index; inner++) {
          const operator = tokens[inner]!
          if (is(operator, '&&', '||') && operator.parentBracket !== '<') operator.type = 'binaryOperator'
        }
        at = token.matching!.index + 1
        topParens = false
        continue
      case '[': case 'const': case ';': case 'class': case 'struct': case 'union': case '{': break scan
      case '&&': case '||': token.type = 'binaryOperator'; topParens = true; at++; continue
      case ',': at++; continue
      case 'sizeof': case '!': case '+': case '-': case '*': case '/': topParens = true; at++; continue
      case '::': case 'true': case 'false': topParens = false; at++; continue
    }
    if (token.kind === 'number') { topParens = false; at++; continue }
    if (!isWordLike(token) || !is(tokens[at - 1], '::', '&&', '||', '!', 'requires', '=')) break
    at++
    if (tokens[at]?.type === 'templateOpener') at = tokens[at]!.matching!.index + 1
    topParens = false
  }
  if (at === from) unsupported(raw, 'empty requires clause')
  return at - 1
}

interface Declaration {
  tokens: Tok[]
  /** Declarations that begin with `virtual` keep `= 0` attached to the declarator. */
  virtual: boolean
  /** The opening parenthesis of the parameter list. */
  open: Tok
}

/** Qualifiers such as `A::` or `A<T>::` at the start of a name, as clang's skipNameQualifier. */
function skipNameQualifier(token: Tok): Tok | undefined {
  if (token.kind !== 'identifier') return undefined
  let next = token.next
  if (!next) return undefined
  if (next.text === '::') return next.next
  if (next.type === 'templateOpener') {
    next = next.matching?.next
    if (!next) return undefined
  }
  return next.text === '::' ? next.next : undefined
}

/** The name of a function without a return type, as clang's getFunctionName. */
function constructorName(tokens: Tok[]): { name: Tok; open: Tok } | undefined {
  let name: Tok | undefined
  for (let token: Tok | undefined = tokens[0]; token; token = token.next) {
    if (token.type === 'attributeLSquare') {
      token = token.matching
      if (!token) return undefined
      continue
    }
    if (name) return token.text === '(' && token.type === 'unknown' && token.matching ? { name, open: token } : undefined
    if (SPECIFIERS.has(token.text)) continue
    if (token.text === 'template') {
      token = token.next?.matching
      if (!token) return undefined
      continue
    }
    if (token.text === '::') {
      token = token.next
      if (!token) return undefined
    }
    for (let next = skipNameQualifier(token); next; next = skipNameQualifier(token)) token = next
    if (token.text === '~') {
      token = token.next
      if (!token) return undefined
    }
    if (token.kind !== 'identifier' || token.type !== 'unknown') return undefined
    name = token
  }
  return undefined
}

/** Whether `token` starts the name of a function declaration, as clang's isFunctionDeclarationName. */
function startsFunctionName(token: Tok): Tok | undefined {
  if (token.type !== 'startOfName' || token.nesting !== 0) return undefined
  let next = token.next
  for (; next; next = next.next) {
    if (next.type === 'templateOpener' && next.matching) next = next.matching
    else if (next.text === '::') {
      next = next.next
      if (next?.kind !== 'identifier') return undefined
    } else if (next.type === 'attributeLSquare') {
      next = next.matching
      if (!next) return undefined
    } else if (next.text === '(') break
    else return undefined
  }
  if (!next?.matching) return undefined
  const close = next.matching
  if (next.next === close || close.next?.type === 'pointerOrReference') return next
  for (let inner = next.next; inner && inner !== close; inner = inner.next) {
    if ((inner.text === '(' || inner.type === 'templateOpener') && inner.matching) { inner = inner.matching; continue }
    if (inner.type === 'typeDeclarationParen' || inner.text === 'const' || isTypeName(inner) || inner.type === 'pointerOrReference' || inner.type === 'startOfName' || inner.text === '...') return next
    if (inner.text === '{' || isLiteral(inner)) return undefined
  }
  return undefined
}

/** Whether an identifier follows a type and so likely declares a name, as clang's isStartOfName. */
function isStartOfName(token: Tok): boolean {
  const next = token.next
  if (token.kind !== 'identifier' || !token.prev || !next || isPointerOrReferenceKind(next) || next.kind === 'string') return false
  let before: Tok | undefined = token.prev
  while (before?.text === 'const') before = before.prev
  if (!before || before.closesRequires) return false
  if (before.type === 'templateCloser') return before.matching?.prev !== undefined && !is(before.matching.prev, '.', 'template')
  if (before.type === 'typeDeclarationParen' && before.text === ')') return true
  return before.kind === 'identifier' || before.text === 'auto' || before.type === 'pointerOrReference' || isTypeName(before)
}

/** Expression state of a bracket level, as clang's AnnotatingParser Context tracks it. */
interface Context {
  open?: Tok
  isExpression: boolean
  /** An angle list after a name, whose items are template arguments. */
  templateArgument: boolean
}

/** Whether `*`, `&` or `&&` declares a pointer or reference, following clang's determineStarAmpUsage. */
function starAmpType(raw: string, token: Tok, context: Context): TokenType {
  const prev = token.prev
  const next = token.next
  if (!prev || is(prev, '(', ',', '=', '{', '[', ';')) return unsupported(raw, 'unary or function-pointer declarator')
  if (isTypeName(prev) || !next || next.text === '>') return 'pointerOrReference'
  if (context.templateArgument && next.text === 'noexcept') return 'binaryOperator'
  if (is(next, '->', '=', ',', ')', ';') || next.type === 'requiresClause' || (next.text === 'noexcept' && !context.isExpression) || qualifiesPointer(next)) return 'pointerOrReference'
  if (prev.text === '::' || prev.type === 'typeDeclarationParen') return 'pointerOrReference'
  if (isLiteral(prev) || is(prev, ')', ']', 'true', 'false', '}')) return 'binaryOperator'
  let operand: Tok | undefined = next
  while (operand?.text === '(') operand = operand.next
  if (operand && (isLiteral(operand) || is(operand, 'true', 'false', '!', '~', '+', '-', 'sizeof', 'alignof'))) return 'binaryOperator'
  if (context.templateArgument && next.kind === 'identifier') return 'binaryOperator'
  if (token.text === '&&' && is(next, '(', '*', '&')) return 'binaryOperator'
  if (next.kind === 'identifier' && next.next && (next.next.text === '->' || isPointerOrReferenceKind(next.next))) {
    if (isPointerOrReferenceKind(next.next)) next.next.type = 'binaryOperator'
    return 'binaryOperator'
  }
  if (context.isExpression) return 'binaryOperator'
  return 'pointerOrReference'
}

/** Token types, in the order clang's AnnotatingParser assigns them. */
function classify(raw: string, tokens: Tok[]): Declaration {
  let headerEnd = 0
  while (tokens[headerEnd]?.text === 'template') {
    const open = tokens[headerEnd + 1]
    if (open?.type !== 'templateOpener') unsupported(raw, 'template instantiation')
    open.matching!.closesTemplate = true
    headerEnd = open.matching!.index + 1
  }
  const requires: [number, number][] = []
  for (const token of tokens) {
    if (token.text !== 'requires') continue
    if (token.nesting !== 0) unsupported(raw, 'requires expression')
    token.type = 'requiresClause'
    const last = constraintEnd(raw, tokens, token.index + 1)
    tokens[last]!.closesRequires = true
    requires.push([token.index, last])
  }
  const inRequires = (token: Tok) => requires.some(([from, to]) => token.index >= from && token.index <= to)
  const open = tokens.find((token) => token.text === '(' && token.nesting === 0 && !inRequires(token) &&
    !is(token.prev, 'decltype', 'alignas', 'explicit', 'sizeof', 'typeid', 'noexcept'))
  if (!open) unsupported(raw, 'no parameter list')
  const close = open.matching!
  let autoFound = false
  const contexts: Context[] = [{ isExpression: false, templateArgument: false }]
  const startsExpression = (token: Tok, context: Context): boolean => {
    if (tokens[0]!.text !== 'template') return token.prev?.text !== 'operator'
    if (tokens[1]!.type !== 'templateOpener') return false
    // A default template argument is a value unless it names a type.
    if (context.open?.text === '<') return !is(token.prev?.prev, 'typename', 'class')
    const after = tokens[1]!.matching?.next
    return after !== undefined && !is(after, 'class', 'enum', 'struct', 'using')
  }
  for (const token of tokens) {
    const context = contexts.at(-1)!
    const trailing = token.index > close.index
    if (context.open?.text === '(') {
      const prev = token.prev!
      if (prev.type === 'binaryOperator') context.isExpression = true
      if ((is(prev, 'const', 'auto') || isTypeName(prev)) && !(token.text === '{' || (token.text === '(' && !is(token.next, '*', '&')))) context.isExpression = false
    }
    if (token.text === '=' && startsExpression(token, context)) context.isExpression = true
    else if (is(token, ')', '>', ',')) context.isExpression = false
    else if (token.text === '!') context.isExpression = true
    if (token.type === 'unknown') {
      if (isStartOfName(token) && (!trailing || token.nesting !== 0)) token.type = 'startOfName'
      else if (token.text === 'auto') autoFound = true
      else if (token.text === '->') {
        if (!(autoFound && trailing && token.nesting === 0 && token.prev && token.prev.kind !== 'identifier')) unsupported(raw, 'member access')
        token.type = 'trailingReturnArrow'
      } else if (isPointerOrReferenceKind(token)) token.type = starAmpType(raw, token, context)
      else if (is(token, '!', '~')) token.type = 'unaryOperator'
      else if (is(token, '=', '&&', '||')) token.type = 'binaryOperator'
      else if ((token.kind === 'identifier' || is(token, 'const', 'noexcept', 'requires')) && token.prev && !is(token.prev, '=', '@') && trailing && token.nesting === 0) token.type = 'trailingAnnotation'
    }
    if (closesScope(token)) contexts.pop()
    else if (token.text === '(') {
      const prev = token.prev
      const decltype = prev?.text === 'decltype'
      if (decltype) { token.type = 'typeDeclarationParen'; token.matching!.type = 'typeDeclarationParen' }
      contexts.push({ open: token, templateArgument: false,
        isExpression: decltype || is(prev, 'noexcept', 'explicit', '(', ',') || prev?.type === 'binaryOperator' || context.isExpression })
    } else if (token.text === '<') contexts.push({ open: token, isExpression: false, templateArgument: token.prev?.text !== 'template' })
    else if (token.text === '{') contexts.push({ open: token, isExpression: true, templateArgument: false })
    else if (token.text === '[') contexts.push({ open: token, isExpression: false, templateArgument: false })
  }
  // A constructor with a requires clause is not recognised by clang-format and keeps no name role.
  const constructor = constructorName(tokens)
  if (constructor) {
    constructor.name.type = 'ctorDtorDeclName'
    constructor.open.type = 'functionDeclarationLParen'
  } else {
    for (const token of tokens.slice(1)) {
      const found = startsFunctionName(token)
      if (!found) continue
      token.type = 'functionDeclarationName'
      if (found.type === 'unknown') found.type = 'functionDeclarationLParen'
      break
    }
  }
  return { tokens, virtual: tokens.some((token) => token.text === 'virtual' && token.nesting === 0), open }
}

/** TokenAnnotator::spaceRequiredBefore for the tokens a declaration contains. */
function spaceRequiredBefore(right: Tok): boolean {
  const left = right.prev!
  if (isWordLike(left) && isWordLike(right)) return true
  if (left.text === '{' && right.text === '}') return false
  if (left.kind === 'identifier' && right.kind === 'number') return right.text[0] !== '.'
  if (isWordLike(left) && isLiteral(right)) return true
  if (right.type === 'trailingReturnArrow' || left.type === 'trailingReturnArrow') return true
  if (left.text === ',') return true
  if (right.text === ',') return false
  if (left.type === 'unaryOperator') return false
  if (left.text === '>' && right.text === '>') return false
  if (is(right, '->') || is(left, '->')) return false
  if (right.text === '::' && left.kind === 'identifier') return false
  if (right.text === '::' && !is(left, '{', '(')) return !(is(left, '(', ')', '[') || left.type === 'templateOpener' || left.type === 'templateCloser')
  if ((left.type === 'templateOpener') !== (right.type === 'templateCloser')) return false
  if (left.text === ')' && left.type !== 'typeDeclarationParen' && right.type === 'pointerOrReference' && is(right, '&', '&&')) return true
  if ((right.type === 'binaryOperator' && left.text !== '(') || (left.type === 'binaryOperator' && right.text !== ')')) return true
  return spaceRequiredBetween(left, right)
}

function spaceRequiredBetween(left: Tok, right: Tok): boolean {
  if (left.text === '(' || right.text === ')') return false
  if (is(right, ';', ',')) return false
  if (right.text === '<' && left.text === 'template') return true
  if (is(left, '!', '~')) return false
  if (left.text === '::') return false
  if (left.text === '<' || is(right, '>', '<')) return false
  if (right.text === '...') return isLiteral(left)
  if (right.type === 'pointerOrReference') return (left.text === ')' && left.type !== 'typeDeclarationParen') || isLiteral(left)
  if (left.type === 'pointerOrReference') {
    if (isLiteral(right)) return true
    if (is(right, 'noexcept') || right.type === 'requiresClause' || (right.kind === 'identifier' && is(right, 'override', 'final'))) return right.type !== 'startOfName'
    if (right.text === '(') return false
    return left.prev !== undefined && !is(left.prev, '(', '[')
  }
  if (left.text === '...' && isPointerOrReferenceKind(left.prev)) return true
  if (left.text === '[' || right.text === ']') return false
  if (right.text === '[' && right.type !== 'attributeLSquare') return false
  if (left.text === '{' || right.text === '}') return false
  if (left.type === 'templateCloser' && right.type === 'attributeLSquare') return true
  if (right.text === '(') return left.type === 'attributeRSquare' || left.text === ';'
  if (right.type === 'unaryOperator') return !is(left, '(', '[', '@')
  if ((left.kind === 'identifier' || is(left, '>', ']', ')') || isTypeName(left)) && right.text === '{') return false
  return true
}

/** TokenAnnotator::mustBreakBefore under RequiresClausePosition OwnLine. */
function mustBreakBefore(right: Tok): boolean {
  if (right.type === 'requiresClause') return true
  return right.prev!.closesRequires && right.text !== ';'
}

/** TokenAnnotator::canBreakBefore for the tokens a declaration contains. */
function canBreakBefore(declaration: Declaration, right: Tok): boolean {
  const left = right.prev!
  if (right.text === '}' || right.text === ')' || right.type === 'templateCloser' || right.type === 'pointerOrReference') return false
  if (right.type === 'startOfName' || right.type === 'functionDeclarationName') return true
  if (left.type === 'pointerOrReference') return false
  if (right.type === 'requiresClause') return true
  if (left.closesTemplate) return true
  if (left.closesRequires) return true
  if (left.type === 'templateCloser' && right.type === 'templateOpener') return true
  if (left.text === '>' && right.text === '>') return false
  if (left.type === 'templateCloser' || left.type === 'unaryOperator') return false
  if (left.text === '=' && !is(right, 'default', 'delete') && declaration.virtual && left.nesting === 0) return false
  if (left.type === 'typeDeclarationParen' && left.text === '(') return false
  if (left.text === '(' && left.prev?.type === 'binaryOperator') return false
  if (left.type === 'trailingAnnotation') return !is(right, '{', ';', '=', '(', '<', '::')
  if (right.type === 'attributeLSquare') return true
  if (right.text === 'typename' && left.text !== 'const') return true
  if (isBinaryOperatorKind(left) || left.type === 'binaryOperator') return true
  if (left.type === 'attributeLSquare' && right.text === '[') return false
  if (left.text === ']' && right.type === 'attributeRSquare') return false
  if (right.text === 'noexcept' && right.type === 'trailingAnnotation') return false
  return is(left, ',', '::', ';', '{', 'class', 'struct') || right.type === 'trailingReturnArrow' || right.text === '[' ||
    (left.text === ')' && (right.kind === 'identifier' || right.text === 'const')) || (left.text === '(' && right.text !== ')') ||
    left.type === 'templateOpener'
}

/** TokenAnnotator::splitPenalty, before binding strength is added. */
function splitPenalty(right: Tok): number {
  const left = right.prev!
  if (left.text === ';') return 0
  if (right.text === '[' && right.type !== 'attributeLSquare') return left.text === ']' ? 200 : 500
  if (left.text === '::') return PENALTY_SCOPE_RESOLUTION
  if (right.type === 'startOfName' || right.type === 'functionDeclarationName') {
    if (left.type === 'startOfName') return 110
    return right.nesting === 0 ? PENALTY_RETURN_TYPE : 200
  }
  if (right.type === 'pointerOrReference') return 190
  if (left.text === '=' && right.text === '{') return 160
  if (is(left, 'class', 'struct', 'union')) return 5000
  if (right.type === 'trailingAnnotation' && right.next?.text !== '(') return (left.text === ')' ? 100 : 120) + (right.text.length < 10 ? 50 : 0)
  if (left.text === '(') return 100
  if (left.text === '=') return 110
  if (right.text === '}') return 1
  if (left.type === 'templateOpener') return 100
  if (opensScope(left)) return left.parameterCount > 1 ? PENALTY_FIRST_PARAMETER : 19
  if (left.type === 'unaryOperator') return 60
  if (left.text === ',') return 1
  if (left.closesTemplate) return PENALTY_TEMPLATE_DECLARATION
  if (left.closesRequires) return 0
  let level = precedence(left)
  if (level === 0) level = precedence(right)
  if (level === ASSIGNMENT) return PENALTY_ASSIGNMENT
  return level !== 0 ? level : 3
}

/** TokenAnnotator's ExpressionParser: fake parentheses and operator chains. */
function parseExpressions(declaration: Declaration): void {
  const unary = 16
  const arrowAndPeriod = 17
  const last = declaration.tokens.at(-1)!
  let current: Tok | undefined = declaration.tokens[0]
  const currentPrecedence = (): number => {
    if (!current) return -1
    if (current.text === ';') return 0
    if (current.type === 'binaryOperator' || current.text === ',') return precedence(current)
    return -1
  }
  const addFake = (start: Tok, level: number, end?: Tok) => {
    start.fakeL.push(level)
    if (level > 0) start.startsBinaryExpression = true
    const closing = end ?? current?.prev
    if (closing) {
      closing.fakeR++
      if (level > 0) closing.endsBinaryExpression = true
    }
  }
  const parse = (level = 0): void => {
    if (!current || level > arrowAndPeriod) return
    if (level === 3) {
      // Conditional expressions do not occur in declarations, but the level still recurses.
      parse(4)
      return
    }
    if (level === unary) {
      const operators: Tok[] = []
      while (current?.type === 'unaryOperator') { operators.push(current); current = current.next }
      parse(arrowAndPeriod)
      for (const operator of operators.reverse()) addFake(operator, 0)
      return
    }
    const start = current
    let latest: Tok | undefined
    let operatorIndex = 0
    while (current) {
      parse(level + 1)
      const at = currentPrecedence()
      if (!current || (closesScope(current) && current.matching) || (at !== -1 && at < level)) break
      if (opensScope(current) || current.type === 'requiresClause') {
        while (current && (!closesScope(current) || opensScope(current))) { current = current.next; parse() }
        current = current?.next
      } else {
        if (at === level) {
          if (latest) latest.nextOperator = current
          latest = current
          current.operatorIndex = operatorIndex++
        }
        current = current.next
      }
    }
    if (latest && (current || level > 0)) {
      let end: Tok | undefined
      if (start.prev?.type === 'requiresClause') {
        end = current ?? last
        while (!end.closesRequires && end.prev) end = end.prev
      }
      addFake(start, level === arrowAndPeriod ? 0 : level, end)
    }
  }
  parse()
}

function annotate(raw: string): Declaration {
  const tokens = lex(raw)
  if (tokens.at(-1)?.text !== ';') unsupported(raw, 'missing terminating semicolon')
  structure(raw, tokens)
  const declaration = classify(raw, tokens)
  for (const token of tokens.slice(1)) {
    token.spaces = spaceRequiredBefore(token) ? 1 : 0
    token.mustBreak = mustBreakBefore(token)
    token.canBreak = token.mustBreak || canBreakBefore(declaration, token)
    token.splitPenalty = splitPenalty(token) + 20 * token.binding
  }
  parseExpressions(declaration)
  return declaration
}

interface Paren {
  open?: Tok
  indent: number
  alignedTo?: Tok
  lastSpace: number
  nestedBlockIndent: number
  startOfFunctionCall: number
  variablePos: number
  precedence: number
  avoidBinPacking: boolean
  breakBeforeParameter: boolean
  noLineBreak: boolean
  noLineBreakInOperand: boolean
  lastOperatorWrapped: boolean
  containsLineBreak: boolean
  nestedBlockInlined: boolean
}

interface State {
  column: number
  next?: Tok
  noContinuation: boolean
  startOfLineLevel: number
  lowestLevelOnLine: number
  startOfStringLiteral: number
  stack: Paren[]
  ignoreStack: boolean
}

const newParen = (open: Tok | undefined, indent: number, lastSpace: number, avoidBinPacking: boolean, noLineBreak: boolean): Paren => ({
  open, indent, lastSpace, nestedBlockIndent: indent, startOfFunctionCall: 0, variablePos: 0, precedence: 0,
  avoidBinPacking, breakBeforeParameter: false, noLineBreak, noLineBreakInOperand: false,
  lastOperatorWrapped: true, containsLineBreak: false, nestedBlockInlined: false,
})

const cloneState = (state: State): State => ({ ...state, stack: state.stack.map((paren) => ({ ...paren })) })

/** ContinuationIndenter, reduced to the options this project sets. */
class Indenter {
  constructor(private readonly declaration: Declaration, private readonly limit: number, private readonly firstIndent: number) {}

  initialState(): State {
    const state: State = {
      column: this.firstIndent, next: this.declaration.tokens[0], noContinuation: false, startOfLineLevel: 0, lowestLevelOnLine: 0,
      startOfStringLiteral: 0, stack: [newParen(undefined, this.firstIndent, this.firstIndent, false, false)], ignoreStack: false,
    }
    this.moveStateToNextToken(state, false)
    return state
  }

  canBreak(state: State): boolean {
    const current = state.next!
    const previous = current.prev!
    const top = state.stack.at(-1)!
    if (!current.canBreak) return false
    // The first element of a nested braced list stays with its brace.
    if (!current.mustBreak && previous.text === '{' && is(previous.prev, '{', '(', ',')) return false
    if (opensScope(previous) && previous.text !== '{' && state.lowestLevelOnLine < state.startOfLineLevel && state.lowestLevelOnLine < current.nesting) return false
    // A very short return type such as `int` is not worth a line of its own.
    if (current.type === 'functionDeclarationName' && state.column < 6) return false
    if (!(current.type === 'binaryOperator' || current.text === ',') && top.noLineBreakInOperand) return false
    return !top.noLineBreak
  }

  mustBreak(state: State): boolean {
    const current = state.next!
    const previous = current.prev!
    const top = state.stack.at(-1)!
    if (current.mustBreak) return true
    if ((previous.text === ',' || previous.text === ';' ||
        (previous.type === 'templateCloser' && current.type === 'startOfName' && this.declaration.tokens[0]!.type !== 'attributeLSquare')) &&
      top.breakBeforeParameter && !is(current, ')', '}')) return true
    const newLineColumn = this.newLineColumn(state)
    if (previous.closesTemplate && top.breakBeforeParameter && current.canBreak) return true
    if (state.column <= newLineColumn) return false
    if (previous.type === 'binaryOperator' && current.canBreak) {
      const level = precedence(previous)
      if (level !== ASSIGNMENT && top.breakBeforeParameter) {
        if (previous.prev?.endsBinaryExpression) return true
        const comparison = (level === 10 || level === 9 || level === 11) && previous.prev && previous.prev.type !== 'binaryOperator'
        if (!comparison) return true
      }
    } else if (current.type === 'binaryOperator' && current.canBreak && precedence(current) !== ASSIGNMENT && top.breakBeforeParameter) return true
    // Break after `template <...>` whenever the declaration does not fit on one line.
    if (current.nesting === 0 && previous.closesTemplate) return true
    if (current.type === 'functionDeclarationName' && previous.text !== 'template' && top.breakBeforeParameter) return true
    return state.noContinuation
  }

  /** The column a token takes when it starts a continuation line. */
  newLineColumn(state: State): number {
    const current = state.next!
    const previous = current.prev!
    const top = state.stack.at(-1)!
    const parent = state.stack[state.stack.length - 2]
    const continuation = Math.max(top.lastSpace, top.indent) + CONTINUATION
    if (is(current, '}', ']') && state.stack.length > 1) {
      if (current.matching?.text === '{') {
        if ((state.stack.length === 2 && current.matching.prev?.type === 'startOfName') || (state.stack.length === 3 && state.stack[1]!.precedence === ASSIGNMENT)) return this.firstIndent
        return parent!.lastSpace
      }
      return this.firstIndent
    }
    if (current.text === ')' && state.stack.length > 1 && (!current.next || is(current.next, ';', 'const', '{'))) return parent!.lastSpace
    if (current.kind === 'string' && state.startOfStringLiteral !== 0) return state.startOfStringLiteral
    if (previous.text === ',' && top.variablePos !== 0) return top.variablePos
    if (current.type === 'requiresClause') return top.indent + INDENT
    if (previous.closesTemplate || previous.closesRequires || previous.type === 'attributeRSquare' || current.type === 'functionDeclarationName') return Math.max(top.lastSpace, top.indent)
    if (current.type === 'startOfName' || current.type === 'pointerOrReference' || is(previous, '::', '=')) return continuation
    if (previous.text === ')' && !isBinaryOperatorKind(current) && current.text !== ':') return continuation
    if (top.indent === this.firstIndent && !is(previous, '}')) return top.indent + CONTINUATION
    return top.indent
  }

  addTokenToState(state: State, newline: boolean): number {
    state.noContinuation = false
    const penalty = newline ? this.addTokenOnNewLine(state) : (this.addTokenOnCurrentLine(state), 0)
    return this.moveStateToNextToken(state, newline) + penalty
  }

  private addTokenOnCurrentLine(state: State): void {
    const current = state.next!
    const previous = current.prev!
    const top = state.stack.at(-1)!
    if (current.text === '=' && current.nesting === 0 && top.variablePos === 0) {
      top.variablePos = state.column
      for (let at: Tok | undefined = previous; at && top.variablePos >= width(at); at = at.prev) {
        top.variablePos -= width(at)
        if (at.spaces !== 0) break
      }
    }
    // Align following lines within an opened bracket.
    if (opensScope(previous)) {
      top.indent = state.column + current.spaces
      top.alignedTo = previous
    }
    // Keep each operand of a chain on one line unless the chain has two operands.
    if ((previous.type === 'binaryOperator' || previous.text === ',') && ![ASSIGNMENT, 10, 11].includes(precedence(previous))) {
      const hasTwoOperands = previous.operatorIndex === 0 && !previous.nextOperator
      if (!hasTwoOperands) top.noLineBreakInOperand = true
    }
    state.column += current.spaces
    if (previous.text === ',') top.lastSpace = state.column
    else if (previous.type === 'binaryOperator' && (precedence(previous) !== ASSIGNMENT || current.startsBinaryExpression)) top.lastSpace = state.column
  }

  private addTokenOnNewLine(state: State): number {
    const current = state.next!
    const previous = current.prev!
    const top = state.stack.at(-1)!
    let penalty = 0
    if (!top.containsLineBreak) penalty += 15
    top.containsLineBreak = true
    penalty += current.splitPenalty
    state.column = this.newLineColumn(state)
    top.nestedBlockIndent = state.column
    if ((previous.text === ',' && !top.avoidBinPacking) || previous.text === ';' || previous.type === 'binaryOperator') top.breakBeforeParameter = false
    if (previous.type === 'templateCloser' || previous.closesRequires) {
      if (current.nesting === 0) top.breakBeforeParameter = false
    }
    if (current.type === 'binaryOperator' && current.canBreak) {
      top.breakBeforeParameter = false
      top.alignedTo = current
    }
    top.lastSpace = state.column
    state.startOfLineLevel = current.nesting
    state.lowestLevelOnLine = current.nesting
    // A break on any level means the levels around it must not bin-pack.
    for (const paren of state.stack.slice(0, -1)) paren.breakBeforeParameter = true
    if (!is(previous, ',', ':', ';') && (previous.type !== 'templateCloser' && !previous.closesRequires || current.nesting !== 0) &&
      previous.type !== 'binaryOperator' && current.type !== 'binaryOperator' && !opensScope(previous)) top.breakBeforeParameter = true
    if (top.avoidBinPacking) {
      if (!is(previous, '(', '{') && previous.type !== 'binaryOperator') top.breakBeforeParameter = true
    }
    return penalty
  }

  private moveStateToNextToken(state: State, newline: boolean): number {
    const current = state.next!
    const top = state.stack.at(-1)!
    if (current.text === ',' || current.type === 'binaryOperator') top.noLineBreakInOperand = false
    if (current.type === 'binaryOperator') top.lastOperatorWrapped = newline
    if (!opensScope(current) && !closesScope(current) && current.type !== 'pointerOrReference') {
      state.lowestLevelOnLine = Math.min(state.lowestLevelOnLine, current.nesting)
    }
    if (current.type === 'binaryOperator' && newline) top.nestedBlockIndent = state.column + width(current) + 1
    const previous = current.prev
    if (previous?.text === '{' && state.stack.length > 1) {
      const parent = state.stack[state.stack.length - 2]!
      if (parent.nestedBlockInlined && newline) for (const paren of state.stack.slice(0, -1)) paren.noLineBreak = true
      parent.nestedBlockInlined = false
    }
    if (previous && (previous.type === 'binaryOperator' || is(previous, '(', ','))) {
      top.nestedBlockInlined = !newline && (previous.text !== '(' || previous.parameterCount > 1)
    }
    this.moveStatePastFakeLParens(state)
    this.moveStatePastScopeCloser(state, current)
    this.moveStatePastScopeOpener(state, current)
    this.moveStatePastFakeRParens(state, current)
    if (current.kind === 'string' && state.startOfStringLiteral === 0) state.startOfStringLiteral = state.column
    else if (current.kind !== 'identifier' && current.kind !== 'string') state.startOfStringLiteral = 0
    state.column += width(current)
    state.next = current.next
    return state.column > this.limit ? PENALTY_EXCESS * (state.column - this.limit) : 0
  }

  private moveStatePastFakeLParens(state: State): void {
    const current = state.next!
    if (!current.fakeL.length) return
    const previous = current.prev
    let skipFirstExtraIndent = previous !== undefined && (opensScope(previous) || is(previous, ';', 'return') || previous.type === 'requiresClause' || precedence(previous) === ASSIGNMENT)
    for (const level of [...current.fakeL].reverse()) {
      const parent = state.stack.at(-1)!
      const paren: Paren = { ...parent, open: undefined, containsLineBreak: false, lastOperatorWrapped: true, precedence: level }
      paren.noLineBreak = parent.noLineBreak || parent.noLineBreakInOperand
      if (level > 1) paren.avoidBinPacking = false
      if (!previous || previous.text !== 'return' || level > 0) paren.indent = Math.max(state.column, paren.indent, parent.lastSpace)
      if (level > 0) paren.lastSpace = Math.max(paren.lastSpace, state.column)
      if (level !== 3 && current.type !== 'unaryOperator') paren.startOfFunctionCall = state.column
      if (level === 3 || (!skipFirstExtraIndent && level > ASSIGNMENT)) paren.indent += CONTINUATION
      if ((previous && !opensScope(previous)) || level !== 1) paren.breakBeforeParameter = false
      state.stack.push(paren)
      skipFirstExtraIndent = false
    }
  }

  private moveStatePastScopeCloser(state: State, current: Tok): void {
    if (!closesScope(current)) return
    if (state.stack.length > 1 && (is(current, ')', ']') || (current.text === '}' && current !== this.declaration.tokens[0]) || current.type === 'templateCloser')) state.stack.pop()
  }

  private moveStatePastScopeOpener(state: State, current: Tok): void {
    if (!opensScope(current)) return
    const parent = state.stack.at(-1)!
    let indent: number
    let lastSpace = parent.lastSpace
    let breakBeforeParameter = false
    let avoidBinPacking = false
    let nestedBlockIndent = Math.max(parent.startOfFunctionCall, parent.nestedBlockIndent)
    if (current.text === '{') {
      indent = parent.lastSpace + CONTINUATION
      avoidBinPacking = breakBeforeParameter = current.matching?.prev?.text === ','
      if (current.parameterCount > 1) nestedBlockIndent = Math.max(nestedBlockIndent, state.column + 1)
    } else {
      indent = Math.max(parent.lastSpace, parent.startOfFunctionCall) + CONTINUATION
      // A template argument list inside parentheses aligns with the enclosing parameter.
      if (current.text === '<' && current.parentBracket === '(') {
        indent = Math.max(indent, parent.indent)
        lastSpace = Math.max(lastSpace, parent.indent)
      }
    }
    const paren = newParen(current, indent, lastSpace, avoidBinPacking, parent.noLineBreak || parent.noLineBreakInOperand)
    paren.nestedBlockIndent = nestedBlockIndent
    paren.breakBeforeParameter = breakBeforeParameter
    state.stack.push(paren)
  }

  private moveStatePastFakeRParens(state: State, current: Tok): void {
    for (let count = 0; count < current.fakeR; count++) {
      const variablePos = state.stack.at(-1)!.variablePos
      if (state.stack.length === 1) break
      state.stack.pop()
      state.stack.at(-1)!.variablePos = variablePos
    }
    // The requires clause indent is held in LastSpace.
    if (current.closesRequires) state.stack.at(-1)!.lastSpace -= INDENT
  }
}

const stateKey = (state: State): string => {
  const head = [state.next?.index ?? -1, state.column, state.noContinuation, state.startOfLineLevel, state.lowestLevelOnLine, state.startOfStringLiteral]
  if (state.ignoreStack) return head.join(',')
  return `${head.join(',')}|${state.stack.map((paren) => [
    paren.indent, paren.lastSpace, paren.nestedBlockIndent, paren.alignedTo?.index ?? -1, paren.avoidBinPacking, paren.breakBeforeParameter,
    paren.noLineBreak, paren.lastOperatorWrapped, paren.startOfFunctionCall, paren.variablePos, paren.containsLineBreak, paren.nestedBlockInlined,
  ].join(',')).join(';')}`
}

interface Node {
  state: State
  token?: Tok
  newline: boolean
  indent: number
  parent?: Node
}

/** Dijkstra over line-break decisions, ordered by penalty then creation order as clang's OptimizingLineFormatter. */
function solve(raw: string, declaration: Declaration, columns: number, firstIndent: number): Node {
  const indenter = new Indenter(declaration, columns, firstIndent)
  const heap: { penalty: number; count: number; node: Node }[] = []
  const less = (a: typeof heap[number], b: typeof heap[number]) => a.penalty < b.penalty || (a.penalty === b.penalty && a.count < b.count)
  const push = (item: typeof heap[number]) => {
    heap.push(item)
    for (let at = heap.length - 1; at > 0;) {
      const parent = (at - 1) >> 1
      if (!less(heap[at]!, heap[parent]!)) break
      ;[heap[at], heap[parent]] = [heap[parent]!, heap[at]!]
      at = parent
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let at = 0;;) {
        const left = 2 * at + 1
        const right = left + 1
        let smallest = at
        if (left < heap.length && less(heap[left]!, heap[smallest]!)) smallest = left
        if (right < heap.length && less(heap[right]!, heap[smallest]!)) smallest = right
        if (smallest === at) break
        ;[heap[at], heap[smallest]] = [heap[smallest]!, heap[at]!]
        at = smallest
      }
    }
    return top
  }
  let count = 0
  push({ penalty: 0, count: count++, node: { state: indenter.initialState(), newline: false, indent: firstIndent } })
  const seen = new Set<string>()
  while (heap.length) {
    const best = heap[0]!
    if (!best.node.state.next) return best.node
    pop()
    if (count > SEARCH_LIMIT) best.node.state.ignoreStack = true
    const key = stateKey(best.node.state)
    if (seen.has(key)) continue
    seen.add(key)
    for (const newline of [false, true]) {
      const state = best.node.state
      if (newline ? !indenter.canBreak(state) : indenter.mustBreak(state)) continue
      const next = cloneState(state)
      const token = next.next!
      const penalty = best.penalty + indenter.addTokenToState(next, newline)
      push({ penalty, count: count++, node: { state: next, token, newline, indent: next.column - width(token), parent: best.node } })
    }
  }
  return unsupported(raw, 'no layout satisfies the break rules')
}

interface Formatted {
  declaration: Declaration
  text: string
  /** Start offset of each token in `text`. */
  offsets: number[]
}

function format(raw: string, columns: number): Formatted {
  const declaration = annotate(raw)
  // A declaration that fits keeps one line; the search only runs for the rest.
  const length = declaration.tokens.reduce((total, token) => total + width(token) + (token.index ? token.spaces : 0), 0)
  const fits = !declaration.tokens.some((token) => token.mustBreak) && length <= columns
  const breaks = new Map<number, number>()
  if (!fits) {
    for (let node: Node | undefined = solve(raw, declaration, columns + INDENT, INDENT); node?.token; node = node.parent) {
      if (node.newline) breaks.set(node.token.index, node.indent - INDENT)
    }
  }
  let text = ''
  const offsets: number[] = []
  for (const token of declaration.tokens) {
    if (token.index) text += breaks.has(token.index) ? `\n${' '.repeat(breaks.get(token.index)!)}` : ' '.repeat(token.spaces)
    offsets.push(text.length)
    text += token.text
  }
  const again = lex(text)
  if (again.length !== declaration.tokens.length || again.some((token, index) => token.text !== declaration.tokens[index]!.text)) {
    throw new Error(`Formatting changed C++ callable header grammar: ${raw}`)
  }
  return { declaration, text, offsets }
}

/** Format one declaration as clang-format does at `columns` printed columns. */
export function formatCxxDeclaration(raw: string, columns: number): string {
  return format(raw, columns).text
}

/** Items of the bracket pair `open` encloses, split at its top-level commas. */
function items(open: Tok): Tok[][] {
  const result: Tok[][] = []
  let item: Tok[] = []
  for (let token = open.next; token && token !== open.matching; token = token.next) {
    if (token.text === ',' && token.nesting === open.nesting + 1) { result.push(item); item = [] } else item.push(token)
  }
  if (item.length) result.push(item)
  return result
}

/** The token that names a declaration in one comma-separated item, if it has one. */
function declaredName(item: Tok[]): Tok | undefined {
  const end = item.findIndex((token) => token.text === '=' && token.nesting === item[0]!.nesting)
  const parts = end === -1 ? item : item.slice(0, end)
  const last = parts.at(-1)
  return parts.length > 1 && last?.kind === 'identifier' && !is(last.prev, '::', '<') ? last : undefined
}

/** Source ranges that are declarations or syntax rather than references, in output coordinates. */
function syntaxRanges(symbol: ApiSymbol, signature: Signature, { declaration, offsets }: Formatted): CodeSyntax[] {
  const raw = signature.raw!
  const claimed = new Map<Tok, CodeSyntax>()
  const claim = (from: Tok, to: Tok, syntax: { kind: 'name' | 'literal' } | { kind: 'parameter'; parameter: number }) => {
    const range = { start: offsets[from.index]!, end: offsets[to.index]! + width(to), ...syntax }
    for (let token: Tok | undefined = from; token; token = token === to ? undefined : token.next) claimed.set(token, range)
  }
  const declared = declaration.open.prev
  if (declared?.kind !== 'identifier') return unsupported(raw, 'declaration name')
  const nameStart = declared.prev?.text === '~' ? declared.prev : declared
  const spelling = raw.slice(nameStart.start, declared.end)
  if (spelling !== symbol.name) throw new Error(`C++ declaration name does not match ${symbol.id}: ${spelling}`)
  claim(nameStart, declared, { kind: 'name' })

  let parameters = items(declaration.open)
  if (parameters.length === 1 && parameters[0]!.length === 1 && parameters[0]![0]!.text === 'void') parameters = []
  if (parameters.length !== signature.params.length) throw new Error(`C++ parameter list does not match ${symbol.id}: ${raw}`)
  parameters.forEach((item, parameter) => {
    const name = declaredName(item)
    // An unnamed parameter keeps the model's spelling of its type as its label.
    if (name && signature.params[parameter]!.name === name.text) claim(name, name, { kind: 'parameter', parameter })
  })

  // Names bound by a template header are declarations, not references to other APIs.
  const bound = new Set<string>()
  for (let at = 0; declaration.tokens[at]?.text === 'template'; at = declaration.tokens[at + 1]!.matching!.index + 1) {
    for (const item of items(declaration.tokens[at + 1]!)) {
      const name = declaredName(item)
      if (name) bound.add(name.text)
    }
  }
  for (const token of declaration.tokens) {
    if (token.kind === 'identifier' && bound.has(token.text) && !claimed.has(token) && token.prev?.text !== '::') claim(token, token, { kind: 'literal' })
  }
  return [...new Set(claimed.values())].sort((a, b) => a.start - b.start)
}

const layouts = new Map<string, Promise<CodeLayout>>()

/** Lay out one C++ declaration at the API budget, keeping its source tokens and roles. */
export function cxxSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = (async () => {
      const formatted = format(signature.raw!, CODE_COLUMNS.api)
      return { text: formatted.text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(formatted.text, 'api'), syntax: syntaxRanges(symbol, signature, formatted) }
    })()
    layouts.set(key, pending)
  }
  return pending
}
