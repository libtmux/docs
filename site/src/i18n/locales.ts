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
