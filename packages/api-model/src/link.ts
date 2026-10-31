import { tokenizeDoc, type DocSpan } from './doc/roles.ts'
import { symbolEntries, type InventoryEntry } from './inventory.ts'
import type { ApiSymbol, Signature, SymbolKind, TypeParameter } from './model.ts'
import { builtinHref, CURATED_BEFORE_INVENTORY, ELIXIR_STDLIB_MODULES, elixirStdlibHref, NOT_THE_JDKS } from './builtins.ts'
import { neverLinks } from './never-links.ts'
import { qualifiedNameOf } from './modules.ts'
import { findTopLevel, splitTopLevel, typeParametersOf } from './type-params.ts'

/**
 * Turn reference targets into links, and type annotations into linked spans.
 *
 * This is where "very interlinked" is actually earned. Two inputs produce the
 * same span shape and share one resolver: doc-comment roles
 * (`` :meth:`Pane.send_keys` ``) and type annotations as written
 * (`t.Literal["-"] | int | None`, `list[Window]`).
 *
 * Resolution is by name against the symbol table, never by inference. An
 * identifier that matches nothing stays plain text — which is the correct
 * outcome, and much better than a link to a guess.
 */

/** Which symbol kinds a role is allowed to match. */
const ROLE_KINDS: Record<string, SymbolKind[]> = {
  class: ['class', 'exception', 'enum', 'struct', 'union', 'interface', 'typealias', 'trait'],
  exc: ['exception', 'class'],
  meth: ['method', 'function'],
  func: ['function', 'method'],
  attr: ['attribute', 'property', 'constant'],
  data: ['constant', 'attribute'],
  const: ['constant'],
  mod: ['module'],
  obj: [],
  any: [],
}

/**
 * Names that belong to the language, not to us.
 *
 * gp-sphinx links these through intersphinx, and the rendered pages show
 * `reference external` hrefs into docs.python.org. Reproducing the whole
 * inventory is not the goal; covering what libtmux's annotations actually
 * mention is, and the rest stays plain rather than wrong.
 */
const PY_INTERSPHINX: Record<string, string> = {
  int: 'builtins/functions.html#int',
  str: 'builtins/stdtypes.html#str',
  bool: 'builtins/functions.html#bool',
  float: 'builtins/functions.html#float',
  bytes: 'builtins/stdtypes.html#bytes',
  list: 'builtins/stdtypes.html#list',
  dict: 'builtins/stdtypes.html#dict',
  set: 'builtins/stdtypes.html#set',
  tuple: 'builtins/stdtypes.html#tuple',
  None: 'builtins/constants.html#None',
  object: 'builtins/functions.html#object',
  Exception: 'builtins/exceptions.html#Exception',
  type: 'builtins/functions.html#type',
  Any: 'library/typing.html#typing.Any',
  Literal: 'library/typing.html#typing.Literal',
  Optional: 'library/typing.html#typing.Optional',
  Union: 'library/typing.html#typing.Union',
  // The abstract bases live in `collections.abc`; `typing.Mapping` and the rest are its deprecated aliases,
  // and a name written with `typing.` still reaches them through the inventory.
  Callable: 'library/collections.abc.html#collections.abc.Callable',
  Iterator: 'library/collections.abc.html#collections.abc.Iterator',
  Sequence: 'library/collections.abc.html#collections.abc.Sequence',
  Mapping: 'library/collections.abc.html#collections.abc.Mapping',
  Path: 'library/pathlib.html#pathlib.Path',
}

const PY_DOCS = 'https://docs.python.org/3/'

/** The dotted name before a trailing call or subscript (`shutil.which` in `shutil.which("tmux")`), else the text as written. */
function pythonCallee(text: string): string {
  const stripped = text.replace(/\((?:[^()]|\([^()]*\))*\)$/, '').replace(/\[[^\]]*\]$/, '')
  return stripped !== text && /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(stripped) ? stripped : text
}

/** Syntax words in the native declarations rendered as complete signatures. */
const SIGNATURE_KEYWORDS: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  kotlin: 'public private protected internal class interface object fun val var suspend override abstract open final data sealed enum inline reified crossinline noinline vararg in out where companion constructor operator infix tailrec external expect actual by',
  scala: 'def extension val var class trait object type given using implicit inline transparent opaque override abstract final sealed case lazy private protected open infix export derives end',
  fsharp: 'module namespace type member static abstract override interface inherit let rec mutable inline internal private public of with get set new val and when',
  ts: 'readonly keyof typeof infer extends unique private static async function const',
  go: 'func chan map struct interface',
  swift: 'any',
  julia: 'where struct mutable abstract primitive type function end',
  // Attributes that open a declaration, and the guard of a spec.
  elixir: 'spec type opaque callback macrocallback when',
  cxx: 'alignas alignof auto class concept const consteval constexpr constinit decltype default delete enum explicit extern final friend inline mutable namespace noexcept operator override register requires static struct template thread_local typedef typename union using virtual volatile',
}).map(([port, words]) => [port, new Set(words.split(' '))]))

/** Language help stays separate from links to API declarations. */
export interface KeywordHelp {
  title: string
  description: string
  href: string
}

export const KEYWORD_HELP: Record<string, Record<string, KeywordHelp>> = {
  cxx: {
    nodiscard: {
      title: 'C++ nodiscard attribute',
      description: 'Asks the compiler to warn when a result is discarded. An explicit cast to void acknowledges that the result is intentionally ignored.',
      href: 'https://eel.is/c++draft/dcl.attr.nodiscard',
    },
  },
  kotlin: {
    suspend: {
      title: 'Kotlin suspending functions',
      description: 'Allows a function to call suspending operations and pause without blocking a thread. It does not start a coroutine by itself.',
      href: builtinHref('kotlin', 'suspend')!,
    },
  },
  scala: {
    def: {
      title: 'Scala method declarations',
      description: 'Declares a method, with its name, parameter lists and return type.',
      href: 'https://docs.scala-lang.org/tour/basics.html#methods',
    },
    extension: {
      title: 'Scala extension methods',
      description: 'Adds methods callable on the receiver type without changing its definition.',
      href: 'https://docs.scala-lang.org/scala3/reference/contextual/extension-methods.html',
    },
  },
  fsharp: {
    val: {
      title: 'F# value signatures',
      description: 'Declares the name and type of a value or function in a signature.',
      href: 'https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/signature-files',
    },
  },
}

/** A keyword argument (`cancel:`, `clients: true`) names a parameter, not a member. */
export const keywordArgument = /^[A-Za-z_]\w*[?!]?:(?:\s|$)/

/** A tmux control-mode marker (`%begin`, `%output`, `%session-changed`) names a protocol line, not the member that shares its word. */
const controlMarker = /^%[\w-]+$/

interface TypeSpan {
  text: string
  link?: LinkTarget
  declaration?: true
  keyword?: true
  help?: KeywordHelp
  /** Syntax the grammar owns, such as an atom or a keyword key: it names no API. */
  nonReference?: true
}

/**
 * Builtin exceptions, which docstrings reference constantly and which all live
 * on one page.
 */
const PY_EXCEPTIONS = new Set([
  'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException',
  'BlockingIOError', 'BrokenPipeError', 'BufferError', 'ChildProcessError',
  'ConnectionError', 'EOFError', 'FileExistsError', 'FileNotFoundError',
  'GeneratorExit', 'ImportError', 'IndentationError', 'IndexError',
  'InterruptedError', 'IsADirectoryError', 'KeyError', 'KeyboardInterrupt',
  'LookupError', 'MemoryError', 'NameError', 'NotADirectoryError',
  'NotImplementedError', 'OSError', 'OverflowError', 'PermissionError',
  'ProcessLookupError', 'RecursionError', 'ReferenceError', 'RuntimeError',
  'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SystemError',
  'SystemExit', 'TimeoutError', 'TypeError', 'UnboundLocalError',
  'UnicodeDecodeError', 'UnicodeError', 'ValueError', 'ZeroDivisionError',
])

/**
 * Standard-library modules whose members resolve by construction.
 *
 * A hand-maintained name table only ever covers what someone remembered to
 * add — `subprocess.Popen` and `dataclasses.dataclass` were both missing, and
 * nothing would have reported that. `module.Member` where the module is known
 * resolves to `library/<module>.html#<module>.<Member>`, which is exactly
 * where intersphinx sends it.
 */
const PY_STDLIB_MODULES = new Set([
  'subprocess', 'dataclasses', 'pathlib', 'typing', 'logging', 'os', 'sys',
  'shutil', 'enum', 'abc', 'collections', 'functools', 'itertools', 'json',
  'time', 'datetime', 'warnings', 'contextlib', 'traceback', 're', 'io',
  'threading', 'asyncio', 'unittest', 'tempfile', 'textwrap', 'random',
])

