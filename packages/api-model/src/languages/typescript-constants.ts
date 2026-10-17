import type { Node } from 'web-tree-sitter'
import type { ApiSymbol, DocBlock } from '../model.ts'

function scalarProperty(node: Node | null): node is Node {
  const key = node?.childForFieldName('key')
  if (node?.type !== 'pair' || key?.type !== 'property_identifier' || key.text === '__proto__') return false
  const value = node.childForFieldName('value')
  return Boolean(value && (['string', 'number', 'true', 'false', 'null'].includes(value.type) ||
    (value.type === 'unary_expression' && /^[+-]$/.test(value.firstChild?.text ?? '') &&
      value.lastNamedChild?.type === 'number')))
}

/** A static write can replace one key; an unknown write can replace any key. */
function propertyName(node: Node): string | undefined {
  const key = node.childForFieldName('key') ?? node.childForFieldName('name') ??
    (node.type === 'shorthand_property_identifier' ? node : undefined)
  if (!key || key.text.includes('\\')) return undefined
  if (['property_identifier', 'shorthand_property_identifier'].includes(key.type)) return key.text
  if (key.type === 'string') return key.text.slice(1, -1)
  return undefined
}

function finalScalarProperties(object: Node): Node[] {
  const properties = new Map<string, Node>()
  for (const entry of object.namedChildren) {
    if (!entry || entry.type === 'comment') continue
    const name = propertyName(entry)
    if (name === undefined) {
      properties.clear()
      continue
    }
    properties.delete(name)
    if (scalarProperty(entry)) properties.set(name, entry)
  }
  return [...properties.values()]
}

/** Public `as const` objects retain their value declaration and scalar properties. */
export function attachTypeScriptConstants(
  root: Node,
  symbols: ApiSymbol[],
  file: string,
  module: string,
  readDoc: (node: Node) => DocBlock | undefined,
): void {
  for (const exported of root.namedChildren) {
    if (exported?.type !== 'export_statement') continue
    const declaration = exported.childForFieldName('declaration')
    if (declaration?.type !== 'lexical_declaration' || declaration.childForFieldName('kind')?.text !== 'const') continue
    for (const variable of declaration.namedChildren) {
      // An explicit annotation can widen the exported properties and make them writable.
      if (variable?.type !== 'variable_declarator' || variable.childForFieldName('type')) continue
      const name = variable.childForFieldName('name')
      const value = variable.childForFieldName('value')
      const object = value?.namedChildren[0]
      if (name?.type !== 'identifier' || value?.type !== 'as_expression' ||
          value.lastChild?.text !== 'const' || object?.type !== 'object') continue
      const properties = finalScalarProperties(object)
      if (!properties.length) continue
      const id = `${module}.${name.text}`
      const source = { file, line: variable.startPosition.row + 1 }
      const constant = {
        kind: 'constant' as const,
        text: `const ${variable.text};`,
        source,
        doc: readDoc(exported),
      }
      let owner = symbols.find((symbol) => symbol.id === id)
      if (owner && owner.kind !== 'typealias') continue
      if (owner) {
        const alias = root.namedChildren.flatMap((node) => node?.type === 'export_statement'
          ? [node.childForFieldName('declaration')] : [])
          .find((node) => node?.type === 'type_alias_declaration' && node.childForFieldName('name')?.text === name.text)
        if (!alias) continue
        owner.declarations = [constant, {
          kind: 'typealias' as const, text: alias.text, source: { ...owner.source }, doc: owner.doc,
        }].sort((a, b) => (a.source.line ?? 0) - (b.source.line ?? 0))
      } else {
        owner = {
          id, name: name.text, kind: 'constant', modifiers: [], signatures: [],
          value: value.text, source, doc: constant.doc, declarations: [constant],
        }
        symbols.push(owner)
      }
      for (const property of properties) {
        const key = property.childForFieldName('key')!
        const initializer = property.childForFieldName('value')!
        symbols.push({
          id: `${id}.${key.text}`, name: key.text, kind: 'property', parent: id,
          modifiers: ['readonly'], signatures: [], value: initializer.text,
          doc: readDoc(property), source: { file, line: property.startPosition.row + 1 },
        })
      }
    }
  }
}
