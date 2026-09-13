import { defineEcConfig } from 'astro-expressive-code'
import { shellPrompt, shellThemes } from './src/plugins/ec-shell-prompt.mjs'

/**
 * Expressive Code options live here rather than inline in astro.config.ts
 * because the <Code> component renders in a separate pass that receives its
 * configuration as JSON. `themeCssSelector` is a function, so the inline form
 * fails to serialize and <Code> refuses to render — the fenced blocks in
 * Markdown keep working, which makes it look like a component bug rather than
 * a config one.
 */
export default defineEcConfig({
  themes: shellThemes(),
  plugins: [shellPrompt()],
  useDarkModeMediaQuery: false,
  themeCssSelector: (theme) =>
    theme.name === 'github-light'
      ? '[data-theme-mode]:not([data-theme-mode="dark"])'
      : '[data-theme-mode="dark"]',
  styleOverrides: {
    borderRadius: '0.375rem',
    borderWidth: '1px',
    codePaddingBlock: '1rem',
    codePaddingInline: '1rem',
    codeFontFamily: 'var(--font-ibm-plex-mono)',
    codeFontSize: '0.875rem',
    codeLineHeight: '1.7',
    uiFontFamily: 'var(--font-ibm-plex-sans)',
    uiFontSize: '0.875rem',
    frames: { frameBoxShadowCssValue: 'none' },
  },
})
