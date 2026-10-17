/** Definitions shared by API badges and the HTML, Markdown, and JSON glossary. */
import type { Modifier, SymbolKind } from '@libtmux/api-model'
import { DEFAULT_LOCALE, localeRoot } from '../i18n/locales.ts'
import { markdownDocument } from './markdown-twins.ts'
import { PORT_BY_SLUG, type DocProduct } from './ports.ts'
import { buildTarget } from './versions.ts'
import { NATIVE_API_GLOSSARIES } from './api-glossary-native.ts'

export interface Definition {
  definition: string
  detail?: string
  references: { title: string; url: string }[]
}

const kinds = {
  module: {
    definition: 'A named scope that groups related declarations for lookup or import.',
    detail: 'A module can be a Python file, a Julia namespace, or an F# grouping. The label alone does not identify an installable package.',
    references: [{ title: 'Python modules', url: 'https://docs.python.org/3/tutorial/modules.html' }],
  },
  class: {
    definition: 'A type that groups data and behavior, often with inheritance.',
    detail: 'The reference uses this category for class declarations and for Julia abstract types. Check the signature and abstract modifier before assuming a type can be constructed.',
    references: [
      { title: 'Python classes', url: 'https://docs.python.org/3/tutorial/classes.html' },
      { title: 'Julia types', url: 'https://docs.julialang.org/en/v1/manual/types/' },
    ],
  },
  interface: {
    definition: 'A contract describing the members or behavior a conforming type must provide.',
    detail: 'This category also includes Swift protocols. Conformance rules differ by language: Go interfaces are satisfied implicitly, while other languages can require a declared relationship.',
    references: [
      { title: 'Go interface types', url: 'https://go.dev/ref/spec#Interface_types' },
      { title: 'Swift protocols', url: 'https://docs.swift.org/swift-book/documentation/the-swift-programming-language/protocols/' },
    ],
  },
  struct: {
    definition: 'A structured type that groups fields and can expose operations on them.',
    detail: 'Copying, mutation, and inheritance follow the language. A C++ struct is a class with different default access; Julia distinguishes struct from mutable struct. This badge does not promise immutability.',
    references: [
      { title: 'C++ class declarations', url: 'https://eel.is/c++draft/class.pre' },
      { title: 'Julia composite types', url: 'https://docs.julialang.org/en/v1/manual/types/#Composite-Types' },
    ],
  },
  union: {
    definition: 'A type that represents alternative forms of a value.',
    detail: 'An F# discriminated union has named cases, which can carry data. A C++ union shares storage between members and has rules about which member is active. These have different representation and access rules.',
    references: [
      { title: 'F# discriminated unions', url: 'https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/discriminated-unions' },
      { title: 'C++ unions', url: 'https://eel.is/c++draft/class.union' },
    ],
  },
  enum: {
    definition: 'A type with named values or variants.',
    detail: 'C# enum members name integral values. Rust enum variants can also carry fields. Read the declaration to see which form is used.',
    references: [
      { title: 'C# enumeration types', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum' },
      { title: 'Rust enumerations', url: 'https://doc.rust-lang.org/reference/items/enumerations.html' },
    ],
  },
  trait: {
    definition: 'A named set of behavior that types can implement.',
    detail: 'Rust traits can declare methods, associated types, and associated constants, with default implementations where the language permits them.',
    references: [{ title: 'Rust traits', url: 'https://doc.rust-lang.org/reference/items/traits.html' }],
  },
  function: {
    definition: 'A callable operation documented at module or language scope.',
    detail: 'A PowerShell function is implemented in the scripting language; an advanced function can support cmdlet-style parameter binding and pipelines. Julia functions can have multiple methods selected by argument types.',
    references: [
      { title: 'PowerShell advanced functions', url: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_advanced' },
      { title: 'Julia methods', url: 'https://docs.julialang.org/en/v1/manual/methods/' },
    ],
  },
  method: {
    definition: 'A callable member associated with a type or object.',
    detail: 'An instance method works with an instance. Static and class methods use different binding rules, shown by their modifiers. Julia uses method to mean an implementation of a generic function for particular argument types.',
    references: [
      { title: 'Python method objects', url: 'https://docs.python.org/3/tutorial/classes.html#method-objects' },
      { title: 'Julia methods', url: 'https://docs.julialang.org/en/v1/manual/methods/' },
    ],
  },
  property: {
    definition: 'A named value accessed through an object or type, potentially through a getter or setter.',
    detail: 'The reference also uses this category for some extracted fields, including Julia fields. Reading a property can execute code; the badge alone does not establish whether it is writable or stored.',
    references: [
      { title: 'C# properties', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/properties' },
      { title: 'Julia composite types', url: 'https://docs.julialang.org/en/v1/manual/types/#Composite-Types' },
    ],
  },
  attribute: {
    definition: 'A named data attribute or field of an object or type.',
    detail: 'On these pages, attribute describes member data. .NET attributes that attach metadata to declarations are a separate language feature.',
    references: [{ title: 'Python class and instance attributes', url: 'https://docs.python.org/3/tutorial/classes.html' }],
  },
  constant: {
    definition: 'A named value or binding intended to remain fixed.',
    detail: 'Enforcement depends on the language. A constant binding does not necessarily make the referenced object immutable or require the value to be known at compile time.',
    references: [{ title: 'Julia constants', url: 'https://docs.julialang.org/en/v1/manual/variables-and-scoping/#Constants' }],
  },
  typealias: {
    definition: 'A name for an existing type or type expression.',
    detail: 'An alias can make a compound type easier to name. It does not by itself introduce a distinct runtime class.',
    references: [{ title: 'TypeScript type aliases', url: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-aliases' }],
  },
  exception: {
    definition: 'A type used to report an error through the language’s exception mechanism.',
    detail: 'The API documentation states when it can be raised or thrown and what a caller can catch. The label does not imply that every failure uses exceptions.',
    references: [{ title: 'Python exceptions', url: 'https://docs.python.org/3/library/exceptions.html' }],
  },
  cmdlet: {
    definition: 'A compiled .NET command invoked through PowerShell’s command and object-pipeline system.',
    detail: 'This label records PowerShell’s Cmdlet command type. Advanced script functions can offer similar parameter and pipeline features while retaining the Function command type. A cmdlet is not a standalone executable.',
    references: [
      { title: 'PowerShell cmdlet overview', url: 'https://learn.microsoft.com/en-us/powershell/scripting/developer/cmdlet/cmdlet-overview' },
      { title: 'PowerShell advanced functions', url: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_functions_advanced' },
    ],
  },
} satisfies Record<SymbolKind | 'cmdlet', Definition>

const modifiers = {
  annotation: NATIVE_API_GLOSSARIES.java.annotation,
  opaque: {
    definition: 'A type declaration whose representation is hidden outside its defining scope.',
    detail: 'Scala opaque type aliases keep their underlying representation visible within the defining scope while exposing the alias and its public operations to callers.',
    references: [{ title: 'Scala opaque type aliases', url: 'https://docs.scala-lang.org/scala3/reference/other-new-features/opaques.html' }],
  },
  static: {
    definition: 'A member associated with a type rather than bound to a particular instance.',
    detail: 'A Python staticmethod receives neither an implicit instance nor an implicit class argument. A classmethod receives the class. Static does not mean pure, immutable, or safe for concurrent calls.',
    references: [
      { title: 'C# static members', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/static' },
      { title: 'Python staticmethod', url: 'https://docs.python.org/3/library/functions.html#staticmethod' },
    ],
  },
  macro: {
    definition: 'A declaration expanded by a language’s macro mechanism rather than called as an ordinary function.',
    detail: 'Julia macros transform expressions. C and C++ preprocessor macros operate on tokens. Expansion rules, evaluation, and invocation syntax differ.',
    references: [
      { title: 'Julia macros', url: 'https://docs.julialang.org/en/v1/manual/metaprogramming/#man-macros' },
      { title: 'C++ macro replacement', url: 'https://eel.is/c++draft/cpp.replace' },
    ],
  },
  classmethod: {
    definition: 'A Python method that receives the calling class as its implicit first argument.',
    detail: 'It can be called through a class or an instance. A call through a subclass passes that subclass, which is useful for constructors that preserve the requested type.',
    references: [{ title: 'Python classmethod', url: 'https://docs.python.org/3/library/functions.html#classmethod' }],
  },
  abstract: {
    definition: 'A type or member whose complete implementation is supplied by a concrete subtype.',
    detail: 'An abstract type cannot be constructed directly. An abstract member declares required behavior. Julia abstract types define a place in the type hierarchy rather than a concrete data layout.',
    references: [
      { title: 'C# abstract declarations', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/abstract' },
      { title: 'Julia abstract types', url: 'https://docs.julialang.org/en/v1/manual/types/#Abstract-Types' },
    ],
  },
  async: {
    definition: 'An operation that participates in the language’s asynchronous or suspending execution model.',
    detail: 'Use the await or coroutine mechanism required by the signature. Python async functions, .NET task-returning methods, and Kotlin suspend functions have different invocation rules. This label does not promise a new thread or parallel execution.',
    references: [
      { title: 'Python coroutine functions', url: 'https://docs.python.org/3/reference/compound_stmts.html#coroutine-function-definition' },
      { title: 'C# async methods', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/async' },
      { title: 'Kotlin coroutines', url: 'https://kotlinlang.org/docs/coroutines-basics.html' },
    ],
  },
  readonly: {
    definition: 'A declaration with restrictions on assignment or mutation through the documented member.',
    detail: 'The exact restriction depends on the language and declaration. The C++ extractor also uses this label for const-qualified methods. A read-only field or reference does not necessarily make the object it refers to deeply immutable.',
    references: [
      { title: 'C# readonly', url: 'https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly' },
      { title: 'C++ cv-qualification', url: 'https://eel.is/c++draft/dcl.type.cv' },
    ],
  },
  deprecated: {
    definition: 'An API marked as discouraged for new use by its source documentation or language metadata.',
    detail: 'Read the entry for its replacement and any removal schedule. Deprecation alone does not mean the API is absent or that calling it always emits a warning.',
    references: [{ title: 'Python warning categories', url: 'https://docs.python.org/3/library/warnings.html#warning-categories' }],
  },
  overload: {
    definition: 'An operation documented with more than one accepted signature.',
    detail: 'The numbered badge reports the signatures shown by the reference. Python typing overloads describe one implementation to a type checker; other languages can select separate implementations. The badge does not define a common dispatch rule.',
    references: [
      { title: 'Python typing overloads', url: 'https://docs.python.org/3/library/typing.html#typing.overload' },
      { title: 'Julia method dispatch', url: 'https://docs.julialang.org/en/v1/manual/methods/' },
    ],
  },
  private: {
    definition: 'A declaration whose intended or enforced accessibility is restricted.',
    detail: 'The restriction may be a naming convention, a type-checking rule, or a runtime access rule. For example, TypeScript private and JavaScript #private have different enforcement. The badge alone is not a security boundary.',
    references: [{ title: 'TypeScript private members', url: 'https://www.typescriptlang.org/docs/handbook/2/classes.html#private' }],
  },
  generator: {
    definition: 'A callable that produces a generator or iterator, yielding values as iteration advances.',
    detail: 'For a Python generator function, calling it creates the generator; iteration runs the body until the next yield. Reading every value can therefore execute work or raise errors later than the initial call.',
    references: [{ title: 'Python generators', url: 'https://docs.python.org/3/glossary.html#term-generator' }],
  },
  unsafe: {
    definition: 'A Rust declaration that carries safety obligations the compiler cannot fully check.',
    detail: 'For an unsafe function, the caller must uphold the documented invariants. For an unsafe trait, implementers must uphold its contract. Read the entry’s safety requirements before using or implementing it.',
    references: [{ title: 'Rust unsafe', url: 'https://doc.rust-lang.org/reference/unsafe-keyword.html' }],
  },
  inherited: {
    definition: 'A member available on a type through a declaration supplied by a base type.',
    detail: 'The reference identifies the declaring type. Follow that declaration for its signature and documentation; inheritance and overriding rules depend on the language.',
    references: [{ title: 'Python inheritance', url: 'https://docs.python.org/3/tutorial/classes.html#inheritance' }],
  },
} satisfies Record<Modifier | 'inherited' | 'opaque', Definition>

const context = {
  package: {
    definition: 'The library package that supplies the documented declaration.',
    detail: 'The badge displays the package’s name rather than the word package. Package, import, module, and namespace names can differ; use the port’s installation and import instructions.',
    references: [{ title: 'Python distribution and import packages', url: 'https://packaging.python.org/en/latest/discussions/distribution-package-vs-import-package/' }],
  },
} satisfies Record<'package', Definition>

export interface ApiGlossaryTerm extends Definition {
  id: string
}

export const API_GLOSSARY_TITLE = 'API glossary'
export const API_GLOSSARY_DESCRIPTION = 'What the kind, modifier, and package labels in the API reference mean, with language-specific distinctions.'
export const API_GLOSSARY_PATH = `${localeRoot(DEFAULT_LOCALE)}reference/glossary/`

export const API_GLOSSARY_GROUPS: { id: string; title: string; description: string; terms: ApiGlossaryTerm[] }[] = [
  { id: 'symbol-kinds', title: 'Symbol kinds', description: 'Kinds identify the declaration being documented. Some categories group equivalent language constructs under one label.', terms: Object.entries(kinds).map(([id, definition]) => ({ id, ...definition })) },
  { id: 'modifiers', title: 'Modifiers', description: 'Modifiers add information about calling, implementing, or accessing a declaration. Their precise effect follows the language and the signature.', terms: Object.entries(modifiers).map(([id, definition]) => ({ id, ...definition })) },
  { id: 'package-context', title: 'Package context', description: 'Package labels identify where an API is supplied.', terms: Object.entries(context).map(([id, definition]) => ({ id, ...definition })) },
]

export const MCP_GLOSSARY_TITLE = 'MCP API glossary'
export const MCP_GLOSSARY_DESCRIPTION = 'What MCP tool annotations tell clients about a tool.'
const annotationReference = [{ title: 'MCP ToolAnnotations', url: 'https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations' }]
export const MCP_GLOSSARY_GROUPS: typeof API_GLOSSARY_GROUPS = [{
  id: 'mcp-tool-annotations', title: 'MCP tool annotations',
  description: 'These are server-supplied hints, not enforced guarantees. Clients must not base tool-use decisions on annotations from untrusted servers.',
  terms: [
    { id: 'readOnlyHint', definition: 'True indicates that the tool leaves its environment unchanged.', detail: 'Defaults to false when omitted.', references: annotationReference },
    { id: 'destructiveHint', definition: 'True indicates potentially destructive changes; false indicates additive changes only.', detail: 'Defaults to true. Meaningful only when readOnlyHint is false.', references: annotationReference },
    { id: 'idempotentHint', definition: 'True indicates that repeating a call with identical arguments adds no further effects.', detail: 'Defaults to false. Meaningful only when readOnlyHint is false. It does not promise identical responses.', references: annotationReference },
    { id: 'openWorldHint', definition: 'True indicates possible interaction with external entities; false indicates a closed interaction domain.', detail: 'Defaults to true. This describes the interaction domain, not whether the tool writes data.', references: annotationReference },
    { id: 'title', definition: 'A display title for the tool.', detail: 'The tool’s top-level title takes precedence, followed by annotations.title, then name.', references: annotationReference },
  ],
}]
export const ALL_GLOSSARY_GROUPS = [...API_GLOSSARY_GROUPS, ...MCP_GLOSSARY_GROUPS]
const terms = new Map(ALL_GLOSSARY_GROUPS.flatMap((group) => group.terms.map((term) => [term.id, term] as const)))
const nativeGroups = new Map(Object.entries(NATIVE_API_GLOSSARIES).map(([port, native]) => [port,
  API_GLOSSARY_GROUPS.map((group) => ({ ...group,
    description: group.id === 'symbol-kinds' ? `Kinds identify declarations in the ${PORT_BY_SLUG[port].name} API reference.` : group.description,
    terms: group.terms.flatMap((term) => native[term.id] ? [{ id: term.id, ...native[term.id] }] : []),
  })).filter((group) => group.terms.length),
]))

/** Native content and contextual identity shared by pages, previews and exports. */
export function apiGlossary(contextPath?: string) {
  const match = contextPath?.match(/^(.*?\/([^/]+)\/([^/]+)\/)((mcp|workspace)\/)?(?:reference(?:\/|\.)|tools\/|prompts\/|resources\/)/)
  const contextual = match && Object.hasOwn(PORT_BY_SLUG, match[2]) ? match : undefined
  const candidate = contextual?.[2] ?? (contextPath ? undefined : process.env.LIBTMUX_DOCS_PORT)
  const port = candidate && Object.hasOwn(PORT_BY_SLUG, candidate) ? candidate : undefined
  const product = contextual?.[5] as DocProduct | undefined
  const version = contextual?.[3] ?? buildTarget(process.env).version
  const path = port
    ? `${contextual ? `${contextual[1]}${contextual[4] ?? ''}reference/` : `${localeRoot(DEFAULT_LOCALE)}${port}/${version}/reference/`}glossary/`
    : API_GLOSSARY_PATH
  const languageGroups = port ? nativeGroups.get(port) ?? [] : API_GLOSSARY_GROUPS
  const mcp = product === 'mcp'
  return { port, product, path, title: mcp ? MCP_GLOSSARY_TITLE : API_GLOSSARY_TITLE,
    description: mcp ? MCP_GLOSSARY_DESCRIPTION : port ? `Kinds, modifiers and package labels in the ${PORT_BY_SLUG[port].name} API reference.` : API_GLOSSARY_DESCRIPTION,
    groups: mcp ? [...MCP_GLOSSARY_GROUPS, ...languageGroups] : port ? languageGroups : ALL_GLOSSARY_GROUPS,
  }
}

/** Page contents follow the same filtered native groups and term order. */
export function apiGlossaryHeadings(contextPath?: string) {
  return apiGlossary(contextPath).groups.flatMap((group) => [
    { depth: 2, slug: group.id, text: group.title },
    ...group.terms.map((term) => ({ depth: 3, slug: term.id, text: term.id })),
  ])
}

/** Unknown labels remain plain text rather than linking to an absent definition. */
export function apiGlossaryHref(term: string, contextPath?: string): string | undefined {
  if (!terms.has(term)) return undefined
  const glossary = apiGlossary(contextPath)
  return glossary.groups.some((group) => group.terms.some((entry) => entry.id === term)) ? `${glossary.path}#${term}` : undefined
}

/** The page's authored Markdown also feeds its LLM export. */
export function apiGlossaryBody(contextPath?: string): string {
  const glossary = apiGlossary(contextPath)
  return glossary.groups.flatMap((group) => [
    `## ${group.title}`, '', group.description, '',
    ...group.terms.flatMap((term) => [
      `### ${term.id}`, '', term.definition, '',
      ...(term.detail ? [term.detail, ''] : []),
      `References: ${term.references.map((ref) => `[${ref.title}](${ref.url})`).join('; ')}.`, '',
    ]),
  ]).join('\n')
}

/** The Markdown twin uses the same definitions and references as the HTML page. */
export function apiGlossaryMarkdown(origin: string, contextPath?: string): string {
  const glossary = apiGlossary(contextPath)
  return markdownDocument({ title: glossary.title, description: glossary.description, url: new URL(glossary.path, origin).href, body: apiGlossaryBody(contextPath) })
}
