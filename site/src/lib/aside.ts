/**
 * The aside's types, variants and icons.
 *
 * Shared by `Aside.astro` and the demo playground's script, which rewrites a
 * preview's classes in the browser. No imports, so the playground bundles
 * nothing else with it.
 */

export const ASIDE_TYPES = ['note', 'tip', 'caution', 'danger'] as const
export type AsideType = (typeof ASIDE_TYPES)[number]

export const ASIDE_VARIANTS = ['classic', 'refined', 'card', 'minimal', 'hybrid'] as const
export type AsideVariant = (typeof ASIDE_VARIANTS)[number]

export const ASIDE_ICON_STYLES = ['inline', 'soft', 'solid'] as const
export type AsideIconStyle = (typeof ASIDE_ICON_STYLES)[number]

export const ASIDE_ICON_SIZES = ['sm', 'md', 'lg'] as const
export type AsideIconSize = (typeof ASIDE_ICON_SIZES)[number]

/** Material Design filled icons on a 24px grid, drawn in `currentColor`. */
export const ASIDE_ICONS: Record<AsideType, string> = {
  note: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  tip: 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z',
  caution: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  danger: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
}

export const ASIDE_TITLES: Record<AsideType, string> = {
  note: 'Note',
  tip: 'Tip',
  caution: 'Caution',
  danger: 'Danger',
}

/** The icon each variant draws unless the caller overrides its style or size. */
export const ASIDE_VARIANT_DEFAULTS: Record<AsideVariant, { iconStyle: AsideIconStyle; iconSize: AsideIconSize }> = {
  classic: { iconStyle: 'inline', iconSize: 'md' },
  refined: { iconStyle: 'soft', iconSize: 'md' },
  card: { iconStyle: 'solid', iconSize: 'md' },
  minimal: { iconStyle: 'inline', iconSize: 'sm' },
  hybrid: { iconStyle: 'solid', iconSize: 'lg' },
}

export const ASIDE_VARIANT_DESCRIPTIONS: Record<AsideVariant, string> = {
  classic: 'Left border on a flat background.',
  refined: 'Left border on a background that fades right, with a soft icon badge.',
  card: 'Bordered card with a solid icon badge and no left border.',
  minimal: 'Top border and an uppercase title, for editorial pages.',
  hybrid: 'Left border on a fading background, with a solid icon badge. The default.',
}

export const asideClass = (type: AsideType, variant: AsideVariant): string =>
  `lm-aside lm-aside--${type} lm-aside--${variant}`

export const asideIconClass = (style: AsideIconStyle, size: AsideIconSize): string =>
  `lm-aside__icon lm-aside__icon--${style} lm-aside__icon--${size}`

/**
 * A docstring admonition as an aside.
 *
 * Sphinx and rustdoc name a dozen kinds; the aside has four types, so each
 * kind maps to the one whose colour and icon carry the same weight, and the
 * title keeps the word the author wrote. An unknown kind is a note rather
 * than nothing: the text is still worth setting apart.
 */
const ASIDE_KINDS: Record<string, { type: AsideType; title: string }> = {
  note: { type: 'note', title: 'Note' },
  seealso: { type: 'note', title: 'See also' },
  important: { type: 'note', title: 'Important' },
  versionchanged: { type: 'note', title: 'Changed' },
  hint: { type: 'tip', title: 'Hint' },
  tip: { type: 'tip', title: 'Tip' },
  warning: { type: 'caution', title: 'Warning' },
  attention: { type: 'caution', title: 'Attention' },
  caution: { type: 'caution', title: 'Caution' },
  deprecated: { type: 'caution', title: 'Deprecated' },
  danger: { type: 'danger', title: 'Danger' },
  error: { type: 'danger', title: 'Error' },
}
export const asideFor = (kind: string): { type: AsideType; title: string } =>
  ASIDE_KINDS[kind.toLowerCase()] ?? { type: 'note', title: kind.charAt(0).toUpperCase() + kind.slice(1) }

/**
 * The markup of `Aside.astro` for text that a Markdown renderer finishes.
 *
 * The body keeps its own blank lines so it is parsed as Markdown, not as raw
 * HTML.
 */
export function asideMarkdown(type: AsideType, title: string, body: string): string {
  const variant = 'hybrid'
  const { iconStyle, iconSize } = ASIDE_VARIANT_DEFAULTS[variant]
  return [
    `<aside class="${asideClass(type, variant)}" role="note">`,
    `<p class="lm-aside__title"><span class="${asideIconClass(iconStyle, iconSize)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ASIDE_ICONS[type]}"></path></svg></span><span>${title}</span></p>`,
    '<div class="lm-aside__content">', '', body, '', '</div>', '</aside>',
  ].join('\n')
}
