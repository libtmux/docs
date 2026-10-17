import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { doc } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type Doc = doc.builders.Doc
const { group, indent, join, line, softline } = doc.builders
const layouts = new Map<string, Promise<CodeLayout>>()

interface Token { kind: 'name' | 'symbol' | 'string' | 'integer' | 'punct'; text: string; start: number; end: number }
type Type =
  | { type: 'atom'; tokens: Token[] }
  | { type: 'application'; head: Token; args: Type[] }
  | { type: 'optional'; inner: Type; gap: string }
  | { type: 'union' | 'intersection'; members: Type[] }
  | { type: 'parenthesized'; inner: Type }
  | { type: 'tuple'; items: Type[] }
  | { type: 'record'; fields: { key: Token[]; value: Type }[] }
  | { type: 'proc'; signature: MethodShape }
interface Parameter { prefix: string; key?: Token; value: Type; name?: Token }
interface TypeParameter { prefix: Token[]; name: Token; bound?: Type }
interface MethodShape {
  typeParameters: TypeParameter[]
  /** `null` when the source writes no parameter list; `'untyped'` for `(?)`. */
  parameters: Parameter[] | 'untyped' | null
  block?: { optional: boolean; signature: MethodShape }
  returns: Type
}

/** RBS keywords, which a method name needs backticks to use, and the operators the RBS writer leaves bare. */
const KEYWORDS = new Set(['alias', 'attr_accessor', 'attr_reader', 'attr_writer', 'bool', 'bot', 'class', 'def', 'end', 'extend', 'false',
  'in', 'include', 'instance', 'interface', 'module', 'nil', 'out', 'prepend', 'private', 'public', 'self', 'singleton', 'top', 'true',
  'type', 'unchecked', 'untyped', 'void'])
const OPERATORS = new Set(['|', '^', '&', '<=>', '==', '===', '=~', '>', '>=', '<', '<=', '<<', '>>', '+', '-', '*', '/', '%', '**', '~', '+@',
  '-@', '[]', '[]=', '`', '!', '!=', '!~'])

