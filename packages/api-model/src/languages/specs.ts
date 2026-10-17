import type { Node } from 'web-tree-sitter'
import type { LanguageSpec } from './spec.ts'

/**
 * Per-language specs for the shared extractor.
 *
 * Each is a mapping from that grammar's node names onto the model's kinds,
 * plus how the language spells a doc comment and a modifier. Node names came
 * from parsing the real trees, not from the grammar's README — `type_spec`
 * versus `type_declaration` in Go, and `field_definition` versus
 * `public_field_definition` in TypeScript, are the kind of detail documentation
 * gets wrong and a parse does not.
 */

/** `/** … *\/` block comments: TypeScript, Java. Anything else is not docs. */
const stripBlockDoc = (raw: string): string | undefined => {
  if (!raw.startsWith('/**')) return undefined
  // Only the ` * ` gutter comes off, never the indentation after it. Trimming
  // each line — which this did — flattens every code block in every example:
  // a `for await` body and its closing brace came out at the same column as
  // the loop, and the reader is looking at the shape of the code.
  return raw
    .replace(/^\/\*\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^[ \t]*\*[ \t]?/, '').replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

/** `///` line comments: Rust, C#. `//!` is module-level and belongs to the file. */
const stripSlashDoc = (raw: string): string | undefined => {
  if (!raw.startsWith('///')) return undefined
  // One separator space after the slashes, and nothing else: `///     let x`
  // is indented code inside a doctest and `.trim()` flattened it.
  return raw.replace(/^\/\/\/+[ \t]?/, '').replace(/\s+$/, '')
}

/** Remove syntax nodes, not comment-looking text inside string literal types. */
function typescriptType(node: Node): string {
  const type = node.firstChild?.type === ':' ? node.namedChildren.find((child) => child?.type !== 'comment') ?? node : node
  let text = type.text
  const comments = type.descendantsOfType('comment').filter((node): node is Node => node !== null)
  for (const comment of comments.sort((a, b) => b.startIndex - a.startIndex)) {
    const start = comment.startIndex - type.startIndex
    const end = comment.endIndex - type.startIndex
    text = text.slice(0, start) + ' ' + text.slice(end)
  }
  const lines = text.split('\n')
  const rest = lines.slice(1).filter((line) => line.trim())
  const indent = rest.length ? Math.min(...rest.map((line) => /^\s*/.exec(line)![0].length)) : 0
  return [lines[0], ...lines.slice(1).map((line) => line.slice(Math.min(indent, /^\s*/.exec(line)![0].length)))]
    .filter((line) => line.trim()).join('\n').trim()
}

/** Inline option descriptions belong to the parameter, with their field paths. */
function typescriptParameter(node: Node) {
  const name = node.childForFieldName('name') ?? node.childForFieldName('pattern')
  if (!name) return undefined
  const type = node.childForFieldName('type')
  const descriptions: string[] = []
  const visit = (current: Node, path: string[]) => {
    for (const child of current.namedChildren) {
      if (!child || child.type === 'comment') continue
      if (child.type === 'property_signature') {
        const field = child.childForFieldName('name')?.text
        if (!field) continue
        const names = [...path, field]
        const previous = child.previousNamedSibling
        const doc = previous?.type === 'comment' && previous.endPosition.row >= child.startPosition.row - 1
          ? stripBlockDoc(previous.text) : undefined
        if (doc) descriptions.push(`- \`${names.join('.')}\`: ${doc.replaceAll('\n', '\n  ')}`)
        const nested = child.childForFieldName('type')
        if (nested) visit(nested, names)
      } else if (!['function_type', 'constructor_type'].includes(child.type)) visit(child, path)
    }
  }
  if (type) visit(type, [])
  return {
    name: name.text.replace(/^\.\.\./, ''),
    type: type ? typescriptType(type) : undefined,
    default: node.childForFieldName('value')?.text,
    ...(node.type === 'optional_parameter' ? { optional: true } : {}),
    ...(name.type === 'rest_pattern' ? { variadic: 'positional' as const } : {}),
    ...(descriptions.length ? { doc: descriptions.join('\n') } : {}),
  }
}

export const TYPESCRIPT: LanguageSpec = {
  grammar: 'typescript',
  containers: {
    class_declaration: 'class',
    abstract_class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
  },
  members: {
    method_definition: 'method',
    method_signature: 'method',
    function_declaration: 'function',
    // An overload set declares each form separately and documents the first,
    // then writes an implementation signature TypeScript hides from callers.
    // Only the implementation was extracted, so `splitSize` reached the page
    // with the one signature it cannot be called with, and no prose at all.
    function_signature: 'function',
    public_field_definition: 'attribute',
    property_signature: 'property',
    type_alias_declaration: 'typealias',
    // This port declares no `enum` today — it uses const objects and union
    // types — so this is here for the shape, not for a symbol it recovers.
    enum_assignment: 'constant',
  },
  // `export class X {}` wraps the declaration; the class is the child.
  transparent: ['export_statement', 'statement_block', 'class_body', 'interface_body', 'object_type', 'enum_body'],
  commentTypes: ['comment'],
  stripDoc: stripBlockDoc,
  modifiers: { static: 'static', abstract: 'abstract', async: 'async', readonly: 'readonly', private: 'private' },
  // TypeScript was the only port with no visibility test, so the reference
  // published module-private declarations as public API. A declaration whose
  // parent is the file itself was not exported; anything else reached here is
  // a member of something that was.
  //
  // Only functions. A module-private *type* is still named by the public
  // signatures that use it — `Pane.format` is a `PaneRow` — and dropping
  // those cost 472 cross-references, which is a worse reference than one
  // carrying a page for a shape a caller cannot import. Exporting them is the
  // port's decision to make. A private function is named by nothing.
  isExported: (node) =>
    node.parent?.type !== 'program' ||
    (node.type !== 'function_declaration' && node.type !== 'function_signature'),
  fields: { returns: 'return_type' },
  typeText: typescriptType,
  parameter: typescriptParameter,
}

/** Only a bare `hidden` doc argument hides an item; alias strings do not. */
function rustDocHidden(node: Node): boolean {
  for (let sibling = node.previousNamedSibling; sibling; sibling = sibling.previousNamedSibling) {
    if (sibling.type === 'attribute_item') {
      const attribute = sibling.namedChildren.find((child) => child?.type === 'attribute')
      if (attribute?.namedChildren[0]?.text !== 'doc') continue
      const args = attribute.namedChildren.find((child) => child?.type === 'token_tree')
      const tokens = args?.children.filter((child) => child &&
        child.type !== 'line_comment' && child.type !== 'block_comment') ?? []
      if (tokens.some((token, index) => token?.type === 'identifier' && token.text === 'hidden' &&
        ['(', ','].includes(tokens[index - 1]?.type ?? '') &&
        [')', ','].includes(tokens[index + 1]?.type ?? ''))) return true
    } else if (sibling.type !== 'line_comment' && sibling.type !== 'block_comment') break
  }
  return false
}

/** Outer attributes are siblings; doc comments remain in the prose projection. */
function rustHeader(node: Node): string {
  const body = node.childForFieldName('body')
  const kind = ['function_item', 'function_signature_item'].includes(node.type) ? 'callable header' : 'enclosing declaration'
  if (node.children.some((child) => child && child.id !== body?.id && (child.hasError || child.isMissing))) {
    throw new Error(`Invalid Rust ${kind} grammar at line ${node.startPosition.row + 1}`)
  }
  const prefix: Node[] = []
  for (let previous = node.previousNamedSibling; previous; previous = previous.previousNamedSibling) {
    if (previous.type === 'attribute_item') prefix.unshift(previous)
    else if (['line_comment', 'block_comment'].includes(previous.type)) {
      if (!/^\/\/[/!]|^\/\*[*!]/.test(previous.text)) prefix.unshift(previous)
    } else break
  }
  while (prefix.length && prefix[0]!.type !== 'attribute_item') prefix.shift()
  if (prefix.some((part) => part.hasError)) throw new Error(`Invalid Rust ${kind} attribute grammar at line ${node.startPosition.row + 1}`)
  const header = node.text.slice(0, body ? body.startIndex - node.startIndex : undefined).trimEnd()
  return [...prefix.map((part) => part.text), header].join('\n')
}

/** Bounds and defaults mention types; only the declaration's name binds one. */
function rustTypeParameterNames(node: Node): string[] | undefined {
  const parameters = node.childForFieldName('type_parameters')
  const nameOf = (parameter: Node): string | undefined => {
    if (parameter.type === 'type_identifier' || parameter.type === 'lifetime') return parameter.text
    if (parameter.type === 'const_parameter') return parameter.childForFieldName('name')?.text
    if (parameter.type === 'constrained_type_parameter') return parameter.childForFieldName('left')?.text
    const name = parameter.type === 'optional_type_parameter' ? parameter.childForFieldName('name') : null
    return name ? nameOf(name) : undefined
  }
  return parameters?.namedChildren.flatMap((parameter) => {
    const name = parameter && nameOf(parameter)
    return name ? [name] : []
  })
}

export const RUST: LanguageSpec = {
  grammar: 'rust',
  // `class` is only ever `impl_item` here: Rust has no other construct that
  // maps to it, so the kind is what identifies an extension block.
  extensionKind: 'class',
  containers: {
    struct_item: 'struct',
    enum_item: 'enum',
    trait_item: 'trait',
    // `impl Pane { … }` attaches members to a type declared elsewhere. It is
    // treated as a container so its methods are found; the project pass merges
    // them onto the type by name, the same way Python's inheritance works.
    impl_item: 'class',
  },
  members: {
    function_item: 'method',
    function_signature_item: 'method',
    field_declaration: 'attribute',
    const_item: 'constant',
    type_item: 'typealias',
    // An enum's variants are its API. Prose names `TmuxDispatchState.Unknown`
    // and `Subscription.Session` constantly and neither reached the reference,
    // because every spec extracted an enum's *methods* and none of them
    // extracted what the enum actually is. Modelled as constants: there is no
    // `variant` kind, and a named member of an enum is what a constant is.
    enum_variant: 'constant',
  },
  transparent: [
    'declaration_list',
    'field_declaration_list',
    'source_file',
    'mod_item',
    'enum_variant_list',
  ],
  commentTypes: ['line_comment', 'block_comment'],
  attributeTypes: ['attribute_item'],
  // A module compiled only for tests is not API. Rust keeps its unit tests
  // beside the code they exercise, so this is the whole of `mod tests`.
  skipNode: (node) =>
    node.type === 'mod_item' &&
    node.previousNamedSibling?.type === 'attribute_item' &&
    /#\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(node.previousNamedSibling.text),
  stripDoc: stripSlashDoc,
  modifiers: { async: 'async', unsafe: 'unsafe', 'pub(crate)': 'private' },
  // `impl Pane { … }` names the type it extends in `type`, not `name`. The
  // block then emits under that type's id, so its methods land on the struct
  // — Rust's equivalent of Python's inherited members, and the same mechanism
  // Swift extensions and C# partial classes need.
  nameFields: { impl_item: 'type' },
  // `impl<'a> Trait for &'a Foo` names its type as `&'a Foo`. Strip the
  // reference sigils and lifetimes to reach the type the members belong to,
  // which is `Foo` — the same type `struct Foo` declares, so the members land
  // on it rather than on a second entry nobody links to.
  cleanName: (raw) =>
    raw
      .replace(/^[&*]+\s*/, '')
      .replace(/'\w+\s*/g, '')
      .replace(/\bmut\s+/g, '')
      .replace(/\bdyn\s+/g, '')
      .trim(),
  // Receivers have no name field: splitting `mut self` would name it `mut`.
  parameter: (node) => node.type === 'self_parameter' ? { name: node.text } : undefined,
  rawSignature: (node) => ['function_item', 'function_signature_item'].includes(node.type)
    ? rustHeader(node) : undefined,
  typeParameterNames: (node) => ['function_item', 'function_signature_item'].includes(node.type)
    ? rustTypeParameterNames(node) : undefined,
  enclosingDeclaration: (node) => {
    const owner = node.parent?.parent
    const raw = owner && ['impl_item', 'trait_item'].includes(owner.type) ? rustHeader(owner) : undefined
    return owner && raw ? { raw, typeParamNames: rustTypeParameterNames(owner) } : undefined
  },
  // Trait methods and enum variants inherit their owner's visibility; the
  // walker rejects private owners before visiting their members. Impl blocks
  // have no visibility keyword, but inherent methods still require `pub`.
  // Restricted `pub(crate)`, `pub(super)` and `pub(in path)` are not public.
  isExported: (node) => {
    if (node.type === 'trait_item' && rustDocHidden(node)) return false
    if (node.type === 'impl_item' || node.type === 'enum_variant') return true
    if ((node.type === 'function_item' || node.type === 'function_signature_item') &&
      node.parent?.type === 'declaration_list' && node.parent.parent?.type === 'trait_item') {
      return !rustDocHidden(node)
    }
    return node.children.some((c) => c?.type === 'visibility_modifier' && c.text.trim() === 'pub')
  },
  fields: { returns: 'return_type' },
  enumVariant: (node) => {
    if (node.type !== 'enum_variant' || node.hasError) return undefined
    const owner = node.parent?.parent
    if (rustDocHidden(node) || (owner && rustDocHidden(owner))) return undefined
    const body = node.childForFieldName('body')
    // Conditional and attributed fields require native configuration information.
    // Keep the existing case entry rather than publish a guessed field set.
    if (body?.descendantsOfType('attribute_item').length) return undefined
    const shape = body?.type === 'field_declaration_list' ? 'struct'
      : body?.type === 'ordered_field_declaration_list' ? 'tuple' : 'unit'
    const nodes = shape === 'struct' ? body!.namedChildren.filter((field) => field?.type === 'field_declaration')
      : shape === 'tuple' ? body!.childrenForFieldName('type') : []
    const fields = nodes.flatMap((field, position) => {
      if (!field) return []
      const name = shape === 'tuple' ? String(position) : field.childForFieldName('name')?.text
      const type = shape === 'tuple' ? field.text : field.childForFieldName('type')?.text
      return name && type ? [{ name, type, node: field }] : []
    })
    if (fields.length !== nodes.length) return undefined
    const name = node.childForFieldName('name')!.text
    const value = node.childForFieldName('value')?.text
    const delimiters = shape === 'struct' ? [' {', '}'] : shape === 'tuple' ? ['(', ')'] : ['', '']
    const payload = fields.map((field) => `${shape === 'struct' ? `${field.name}: ` : ''}${field.type},`)
    const raw = `${name}${delimiters[0]}${payload.length ? `\n    ${payload.join('\n    ')}\n` : ''}${delimiters[1]}${value === undefined ? '' : ` = ${value}`}`
    return { shape, raw, fields, value }
  },
}

export const GO: LanguageSpec = {
  grammar: 'go',
  docDialect: 'godoc',
  containers: { type_spec: 'struct' },
  members: {
    function_declaration: 'function',
    method_declaration: 'method',
    field_declaration: 'attribute',
    const_spec: 'constant',
    var_spec: 'attribute',
  },
  transparent: ['type_declaration', 'const_declaration', 'var_declaration', 'struct_type', 'interface_type', 'field_declaration_list'],
  commentTypes: ['comment'],
  // godoc has no marker: a `//` comment directly above a declaration is the
  // documentation. `//go:` directives are build metadata and are not.
  stripDoc: (raw) => raw.startsWith('//') && !raw.startsWith('//go:')
    ? raw.replace(/^\/\/ ?/, '')
    : raw.startsWith('/*') ? raw.slice(2, -2) : undefined,
  rawSignature: (node) => {
    if (!['function_declaration', 'method_declaration'].includes(node.type)) return undefined
    const body = node.childForFieldName('body')
    return node.text.slice(0, body ? body.startIndex - node.startIndex : undefined).trimEnd()
  },
  parameter: (node) => {
    if (!['parameter_declaration', 'variadic_parameter_declaration'].includes(node.type)) return undefined
    const names = node.childrenForFieldName('name').flatMap((name) => name ? [name.text] : [])
    const type = node.childForFieldName('type')?.text
    return (names.length ? names : ['']).map((name) => ({
      name, type,
      ...(node.type === 'variadic_parameter_declaration' ? { variadic: 'positional' as const } : {}),
    }))
  },
  receiver: (node) => {
    const receiver = node.childForFieldName('receiver')?.namedChildren.find((child) => child?.type === 'parameter_declaration')
    return receiver ? { name: receiver.childForFieldName('name')?.text ?? '', type: receiver.childForFieldName('type')?.text } : undefined
  },
  // `func (w Window) Panes()` — the owning type is in the `receiver` field,
  // not in any enclosing node. Pointers and aliases both appear; the type name
  // is what matters, so `*Window` and `Window` resolve to the same owner.
  receiverType: (node) => {
    if (node.type !== 'method_declaration') return undefined
    const decl = node.childForFieldName('receiver')?.namedChildren[0]
    const type = decl?.childForFieldName('type')?.text
    return type?.replace(/^[*&]+/, '').replace(/\[.*$/, '').trim() || undefined
  },
  // `TreeSortIndex` under `TreeSortDefault TreeSortOrder = iota` repeats the
  // spec above it, type included. Without this only the first value of each
  // Go enum knew its type.
  implicitType: (node) => {
    if (node.type !== 'const_spec' || node.childForFieldName('value')) return undefined
    for (let prev = node.previousNamedSibling; prev; prev = prev.previousNamedSibling) {
      if (prev.type === 'const_spec' && prev.childForFieldName('value')) return prev.childForFieldName('type')?.text
    }
    return undefined
  },
  // Go's export rule is capitalisation, which is a property of the name rather
  // than a keyword — the one language here where visibility is spelling.
  isExported: (node) => {
    const name = node.childForFieldName('name')?.text ?? ''
    return /^[A-Z]/.test(name)
  },
  fields: { returns: 'result' },
}

export const JAVA: LanguageSpec = {
  grammar: 'java',
  docDialect: 'javadoc',
  typeParameterNames: (node) => node.childForFieldName('type_parameters')?.namedChildren.flatMap((parameter) => {
    const name = parameter?.type === 'type_parameter'
      ? parameter.namedChildren.find((child) => child?.type === 'type_identifier')?.text : undefined
    return name ? [name] : []
  }),
  declarationModifiers: (node) => ['annotation_type_declaration', 'annotation_type_element_declaration'].includes(node.type) ? ['annotation'] : [],
  typeScopeBoundary: (node) => {
    if (!['class_declaration', 'interface_declaration', 'annotation_type_declaration', 'enum_declaration',
      'record_declaration', 'field_declaration', 'enum_constant'].includes(node.type)) return undefined
    if (node.children.find((child) => child?.type === 'modifiers')?.children.some((child) => child?.type === 'static' && !child.isNamed)) return true
    if (node.type === 'enum_constant') return true
    // Member interfaces, annotations, enums and records are implicitly static.
    return ['class_body', 'interface_body', 'annotation_type_body', 'enum_body_declarations'].includes(node.parent?.type ?? '') &&
      (['interface_declaration', 'annotation_type_declaration', 'enum_declaration', 'record_declaration'].includes(node.type) ||
        (['class_declaration', 'field_declaration'].includes(node.type) && ['interface_body', 'annotation_type_body'].includes(node.parent!.type)))
  },
  signatureTypeScopeBoundary: (node) => {
    if (['constructor_declaration', 'annotation_type_element_declaration'].includes(node.type)) return false
    return node.type === 'method_declaration'
      ? Boolean(node.children.find((child) => child?.type === 'modifiers')?.children.some((child) => child?.type === 'static' && !child.isNamed))
      : undefined
  },
  parameter: (node) => {
    // The pinned grammar parses annotated receivers as formal parameters.
    if (node.type === 'receiver_parameter' ||
      (node.type === 'formal_parameter' && node.childForFieldName('name')?.text === 'this')) return []
    if (node.type !== 'spread_parameter') return undefined
    const name = node.namedChildren.find((child) => child?.type === 'variable_declarator')?.childForFieldName('name')?.text
    const type = node.namedChildren.find((child) => child &&
      !['modifiers', 'variable_declarator'].includes(child.type) && !JAVA.commentTypes.includes(child.type))?.text
    return name && type ? { name, type: node.parent?.parent?.type === 'record_declaration' ? `${type}[]` : type, variadic: 'positional' } : undefined
  },
  recordAccessors: (node) => node.type === 'record_declaration',
  rawSignature: (node) => {
    if (!['record_declaration', 'method_declaration', 'constructor_declaration', 'annotation_type_declaration', 'annotation_type_element_declaration'].includes(node.type)) return undefined
    const body = node.childForFieldName('body')
    return node.text.slice(0, body ? body.startIndex - node.startIndex : undefined).trimEnd()
  },
  containers: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    annotation_type_declaration: 'interface',
    enum_declaration: 'enum',
    record_declaration: 'class',
  },
  members: {
    method_declaration: 'method',
    annotation_type_element_declaration: 'method',
    constructor_declaration: 'method',
    field_declaration: 'attribute',
    enum_constant: 'constant',
  },
  transparent: ['program', 'class_body', 'interface_body', 'enum_body', 'enum_body_declarations'],
  commentTypes: ['line_comment', 'block_comment', 'comment'],
  stripDoc: stripBlockDoc,
  modifiers: { static: 'static', abstract: 'abstract', private: 'private', final: 'readonly' },
  isExported: (node) => {
    const modifiers = node.children.find((child) => child?.type === 'modifiers')?.text ?? ''
    if (/\bprivate\b/.test(modifiers)) return false
    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
      if (/\b(public|protected)\b/.test(modifiers) || node.parent?.type === 'interface_body') return true
      // Keep existing internal records, but do not merge their signatures into
      // an advertised overload set. Interface methods are implicitly public.
      const name = node.childForFieldName('name')?.text
      return !node.parent?.namedChildren.some((sibling) =>
        sibling?.type === node.type && sibling.childForFieldName('name')?.text === name &&
        sibling.children.some((child) => child?.type === 'modifiers' && /\b(public|protected)\b/.test(child.text)),
      )
    }
    return true
  },
}

export const CSHARP: LanguageSpec = {
  grammar: 'csharp',
  docDialect: 'xml',
  positionalProperties: (node) => ['record_declaration', 'record_struct_declaration'].includes(node.type)
    && Boolean(node.childForFieldName('parameters')),
  rawSignature: (node) => {
    if (!['record_declaration', 'record_struct_declaration'].includes(node.type)) return undefined
    const body = node.childForFieldName('body')
    return node.text.slice(0, body?.type === 'declaration_list' ? body.startIndex - node.startIndex : undefined).trimEnd()
  },
  containers: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    struct_declaration: 'struct',
    enum_declaration: 'enum',
    // A bare record is a reference type; only `record struct` is a value type.
    record_declaration: 'class',
    // `readonly record struct PaneId` is a node of its own. Missing here, its
    // constructor surfaced as a free function named `PaneId` and its members
    // as free symbols, and `PaneId`, `TmuxVersion` and eight more had no page.
    record_struct_declaration: 'struct',
  },
  members: {
    method_declaration: 'method',
    property_declaration: 'property',
    field_declaration: 'attribute',
    constructor_declaration: 'method',
    event_field_declaration: 'attribute',
    enum_member_declaration: 'constant',
  },
  transparent: [
    'compilation_unit',
    'namespace_declaration',
    'file_scoped_namespace_declaration',
    'declaration_list',
    'enum_member_declaration_list',
  ],
  commentTypes: ['comment'],
  // C# documentation is XML in `///` comments. The tags are left in place —
  // `<summary>` and `<param>` are structure the renderer can use, and
  // discarding them here would throw away the one language whose compiler
  // already produces a structured doc model.
  stripDoc: stripSlashDoc,
  modifiers: { static: 'static', abstract: 'abstract', async: 'async', private: 'private', readonly: 'readonly' },
  // An enum member carries no access modifier — it is as public as its enum —
  // so the modifier test rejected every one of them.
  // `internal` is not public API: the compiler refuses to name an internal
  // type in a public signature, so nothing a caller can reach mentions one.
  // Accepting it published 100 of libtmux-dotnet's implementation types —
  // `FormatCatalog`, `PsmuxBinaryTrust`, `Utf8BackslashDecoder` — as though a
  // consumer could use them.
  isExported: (node) =>
    node.type === 'enum_member_declaration' ||
    node.children.some((c) => c?.type === 'modifier' && /\b(public|protected)\b/.test(c.text)),
  fields: { returns: 'type' },
}

export const SPECS = { ts: TYPESCRIPT, rs: RUST, go: GO, java: JAVA, csharp: CSHARP } as const
