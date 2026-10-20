/**
 * Find where a library's source sends a tmux command.
 *
 * A send site is a string literal that spells a command name, in code rather
 * than in a comment or a docstring. The scan attributes each site to the
 * innermost named function around it and keeps the flag literals that travel
 * with the command, because the flags choose the scope tmux lists.
 */
import { parserFor } from '../../packages/api-model/src/parser.ts'

/** Port to the tree-sitter grammar that reads its source. PowerShell cmdlets are C#. */
export const GRAMMARS = {
  py: 'python', ts: 'typescript', rs: 'rust', go: 'go', java: 'java', kotlin: 'kotlin', scala: 'scala',
  csharp: 'csharp', powershell: 'csharp', cxx: 'cpp', swift: 'swift', ruby: 'ruby', lua: 'lua', julia: 'julia',
}

/** Source extensions per grammar, minus declaration-only files. */
export const EXTENSIONS = {
  python: /\.py$/, typescript: /(?<!\.d)\.ts$/, rust: /\.rs$/, go: /\.go$/, java: /\.java$/, kotlin: /\.kt$/,
  scala: /\.scala$/, csharp: /\.cs$/, cpp: /\.(?:cpp|cc|cxx|hpp|hh|h)$/, swift: /\.swift$/, ruby: /\.rb$/, lua: /\.lua$/, julia: /\.jl$/,
}

/** Directories and names that hold tests, examples, tooling and build output rather than the library. */
const NOT_LIBRARY = new RegExp([
  String.raw`(?:^|/)(?:tests?|__tests__|specs?|testing|fixtures?|examples?|benchmarks?|bench|docs?|samples?|scripts?|tools?|eng|build|dist|target|node_modules|vendor|generated|Tests?|UnitTests|IntegrationTests)(?:/|$)`,
  String.raw`(?:^|/)(?:test_[^/]*\.py|[^/]*_test\.(?:go|py|rb|lua)|[^/]*(?:Tests?|Spec)\.(?:cs|kt|java|scala|swift)|[^/]*\.(?:test|spec)\.ts|[^/]*_spec\.rb|tests?\.rs|[^/]*_tests?\.rs)$`,
].join('|'))

export const isLibrarySource = (path, grammar) => EXTENSIONS[grammar].test(path) && !NOT_LIBRARY.test(path)

const FUNCTIONS = {
  python: ['function_definition'],
  typescript: ['method_definition', 'function_declaration', 'generator_function_declaration', 'function_expression', 'arrow_function'],
  rust: ['function_item'],
  go: ['function_declaration', 'method_declaration'],
  java: ['method_declaration', 'constructor_declaration'],
  kotlin: ['function_declaration', 'property_declaration', 'secondary_constructor'],
  scala: ['function_definition', 'function_declaration', 'val_definition', 'var_definition'],
  csharp: ['method_declaration', 'constructor_declaration', 'local_function_statement', 'property_declaration', 'accessor_declaration', 'indexer_declaration', 'operator_declaration'],
  cpp: ['function_definition'],
  swift: ['function_declaration', 'init_declaration', 'property_declaration', 'subscript_declaration'],
  ruby: ['method', 'singleton_method'],
  lua: ['function_definition_statement', 'local_function_definition_statement'],
}

/** Declarations that own functions, named so a method can be told from a same-named one elsewhere. */
const OWNERS = {
  python: ['class_definition'],
  typescript: ['class_declaration', 'abstract_class_declaration', 'interface_declaration', 'class'],
  rust: ['impl_item', 'trait_item'],
  go: [],
  java: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
  kotlin: ['class_declaration', 'object_declaration'],
  scala: ['class_definition', 'object_definition', 'trait_definition'],
  csharp: ['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration', 'record_struct_declaration'],
  cpp: ['class_specifier', 'struct_specifier', 'namespace_definition'],
  swift: ['class_declaration', 'protocol_declaration'],
  ruby: ['class', 'module'],
  lua: [],
}

const STRINGS = {
  python: ['string'], typescript: ['string', 'template_string'], rust: ['string_literal', 'raw_string_literal'],
  go: ['interpreted_string_literal', 'raw_string_literal'], java: ['string_literal'], kotlin: ['string_literal'],
  scala: ['string'], csharp: ['string_literal', 'verbatim_string_literal', 'raw_string_literal'], cpp: ['string_literal', 'raw_string_literal'],
  swift: ['line_string_literal', 'multi_line_string_literal', 'raw_string_literal'], ruby: ['string'], lua: ['string'],
}

const CALLS = {
  python: ['call'], typescript: ['call_expression'], rust: ['call_expression', 'macro_invocation'], go: ['call_expression'],
  java: ['method_invocation', 'object_creation_expression'], kotlin: ['call_expression'], scala: ['call_expression'],
  csharp: ['invocation_expression', 'object_creation_expression'], cpp: ['call_expression'], swift: ['call_expression'],
  ruby: ['call'], lua: ['call'],
}

