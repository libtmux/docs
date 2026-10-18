import { loadLanguage, parserFor, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { doc, util } from 'prettier'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout, type CodeSyntax } from './code-layout'

type NativeParser = Awaited<ReturnType<typeof parserFor>>
type NativeTree = NonNullable<ReturnType<NativeParser['parse']>>
type NativeNode = NativeTree['rootNode']
type Doc = doc.builders.Doc
const { group, hardline, indent, line, softline } = doc.builders
const comments = new Set(['line_comment', 'block_comment'])
const literals = new Set(['string_literal', 'raw_string_literal', 'char_literal', 'token_tree', 'attribute_item'])
const lists = new Set(['parameters', 'type_parameters', 'type_arguments', 'tuple_type'])
const layouts = new Map<string, Promise<CodeLayout>>()
let grammar: ReturnType<typeof loadLanguage> | undefined

/** Rust headers keep source tokens, including every trailing comma and attribute. */
export function rustSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, signature.enclosingDeclaration, signature.params.map((param) => param.name), CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatHeader(symbol, signature)
    layouts.set(key, pending)
  }
  return pending
}

const children = (node: NativeNode, named = false): NativeNode[] =>
  (named ? node.namedChildren : node.children).filter((child): child is NativeNode => child !== null)

function declaration(tree: NativeTree, raw: string, context = false) {
  const nodes = children(tree.rootNode, true)
  const declarations = nodes.filter((node) => !comments.has(node.type) && node.type !== 'attribute_item')
  const owner = declarations[0]
  const types = context ? ['impl_item', 'trait_item'] : ['function_item', 'function_signature_item']
  const body = owner?.childForFieldName('body')
  if (tree.rootNode.hasError || declarations.length !== 1 || !owner || !types.includes(owner.type) ||
    (body && body.startIndex < raw.length) || (!body && (context || !raw.trimEnd().endsWith(';')))) {
    throw new Error(`Invalid Rust ${context ? 'enclosing declaration' : 'callable header'} grammar: ${raw}`)
  }
  const parts = nodes.flatMap((node) => node.id === owner.id
    ? children(node).filter((child) => child.startIndex < raw.length && child.id !== body?.id) : [node])
  return { owner, parts }
}

/** Whitespace inside comments, literals and token trees remains semantic. */
function fingerprint(node: NativeNode): unknown {
  if (comments.has(node.type) || (literals.has(node.type) && node.type !== 'attribute_item') || !node.childCount) return [node.type, node.text]
  let offset = 0
  const parts = children(node).map((child) => {
    const gap = node.text.slice(offset, child.startIndex - node.startIndex).replace(/\s/g, '')
    offset = child.endIndex - node.startIndex
    return [gap, fingerprint(child)]
  })
  return [node.type, parts, node.text.slice(offset).replace(/\s/g, '')]
}

