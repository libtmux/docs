import { loadLanguage, parserFor, type Signature } from '@libtmux/api-model'
import { doc } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type Port = 'scala' | 'kotlin'
type NativeParser = Awaited<ReturnType<typeof parserFor>>
type NativeTree = NonNullable<ReturnType<NativeParser['parse']>>
type NativeNode = NativeTree['rootNode']
type Doc = doc.builders.Doc
const { align, group, hardline, line, softline } = doc.builders
const grammars = new Map<Port, ReturnType<typeof loadLanguage>>()
const layouts = new Map<string, Promise<CodeLayout>>()

/** Native headers retain their tokens; only grammar-owned whitespace is laid out. */
export function jvmSignatureLayout(signature: Signature, port: Port): Promise<CodeLayout> {
  const key = JSON.stringify([port, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(signature, port)
    layouts.set(key, pending)
  }
  return pending
}

const strings = new Set(['string', 'string_literal', 'interpolated_string_expression'])
const interpolations = new Set(['interpolation', 'interpolated_expression', 'interpolated_identifier'])
const comments = new Set(['comment', 'line_comment', 'block_comment', 'multiline_comment'])
const containers = new Set([
  'function_declaration', 'parameter', 'generic_type', 'user_type', 'type_projection',
  'function_type', 'parameter_types', 'nullable_type', 'type_parameter', 'upper_bound',
  'lower_bound', 'context_bound', 'repeated_parameter_type', 'annotated_type',
  'intersection_type', 'union_type',
])
const lists = new Set(['parameters', 'function_value_parameters', 'function_type_parameters', 'type_arguments', 'type_parameters'])

function children(node: NativeNode, named = false): NativeNode[] {
  return (named ? node.namedChildren : node.children).filter((child): child is NativeNode => child !== null)
}

function declaration(root: NativeNode): NativeNode | undefined {
  if (root.namedChildCount !== 1) return undefined
  const top = root.namedChild(0)!
  return top.type === 'extension_definition' ? top.childForFieldName('body') ?? undefined : top
}

/** Include literal content in the parse fingerprint, where whitespace is data. */
function fingerprint(node: NativeNode): unknown {
  if (strings.has(node.type) || comments.has(node.type) || !node.childCount) return [node.type, node.text]
  let offset = 0
  const parts = children(node).map((child) => {
    const gap = node.text.slice(offset, child.startIndex - node.startIndex).replace(/\s/g, '')
    offset = child.endIndex - node.startIndex
    return [gap, fingerprint(child)]
  })
  return [node.type, parts, node.text.slice(offset).replace(/\s/g, '')]
}

function printHeader(root: NativeNode, port: Port, kotlinContinuations = false): string {
  const isLineComment = (node?: NativeNode): boolean => node?.type === 'comment' || node?.type === 'line_comment'
  const sequence = (children: NativeNode[]): Doc => children.flatMap((node, index) => {
    const previous = children[index - 1]
    const rawGap = previous ? root.text.slice(previous.endIndex - root.startIndex, node.startIndex - root.startIndex) : ''
    const gap: Doc = isLineComment(previous) ? hardline
      : /\S/.test(rawGap) ? rawGap : rawGap ? ' ' : ''
    return [gap, print(node)]
  })
  const continuation = (nodes: NativeNode[], separator: string): Doc => {
    const at = nodes.findIndex((node) => node.type === separator)
    if (at === -1 || at === nodes.length - 1) return sequence(nodes)
    return [sequence(nodes.slice(0, at + 1)), group(align(4, [line, sequence(nodes.slice(at + 1))]))]
  }
  const printList = (node: NativeNode): Doc => {
    const nodes = children(node)
    const open = nodes[0]!
    const close = nodes.at(-1)!
    const inside = nodes.slice(1, -1)
    const contextual = ['using', 'implicit'].includes(inside[0]?.type ?? '') ? inside.shift() : undefined
    const items: NativeNode[][] = [[]]
    for (const child of inside) {
      if (child.type === ',') items.push([])
      else items.at(-1)!.push(child)
    }
    const trailingComma = items.length > 1 && !items.at(-1)!.length
    if (trailingComma) items.pop()
    if (!items[0]?.length) return node.text
    const indent = port === 'scala' && ['type_arguments', 'type_parameters'].includes(node.type) ? 2 : 4
    const endsInComment = isLineComment(items.at(-1)?.at(-1))
    const contents = items.flatMap((item, index) => [
      ...(index ? [isLineComment(items[index - 1]?.at(-1)) ? hardline : '', ',', line] : []),
      kotlinContinuations && node.type === 'function_value_parameters' ? continuation(item, '=') : sequence(item),
    ])
    return group([
      open.text, contextual?.text ?? '',
      align(indent, [contextual ? line : softline, contents]),
      trailingComma ? [endsInComment ? hardline : '', ','] : '',
      endsInComment && !trailingComma ? hardline : softline, close.text,
    ])
  }
  const print = (node: NativeNode): Doc => {
    if (node.type === 'extension_definition') {
      const body = node.childForFieldName('body')!
      const receiver = children(node).filter((child) => child.id !== body.id)
      return group([sequence(receiver), align(2, [isLineComment(receiver.at(-1)) ? hardline : line, print(body)])])
    }
    if (lists.has(node.type) || (node.type === 'parameter_types' && node.firstChild?.type === '(')) return printList(node)
    if (kotlinContinuations && node.type === 'function_declaration') return group(continuation(children(node), ':'))
    // Expression bodies and literals are opaque: line breaks inside them may
    // be meaningful, even when the outer header is only a declaration.
    if (!containers.has(node.type) || !node.childCount) return node.text
    // Some grammar productions omit punctuation from their children, notably
    // Kotlin nullable_type's '?'. Preserve those source-owned boundaries.
    return group([
      node.text.slice(0, node.firstChild!.startIndex - node.startIndex),
      sequence(children(node)),
      node.text.slice(node.lastChild!.endIndex - node.startIndex),
    ])
  }
  return doc.printer.printDocToString(print(root.namedChild(0)!), {
    printWidth: CODE_COLUMNS.api, tabWidth: port === 'scala' ? 2 : 4, useTabs: false,
  }).formatted
}

function syntaxRanges(root: NativeNode, signature: Signature, port: Port): CodeSyntax[] {
  const owner = declaration(root)!
  const name = port === 'scala' ? owner.childForFieldName('name')
    : children(owner, true).find((node) => node.type === 'simple_identifier')
  const syntax: CodeSyntax[] = name ? [{ start: name.startIndex, end: name.endIndex, kind: 'name' }] : []
  const parameters = children(owner, true).filter((node) => ['parameters', 'function_value_parameters'].includes(node.type))
  for (const list of parameters) for (const parameter of children(list, true).filter((node) => node.type === 'parameter')) {
    const name = port === 'scala' ? parameter.childForFieldName('name')
      : children(parameter, true).find((node) => node.type === 'simple_identifier')
    if (!name) continue
    const index = signature.params.findIndex((param) => param.name === name.text)
    if (index !== -1) syntax.push({ start: name.startIndex, end: name.endIndex, kind: 'parameter', parameter: index })
  }
  const literal = (start: number, end: number) => { if (end > start) syntax.push({ start, end, kind: 'literal' }) }
  const visit = (node: NativeNode) => {
    if (comments.has(node.type)) { literal(node.startIndex, node.endIndex); return }
    if (strings.has(node.type)) {
      const embedded: NativeNode[] = []
      const find = (child: NativeNode) => {
        if (interpolations.has(child.type)) embedded.push(child)
        else children(child, true).forEach(find)
      }
      children(node, true).forEach(find)
      let start = node.startIndex
      for (const expression of embedded) {
        literal(start, expression.startIndex)
        children(expression, true).forEach(visit)
        start = expression.endIndex
      }
      literal(start, node.endIndex)
    } else children(node, true).forEach(visit)
  }
  visit(root)
  return syntax.sort((a, b) => a.start - b.start)
}

async function formatHeader(signature: Signature, port: Port): Promise<CodeLayout> {
  // Loading each grammar once also avoids racing many WASM loads on a page
  // containing several overloads. Parsers and trees remain local to this call.
  let grammar = grammars.get(port)
  if (!grammar) { grammar = loadLanguage(port); grammars.set(port, grammar) }
  await grammar
  const parser = await parserFor(port)
  let input: NativeTree | null = null
  let output: NativeTree | null = null
  try {
    input = parser.parse(signature.raw!)
    if (!input || input.rootNode.hasError || declaration(input.rootNode)?.type !== 'function_declaration') {
      throw new Error(`Invalid ${port} callable header grammar: ${signature.raw}`)
    }
    let text = printHeader(input.rootNode, port)
    let failures = await codeWidthFailures(text, 'api')
    if (port === 'kotlin' && failures.length) {
      const alternate = printHeader(input.rootNode, port, true)
      const remaining = await codeWidthFailures(alternate, 'api')
      const widest = Math.max(...failures.map((failure) => failure.columns))
      const alternativeWidth = Math.max(0, ...remaining.map((failure) => failure.columns))
      if (remaining.length <= failures.length && alternativeWidth <= widest &&
        (remaining.length < failures.length || alternativeWidth < widest)) {
        text = alternate
        failures = remaining
      }
    }
    output = parser.parse(text)
    if (!output || output.rootNode.hasError || JSON.stringify(fingerprint(input.rootNode)) !== JSON.stringify(fingerprint(output.rootNode))) {
      throw new Error(`Formatting changed ${port} callable header grammar: ${signature.raw}`)
    }
    return { text, limit: CODE_COLUMNS.api, failures, syntax: syntaxRanges(output.rootNode, signature, port) }
  } finally {
    input?.delete()
    output?.delete()
    parser.delete()
  }
}
