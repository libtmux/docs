/**
 * Find where a library's source sends a tmux command.
 *
 * A send site is a string literal that spells a command name, in code rather
 * than in a comment or a docstring. The scan attributes each site to the
 * innermost named function around it and keeps the flag literals that travel
 * with the command, because the flags choose the scope tmux lists.
 */
import { parserFor } from '../../packages/api-model/src/parser.ts'
import { receiverOf, scanFSharp, scanJulia } from './tmux-usage-lexical.mjs'

/** Port to the tree-sitter grammar that reads its source. PowerShell cmdlets are C#. */
export const GRAMMARS = {
  py: 'python', ts: 'typescript', rs: 'rust', go: 'go', java: 'java', kotlin: 'kotlin', scala: 'scala',
  csharp: 'csharp', powershell: 'csharp', cxx: 'cpp', swift: 'swift', ruby: 'ruby', lua: 'lua', julia: 'julia', fsharp: 'fsharp',
}

/** Source extensions per grammar, minus declaration-only files. */
export const EXTENSIONS = {
  python: /\.py$/, typescript: /(?<!\.d)\.ts$/, rust: /\.rs$/, go: /\.go$/, java: /\.java$/, kotlin: /\.kt$/,
  scala: /\.scala$/, csharp: /\.cs$/, cpp: /\.(?:cpp|cc|cxx|hpp|hh|h)$/, swift: /\.swift$/, ruby: /\.rb$/, lua: /\.lua$/, julia: /\.jl$/, fsharp: /\.fs$/,
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

/** Declarations that are functions at the top of a type and only local variables inside a function: `let reply = ...` is not a method named reply. */
const LOCAL_BINDINGS = new Set(['property_declaration', 'val_definition', 'var_definition'])

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
  'array', 'array_expression', 'list', 'tuple', 'initializer_list', 'collection_expression', 'array_literal', 'array_creation_expression',
  'implicit_array_creation_expression', 'tuple_expression', 'bracketed_argument_list', 'element_binding_expression',
  'object', 'pair', 'literal_value', 'literal_element', 'keyed_element', 'composite_literal', 'table', 'table_constructor',
  'field', 'field_list', 'expression_list', 'parenthesized_expression', 'array_initializer', 'object_creation_expression',
  'implicit_object_creation_expression', 'initializer_expression', 'new_expression', 'collection_literal', 'dictionary_literal',
  'element_access_expression', 'subscript_expression', 'type_arguments', 'as_expression', 'satisfies_expression',
  'method_invocation', 'invocation_expression', 'call_expression', 'call', 'macro_invocation', 'token_tree',
  'reference_expression', 'borrow_expression', 'unary_expression', 'prefix_expression', 'generic_function', 'field_expression',
  'member_access_expression', 'navigation_expression', 'navigation_suffix', 'selector_expression', 'member_expression',
  'attribute', 'binary_expression', 'string_concatenation', 'interpolated_string_expression',
  'spread_element', 'splat_argument', 'list_splat', 'hash_splat_argument', 'spread_expression', 'range_expression', 'compound_literal_expression',
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

/** What a call invokes, and on what: the last identifier of its callee, which is all a one-hop follow needs. */
function calleeOf(grammar, node) {
  if (node.type === 'object_creation_expression') return { name: node.childForFieldName('type')?.text }
  const callee = node.childForFieldName('function') ?? node.childForFieldName('name') ?? node.childForFieldName('method')
    ?? node.namedChildren[0]
  if (!callee) return undefined
  if (grammar === 'java' && node.type === 'method_invocation') {
    const object = node.childForFieldName('object')?.text
    return { name: node.childForFieldName('name')?.text, receiver: object && receiverOf(`${object}.x`) }
  }
  if (grammar === 'ruby') {
    const receiver = node.childForFieldName('receiver')?.text
    const method = node.childForFieldName('method')?.text
    // `server.__send__(:execute_typed, [...])` calls execute_typed: the symbol names what is called.
    const symbol = ['__send__', 'send', 'public_send'].includes(method) ? node.childForFieldName('arguments')?.namedChildren[0] : undefined
    const sent = symbol && /symbol/.test(symbol.type) ? symbol.text.replace(/^:/, '') : undefined
    return { name: sent ?? method, receiver: receiver && receiverOf(`${receiver}.x`) }
  }
  // The callee of a chain, `Command::new("x").arg("-a").arg`, ends with the method that is called: the first parenthesis
  // it holds belongs to an earlier call of the chain.
  return { name: lastName(callee.text), receiver: receiverOf(callee.text) }
}

/** The last identifier of a callee's text, which is the name that is called. */
function lastName(text) {
  return /([A-Za-z_][\w-]*)\s*(?:<[^()]*>)?\s*[!?]?$/.exec(text)?.[1]
}

const ownerName = (grammar, node) => {
  if (grammar === 'rust' && node.type === 'impl_item') return lastIdentifier(node.childForFieldName('type')?.text ?? '')
  const name = node.childForFieldName('name') ?? node.namedChildren.find((child) => /identifier/.test(child.type))
  return name ? lastIdentifier(name.text) : undefined
}

const row = (node) => node.startPosition.row + 1

/** Note a call once per name, at its first line, and remember every object it was made on. */
function recordCall(fn, name, receiver, line) {
  if (!fn.calls.has(name)) fn.calls.set(name, line)
  if (receiver) fn.receivers.set(name, new Set([...(fn.receivers.get(name) ?? []), receiver]))
}

/**
 * A call that checks a command rather than runs it names it as a label: `validateArgument("select-layout", ...)`
 * says whose argument it is in the error it may raise, `newCommandError("new-session", result)` names the
 * command a failure belongs to, `ThrowIfFailed(result, "new-session")` says which command failed, `server.failed("show-environment", result)`
 * builds the error to throw for it, `map_err(decode_error("new-window"))` names the command a decode error belongs to, and
 * `preflight(ctx, "set-option", name)` checks a command before it is built. The verb ends at a word boundary,
 * so `checkedRun` is a runner and `checkArguments` is not.
 */
const CHECKING = /^(?:[Vv]alidate|[Vv]erify|[Ee]nsure|[Rr]eject|[Rr]equire|[Cc]heck|[Ii]nvalid|[Uu]nsupported|[Tt]hrow|[Pp]reflight|[Ff]ail(?:ed)?)(?![a-z])|(?:[Ee]rror|[Ff]ailure|[Ee]xception|refused_result)$/

/** Whether the nearest call around a literal only checks something about the command it names. */
function namedForChecking(grammar, node, CALL) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (!CALL.has(cursor.type)) continue
    return CHECKING.test(calleeOf(grammar, cursor)?.name ?? '')
  }
  return false
}

