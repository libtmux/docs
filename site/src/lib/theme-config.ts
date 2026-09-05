/**
 * Theme system constants — the single source of truth for palette names,
 * color-scheme preferences, and regional variants.
 *
 * NOTE: ThemeScript.astro's `is:inline` FOUC-prevention script cannot import
 * modules, so it carries literal copies of THEMES, COLOR_SCHEMES, and
 * DEFAULT_THEME. Keep that script in sync when editing these values.
 */
export const THEMES: readonly string[] = ['emerald', 'amber', 'sky', 'purple']
export const COLOR_SCHEMES: readonly string[] = ['light', 'dark', 'system']
export const VARIANTS: readonly string[] = ['us', 'uk']
export const DEFAULT_THEME = 'purple'
