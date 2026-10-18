import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { doc } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type Doc = doc.builders.Doc
const { group, ifBreak, indent, join, line, softline } = doc.builders
const layouts = new Map<string, Promise<CodeLayout>>()

interface Token { kind: 'name' | 'string' | 'number' | 'code' | 'punct'; text: string; start: number; end: number }
/** A type's token range is `[start, end)`; only function, table and tuple types are broken. */
type Type =
  | { type: 'atom'; start: number; end: number }
  | { type: 'function'; node: FunctionType }
  | { type: 'table'; fields: { key: Token[]; value: Type }[] }
  | { type: 'tuple'; items: Type[] }
interface Argument { name: Token; optional: boolean; value?: Type }
interface FunctionType {
  generics?: { start: number; end: number }
  arguments: Argument[]
  returns: { name?: Token; value: Type }[]
}
interface Parsed {
  tokens: Token[]
  root: FunctionType
  /** Every `fun` keyword, including those inside a larger type. */
  keywords: Token[]
  /** Argument, field and result labels, which declare names rather than refer to types. */
  labels: Token[]
  literals: Token[]
  variables: Token[]
}

const lexer = /\s+|(?<name>\.\.\.|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<number>-?\d+(?:\.\d+)?)|(?<code>`[^`]*`)|(?<punct>[()[\]{}<>,:;?|])/gy

function tokenize(source: string, from: number): Token[] {
  const tokens: Token[] = []
  lexer.lastIndex = from
  while (lexer.lastIndex < source.length) {
    const start = lexer.lastIndex
    const match = lexer.exec(source)
    if (!match) throw new Error(`Invalid LuaCATS function type grammar at ${start}: ${source}`)
    const kind = (['name', 'string', 'number', 'code', 'punct'] as const).find((name) => match.groups![name] !== undefined)
    if (kind) tokens.push({ kind, text: match[0], start, end: lexer.lastIndex })
  }
  return tokens
}

/**
 * Read a `fun(...)` type the way LuaLS's luadoc parser does. A nested
 * function type takes every following `, type` as one of its results,
 * unless the next words are an argument's `name:`.
 */
function parseFunctionType(source: string, from: number): Parsed {
  const tokens = tokenize(source, from)
  const parsed: Parsed = { tokens, root: undefined as unknown as FunctionType, keywords: [], labels: [], literals: [], variables: [] }
  let at = 0
  let depth = 0
  const fail = (): never => { throw new Error(`Invalid LuaCATS function type grammar at ${tokens[at]?.start ?? source.length}: ${source}`) }
  const is = (text: string, offset = 0): boolean => tokens[at + offset]?.kind === 'punct' && tokens[at + offset]!.text === text
  const take = (text?: string): Token => {
    const token = tokens[at]
    if (!token || (text !== undefined && token.text !== text)) return fail()
    at++
    return token
  }
  const accept = (text: string): Token | undefined => is(text) ? take() : undefined
  const labelled = (offset: number): boolean => tokens[at + offset]?.kind === 'name' && !tokens[at + offset]!.text.includes('.') &&
    (is(':', offset + 1) || (is('?', offset + 1) && is(':', offset + 2)))
  const closing = (): boolean => is(')') || is('}') || is(']')

  function unit(): Type {
    const start = at
    const token = tokens[at] ?? fail()
    if (token.kind === 'name' && token.text === 'fun' && (is('(', 1) || is('<', 1))) {
      return { type: 'function', node: functionType() }
    }
    if (accept('{')) {
      const fields: { key: Token[]; value: Type }[] = []
      while (!is('}')) {
        const key: Token[] = []
        if (accept('[')) {
          const open = at
          typeUnion()
          key.push(...tokens.slice(open, at))
          take(']')
        } else key.push(take())
        if (is('?')) key.push(take())
        take(':')
        if (key.length === 1 && key[0]!.kind === 'name') parsed.labels.push(key[0]!)
        fields.push({ key, value: typeUnion() })
        if (!accept(',') && !accept(';')) break
      }
      take('}')
      return { type: 'table', fields }
    }
    if (accept('[')) {
      const items: Type[] = []
      while (!is(']')) {
        items.push(typeUnion())
        if (!accept(',') && !accept(';')) break
      }
      take(']')
      return { type: 'tuple', items }
    }
    if (accept('(')) {
      typeUnion()
      take(')')
    } else if (accept('<')) {
      const name = take()
      take('>')
      if (name.kind === 'name') parsed.variables.push(name)
    } else if (token.kind === 'string' || token.kind === 'number') {
      at++
      parsed.literals.push(token)
    } else if (token.kind === 'name' || token.kind === 'code') {
      at++
      if (token.kind === 'name' && /^[A-Z]\w*$/.test(token.text)) parsed.variables.push(token)
    } else fail()
    return { type: 'atom', start, end: at }
  }
  function member(): Type {
    const start = at
    let result = unit()
    while (true) {
      if (is('[') && is(']', 1)) at += 2
      else if (accept('?')) { /* optional suffix */ } else if (is('<') && at > start && tokens[at - 1]!.kind === 'name') {
        take('<')
        do typeUnion(); while (accept(','))
        take('>')
      } else break
      result = { type: 'atom', start, end: at }
    }
    return result
  }
  function typeUnion(): Type {
    const start = at
    const first = member()
    if (!is('|')) return first
    while (accept('|')) member()
    return { type: 'atom', start, end: at }
  }
  function functionType(): FunctionType {
    const nested = ++depth > 1
    parsed.keywords.push(take('fun'))
    let generics: FunctionType['generics']
    if (is('<')) {
      const open = take('<')
      do take(); while (accept(','))
      generics = { start: open.start, end: take('>').end }
    }
    take('(')
    const args: Argument[] = []
    while (!is(')')) {
      const name = take()
      if (name.kind !== 'name') fail()
      parsed.labels.push(name)
      const optional = Boolean(accept('?'))
      args.push({ name, optional, ...(accept(':') ? { value: typeUnion() } : {}) })
      if (!accept(',')) break
    }
    take(')')
    const returns: FunctionType['returns'] = []
    if (accept(':')) {
      while (true) {
        const name = tokens[at]?.kind === 'name' && !tokens[at]!.text.includes('.') && is(':', 1) ? take() : undefined
        if (name) {
          take(':')
          parsed.labels.push(name)
        }
        returns.push({ ...(name ? { name } : {}), value: typeUnion() })
        if (!is(',') || (nested && labelled(1))) break
        take(',')
        // A comma before a closing delimiter ends the list, as it does the arguments.
        if (closing()) break
      }
    }
    depth--
    return { ...(generics ? { generics } : {}), arguments: args, returns }
  }

  parsed.root = functionType()
  if (at !== tokens.length) fail()
  return parsed
}

/**
 * The break sites are the ones LuaLS's luadoc parser continues across
 * `---` lines: after `fun(`, between arguments, before `)` and `:`, and
 * between results. It reads a closing delimiter on a new line only after a
 * trailing comma, so a broken list ends with one; after a nested function's
 * results it reads the comma as another result and warns, with the type
 * unchanged. Generic arguments and unions have no break site and stay whole.
 */
function printDeclaration(prefix: string, source: string, parsed: Parsed): string {
  const print = (type: Type): Doc => {
    switch (type.type) {
      case 'atom': return source.slice(parsed.tokens[type.start]!.start, parsed.tokens[type.end - 1]!.end)
      case 'function': return printFunction(type.node)
      case 'table': return type.fields.length
        ? group(['{', indent([line, join([',', line], type.fields.map((field) => [field.key.map((token) => token.text).join(''), ': ', print(field.value)]))]),
          ifBreak(','), line, '}'])
        : '{}'
      case 'tuple': return type.items.length
        ? group(['[', indent([softline, join([',', line], type.items.map(print))]), ifBreak(','), softline, ']'])
        : '[]'
    }
  }
  function printFunction(node: FunctionType): Doc {
    const generics = node.generics ? source.slice(node.generics.start, node.generics.end) : ''
    const args = node.arguments.map((argument): Doc => [argument.name.text, argument.optional ? '?' : '', argument.value ? [': ', print(argument.value)] : ''])
    const results: Doc = node.returns.length
      ? [':', group(indent([softline, join([',', line], node.returns.map((result): Doc => [result.name ? `${result.name.text}: ` : '', print(result.value)]))]))]
      : ''
    return group(['fun', generics, '(', args.length ? [indent([softline, join([',', line], args)]), ifBreak(','), softline] : '', ')', results])
  }
  return doc.printer.printDocToString([prefix, printFunction(parsed.root)], {
    printWidth: CODE_COLUMNS.api, tabWidth: 2, useTabs: false,
  }).formatted
}

/** A module function has no `fun` view; write one from its documented parameters, as the extractor does. */
function functionSource(signature: Signature): string {
  const raw = signature.raw?.trim() ?? ''
  if (/^fun\s*[(<]/.test(raw)) return raw
  if (raw !== 'function') throw new Error(`Unsupported Lua callable type: ${raw}`)
  const params = signature.params.map((param) => `${param.variadic ? '...' : param.name}${param.type ? `: ${param.type}` : ''}`)
  return `fun(${params.join(', ')})${signature.returns ? `:${signature.returns}` : ''}`
}

/** Trailing commas appear with layout; every other token must survive. */
function withoutTrailingCommas(texts: string[]): string[] {
  return texts.filter((text, index) => !(text === ',' && [')', '}', ']'].includes(texts[index + 1] ?? '')))
}

function syntaxRanges(parsed: Parsed, name: string, signature: Signature): CodeSyntax[] {
  const syntax: CodeSyntax[] = [{ start: 0, end: name.length, kind: 'name' }]
  const literal = (token: Token) => syntax.push({ start: token.start, end: token.end, kind: 'literal' })
  for (const token of parsed.keywords) syntax.push({ start: token.start, end: token.end, kind: 'keyword' })
  const top = new Set(parsed.root.arguments.map((argument) => argument.name.start))
  for (const token of parsed.labels) {
    const index = top.has(token.start) ? signature.params.findIndex((param) => param.name === token.text) : -1
    // The receiver is spelled as a parameter but never listed, so it has no anchor.
    if (index !== -1 && !(index === 0 && token.text === 'self' && !signature.params[0]!.doc)) syntax.push({ start: token.start, end: token.end, kind: 'parameter', parameter: index })
    else literal(token)
  }
  parsed.literals.forEach(literal)
  parsed.variables.forEach(literal)
  return syntax.sort((a, b) => a.start - b.start)
}

/** Lay out a LuaCATS member: `name: fun(self: Class, ...):results`. */
export function luaSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.returns, signature.params.map((param) => [param.name, param.type, Boolean(param.doc)]), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const source = functionSource(signature)
  const prefix = `${symbol.name}: `
  const parsed = parseFunctionType(source, 0)
  const text = printDeclaration(prefix, source, parsed)
  const written = tokenize(text, prefix.length).map((token) => token.text)
  if (JSON.stringify(withoutTrailingCommas(written)) !== JSON.stringify(withoutTrailingCommas(parsed.tokens.map((token) => token.text)))) {
    throw new Error(`Formatting changed Lua function type grammar: ${signature.raw}`)
  }
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'),
    syntax: syntaxRanges(parseFunctionType(text, prefix.length), symbol.name, signature) }
}