/**
 * Commands whose arguments are commands for tmux to run later, in the shell or in its own parser. A command named
 * in their argument list is run by tmux when the outer command runs, and the library sends only the outer one:
 * `["if-shell", "-F", cond, quoteCommand(["resize-pane", "-Z"])]` sends if-shell.
 */
const RUNS_COMMANDS = new Set(['if-shell', 'run-shell', 'set-hook', 'bind-key', 'command-prompt', 'confirm-before', 'display-menu', 'choose-tree', 'choose-buffer', 'choose-client', 'pipe-pane'])
/** Nodes that only wrap one element of an argument list or array. */
const ELEMENTS = /^(?:argument|value_argument|literal_element|element|array_element|keyed_element|pair)$/

/** Whether a literal is a later argument of a group that opens with a command that runs commands. */
function nestedInCommand(node, STR, commandOf) {
  for (let child = node, cursor = node.parent; cursor && WRAPPERS.has(cursor.type); child = cursor, cursor = cursor.parent) {
    const first = cursor.descendantsOfType([...STR]).find((literal) => {
      let at = literal.parent
      while (at && at.id !== cursor.id && ELEMENTS.test(at.type)) at = at.parent
      return at?.id === cursor.id
    })
    if (!first || first.id === node.id || child.startIndex <= first.startIndex) continue
    const outer = commandOf(first)
    if (outer && RUNS_COMMANDS.has(outer.command)) return true
  }
  return false
}

/** The part of a `case`, `when` or `match` arm that is tested against, as opposed to the part that runs. */
const LABELS = /^(?:switch_label|case_switch_label|case_pattern_switch_label|constant_pattern|match_pattern|when_condition|switch_pattern|case_pattern|case_label)$/
/** Arms whose tested part is a named field: the node under that field is the label. */
const ARMS = { switch_case: ['value'], expression_case: ['value'], case_statement: ['value'], when: ['pattern'], in_clause: ['pattern'], case_clause: ['pattern', 'value'], switch_expression_arm: ['pattern'] }
const COMPARISONS = /^(?:binary_expression|comparison_operator|binary_operator|equality_expression|infix_expression)$/

