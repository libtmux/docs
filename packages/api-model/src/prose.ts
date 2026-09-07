import type { ApiModel, ApiSymbol } from './model.ts'
import type { Resolver } from './resolver.ts'

/**
 * Whether a code span in prose is a reference to the API, and to what.
 *
 * The linker and the lint both ask this, which is the point: a lint that
 * decides separately from the thing it lints will disagree with it, and the
 * disagreement is what a reader sees. One function, two callers — the same
 * arrangement `pageSlug` already has for the route and the resolver.
 *
 * Nothing here reads a file or a JSON import, so the lint can run it in plain
 * node without Vite.
 */

export const PORT_NAME: Record<string, string> = {
  py: 'Python',
  ts: 'TypeScript',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  dotnet: '.NET',
  cxx: 'C++',
  swift: 'Swift',
}

/** Declarations that own a page of members. */
export const OWNER_KINDS: ReadonlySet<string> = new Set([
  'class',
  'exception',
  'interface',
  'struct',
  'trait',
  'enum',
])

/** The types that get their own page: the ones with members to put on it. */
export function ownersOf(model: ApiModel): ApiSymbol[] {
  const hasMembers = new Set(model.symbols.flatMap((s) => (s.parent ? [s.parent] : [])))
  return model.symbols.filter((s) => OWNER_KINDS.has(s.kind) && hasMembers.has(s.id))
}

/**
 * The URL segment for a symbol's page.
 *
 * `:` is not among the characters kept, and that is deliberate rather than
 * cosmetic. C++ ids look like `libtmux::AttachCommand`, and while a
 * *directory* named that is fine, a *file* named `libtmux::attachcommand.md`
 * is not: Node reads `libtmux:` as a URL scheme and the build dies with "The
 * URL must be of scheme file". The `.md` endpoint writes files, so the colon
 * has to go before it reaches a filename.
 */
