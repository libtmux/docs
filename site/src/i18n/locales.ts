/**
 * Supported locales.
 *
 * Every locale carries its own prefix, English included: the site root is a
 * redirect into `/en/`, not a tree of its own, per
 * notes/research/05-i18n-translations.md's URL shape. Adding a locale here is
 * necessary but not sufficient: a locale with no translated page under
 * `src/content/docs/<locale>/` produces no URLs at all, by design. See
 * `resolve.ts` for why untranslated pages are absent rather than falling back.
 */
import { LOCALES_ROOT } from '../lib/site-root.ts'

export const LOCALES = ['en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Display name for a locale, in that locale. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Whether the default locale carries a prefix of its own.
 *
 * True: `build-site.sh` gives every locale its own tree, English included, and
 * builds each one under `LIBTMUX_DOCS_ROOT=/<locale>/`. The site root serves a
 * 302 into `/en/` rather than a copy of it, so composing an English URL as `/`
 * names a redirect instead of a page — wrong in a canonical, an hreflang, or
 * anything a crawler is asked to treat as the destination.
 *
 * Kept as a constant rather than inlined so the scheme stays one decision. It
 * was `false` while English was the site root; flipping it is what moved the
 * tree, and no URL is composed from the bare default anywhere else.
 */
export const DEFAULT_LOCALE_PREFIXED = true

/**
 * Where one locale's tree begins, as an absolute path with a trailing slash.
 *
 * Locales are siblings of each other, not children of the current build, so
 * this cannot be derived from the site root the way an in-locale path can —
 * a Japanese alternate is `/ja/`, whatever prefix the English build carries.
 *
 * It is composed through `LOCALES_ROOT`, the prefix above every locale, which
 * is empty in production and `/pr-42` in a preview. A bare `/ja/` would walk
 * a preview's reader onto the live site.
 */
export function localeRoot(locale: string): string {
  const base = LOCALES_ROOT
  return locale === DEFAULT_LOCALE && !DEFAULT_LOCALE_PREFIXED ? `${base}/` : `${base}/${locale}/`
}

/** The page path below its build locale, including Astro's flat error page. */
export function localeSourcePath(pathname: string, buildLocale: string): string {
  const root = localeRoot(buildLocale)
  const path = (pathname.startsWith(root) ? pathname.slice(root.length) : pathname)
    .replace(/^\/+|\/+$/g, '')
  return path.replace(/(^|\/)404$/, '$1404.html')
}

/** A locale page URL; HTML files keep their extension without a trailing slash. */
export function localePageHref(locale: string, sourcePath: string): string {
  const path = sourcePath.replace(/^\/+|\/+$/g, '')
  const suffix = path && !path.endsWith('.html') ? '/' : ''
  return `${localeRoot(locale)}${path}${suffix}`
}
