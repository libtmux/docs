import { doc } from 'prettier'
import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, csharpParameters, type CSharpParameter, type CodeLayout, type CodeSyntax } from './code-layout'

type Doc = doc.builders.Doc
const { group, hardline, ifBreak, indent, indentIfBreak, join, line, softline } = doc.builders
const layouts = new Map<string, Promise<CodeLayout>>()

/*
 * C# declarations follow CSharpier's document structure: parameter, type
 * argument, type parameter and tuple lists are groups that break before their
 * closing delimiter, a base list breaks before its colon, and constraint
 * clauses own their lines. The printer is Prettier's, which CSharpier's is a
 * port of, so a header breaks where CSharpier breaks it at the same width.
 *
 * tree-sitter's C# grammar cannot parse generic record base types or `params`
 * parameters, so declarations are read by the small parser below. Formatting
 * only inserts whitespace; a token fingerprint rejects any other change.
 */

interface Token { kind: 'id' | 'number' | 'string' | 'char' | 'punct'; text: string; start: number; end: number }
type TypeNode =
  | { kind: 'name'; segments: { name: Token; args?: TypeNode[] }[] }
  | { kind: 'nullable' | 'pointer'; inner: TypeNode }
  | { kind: 'array'; inner: TypeNode; ranks: string[] }
  | { kind: 'tuple'; elements: { type: TypeNode; name?: Token }[] }
interface Attribute { name: Token[]; args?: Token[][] }
interface AttributeList { target?: Token; attributes: Attribute[] }
interface Parameter { attributes: AttributeList[]; modifiers: Token[]; type?: TypeNode; name?: Token; value?: Token[] }
interface TypeParameter { attributes: AttributeList[]; variance?: Token; name: Token }
interface Constraint { keywords: Token[]; type?: TypeNode }
interface ConstraintClause { keyword: Token; name: Token; constraints: Constraint[] }
interface BaseType { type: TypeNode; args?: Token[] }
interface Declaration {
  attributes: AttributeList[]
  modifiers: Token[]
  /** `record` and the `class`, `struct` or `interface` word that follows it. */
  keywords: Token[]
  isType: boolean
  returnType?: TypeNode
  name: Token
  typeParameters?: TypeParameter[]
  parameters?: Parameter[]
  baseTypes?: BaseType[]
  constraints: ConstraintClause[]
  semicolon: boolean
  tokens: Token[]
}

const MODIFIERS = new Set(['public', 'private', 'protected', 'internal', 'file', 'static', 'extern', 'new', 'virtual',
  'abstract', 'sealed', 'override', 'readonly', 'unsafe', 'required', 'volatile', 'async', 'partial', 'ref'])
