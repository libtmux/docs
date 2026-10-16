import { loadLanguage, parserFor, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { doc } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type NativeParser = Awaited<ReturnType<typeof parserFor>>
type NativeTree = NonNullable<ReturnType<NativeParser['parse']>>
type NativeNode = NativeTree['rootNode']
type Doc = doc.builders.Doc
const { align, group, hardline, line, softline } = doc.builders
const prefix = 'class __Documentation {\n'
const comments = new Set(['line_comment', 'block_comment'])
const literals = new Set(['string_literal', 'character_literal'])
const lists = new Set(['formal_parameters', 'type_arguments', 'type_parameters', 'annotation_argument_list'])
const containers = new Set([
  'formal_parameter', 'spread_parameter', 'receiver_parameter', 'variable_declarator',
  'generic_type', 'scoped_type_identifier', 'annotated_type', 'array_type', 'type_parameter',
  'type_bound', 'wildcard', 'modifiers', 'annotation', 'marker_annotation', 'element_value_pair',
])
let grammar: ReturnType<typeof loadLanguage> | undefined
const layouts = new Map<string, Promise<CodeLayout>>()

/** Source headers own every token; the documentation surface owns whitespace. */
export function javaSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

const children = (node: NativeNode, named = false): NativeNode[] =>
  (named ? node.namedChildren : node.children).filter((child): child is NativeNode => child !== null)

function header(tree: NativeTree, raw: string) {
  const body = tree.rootNode.namedChild(0)?.childForFieldName('body')
  const end = prefix.length + raw.length
  const nodes = body ? children(body, true).filter((node) => node.startIndex < end) : []
  const declarations = nodes.filter((node) => !comments.has(node.type))
  const owner = declarations[0]
  if (tree.rootNode.hasError || tree.rootNode.namedChildCount !== 1 || declarations.length !== 1 || !owner ||
    !['method_declaration', 'constructor_declaration'].includes(owner.type) ||
    (owner.childForFieldName('body')?.startIndex ?? end) < end) {
    throw new Error(`Invalid Java callable header grammar: ${raw}`)
  }
  const parts = nodes.flatMap((node) => node.id === owner.id
    ? children(node).filter((child) => child.startIndex < end) : [node])
  return { owner, parts }
}

/** Whitespace in comments and literals remains part of the semantic fingerprint. */
function fingerprint(node: NativeNode): unknown {
  if (comments.has(node.type) || literals.has(node.type) || !node.childCount) return [node.type, node.text]
  let offset = 0
  const parts = children(node).map((child) => {
    const gap = node.text.slice(offset, child.startIndex - node.startIndex).replace(/\s/g, '')
    offset = child.endIndex - node.startIndex
    return [gap, fingerprint(child)]
  })
  return [node.type, parts, node.text.slice(offset).replace(/\s/g, '')]
}

function printHeader(parts: NativeNode[], source: string, breakName: boolean): string {
  const sequence = (nodes: NativeNode[], breakCommas = false): Doc => nodes.flatMap((node, index) => {
    const previous = nodes[index - 1]
    const gap = previous ? source.slice(previous.endIndex, node.startIndex) : ''
    return [previous?.type === 'line_comment' ? hardline : breakCommas && previous?.type === ',' ? line
      : /\S/.test(gap) ? gap : gap ? ' ' : '', print(node)]
  })
  const printList = (node: NativeNode): Doc => {
    const nodes = children(node)
    const open = nodes[0]!
    const close = nodes.at(-1)!
    const items: NativeNode[][] = [[]]
    for (const child of nodes.slice(1, -1)) {
      if (child.type === ',') items.push([])
      else items.at(-1)!.push(child)
    }
    if (!items[0]?.length) return node.text
    return group([
      open.text,
      align(8, [softline, items.flatMap((item, i) => [
        ...(i ? [items[i - 1]?.at(-1)?.type === 'line_comment' ? hardline : '', ',', line] : []),
        sequence(item),
      ])]),
      items.at(-1)?.at(-1)?.type === 'line_comment' ? hardline : '', close.text,
    ])
  }
  const print = (node: NativeNode): Doc => {
    if (lists.has(node.type)) return printList(node)
    if (!containers.has(node.type) || !node.childCount) return node.text
    return group([
      node.text.slice(0, node.firstChild!.startIndex - node.startIndex), sequence(children(node)),
      node.text.slice(node.lastChild!.endIndex - node.startIndex),
    ])
  }
  // Declaration annotations get their own lines; annotations on parameters
  // remain part of that parameter. Neither annotations nor modifiers are inferred.
  const nodes = parts.flatMap((node) => node.type === 'modifiers' ? children(node) : [node])
  const annotations: Doc[] = []
  while (nodes[0] && (['annotation', 'marker_annotation'].includes(nodes[0].type) || comments.has(nodes[0].type))) {
    annotations.push(print(nodes.shift()!), hardline)
  }
  const name = nodes.find((node) => node.type === 'identifier')
  const declaration: Doc[] = []
  for (const [i, node] of nodes.entries()) {
    const previous = nodes[i - 1]
    const gap = previous ? source.slice(previous.endIndex, node.startIndex) : ''
    if (node.type === 'throws') {
      declaration.push(align(8, [line, group(sequence(children(node), true))]))
    } else if (breakName && node.id === name?.id && i) {
      declaration.push(hardline, print(node))
    } else {
      declaration.push(previous?.type === 'line_comment' ? hardline : /\S/.test(gap) ? gap : gap ? ' ' : '', print(node))
    }
  }
  return doc.printer.printDocToString([...annotations, group(declaration)], {
    printWidth: CODE_COLUMNS.api, tabWidth: 4, useTabs: false,
  }).formatted
}

function syntaxRanges(owner: NativeNode, parts: NativeNode[], symbol: ApiSymbol, signature: Signature): CodeSyntax[] {
  const name = owner.childForFieldName('name')!
  if (name.text !== symbol.name) throw new Error(`Java declaration name does not match ${symbol.id}: ${name.text}`)
  const syntax: CodeSyntax[] = [{ start: name.startIndex - prefix.length, end: name.endIndex - prefix.length, kind: 'name' }]
  const parameters = children(owner.childForFieldName('parameters')!, true)
    .filter((node) => ['formal_parameter', 'spread_parameter'].includes(node.type))
  const parameterNames = parameters.map((node) => node.childForFieldName('name') ??
    children(node, true).find((child) => child.type === 'variable_declarator')?.childForFieldName('name'))
  if (parameterNames.length !== signature.params.length || parameterNames.some((node, i) => node?.text !== signature.params[i]!.name)) {
    throw new Error(`Java parameter names do not match ${symbol.id}`)
  }
  for (const [i, node] of parameterNames.entries()) syntax.push({
    start: node!.startIndex - prefix.length, end: node!.endIndex - prefix.length, kind: 'parameter', parameter: i,
  })
  const typeParameters = owner.childForFieldName('type_parameters')
  const bound = new Set(typeParameters ? children(typeParameters, true).map((node) => node.firstNamedChild?.text) : [])
  const visit = (node: NativeNode) => {
    if (comments.has(node.type) || literals.has(node.type) || (node.type === 'type_identifier' && bound.has(node.text))) {
      syntax.push({ start: node.startIndex - prefix.length, end: node.endIndex - prefix.length, kind: 'literal' })
    } else children(node, true).forEach(visit)
  }
  parts.forEach(visit)
  return syntax.sort((a, b) => a.start - b.start)
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  await (grammar ??= loadLanguage('java'))
  const parser = await parserFor('java')
  const raw = signature.raw!
  const wrap = (text: string) => `${prefix}${text}\n{}\n}`
  let input: NativeTree | null = null
  let output: NativeTree | null = null
  try {
    input = parser.parse(wrap(raw))
    if (!input) throw new Error(`Invalid Java callable header grammar: ${raw}`)
    const original = header(input, raw)
    syntaxRanges(original.owner, original.parts, symbol, signature)
    let text = printHeader(original.parts, wrap(raw), false)
    let failures = await codeWidthFailures(text, 'api')
    if (failures.length) {
      const alternate = printHeader(original.parts, wrap(raw), true)
      const remaining = await codeWidthFailures(alternate, 'api')
      if (remaining.length < failures.length || (remaining.length === failures.length &&
        Math.max(...remaining.map((failure) => failure.columns), 0) < Math.max(...failures.map((failure) => failure.columns), 0))) {
        text = alternate
        failures = remaining
      }
    }
    output = parser.parse(wrap(text))
    if (!output) throw new Error(`Invalid Java callable header grammar: ${text}`)
    const formatted = header(output, text)
    if (JSON.stringify(original.parts.map(fingerprint)) !== JSON.stringify(formatted.parts.map(fingerprint))) {
      throw new Error(`Formatting changed Java callable header grammar: ${raw}`)
    }
    return { text, limit: CODE_COLUMNS.api, failures, syntax: syntaxRanges(formatted.owner, formatted.parts, symbol, signature) }
  } finally { input?.delete(); output?.delete(); parser.delete() }
}
