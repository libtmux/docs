import type { ApiSymbol, SymbolKind } from './model.ts'

/**
 * What belongs where in a port's reference sidebar.
 *
 * The sidebar was every type in the module, alphabetical, which is unreadable
 * once a port puts its whole API in one package — Go has 213 of its 221 types
 * in `tmux`, so `Server` sits in the same run as `BindKeyRequest`. Grouping by
 * package fixes Rust and .NET and does nothing for Go, and deriving the domain
 * from names reaches 62% with ambiguity (`CapturePaneRequest` is both Capture
 * and Pane). Neither is enough on its own.
 *
 * So: patterns demote, curation ranks. A person writes the bucket labels and
 * their order — tmux's own object hierarchy — and rules place the machinery
 * beneath them.
 *
 * Data, not functions. Starlight and Docusaurus both autogenerate from
 * directories, which this has none of, and Docusaurus's escape hatch is a
 * user-supplied function — maximally extensible and impossible to lint. Every
 * rule here is a value, so `scripts/check-nav.mjs` can report a symbol nothing
 * matched, a rule that matches nothing, and a symbol two rules claim.
 */

/** One predicate over a symbol. Discriminated so a typo is a type error. */
export type Match =
  /** Exactly this public id. The escape hatch for a single stubborn symbol. */
  | { kind: 'id'; is: string | string[] }
  /** The module or namespace it is declared in. */
  | { kind: 'module'; is?: string | string[]; re?: string }
  /** Its own name, by prefix, suffix, or pattern. */
  | { kind: 'name'; prefix?: string; suffix?: string; re?: string }
  /** What sort of declaration it is. */
  | { kind: 'symbol'; kinds: SymbolKind[] }
  /**
   * The source file the symbol is declared in.
   *
   * The honest grouping signal where names are not one. Java, C++ and Swift
   * put every type at the root of a bare namespace, so `module` is empty and
   * useless for them; the repository still has directories. Rust's
   * `Wire*`/`*Visitor` family reads as versioning and serialisation by name
   * and sits entirely under `query/` on disk, which is what it actually is.
   */
  | { kind: 'path'; re: string }
  /** A cross-language operation from concepts.ts, so the two stay in step. */
  | { kind: 'concept'; id: string | string[] }
  | { kind: 'anyOf'; of: Match[] }
  | { kind: 'allOf'; of: Match[] }
  | { kind: 'not'; of: Match }

/** A section of the sidebar. Buckets nest, and order is the author's. */
export interface Bucket {
  /** Stable across recuration: the lint reports by this, not by label. */
  id: string
  label: string
  match: Match
  /** Rendered closed. Machinery should be; the domain should not. */
  collapsed?: boolean
  children?: Bucket[]
}

export interface PortNav {
  port: string
  buckets: Bucket[]
  /**
   * Deliberately unplaced, with the reason.
   *
   * Named rather than counted, so a new one fails the lint and an old one can
   * be argued with. Same shape as prose-link-exceptions.json, which has held.
   */
  unsettled?: Record<string, string>
}

/** A symbol's place, once the rules have run. */
export interface NavAssignment {
  /** Bucket ids from the root down. Empty when nothing matched. */
  path: string[]
}

export interface NavDiagnostics {
  /** Matched no bucket and is not in `unsettled`. */
  unmatched: string[]
  /** Buckets whose rule matched nothing — usually a renamed type. */
  deadBuckets: string[]
  /** Claimed by more than one bucket, so the order decides silently. */
  ambiguous: { id: string; buckets: string[] }[]
  /** Listed in `unsettled` but now matched — a stale exemption. */
  staleUnsettled: string[]
}

export interface CompiledNav {
  port: string
  /** Bucket id to the symbols in it, in the order the buckets declare. */
  assignments: Record<string, string[]>
  /**
   * Symbols no bucket claimed, exempt or not.
   *
   * Separate from `diagnostics.unmatched`, which omits the exempt ones: an
   * `unsettled` entry is excused from failing the lint, not excused from
   * being reachable. Anything in neither `assignments` nor here renders
   * nowhere, and a symbol with a page and no way to reach it is worse than
   * an ugly sidebar.
   */
  unplaced: string[]
  diagnostics: NavDiagnostics
}

/**
 * A predicate compiled once.
 *
 * Regexes are built here rather than per symbol: a full pass over every symbol
 * in the estate against thirty rules costs about six milliseconds, and only
 * because nothing is recompiled inside the loop.
 */
type Predicate = (symbol: ApiSymbol, ctx: MatchContext) => boolean

export interface MatchContext {
  /** Public ids implementing each concept in this port, from concepts.ts. */
  conceptIds: Record<string, string>
  /** The module a symbol is declared in, precomputed. */
  moduleOf: (symbol: ApiSymbol) => string
}

/** Repository-relative path of the declaration, or '' when unknown. */
const pathOf = (s: ApiSymbol): string => s.source?.file ?? ''

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v])