export interface LinkTarget {
  /** Which project an external link points into, for the title attribute. */
  project?: string
  href: string
  /** True when the link leaves libtmux.org. */
  external: boolean
  /** The symbol it resolved to, when it resolved locally. */
  symbol?: ApiSymbol
  /**
   * Set when the target is a type parameter's anchor on its declaring symbol's
   * page. `symbol` stays unset: the declaring type is not what the name refers to.
   */
  typeParameter?: { owner: ApiSymbol; parameter: TypeParameter }
}

/** Stable parameter anchors shared by prose links and the definition list. */
export const parameterId = (symbol: ApiSymbol, name: string) => `${symbol.publicId ?? symbol.id}.parameter.${name}`

/** The anchor of a type parameter on the page of the symbol that declares it. */
export const typeParameterId = (symbol: ApiSymbol, name: string) => `${symbol.publicId ?? symbol.id}.type-parameter.${name}`

/**
 * What a name written in a declaration means when it is a type parameter.
 * `owner` and `parameter` are absent when the model records that a name is
 * bound but not where it is declared, as with a Rust impl that renames the
 * type's parameter.
 */
export interface TypeParameterBinding {
  owner?: ApiSymbol
  parameter?: TypeParameter
}

export const TYPE_KINDS: ReadonlySet<SymbolKind> = new Set(['class', 'interface', 'struct', 'union', 'enum', 'trait', 'typealias', 'exception'])
/** Roles whose target may name a type parameter; `typeparam` names nothing else. */
const TYPE_PARAMETER_ROLES: ReadonlySet<string> = new Set(['any', 'class', 'obj', 'typeparam'])

/** Index of the bracket closing the one at `open`, counting only the same kind. */
function closingBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { '<': '>', '[': ']', '(': ')', '{': '}' }
  const opener = text[open]!
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text.startsWith('->', i) || text.startsWith('=>', i)) { i++; continue }
    if (text[i] === opener) depth++
    else if (text[i] === pairs[opener]) {
      depth--
      if (!depth) return i
    }
  }
  return -1
}

/**
 * Whether `name: Type` here declares a value, not names a type: a colon after
 * the name inside parentheses, as in Scala's `(using F: Async[F])`. A type
 * parameter list is bracketed, so its `C : Ordering` is not caught.
 */
function declaresValue(before: string, after: string): boolean {
  if (!/^\s*\??:(?!:)/.test(after)) return false
  const open: string[] = []
  for (const char of before) {
    if ('([{<'.includes(char)) open.push(char)
    else if (')]}>'.includes(char)) open.pop()
  }
  return open.at(-1) === '('
}

/**
 * The arguments a Rust `impl` header gives its self type: `T` in
 * `impl<T: Clone> Slot<T> where T: Send`. Undefined for a header that is not
 * an `impl`, where the members are written inside the declaring type.
 */
