/**
 * One API model, eight languages.
 *
 * The site renders every port's reference through the same components, so the
 * shape below is the contract those components read. It is deliberately
 * *syntactic*: it records what the source says, not what a type checker would
 * conclude. See `docs/DESIGN.md` for why that boundary is where it is, and for
 * what the renderer does instead of resolution.
 *
 * Modelled on what `gp-sphinx` produces for libtmux-python, because that is the
 * house style the other seven ports are being brought up to — signature line,
 * kind and modifier badges, parameter/return/raises field lists, and a
 * permalink per symbol.
 */

/** The eight ports, by the slug the site already uses. */
export type PortSlug = 'py' | 'ts' | 'rs' | 'go' | 'java' | 'dotnet' | 'cxx' | 'swift'

/**
 * What a symbol *is*.
 *
 * Deliberately smaller than the union of eight languages' concepts. A Rust
 * `impl` block, a Go interface and a C# partial class all have a home here;
 * anything that does not is either dropped or flattened, and the extractor
 * says which in its own comments rather than growing this list. gp-sphinx
 * renders a badge per kind, so a kind that renders identically to another is
 * a kind that should not exist.
 */
export type SymbolKind =
  | 'module'
  | 'class'
  | 'interface'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'function'
  | 'method'
  | 'property'
  | 'attribute'
  | 'constant'
  | 'typealias'
  | 'exception'

/**
 * Orthogonal facts about a symbol, rendered as gp-sphinx modifier badges.
 *
 * `overload` is the one that pays for the whole set: Python's `@t.overload`,
 * TypeScript's declaration merging, C#'s method groups and C++'s overloads all
 * produce several signatures for one name, and a reference that shows only the
 * first is wrong in a way readers do not notice.
 */
export type Modifier =
  | 'static'
  | 'classmethod'
  | 'abstract'
  | 'async'
  | 'readonly'
  | 'deprecated'
  | 'overload'
  | 'private'
  | 'generator'
  | 'unsafe'

/** One parameter, as written. */
export interface Param {
  name: string
  /** Type annotation verbatim from the source, unresolved. */
  type?: string
  /** Default value verbatim, when one is written. */
  default?: string
  /** `*args` / `**kwargs` / variadic / `params` — rendered with its sigil. */
  variadic?: 'positional' | 'keyword'
  /** Doc text for this parameter, from the doc comment's field list. */
  doc?: string
  /** True after a bare `*` in Python, or an equivalent marker elsewhere. */
  keywordOnly?: boolean
  /**
   * `.. versionadded::` and `.. deprecated::` written inside this parameter's
   * own description.
   *
   * A parameter added in 0.56 to a method that has existed for years is
   * exactly what a reader checking compatibility needs, and it is attached to
   * the parameter rather than the method for that reason. 93 of the estate's
   * parameters carry one; before this they rendered as the literal text
   * ".. versionadded:: 0.56" at the end of the description.
   */
  since?: string
  deprecated?: string
}

/** One callable signature. A symbol has several only when it is overloaded. */
export interface Signature {
  params: Param[]
  returns?: string
  returnsDoc?: string
  /** Type parameters / generics, as written: `T`, `T: Clone`, `<T extends X>`. */
  typeParams?: string[]
  /** `throws` / `raises`, as a type and its doc text. */
  raises?: { type: string; doc?: string }[]
}

/** A parsed doc comment, normalized across eight comment dialects. */
export interface DocBlock {
  /** First paragraph. gp-sphinx renders this beside the signature. */
  summary: string
  /** Everything after the summary, still Markdown/MyST. */
  body?: string
  /**
   * Examples, in order, each with the prose that introduces it.
   *
   * One entry per code block rather than one per section: a docstring that
   * shows six things shows them one at a time, with a sentence between —
   * "The server can be used as a context manager to ensure proper cleanup:".
   * Merged into a single block, the sentences render inside the code.
   */
  examples?: { lang: string; code: string; intro?: string }[]
  /**
   * Citations the docstring defines, as `.. [name] text`.
   *
   * Kept because prose refers to them — `[server_manual]_` — and a reference
   * to a citation that was dropped reads as a typo.
   */
  references?: { name: string; text: string }[]
  /** `.. deprecated::`, `@deprecated`, `[Obsolete]`, `@available(*, deprecated)`. */
  deprecated?: string
  /** `.. versionadded::` and friends. */
  since?: string
  /** `See also` targets, as symbol ids to be resolved by the linker. */
  seeAlso?: string[]
  /**
   * `.. note::`, `.. warning::` — directives with no field of their own.
   *
   * Kept rather than dropped, and lifted out of the body rather than left in
   * it: an unrecognised directive rendered as its own literal syntax, so a
   * page showed ".. deprecated:: 0.17" as a line of prose *and* the
   * deprecation notice built from the same directive.
   */
  admonitions?: { kind: string; text: string }[]
  /** `.. versionchanged::`. */
  changed?: string
}

