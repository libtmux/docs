import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Node } from 'web-tree-sitter'
import { parserFor } from '../parser.ts'
import { parseMarkdownDocFull } from '../doc/markdown.ts'
import type { ApiModel, ApiSymbol, Param, Signature, SymbolKind } from '../model.ts'

type Language = 'kotlin' | 'scala'
const childrenOf = (node: Node): Node[] => node.namedChildren.filter((child): child is Node => child !== null)
const named = (node: Node, ...types: string[]) => childrenOf(node).find((child) => types.includes(child.type))
const compact = (text: string) => text.replace(/\s+/g, ' ').trim()
const field = (node: Node, name: string) => node.childForFieldName(name)
const visible = (node: Node) => {
  const modifiers = named(node, 'modifiers')
  const access = named(node, 'access_modifier')
  const name = field(node, 'name')
  // Scala places a private constructor's access after the public class name.
  const declarationAccess = access && (!name || access.startIndex < name.startIndex) ? access.text : ''
  return !/\b(private|internal|protected)\b/.test(modifiers?.text ?? declarationAccess)
}

/** Public declarations only: method bodies and private containers never become API pages. */
function declarations(node: Node, language: Language): Node[] {
  const types = language === 'kotlin'
    ? /^(class_declaration|object_declaration|companion_object|function_declaration|property_declaration|type_alias|secondary_constructor|enum_entry)$/
    : /^(class_definition|trait_definition|object_definition|enum_definition|type_definition|function_definition|function_declaration|val_definition|var_definition|given_definition|extension_definition|export_declaration|simple_enum_case|full_enum_case)$/
  return childrenOf(node).flatMap((child) => child.type === 'enum_case_definitions'
    ? declarations(child, language) : types.test(child.type) ? [child] : [])
}

function documentation(node: Node, language: Language, signature: Signature, comments: Node[], source: string) {
  // A grammar can attach a trailing comment to the preceding expression's
  // body. Source adjacency, rather than sibling ownership, binds the comment.
  const before = comments.findLast((comment) => comment.endIndex <= node.startIndex)
  if (!before || node.startPosition.row > before.endPosition.row + 1 ||
      source.slice(before.endIndex, node.startIndex).trim()) return undefined
  const raw = before.text.slice(3, -2).split('\n').map((line) => line.replace(/^\s*\* ?/, '')).join('\n').trim()
  // Keep native links intact; the inline tokenizer must distinguish them
  // from generic brackets inside code such as `Execution[F]`.
  const parsed = parseMarkdownDocFull(raw, language)
  for (const param of signature.params) param.doc = parsed.params.get(param.name)
  if (parsed.returnsDoc) signature.returnsDoc = parsed.returnsDoc
  if (parsed.raises.length) signature.raises = parsed.raises
  return parsed.doc
}

function parameters(node: Node, language: Language, firstGroupOnly = false): Param[] {
  const groups = node.type === 'primary_constructor' ? [node] : childrenOf(node).filter((child) => language === 'kotlin'
    ? ['function_value_parameters', 'class_parameters'].includes(child.type)
    : ['parameters', 'class_parameters'].includes(child.type))
  return (firstGroupOnly ? groups.slice(0, 1) : groups).flatMap((group) => childrenOf(group)
    .filter((param) => /^(parameter|class_parameter)$/.test(param.type))
    .map((param): Param => {
      const name = field(param, 'name') ?? named(param, 'simple_identifier', 'identifier')
      const type = field(param, 'type') ?? param.children.find((child, index, all) => all[index - 1]?.type === ':')
      const value = field(param, 'default_value') ?? field(param, 'value') ??
        param.children.find((child, index, all) => all[index - 1]?.type === '=') ??
        (param.nextSibling?.type === '=' ? param.nextSibling.nextSibling : undefined)
      if (!name || !type) throw new Error(`Unparsed ${language} parameter: ${param.text}`)
      return {
        name: name.text,
        type: compact(type.text),
        ...(value ? { default: compact(value.text) } : {}),
        ...(/\bvararg\b/.test(param.text) ? { variadic: 'positional' as const } : {}),
      }
    }))
}

