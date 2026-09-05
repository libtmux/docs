import type { Locale } from './locales.ts'

/**
 * Chrome strings that are not page content.
 *
 * `satisfies Record<Locale, ...>` is the point: a locale added to LOCALES
 * without a full string table fails the build, rather than rendering blank
 * labels in production. The table is deliberately small — everything a reader
 * actually reads lives in the content collection, not here.
 */
export const ui = {
  en: {
    'i18n.translated': 'Japanese translation available',
    'i18n.stale': 'This translation is out of date',
    'i18n.staleBody':
      'The English page has changed since this was translated. The English original is authoritative.',
    'i18n.unreviewed': 'Machine translation, not yet reviewed by a native speaker.',
    'i18n.readEnglish': 'Read the English original',
    'i18n.available': 'Available translations',
  },
  ja: {
    'i18n.translated': '日本語版があります',
    'i18n.stale': 'この翻訳は最新ではありません',
    'i18n.staleBody':
      '翻訳後に英語版が更新されています。正本は英語版です。',
    'i18n.unreviewed': '機械翻訳です。ネイティブによるレビューは未了です。',
    'i18n.readEnglish': '英語の原文を読む',
    'i18n.available': '利用できる言語',
  },
} satisfies Record<Locale, Record<string, string>>

export type UiKey = keyof (typeof ui)['en']

export function t(locale: Locale, key: UiKey): string {
  return ui[locale][key]
}