export function compileMatch(match: Match): Predicate {
  switch (match.kind) {
    case 'id': {
      const ids = new Set(asArray(match.is))
      return (s) => ids.has(s.publicId ?? s.id)
    }
    case 'module': {
      // Symmetric with `name`: an exact set, a regex, or both. .NET declares
      // its plumbing in a namespace called `LibTmux.Internal` and nowhere near
      // a directory or a type name that says so, which no other rule can see.
      const mods = match.is === undefined ? undefined : new Set(asArray(match.is))
      const re = match.re ? new RegExp(match.re) : undefined
      return (s, ctx) => {
        const m = ctx.moduleOf(s)
        return (mods?.has(m) ?? false) || (re?.test(m) ?? false)
      }
    }
    case 'name': {
      const re = match.re ? new RegExp(match.re) : undefined
      return (s) =>
        (match.prefix === undefined || s.name.startsWith(match.prefix)) &&
        (match.suffix === undefined || s.name.endsWith(match.suffix)) &&
        (re === undefined || re.test(s.name)) &&
        (match.prefix !== undefined || match.suffix !== undefined || re !== undefined)
    }
    case 'symbol': {
      const kinds = new Set<string>(match.kinds)
      return (s) => kinds.has(s.kind)
    }
    case 'path': {
      /*
       * Case-insensitive, unlike `name`. Eight repositories spell the same
       * directory `Internal`, `internal` and `_internal`, and a rule that
       * silently matches seven of them is worse than no rule: the eighth
       * fails the lint for a reason that reads as curation rather than as a
       * capital letter. Names are matched case-sensitively because in a type
       * name case is meaning.
       */
      const re = new RegExp(match.re, 'i')
      return (s) => re.test(pathOf(s))
    }
    case 'concept': {
      const wanted = asArray(match.id)
      return (s, ctx) => wanted.some((c) => ctx.conceptIds[c] === (s.publicId ?? s.id))
    }
    case 'anyOf': {
      const ps = match.of.map(compileMatch)
      return (s, ctx) => ps.some((p) => p(s, ctx))
    }
    case 'allOf': {
      const ps = match.of.map(compileMatch)
      return (s, ctx) => ps.every((p) => p(s, ctx))
    }
    case 'not': {
      const p = compileMatch(match.of)
      return (s, ctx) => !p(s, ctx)
    }
  }
}

/** Every bucket in the tree, with the path that reaches it. */
function flatten(buckets: Bucket[], prefix: string[] = []): { bucket: Bucket; path: string[] }[] {
  return buckets.flatMap((b) => {
    const path = [...prefix, b.id]
    return [{ bucket: b, path }, ...flatten(b.children ?? [], path)]
  })
}

/**
 * Place every symbol, and report what the config did not account for.
 *
 * A symbol lands in the first bucket that claims it, depth-first in declared
 * order — but every claim is recorded, so the lint can say when two rules
 * overlap rather than letting declaration order decide in silence.
 */
export function compileNav(nav: PortNav, symbols: ApiSymbol[], ctx: MatchContext): CompiledNav {
  const nodes = flatten(nav.buckets).map((n) => ({ ...n, test: compileMatch(n.bucket.match) }))
  const assignments: Record<string, string[]> = Object.fromEntries(nodes.map((n) => [n.bucket.id, []]))
  const unplaced: string[] = []
  const diagnostics: NavDiagnostics = { unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] }
  const unsettled = nav.unsettled ?? {}

  for (const symbol of symbols) {
    const id = symbol.publicId ?? symbol.id
    const claimed = nodes.filter((n) => n.test(symbol, ctx))

    if (claimed.length === 0) {
      unplaced.push(id)
      if (!(id in unsettled)) diagnostics.unmatched.push(id)
      continue
    }
    if (id in unsettled) diagnostics.staleUnsettled.push(id)
    // A parent and its own child both claiming is nesting working, not
    // ambiguity; two unrelated buckets claiming is the CapturePaneRequest case.
    const roots = claimed.filter((n) => !claimed.some((o) => o !== n && n.path.join('/').startsWith(`${o.path.join('/')}/`)))
    if (roots.length > 1) {
      diagnostics.ambiguous.push({ id, buckets: roots.map((r) => r.bucket.id) })
    }
    // Deepest match wins: a child rule is more specific than its parent's.
    const winner = claimed.reduce((a, b) => (b.path.length > a.path.length ? b : a))
    assignments[winner.bucket.id]!.push(id)
  }

  for (const n of nodes) {
    const own = assignments[n.bucket.id]!.length
    const descendants = flatten(n.bucket.children ?? [], n.path)
    const below = descendants.reduce((sum, d) => sum + (assignments[d.bucket.id]?.length ?? 0), 0)
    if (own + below === 0) diagnostics.deadBuckets.push(n.bucket.id)
  }

  return { port: nav.port, assignments, unplaced, diagnostics }
}