const lexer = /\s+|(?<name>(?:::)?[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)|(?<symbol>:(?:[A-Za-z_]\w*[?!=]?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<integer>-?\d+)|(?<punct>->|=>|\*\*|[()[\]{},:|&?*^<])/gy

function tokenize(source: string, from: number): Token[] {
  const tokens: Token[] = []
  lexer.lastIndex = from
  while (lexer.lastIndex < source.length) {
    const start = lexer.lastIndex
    const match = lexer.exec(source)
    if (!match) throw new Error(`Invalid RBS method type grammar at ${start}: ${source}`)
    const kind = (['name', 'symbol', 'string', 'integer', 'punct'] as const).find((name) => match.groups![name] !== undefined)
    if (kind) tokens.push({ kind, text: match[0], start, end: lexer.lastIndex })
  }
  return tokens
}

/** Read the method types RBS::MethodType#to_s writes; a result is never a bare union, so it is parsed as an optional type. */
function parseMethodType(source: string, from: number): MethodShape {
  const tokens = tokenize(source, from)
  let at = 0
  const fail = (): never => { throw new Error(`Invalid RBS method type grammar at ${tokens[at]?.start ?? source.length}: ${source}`) }
  const peek = (offset = 0): Token | undefined => tokens[at + offset]
  const isPunct = (text: string, offset = 0): boolean => peek(offset)?.kind === 'punct' && peek(offset)!.text === text
  const take = (text?: string): Token => {
    const token = peek()
    if (!token || (text !== undefined && token.text !== text)) return fail()
    at++
    return token
  }
  const accept = (text: string): Token | undefined => isPunct(text) ? take() : undefined
  const list = <T>(close: string, item: () => T): T[] => {
    const items: T[] = []
    while (!isPunct(close)) {
      items.push(item())
      if (!accept(',')) break
    }
    take(close)
    return items
  }

  const primary = (): Type => {
    const token = peek() ?? fail()
    if (token.kind === 'symbol' || token.kind === 'string' || token.kind === 'integer') { at++; return { type: 'atom', tokens: [token] } }
    if (token.kind === 'name') {
      at++
      if (token.text === 'singleton' && isPunct('(')) return { type: 'atom', tokens: [token, take('('), take(), take(')')] }
      if (isPunct('[')) { take('['); return { type: 'application', head: token, args: list(']', typeUnion) } }
      return { type: 'atom', tokens: [token] }
    }
    if (accept('(')) { const inner = typeUnion(); take(')'); return { type: 'parenthesized', inner } }
    if (accept('[')) return { type: 'tuple', items: list(']', typeUnion) }
    if (accept('{')) {
      return { type: 'record', fields: list('}', () => {
        const first = take()
        const key = first.kind === 'name' && isPunct(':') ? [first, take(':')] : [first, take('=>')]
        return { key, value: typeUnion() }
      }) }
    }
    if (accept('^')) return { type: 'proc', signature: signature(false) }
    return fail()
  }
  const optional = (): Type => {
    let result = primary()
    while (isPunct('?')) {
      const mark = take()
      result = { type: 'optional', inner: result, gap: source.slice(tokens[at - 2]!.end, mark.start) }
    }
    return result
  }
  const intersection = (): Type => {
    const members = [optional()]
    while (accept('&')) members.push(optional())
    return members.length === 1 ? members[0]! : { type: 'intersection', members }
  }
  function typeUnion(): Type {
    const members = [intersection()]
    while (accept('|')) members.push(intersection())
    return members.length === 1 ? members[0]! : { type: 'union', members }
  }
  const parameter = (): Parameter => {
    const prefix = accept('**') ?? accept('*') ?? accept('?')
    const first = peek()
    if (first?.kind === 'name' && isPunct(':', 1)) {
      at += 2
      return { prefix: prefix?.text ?? '', key: first, value: typeUnion() }
    }
    const value = typeUnion()
    const next = peek()
    const name = next?.kind === 'name' && !isPunct(':', 1) ? take() : undefined
    return { prefix: prefix?.text ?? '', value, ...(name ? { name } : {}) }
  }
  function signature(typed: boolean): MethodShape {
    const typeParameters: TypeParameter[] = typed && accept('[') ? list(']', () => {
      const names: Token[] = []
      while (peek()?.kind === 'name' && ['unchecked', 'in', 'out'].includes(peek()!.text) && peek(1)?.kind === 'name') names.push(take())
      const name = take()
      return { prefix: names, name, ...(accept('<') ? { bound: typeUnion() } : {}) }
    }) : []
    let parameters: MethodShape['parameters'] = null
    if (accept('(')) {
      parameters = isPunct('?') && isPunct(')', 1) ? (at += 2, 'untyped') : list(')', parameter)
    }
    let block: MethodShape['block']
    const optionalBlock = isPunct('?') && isPunct('{', 1)
    if (optionalBlock) take()
    if (accept('{')) {
      block = { optional: optionalBlock, signature: signature(false) }
      take('}')
    }
    take('->')
    return { typeParameters, parameters, ...(block ? { block } : {}), returns: optional() }
  }
  const result = signature(true)
  if (at !== tokens.length) fail()
  return result
}

function tokensOf(source: string, from: number): string[] {
  return tokenize(source, from).map((token) => token.text)
}

/**
 * The layout of syntax_tree-rbs (`SyntaxTree::RBS::Format`): a method type is
 * one group whose parameters, block and result break together, and a record,
 * union or bracket list is a group of its own. It keeps the exporter's
 * punctuation, including `()` and the parentheses of RBS::MethodType#to_s,
 * and lets type-argument and tuple brackets break instead of overflowing.
 */
function printDeclaration(prefix: string, parsed: MethodShape): string {
  const text = (tokens: Token[]): string => tokens.map((token) => token.text).join('')
  const bracket = (open: string, items: Doc[]): Doc =>
    group([open, indent([softline, join([',', line], items)]), softline, open === '{' ? '}' : ']'])
  const members = (type: Type & { type: 'union' | 'intersection' }, level: boolean): Doc => {
    const operator = type.type === 'union' ? '| ' : '& '
    const contents = join([line, operator], type.members.map((member) => print(member)))
    return group(level ? ['(', indent([softline, contents]), softline, ')'] : contents)
  }
  function print(type: Type): Doc {
    switch (type.type) {
      case 'atom': return text(type.tokens)
      case 'application': return group([type.head.text, '[', indent([softline, join([',', line], type.args.map(print))]), softline, ']'])
      case 'optional': return [print(type.inner), type.gap, '?']
      case 'union': case 'intersection': return members(type, false)
      case 'parenthesized':
        return type.inner.type === 'union' || type.inner.type === 'intersection' ? members(type.inner, true) : ['(', print(type.inner), ')']
      case 'tuple': return type.items.length ? bracket('[', type.items.map(print)) : '[]'
      case 'record': return type.fields.length
        ? group(['{', indent([line, join([',', line], type.fields.map((field) => [text(field.key.slice(0, 1)), field.key[1]!.text === ':' ? ': ' : ' => ', print(field.value)]))]), line, '}'])
        : '{}'
      case 'proc': return group(['^', printSignature(type.signature)])
    }
  }
  function printSignature(signature: MethodShape): Doc {
    const parameters: Doc = signature.parameters === null ? ''
      : signature.parameters === 'untyped' ? '(?) '
        : signature.parameters.length === 0 ? '() '
          : ['(', indent([softline, join([',', line], signature.parameters.map((entry) =>
            [entry.prefix, entry.key ? [entry.key.text, ': '] : '', print(entry.value), entry.name ? [' ', entry.name.text] : '']))]), softline, ') ']
    const block: Doc = signature.block
      ? [signature.block.optional ? '?' : '', '{', indent([line, printSignature(signature.block.signature)]), line, '} '] : ''
    const typeParameters: Doc = signature.typeParameters.length ? ['[', join(', ', signature.typeParameters.map((entry) =>
      [entry.prefix.map((token) => `${token.text} `).join(''), entry.name.text, entry.bound ? [' < ', print(entry.bound)] : ''])), '] '] : ''
    return group([typeParameters, parameters, block, '-> ', print(signature.returns)])
  }
  return doc.printer.printDocToString([prefix, printSignature(parsed)], {
    printWidth: CODE_COLUMNS.api, tabWidth: 2, useTabs: false,
  }).formatted
}

function methodName(name: string): string {
  return KEYWORDS.has(name) || !(/^_?[A-Za-z_]\w*[?!=]?$/.test(name) || OPERATORS.has(name)) ? `\`${name}\`` : name
}

function syntaxRanges(text: string, from: number, signature: Signature, documented: ReadonlySet<string>): CodeSyntax[] {
  const syntax: CodeSyntax[] = []
  const declaration = /^def (self\.)?(`?)([^:`]+)\2:/.exec(text)!
  syntax.push({ start: 0, end: 3, kind: 'keyword' })
  if (declaration[1]) syntax.push({ start: 4, end: 8, kind: 'keyword' })
  const nameStart = 4 + (declaration[1]?.length ?? 0) + declaration[2]!.length
  syntax.push({ start: nameStart, end: nameStart + declaration[3]!.length, kind: 'name' })
  const literal = (token: Token) => syntax.push({ start: token.start, end: token.end, kind: 'literal' })
  const parsed = parseMethodType(text, from)
  const visitSignature = (current: MethodShape, top: boolean) => {
    for (const entry of current.typeParameters) {
      literal(entry.name)
    }
    if (Array.isArray(current.parameters)) for (const entry of current.parameters) {
      if (entry.key) {
        const index = top ? signature.params.findIndex((param) => param.name === entry.key!.text) : -1
        if (index !== -1 && documented.has(entry.key.text)) syntax.push({ start: entry.key.start, end: entry.key.end, kind: 'parameter', parameter: index })
        else literal(entry.key)
      }
      visit(entry.value)
    }
    for (const entry of current.typeParameters) if (entry.bound) visit(entry.bound)
    if (current.block) visitSignature(current.block.signature, false)
    visit(current.returns)
  }
  function visit(type: Type) {
    switch (type.type) {
      case 'atom':
        // Bare capitalized names are type variables; the exporter qualifies every class.
        if (type.tokens.length === 1 && (type.tokens[0]!.kind !== 'name' || /^[A-Z]\w*$/.test(type.tokens[0]!.text))) literal(type.tokens[0]!)
        break
      case 'application': type.args.forEach(visit); break
      case 'optional': visit(type.inner); break
      case 'union': case 'intersection': type.members.forEach(visit); break
      case 'parenthesized': visit(type.inner); break
      case 'tuple': type.items.forEach(visit); break
      case 'record': for (const field of type.fields) { literal(field.key[0]!); visit(field.value) } break
      case 'proc': visitSignature(type.signature, false); break
    }
  }
  visitSignature(parsed, true)
  return syntax.sort((a, b) => a.start - b.start)
}

/** Lay out an RBS method definition: `def name: (parameters) -> result`. */
export function rubySignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, symbol.modifiers.includes('static'), signature.raw, signature.params.map((param) => [param.name, Boolean(param.doc)]), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const prefix = `def ${symbol.modifiers.includes('static') ? 'self.' : ''}${methodName(symbol.name)}: `
  const parsed = parseMethodType(signature.raw!, 0)
  const text = printDeclaration(prefix, parsed)
  if (JSON.stringify(tokensOf(text, prefix.length)) !== JSON.stringify(tokensOf(signature.raw!, 0))) {
    throw new Error(`Formatting changed Ruby method type grammar: ${signature.raw}`)
  }
  const documented = new Set(signature.params.filter((param) => param.doc).map((param) => param.name))
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'),
    syntax: syntaxRanges(text, prefix.length, signature, documented) }
}