/**
 * A command name that is compared against, or named by a `case`, is a name being recognised, not a command being
 * run: `case "list-sessions" -> format` picks a format by the command about to run.
 */
function isComparand(node) {
  for (let child = node, cursor = node.parent; cursor; child = cursor, cursor = cursor.parent) {
    if (LABELS.test(cursor.type)) return true
    for (const field of ARMS[cursor.type] ?? []) {
      if (cursor.childForFieldName(field)?.id === child.id) return true
    }
    if (COMPARISONS.test(cursor.type)) {
      const operator = cursor.childForFieldName('operator')?.text ?? cursor.children.find((part) => !part.isNamed)?.text
      return ['==', '!=', '===', '!==', 'is', 'is not'].includes(operator ?? '')
    }
    if (/(?:^|_)(?:block|body|statement_block|compound_statement|declaration_list)$/.test(cursor.type) || cursor.type.endsWith('_statement')) return false
  }
  return false
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

/** Expressions that choose between operands: a literal under one is one of several, and only one is sent. */
const CONDITIONALS = /^(?:ternary_expression|conditional_expression|conditional|if_expression|if_statement_expression|match_expression|switch_expression|switch_expression_arm|elvis_expression|null_coalescing_expression|coalesce_expression)$/
/** The arm of a `match`, `switch` or `when` that gives a value: the literal under it is the value that arm chooses. */
const VALUE_ARMS = /^(?:match_arm|switch_expression_arm|switch_case|switch_section|case_clause|expression_case|when_entry|when_clause|in_clause)$/
const SHORT_CIRCUIT = new Set(['and', 'or', '||', '&&', '??', '?:'])

/** Identifier-like nodes, whose text names a variable. */
const NAMES = /(?:^|_)identifier$|^name$|^variable_name$|^constant$/

const LAMBDAS = /^(?:lambda|lambda_literal|lambda_expression|closure_expression|arrow_function|anonymous_function|function_expression|func_literal|anonymous_function_expression)$/

/** Whether a closure is its one expression, with no statements around it. */
function oneExpression(lambda) {
  const body = lambda.childForFieldName('body') ?? lambda.namedChildren.find((part) => /statements|block|body/.test(part.type))
  if (!body) return true
  if (/^(?:block|statement_block|compound_statement)$/.test(body.type)) return false
  const inner = body.type === 'statements' ? body.namedChildren : [body]
  return inner.length === 1 && !/_statement$|^return|^throw/.test(inner[0].type)
}

/**
 * What a command literal is part of, read from the nodes around it: the calls it is an argument of from the
 * innermost out, the statement it ends in, whether a condition chooses it, and the variables the statement
 * binds it to. `dispatchOf` decides from these whether it is sent.
 */
function contextOf(grammar, node, CALL) {
  const calls = []
  // How many calls were behind the literal when a condition was crossed: a condition inside a call's arguments chooses what the
  // call is given, and one above the call chooses whether it is made.
  let conditional
  let chooser
  let top = node
  let cursor = node.parent
  for (; cursor; cursor = cursor.parent) {
    // A closure of one expression hands that expression's value to the call it is an argument of.
    if ((LAMBDAS.test(cursor.type) && oneExpression(cursor)) || (cursor.type === 'statements' && cursor.parent && LAMBDAS.test(cursor.parent.type) && oneExpression(cursor.parent))) { top = cursor; continue }
    const operator = cursor.type === 'binary_expression' ? (cursor.childForFieldName('operator')?.text ?? cursor.children.find((part) => !part.isNamed)?.text) : undefined
    if (CONDITIONALS.test(cursor.type) || VALUE_ARMS.test(cursor.type) || (operator !== undefined && SHORT_CIRCUIT.has(operator))) {
      conditional ??= calls.length
      chooser = cursor
    } else if (!WRAPPERS.has(cursor.type)) break
    if (CALL.has(cursor.type)) {
      const callee = calleeOf(grammar, cursor)
      // A literal in the receiver of a call, `Command::new("x").arg("-a")`, passes through it; one in its arguments is handed to it.
      const args = cursor.childForFieldName('arguments') ?? cursor.namedChildren.find((part) => /argument/.test(part.type))
      if (callee?.name) calls.push({ name: callee.name, receiver: callee.receiver, node: cursor, line: calleeRow(cursor), argument: !args || holds(args, node) })
    }
    top = cursor
  }
  return { calls, conditional, chooser, top, boundary: cursor ?? top }
}

/** The line a call is made on: where its callee ends, which for `sender\n    .send(...)` is the `.send` and not `sender`. */
function calleeRow(call) {
  const callee = call.childForFieldName('function') ?? call.childForFieldName('name') ?? call.childForFieldName('method') ?? call.namedChildren[0]
  return callee ? callee.endPosition.row + 1 : row(call)
}

/**
 * The identifiers of the object a method call is made on that a later call can take it by: `argv` in `argv.add("x")`, and both
 * `request` and `group` in `request.group.push_back(x)`, because the request is what is passed on and the group is what is added to.
 */
function receiverNames(grammar, call) {
  const object = grammar === 'java' ? call.childForFieldName('object') : grammar === 'ruby' ? call.childForFieldName('receiver') : (call.childForFieldName('function') ?? call.namedChildren[0])
  const text = object?.text
  if (!text) return []
  const base = grammar === 'java' || grammar === 'ruby' ? text : text.replace(/[.:]+[A-Za-z_]\w*$/, '').replace(/->[A-Za-z_]\w*$/, '')
  const plain = base.replace(/\([^()]*\)|\[[^\]]*\]/g, '')
  const last = /([A-Za-z_]\w*)\W*$/.exec(plain)?.[1]
  const root = /^\W*([A-Za-z_]\w*)/.exec(plain)?.[1]
  return [...new Set([last, root])].filter((name) => name && !SELF.has(name))
}