/**
 * Nodes between a command literal and the statement that holds it. Climbing
 * through them reaches the whole argument list, array, tuple or table the
 * flags travel in, and stops at the statement.
 */
const WRAPPERS = new Set([
  'argument_list', 'arguments', 'argument', 'value_arguments', 'value_argument', 'call_suffix', 'keyword_argument',
  'array', 'list', 'tuple', 'initializer_list', 'collection_expression', 'array_literal', 'array_creation_expression',
  'implicit_array_creation_expression', 'tuple_expression', 'bracketed_argument_list', 'element_binding_expression',
  'object', 'pair', 'literal_value', 'literal_element', 'keyed_element', 'composite_literal', 'table', 'table_constructor',
  'field', 'field_list', 'expression_list', 'parenthesized_expression', 'array_initializer', 'object_creation_expression',
  'implicit_object_creation_expression', 'initializer_expression', 'new_expression', 'collection_literal', 'dictionary_literal',
  'element_access_expression', 'subscript_expression', 'type_arguments', 'as_expression', 'satisfies_expression',
  'method_invocation', 'invocation_expression', 'call_expression', 'call', 'macro_invocation', 'token_tree',
  'reference_expression', 'borrow_expression', 'unary_expression', 'prefix_expression', 'generic_function', 'field_expression',
  'member_access_expression', 'navigation_expression', 'navigation_suffix', 'selector_expression', 'member_expression',
  'attribute', 'binary_expression', 'string_concatenation', 'interpolated_string_expression',
])

/** A node that starts a new function-like scope; strings inside it do not describe the call around it. */
const isScope = (grammar, node) => FUNCTIONS[grammar].includes(node.type) || /lambda|closure|function_expression|arrow_function|func_literal|anonymous_function|block$/.test(node.type)

/**
 * A branch compiled only for Windows runs against psmux, not tmux. The C++
 * port keeps the two behind `_WIN32`, and the tmux path is the other branch.
 */
function onWindowsOnlyPath(node) {
  for (let child = node, cursor = node.parent; cursor; child = cursor, cursor = cursor.parent) {
    if (cursor.type !== 'preproc_if' && cursor.type !== 'preproc_ifdef') continue
    const condition = cursor.childForFieldName('condition')?.text ?? cursor.childForFieldName('name')?.text ?? ''
    if (!/_WIN32/.test(condition)) continue
    const alternative = cursor.childForFieldName('alternative')
    const inAlternative = alternative && child.id === alternative.id
    const windowsFirst = !/!\s*defined|ifndef/.test(`${cursor.type === 'preproc_ifdef' ? cursor.text.slice(0, 8) : ''}${condition}`)
    if (windowsFirst !== Boolean(inAlternative)) return true
  }
  return false
}

