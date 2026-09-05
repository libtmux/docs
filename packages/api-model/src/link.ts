import { tokenizeDoc, type DocSpan } from './doc/roles.ts'
import type { InventoryEntry } from './inventory.ts'
import type { ApiSymbol, SymbolKind } from './model.ts'
import { builtinHref } from './builtins.ts'

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
  class: ['class', 'exception', 'enum', 'struct', 'interface'],
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
  int: 'library/functions.html#int',
  str: 'library/stdtypes.html#str',
  bool: 'library/functions.html#bool',
  float: 'library/functions.html#float',
  bytes: 'library/stdtypes.html#bytes',
  list: 'library/stdtypes.html#list',
  dict: 'library/stdtypes.html#dict',
  set: 'library/stdtypes.html#set',
  tuple: 'library/stdtypes.html#tuple',
  None: 'library/constants.html#None',
  object: 'library/functions.html#object',
  Exception: 'library/exceptions.html#Exception',
  type: 'library/functions.html#type',
  Any: 'library/typing.html#typing.Any',
  Literal: 'library/typing.html#typing.Literal',
  Optional: 'library/typing.html#typing.Optional',
  Union: 'library/typing.html#typing.Union',
  Callable: 'library/typing.html#typing.Callable',
  Iterator: 'library/typing.html#typing.Iterator',
  Sequence: 'library/typing.html#typing.Sequence',
  Mapping: 'library/typing.html#typing.Mapping',
  Path: 'library/pathlib.html#pathlib.Path',
}

const PY_DOCS = 'https://docs.python.org/3/'

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
  // Keyed by declaration id. `parent` is a declaration id, so looking an owner
  // up in byPublic silently misses every time — which is why relative
  // references stayed at 0% until this map existed.
  private readonly byDeclared = new Map<string, ApiSymbol>()
  private readonly bySuffix = new Map<string, ApiSymbol[]>()
  private readonly byName = new Map<string, ApiSymbol[]>()

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

      const parts = pub.split('.')
      for (let i = 1; i < parts.length; i++) {
        const suffix = parts.slice(i).join('.')
        const list = this.bySuffix.get(suffix) ?? []
        list.push(s)
        this.bySuffix.set(suffix, list)
      }
      const list = this.byName.get(s.name) ?? []
      list.push(s)
      this.byName.set(s.name, list)
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
    if (kind === 'class' || kind === 'exception' || kind === 'struct' || kind === 'interface') {
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
    for (const entry of entries) if (!byName.has(entry.name)) byName.set(entry.name, entry)
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
   * unrelated — Rust's `Error` resolves to three types under `error.`, none of
   * them near the `session.` page asking, and it stays plain, which is right.
   */
  private static nearest(candidates: ApiSymbol[], context?: ApiSymbol): ApiSymbol | undefined {
    if (!context || candidates.length === 0) return undefined
    const from = (context.publicId ?? context.id).split('.')
    const shared = (c: ApiSymbol) => {
      const id = (c.publicId ?? c.id).split('.')
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
    const relative = target.startsWith('.')
    const clean = target.replace(/^[~.]/, '').replace(/\(\)$/, '')

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
      for (const scope of scopes) {
        const hit = this.byPublic.get(`${scope}.${clean}`)
        if (hit) return { href: this.hrefFor(hit), external: false, symbol: hit }
      }
      // A relative reference must not fall through to a global bare-name
      // match: `.panes` written in Session means Session's, or nothing.
      if (relative && !clean.includes('.')) return undefined
    }

    const exact = this.byPublic.get(clean)
    if (exact) return { href: this.hrefFor(exact), external: false, symbol: exact }

    const bySuffix = this.pick(this.bySuffix.get(clean), role, context)
    if (bySuffix) return { href: this.hrefFor(bySuffix), external: false, symbol: bySuffix }

    if (!clean.includes('.')) {
      const byName = this.pick(this.byName.get(clean), role, context)
      if (byName) return { href: this.hrefFor(byName), external: false, symbol: byName }
    }

    // Intersphinx order: exact name, then the shortest suffix. An inventory
    // is authoritative for its own project, so it is consulted before the
    // built-in table rather than after.
    for (const inv of this.external) {
      if (inv.langs && (!this.lang || !inv.langs.includes(this.lang))) continue
      const hit = inv.byName.get(clean) ?? inv.byName.get(`${clean}`)
      if (hit) return { href: inv.baseUrl + hit.uri, external: true, project: inv.project }
    }

    // Everything below is CPython's, and applies to CPython only. `time`,
    // `os` and `io` are Python stdlib module names *and* Go package names;
    // without this guard the Go reference linked `time.Time` to Python's
    // `time` module.
    if (this.lang !== 'py') return undefined

    const last = clean.split('.').pop() ?? clean
    const std = PY_INTERSPHINX[last]
    if (std) return { href: `${PY_DOCS}${std}`, external: true, project: 'Python' }
    if (PY_EXCEPTIONS.has(last)) {
      return { href: `${PY_DOCS}library/exceptions.html#${last}`, external: true, project: 'Python' }
    }
    const [head, ...rest] = clean.split('.')
    if (rest.length && PY_STDLIB_MODULES.has(head)) {
      return { href: `${PY_DOCS}library/${head}.html#${clean}`, external: true, project: 'Python' }
    }
    if (!rest.length && PY_STDLIB_MODULES.has(head)) {
      return { href: `${PY_DOCS}library/${head}.html`, external: true, project: 'Python' }
    }

    return undefined
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
    return this.linkDoc(tokenizeDoc(text, this.lang), context)
  }

  linkDoc(spans: DocSpan[], context?: ApiSymbol): (DocSpan & { link?: LinkTarget })[] {
    return spans.map((span) =>
      span.kind === 'ref'
        ? { ...span, link: this.resolve(span.target, span.role, context) }
        : span,
    )
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
  linkType(annotation: string, context?: ApiSymbol): { text: string; link?: LinkTarget }[] {
    const out: { text: string; link?: LinkTarget }[] = []
    // Identifiers, including dotted ones; everything else is punctuation,
    // whitespace or a string literal and passes through untouched.
    // `::` is part of a name, not punctuation between two. Splitting there
    // turned `std::vector` into `std` and `vector`, so neither half matched
    // anything and C++ annotations rendered almost entirely plain.
    const re = /(["'][^"']*["']|[A-Za-z_][A-Za-z0-9_.]*(?:::[A-Za-z_][A-Za-z0-9_.]*)*)|([^A-Za-z_"']+)/g
    for (const m of annotation.matchAll(re)) {
      const [whole, ident, other] = m
      if (other !== undefined || !ident) {
        out.push({ text: whole })
        continue
      }
      if (/^["']/.test(ident)) {
        out.push({ text: ident })
        continue
      }
      // The model first, then the language's own documentation. Most of what
      // renders unlinked in a signature is a builtin — `bool`, `Task`,
      // `Result`, `string` — which nothing here defines and no intersphinx
      // inventory covers for five of the eight ports.
      const link =
        this.resolve(ident, 'class', context) ??
        (this.lang
          ? (() => {
              const href = builtinHref(this.lang, ident)
              return href ? { href, external: true } : undefined
            })()
          : undefined)
      out.push({ text: ident, link })
    }
    return out
  }
}