/**
 * Calls a command passes through on its way to a dispatch call: they put an element in a collection or make one. A call that
 * is handed the command and builds from it must be a declared builder, because `get_output_format("list-sessions", v)` is handed
 * the name of a command too and builds a format.
 */
const PASSING = new Set(['add', 'Add', 'push', 'push_back', 'emplace_back', 'append', 'insert', 'extend', 'arg', 'args', 'apply', 'then', 'concat', 'tinsert',
  'new', 'of', 'List', 'Seq', 'Array', 'Vec', 'asList', 'listOf', 'mutableListOf', 'arrayOf', 'ArrayList', 'LinkedList', 'vec', 'copyOf', 'make', 'string', 'str', 'String', 'Some', 'Ok', 'static_cast', 'move', 'forward', 'unique_ptr', 'make_unique'])

/** The call that is handed a command and is neither a way to put it in a collection nor a declared builder. */
function blockedBy(calls, builders) {
  return calls.find((call) => call.argument && !PASSING.has(call.name.replace(/<.*$/s, '')) && !builders.has(call.name))
}

/** Receivers that are the object a method is called on, not a variable that holds something else. */
const SELF = new Set(['self', 'this', 'Self', 'cls', 'me', 'base', 'super'])
/** Calls that add an element to the collection they are called on, or return it with one more: they build a command value. */
const ADDS = new Set(['add', 'Add', 'push', 'push_back', 'emplace_back', 'append', 'insert', 'extend', 'arg', 'args', 'apply', 'then', 'concat', 'tinsert'])
/** Statements that run their body only on some paths. A `try` and a `finally` run on every path. */
const BRANCHING = /(?:^|_)(?:if|elif|elsif|else|unless|switch|case|when|match|guard|conditional|ternary|for|while|until|loop|catch|except|rescue)(?:_|$)/

/** How many branches deep a node is inside its function, so a send on the main path can be told from one on a side path. */
function nesting(grammar, node) {
  let depth = 0
  for (let cursor = node.parent; cursor && !FUNCTIONS[grammar].includes(cursor.type); cursor = cursor.parent) if (BRANCHING.test(cursor.type)) depth++
  return depth
}

/** Nodes that end a statement: a binding's names are looked for up to the first of them. */
const STATEMENT = /(?:_statement|_declaration|_definition|_item|_spec|^statement|^assignment|^declaration)$/

/** The identifier texts at the leaves of a node. */
function leafNames(node, found = []) {
  if (NAMES.test(node.type) && node.namedChildCount === 0) found.push(node.text)
  else for (const child of node.namedChildren) leafNames(child, found)
  return found
}