function implSelfArguments(header: string): string[] | undefined {
  const text = header.replace(/^(?:\s*#\[[^\n]*\]\s*)+/, '').trim()
  const start = /^(?:unsafe\s+)?impl\b\s*/.exec(text)
  if (!start) return undefined
  let rest = text.slice(start[0].length)
  if (rest.startsWith('<')) rest = rest.slice(closingBracket(rest, 0) + 1)
  const trait = findTopLevel(rest, [' for '])
  if (trait) rest = rest.slice(trait.index + 5)
  const where = findTopLevel(rest, [' where ', '\nwhere'])
  if (where) rest = rest.slice(0, where.index)
  rest = rest.trim().replace(/^&\s*(?:'\w+\s+)?(?:mut\s+)?/, '')
  const open = rest.indexOf('<')
  const close = open < 0 ? -1 : closingBracket(rest, open)
  return close < 0 ? [] : splitTopLevel(rest.slice(open + 1, close), ',')
}

/**
 * An index built once per port and queried per span.
 *
 * Three lookups, tried in order, because reST references are written three
 * ways: fully qualified (`libtmux.Pane.send_keys`), partially
 * (`Pane.send_keys`), and bare (`send_keys`, or `.panes` with a leading dot
 * meaning "search upward"). A bare name is ambiguous by construction — 45
 * classes have a `name` attribute — so it resolves only when exactly one
 * candidate matches the role's kinds. Ambiguity produces no link, never an
 * arbitrary one.
 */
export class SymbolIndex {
  private readonly byPublic = new Map<string, ApiSymbol>()
  private readonly byQualified = new Map<string, ApiSymbol[]>()
  // Keyed by declaration id. `parent` is a declaration id, so looking an owner
  // up in byPublic silently misses every time — which is why relative
  // references stayed at 0% until this map existed.
  private readonly byDeclared = new Map<string, ApiSymbol>()
  private readonly bySuffix = new Map<string, ApiSymbol[]>()
  private readonly byName = new Map<string, ApiSymbol[]>()
  /** Swift declarations that take labels, under the path without them: `Server.sessions`. */
  private readonly swiftCallables = new Map<string, ApiSymbol[]>()
  /** The outermost namespaces a Ruby id starts with, for a name written without one. */
  private readonly rubyRoots = new Set<string>()
  /** An Elixir module's members, by the module's id. */
  private readonly elixirMembers = new Map<string, ApiSymbol[]>()

  // A plain field, not a constructor parameter property. Node's
  // --experimental-strip-types rejects parameter properties outright
  // ("not supported in strip-only mode"), and this package is imported by
  // build scripts running under bare node as well as by Vite and vitest,
  // which both accept them. The stricter consumer sets the rule.
  private readonly hrefFor: (symbol: ApiSymbol) => string

  /**
   * External inventories, in intersphinx's own shape.
   *
   * `{ name: { baseUrl, entries } }` mirrors `intersphinx_mapping`. A name
   * that matches nothing locally is looked up here before falling back to the
   * built-in table — so `subprocess.Popen` resolves from CPython's 19,441
   * entries rather than from a list somebody remembered to extend.
   */
  private readonly external: {
    baseUrl: string
    byName: Map<string, InventoryEntry>
    langs?: string[]
    project?: string
  }[] = []

  /**
   * Which port this index describes.
   *
   * Gates every Python-specific fallback below. Undefined means "no
   * language-specific fallbacks" rather than "assume Python": a caller that
   * forgets to say produces fewer links, not wrong ones.
   */
  private readonly lang: string | undefined

  constructor(symbols: ApiSymbol[], hrefFor: (symbol: ApiSymbol) => string, lang?: string) {
    this.lang = lang
    this.hrefFor = hrefFor
    for (const s of symbols) {
      if (!this.byDeclared.has(s.id) || !s.inheritedFrom) this.byDeclared.set(s.id, s)
      const pub = s.publicId ?? s.id
      // Declared members win over inherited copies: a link should land on the
      // page where the thing is written, not on one of its 30 subclasses.
      if (!this.byPublic.has(pub) || !s.inheritedFrom) this.byPublic.set(pub, s)

      const qualified = qualifiedNameOf(s)
      const aliases = this.byQualified.get(qualified) ?? []
      aliases.push(s)
      this.byQualified.set(qualified, aliases)

      const suffixes = new Set([pub, qualified].flatMap((name) => {
        const parts = name.split('.')
        return parts.slice(1).map((_, i) => parts.slice(i + 1).join('.'))
      }))
      for (const suffix of suffixes) {
        const list = this.bySuffix.get(suffix) ?? []
        list.push(s)
        this.bySuffix.set(suffix, list)
      }
      const list = this.byName.get(s.name) ?? []
      list.push(s)
      this.byName.set(s.name, list)
      if (this.lang === 'ruby' && pub.includes('::')) this.rubyRoots.add(pub.slice(0, pub.indexOf('::')))
      if (this.lang === 'elixir' && s.parent) this.elixirMembers.set(s.parent, [...(this.elixirMembers.get(s.parent) ?? []), s])
      const labels = this.lang === 'swift' ? pub.indexOf('(') : -1
      if (labels > 0) {
        const overloads = this.swiftCallables.get(pub.slice(0, labels)) ?? []
        overloads.push(s)
        this.swiftCallables.set(pub.slice(0, labels), overloads)
      }
    }
  }

  /**
   * Preference order for an untyped reference.
   *
   * A bare `` `Window` `` is `py:obj` in Sphinx, whose default resolution
   * prefers a type over a member. Here it matched two symbols — the `Window`
   * class and the `OptionScope.Window` enum member — and strict uniqueness
   * refused both, which loses a link that has an obviously right answer.
   * Ranking first and requiring uniqueness *within the top rank* keeps the
   * safety (two classes of the same name still resolve to nothing) without
   * throwing away the easy case.
   */
  private static rank(kind: SymbolKind): number {
    if (kind === 'class' || kind === 'exception' || kind === 'struct' || kind === 'union' || kind === 'interface') {
      return 0
    }
    if (kind === 'enum' || kind === 'trait' || kind === 'typealias') return 1
    if (kind === 'function' || kind === 'method') return 2
    if (kind === 'module') return 3
    return 4
  }

  /**
   * Add an inventory to resolve against, the way `intersphinx_mapping` does.
   *
   * Entries are keyed by name only; the role is not used to disambiguate,
   * because an inventory's names are already fully qualified and a collision
   * between `py:class os.PathLike` and anything else does not occur in
   * practice. If it ever does, the first inventory registered wins, which is
   * the same rule intersphinx applies to its own mapping order.
   */
  /**
   * Attach an external inventory, optionally scoped to the ports it describes.
   *
   * `langs` is not optional in spirit. Sphinx gives every project its own
   * `intersphinx_mapping`; nothing makes a Go project consult CPython's
   * inventory. This index serves eight ports from one code path, so the scope
   * that is implicit in Sphinx has to be written down here — and when it was
   * not, `time.Time`, `os.File` and `Optional` resolved into docs.python.org
   * from Go, Java and Rust pages: 1,889 links that sent a reader of one
   * language to another language's manual.
   */
  addInventory(
    baseUrl: string,
    entries: InventoryEntry[],
    langs?: string[],
    project?: string,
  ): void {
    const byName = new Map<string, InventoryEntry>()
    // A page of the manual or a command-line option is not a symbol: Julia's `index` is its front
    // page, and CPython's `search` is its search page, not a function of that name.
    for (const entry of symbolEntries(entries)) if (!byName.has(entry.name)) byName.set(entry.name, entry)
    this.external.push({ baseUrl: baseUrl.replace(/\/*$/, '/'), byName, langs, project })
  }

  private pick(
    candidates: ApiSymbol[] | undefined,
    role: string,
    context?: ApiSymbol,
  ): ApiSymbol | undefined {
    if (!candidates?.length) return undefined
    const kinds = ROLE_KINDS[role] ?? []
    const filtered = kinds.length ? candidates.filter((c) => kinds.includes(c.kind)) : candidates
    if (this.lang === 'go' && role === 'class' && !filtered.length) return undefined
    const pool = filtered.length ? filtered : candidates
    // A declaration beats an inherited copy: a link should land where the
    // thing is written, not on one of its thirty subclasses.
    const declared = pool.filter((c) => !c.inheritedFrom)
    const final = declared.length ? declared : pool
    if (final.length === 1) return final[0]
    const best = Math.min(...final.map((c) => SymbolIndex.rank(c.kind)))
    const top = final.filter((c) => SymbolIndex.rank(c.kind) === best)
    return top.length === 1 ? top[0] : SymbolIndex.nearest(top, context)
  }

  /**
   * The candidate nearest the referring symbol in the namespace tree.
   *
   * `Pane` written on `tmux.Window.NewPane` means `tmux.Pane`, not
   * `workspace.Pane`; `Builder` written on `SplitSpec.Builder.percent` means
   * that Builder and not the eight others. Both are the rule the compiler
   * applies, and sharing a prefix is the only thing separating candidates that
   * are otherwise identical in kind.
   *
   * A candidate must share at least one leading segment. Without that floor
   * this would pick an arbitrary winner for names that are ambiguous *and*
   * unrelated, and a bare `Error` on a `session.` page would land on whichever
   * of them the model happened to list first.
   *
   * The floor is strict enough that a language whose types are siblings gets
   * no link from it at all: `Window` written in `pane::Pane` shares nothing
   * with `window::Window`. That is why Rust's `impl` blocks are folded onto
   * the type they extend before this runs — with one candidate the question
   * never reaches here.
   */
  private static nearest(candidates: ApiSymbol[], context?: ApiSymbol): ApiSymbol | undefined {
    if (!context || candidates.length === 0) return undefined
    const from = qualifiedNameOf(context).split('.')
    const shared = (c: ApiSymbol) => {
      const id = qualifiedNameOf(c).split('.')
      let n = 0
      while (n < id.length && n < from.length && id[n] === from[n]) n++
      return n
    }
    const scored = candidates.map((c) => ({ c, n: shared(c) }))
    const best = Math.max(...scored.map((x) => x.n))
    if (best === 0) return undefined
    const top = scored.filter((x) => x.n === best)
    return top.length === 1 ? top[0].c : undefined
  }

  private readonly sharedBindings = new WeakMap<ApiSymbol, Map<string, TypeParameterBinding>>()

  /** What a declaration introduces: its own list, plus a Kotlin or Scala type's constructor-shaped signatures. */
  private declaredBy(symbol: ApiSymbol): TypeParameter[] {
    const own = typeParametersOf(symbol, this.lang)
    if ((this.lang !== 'kotlin' && this.lang !== 'scala') || !TYPE_KINDS.has(symbol.kind)) return own
    return [...own, ...symbol.signatures.flatMap((entry) => typeParametersOf(entry, this.lang))]
  }

  /**
   * Bind an impl's or receiver's spelling of the declaring type's parameters
   * to the declared ones, by position. `impl<U> Slot<U>` renames `T`, and an
   * `impl<T> From<T> for Slot<String>` introduces a `T` the type never declared.
   */
  private bindEnclosing(found: Map<string, TypeParameterBinding>, context: ApiSymbol, signature: Signature): void {
    const owner = context.parent ? this.byDeclared.get(context.parent) : undefined
    const declared = owner ? this.declaredBy(owner) : []
    const bind = (name: string, parameter?: TypeParameter) => {
      if (!found.has(name)) found.set(name, parameter ? { owner, parameter } : {})
    }
    if (this.lang === 'go') {
      const spelled = /\[([^\]]*)\]\s*$/.exec(signature.receiver?.type ?? '')?.[1]
      if (spelled) splitTopLevel(spelled, ',').forEach((name, at) => { if (name !== '_') bind(name, declared[at]) })
      return
    }
    const names = signature.enclosingTypeParamNames ?? []
    const positional = implSelfArguments(signature.enclosingDeclaration ?? '')
    for (const name of names) {
      if (!positional) bind(name, declared.find((parameter) => parameter.name === name))
      else bind(name, declared[positional.indexOf(name)])
    }
  }

  /**
   * The names a declaration binds as type parameters, innermost first.
   *
   * Without a `signature` this is shared prose, which has no selected
   * overload, so every overload's parameters count. A name bound anywhere
   * must not link to a same-named global type.
   */
  typeParameterBindings(context?: ApiSymbol, signature?: Signature): Map<string, TypeParameterBinding> {
    if (!context) return new Map()
    const cached = signature ? undefined : this.sharedBindings.get(context)
    if (cached) return cached
    const found = new Map<string, TypeParameterBinding>()
    const add = (owner: ApiSymbol, parameters: readonly TypeParameter[]) => {
      for (const parameter of parameters) if (!found.has(parameter.name)) found.set(parameter.name, { owner, parameter })
    }
    const signatures = signature ? [signature] : context.signatures
    // Kotlin and Scala record a type's own parameters on its signature, which the scope walk below reads.
    const typeShaped = (this.lang === 'kotlin' || this.lang === 'scala') && TYPE_KINDS.has(context.kind)
    if (!typeShaped) for (const entry of signatures) add(context, typeParametersOf(entry, this.lang))
    const insideImpl = this.lang === 'rs' && context.signatures.some((entry) => entry.enclosingDeclaration)
    if (insideImpl || this.lang === 'go') for (const entry of signatures) this.bindEnclosing(found, context, entry)
    if (!insideImpl) {
      const detached = signatures.length > 0 && signatures.every((entry) => entry.typeScopeBoundary === true)
      for (let scope: ApiSymbol | undefined = context; scope; scope = scope.parent ? this.byDeclared.get(scope.parent) : undefined) {
        add(scope, this.declaredBy(scope))
        if (scope.typeScopeBoundary || (scope === context && detached)) break
      }
    }
    if (!signature) this.sharedBindings.set(context, found)
    return found
  }

  private bindingLink(binding: TypeParameterBinding): LinkTarget | undefined {
    const { owner, parameter } = binding
    if (!owner || !parameter) return undefined
    const page = this.hrefFor(owner).split('#')[0]
    return { href: `${page}#${encodeURIComponent(typeParameterId(owner, parameter.name))}`, external: false, typeParameter: { owner, parameter } }
  }

  /**
   * A name as spans when it is a bound type parameter, or a projection from
   * one: `F::Output` and `T.Element` name an associated type of the parameter.
   */
  private boundSpans(text: string, bindings: Map<string, TypeParameterBinding>): TypeSpan[] | undefined {
    const spanFor = (name: string, binding: TypeParameterBinding): TypeSpan => {
      const link = this.bindingLink(binding)
      return { text: name, declaration: true, ...(link ? { link } : {}) }
    }
    const direct = bindings.get(text)
    if (direct) return [spanFor(text, direct)]
    const separator = this.lang === 'swift' ? '.' : this.lang === 'rs' || this.lang === 'cxx' ? '::' : undefined
    const head = separator ? text.split(separator)[0]! : undefined
    const binding = head && head !== text ? bindings.get(head) : undefined
    return binding ? [spanFor(head!, binding), { text: text.slice(head!.length) }] : undefined
  }

  /** `text` as spans when it names a type parameter bound where `context` is written; otherwise undefined. */
  typeParameterSpans(text: string, context?: ApiSymbol, signature?: Signature): TypeSpan[] | undefined {
    return this.boundSpans(text, this.typeParameterBindings(context, signature))
  }

  /** The anchor of the type parameter `name` names where `context` is written, if it names one. */
  typeParameterLink(name: string, context?: ApiSymbol, signature?: Signature): LinkTarget | undefined {
    const binding = this.typeParameterBindings(context, signature).get(name)
    return binding && this.bindingLink(binding)
  }

  /** The parameters a symbol declares on itself, as its own page lists them. */
  typeParametersDeclaredBy(symbol: ApiSymbol): TypeParameter[] {
    return this.declaredBy(symbol)
  }

  /**
   * Type parameters declared by an enclosing symbol that this symbol's own
   * types mention. Read through `linkType`, so the list and the links in the
   * signature cannot disagree about which name means which declaration.
   */
  inheritedTypeParameters(symbol: ApiSymbol): { owner: ApiSymbol; parameter: TypeParameter; href: string }[] {
    const used = new Map<string, { owner: ApiSymbol; parameter: TypeParameter; href: string }>()
    const scan = (text: string | undefined, signature?: Signature) => {
      if (!text) return
      for (const span of this.linkType(text, symbol, signature)) {
        const target = span.link?.typeParameter
        if (target && target.owner.id !== symbol.id) used.set(`${target.owner.id}\0${target.parameter.name}`, { ...target, href: span.link!.href })
      }
    }
    scan(symbol.type)
    for (const base of symbol.extends ?? []) scan(base)
    for (const entry of symbol.signatures) {
      scan(entry.raw, entry)
      scan(entry.returns, entry)
      scan(entry.receiver?.type, entry)
      for (const param of entry.params) scan(param.type, entry)
      for (const parameter of typeParametersOf(entry, this.lang)) { scan(parameter.bound, entry); scan(parameter.default, entry) }
    }
    const depth = (owner: ApiSymbol) => {
      let count = 0
      for (let scope: ApiSymbol | undefined = symbol; scope && scope.id !== owner.id; scope = scope.parent ? this.byDeclared.get(scope.parent) : undefined) count++
      return count
    }
    return [...used.values()].sort((a, b) => depth(a.owner) - depth(b.owner) ||
      this.declaredBy(a.owner).indexOf(a.parameter) - this.declaredBy(b.owner).indexOf(b.parameter))
  }

  /**
   * Resolve a reference, optionally from inside a symbol.
   *
   * `context` is what makes reST's relative form work. `` :attr:`.panes` ``
   * inside `Session`'s docstring means `Session.panes`, and the leading dot
   * says so — without it the bare name `panes` is ambiguous across five
   * classes and correctly resolves to nothing. Passing the enclosing symbol
   * turned 59 dead references into links, most of the remaining gap.
   */
  resolve(target: string, role = 'any', context?: ApiSymbol): LinkTarget | undefined {
    // A name the context binds as a type parameter is that parameter, never a
    // same-named global.
    if (context && TYPE_PARAMETER_ROLES.has(role) && /^[A-Za-z_$][\w$]*$/.test(target)) {
      const parameter = this.typeParameterLink(target, context)
      if (parameter) return parameter
    }
    return role === 'typeparam' ? undefined : this.resolveSymbol(target, role, context)
  }

  private resolveSymbol(target: string, role: string, context?: ApiSymbol): LinkTarget | undefined {
    const relative = target.startsWith('.')
    const goType = this.lang === 'go' && role === 'class'
    if (this.lang === 'ruby') {
      const yard = this.resolveYard(target, context)
      if (yard) return yard
    }
    if (this.lang === 'elixir') {
      const elixir = this.resolveElixir(target, context)
      if (elixir) return elixir
    }
    let clean = target.replace(/^[~.]/, '')
    // `System.getenv()` is the overload that takes nothing, and an inventory that lists overloads says which.
    const nullary = this.lang !== 'swift' && this.lang !== 'py' && clean.endsWith('()')
    // Swift ids keep their argument labels, so `isRunning()` names `Server.isRunning()`.
    if (this.lang !== 'swift') clean = clean.replace(/\(\)$/, '')
    // Elixir names a type `t:name/0` and a function `name/2`; the prefix and arity select, they do not spell.
    if (this.lang === 'elixir') clean = clean.replace(/^[tc]:(?=[A-Za-z_])/, '').replace(/\/\d+$/, '')
    let opaqueContext = false
    if (this.lang === 'powershell' && context) {
      const prefixed = /^[$-]/.test(clean)
      const parameter = context.signatures.flatMap((signature) => signature.params)
        .find((param) => param.name.toLowerCase() === (prefixed ? clean.slice(1) : clean).toLowerCase()
          && (prefixed || param.binding?.common || ['WhatIf', 'Confirm'].includes(param.name)))
      if (parameter) return { href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, parameter.name))}`, external: false }
      // These are ErrorRecord identifiers, not exception classes. Native help
      // owns their meaning; keep the destination pinned to the extracted help.
      if (/^Tmux\.[A-Za-z_]\w*$/.test(clean) && context.doc?.body) {
        const notes = context.doc.body.split(/^### Notes\s*$/m)[1] ?? ''
        const documented = [...notes.matchAll(/\bTmux\.[A-Za-z_]\w*/g)].some((match) => match[0] === clean)
        const revision = context.source.extractedRevision ?? context.source.revision
        const help = context.doc.examples?.map((example) => example.sourceUrl).find((href) =>
          revision && href?.startsWith(`https://github.com/${context.source.repo}/blob/${revision}/docs/reference/`)
            && href.endsWith(`/${context.name}.md`))
        if (documented && help) return { href: `${help}#notes`, external: true, project: 'PowerShell command help' }
      }
    }
    // A variable names no page and a printed string names no symbol, whatever else resolves under that spelling. A command's own
    // parameter, which a `$name` may stand for, is answered above.
    if (neverLinks(target)) return undefined
    if (this.lang === 'scala') clean = clean.replace(/^_root_\./, '').replace(/#/g, '.')
    if (this.lang === 'fsharp' || this.lang === 'csharp') clean = clean.replace(/`\d+/g, '')
    const [importHead, ...tail] = clean.split('.')
    const imported = !relative && context?.imports?.[importHead]
    if (imported) clean = [imported, ...tail].join('.')
    if (this.lang === 'scala') clean = clean.replace(/^_root_\./, '')

    const called = target.endsWith('()')
    const javaCallable = this.lang === 'java' && (role === 'meth' || role === 'func' || (role === 'any' && called))
    if (javaCallable) {
      const accessor = this.byPublic.get(`${clean}()`) ?? this.byQualified.get(clean)
        ?.find((symbol) => symbol.kind === 'method' && symbol.id.endsWith('()'))
      if (accessor && (called || this.byPublic.get(clean)?.kind !== 'method')) {
        return { href: this.hrefFor(accessor), external: false, symbol: accessor }
      }
    }

    if (context && ['kotlin', 'scala', 'fsharp'].includes(this.lang ?? '') && !relative &&
        context.signatures.some((sig) => sig.params.some((param) => param.name === clean))) {
      return { href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, clean))}`, external: false }
    }
    if (context && ['kotlin', 'scala'].includes(this.lang ?? '')) {
      const receiver = context.signatures.find((sig) => sig.receiver?.name === clean)?.receiver
      const receiverType = receiver?.type?.replace(/[<[].*$/, '')
      if (receiverType && receiverType !== clean) return this.resolve(receiverType, 'class', context)
    }

    // Walk outward from the current symbol: a member first, then a sibling of
    // its owner. This is Sphinx's own search order for a relative target.
    if (context) {
      const scopes: string[] = []
      const own = context.publicId ?? context.id
      scopes.push(own)
      if (context.parent) {
        const owner = this.byDeclared.get(context.parent)
        scopes.push(owner?.publicId ?? context.parent)
      }
      if (this.lang === 'kotlin' || this.lang === 'scala' || this.lang === 'java') {
        let scope = qualifiedNameOf(context)
        while (scope.includes('.')) {
          scope = scope.slice(0, scope.lastIndexOf('.'))
          scopes.push(scope)
        }
      }
      if (this.lang === 'cxx') {
        let scope = own
        while (scope.includes('::')) {
          scope = scope.slice(0, scope.lastIndexOf('::'))
          scopes.push(scope)
        }
      }
      for (const scope of scopes) {
        const target = `${scope}${this.lang === 'cxx' ? '::' : '.'}${clean}`
        const declaration = this.byPublic.get(target) ?? this.pick(this.byQualified.get(target), role, context)
        const accessor = javaCallable ? this.byPublic.get(`${target}()`) : undefined
        const hit = accessor && (called || declaration?.kind !== 'method') ? accessor : declaration
        if (hit && role === 'class' && (goType || this.lang === 'java' || this.lang === 'csharp') && !ROLE_KINDS.class.includes(hit.kind)) continue
        if (hit) return { href: this.hrefFor(hit), external: false, symbol: hit }
        // DocC takes a bare name to the one declaration that owns it. Several
        // overloads leave it ambiguous, and the global match below would pick
        // a same-named property of another type instead.
        const overloads = this.lang === 'swift' && !clean.includes('(') ? this.swiftCallables.get(target) : undefined
        if (overloads) {
          // A parameter named like a method means the parameter, and a name
          // in its own declaration's documentation needs no link to itself.
          const parameter = context.signatures.some((sig) => sig.params.some((param) => param.name === clean))
          return overloads.length === 1 && overloads[0] !== context && !parameter
            ? { href: this.hrefFor(overloads[0]), external: false, symbol: overloads[0] }
            : undefined
        }
      }
      if (this.lang === 'scala') {
        const owners: ApiSymbol[] = []
        for (let scope: ApiSymbol | undefined = context; scope; scope = scope.parent ? this.byDeclared.get(scope.parent) : undefined) {
          owners.push(scope)
          opaqueContext ||= scope.modifiers.includes('opaque')
        }
        if (opaqueContext && !clean.includes('.') && role !== 'class') {
          const inherited = new Map<string, LinkTarget>()
          const visited = new Set<string>()
          for (const owner of owners) {
            if (visited.has(owner.id)) continue
            visited.add(owner.id)
            for (const bound of owner.extends ?? []) {
              // Only named public bounds establish ownership; complex types stay unresolved.
              const type = bound.trim()
              if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(type)) continue
              const base = this.resolve(type, 'class', owner)
              if (!base) continue
              const name = base.symbol ? qualifiedNameOf(base.symbol) : type
              const member = this.resolve(`${name}.${clean}`, role, owner)
              if (member) inherited.set(member.href, member)
              else if (base.symbol) owners.push(base.symbol)
            }
          }
          if (inherited.size === 1) return [...inherited.values()][0]
          if (inherited.size > 1) return undefined
        }
      }
      // A relative reference must not fall through to a global bare-name
      // match: `.panes` written in Session means Session's, or nothing.
      if (relative && !clean.includes('.')) return undefined
    }

    const exact = this.byPublic.get(clean)
    if (exact && (!goType || ROLE_KINDS.class.includes(exact.kind))) return { href: this.hrefFor(exact), external: false, symbol: exact }

    // Keep existing ids authoritative when a constructor's native spelling
    // also names a legacy type id.
    const qualified = this.pick(this.byQualified.get(clean), role, context)
    if (qualified) return { href: this.hrefFor(qualified), external: false, symbol: qualified }

    // Native extension prose often names its receiver in lower case.
    if (context?.parent && ['kotlin', 'scala'].includes(this.lang ?? '')) {
      const owner = this.byDeclared.get(context.parent)
      if (owner && clean === owner.name[0]?.toLowerCase() + owner.name.slice(1)) {
        return { href: this.hrefFor(owner), external: false, symbol: owner }
      }
    }

    const bySuffix = this.pick(this.bySuffix.get(clean), role, context)
    if (bySuffix && opaqueContext && !clean.includes('.') && bySuffix.parent &&
        ['method', 'property', 'attribute'].includes(bySuffix.kind)) return undefined
    if (bySuffix) return { href: this.hrefFor(bySuffix), external: false, symbol: bySuffix }

    if (!clean.includes('.')) {
      const byName = this.pick(this.byName.get(clean), role, context)
      if (byName) return { href: this.hrefFor(byName), external: false, symbol: byName }
    }

    // Scala and Kotlin default imports take precedence over a JDK inventory's
    // bare aliases. An explicit java.util.Vector import still resolves there.
    const usingAlias = this.lang === 'scala' && (clean === 'Using' || clean.startsWith('Using.'))
    const shadowedUsing = usingAlias && (this.byName.has('Using') || this.bySuffix.has(clean) ||
      context?.signatures.some((sig) => sig.params.some((param) => param.name === 'Using') || sig.receiver?.name === 'Using'))
    const builtin = this.lang && !shadowedUsing ? builtinHref(this.lang, clean) : undefined
    if (builtin && CURATED_BEFORE_INVENTORY.has(this.lang ?? '')) return { href: builtin, external: true }

    // Intersphinx order: exact name, then the shortest suffix. An inventory
    // is authoritative for its own project, so it is consulted before the
    // built-in table rather than after.
    // A Python reference may be written as a call or a subscript, as in `shutil.which("tmux")` or
    // `sys.path[0]`. CPython documents the name before it, so that is what the inventory is asked,
    // when that name is itself dotted. A bare call such as `run(self.x)` names a function of the
    // reader's own, and a dotted argument does not make it CPython's.
    const stdlib = this.lang === 'py' ? pythonCallee(clean) : clean
    for (const inv of this.external) {
      if (inv.langs && (!this.lang || !inv.langs.includes(this.lang))) continue
      if (inv.project === 'Java SE' && NOT_THE_JDKS[this.lang ?? '']?.has(clean)) continue
      // A call with no arguments is not an overload that takes some: it has the entry written with its
      // parentheses, or the plain name when that entry's anchor lists no parameters.
      const entry = (name: string) => {
        const exact = nullary ? inv.byName.get(`${name}()`) : undefined
        if (exact) return exact
        const plain = inv.byName.get(name)
        return plain && !(nullary && /\([^)]/.test(plain.uri.split('#')[1] ?? '')) ? plain : undefined
      }
      const hit = entry(stdlib) ?? context?.namespaceImports?.toReversed()
        .map((namespace) => entry(`${namespace}.${clean}`)).find(Boolean) ??
        (this.lang === 'julia' && !clean.includes('.')
          ? entry(`Core.${clean}`) ?? entry(`Base.${clean}`) : undefined)
      if (hit) return {
        href: inv.baseUrl === '/' && hit.uri.startsWith('/') ? hit.uri : inv.baseUrl + hit.uri,
        external: true,
        project: inv.project,
      }
    }

    if (builtin) return { href: builtin, external: true }

    // Everything below is CPython's, and applies to CPython only. `time`,
    // `os` and `io` are Python stdlib module names *and* Go package names;
    // without this guard the Go reference linked `time.Time` to Python's
    // `time` module.
    if (this.lang !== 'py') return undefined

    const last = clean.split('.').pop() ?? clean
    const std = PY_INTERSPHINX[last]
    if (std) return { href: `${PY_DOCS}${std}`, external: true, project: 'Python' }
    if (PY_EXCEPTIONS.has(last)) {
      return { href: `${PY_DOCS}builtins/exceptions.html#${last}`, external: true, project: 'Python' }
    }
    // A module is a page CPython documents under its own name. A member of one
    // is only a link when the inventory above lists it: a guessed fragment lands
    // on the module's page at an anchor that may not exist, as `re.error` did.
    const [head, ...rest] = clean.split('.')
    if (!rest.length && PY_STDLIB_MODULES.has(head)) {
      return { href: `${PY_DOCS}library/${head}.html`, external: true, project: 'Python' }
    }

    return undefined
  }

  /** The module a declaration belongs to: itself, or its parent. */
  private elixirOwner(context?: ApiSymbol): ApiSymbol | undefined {
    return context?.parent ? this.byDeclared.get(context.parent) : context
  }

  /**
   * A module as Elixir's aliases write it. `Server` inside `LibTmux.Foo` is
   * `LibTmux.Server`: the full name first, then the enclosing namespaces of the
   * referring module from the innermost out, then the one module a suffix names.
   */
  private elixirModule(path: string, context?: ApiSymbol): ApiSymbol | undefined {
    const isModule = (symbol?: ApiSymbol) => symbol && ['module', 'struct', 'exception', 'interface'].includes(symbol.kind) ? symbol : undefined
    const exact = isModule(this.byPublic.get(path))
    if (exact) return exact
    const segments = (this.elixirOwner(context)?.id ?? '').split('.')
    for (let length = segments.length - 1; length > 0; length--) {
      const hit = isModule(this.byPublic.get(`${segments.slice(0, length).join('.')}.${path}`))
      if (hit) return hit
    }
    const suffixed = (this.bySuffix.get(path) ?? []).filter((symbol) => isModule(symbol))
    return suffixed.length === 1 ? suffixed[0] : undefined
  }

  /** The operand count of a call or remote type that opens at the start of `rest`. */
  private static elixirArity(rest: string): number | undefined {
    const open = /^\s*\(/.exec(rest)
    if (!open) return undefined
    const closing = closingBracket(rest, open[0].length - 1)
    if (closing < 0) return undefined
    const operands = rest.slice(open[0].length, closing)
    return operands.trim() ? splitTopLevel(operands, ',').length : 0
  }

  /**
   * An ExDoc reference: `Mod`, `Mod.fun/2`, `fun/2`, `t:Mod.type/0`, `c:callback/1`.
   *
   * `fun/2` and `t:type/0` belong to the module being documented. A module
   * that is not ours but is the standard library's links to its own page; the
   * rest stays plain, because a guess would send a reader somewhere else.
   */
  private resolveElixir(target: string, context?: ApiSymbol): LinkTarget | undefined {
    const parts = /^(?:([tc]):)?([^\s/]+?)(?:\/(\d+))?$/.exec(target.trim().replace(/\(\)$/, ''))
    if (!parts) return undefined
    const [, kind, body, arity] = parts as unknown as [string, 't' | 'c' | undefined, string, string | undefined]
    const link = (symbol: ApiSymbol): LinkTarget => ({ href: this.hrefFor(symbol), external: false, symbol })
    const segments = body.split('.')
    const last = segments.at(-1)!
    const named = /^[a-z_]/.test(last)
    const modulePath = named ? segments.slice(0, -1).join('.') : body
    const owner = modulePath ? this.elixirModule(modulePath, context) : this.elixirOwner(context)
    if (!named) return owner && !kind && !arity ? link(owner) : undefined
    if (!owner) {
      const head = modulePath.split('.')[0]!
      if (!modulePath || !ELIXIR_STDLIB_MODULES.has(head) || this.elixirModule(head, context)) return undefined
      return { href: elixirStdlibHref(modulePath, last, arity === undefined ? undefined : Number(arity), kind), external: true, project: 'Elixir' }
    }
    const wanted = (this.elixirMembers.get(owner.id) ?? []).filter((member) => {
      const [, memberName, memberArity] = /^(.*?)(?:\/(\d+))?$/.exec(member.name)!
      return memberName === last && (arity === undefined || memberArity === arity) &&
        (kind === 't' ? member.kind === 'typealias' : kind === 'c' ? member.kind === 'method' : true)
    })
    // A name shared by a type and a function means the function, unless the reference says `t:`.
    const callable = wanted.filter((member) => member.kind !== 'typealias')
    const hits = kind || !callable.length ? wanted : callable
    return hits.length === 1 ? link(hits[0]!) : undefined
  }

  /**
   * A YARD target: `Class`, `Class#m`, `Class.m` or `#m`.
   *
   * A constant is looked up the way Ruby looks one up, from the namespace of
   * the documented class outward, so `Selection` written inside
   * `LibTmux::Server` reaches `LibTmux::Selection`. `#` names an instance
   * method and `.` a singleton one, and neither stands in for the other. A
   * bare `#m` belongs to the class being documented. Only the class is
   * searched for outward; once it is found, a missing member ends the lookup.
   */
  private resolveYard(target: string, context?: ApiSymbol): LinkTarget | undefined {
    const parts = /^(::)?([A-Z]\w*(?:::[A-Z]\w*)*)?(?:([#.])([A-Za-z_]\w*[?!=]?))?$/.exec(target)
    if (!parts || (!parts[2] && parts[3] !== '#')) return undefined
    const [, absolute, path, separator, member] = parts
    const classOf = (symbol: ApiSymbol) =>
      ['class', 'module'].includes(symbol.kind) ? symbol : this.byDeclared.get(symbol.parent ?? '')
    const within = context && classOf(context)
    let owner: ApiSymbol | undefined
    if (path) {
      const namespaces = (within?.publicId ?? within?.id ?? '').split('::').filter(Boolean)
      const prefixes = absolute ? [''] : [
        ...namespaces.map((_, i) => `${namespaces.slice(0, namespaces.length - i).join('::')}::`),
        '', ...[...this.rubyRoots].map((root) => `${root}::`),
      ]
      for (const prefix of prefixes) {
        owner = this.byPublic.get(`${prefix}${path}`)
        if (owner) break
      }
    } else {
      owner = within
    }
    const hit = !owner || !separator ? owner : this.byPublic.get(`${owner.publicId ?? owner.id}${separator}${member}`)
    return hit && { href: this.hrefFor(hit), external: false, symbol: hit }
  }

  /** Resolve every ref span in place; unresolved ones become plain text. */
  /**
   * Tokenize and link one run of doc prose, in this index's own language.
   *
   * The tokenizer needs to know whether a bracket is a Go doc link, whether
   * double backticks mean a DocC symbol or a literal, and whether `{@link}`
   * means anything at all. The index is the only object at the call site that
   * knows which port it serves, so asking it is what keeps the caller from
   * having to.
   */
  linkText(text: string, context?: ApiSymbol): (DocSpan & { link?: LinkTarget })[] {
    const spans = this.linkDoc(tokenizeDoc(text, this.lang), context)
    if (this.lang !== 'powershell') return spans
    // Reflected PowerShell help often leaves type and parameter names unmarked.
    // Only promote a plain word when this command's resolver knows its target.
    return spans.flatMap((span) => {
      if (span.kind !== 'text') return [span]
      const linked: (DocSpan & { link?: LinkTarget })[] = []
      let start = 0
      for (const match of span.text.matchAll(/(?<![\w$.-])[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z_]\w*)*(?!\w|\.[A-Za-z_])/g)) {
        const link = this.resolve(match[0], 'any', context)
        if (!link) continue
        if (match.index > start) linked.push({ kind: 'text', text: span.text.slice(start, match.index) })
        linked.push({ kind: 'ref', target: match[0], label: match[0], role: 'any', link })
        start = match.index + match[0].length
      }
      if (start < span.text.length) linked.push({ kind: 'text', text: span.text.slice(start) })
      return linked
    })
  }

  linkDoc(spans: DocSpan[], context?: ApiSymbol): (DocSpan & { link?: LinkTarget })[] {
    return spans.map((span) => {
      if (span.kind !== 'ref') return span
      const link = this.resolve(span.target, span.role, context)
      // A `typeparam` reference that names nothing in scope is a literal, not a lookup of a global.
      return !link && span.role === 'typeparam' ? { kind: 'code' as const, text: span.label } : { ...span, link }
    })
  }

  /**
   * Link the names in a prose code literal.
   *
   * A keyword argument such as `cancel:` or `clients: true` names a parameter
   * of the call being described, not the member elsewhere that shares its
   * name, so it stays plain code. So does a control-mode marker such as `%end`.
   * A variable and the text a program prints stay plain too (`neverLinks`), in
   * `linkType`, which every path calls.
   */
  linkLiteral(text: string, context?: ApiSymbol): TypeSpan[] {
    if (keywordArgument.test(text) || controlMarker.test(text)) return [{ text }]
    return this.plainArguments(this.linkPaths(this.linkType(text, context), context))
  }

  /**
   * A path that names nothing whole links its longest prefix that names a type: `TmuxText::from` links
   * `TmuxText` when the trait method is not a member of its own. Only a type: a variable's name could match
   * an unrelated field.
   */
  private linkPaths(spans: TypeSpan[], context?: ApiSymbol): TypeSpan[] {
    const separator = this.lang === 'rs' || this.lang === 'cxx' ? '::' : '.'
    return spans.flatMap((span) => {
      if (span.link || !span.text.includes(separator) || !/^[A-Za-z_$][\w$]*(?:[.:]+[A-Za-z_$][\w$]*)+$/.test(span.text)) return [span]
      const segments = span.text.split(separator)
      for (let n = segments.length - 1; n > 0; n--) {
        const head = segments.slice(0, n).join(separator)
        const linked = this.linkType(head, context)
        if (linked.length === 1 && linked[0]!.link?.symbol && TYPE_KINDS.has(linked[0]!.link.symbol.kind)) {
          return [linked[0]!, { text: span.text.slice(head.length) }]
        }
      }
      return [span]
    })
  }

  /**
   * A bare name inside a call's parentheses is the caller's own value, not a reference to a member of another
   * type that shares its name: `value` in `TmuxText::from(value)` is no field. A type, a builtin and a
   * qualified name (`pane::index`, `.active().isTrue()`) keep their links.
   */
  private plainArguments(spans: TypeSpan[]): TypeSpan[] {
    let depth = 0
    let before = ''
    return spans.map((span) => {
      const symbol = span.link?.symbol
      const value = depth > 0 && symbol && !TYPE_KINDS.has(symbol.kind) && !/[.:#/]/.test(span.text) && !/[.:#/>]$/.test(before.trimEnd())
      if (!/^["'/]./.test(span.text)) for (const char of span.text) depth = Math.max(0, depth + (char === '(' ? 1 : char === ')' ? -1 : 0))
      before += span.text
      return value ? { text: span.text } : span
    })
  }

  /**
   * One run of doc prose as the page renders it: the spans `linkText` finds, and for a reference that
   * resolves nowhere, the linked parts of its literal. `ApiDoc` renders these spans and the link verifier
   * reads its destinations from them, so both see the same links.
   */
  docSpans(text: string, context?: ApiSymbol): (DocSpan & { link?: LinkTarget; parts?: TypeSpan[] })[] {
    return this.linkText(text, context).map((span) => (span.kind === 'ref' && !span.link ? { ...span, parts: this.linkLiteral(span.label, context) } : span))
  }

  /**
   * One name in an Elixir declaration or typespec.
   *
   * Atoms (`:ok`) and keyword keys (`cwd:`) are values, an attribute word
   * after `@` is syntax, and the declared function and its parameters are
   * declarations. What is left is a module, or a type written as a call:
   * `LibTmux.Snapshot.t()` is the type `t/0` of that module and `t()` is the
   * current module's own. Their operands decide the arity.
   */
  private elixirType(ident: string, annotation: string, at: number, context?: ApiSymbol, signature?: Signature): TypeSpan[] {
    const before = annotation.slice(0, at)
    const after = annotation.slice(at + ident.length)
    if (/^\d/.test(ident) || /(?:^|[^:]):$/.test(before) || /^:(?!:)/.test(after)) return [{ text: ident, nonReference: true }]
    if (SIGNATURE_KEYWORDS.elixir!.has(ident) && (before.endsWith('@') || ident === 'when')) return [{ text: ident, keyword: true }]
    const lineStart = before.slice(before.lastIndexOf('\n') + 1)
    const parameter = signature?.params.find((param) => param.name === ident)
    if (context && signature && ident === context.name.replace(/\/\d+$/, '') && /^\s*(?:@\w+\s+)?$/.test(lineStart)) {
      return [{ text: ident, declaration: true }]
    }
    if (parameter && context && /^\s*(?:\\\\|::|,|\))/.test(after) && (/[(,]\s*$/.test(before) || /^\s*::/.test(after))) {
      return [{ text: ident, declaration: true, link: {
        href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, ident))}`, external: false,
      } }]
    }
    const arity = SymbolIndex.elixirArity(after)
    const dot = ident.lastIndexOf('.')
    let hit: ApiSymbol | undefined
    if (/^[A-Z]/.test(ident) && arity === undefined) hit = this.elixirModule(ident, context)
    else if (arity !== undefined) {
      const owner = dot < 0 ? this.elixirOwner(context) : this.elixirModule(ident.slice(0, dot), context)
      hit = (this.elixirMembers.get(owner?.id ?? '') ?? []).find((member) => member.name === `${ident.slice(dot + 1)}/${arity}`)
    }
    if (hit) return [{ text: ident, link: { href: this.hrefFor(hit), external: false, symbol: hit } }]
    const builtin = builtinHref('elixir', ident)
    return [{ text: ident, ...(builtin ? { link: { href: builtin, external: true } } : {}) }]
  }

  /**
   * Split a type annotation into linked and literal spans.
   *
   * A tokenizer, not a regex substitution: `list[Window]` must link `Window`
   * and leave the brackets alone, `t.Literal["-"]` must not link the string,
   * and `dict[str, Pane]` has two linkable names and a separator. Splitting on
   * identifier boundaries and passing everything else through verbatim is what
   * makes those all work without a grammar for type syntax.
   */
  linkType(annotation: string, context?: ApiSymbol, signature?: Signature): TypeSpan[] {
    if (neverLinks(annotation)) return [{ text: annotation }]
    const out: TypeSpan[] = []
    const rustPayload = this.lang === 'rs' && (context?.variant || (context?.parent && this.byDeclared.get(context.parent)?.variant))
    const variantDelimiters: string[] = []
    // Names a TypeScript type binds inside its own text: `[Key in Keys]` and `infer Item`.
    const innerBound = new Set<string>()
    if (this.lang === 'ts') {
      for (const bound of annotation.matchAll(/\[\s*([A-Za-z_$][\w$]*)\s+in\s|\binfer\s+([A-Za-z_$][\w$]*)/g)) innerBound.add(bound[1] ?? bound[2]!)
    }
    // A bound name never takes a same-named global type's URL; it links to its declaration instead.
    const bindings = this.typeParameterBindings(context, signature)
    // Identifiers, including dotted ones; everything else is punctuation,
    // whitespace or a string literal and passes through untouched.
    // `::` is part of a name, not punctuation between two. Splitting there
    // turned `std::vector` into `std` and `vector`, so neither half matched
    // anything and C++ annotations rendered almost entirely plain.
    const identifier = this.lang === 'julia'
      ? String.raw`[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*!?`
      // A number is matched whole, so `1_000` is not a literal followed by a name.
      : this.lang === 'elixir' ? String.raw`\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*[!?]?`
      : this.lang === 'powershell' ? String.raw`(?:[A-Za-z_][A-Za-z0-9_.]*\\)?[A-Za-z_][A-Za-z0-9_.-]*`
      : this.lang === 'ts' ? String.raw`[A-Za-z_$][A-Za-z0-9_$.]*`
      : this.lang === 'rs' ? String.raw`(?:r#)?[A-Za-z_][A-Za-z0-9_.]*(?:::(?:r#)?[A-Za-z_][A-Za-z0-9_.]*)*`
      : String.raw`[A-Za-z_][A-Za-z0-9_.]*(?:::[A-Za-z_][A-Za-z0-9_.]*)*`
    // C++ prefixes, escaped quotes, raw delimiters and suffixes belong to the
    // literal token. Its contents cannot introduce an attribute or type link.
    const cppLiteral = String.raw`(?:(?:u8|u|U|L)?R"(?<delimiter>[^ ()\\\t\v\f\r\n]{0,16})\([\s\S]*?\)\k<delimiter>"|(?:u8|u|U|L)?(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'))(?:[A-Za-z_]\w*)?`
    const initial = this.lang === 'ts' ? 'A-Za-z_$' : this.lang === 'elixir' ? 'A-Za-z_0-9' : 'A-Za-z_'
    const pattern = String.raw`(?<ident>\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|${identifier})|(?<other>[^${initial}"'/]+|["'/])`
    // F# type variables start with an apostrophe but do not close like strings.
    const re = new RegExp(this.lang === 'cxx'
      ? String.raw`(?<literal>${cppLiteral}|\d(?:[eEpP][+-]|[\w.'])*)|(?<ident>\/\*[\s\S]*?\*\/|\/\/[^\n]*|${identifier})|(?<other>[^A-Za-z_0-9"'/]+|["'/])`
      : this.lang === 'fsharp' ? pattern.replace('(?<ident>', String.raw`(?<ident>'[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_'])|`)
      : pattern, 'g')
    for (const m of annotation.matchAll(re)) {
      const whole = m[0]
      const { ident, other } = m.groups!
      if (other !== undefined || !ident) {
        if (rustPayload && context?.variant && signature) {
          for (const delimiter of whole.match(/->|=>|[{}()[\]<>]/g) ?? []) {
            if ('{[(<'.includes(delimiter)) variantDelimiters.push(delimiter)
            else if (variantDelimiters.length && '}])>'.indexOf(delimiter) === '{[(<'.indexOf(variantDelimiters.at(-1)!)) variantDelimiters.pop()
          }
        }
        out.push({ text: whole })
        continue
      }
      if (/^(?:["']|\/[/*])/.test(ident)) {
        out.push({ text: ident })
        continue
      }
      if (this.lang === 'rs' && context?.variant && signature) {
        if (ident === context.name && annotation.slice(0, m.index).trim() === '') {
          out.push({ text: ident, declaration: true })
          continue
        }
        if (context.variant === 'struct' && /^\s*:(?!:)/.test(annotation.slice(m.index! + ident.length))) {
          const field = this.byDeclared.get(`${context.id}.${ident}`)
          if (variantDelimiters.length === 1 && variantDelimiters[0] === '{' && field?.parent === context.id) {
            out.push({ text: ident, declaration: true, link: { href: this.hrefFor(field), external: false, symbol: field } })
            continue
          }
        }
      }
      if (rustPayload && /^\s*:(?!:)/.test(annotation.slice(m.index! + ident.length))) {
        out.push({ text: ident, declaration: true })
        continue
      }
      // A locally bound type parameter must not acquire an unrelated global type's URL.
      if (this.lang === 'rs' && annotation[m.index! - 1] === "'") {
        out.push({ text: ident })
        continue
      }
      if (this.lang === 'ts') {
        const before = annotation.slice(0, m.index)
        const after = annotation.slice(m.index! + ident.length)
        // Type predicates, mapped types and assertions: syntax, unless a field is called `is` or `in`.
        if (/^(?:is|in|as|asserts)$/.test(ident) && !/^\s*\??\s*:/.test(after)) {
          out.push({ text: ident, keyword: true })
          continue
        }
        if ((innerBound.has(ident) && !before.endsWith('.')) || /^\s+is\s/.test(after)) {
          out.push({ text: ident, declaration: true })
          continue
        }
        if (/^(?:true|false)$/.test(ident) && !/^\s*\??\s*:/.test(after)) {
          out.push({ text: ident, nonReference: true })
          continue
        }
        // A method signature in an object type, `{ execute(request: Request): Result }`, names its member.
        if (/^\s*\??\s*[(<]/.test(after) && /(?:^|[{;,])(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*(?:readonly\s+)?$/.test(before) && /\{/.test(before)) {
          out.push({ text: ident, declaration: true })
          continue
        }
        // A computed key, `readonly [brand]: Kind`, names the member it declares.
        if (/^\s*\]\s*\??\s*:(?!:)/.test(after) &&
            /(?:^|[{;,])(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*(?:readonly\s+)?\[\s*$/.test(before)) {
          out.push({ text: ident, declaration: true })
          continue
        }
      }
      const bound = declaresValue(annotation.slice(0, m.index), annotation.slice(m.index! + ident.length))
        ? undefined : this.boundSpans(ident, bindings)
      if (bound) {
        out.push(...bound)
        continue
      }
      if (this.lang === 'elixir') {
        out.push(...this.elixirType(ident, annotation, m.index!, context, signature))
        continue
      }
      if (this.lang === 'cxx' && ident === 'nodiscard' &&
          /\[\[\s*$/.test(annotation.slice(0, m.index)) &&
          /^\s*(?:\]\]|\(|,)/.test(annotation.slice(m.index! + ident.length))) {
        out.push({ text: ident, keyword: true, help: KEYWORD_HELP.cxx.nodiscard })
        continue
      }
      if (this.lang === 'powershell' && signature && context) {
        if (ident === context.name || ident === context.publicId) {
          out.push({ text: ident, declaration: true })
          continue
        }
        const parameter = annotation[m.index! - 1] === '-' && signature.params.find((param) => param.name === ident)
        if (parameter) {
          out.push({ text: ident, declaration: true, link: {
            href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, parameter.name))}`, external: false,
          } })
          continue
        }
      }
      if (this.lang === 'cxx' && signature && context) {
        if (ident === context.name && /^\s*\(/.test(annotation.slice(m.index! + ident.length))) {
          out.push({ text: ident, declaration: true })
          continue
        }
        if (signature.params.some((param) => param.name === ident) && /^\s*(?:[,)=]|\[)/.test(annotation.slice(m.index! + ident.length))) {
          out.push({ text: ident, declaration: true, link: {
            href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, ident))}`, external: false,
          } })
          continue
        }
      }
      if (this.lang === 'ts' && signature && context && ident === context.name &&
          /^(?:(?:private|static|async)\s+)*(?:function\s*)?\*?\s*$/.test(annotation.slice(0, m.index)) &&
          /^\s*[<(]/.test(annotation.slice(m.index! + ident.length))) {
        out.push({ text: ident, declaration: true })
        continue
      }
      // Julia's :session is a Symbol value, not the session function. A
      // Type assertions and subtype/supertype bounds must still link types.
      if (this.lang === 'julia' && /(?:^|[^:<>]):$/.test(annotation.slice(0, m.index))) {
        out.push({ text: ident })
        continue
      }
      // A declaration's bindings are not references to other APIs. Keep this
      // separate from prose resolution, where an explicit parameter reference
      // can still point to that parameter's documentation.
      if (SIGNATURE_KEYWORDS[this.lang ?? '']?.has(ident)) {
        const languageHelp = KEYWORD_HELP[this.lang ?? ''] ?? {}
        const help = Object.hasOwn(languageHelp, ident) ? languageHelp[ident] : undefined
        out.push({ text: ident, keyword: true, ...(help ? { help } : {}) })
        continue
      }
      if (signature && context && (ident === context.name || ident.endsWith(`.${context.name}`)) &&
          (/\b(?:def|fun|class|interface|trait|object|type|val|var|member|let)\s+$/.test(annotation.slice(0, m.index)) ||
            (this.lang === 'julia' && annotation.slice(0, m.index).trim() === '' && /^[{(]/.test(annotation.slice(m.index! + ident.length))))) {
        const receiver = ident.slice(0, -context.name.length).replace(/\.$/, '')
        if (receiver) out.push(...this.linkType(receiver, context), { text: '.' })
        out.push({ text: context.name, declaration: true })
        continue
      }
      if (signature && (signature.params.some((param) => param.name === ident) || signature.receiver?.name === ident) &&
          (/^\s*\??\s*:(?!:)/.test(annotation.slice(m.index! + ident.length)) ||
            (this.lang === 'julia' && /(?:^|[(,;])\s*$/.test(annotation.slice(0, m.index)) &&
              /^\s*(?:::|[=,;)]|\.\.\.)/.test(annotation.slice(m.index! + ident.length))))) {
        const parameter = this.lang === 'julia' && context && signature.params.some((param) => param.name === ident)
        out.push({ text: ident, declaration: true, ...(parameter ? { link: {
          href: `${this.hrefFor(context).split('#')[0]}#${encodeURIComponent(parameterId(context, ident))}`, external: false,
        } } : {}) })
        continue
      }
      // Object fields, callback parameters and tuple labels declare names;
      // the types after their colons still use ordinary reference resolution.
      if (this.lang === 'ts' && /^\s*\??\s*:(?!:)/.test(annotation.slice(m.index! + ident.length)) &&
          /(?:^|[{[(;,])(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*)*(?:readonly\s+)?(?:\.\.\.)?$/.test(annotation.slice(0, m.index))) {
        out.push({ text: ident, declaration: true })
        continue
      }
      // The model first, then the language's own documentation. Most of what
      // renders unlinked in a signature is a builtin — `bool`, `Task`,
      // `Result`, `string` — which nothing here defines and no intersphinx
      // inventory covers for five of the eight ports.
      const link = this.resolveSymbol(ident, 'class', context)
      if (link || !['kotlin', 'scala'].includes(this.lang ?? '') || !ident.includes('.')) {
        out.push({ text: ident, link })
        continue
      }
      let previous: LinkTarget | undefined
      const parts = ident.split('.')
      for (const [position, part] of parts.entries()) {
        if (position > 0) out.push({ text: '.' })
        // Follow only an explicit declared return type. Imported extension
        // functions can resolve independently after a call's parentheses.
        const returns = previous?.symbol?.signatures[0]?.returns
        const member = returns ? this.resolveSymbol(`${returns}.${part}`, 'any', previous?.symbol) : undefined
        const resolved = member ?? (position === 0 ? this.resolveSymbol(part, 'any', context) : undefined)
        out.push({ text: part, link: resolved })
        previous = resolved
      }
    }
    return out
  }
}