const QUOTE = /^[A-Za-z@$#]*("""|'''|"|'|`|\[=*\[)([\s\S]*?)(?:"""|'''|"|'|`|\]=*\])$/

/** The text between a string literal's quotes, or nothing when the node is not quoted text. */
export function stringValue(node) {
  return QUOTE.exec(node.text)?.[2]
}

const FLAG = /^-[A-Za-z]+$/

/** Letters of every flag a string spells: `-a`, `-st`, or the flags inside `list-panes -a -F x`. */
function flagsIn(value) {
  const letters = new Set()
  for (const token of value.split(/\s+/)) if (FLAG.test(token)) for (const letter of token.slice(1)) letters.add(letter)
  return letters
}

function lastIdentifier(text) {
  const match = /([A-Za-z_][\w-]*)\s*(?:<[^()]*>)?\s*[!?]?$/.exec(text.replace(/\([\s\S]*$/, ''))
  return match?.[1]
}

/** Names the node declares, with the owner chain that qualifies it. */
function declaredName(grammar, node) {
  const field = node.childForFieldName('name')
  if (field && grammar === 'lua') {
    const parts = field.text.split(/[.:]/)
    return { name: parts.at(-1), owner: parts.length > 1 ? parts.at(-2) : undefined }
  }
  if (field) return { name: lastIdentifier(field.text) ?? field.text }
  const named = (type) => node.namedChildren.find((child) => child.type === type)
  if (grammar === 'cpp') {
    let declarator = node.childForFieldName('declarator')
    while (declarator && declarator.type !== 'qualified_identifier' && declarator.type !== 'identifier' && declarator.type !== 'field_identifier') {
      declarator = declarator.childForFieldName('declarator') ?? declarator.namedChildren[0]
    }
    if (!declarator) return undefined
    const parts = declarator.text.split('::')
    return { name: parts.at(-1), owner: parts.at(-2), scope: parts.slice(0, -2) }
  }
  if (grammar === 'kotlin' || grammar === 'swift') {
    const direct = named('simple_identifier')
    if (direct) return { name: direct.text }
    const pattern = named('variable_declaration') ?? named('pattern')
    const inner = pattern?.namedChildren.find((child) => child.type === 'simple_identifier')
    return inner ? { name: inner.text } : undefined
  }
  if (grammar === 'scala') {
    const direct = named('identifier')
    if (direct) return { name: direct.text }
    const pattern = node.childForFieldName('pattern')
    return pattern ? { name: pattern.text } : undefined
  }
  if (grammar === 'lua') {
    const path = named('variable') ?? named('identifier')
    if (!path) return undefined
    const parts = path.text.split(/[.:]/)
    return { name: parts.at(-1), owner: parts.length > 1 ? parts.at(-2) : undefined }
  }
  if (grammar === 'go') return undefined
  if (grammar === 'typescript' && node.type === 'arrow_function') {
    const holder = node.parent
    const label = holder?.childForFieldName('name')
    return label ? { name: label.text } : undefined
  }
  return undefined
}

/** What a call invokes: the last identifier of its callee, which is all a one-hop follow needs. */
function calleeOf(grammar, node) {
  if (node.type === 'object_creation_expression') return node.childForFieldName('type')?.text
  const callee = node.childForFieldName('function') ?? node.childForFieldName('name') ?? node.childForFieldName('method')
    ?? node.namedChildren[0]
  if (!callee) return undefined
  if (grammar === 'java' && node.type === 'method_invocation') return node.childForFieldName('name')?.text
  if (grammar === 'ruby') return node.childForFieldName('method')?.text
  return lastIdentifier(callee.text)
}

const ownerName = (grammar, node) => {
  if (grammar === 'rust' && node.type === 'impl_item') return lastIdentifier(node.childForFieldName('type')?.text ?? '')
  const name = node.childForFieldName('name') ?? node.namedChildren.find((child) => /identifier/.test(child.type))
  return name ? lastIdentifier(name.text) : undefined
}

const row = (node) => node.startPosition.row + 1

/**
 * Julia has no grammar here, so a function is found by its text: a `function`
 * line, and the `end` that closes it at the same indentation. A docstring
 * directly above belongs to it. Sends in Julia are reviewed claims, so only
 * the extents are needed.
 */
function scanJulia(text) {
  const lines = text.split('\n')
  const functions = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)function\s+(?:[A-Za-z_]\w*\.)*([A-Za-z_][\w!]*)\s*(?:\{[^}]*\})?\s*\(/.exec(lines[index])
    if (!match) continue
    const closer = new RegExp(`^${match[1]}end\\b`)
    let end = index
    for (let next = index + 1; next < lines.length; next++) if (closer.test(lines[next])) { end = next; break }
    let start = index
    if (lines[index - 1]?.trim() === '"""') {
      let opener = index - 2
      while (opener >= 0 && lines[opener].trim() !== '"""') opener--
      if (opener >= 0) start = opener
    }
    functions.push({ name: match[2], start: start + 1, nameLine: index + 1, end: end + 1, kind: 'function', sites: [], calls: new Map() })
  }
  return { functions, types: [], orphans: [] }
}

/** A default value or type literal in a signature is not a call. */
const PARAMETERS = /^(?:parameters?|formal_parameters?|parameter_list|function_value_parameters|class_parameters?|default_parameter|typed_default_parameter|optional_parameter|required_parameter|type_annotation|type_alias_declaration|type_arguments|type)$/
function inSignature(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (PARAMETERS.test(cursor.type)) return true
    if (/(?:^|_)(?:block|body|statement_block|compound_statement|declaration_list)$/.test(cursor.type)) return false
  }
  return false
}

/**
 * Every named function of a file with the command sites and calls inside it.
 *
 * @param {{ grammar: string, text: string, commands: ReadonlySet<string>, known: ReadonlySet<string> }} input
 *   `commands` are the names to find; `known` are all tmux command names, so
 *   a list that holds a different command is not read as this command's flags.
 * @returns {Promise<{ functions: ScannedFunction[], types: { name?: string, start: number, end: number }[], orphans: Site[] }>}
 *   `types` are the declarations that own functions, so a claim can anchor to
 *   a class; `orphans` are the sites outside any named function.
 */
