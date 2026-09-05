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
 * Newest-first precedence for two tag slugs.
 *
 * Lives here rather than beside the manifest generator because it is ordering,
 * and this module already owns ordering — the generator imports it for the
 * same reason it imports `sortVersions`, so the switcher and the manifest
 * cannot disagree about which release is newer.
 *
 * A release outranks any of its own prereleases. Prerelease identifiers
 * collate numerically, so `alpha.10` is newer than `alpha.9`; plain
 * lexicographic order puts it between `alpha.1` and `alpha.2`.
 */
export function compareTags(a: string, b: string): number {
  const parse = (s: string) => {
    const [core, pre] = s.slice(1).split('-', 2)
    return { nums: core.split('.').map(Number), pre: pre ?? null }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const d = (pb.nums[i] ?? 0) - (pa.nums[i] ?? 0)
    if (d !== 0) return d
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return -1
  if (pb.pre === null) return 1
  return pb.pre.localeCompare(pa.pre, undefined, { numeric: true })
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
export function sortVersions(entries: VersionEntry[]): VersionEntry[] {
  const rank: Record<VersionKind, number> = { alias: 0, trunk: 1, tag: 2, branch: 3, pr: 4 }
  return [...entries].sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    if (a.kind === 'tag' && b.kind === 'tag') return compareTags(a.slug, b.slug)
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
