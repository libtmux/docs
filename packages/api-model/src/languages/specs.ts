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
  // Rust's privacy is a keyword on the item, and everything without `pub` is
  // crate-internal — which is exactly what a public reference must exclude.
  //
  // Two exceptions, and both are the same mistake made twice.
  //
  // An `impl` block is never written `pub impl`, so the visibility test
  // rejected the block and its fifty `pub fn`s were never reached — that cost
  // every method on every struct. An enum variant is never written `pub
  // Session` either, for the same reason: a variant is as public as its enum,
  // and there is no syntax to say otherwise. Adding `enum_variant` to the
  // members map changed nothing at all until this line changed with it.
  isExported: (node) =>
    node.type === 'impl_item' ||
    node.type === 'enum_variant' ||
    node.children.some((c) => c?.type === 'visibility_modifier'),
  fields: { returns: 'return_type' },
}

export const GO: LanguageSpec = {
  grammar: 'go',
  containers: { type_spec: 'struct' },
  members: {
    function_declaration: 'function',
    method_declaration: 'method',
    field_declaration: 'attribute',
    const_spec: 'constant',
  },
  transparent: ['type_declaration', 'const_declaration', 'var_declaration', 'struct_type', 'interface_type', 'field_declaration_list'],
  commentTypes: ['comment'],
  // godoc has no marker: a `//` comment directly above a declaration is the
  // documentation. `//go:` directives are build metadata and are not.
  stripDoc: (raw) =>
    raw.startsWith('//') && !raw.startsWith('//go:') ? raw.replace(/^\/\/\s?/, '') : undefined,
  // `func (w Window) Panes()` — the owning type is in the `receiver` field,
  // not in any enclosing node. Pointers and aliases both appear; the type name
  // is what matters, so `*Window` and `Window` resolve to the same owner.
  receiverType: (node) => {
    if (node.type !== 'method_declaration') return undefined
    const decl = node.childForFieldName('receiver')?.namedChildren[0]
    const type = decl?.childForFieldName('type')?.text
    return type?.replace(/^[*&]+/, '').replace(/\[.*$/, '').trim() || undefined
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
  containers: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    enum_declaration: 'enum',
    record_declaration: 'struct',
  },
  members: {
    method_declaration: 'method',
    constructor_declaration: 'method',
    field_declaration: 'attribute',
    enum_constant: 'constant',
  },
  transparent: ['program', 'class_body', 'interface_body', 'enum_body', 'enum_body_declarations'],
  commentTypes: ['line_comment', 'block_comment', 'comment'],
  stripDoc: stripBlockDoc,
  modifiers: { static: 'static', abstract: 'abstract', private: 'private', final: 'readonly' },
  isExported: (node) => !node.children.some((c) => c?.type === 'modifiers' && /\bprivate\b/.test(c.text)),
}

export const CSHARP: LanguageSpec = {
  grammar: 'csharp',
  docDialect: 'xml',
  containers: {
    class_declaration: 'class',
    interface_declaration: 'interface',
    struct_declaration: 'struct',
    enum_declaration: 'enum',
    record_declaration: 'struct',
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
  isExported: (node) =>
    node.type === 'enum_member_declaration' ||
    node.children.some((c) => c?.type === 'modifier' && /\b(public|protected|internal)\b/.test(c.text)),
  fields: { returns: 'type' },
}

export const SPECS = { ts: TYPESCRIPT, rs: RUST, go: GO, java: JAVA, dotnet: CSHARP } as const