export async function scanSource({ grammar, text, commands, known }) {
  if (grammar === 'julia') return scanJulia(text)
  const parser = await parserFor(grammar)
  // The Swift grammar predates typed throws; blanking the type keeps every line and column.
  const tree = parser.parse(grammar === 'swift' ? text.replace(/\bthrows[ \t]*\([ \t]*[\w.]+[ \t]*\)/g, (match) => 'throws'.padEnd(match.length)) : text)
  const functions = []
  const types = []
  const orphans = []
  const stack = []
  const owners = []
  const namespaces = []
  const FN = new Set(FUNCTIONS[grammar])
  const OWN = new Set(OWNERS[grammar])
  const STR = new Set(STRINGS[grammar])
  const CALL = new Set(CALLS[grammar])
  const isCommandLiteral = (node) => {
    if (!STR.has(node.type) || node.parent?.type === 'expression_statement') return undefined
    const value = stringValue(node)
    if (value === undefined) return undefined
    // A whole command line starts with the name and goes on with flags; a sentence that starts with one is an error message.
    const [head, next] = value.split(/\s+/)
    return known.has(head) && (next === undefined || next.startsWith('-')) ? { command: head, value } : undefined
  }

  /** The widest enclosing group that holds no other command, and the flags written inside it. */
  const flagsAround = (literal, command) => {
    let unit = literal
    for (let cursor = literal.parent; cursor && WRAPPERS.has(cursor.type); cursor = cursor.parent) {
      const others = cursor.descendantsOfType(STRINGS[grammar]).some((other) => {
        const found = isCommandLiteral(other)
        return found && found.command !== command
      })
      if (others) break
      unit = cursor
    }
    const flags = new Set()
    const visit = (node) => {
      if (STR.has(node.type)) {
        const value = stringValue(node)
        if (value !== undefined) for (const letter of flagsIn(value)) flags.add(letter)
        return
      }
      for (const child of node.namedChildren) if (node === unit || !isScope(grammar, child)) visit(child)
    }
    visit(unit)
    return { flags, unit }
  }

  const walk = (node) => {
    let pushed = false
    let owned = false
    let namespaced = false
    if (OWN.has(node.type)) {
      const name = ownerName(grammar, node)
      if (node.type === 'namespace_definition') {
        namespaces.push(name)
        namespaced = true
      } else {
        owners.push(name)
        owned = true
        types.push({ name, start: row(node), end: node.endPosition.row + 1 })
      }
    }
    if (grammar === 'go' && node.type === 'method_declaration') {
      const receiver = node.childForFieldName('receiver')?.text
      const name = node.childForFieldName('name')?.text
      const type = receiver && /([A-Za-z_]\w*)\s*\)?$/.exec(receiver.replace(/\[.*\]/, ''))?.[1]
      if (name) { pushFunction(name, type); pushed = true }
    } else if (grammar === 'go' && node.type === 'function_declaration') {
      pushFunction(node.childForFieldName('name').text, undefined)
      pushed = true
    } else if (FN.has(node.type)) {
      const declared = declaredName(grammar, node)
      if (declared?.name) { pushFunction(declared.name, declared.owner, declared.scope); pushed = true }
    }

    function pushFunction(name, owner, scope = []) {
      const wrapper = node.parent && ['decorated_definition', 'export_statement'].includes(node.parent.type) ? node.parent : node
      const fn = {
        name, owner: owner ?? owners.filter(Boolean).at(-1), start: row(wrapper), nameLine: row(node.childForFieldName('name') ?? node),
        end: node.endPosition.row + 1, kind: node.type, sites: [], calls: new Map(),
        // A namespace opened by a macro is invisible here, so an empty chain is unknown, not global.
        ...([...namespaces.filter(Boolean), ...scope].length ? { namespace: [...namespaces.filter(Boolean), ...scope].join('::') } : {}),
      }
      functions.push(fn)
      stack.push(fn)
    }

    const literal = commands.size && isCommandLiteral(node)
    if (literal && commands.has(literal.command) && !inSignature(node) && !onWindowsOnlyPath(node)) {
      const { flags } = flagsAround(node, literal.command)
      const site = { command: literal.command, line: row(node), flags: [...flags].sort().join('') }
      ;(stack.at(-1)?.sites ?? orphans).push(site)
    }
    if (CALL.has(node.type) && stack.length) {
      const callee = calleeOf(grammar, node)
      if (callee && !stack.at(-1).calls.has(callee)) stack.at(-1).calls.set(callee, row(node))
    }
    for (const child of node.namedChildren) walk(child)
    if (pushed) stack.pop()
    if (owned) owners.pop()
    if (namespaced) namespaces.pop()
  }
  walk(tree.rootNode)
  tree.delete()
  return { functions, types, orphans }
}

/**
 * @typedef {{ name: string, owner?: string, start: number, nameLine: number, end: number, kind: string, sites: Site[], calls: Map<string, number>, namespace?: string }} ScannedFunction
 * @typedef {{ command: string, line: number, flags: string }} Site
 */
