import { splitTop, stripGroups } from './api-html.mjs'

/**
 * What the site's own source says a link is for.
 *
 * A link is right when the page it reaches declares the same identity as the
 * name that led there: the same kind, owner or package, name, and, where the
 * name writes them, its operand count and parameter list. This module reads
 * the source side of that comparison. `api-identities.mjs` reads the page's.
 *
 * A name rarely states all of it. The tables below are what the estate's
 * ports mean by a name they write bare, and each is reviewed against the
 * language: what a port's code imports, what its language provides without an
 * import, what a name stands for when the language spells it another way. A
 * bare name whose owner no table gives is not guessed at; it is refused.
 */

/**
 * Names a language spells another way than the page that documents them: a
 * keyword for a library type, or a read-only view of one. The page is right
 * when it documents the target.
 */
export const TYPE_ALIASES = {
  csharp: { bool: 'Boolean', string: 'String', char: 'Char', int: 'Int32', long: 'Int64', double: 'Double', void: 'Void', object: 'Object', byte: 'Byte' },
  // F#'s keyword types abbreviate the BCL's, which are in `System` whatever a file opens.
  fsharp: { string: 'System.String', bool: 'System.Boolean', int: 'System.Int32', int64: 'System.Int64', seq: 'System.Collections.Generic.IEnumerable', None: 'option', Some: 'option' },
  // Scala's String is the alias `scala.Predef` declares, and its page is Predef's.
  scala: { String: 'Predef' },
  // MDN has no page for TypeScript's read-only views, its iterator interface or its primitive types; it
  // documents the runtime objects they view and wrap.
  ts: { ReadonlyMap: 'Map', ReadonlySet: 'Set', IterableIterator: 'Iterator', string: 'String', number: 'Number', boolean: 'Boolean', bigint: 'BigInt', symbol: 'Symbol' },
}

/**
 * Names written with a package other than the one whose page documents them.
 * cats-effect re-exports the types of its kernel package from `cats.effect`, so
 * both spellings reach the same page. A whole name is rewritten to the one the
 * address spells.
 */
const NAME_ALIASES = {
  scala: Object.fromEntries(['Async', 'Deferred', 'Outcome', 'Resource', 'Fiber', 'Ref'].map((type) => [`cats.effect.${type}`, `cats.effect.kernel.${type}`])),
}

/**
 * Go qualifies a name with a package's name, and several packages share one:
 * `template` is `text/template` and `html/template`. A name is therefore tied
 * to an import path, and a qualifier that is not already one is looked up here.
 * The SDK's examples import `mcp` as `sdk`.
 */
export const GO_PACKAGES = {
  mcp: 'github.com/modelcontextprotocol/go-sdk/mcp',
  sdk: 'github.com/modelcontextprotocol/go-sdk/mcp',
  // `template` alone is ambiguous between text/template and html/template, and this estate means the text one.
  template: 'text/template',
}

/**
 * Kinds a name does not give away. A port's code writes `Dispatchers` for a Kotlin
 * object, `Using` for a Scala object, `Seq` for an F# module and `std::chrono`
 * for a namespace, and the language's own page says which it is. A key without
 * a dot is the last segment of a name, however it is qualified; a key with dots
 * is one whole name. The rest are read from the name by `kindOf`.
 */
export const NAME_KINDS = {
  kotlin: { Dispatchers: 'object', NonCancellable: 'object', Unit: 'object' },
  // `String` in Scala is the alias `Predef` declares, and its page is Predef's.
  scala: { Using: 'object', String: 'object' },
  fsharp: { Seq: 'module', option: 'type', list: 'type' },
  cxx: { 'std.chrono': 'module', nullopt: 'member' },
  elixir: { 'Supervisor.child_spec': 'type' },
}

/**
 * The operand count of a generic type a name leaves out. C# and F# keep a type of
 * each count on its own page (`ILogger` and `ILogger<T>`), so a name that writes none is
 * the non-generic one, and one that stands for a generic type says how many here.
 */
