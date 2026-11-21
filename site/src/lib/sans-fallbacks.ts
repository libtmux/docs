/**
 * The faces that follow IBM Plex Sans in `--font-ibm-plex-sans`, by locale.
 *
 * The Fonts API registers Plex under a hashed family name and writes the
 * variable as that family, then these fallbacks, in order. Plex has no
 * Japanese glyphs, so a Japanese build lists the reader's own Japanese sans
 * faces first, named so an unnamed fallback never lands on a Mincho serif
 * (record 0052). The generic faces the other builds list first would
 * otherwise come up ahead of them. Every locale ends on the emoji faces.
 */

/** Hiragino on macOS and iOS, Yu Gothic and Meiryo on Windows, Noto Sans CJK on Linux and Android. */
export const JAPANESE_SANS = ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP']
const EMOJI = ['Apple Color Emoji', 'Segoe UI Emoji']

export function sansFallbacks(locale: string): string[] {
  return locale === 'ja'
    ? [...JAPANESE_SANS, 'system-ui', 'sans-serif', ...EMOJI]
    : ['ui-sans-serif', 'system-ui', 'sans-serif', ...EMOJI]
}
