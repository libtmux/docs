/**
 * Supported locales, and which one is unprefixed.
 *
 * English has no `/en/` prefix — it is the site root, per
 * notes/research/05-i18n-translations.md's URL shape. Adding a locale here is
 * necessary but not sufficient: a locale with no translated page under
 * `src/content/docs/<locale>/` produces no URLs at all, by design. See
 * `resolve.ts` for why untranslated pages are absent rather than falling back.
 */
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
 * False today: English is the site root. The `/en/` scheme flips this, and it
 * is one constant precisely so that move does not become a hunt through every
 * place a URL is composed.
 */
export const DEFAULT_LOCALE_PREFIXED = false

/**
 * Where one locale's tree begins, as an absolute path with a trailing slash.
 *
 * Locales are siblings of each other, not children of the current build, so
 * this cannot be derived from the site root the way an in-locale path can —
 * a Japanese alternate is `/ja/`, whatever prefix the English build carries.
 */
export function localeRoot(locale: string): string {
  return locale === DEFAULT_LOCALE && !DEFAULT_LOCALE_PREFIXED ? '/' : `/${locale}/`
}