export function pageSlug(id: string): string {
  return id
    .toLowerCase()
    .replaceAll('.', '-')
    .replace(/[^a-z0-9_()[\]-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Where a symbol's page is.
 *
 * Every symbol has one. This used to send members to an anchor on their
 * owner's page — `/reference/dotnet/libtmux-pane/#LibTmux.Pane.CaptureAsync`
 * — which meant 10,511 of 11,592 symbols had no URL of their own, could not
 * be listed in a sidebar, and could not carry their own examples or source
 * link. learn.microsoft.com gives every method and property a page; so does
 * this now.
 *
 * The id is the page, so the mapping is total and needs no lookup: a member,
 * a member-less type and a free function all resolve the same way, where
 * before each was a separate branch and two of them were wrong often enough
 * to produce 114 links to pages that were never generated.
 */
export function hrefFor(port: string, _model: ApiModel, symbol: ApiSymbol): string {
  return `/reference/${port}/${symbol.slug ?? pageSlug(symbol.publicId ?? symbol.id)}/`
}

/**
 * Is this span a reference to a symbol, or just a word in backticks?
 *
 * The table linker's version required a call, a separator or type-casing, so
 * `wait_for` — a real Python method, named in prose as "Python's checked wait
 * is `wait_for`" — was rejected before the resolver ever saw it. A bare
 * lowercase name is admitted here, but only as a *candidate*: it still has to
 * resolve uniquely, and `notASymbol` still turns away shell commands, flags
 * and prose fragments. Widening the candidate set costs nothing when the
 * resolver is the thing that decides.
 */
export function looksLikeApiMention(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 80) return false
  // Two words with no call is prose, not a symbol — "go generate ./tmux".
  if (/\s/.test(t) && !/\(/.test(t)) return false
  if (/\(/.test(t)) return true
  if (/[.:]|->/.test(t)) return true
  if (/^[A-Z][A-Za-z0-9_]*$/.test(t)) return true
  // `wait_for`, `capture_pane`, `activeWindow`: an identifier, admitted as a
  // candidate for the resolver to accept or reject.
  return /^[a-z_][A-Za-z0-9_]*$/.test(t)
}

/**
 * The port a sentence is talking about.
 *
 * "Python's checked wait is `wait_for`" names its port in the words before
 * the span, and that beats the page's own language — a Java page saying what
 * Python does should link to Python. Only the nearest name counts, and only
 * within the same sentence, so a paragraph that mentions four ports does not
 * attribute all of them to the last span.
 */
export function portFromSentence(before: string): string | undefined {
  const sentence = before.split(/(?<=[.!?])\s+(?=[A-Z])/).pop() ?? before
  let best: { port: string; at: number } | undefined
  for (const [slug, name] of Object.entries(PORT_NAME)) {
    const at = sentence.toLowerCase().lastIndexOf(name.toLowerCase())
    if (at === -1) continue
    if (!best || at > best.at) best = { port: slug, at }
  }
  return best?.port
}

/**
 * Whether a failure to resolve is worth reporting.
 *
 * `looksLikeApiMention` is deliberately wide — a bare `wait_for` is a real
 * method and has to be offered to the resolver. But most bare lowercase words
 * in backticks are not references at all: `pytest`, `sleep`, `bool`, `q`,
 * `width`. Reporting every one of those as a dangling reference buried the 8
 * that matter under 265 that do not, which is how a ceiling stops being read.
 *
 * So: attempt the wide set, report only the narrow one. A span with a call, a
 * path separator or type-casing was meant as a reference, and its failure is
 * a fact about the corpus. A bare word that resolves is a bonus; a bare word
 * that does not is just a word.
 */
export function isLikelyReference(text: string): boolean {
  const t = text.trim()
  return /\(/.test(t) || /[.:]|->/.test(t) || /^[A-Z][A-Za-z0-9_]*$/.test(t)
}

/**
 * Spans that are code but are not this estate's API, with the reason.
 *
 * The list is the deliverable half of "zero unresolved": every remaining
 * failure is either something to fix or something named here. Each entry says
 * what the category is, so a reader can disagree with the category rather
 * than guess at a regex.
 */
const NOT_API: { why: string; test: RegExp }[] = [
  // tmux's own format language: `#{pane_id}`, `#{...}`. Never a symbol.
  { why: 'tmux format token', test: /^#\{/ },
  // Environment variables and tmux option names are SCREAMING_CASE and
  // belong to tmux or the shell, not to a port.
  { why: 'environment variable', test: /^[A-Z][A-Z0-9_]{2,}$/ },
  // An expression, not a name: it carries arguments, a string, or a glob.
  { why: 'expression, not a symbol', test: /["']|\*|=>|\.\.\./ },
  { why: 'expression, not a symbol', test: /^\(|,\s/ },
  // A call whose arguments are spelled out — `snapshot.windows(of: session)`,
  // `fields.pane_active.eq(true)` — is an example, not a name.
  { why: 'call with arguments', test: /\([^)]*[\s:][^)]*\)/ },
  // A YAML key or a doc marker: `environment:`, `docs:watching`.
  { why: 'configuration key', test: /:$|^[a-z]+:[a-z]/ },
  // A fragment beginning with the separator — `.filter()`, `.gt(...)` — names
  // a method without its receiver, so there is nothing to resolve against.
  { why: 'method without a receiver', test: /^[.:]/ },
  // Test and example fixtures live in files the extractors exclude, so they
  // are real classes that are deliberately not public API.
  { why: 'test or example fixture', test: /(Tests?|TestCase|RunTest)$|^Test[A-Z]/ },
]

/** Why this span is not an API reference, or undefined if it might be. */
export function notApiReason(text: string): string | undefined {
  const t = text.trim()
  for (const { why, test } of NOT_API) if (test.test(t)) return why
  return undefined
}

export type MentionDecision =
  | { kind: 'link'; port: string; href: string; title: string; external: boolean }
  | { kind: 'skip'; why: string }
  | { kind: 'unresolved'; why: string; tried: string[] }

/**
 * Resolve one span, in order of how much the context tells us.
 *
 * The sentence first, then the page's own port, then the estate — and the
 * last of those only when exactly one port claims the name, because a name
 * that four ports define is not disambiguated by trying all four.
 */
export function decideMention(
  text: string,
  ctx: { pagePort?: string; before?: string },
  resolver: Resolver,
  models: Record<string, ApiModel>,
): MentionDecision {
  if (!looksLikeApiMention(text)) return { kind: 'skip', why: 'not a mention' }

  const link = (port: string, res: ReturnType<Resolver['resolve']>): MentionDecision | undefined => {
    if (res.how === 'federated') {
      return { kind: 'link', port, href: res.href, title: `${text}: ${res.project}`, external: true }
    }
    if (res.how === 'module-index') {
      return { kind: 'link', port, href: `/reference/${port}/#${res.module}`, title: `${res.module}: module`, external: false }
    }
    // Every outcome that carries a symbol, not just the two most common.
    // `module` and `chained` resolve to a real symbol too — dropping them
    // lost `tmuxtest.WaitForText`, which the resolver had answered correctly.
    if (res.how === 'unique' || res.how === 'scoped' || res.how === 'chained' || res.how === 'module') {
      const model = models[port]
      if (!model) return undefined
      return {
        kind: 'link',
        port,
        href: hrefFor(port, model, res.symbol),
        title: `${res.symbol.publicId ?? res.symbol.id}: ${PORT_NAME[port] ?? port}`,
        external: false,
      }
    }
    return undefined
  }

  const named = ctx.before ? portFromSentence(ctx.before) : undefined
  for (const port of [named, ctx.pagePort]) {
    if (!port || !models[port]) continue
    const hit = link(port, resolver.resolve(port, text))
    if (hit) return hit
  }

  // Nothing said which language. One claimant is an answer; several are not.
  const claims: { port: string; decision: MentionDecision }[] = []
  const tried: string[] = []
  for (const port of Object.keys(models)) {
    const res = resolver.resolve(port, text)
    tried.push(`${port}:${res.how}`)
    const hit = link(port, res)
    if (hit) claims.push({ port, decision: hit })
  }
  if (claims.length === 1) return claims[0]!.decision
  if (claims.length > 1) {
    // Several ports define this name and nothing said which is meant. Leaving
    // it plain is the decision the goal asks for — a wrong link costs more
    // than a missing one — so it is a skip, not a failure. In a port build
    // `ctx.pagePort` is set and this branch is not reached.
    return { kind: 'skip', why: `ambiguous across ${claims.map((c) => c.port).join(', ')}` }
  }
  return { kind: 'unresolved', why: 'no port defines it', tried }
}

export type PathDecision =
  | { kind: 'link'; port: string; path: string; dir: boolean }
  | { kind: 'skip'; why: string }
  | { kind: 'unresolved'; why: string }

/**
 * A path named in prose, resolved against the files a port actually ships.
 *
 * Prose does not write paths the way a repository stores them. It says
 * `pane.py` when it means `src/libtmux/pane.py`, `tmux/tmuxtest/` when it
 * means a directory rather than a file, and `examples/.../Build.java` when
 * the middle is too long to be worth printing. Matching literally reported 67
 * of 167 paths as missing when almost none of them were.
 *
 * So: an exact path wins, then a directory prefix, then a unique basename —
 * and the port comes from the same places a symbol's does, because
 * `pane.py` exists in more than one of these repositories.
 *
 * @param trees port slug to the set of paths that port holds at the revision
 * its model records.
 */
export function decideFilePath(
  text: string,
  ctx: { pagePort?: string; before?: string },
  trees: Record<string, ReadonlySet<string>>,
): PathDecision {
  const t = text.trim()
  // Not a repository path: an absolute path is a machine's, and an elided one
  // names no file that could be opened.
  if (t.startsWith('/') || t.startsWith('~')) return { kind: 'skip', why: 'absolute path' }
  if (t.includes('...')) return { kind: 'skip', why: 'elided path' }
  // `src/{server,session}/` is one span naming several paths. Linking it
  // would have to pick one; saying so is better than picking.
  if (/[{}*]/.test(t)) return { kind: 'skip', why: 'pattern, not a path' }

  const dir = t.endsWith('/')
  const needle = dir ? t.slice(0, -1) : t
  /**
   * Exact, then prefix, then suffix — and a suffix only when it is unique.
   *
   * Prose writes the tail of a path, not the whole of it:
   * `examples/orchestrate.rs` for `crates/libtmux/examples/orchestrate.rs`,
   * `_generated/` for `packages/libtmux/src/_generated/`. Matching only from
   * the repository root called both of those missing.
   *
   * Uniqueness is what keeps it honest. Four files are called `settings.rs`,
   * so that span is ambiguous rather than resolved, and saying so tells the
   * author to write the path out — which is more useful than a link to
   * whichever one sorted first.
   */
  let generic = false
  const claims = (port: string): { path: string; dir: boolean; ambiguous?: true } | undefined => {
    const tree = trees[port]
    if (!tree) return undefined
    if (!dir && tree.has(needle)) return { path: needle, dir: false }

    const asDir = `${needle}/`
    for (const p of tree) if (p.startsWith(asDir)) return { path: needle, dir: true }

    const dirHits = new Set<string>()
    const fileHits: string[] = []
    for (const p of tree) {
      if (!dir && p.endsWith(`/${needle}`)) fileHits.push(p)
      const at = p.indexOf(`/${needle}/`)
      if (at !== -1) dirHits.add(p.slice(0, at + 1 + needle.length))
    }
    if (!dir && fileHits.length === 1) return { path: fileHits[0]!, dir: false }
    if (dirHits.size === 1) return { path: [...dirHits][0]!, dir: true }
    // A bare name matching several files is prose describing a kind of file,
    // not a claim about one: "a `settings.rs` per tier", "`capabilities.hpp`
    // are separate headers". Written with a directory it would be a claim,
    // and a wrong one is worth reporting — bare, it is generic and correct.
    if (!needle.includes('/') && (fileHits.length > 1 || dirHits.size > 1)) {
      generic = true
      return undefined
    }
    if (fileHits.length > 1 || dirHits.size > 1) return { path: needle, dir, ambiguous: true }
    return undefined
  }

  const named = ctx.before ? portFromSentence(ctx.before) : undefined
  for (const port of [named, ctx.pagePort]) {
    if (!port) continue
    const hit = claims(port)
    if (hit?.ambiguous) return { kind: 'unresolved', why: `several files named this in ${port} — write the path out` }
    if (hit) return { kind: 'link', port, path: hit.path, dir: hit.dir }
  }
  const all = Object.keys(trees).flatMap((port) => {
    const hit = claims(port)
    return hit && !hit.ambiguous ? [{ port, path: hit.path, dir: hit.dir }] : []
  })
  if (all.length === 1) return { kind: 'link', ...all[0]! }
  if (all.length > 1) return { kind: 'unresolved', why: `held by ${all.map((a) => a.port).join(', ')}` }
  if (generic) return { kind: 'skip', why: 'names a kind of file, not one path' }
  return { kind: 'unresolved', why: 'no port holds it' }
}