/** One documented symbol. */
export interface ApiSymbol {
  /**
   * Declaration id: where the symbol is actually written,
   * `libtmux.pane.Pane.capture_pane`.
   */
  id: string
  /**
   * The shortest path the symbol can be imported by,
   * `libtmux.Pane.capture_pane` — what people write, what docstring roles
   * reference, and what gp-sphinx anchors. Anchors and cross-links render
   * from this; `id` stays the key.
   */
  publicId?: string
  /** Last path segment: `capture_pane`. */
  name: string
  kind: SymbolKind
  modifiers: Modifier[]
  /** Enclosing symbol's id, or undefined at module level. */
  parent?: string
  signatures: Signature[]
  doc?: DocBlock
  /** Base classes / implemented interfaces, as written. */
  extends?: string[]
  /**
   * The URL segment for this symbol's page, unique within its port.
   *
   * Decided by `gen-api-model.mjs` rather than derived at render time,
   * because `pageSlug` is not injective — it lowercases and strips
   * punctuation, so `libtmux::Client::name` and `libtmux::client::name`
   * collapse together, as do Swift's `!=` and `==` — each pair would
   * otherwise share a page, silently, with Astro keeping the last writer.
   */
  slug?: string
  /**
   * Where it lives, for the "source" link gp-sphinx puts on every entry.
   *
   * `line` is absent when the declaration cannot be located in the commit the
   * link names — see `source-lines.ts`. The link then points at the file,
   * which is honest, rather than at a line that has moved.
   */
  source: { file: string; line?: number }
  /**
   * Set when this symbol reached its parent through a base class rather than
   * being written there.
   *
   * autodoc's `:inherited-members:` renders these identically to declared
   * members, and so does the site — but the model keeps the provenance, so a
   * page can say "inherited from Obj" and the linker can point the permalink
   * at the declaration rather than at the copy.
   */
  inheritedFrom?: string
  /** Type annotation for an attribute or property, as written. */
  type?: string
  /** Value for a constant or a defaulted field, as written. */
  value?: string
}

/** Everything extracted from one port's source tree. */
export interface ApiModel {
  port: PortSlug
  /** Commit the tree was at, so a rendered page can say what it describes. */
  revision?: string
  /** Extractor version, so a stale model is detectable rather than silent. */
  extractor: string
  symbols: ApiSymbol[]
  /**
   * What pruning removed, so a rule that starts eating real API is visible.
   * A count that silently doubles is the failure mode worth catching.
   */
  pruned?: { dropped: number; kept: number; rules: string[] }
}

/** What the extractor should include, mirroring autodoc's own flags. */
export interface ExtractOptions {
  /** `:private-members:` — names with a single leading underscore. */
  privateMembers?: boolean
  /** `:special-members:` — dunders. autodoc takes a list; this is all or none. */
  specialMembers?: boolean
  /** `:inherited-members:` — resolve base classes through the symbol table. */
  inheritedMembers?: boolean
  /** Stop inheriting at these bases, the way autodoc stops at `object`. */
  inheritanceStopList?: string[]
  /**
   * Public-path prefixes to drop entirely.
   *
   * A namespace a consumer cannot import is not API, however public its
   * members are to the compiler: 1,426 of TypeScript's 2,242 symbols live
   * under `_internal`, and a reader browsing the reference met generated
   * graph projections before they met `Pane`.
   *
   * This is deliberately *not* "anything with an underscore". `LibTmux.Testing`
   * is a shipped namespace users call when writing tests, and Python's
   * `_private` members are documented by gp-sphinx and kept for parity with
   * it. The rule names paths, not spellings.
   */
  excludePaths?: RegExp[]
}

export const DEFAULT_EXTRACT_OPTIONS: Required<ExtractOptions> = {
  privateMembers: false,
  specialMembers: false,
  inheritedMembers: true,
  inheritanceStopList: ['object', 'Generic', 'Protocol', 'ABC', 'Enum', 'BaseException'],
  excludePaths: [],
}
