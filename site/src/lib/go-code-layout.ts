import { loadLanguage, parserFor, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { doc } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type NativeParser = Awaited<ReturnType<typeof parserFor>>
type NativeTree = NonNullable<ReturnType<NativeParser['parse']>>
type NativeNode = NativeTree['rootNode']
type Doc = doc.builders.Doc
const { conditionalGroup, group, hardline, ifBreak, indent, line, softline } = doc.builders
const layouts = new Map<string, Promise<CodeLayout>>()
let grammar: ReturnType<typeof loadLanguage> | undefined
const lists = new Set(['parameter_list', 'type_parameter_list', 'type_arguments'])
const containers = new Set([
  'source_file', 'function_declaration', 'method_declaration', 'parameter_declaration', 'variadic_parameter_declaration',
  'function_type', 'generic_type', 'pointer_type', 'slice_type', 'array_type', 'map_type', 'channel_type',
])
const literals = new Set(['raw_string_literal', 'interpreted_string_literal', 'rune_literal', 'comment'])

function children(node: NativeNode): NativeNode[] {
  return node.children.filter((child): child is NativeNode => child !== null)
}

/** Go has no formatter width option; break only native comma-separated lists. */
export function goSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.kind, symbol.name, signature.raw, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

const isComment = (node?: NativeNode): boolean => node?.type === 'comment'
const isLineComment = (node?: NativeNode): boolean => isComment(node) && node!.text.startsWith('//')

/** Trailing list commas may change with layout; every other token must survive. */
function fingerprint(node: NativeNode): unknown {
  if (literals.has(node.type) || !node.childCount) return [node.type, node.text]
  const nodes = children(node)
  const lastItem = lists.has(node.type) ? nodes.findLastIndex((child, index) => index < nodes.length - 1 && child.type !== ',' && !isComment(child)) : -1
  let offset = 0
  const parts = nodes.flatMap((child, index) => {
    const gap = node.text.slice(offset, child.startIndex - node.startIndex).replace(/\s/g, '')
    offset = child.endIndex - node.startIndex
    return lists.has(node.type) && child.type === ',' && index > lastItem ? [] : [[gap, fingerprint(child)]]
  })
  return [node.type, parts, node.text.slice(offset).replace(/\s/g, '')]
}

function printHeader(root: NativeNode, breakSingleTypeArguments = false): string {
  const documents = new Map<string, Doc>()
  const gap = (left: NativeNode, right: NativeNode): string => root.text.slice(left.endIndex - root.startIndex, right.startIndex - root.startIndex)
  const sequence = (nodes: NativeNode[], breakLists: number[] = []): Doc => nodes.flatMap((node, index) => {
    const previous = nodes[index - 1]
    const sourceGap = previous ? gap(previous, node) : ''
    return [previous && isLineComment(previous) ? hardline : /\S/.test(sourceGap) ? sourceGap : sourceGap ? ' ' : '', print(node, breakLists.includes(node.id))]
  })
  const printList = (node: NativeNode, shouldBreak: boolean): Doc => {
    // Prefer native spacing until the measured header exceeds the docs cap.
    if (!breakSingleTypeArguments && node.type === 'type_arguments' && node.namedChildren.filter((child) => child && !isComment(child)).length === 1) return node.text
    const nodes = children(node)
    const inside = nodes.slice(1, -1)
    const lastValue = inside.findLastIndex((child) => child.type !== ',' && !isComment(child))
    if (lastValue === -1 && !inside.length) return node.text
    const contents: Doc[] = []
    let previous: NativeNode | undefined
    for (const [index, child] of inside.entries()) {
      // A trailing comma is emitted next to its value, before any comment.
      if (child.type === ',' && index > lastValue) continue
      if (previous) {
        const sourceGap = gap(previous, child)
        contents.push(isLineComment(previous) || (isComment(child) && sourceGap.includes('\n')) ? hardline
          : child.type === ',' ? '' : isComment(previous) || isComment(child) ? ' '
            : previous.type === ',' ? line : sourceGap ? ' ' : '')
      }
      contents.push(print(child))
      if (index === lastValue) contents.push(ifBreak(','))
      previous = child
    }
    return group([nodes[0]!.text, indent([softline, contents]), isLineComment(previous) ? hardline : softline, nodes.at(-1)!.text], { shouldBreak })
  }
  const print = (node: NativeNode, breakList = false): Doc => {
    const key = `${node.id}:${breakList}`
    const cached = documents.get(key)
    if (cached) return cached
    if (lists.has(node.type)) {
      const result = printList(node, breakList)
      documents.set(key, result)
      return result
    }
    if (!containers.has(node.type) || !node.childCount) return node.text
    const parameters = node.childForFieldName('parameters')
    const receiver = node.childForFieldName('receiver')
    const normal = sequence(children(node))
    // Prefer expanding arguments before expanding a short result tuple.
    const breaks = parameters?.namedChildren.some((child) => child && !isComment(child)) ? [parameters.id] : []
    const alternatives: Doc[] = [normal]
    if (breaks.length) alternatives.push(sequence(children(node), breaks))
    if (receiver) alternatives.push(sequence(children(node), [...breaks, receiver.id]))
    const contents = alternatives.length > 1 ? conditionalGroup(alternatives) : group(normal)
    const result: Doc = [
      node.text.slice(0, node.firstChild!.startIndex - node.startIndex),
      contents,
      node.text.slice(node.lastChild!.endIndex - node.startIndex),
    ]
    documents.set(key, result)
    return result
  }
  return doc.printer.printDocToString(print(root), {
    printWidth: CODE_COLUMNS.api, tabWidth: 8, useTabs: true,
  }).formatted
}

function syntaxRanges(root: NativeNode, owner: NativeNode, signature: Signature): CodeSyntax[] {
  const name = owner.childForFieldName('name')!
  const syntax: CodeSyntax[] = [{ start: name.startIndex, end: name.endIndex, kind: 'name' }]
  const parameters = owner.childForFieldName('parameters')!
  const boundTypes = new Set<string>()
  for (const parameter of owner.childForFieldName('type_parameters')?.namedChildren ?? []) {
    for (const name of parameter?.childrenForFieldName('name') ?? []) if (name) boundTypes.add(name.text)
  }
  const receiver = owner.childForFieldName('receiver')
  const receiverType = receiver?.descendantsOfType('generic_type')[0]
  for (const argument of receiverType?.childForFieldName('type_arguments')?.namedChildren ?? []) {
    if (argument?.type === 'type_identifier') boundTypes.add(argument.text)
  }
  const literal = (node: NativeNode) => syntax.push({ start: node.startIndex, end: node.endIndex, kind: 'literal' })
  const visit = (node: NativeNode) => {
    if (literals.has(node.type)) { literal(node); return }
    if (['parameter_declaration', 'variadic_parameter_declaration', 'field_declaration', 'method_spec'].includes(node.type)) {
      for (const name of node.childrenForFieldName('name')) {
        if (!name) continue
        const parameter = node.parent?.id === parameters.id ? signature.params.findIndex((param) => param.name === name.text) : -1
        if (parameter !== -1 && name.text !== '_') syntax.push({ start: name.startIndex, end: name.endIndex, kind: 'parameter', parameter })
        else literal(name)
      }
    }
    if (node.type === 'type_identifier' && boundTypes.has(node.text) && node.parent?.type !== 'qualified_type' &&
        node.id !== receiverType?.childForFieldName('type')?.id) literal(node)
    children(node).forEach(visit)
  }
  visit(root)
  return syntax.sort((a, b) => a.start - b.start)
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  grammar ??= loadLanguage('go')
  await grammar
  const parser = await parserFor('go')
  let input: NativeTree | null = null
  let output: NativeTree | null = null
  try {
    input = parser.parse(signature.raw!)
    // A comment before the removed body becomes a sibling of the declaration.
    const declarations = input?.rootNode.namedChildren.filter((node) => node && !isComment(node)) ?? []
    const owner = declarations.length === 1 ? declarations[0] : null
    if (!input || input.rootNode.hasError || !owner || !['function_declaration', 'method_declaration'].includes(owner.type) || owner.childForFieldName('body')) {
      throw new Error(`Invalid Go callable header grammar: ${signature.raw}`)
    }
    const names = owner.childForFieldName('parameters')!.namedChildren.filter((node) => node && !isComment(node))
      .flatMap((node) => { const names = node!.childrenForFieldName('name').flatMap((name) => name ? [name.text] : []); return names.length ? names : [''] })
    if (owner.type !== (symbol.kind === 'method' ? 'method_declaration' : 'function_declaration') ||
        owner.childForFieldName('name')?.text !== symbol.name || JSON.stringify(names) !== JSON.stringify(signature.params.map((param) => param.name))) {
      throw new Error(`Go callable header binding disagrees with the model: ${signature.raw}`)
    }
    let text = printHeader(input.rootNode)
    let failures = await codeWidthFailures(text, 'api')
    if (failures.length) {
      // gofmt has no width option and collapses these valid multiline groups.
      const narrowed = printHeader(input.rootNode, true)
      const remaining = await codeWidthFailures(narrowed, 'api')
      if (Math.max(0, ...remaining.map((failure) => failure.columns)) < Math.max(...failures.map((failure) => failure.columns))) {
        text = narrowed
        failures = remaining
      }
    }
    output = parser.parse(text)
    if (!output || output.rootNode.hasError || JSON.stringify(fingerprint(input.rootNode)) !== JSON.stringify(fingerprint(output.rootNode))) {
      throw new Error(`Formatting changed Go callable header grammar: ${signature.raw}`)
    }
    const formatted = output.rootNode.namedChildren.find((node) => node && !isComment(node))!
    return { text, limit: CODE_COLUMNS.api, failures, syntax: syntaxRanges(output.rootNode, formatted, signature) }
  } finally {
    input?.delete(); output?.delete(); parser.delete()
  }
}