/** Extract handwritten declarations and generated extensions in one symbol table. */
export async function extractJvm(port: Language, roots: string[], revision?: string): Promise<ApiModel> {
  const parser = await parserFor(port)
  const symbols = new Map<string, ApiSymbol>()
  const extensions: ApiSymbol[] = []
  const exports: { parent: string; target: string }[] = []
  const files: string[] = []
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (path.endsWith(port === 'kotlin' ? '.kt' : '.scala')) files.push(path)
    }
  }
  roots.forEach(collect)
  if (!files.length) throw new Error(`No ${port} public sources in ${roots.join(', ')}`)

  const emit = (symbol: ApiSymbol) => {
    const previous = symbols.get(symbol.id)
    if (!previous) { symbols.set(symbol.id, symbol); return }
    const companion = previous.kind === 'module' || symbol.kind === 'module'
    if (companion) {
      // A Scala opaque type and its companion share the public name. Keep
      // both declarations and the type's kind on their common reference page.
      if (previous.kind === 'module' && symbol.kind !== 'module') previous.kind = symbol.kind
    } else if (previous.kind !== symbol.kind) {
      throw new Error(`Conflicting ${port} declarations for ${symbol.id}`)
    } else if (!previous.modifiers.includes('overload')) previous.modifiers.push('overload')
    previous.signatures.push(...symbol.signatures)
    previous.doc ??= symbol.doc
  }

  try {
    for (const file of files.sort()) {
      const source = readFileSync(file, 'utf8')
      const tree = parser.parse(source)
      if (!tree) throw new Error(`Cannot parse ${file}`)
      try {
        const root = tree.rootNode
        const comments: Node[] = []
        const collectComments = (node: Node): void => {
          if (/comment/.test(node.type) && node.text.startsWith('/**')) comments.push(node)
          else for (const child of childrenOf(node)) collectComments(child)
        }
        collectComments(root)
        const packageNode = named(root, 'package_header', 'package_clause')
        const namespace = packageNode && (field(packageNode, 'name') ?? named(packageNode, 'identifier'))?.text
        if (!namespace || /[{};]/.test(namespace)) throw new Error(`Unsupported ${port} package in ${file}`)
        const imports = new Map<string, string>()
        for (const match of source.matchAll(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/gm)) {
          imports.set(match[2] ?? match[1].split('.').at(-1)!, match[1])
        }
        for (const match of source.matchAll(/^import\s+([\w.]+)\.\{([^{}]+)\}/gm)) {
          for (const entry of match[2].split(',')) {
            const [name, alias] = entry.trim().split(/\s+(?:=>|as)\s+/)
            if (/^\w+$/.test(name) && (!alias || /^\w+$/.test(alias))) imports.set(alias ?? name, `${match[1]}.${name}`)
          }
        }
        const receiverId = (type: string) => {
          const bare = type.replace(/[<[].*$/, '').trim()
          const [head, ...rest] = bare.split('.')
          return [imports.get(head) ?? `${namespace}.${head}`, ...rest].join('.')
        }
        const checkSyntax = (node: Node): void => {
          // Kotlin's bundled grammar rejects the soft keyword `open()` in
          // an internal implementation. A private subtree cannot contribute
          // declarations. Every error in public syntax still stops extraction.
          if (!visible(node)) return
          if (node.isError || node.isMissing) throw new Error(`${file}:${node.startPosition.row + 1}: unparsed public ${port} syntax: ${node.text}`)
          for (const child of childrenOf(node)) if (child.hasError || child.isError || child.isMissing) checkSyntax(child)
        }
        checkSyntax(root)

        const walk = (body: Node, parent?: string, receiver?: string, extensionHeader?: string): void => {
          for (const node of declarations(body, port)) {
            if (!visible(node)) continue
            if (node.type === 'export_declaration') {
              if (!parent || !named(node, 'namespace_wildcard')) {
                throw new Error(`Unsupported Scala export: ${node.text}`)
              }
              const target = childrenOf(node).filter((child) => child.type === 'identifier').map((child) => child.text).join('.')
              exports.push({ parent, target })
              continue
            }
            if (node.type === 'extension_definition') {
              const params = parameters(node, port, true)
              if (params.length !== 1 || !params[0].type) throw new Error(`Unsupported extension receiver: ${node.text}`)
              const end = Math.max(...childrenOf(node).filter((child) => ['parameters', 'type_parameters'].includes(child.type)).map((child) => child.endIndex))
              const header = node.text.slice(0, end - node.startIndex).trim()
              walk(node, parent, receiverId(params[0].type), header)
              continue
            }
            const variable = named(node, 'variable_declaration')
            const nameNode = field(node, 'name') ?? (variable && named(variable, 'simple_identifier')) ?? named(node, 'simple_identifier', 'type_identifier', 'identifier')
            const name = nameNode?.text ?? (node.type === 'companion_object' ? 'Companion'
              : node.type === 'given_definition' ? `given_${field(node, 'return_type')?.text.replace(/\W+/g, '_').replace(/_$/, '')}` : undefined)
            if (!name) throw new Error(`Unnamed public ${port} declaration in ${file}:${node.startPosition.row + 1}: ${node.type}`)
            const container = /^(class_declaration|object_declaration|companion_object|class_definition|trait_definition|object_definition|enum_definition)$/.test(node.type)
            const kind: SymbolKind = /^(object_|companion_)/.test(node.type) ? 'module'
              : /enum/.test(node.type) ? (container ? 'enum' : 'constant')
              : /trait/.test(node.type) ? 'trait'
              : container ? (node.children.some((child) => child?.type === 'interface') ? 'interface' : 'class')
              : /type_(alias|definition)/.test(node.type) ? 'typealias'
              : /function/.test(node.type) ? (parent || receiver ? 'method' : 'function')
              : /given/.test(node.type) ? 'constant' : 'property'
            let owner = parent
            let ownReceiver = receiver
            // Kotlin extensions put their receiver before the member name.
            if (port === 'kotlin' && !container && nameNode) {
              const receiverNode = childrenOf(node).find((child) => /^(user_type|nullable_type|receiver_type)$/.test(child.type) && child.endIndex < nameNode.startIndex)
              if (receiverNode) ownReceiver = receiverId(receiverNode.text)
            }
            if (ownReceiver) owner = ownReceiver
            const id = `${owner ?? namespace}.${name}`
            const block = field(node, 'body') ?? named(node, 'class_body', 'enum_class_body', 'function_body', 'template_body', 'enum_body', 'getter')
            const equal = node.children.find((child) => child?.type === '=')
            const end = kind === 'typealias' ? node.endIndex : Math.min(block?.startIndex ?? node.endIndex, equal?.startIndex ?? node.endIndex)
            let raw = source.slice(node.startIndex, end).trim()
            const constructor = named(node, 'primary_constructor')
            const scalaConstructorAccess = port === 'scala' && container ? named(node, 'access_modifier') : undefined
            const privateConstructor = constructor && !visible(constructor) ||
              scalaConstructorAccess && /\b(private|protected)\b/.test(scalaConstructorAccess.text)
            if (constructor && !visible(constructor)) {
              raw = (source.slice(node.startIndex, constructor.startIndex) + source.slice(constructor.endIndex, end)).trim()
            }
            if (scalaConstructorAccess && privateConstructor) {
              const last = childrenOf(node).filter((child) => child.type === 'class_parameters').at(-1)
              raw = (source.slice(node.startIndex, scalaConstructorAccess.startIndex) +
                source.slice(last?.endIndex ?? scalaConstructorAccess.endIndex, end)).trim()
            }
            const returns = field(node, 'return_type') ?? (variable && variable.children.find((child, i, all) => all[i - 1]?.type === ':')) ??
              node.children.find((child, i, all) => all[i - 1]?.type === ':')
            const signature: Signature = {
              raw: extensionHeader ? `${extensionHeader}\n${raw}` : raw,
              params: parameters(constructor ?? node, port),
              ...(returns ? { returns: compact(returns.text) } : {}),
            }
            // A private constructor is not a public callable signature.
            if (privateConstructor) signature.params = []
            const symbol: ApiSymbol = {
              id, name, kind: ownReceiver && kind === 'function' ? 'method' : kind,
              parent: owner, signatures: [signature], imports: Object.fromEntries(imports),
              modifiers: /\bsuspend\b/.test(named(node, 'modifiers')?.text ?? '') ? ['async'] : [],
              doc: documentation(node, port, signature, comments, source), source: { file, line: node.startPosition.row + 1 },
            }
            if (ownReceiver) extensions.push(symbol)
            else emit(symbol)
            if (container) {
              if (port === 'scala') {
                for (const group of childrenOf(node).filter((child) => child.type === 'class_parameters')) {
                  for (const prop of childrenOf(group).filter((child) => child.type === 'class_parameter')) {
                    if (!visible(prop) || !/\b(?:val|var)\b/.test(prop.text)) continue
                    const propName = field(prop, 'name')?.text
                    const propType = field(prop, 'type')?.text
                    if (!propName || !propType) throw new Error(`Unparsed public Scala property: ${prop.text}`)
                    emit({ id: `${id}.${propName}`, name: propName, kind: 'property', parent: id,
                      imports: Object.fromEntries(imports), modifiers: [],
                      signatures: [{ raw: prop.text, params: [], returns: propType }],
                      source: { file, line: prop.startPosition.row + 1 } })
                  }
                }
              }
              if (constructor) {
                for (const prop of childrenOf(constructor).filter((child) => child.type === 'class_parameter')) {
                  if (!visible(prop) || !named(prop, 'binding_pattern_kind')) continue
                  const propName = named(prop, 'simple_identifier')?.text
                  if (!propName) throw new Error(`Unnamed constructor property: ${prop.text}`)
                  emit({ id: `${id}.${propName}`, name: propName, kind: 'property', parent: id,
                    modifiers: [], signatures: [{ raw: prop.text, params: [] }],
                    source: { file, line: prop.startPosition.row + 1 } })
                }
              }
              if (block) walk(block, id)
            }
          }
        }
        walk(root)
      } finally { tree.delete() }
    }
    for (const entry of exports) {
      const members = [...symbols.values()].filter((symbol) => symbol.parent === entry.target)
      if (!members.length) throw new Error(`Scala export target has no public members: ${entry.target}`)
      for (const member of members) {
        emit({ ...structuredClone(member), id: `${entry.parent}.${member.name}`,
          parent: entry.parent, exportedFrom: member.id })
      }
    }
    for (const extension of extensions) {
      // Extensions of a foreign standard-library type remain public functions.
      // Their written receiver stays in the signature; inventing an owner
      // would create broken breadcrumbs and an empty reference destination.
      if (extension.parent && !symbols.has(extension.parent)) {
        extension.parent = undefined
        if (extension.kind === 'method') extension.kind = 'function'
      }
      emit(extension)
    }
    return { port, revision, extractor: `@libtmux/api-model (${port} syntax)`, symbols: [...symbols.values()] }
  } finally { parser.delete() }
}