const PARAMETER_MODIFIERS = new Set(['this', 'ref', 'out', 'in', 'params', 'scoped', 'readonly'])
const TYPE_KEYWORDS = new Set(['class', 'struct', 'interface'])
const LITERAL_WORDS = new Set(['null', 'true', 'false', 'default'])
const TOKEN = /\s*(?:(?<id>@?[\p{L}_][\p{L}\p{N}_]*)|(?<number>\d[\w.]*)|(?<string>(?:\$@|@\$|\$|@)?"(?:\\.|""|[^"\\])*")|(?<char>'(?:\\.|[^'\\])+')|(?<punct>=>|::|[^\s]))/uy

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  for (let at = 0;;) {
    const rest = /\s*/y
    rest.lastIndex = at
    rest.exec(source)
    if (rest.lastIndex >= source.length) return tokens
    if (/^\/[/*]/.test(source.slice(rest.lastIndex, rest.lastIndex + 2))) throw new Error(`C# declaration comments are unsupported: ${source}`)
    TOKEN.lastIndex = at
    const match = TOKEN.exec(source)
    if (!match) throw new Error(`Cannot tokenize C# declaration: ${source}`)
    const [kind, text] = Object.entries(match.groups!).find(([, value]) => value !== undefined)! as [Token['kind'], string]
    const end = TOKEN.lastIndex
    tokens.push({ kind, text, start: end - text.length, end })
    at = end
  }
}

class Parser {
  private at = 0
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private fail(message: string): never { throw new Error(`${message} in C# declaration: ${this.source}`) }
  private peek(offset = 0): Token | undefined { return this.tokens[this.at + offset] }
  private is(text: string, offset = 0): boolean { return this.peek(offset)?.text === text }
  private take(): Token { return this.tokens[this.at++] ?? this.fail('Unexpected end') }
  private expect(text: string): Token { return this.is(text) ? this.take() : this.fail(`Expected ${text}`) }
  private identifier(): Token { const token = this.take(); return token.kind === 'id' ? token : this.fail(`Expected a name, found ${token.text}`) }

  /** Tokens up to a top-level comma or closing delimiter; expressions stay opaque. */
  private run(stops: string): Token[] {
    const run: Token[] = []
    for (let depth = 0; this.peek();) {
      const token = this.peek()!
      if (!depth && stops.includes(token.text) && token.kind === 'punct') break
      if ('([{'.includes(token.text) && token.kind === 'punct') depth++
      else if (')]}'.includes(token.text) && token.kind === 'punct' && --depth < 0) this.fail(`Unbalanced ${token.text}`)
      run.push(this.take())
    }
    return run
  }

  private attributeLists(): AttributeList[] {
    const lists: AttributeList[] = []
    while (this.is('[')) {
      this.take()
      const list: AttributeList = { attributes: [] }
      if (this.peek()?.kind === 'id' && this.is(':', 1)) { list.target = this.take(); this.take() }
      while (!this.is(']')) {
        const name = [this.identifier()]
        while (this.is('.')) name.push(this.take(), this.identifier())
        const attribute: Attribute = { name }
        if (this.is('(')) {
          this.take()
          attribute.args = []
          while (!this.is(')')) { attribute.args.push(this.run(',)')); if (this.is(',')) this.take() }
          this.expect(')')
        }
        list.attributes.push(attribute)
        if (this.is(',')) this.take()
      }
      this.expect(']')
      lists.push(list)
    }
    return lists
  }

  type(): TypeNode {
    let result: TypeNode
    if (this.is('(')) {
      this.take()
      const elements: { type: TypeNode; name?: Token }[] = []
      for (;;) {
        const type = this.type()
        const name = this.peek()?.kind === 'id' ? this.take() : undefined
        elements.push({ type, name })
        if (!this.is(',')) break
        this.take()
      }
      this.expect(')')
      result = { kind: 'tuple', elements }
    } else {
      const segments: { name: Token; args?: TypeNode[] }[] = []
      for (;;) {
        const segment: { name: Token; args?: TypeNode[] } = { name: this.identifier() }
        if (this.is('<')) {
          this.take()
          segment.args = [this.type()]
          while (this.is(',')) { this.take(); segment.args.push(this.type()) }
          this.expect('>')
        }
        segments.push(segment)
        if (!this.is('.') && !this.is('::')) break
        this.take()
      }
      result = { kind: 'name', segments }
    }
    for (;;) {
      if (this.is('?')) { this.take(); result = { kind: 'nullable', inner: result } }
      else if (this.is('*')) { this.take(); result = { kind: 'pointer', inner: result } }
      else if (this.is('[') && (this.is(']', 1) || this.is(',', 1))) {
        this.take()
        let rank = '['
        while (this.is(',')) { this.take(); rank += ',' }
        this.expect(']')
        // `int[][]` is one array type with two rank specifiers.
        if (result.kind === 'array') result.ranks.push(`${rank}]`)
        else result = { kind: 'array', inner: result, ranks: [`${rank}]`] }
      } else return result
    }
  }

  private typeParameters(): TypeParameter[] {
    this.expect('<')
    const parameters: TypeParameter[] = []
    do {
      if (parameters.length) this.take()
      const attributes = this.attributeLists()
      const variance = this.is('in') || this.is('out') ? this.take() : undefined
      parameters.push({ attributes, variance, name: this.identifier() })
    } while (this.is(','))
    this.expect('>')
    return parameters
  }

  private parameters(): Parameter[] {
    this.expect('(')
    const parameters: Parameter[] = []
    while (!this.is(')')) {
      const parameter: Parameter = { attributes: this.attributeLists(), modifiers: [] }
      while (PARAMETER_MODIFIERS.has(this.peek()?.text ?? '') && !this.is(',', 1) && !this.is(')', 1)) parameter.modifiers.push(this.take())
      parameter.type = this.type()
      if (this.peek()?.kind === 'id') parameter.name = this.take()
      if (this.is('=')) { this.take(); parameter.value = this.run(',)') }
      parameters.push(parameter)
      if (this.is(',')) this.take()
      else if (!this.is(')')) this.fail(`Unexpected ${this.peek()?.text ?? 'end'}`)
    }
    this.expect(')')
    return parameters
  }

  declaration(): Declaration {
    const attributes = this.attributeLists()
    const modifiers: Token[] = []
    while (MODIFIERS.has(this.peek()?.text ?? '') && !this.is('(', 1) && !this.is('.', 1)) modifiers.push(this.take())
    const keywords: Token[] = []
    let isType = false
    if (this.is('record')) {
      isType = true
      keywords.push(this.take())
      if (this.is('class') || this.is('struct')) keywords.push(this.take())
    } else if (TYPE_KEYWORDS.has(this.peek()?.text ?? '')) { isType = true; keywords.push(this.take()) }
    let returnType: TypeNode | undefined
    let name: Token
    if (isType) name = this.identifier()
    else {
      const first = this.type()
      if (this.is('(')) {
        // A constructor has no return type: the "type" was its name.
        if (first.kind !== 'name' || first.segments.length !== 1 || first.segments[0]!.args) this.fail('Expected a return type')
        name = first.segments[0]!.name
      } else {
        returnType = first
        name = this.identifier()
        while (this.is('.')) { this.take(); name = this.identifier() }
      }
    }
    const result: Declaration = { attributes, modifiers, keywords, isType, returnType, name, constraints: [], semicolon: false, tokens: this.tokens }
    if (this.is('<')) result.typeParameters = this.typeParameters()
    if (this.is('(')) result.parameters = this.parameters()
    else if (!isType) this.fail('Expected a parameter list')
    if (this.is(':')) {
      this.take()
      result.baseTypes = []
      do {
        if (result.baseTypes.length) this.take()
        const type = this.type()
        let args: Token[] | undefined
        if (this.is('(')) { this.take(); args = this.run(')'); this.expect(')') }
        result.baseTypes.push({ type, args })
      } while (this.is(','))
    }
    while (this.is('where')) {
      const clause: ConstraintClause = { keyword: this.take(), name: this.identifier(), constraints: [] }
      this.expect(':')
      do {
        if (clause.constraints.length) this.take()
        const word = this.peek()?.text
        if (word === 'new' && this.is('(', 1)) {
          const keywords = [this.take(), this.take(), this.expect(')')]
          clause.constraints.push({ keywords })
        } else if (word === 'class' || word === 'struct') {
          const keywords = [this.take()]
          if (this.is('?')) keywords.push(this.take())
          clause.constraints.push({ keywords })
        } else if (word === 'default') clause.constraints.push({ keywords: [this.take()] })
        else clause.constraints.push({ keywords: [], type: this.type() })
      } while (this.is(','))
      result.constraints.push(clause)
    }
    if (this.is(';')) { this.take(); result.semicolon = true }
    else if (this.peek() && !this.is('{') && !this.is('=>')) this.fail(`Unexpected ${this.peek()!.text}`)
    return result
  }
}

const parse = (source: string): Declaration => new Parser(tokenize(source), source).declaration()

function verbatim(tokens: Token[], source: string): string {
  return tokens.map((token, index) => `${index && /\s/.test(source.slice(tokens[index - 1]!.end, token.start)) ? ' ' : ''}${token.text}`).join('')
}

function printDeclaration(d: Declaration, source: string, continuation: boolean): Doc {
  const printType = (type: TypeNode): Doc => {
    switch (type.kind) {
      case 'name': return join('.', type.segments.map((segment) => segment.args
        ? group([segment.name.text, printTypeArguments(segment.args)]) : segment.name.text))
      case 'nullable': return [printType(type.inner), '?']
      case 'pointer': return [printType(type.inner), '*']
      case 'array': return [printType(type.inner), ...type.ranks]
      case 'tuple': return group(['(', indent([softline, join([',', line], type.elements.map((element) =>
        [printType(element.type), element.name ? [' ', element.name.text] : '']))]), softline, ')'])
    }
  }
  // CSharpier breaks a type argument list only when it holds several
  // arguments or a nested generic name; one plain argument stays attached.
  const printTypeArguments = (args: TypeNode[]): Doc => {
    const breaks = args.length > 1 || args.some((arg) => arg.kind === 'name' && arg.segments.length === 1 && arg.segments[0]!.args)
    const items = join([',', line], args.map(printType))
    return breaks ? ['<', indent([softline, items]), softline, '>'] : ['<', items, '>']
  }
  const printAttributes = (lists: AttributeList[], separator: Doc): Doc => join(separator, lists.map((list) => {
    const attributes = list.attributes.map((attribute): Doc => {
      const name = attribute.name.map((token) => token.text).join('')
      return attribute.args ? group([name, '(', indent([softline, join([',', line], attribute.args.map((arg) => verbatim(arg, source)))]), softline, ')']) : name
    })
    return group(['[', list.target ? [list.target.text, ': '] : '',
      list.attributes.length > 1 ? indent([softline, join([',', line], attributes)]) : attributes, list.attributes.length > 1 ? softline : '', ']'])
  }))
  const printTypeParameters = (parameters: TypeParameter[]): Doc => {
    const breaks = parameters.length > 1 || parameters[0]!.attributes.length > 0
    return group(['<', indent([breaks ? softline : '', join([',', line], parameters.map((parameter) =>
      [parameter.attributes.length ? [printAttributes(parameter.attributes, line), line] : '', parameter.variance ? `${parameter.variance.text} ` : '', parameter.name.text]))]),
    breaks ? softline : '', '>'])
  }
  // A default is one opaque token run: its own arguments never wrap. Like
  // CSharpier, creations, invocations, parenthesized lambdas and conditionals
  // keep the expression beside `=`; other values move below it.
  const printValue = (tokens: Token[]): Doc => {
    const text = verbatim(tokens, source)
    const attached = /^new\s+[\w.<>?,\s]*[({]/.test(text) || /^(?!new\(|default\(|typeof\(|sizeof\()[\w.]+\(.*\)$/.test(text) ||
      /^(?:async\s+)?\([^)]*\)\s*=>/.test(text) || /\s\?\s.+\s:\s/.test(text)
    const clause = group([' ', '=', attached ? ' ' : line, text])
    return attached ? clause : indent(clause)
  }
  const printParameters = (parameters: Parameter[]): Doc => group(['(', parameters.length
    ? [indent([softline, join([',', line], parameters.map((parameter): Doc => {
      const attributes = parameter.attributes.length
      const body: Doc[] = [
        attributes ? [printAttributes(parameter.attributes, line), indent(line)] : '',
        parameter.modifiers.length ? `${parameter.modifiers.map((token) => token.text).join(' ')} ` : '',
        parameter.type ? printType(parameter.type) : '', parameter.type && parameter.name ? ' ' : '', parameter.name?.text ?? '',
        parameter.value ? printValue(parameter.value) : '']
      return attributes ? group(body) : body
    }))]), softline] : '', ')'])
  const printConstraints = (): Doc => d.constraints.length ? group(indent([hardline, join(hardline, d.constraints.map((clause) =>
    group(['where ', clause.name.text, ' : ', indent(join([',', line], clause.constraints.map((constraint) =>
      constraint.type ? printType(constraint.type) : verbatim(constraint.keywords, source))))])))])) : ''
  const modifiers: Doc = d.modifiers.length ? [d.modifiers.map((token) => token.text).join(' '), ' '] : ''
  const parts: Doc[] = []
  if (d.attributes.length) parts.push(printAttributes(d.attributes, hardline), hardline)
  if (d.isType) {
    parts.push(modifiers, d.keywords.map((token) => `${token.text} `), d.name.text,
      d.typeParameters ? printTypeParameters(d.typeParameters) : '', d.parameters ? printParameters(d.parameters) : '')
    if (d.baseTypes) {
      const base = (type: BaseType): Doc => [printType(type.type), type.args ? ['(', verbatim(type.args, source), ')'] : '']
      const [first, ...rest] = d.baseTypes
      parts.push(group(indent([line, ': ', base(first!), rest.length ? indent([',', line, join([',', line], rest.map(base))]) : ''])))
    }
    parts.push(printConstraints())
  } else {
    // Without a body the declarator may move below an unbreakable return type.
    const id = Symbol('declarator')
    const declarator: Doc[] = [d.name.text, d.typeParameters ? printTypeParameters(d.typeParameters) : '',
      printParameters(d.parameters ?? []), ifBreak('', softline)]
    parts.push(group([modifiers, d.returnType ? printType(d.returnType) : '',
      d.returnType ? (continuation ? [group(indent(line), { id }), indentIfBreak(declarator, { groupId: id })] : [' ', declarator]) : declarator]))
    parts.push(printConstraints())
  }
  if (d.semicolon) parts.push(';')
  // The body's opening brace always starts a new line, ending every group.
  parts.push(hardline)
  return parts
}

/** Formatting may only add whitespace, so the token texts are its fingerprint. */
const words = (tokens: Token[]): string[] => tokens.map((token) => token.text)

function print(d: Declaration, source: string, continuation: boolean): string {
  return doc.printer.printDocToString(printDeclaration(d, source, continuation), {
    printWidth: CODE_COLUMNS.api, tabWidth: 4, useTabs: false,
  }).formatted.trimEnd()
}

function syntaxRanges(d: Declaration, parameters: readonly CSharpBinding[] | undefined): CodeSyntax[] {
  const ranges: CodeSyntax[] = []
  const add = (token: Token, kind: 'name' | 'literal' | 'keyword') => ranges.push({ start: token.start, end: token.end, kind })
  // A type parameter's uses are bindings, not references to a same-named type.
  const bound = new Set(d.typeParameters?.map((parameter) => parameter.name.text))
  const visitType = (type: TypeNode | undefined): void => {
    if (!type) return
    if (type.kind === 'name') {
      if (type.segments.length === 1 && bound.has(type.segments[0]!.name.text)) add(type.segments[0]!.name, 'literal')
      for (const segment of type.segments) segment.args?.forEach(visitType)
    } else if (type.kind === 'tuple') {
      for (const element of type.elements) { visitType(element.type); if (element.name) add(element.name, 'literal') }
    } else visitType(type.inner)
  }
  const visitAttributes = (lists: AttributeList[]) => {
    for (const list of lists) for (const attribute of list.attributes) for (const arg of attribute.args ?? []) {
      for (const token of arg) if (['string', 'char', 'number'].includes(token.kind)) add(token, 'literal')
    }
  }
  visitAttributes(d.attributes)
  d.modifiers.forEach((token) => add(token, 'keyword'))
  d.keywords.forEach((token) => add(token, 'keyword'))
  visitType(d.returnType)
  add(d.name, 'name')
  for (const parameter of d.typeParameters ?? []) { visitAttributes(parameter.attributes); if (parameter.variance) add(parameter.variance, 'keyword'); add(parameter.name, 'literal') }
  d.parameters?.forEach((parameter, index) => {
    visitAttributes(parameter.attributes)
    parameter.modifiers.forEach((token) => add(token, 'keyword'))
    visitType(parameter.type)
    if (parameter.name) {
      const binding = parameters?.[index]
      if (binding?.name === parameter.name.text) ranges.push({ start: parameter.name.start, end: parameter.name.end, kind: 'parameter', parameter: binding.index })
      else add(parameter.name, 'literal')
    }
    for (const token of parameter.value ?? []) {
      if (['string', 'char', 'number'].includes(token.kind) || LITERAL_WORDS.has(token.text)) add(token, 'literal')
    }
  })
  for (const base of d.baseTypes ?? []) visitType(base.type)
  for (const clause of d.constraints) {
    add(clause.keyword, 'keyword')
    add(clause.name, 'literal')
    for (const constraint of clause.constraints) { constraint.keywords.filter((token) => token.kind === 'id').forEach((token) => add(token, 'keyword')); visitType(constraint.type) }
  }
  return ranges.sort((a, b) => a.start - b.start).filter((range, index, all) => !index || range.start >= all[index - 1]!.end)
}

/** A declared parameter name and the model parameter its anchor belongs to. */
export type CSharpBinding = Pick<CSharpParameter, 'name' | 'index'>

/**
 * Format one declaration at the API width. `parameters` binds each declared
 * parameter to the model for anchors. `continuation` permits the one departure from
 * CSharpier: a break between an unbreakable return type and the method name,
 * taken only when it leaves no line over the budget.
 */
export async function formatCSharpDeclaration(source: string, parameters?: readonly CSharpBinding[], continuation = true): Promise<CodeLayout> {
  const input = parse(source)
  if (parameters && JSON.stringify(input.parameters?.map((parameter) => parameter.name?.text)) !== JSON.stringify(parameters.map((parameter) => parameter.name))) {
    throw new Error(`C# declaration binding disagrees with the model: ${source}`)
  }
  const layout = async (allowContinuation: boolean): Promise<CodeLayout> => {
    const text = print(input, source, allowContinuation)
    const output = parse(text)
    if (JSON.stringify(words(output.tokens)) !== JSON.stringify(words(input.tokens))) throw new Error(`Formatting changed C# declaration tokens: ${source}`)
    return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), syntax: syntaxRanges(output, parameters) }
  }
  const formatted = await layout(false)
  if (!continuation || !formatted.failures.length) return formatted
  const continued = await layout(true)
  return continued.failures.length ? formatted : continued
}

/** Declarations are source text, or a projection of the extracted callable. */
export function csharpDeclaration(symbol: ApiSymbol, signature: Signature): string {
  const raw = signature.raw?.trim()
  if (raw) return raw
  const parameters = csharpParameters(signature)
  if (!parameters) throw new Error(`Cannot declare C# callable ${symbol.id}: its parameters were not extracted`)
  // Accessibility and attributes are not part of the extracted model.
  const modifiers = (['static', 'abstract', 'async'] as const).filter((modifier) => symbol.modifiers.includes(modifier))
  const generics = signature.typeParams?.length ? `<${signature.typeParams.join(', ')}>` : ''
  return `${[...modifiers, ...signature.returns ? [signature.returns] : []].join(' ')}${modifiers.length || signature.returns ? ' ' : ''}${symbol.name}${generics}(${parameters.map((parameter) => parameter.text).join(', ')})`
}

export function csharpSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const declaration = csharpDeclaration(symbol, signature)
  // Source text binds the model's parameters by name; a projection binds what it declared.
  const bindings = signature.raw?.trim() ? signature.params.map((param, index) => ({ name: param.name, index })) : csharpParameters(signature)!
  const key = JSON.stringify([declaration, bindings, CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatCSharpDeclaration(declaration, bindings)
    layouts.set(key, pending)
  }
  return pending
}