export const ARITIES = {
  'csharp:IReadOnlyList': 1, 'csharp:IReadOnlyDictionary': 2, 'csharp:IEnumerable': 1, 'csharp:IEnumerator': 1,
  'csharp:IReadOnlyCollection': 1, 'csharp:IAsyncEnumerable': 1, 'csharp:IProgress': 1, 'csharp:Func': 1,
  'csharp:ReadOnlySpan': 1, 'csharp:ReadOnlyMemory': 1, 'csharp:Span': 1,
  'fsharp:IReadOnlyList': 1, 'fsharp:IAsyncEnumerable': 1, 'fsharp:Result': 2, 'fsharp:option': 1, 'fsharp:list': 1,
  'fsharp:seq': 1, 'fsharp:Seq': 0, 'fsharp:Task': 0,
  'powershell:System.Nullable': 1, 'csharp:System.Nullable': 1,
}

/** Owners a port's names have without an import: what the language provides, as page owners written with dots. */
export const DEFAULT_SCOPES = {
  java: ['java.lang'],
  kotlin: ['kotlin', 'kotlin.collections', 'kotlin.text', 'kotlin.io', 'kotlin.ranges', 'kotlin.sequences', 'kotlin.annotation', 'kotlin.comparisons', 'kotlin.jvm', 'java.lang'],
  // `scala`, `scala.Predef` and `java.lang` are imported as a whole. What the package object and Predef bind to a collection is per name (`DEFAULT_NAMES`).
  scala: ['scala', 'scala.Predef', 'java.lang'],
  csharp: ['System', 'System.IO', 'System.Collections.Generic', 'System.Linq', 'System.Net.Http', 'System.Threading', 'System.Threading.Tasks'],
  // F# opens Microsoft.FSharp.Core, Collections and Control for every file, and nothing from System.
  fsharp: ['FSharp.Core', 'FSharp.Collections', 'FSharp.Control'],
  rs: [''],
  go: ['builtin'],
  swift: ['Swift'],
  ts: [''],
  py: ['', 'builtins'],
  julia: ['Base', 'Core'],
  elixir: [''],
  cxx: ['', 'std'],
  lua: [''],
  powershell: [''],
}

/**
 * Names a language binds to one owner without an import, where the owner is not the
 * package the name is bound in. Scala's `scala` package object and `Predef` alias
 * `List`, `Seq` and `Vector` to `scala.collection.immutable`, `Iterator`, `Iterable` and
 * `IterableOnce` to `scala.collection`, and `Map` and `Set` to `immutable` (Scala 3's
 * `Predef$` and `scala` package pages list each alias and its target). Rust's `std`
 * macros are in scope everywhere (see `PRELUDE_MACROS`).
 */
export const DEFAULT_NAMES = {
  scala: Object.fromEntries(Object.entries({
    'scala.collection.immutable': ['Map', 'Set', 'Seq', 'IndexedSeq', 'List', 'Vector', 'LazyList', 'Range'],
    'scala.collection': ['Iterable', 'IterableOnce', 'Iterator', 'BufferedIterator'],
    'scala.collection.mutable': ['StringBuilder'],
    'scala.util': ['Either', 'Left', 'Right'],
    'scala.math': ['BigInt', 'BigDecimal', 'Ordering', 'Numeric', 'Ordered'],
  }).flatMap(([owner, names]) => names.map((name) => [name, owner]))),
}

/** Rust's standard macros are in scope in every file, and rustdoc files them under the crate that defines them. */
export const PRELUDE_MACROS = new Set(['std', 'core', 'alloc'])

