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
 * The prefix above every locale.
 *
 * Empty in production, where `/en/` and `/ja/` sit at the origin root. A
 * pull-request preview nests the whole site — locales included — under
 * `/pr-42/`, and a locale's URL is composed from the locale root rather than
 * from this build's own root, so without this every cross-locale link, every
 * hreflang alternate and every `x-default` in a preview pointed at
 * production. That is the same class of leak `SITE_ROOT` exists to stop, one
 * level further out.
 *
 * Separate from `SITE_ROOT` because they answer different questions:
 * `SITE_ROOT` is where *this* build is mounted (`/pr-42/ja` for a preview's
 * Japanese build), while this is where *any* locale begins (`/pr-42`).
 */
export const LOCALES_ROOT: string = (process.env.LIBTMUX_DOCS_LOCALES_ROOT || '').replace(
  /\/+$/,
  '',
)

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

/**
 * The root under which the port trees and the reference live.
 *
 * They are rendered in the default locale only — translating the reference is
 * out of scope, and per-port prose is the language-filtered English — so a
 * page in another locale links across to them rather than expecting a copy
 * beneath itself. A Japanese page linking at `/ja/py/stable/` names a tree
 * nothing builds.
 *
 * Supplied by the assembly rather than derived here, because it also has to
 * survive a pull-request preview, where the whole site is nested one level
 * deeper still.
 */
export const PORT_ROOT: string = (process.env.LIBTMUX_DOCS_PORT_ROOT || SITE_ROOT).replace(/\/+$/, '')

/** Prefix a root-relative path with the root the port trees live under. */
export function withPortRoot(path: string): string {
  if (!PORT_ROOT) return path
  if (!path.startsWith('/') || path.startsWith('//')) return path
  return `${PORT_ROOT}${path}`
}
