/**
 * The version axis.
 *
 * Every build targets exactly one version slug and bakes it into `base`
 * (see astro.config.ts). The switcher is client-side and reads the manifest
 * at /versions.json, which CI rewrites on publish — so a version published
 * after this build still shows up in this build's switcher.
 */

export type VersionKind =
  /** Default branch. Always built, always at /<port>/latest/. */
  | 'trunk'
  /** A released tag. Immutable once published. */
  | 'tag'
  /** A maintenance branch such as v0.x. Rebuilt on every push. */
  | 'branch'
  /** A pull-request preview. Never indexed, deleted when the PR closes. */
  | 'pr'
  /** An alias that resolves to one of the above. Built separately so its
   *  canonical URL is its own. */
  | 'alias'

export interface VersionEntry {
  /** URL segment: 'latest', 'stable', 'v0.46.2', 'v0.x', 'pr-123'. */
  slug: string
  /** Label for the switcher. */
  label: string
  kind: VersionKind
  /** For kind 'alias', the slug it currently points at. */
  resolvesTo?: string
  /** ISO date of publication. */
  published?: string
  /** End of life — drives the noindex + banner treatment. */
  eol?: boolean
  /** Whether this version is offered in the switcher at all. */
  supported: boolean
}

export interface VersionManifest {
  /** Manifest schema version, so the switcher can refuse what it can't read. */
  schema: 1
  /** Per-port version lists, keyed by port slug. */
  ports: Record<string, VersionEntry[]>
  /** Which slug /<port>/ redirects to. */
  defaultVersion: Record<string, string>
}

/**
 * Robots policy per version kind.
 *
 * Only one version per port is indexable — the alias that `defaultVersion`
 * points at, normally `stable`. Everything else is either a duplicate of it
 * (tags, trunk) or noise (PR previews), and indexing duplicates splits
 * ranking across URLs that all say the same thing.
 */
export function robotsFor(entry: VersionEntry, isDefault: boolean): string {
  if (entry.kind === 'pr') return 'noindex, nofollow'
  if (entry.eol) return 'noindex, follow'
  return isDefault ? 'index, follow' : 'noindex, follow'
}

/**
 * Canonical URL for a page.
 *
 * Non-default versions point their canonical at the same path under the
 * default version, which is the Read the Docs pattern: the old page stays
 * reachable and readable, but search engines are told where the live one is.
 * A page that does not exist in the default version canonicalises to itself
 * — callers pass `existsInDefault: false` for that case.
 */
export function canonicalUrl(
  origin: string,
  portSlug: string,
  versionSlug: string,
  defaultSlug: string,
  pagePath: string,
  existsInDefault = true,
): string {
  const target = existsInDefault ? defaultSlug : versionSlug
  const clean = pagePath.replace(/^\/+/, '').replace(/\/+$/, '')
  const tail = clean ? `${clean}/` : ''
  return `${origin.replace(/\/$/, '')}/${portSlug}/${target}/${tail}`
}

/**
 * How a port writes its version tags.
 *
 * Python follows PEP 440 and the rest follow SemVer, and the two disagree
 * about more than punctuation: PEP 440 writes a suffix with no separator
 * (`v0.11.0b0`) and has post-releases, which come *after* the release they
 * follow. A single grammar cannot serve both, and reading a PEP 440 tag with
 * the SemVer one yields NaN for the patch number.
 */
export type TagGrammar = 'semver' | 'pep440'

interface Grammar {
  re: RegExp
  /** Where a suffix sits relative to a bare release. Higher is newer. */
  rank: (pre: string | null) => number
}

const GRAMMARS: Record<TagGrammar, Grammar> = {
  semver: {
    re: /^v(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/,
    rank: (pre) => (pre === null ? 0 : -1),
  },
  pep440: {
    // `rc` and `dev` are permitted by PEP 440 and unused here; matching them
    // costs nothing and avoids a silent drop if one is ever tagged.
    re: /^v(\d+)\.(\d+)\.(\d+)((?:a|b|rc)\d+|post\d+|dev\d+)?$/,
    rank: (pre) => {
      if (pre === null) return 0
      if (pre.startsWith('post')) return 1
      if (pre.startsWith('dev')) return -2
      return -1
    },
  },
}

export interface ParsedTag {
  nums: number[]
  /** The suffix, or null for a bare release. */
  pre: string | null
}

/** A tag slug read under one port's grammar, or null when it is not a tag. */
export function parseTag(name: string, grammar: TagGrammar): ParsedTag | null {
  const m = GRAMMARS[grammar].re.exec(name)
  if (!m) return null
  const [, major, minor, patch, pre] = m
  return { nums: [Number(major), Number(minor), Number(patch)], pre: pre ?? null }
}

/**
 * Newest-first precedence for two tag slugs.
 *
 * Lives here rather than beside the manifest generator because it is ordering,
 * and this module already owns ordering — the generator imports it for the
 * same reason it imports `sortVersions`, so the switcher and the manifest
 * cannot disagree about which release is newer.
 *
 * Rank settles precedence before the suffix is compared at all, so a
 * post-release outranks its own release and a prerelease does not. Numeric
 * collation then breaks ties inside one rank: `alpha.10` after `alpha.9`,
 * `post1` after `post0`.
 */
export function compareTags(a: string, b: string, grammar: TagGrammar = 'semver'): number {
  const pa = parseTag(a, grammar)
  const pb = parseTag(b, grammar)
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0
  for (let i = 0; i < 3; i += 1) {
    const d = (pb.nums[i] ?? 0) - (pa.nums[i] ?? 0)
    if (d !== 0) return d
  }
  const { rank } = GRAMMARS[grammar]
  const ra = rank(pa.pre)
  const rb = rank(pb.pre)
  if (ra !== rb) return rb - ra
  if (pa.pre === pb.pre) return 0
  return (pb.pre ?? '').localeCompare(pa.pre ?? '', undefined, { numeric: true })
}

/**
 * Sort newest-first for the switcher: aliases, then trunk, then tags, then
 * branches.
 *
 * Tags order by `compareTags`, not by their slug. Numeric collation on the
 * raw string has no notion of a prerelease, so it read `v1.0.0-alpha.3` as
 * later than `v1.0.0` — a longer string sharing a prefix — and listed a
 * prerelease above the release it precedes. This function is what the
 * switcher renders, so it is the ordering that has to be right.
 */
export function sortVersions(entries: VersionEntry[], grammar: TagGrammar = 'semver'): VersionEntry[] {
  const rank: Record<VersionKind, number> = { alias: 0, trunk: 1, tag: 2, branch: 3, pr: 4 }
  return [...entries].sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    if (a.kind === 'tag' && b.kind === 'tag') return compareTags(a.slug, b.slug, grammar)
    return b.slug.localeCompare(a.slug, undefined, { numeric: true })
  })
}

/**
 * The build's own identity, from the environment.
 *
 * CI sets these; `pnpm dev` falls back to a local trunk build so the site is
 * browsable without any env at all.
 */
export function buildTarget(env: Record<string, string | undefined>) {
  const version = env.LIBTMUX_DOCS_VERSION ?? 'latest'
  const kind = (env.LIBTMUX_DOCS_VERSION_KIND ?? 'trunk') as VersionKind
  const isDefault = env.LIBTMUX_DOCS_IS_DEFAULT === 'true'
  return { version, kind, isDefault }
}