/** What each port means by a bare name it imports, as the owner the name's page is under. */
export const BARE_OWNERS = Object.fromEntries(Object.entries({
  java: {
    'java.util': ['List', 'Set', 'Map', 'Optional', 'OptionalInt', 'OptionalLong', 'Collection', 'Iterator'],
    'java.util.function': ['Function', 'Supplier', 'Consumer', 'Predicate', 'LongSupplier'],
    'java.util.concurrent': ['Executor', 'TimeUnit'],
    'io.modelcontextprotocol.server': ['McpSyncServer'], 'io.modelcontextprotocol.spec': ['McpServerTransportProvider'],
    'java.util.regex': ['Pattern'],
    'java.nio.file': ['Path'], 'java.nio': ['ByteBuffer'], 'java.time': ['Duration', 'Instant'],
    'java.io': ['InputStream', 'BufferedWriter', 'IOException', 'UncheckedIOException', 'OutputStream'],
    'java.lang.annotation': ['Documented', 'Retention'],
    'org.junit.jupiter.api.extension': ['ExtensionContext'],
  },
  kotlin: {
    'kotlin.time': ['Duration', 'toKotlinDuration', 'toJavaDuration'],
    'kotlinx.coroutines': ['CoroutineScope', 'CoroutineDispatcher', 'Dispatchers', 'NonCancellable', 'launch', 'coroutineScope', 'withContext', 'runInterruptible'],
    'kotlinx.coroutines.flow': ['Flow', 'FlowCollector', 'StateFlow', 'MutableStateFlow', 'collect'],
    'java.nio.file': ['Path'],
  },
  scala: {
    'cats.effect.kernel': ['Async', 'Deferred', 'Outcome', 'Resource', 'Fiber', 'Ref'],
    'fs2.concurrent': ['Signal', 'SignallingRef'], 'scala.concurrent': ['ExecutionContext'], 'scala.util': ['Using'], 'cats.effect': ['IO'],
    // The Scala port's prose says SortedSet for the immutable one, as it says Set.
    'scala.collection.immutable': ['SortedSet'],
  },
  csharp: {
    'System.Text.RegularExpressions': ['RegexMatchTimeoutException'], 'System.Text.Json': ['JsonException'], 'System.Diagnostics': ['ProcessStartInfo'],
    'Microsoft.Extensions.Logging': ['ILogger'], 'Microsoft.Extensions.DependencyInjection': ['IServiceCollection', 'IMcpServerBuilder'], ModelContextProtocol: ['McpException'],
  },
  // The F# port's files open System, System.Collections.Generic, System.Threading and System.Threading.Tasks (the model's
  // `namespaceImports` lists them, and a test holds this table to it). F# itself opens nothing from System.
  fsharp: {
    System: ['Exception', 'ArgumentException', 'ArgumentNullException', 'ArgumentOutOfRangeException', 'InvalidOperationException', 'NotSupportedException', 'ObjectDisposedException', 'TimeoutException', 'FormatException', 'OperationCanceledException'],
    'System.Threading.Tasks': ['Task', 'TaskCanceledException'], 'System.Threading': ['CancellationToken'],
    'System.Collections.Generic': ['IReadOnlyList', 'IAsyncEnumerable', 'IEnumerable'],
  },
  rs: {
    'std.result': ['Result'], 'std.option': ['Option'], 'std.vec': ['Vec'], 'std.string': ['String'], 'std.time': ['Duration', 'Instant'],
    'std.collections': ['HashMap', 'BTreeMap'], 'std.path': ['PathBuf', 'Path'], 'std.sync': ['Arc'], 'std.borrow': ['Cow'],
    'std.convert': ['Into', 'From', 'AsRef'], 'std.iter': ['Iterator', 'IntoIterator'], 'std.fmt': ['Display'], 'std.ops': ['Drop'], 'std.ffi': ['OsStr', 'OsString'], 'std.error': ['Error'],
    'rmcp.model': ['ListResourcesResult', 'ListResourceTemplatesResult', 'ReadResourceResult', 'ErrorData'],
    'rmcp.handler.server.wrapper': ['Json', 'Parameters'],
  },
  swift: { Foundation: ['Data'] },
  // Julia's keywords are documented with the language and under no module: the manual's keyword section lists them at the top level.
  julia: { '': ['as', 'baremodule', 'begin', 'break', 'catch', 'const', 'continue', 'do', 'else', 'elseif', 'end', 'export', 'finally', 'for', 'function', 'global', 'if', 'import', 'let', 'local', 'macro', 'module', 'quote', 'return', 'struct', 'try', 'using', 'where', 'while'] },
  // `typing` keeps only what no other module provides; the abstract bases are `collections.abc`'s, and `typing.Mapping` is a name that says so.
  py: { typing: ['Unpack', 'TypeGuard', 'TypeAlias'], 'collections.abc': ['Mapping', 'Sequence', 'Callable', 'Iterator'] },
  powershell: {
    'System.IO': ['FileInfo'], 'System.Management.Automation': ['ApplicationInfo'],
    'microsoft.powershell.utility': ['Get-Member', 'Invoke-WebRequest'], 'microsoft.powershell.core': ['Where-Object', 'Receive-Job', 'CommonParameters'],
    threadjob: ['Start-ThreadJob'], 'microsoft.powershell.management': ['Set-Content'],
  },
}).map(([port, owners]) => [port, Object.fromEntries(Object.entries(owners).flatMap(([owner, names]) => names.map((name) => [name, owner])))]))