function printHeader(parts: NativeNode[], source: string): string {
  const sequence = (nodes: NativeNode[], commas = false): Doc => nodes.flatMap((node, index) => {
    const previous = nodes[index - 1]
    const gap = previous ? source.slice(previous.endIndex, node.startIndex) : ''
    return [previous?.type === 'line_comment' ? hardline : commas && previous?.type === ',' ? line
      : /\S/.test(gap) ? gap : gap ? ' ' : '', print(node)]
  })
  const printList = (node: NativeNode): Doc => {
    const nodes = children(node)
    if (nodes.length <= 2) return node.type === 'parameters' && nodes.length === 2
      ? group([nodes[0]!.text, softline, nodes[1]!.text]) : node.text
    const inside = nodes.slice(1, -1)
    return group([nodes[0]!.text, indent([softline, sequence(inside, true)]),
      inside.at(-1)?.type === 'line_comment' ? hardline : softline, nodes.at(-1)!.text])
  }
  const print = (node: NativeNode): Doc => {
    if (node.type === 'attribute_item' && !/[\r\n\t]/.test(node.text)) {
      const attribute = children(node, true).find((child) => child.type === 'attribute')
      const value = attribute?.childForFieldName('value')
      if (attribute && value && children(attribute).length === 3 &&
          ['string_literal', 'raw_string_literal'].includes(value.type) &&
          util.getStringWidth(node.text) > CODE_COLUMNS.api &&
          util.getStringWidth(value.text) <= CODE_COLUMNS.api - 4) {
        return group([source.slice(node.startIndex, value.startIndex).trimEnd(),
          indent([line, value.text]), softline, source.slice(value.endIndex, node.endIndex).trimStart()])
      }
    }
    if (comments.has(node.type) || literals.has(node.type) || node.type.endsWith('_pattern') || !node.childCount) return node.text
    if (lists.has(node.type)) return printList(node)
    if (node.type === 'where_clause') return ['where', indent([hardline, group(sequence(children(node).slice(1), true))])]
    const nodes = children(node)
    if (['parameter', 'where_predicate', 'constrained_type_parameter'].includes(node.type)) {
      const colon = nodes.findIndex((child) => child.type === ':')
      if (colon >= 0) return group([sequence(nodes.slice(0, colon + 1)), indent([line, sequence(nodes.slice(colon + 1))])])
    }
    return group(sequence(nodes))
  }
  const declaration: Doc[] = []
  for (const [index, node] of parts.entries()) {
    const previous = parts[index - 1]
    const gap = previous ? source.slice(previous.endIndex, node.startIndex) : ''
    declaration.push(index && (previous?.type === 'attribute_item' || previous?.type === 'line_comment' || node.type === 'attribute_item' || node.type === 'where_clause')
      ? hardline : /\S/.test(gap) ? gap : gap ? ' ' : '', print(node))
  }
  return doc.printer.printDocToString(group(declaration), {
    printWidth: CODE_COLUMNS.api, tabWidth: 4, useTabs: false,
  }).formatted
}

function bindingNames(owner?: NativeNode): Set<string> {
  const names = new Set<string>()
  const visit = (node: NativeNode) => {
    if (node.type === 'type_identifier' || node.type === 'lifetime') names.add(node.text)
    else if (node.type === 'optional_type_parameter') {
      const name = node.childForFieldName('name')
      if (name) visit(name)
    } else if (node.type === 'constrained_type_parameter') {
      const name = node.childForFieldName('left')
      if (name) names.add(name.text)
    } else if (node.type === 'const_parameter') {
      const name = node.childForFieldName('name')
      if (name) names.add(name.text)
    }
  }
  const parameters = owner?.childForFieldName('type_parameters')
  if (parameters) children(parameters, true).forEach(visit)
  return names
}

function syntaxRanges(parts: NativeNode[], bound: Set<string>, initial: CodeSyntax[] = []): CodeSyntax[] {
  const syntax = [...initial]
  const visit = (node: NativeNode) => {
    if (syntax.some((range) => range.start <= node.startIndex && range.end >= node.endIndex)) return
    if (!node.isNamed && !node.childCount && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(node.text)) {
      syntax.push({ start: node.startIndex, end: node.endIndex, kind: 'keyword' })
      return
    }
    if (comments.has(node.type) || literals.has(node.type) || node.type === 'lifetime' ||
      (['identifier', 'type_identifier'].includes(node.type) && (bound.has(node.text) || node.text === 'Self')) ||
      (node.type === 'scoped_type_identifier' && (bound.has(node.text.split('::')[0]!) || node.text.startsWith('Self::')))) {
      syntax.push({ start: node.startIndex, end: node.endIndex, kind: 'literal' })
      return
    }
    // Callback labels are declarations within their function type, not API arguments.
    if (node.type === 'parameter') {
      const pattern = node.childForFieldName('pattern')
      if (pattern && !syntax.some((range) => range.start === pattern.startIndex)) {
        syntax.push({ start: pattern.startIndex, end: pattern.endIndex, kind: 'literal' })
      }
    }
    children(node).forEach(visit)
  }
  parts.forEach(visit)
  return syntax.sort((a, b) => a.start - b.start)
}

