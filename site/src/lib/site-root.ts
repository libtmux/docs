/**
 * Where the site root is for this build.
 *
 * Almost always `/`. A PR preview is the exception: the whole site is
 * published under `/pr-42/`, and every root-relative link a component emits
 * — `/mcp/`, `/py/stable/`, `/versions.json` — would otherwise walk the
 * reader straight out of the preview and onto production, silently, with the
 * preview's own header still on screen.
 *
 * `import.meta.env.BASE_URL` cannot stand in for this. A per-port build has
 * `base=/py/stable/` and a preview has `base=/pr-42/`; the two are the same
 * shape and only one of them moves the root. Which it is, is something only
 * the build knows, so it says so explicitly.
 *
 * `process.env`, not `import.meta.env`: build-site.sh runs `astro build`
 * fourteen times in one tree, and `import.meta.env` is resolved once and
 * cached across those runs — the same staleness that made every build inherit
 * the first one's robots and canonical tags (see Seo.astro).
 */
export const SITE_ROOT = (process.env.LIBTMUX_DOCS_ROOT || '/').replace(/\/+$/, '')

/**
 * Prefix a root-relative path with this build's site root.
 *
 * A no-op when the root is `/`, which is every build except a PR preview.
 * Anything that is not a single-leading-slash path is returned untouched:
 * `https://…` is off-site, `//host` is protocol-relative, and `../x` is
 * already relative to the page.
 */
export function withRoot(path: string): string {
  if (!SITE_ROOT) return path
  if (!path.startsWith('/') || path.startsWith('//')) return path
  return `${SITE_ROOT}${path}`
}

/**
 * Whether this build mounts the whole site rather than one port's subtree.
 *
 * The port, deliberately not the base. `site/src/i18n/resolve.ts` makes the
 * same argument for `localesEnabled()`: a pull-request preview carries a
 * non-root base with no port, and gating on the base silences exactly the
 * build that most needs to show a change.
 *
 * Three callers inferred this from `base === '/'` instead, and each would
 * have flipped silently the moment the root build gained a locale prefix —
 * no sitemap emitted, every shared page marked noindex, no port landing
 * pages. They are one helper now because keeping them in sync by hand has
 * already failed once.
 */
export const IS_ROOT_BUILD: boolean = !process.env.LIBTMUX_DOCS_PORT