/**
 * The owners a bare name may have in a port, as page owners written with dots: the one its
 * imports give it, else the one its language binds it to, else every scope the language opens
 * as a whole.
 */
export function bareOwners(port, symbol) {
  const imported = BARE_OWNERS[port]?.[symbol]
  if (imported !== undefined) return [imported]
  const bound = DEFAULT_NAMES[port]?.[symbol]
  return bound === undefined ? DEFAULT_SCOPES[port] ?? [] : [bound]
}

/**
 * The page owners a type named in `extends` may be: written whole, it is itself; written bare, it is
 * in the scope the port gives that name, exactly (`AutoCloseable` is `java.lang.AutoCloseable` for
 * Scala, and `Error` is `std.error.Error` for Rust). A suffix of someone else's name is not it.
 */
export function hintOwners(port, hint) {
  const segments = parseName(hint).segments
  if (segments.length === 0) return []
  if (segments.length > 1) return [segments.join('.')]
  return bareOwners(port, segments[0]).map((scope) => (scope ? `${scope}.${segments[0]}` : segments[0]))
}

/** Ports whose names carry a kind a page can contradict: PascalCase types, camelCase members. */
const PASCAL = new Set(['java', 'kotlin', 'scala', 'csharp', 'fsharp'])
/** Ports that compare kinds at all. */
const KIND_CHECKED = new Set(['java', 'kotlin', 'scala', 'csharp', 'fsharp', 'rs', 'cxx', 'elixir'])

/**
 * A name as written: its segments with generics and subscripts out of the way
 * but the path after them kept (`Option<T>::map` is `Option`, `map`), the
 * parameter list of a trailing call, an Elixir kind prefix and operand count,
 * and the generic arity the last segment writes.
 */