function parameterRanges(owner: NativeNode, symbol: ApiSymbol, signature: Signature): CodeSyntax[] {
  const name = owner.childForFieldName('name')!
  if (name.text !== symbol.name) throw new Error(`Rust declaration name does not match ${symbol.id}: ${name.text}`)
  const parameters = children(owner.childForFieldName('parameters')!, true).filter((node) => !comments.has(node.type))
  const names = parameters.map((node) => node.type === 'self_parameter' ? node : node.childForFieldName('pattern'))
  if (names.length !== signature.params.length || names.some((node, index) =>
    node?.text.replace(/^[&*]+/, '') !== signature.params[index]!.name && node?.text !== signature.params[index]!.name)) {
    throw new Error(`Rust parameter names do not match ${symbol.id}`)
  }
  // apiEntryFields leaves an undocumented `self` receiver out of the parameter list, so it has no entry to link.
  return [{ start: name.startIndex, end: name.endIndex, kind: 'name' }, ...names.map((node, parameter): CodeSyntax =>
    parameter === 0 && signature.params[0]!.name === 'self' && !signature.params[0]!.doc
      ? { start: node!.startIndex, end: node!.endIndex, kind: 'keyword' }
      : { start: node!.startIndex, end: node!.endIndex, kind: 'parameter', parameter })]
}

async function formatHeader(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  await (grammar ??= loadLanguage('rust'))
  const parser = await parserFor('rust')
  const trees: NativeTree[] = []
  const parse = (raw: string, context = false) => {
    const source = `${raw}\n${!context && raw.trimEnd().endsWith(';') ? '' : '{}'}\n`
    const tree = parser.parse(source)
    if (!tree) throw new Error(`Invalid Rust header grammar: ${raw}`)
    trees.push(tree)
    return { ...declaration(tree, raw, context), source }
  }
  try {
    const original = parse(signature.raw!)
    parameterRanges(original.owner, symbol, signature)
    const context = signature.enclosingDeclaration ? parse(signature.enclosingDeclaration, true) : undefined
    const ownerBound = bindingNames(context?.owner)
    const callableBound = new Set([...bindingNames(original.owner), ...ownerBound])
    const headerText = printHeader(original.parts, original.source)
    const formatted = parse(headerText)
    if (JSON.stringify(original.parts.map(fingerprint)) !== JSON.stringify(formatted.parts.map(fingerprint))) {
      throw new Error(`Formatting changed Rust callable header grammar: ${signature.raw}`)
    }
    const showContext = context && (context.owner.type === 'trait_item' || context.owner.childForFieldName('type_parameters') ||
      context.owner.childForFieldName('trait') || context.owner.childForFieldName('type')?.type !== 'type_identifier' ||
      context.parts.some((node) => node.type === 'where_clause' || node.type === 'attribute_item'))
    const contextText = showContext ? printHeader(context.parts, context.source) : ''
    const offset = contextText ? contextText.length + 1 : 0
    const syntax = syntaxRanges(formatted.parts, callableBound, parameterRanges(formatted.owner, symbol, signature))
      .map((range) => ({ ...range, start: range.start + offset, end: range.end + offset }))
    if (contextText) {
      const after = parse(contextText, true)
      if (JSON.stringify(context!.parts.map(fingerprint)) !== JSON.stringify(after.parts.map(fingerprint))) {
        throw new Error(`Formatting changed Rust enclosing declaration grammar: ${signature.enclosingDeclaration}`)
      }
      syntax.unshift(...syntaxRanges(after.parts, ownerBound))
    }
    const text = `${contextText ? `${contextText}\n` : ''}${headerText}`
    return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), syntax,
      ...(offset ? { contextEnd: offset } : {}) }
  } finally { trees.forEach((tree) => tree.delete()); parser.delete() }
}
