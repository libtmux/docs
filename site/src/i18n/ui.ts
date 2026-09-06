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
    'i18n.untranslated': 'This page has not been translated yet.',
    'i18n.contribute': 'Help translate it',
    'i18n.translated': 'Japanese translation available',
    'i18n.stale': 'This translation is out of date',
    'i18n.staleBody':
      'The English page has changed since this was translated. The English original is authoritative.',
    'i18n.unreviewed': 'Machine translation, not yet reviewed by a native speaker.',
    'i18n.readEnglish': 'Read the English original',
    'i18n.available': 'Available translations',
    'i18n.coverage': 'Translation coverage',
    'i18n.coverageIntro':
      'Every page of the shared prose, and how far each language has got. The English text is the source; a language shows a placeholder wherever it has no translation yet.',
    'i18n.page': 'Page',
    'i18n.statusTranslated': 'Translated',
    'i18n.statusStale': 'Out of date',
    'i18n.statusPlaceholder': 'Not translated',
    'i18n.startTranslation': 'Start this translation on GitHub',
    'i18n.improveTranslation': 'Improve this translation on GitHub',
    'i18n.editPage': 'Edit this page on GitHub',
    'i18n.coverageLink': 'See what else needs translating',
    'i18n.accessNote':
      'Editing needs access to the documentation repository, which is private while the site is under construction. If a link below gives you a GitHub 404, that is why — open an issue and we will find another way to take your translation.',
  },
  ja: {
    'i18n.untranslated': 'このページはまだ翻訳されていません。',
    'i18n.contribute': '翻訳に協力する',
    'i18n.translated': '日本語版があります',
    'i18n.stale': 'この翻訳は最新ではありません',
    'i18n.staleBody':
      '翻訳後に英語版が更新されています。正本は英語版です。',
    'i18n.unreviewed': '機械翻訳です。ネイティブによるレビューは未了です。',
    'i18n.readEnglish': '英語の原文を読む',
    'i18n.available': '利用できる言語',
    'i18n.coverage': '翻訳の進捗',
    'i18n.coverageIntro':
      '共通ドキュメントの全ページと、各言語の進捗です。正本は英語版で、未翻訳のページにはプレースホルダーが表示されます。',
    'i18n.page': 'ページ',
    'i18n.statusTranslated': '翻訳済み',
    'i18n.statusStale': '最新ではありません',
    'i18n.statusPlaceholder': '未翻訳',
    'i18n.startTranslation': 'GitHub でこのページの翻訳を始める',
    'i18n.improveTranslation': 'GitHub でこの翻訳を改善する',
    'i18n.editPage': 'GitHub でこのページを編集する',
    'i18n.coverageLink': '他に翻訳が必要なページを見る',
    'i18n.accessNote':
      '編集にはドキュメントリポジトリへのアクセス権が必要です。サイトは構築中のため、現在このリポジトリは非公開です。下のリンクで GitHub の 404 が表示される場合はそれが理由です。Issue を立てていただければ別の方法を検討します。',
  },
} satisfies Record<Locale, Record<string, string>>

export type UiKey = keyof (typeof ui)['en']

export function t(locale: Locale, key: UiKey): string {
  return ui[locale][key]
}