const RETURNING = /^\s*(?:return|yield)\b/
const holds = (outer, inner) => outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex

/**
 * The variables a statement binds a command value to: the names on the left of a declaration or assignment that
 * has the literal on its right, or the object a method that adds to a collection is called on (`argv.add("x")`).
 */
function bindingNames(grammar, literal, context) {
  const names = new Set()
  const take = (node) => { for (const name of leafNames(node)) if (!SELF.has(name)) names.add(name) }
  for (let cursor = context.boundary; cursor; cursor = cursor.parent) {
    for (const field of ['left', 'pattern', 'name', 'declarator']) {
      const part = cursor.childForFieldName(field)
      if (part && !holds(part, literal)) take(part)
    }
    if (STATEMENT.test(cursor.type)) break
  }
  // Grammars that name no field: what is declared or assigned is the first thing in the declaration.
  if (!names.size) {
    for (let cursor = context.boundary; cursor; cursor = cursor.parent) {
      if (/declarator|assignment|declaration|definition|binding|pattern/.test(cursor.type)) {
        const first = cursor.namedChildren.find((child) => !holds(child, literal) && (NAMES.test(child.type) || /pattern|variable/.test(child.type)))
        if (first) { take(first); break }
      }
      if (STATEMENT.test(cursor.type)) break
    }
  }
  // Whether the names are the ones a declaration or an assignment gives the value, and not the collection it is added to.
  const assigned = names.size > 0
  const outer = context.calls.findLast((call) => ADDS.has(call.name))
  if (!names.size && outer) {
    for (const receiver of receiverNames(grammar, outer.node)) names.add(receiver)
  }
  return Object.assign([...names], { assigned })
}

/** The name an identifier node is read as in a call's arguments. */
function argumentNames(node) {
  const found = new Set()
  for (const name of leafNames(node)) found.add(name)
  return found
}

/**
 * Every named function of a file with the command sites and calls inside it.
 *
 * With `dispatch`, each site also says whether it is sent: `dispatch: { line, name }` when the literal is an
 * argument of a call to one of those names, or builds a command value that the same function later passes to
 * one; `dispatch: null`, with `why`, when it is a label, a comparison, a choice made by a condition or a value
 * that no call in the function sends.
 *
 * @param {{ grammar: string, text: string, commands: ReadonlySet<string>, known: ReadonlySet<string>, dispatch?: ReadonlySet<string>, builders?: ReadonlySet<string>, trace?: (site: object, context: object) => void }} input
 *   `commands` are the names to find; `known` are all tmux command names, so
 *   a list that holds a different command is not read as this command's flags.
 * @returns {Promise<{ functions: ScannedFunction[], types: { name?: string, start: number, end: number }[], orphans: Site[] }>}
 *   `types` are the declarations that own functions, so a claim can anchor to
 *   a class; `orphans` are the sites outside any named function.
 */