export function parseName(name) {
  let text = name.trim().replace(/^new\s+/, '').replace(/`\d+/g, '')
  let hint
  const prefix = /^([tc]):(?=[A-Za-z_])/.exec(text)
  if (prefix) {
    hint = prefix[1]
    text = text.slice(2)
  }
  let arity
  const slash = /(?<=[\w!?])\/(\d+)$/.exec(text)
  if (slash) {
    arity = slash[1]
    text = text.slice(0, slash.index)
  }
  let params
  if (text.endsWith(')')) {
    let depth = 0
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] === ')') depth += 1
      if (text[i] === '(') depth -= 1
      if (depth === 0) {
        params = splitTop(text.slice(i + 1, -1))
        text = text.slice(0, i)
        break
      }
    }
  }
  const angle = stripGroups(text, '<', '>')
  const square = stripGroups(angle.text, '[', ']')
  const generics = angle.first === undefined ? undefined : splitTop(angle.first).length
  const segments = square.text.split(/::|[.#\\]/).map((segment) => segment.trim()).filter((segment) => segment && segment !== '_root_')
  return { segments, hint, arity, params, generics }
}

/** The segments of a name, outermost first. */
export const nameSegments = (name) => parseName(name).segments

/** The operand count a name writes after a slash, as Elixir does: `Enum.map/2`. */
export const arityOf = (name) => parseName(name).arity

/** The symbol a name asks for: its last segment, or the word its language spells for it. */
export function terminalSymbol(port, name) {
  const aliased = TYPE_ALIASES[port]?.[name]
  if (aliased) return aliased.split('.').at(-1)
  return parseName(name).segments.at(-1) ?? name.trim()
}

/** A name's segments as an address would spell them: a package alias replaced, the root marker dropped. */
export function addressSegments(port, name) {
  const segments = parseName(name).segments
  const whole = NAME_ALIASES[port]?.[segments.join('.')]
  return whole ? whole.split('.') : segments
}

/** What a reference role means a name is. */
const ROLE_KINDS = { class: 'type', exc: 'type', interface: 'type', meth: 'member', func: 'member', attr: 'member', data: 'member', const: 'member', var: 'member', mod: 'module' }

/** The kind a port's name has, from the table, the role it was written under, or the conventions of its language. */
export function kindOf(port, name, { source, role } = {}) {
  const { segments, hint, arity } = parseName(name)
  const last = segments.at(-1) ?? ''
  const table = NAME_KINDS[port] ?? {}
  const tabled = table[segments.join('.')] ?? (Object.hasOwn(table, last) ? table[last] : undefined)
  if (tabled) return tabled
  if (!KIND_CHECKED.has(port)) return undefined
  if (hint === 't') return 'type'
  if (hint === 'c') return 'callback'
  if (TYPE_ALIASES[port]?.[name]) return 'type'
  if (role && ROLE_KINDS[role]) return ROLE_KINDS[role]
  if (port === 'elixir') {
    if (arity !== undefined) return 'member'
    if (last === 't') return 'type'
    return /^[A-Z]/.test(last) ? 'module' : 'member'
  }
  // What the spelling says: SHOUTING is a constant, Pascal is a type, and a type after a type is a member or a nested type.
  if (segments.length > 1 && /^[A-Z][A-Z0-9_]+$/.test(last)) return 'member'
  if (/^[A-Z]/.test(last)) {
    // `System.Exception`, `Task.Run` and `Dispatchers.Default` read as Namespace.Type, Type.Member or Type.Nested: only the page says which.
    return segments.length > 1 && /^[A-Z]/.test(segments.at(-2)) ? 'qualified' : 'type'
  }
  // A lowercase name is a camelCase member in a Pascal language; in Rust and C++ it may be a module, function or primitive, and only a type position settles it.
  if (PASCAL.has(port)) return 'member'
  // Rust's lowercase types are its primitives; any other lowercase name in a type position is a path to something, not a type.
  if (port === 'rs') return source === 'type' && segments.length === 1 && RUST_PRIMITIVES.has(last) ? 'type' : undefined
  return source === 'type' ? 'type' : undefined
}

const RUST_PRIMITIVES = new Set(['bool', 'char', 'str', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'f32', 'f64', 'slice', 'array', 'tuple', 'unit', 'pointer', 'reference', 'fn', 'never'])

/**
 * The identity a use asks of its page.
 *
 * @param {{ port: string, name: string, source?: string, role?: string, owners?: string[], opens?: string[] }} use
 * @returns {{ port: string, name: string, segments: string[], symbol: string, kind?: string, owners?: string[], opens?: string[], arity?: number, params?: string[], bare: boolean, aliased: boolean }}
 */
export function sourceIdentity(use) {
  const { port, name } = use
  const parsed = parseName(name)
  const aliased = TYPE_ALIASES[port]?.[name]
  const segments = aliased ? aliased.split('.') : addressSegments(port, name)
  const key = `${port}:${name}`
  const arity = ARITIES[key] ?? parsed.generics ?? (parsed.arity === undefined ? undefined : Number(parsed.arity))
  return {
    port, name, segments, symbol: segments.at(-1) ?? name.trim(),
    kind: kindOf(port, name, use),
    ...(use.owners?.length && { owners: use.owners }),
    ...(use.opens?.length && { opens: use.opens }),
    ...(arity !== undefined && { arity }),
    ...(parsed.params && { params: parsed.params }),
    bare: segments.length < 2,
    aliased: Boolean(aliased),
  }
}