export async function scanSource({ grammar, text, commands, known, dispatch, builders = new Set(), trace }) {
  if (grammar === 'julia') return scanJulia(text, { commands, known, dispatch })
  if (grammar === 'fsharp') return scanFSharp(text)
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

  /** Whether a condition, crossed before the dispatch call, picks between different commands: `a ? ["detach-client"] : ["detach-client", "-E"]` does not. */
  const chooses = (context, at, own) => {
    if (context.conditional === undefined || (at >= 0 && context.conditional > at)) return false
    const named = new Set(context.chooser.descendantsOfType([...STR]).map((part) => isCommandLiteral(part)?.command).filter(Boolean))
    return own === undefined ? true : named.size > 1 || !named.has(own)
  }

  /** Decide whether a site is sent: now when a dispatcher encloses it, at the end of its function when it is bound. */
  const classify = (site, node, owner, literal) => {
    const context = contextOf(grammar, node, CALL)
    trace?.(site, context)
    const never = (why, builds = false) => { site.dispatch = null; site.why = why; if (builds) site.builds = true }
    const at = context.calls.findIndex((call) => dispatch.has(call.name))
    if (chooses(context, at, literal.command)) return never('a condition chooses it among other commands')
    const through = at < 0 ? context.calls : context.calls.slice(0, at)
    const blocked = blockedBy(through, builders)
    if (blocked) return never(`it is an argument of ${blocked.name}, which neither sends it nor builds a command from it`)
    if (at >= 0) { site.dispatch = { line: context.calls[at].line, name: context.calls[at].name }; return undefined }
    // A command put straight into a `return` or a `yield`, or the last expression of a body, is a value built for the caller.
    const body = context.boundary.parent
    const bodyLike = (part) => part && /body|block|statements|compound/.test(part.type)
    // A body whose last child is the expression itself, as Rust's `{ Command::new("x").arg("-a") }`, hands the value back too.
    const tail = (bodyLike(body) && body.namedChildren.at(-1)?.id === context.boundary.id)
      || (bodyLike(context.boundary) && FUNCTIONS[grammar].includes(body?.type) && context.boundary.namedChildren.at(-1)?.id === context.top.id)
    if (RETURNING.test(context.boundary.text) || tail) return never('it builds a value for the caller', true)
    const names = bindingNames(grammar, node, context)
    if (!names.length || !owner) return never('it reaches no call that sends')
    ;(owner.pending ??= []).push({ target: site, names, after: context.boundary.endIndex, command: literal.command })
    return undefined
  }

  /**
   * Decide whether the value of a call is sent: the call is an argument of a dispatch call, or its result is bound to a
   * variable that a later dispatch call takes. A helper that builds a command and returns it is sent by its caller this way.
   */
  const trackCall = (call, node, owner) => {
    const context = contextOf(grammar, node, CALL)
    const at = context.calls.findIndex((outer) => dispatch.has(outer.name))
    if (chooses(context, at)) return
    if (blockedBy(at < 0 ? context.calls : context.calls.slice(0, at), builders)) return
    if (at >= 0) { (owner.callsites ??= []).push({ ...call, flows: { line: context.calls[at].line, name: context.calls[at].name } }); return }
    const names = bindingNames(grammar, node, context)
    if (names.length) (owner.pending ??= []).push({ target: { ...call }, names, after: context.boundary.endIndex, call: true })
    // `attach, guard = guard_command(attach)` puts something else under the name: what comes out is not the list that went in.
    if (names.assigned && !PASSING.has(call.name.replace(/<.*$/s, '')) && !builders.has(call.name)) {
      (owner.rebinds ??= []).push({ name: call.name, start: node.startIndex, bound: new Set(names), taken: argumentNames(node) })
    }
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
      if (name) { pushFunction(name, type); pushed = true; stack.at(-1).selfName = /^\(\s*(\w+)\s/.exec(receiver ?? '')?.[1]?.toLowerCase() }
    } else if (grammar === 'go' && node.type === 'function_declaration') {
      pushFunction(node.childForFieldName('name').text, undefined)
      pushed = true
    } else if (FN.has(node.type) && !(stack.length && LOCAL_BINDINGS.has(node.type))) {
      const declared = declaredName(grammar, node)
      if (declared?.name) { pushFunction(declared.name, declared.owner, declared.scope); pushed = true }
    }

    function pushFunction(name, owner, scope = []) {
      const wrapper = node.parent && ['decorated_definition', 'export_statement'].includes(node.parent.type) ? node.parent : node
      const fn = {
        name, owner: owner ?? owners.filter(Boolean).at(-1), start: row(wrapper), nameLine: row(node.childForFieldName('name') ?? node),
        end: node.endPosition.row + 1, kind: node.type, sites: [], calls: new Map(), receivers: new Map(),
        // A namespace opened by a macro is invisible here, so an empty chain is unknown, not global.
        ...([...namespaces.filter(Boolean), ...scope].length ? { namespace: [...namespaces.filter(Boolean), ...scope].join('::') } : {}),
      }
      functions.push(fn)
      stack.push(fn)
    }

    const literal = commands.size && isCommandLiteral(node)
    if (literal && commands.has(literal.command) && !inSignature(node) && !onWindowsOnlyPath(node) && !namedForChecking(grammar, node, CALL) && !isComparand(node)
      && !nestedInCommand(node, STR, isCommandLiteral)) {
      const { flags } = flagsAround(node, literal.command)
      const site = { command: literal.command, line: row(node), flags: [...flags].sort().join('') }
      const owner = stack.at(-1)
      if (dispatch) { site.depth = nesting(grammar, node); classify(site, node, owner, literal) }
      ;(owner?.sites ?? orphans).push(site)
    }
    if (CALL.has(node.type) && stack.length) {
      const callee = calleeOf(grammar, node)
      if (callee?.name) {
        recordCall(stack.at(-1), callee.name, callee.receiver, row(node))
        if (dispatch?.has(callee.name)) {
          const commands = new Set(node.descendantsOfType([...STR]).map((part) => isCommandLiteral(part)?.command).filter(Boolean))
          ;(stack.at(-1).sends ??= []).push({ name: callee.name, line: calleeRow(node), start: node.startIndex, end: node.endIndex, names: argumentNames(node), commands })
        } else if (dispatch) {
          trackCall({ name: callee.name, receiver: callee.receiver, line: calleeRow(node) }, node, stack.at(-1))
          // `batch.add(std::move(literal))` hands the value to `batch`, so a call that takes `batch` takes it too.
          if (ADDS.has(callee.name)) {
            for (const target of receiverNames(grammar, node)) (stack.at(-1).adds ??= []).push({ target, start: node.startIndex, names: argumentNames(node) })
          }
        }
      }
    }
    if (dispatch && stack.length && /return|yield|jump|control_transfer/.test(node.type) && RETURNING.test(node.text)) (stack.at(-1).returns ??= []).push(argumentNames(node))
    for (const child of node.namedChildren) walk(child)
    if (pushed) {
      const done = stack.pop()
      // The last statement of a body is its value in a language that returns the last expression.
      const tail = node.childForFieldName('body')?.namedChildren.at(-1)
      const returned = [...(done.returns ?? []), ...(tail ? [argumentNames(tail)] : [])]
      // A command value a function builds is sent by the first later call that takes it and names no other command.
      for (const { target, names: bound, after, command, call: isCall } of done.pending ?? []) {
        // The names a value goes by: the variables it is bound to, and the collections it is added to after that.
        const names = new Set(bound)
        for (let grown = true; grown;) {
          grown = false
          for (const added of done.adds ?? []) {
            if (added.start >= after && !names.has(added.target) && [...names].some((name) => added.names.has(name))) { names.add(added.target); grown = true }
          }
        }
        const takes = (candidate) => candidate.start >= after && [...names].some((name) => candidate.names.has(name))
          && (isCall ? candidate.commands.size === 0 : [...candidate.commands].every((other) => other === command))
        const outer = (done.sends ?? []).find(takes)
        // A dispatch call whose argument is a closure that makes the inner dispatch call is cited at the inner one, which is the call that sends.
        const sends = outer && (done.sends ?? []).filter((candidate) => takes(candidate) && candidate.start >= outer.start && candidate.end <= outer.end)
          .reduce((deepest, candidate) => (candidate.start > deepest.start ? candidate : deepest), outer)
        // A call between the literal and the send that takes the name and binds it again has changed what the name holds.
        const rebound = sends && (done.rebinds ?? []).find((change) => change.start >= after && change.start < sends.start
          && [...names].some((name) => change.bound.has(name) && change.taken.has(name)))
        if (rebound) {
          target.dispatch = null
          target.why = `its variable is rebound by ${rebound.name}, which neither sends it nor builds a command from it`
        } else if (isCall) {
          if (sends) (done.callsites ??= []).push({ ...target, flows: { line: sends.line, name: sends.name } })
        } else if (sends) target.dispatch = { line: sends.line, name: sends.name }
        else {
          target.dispatch = null
          target.why = 'it reaches no call that sends'
          // A command put in a variable that the function hands back is built for its caller.
          if (returned.some((used) => [...names].some((name) => used.has(name)))) { target.builds = true; target.why = 'it builds a value for the caller' }
        }
      }
      delete done.pending
      delete done.sends
      delete done.returns
      delete done.adds
      delete done.rebinds
    }
    if (owned) owners.pop()
    if (namespaced) namespaces.pop()
  }
  walk(tree.rootNode)
  tree.delete()
  return { functions, types, orphans }
}

/**
 * @typedef {{ name: string, owner?: string, start: number, nameLine: number, end: number, kind: string, sites: Site[], calls: Map<string, number>, receivers: Map<string, Set<string>>, namespace?: string }} ScannedFunction
 * @typedef {{ command: string, line: number, flags: string, dispatch?: { line: number, name: string } | null, why?: string, builds?: boolean, depth?: number }} Site
 */
