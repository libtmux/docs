import { defineEcConfig } from 'astro-expressive-code'
import { shellPrompt, shellThemes } from './src/plugins/ec-shell-prompt.mjs'
import { copyReadiness } from './src/plugins/ec-copy-readiness.mjs'
import { codeFrame } from './src/plugins/ec-code-frame.mjs'
import { tmuxUsage } from './src/lib/tmux-usage.mjs'
import { tmuxShell } from './src/lib/tmux-shell.mjs'
import { tmuxConfig } from './src/lib/tmux-config.mjs'
import { properties } from './src/lib/properties.mjs'
import { haskell } from './src/lib/haskell.mjs'
import { fileGrammars } from './src/lib/grammars/index.mjs'
import bash from 'shiki/langs/bash.mjs'

/**
 * Expressive Code options live here rather than inline in astro.config.ts
 * because the <Code> component renders in a separate pass that receives its
 * configuration as JSON. `themeCssSelector` is a function, so the inline form
 * fails to serialize and <Code> refuses to render — the fenced blocks in
 * Markdown keep working, which makes it look like a component bug rather than
 * a config one.
 */
export default defineEcConfig({
  // Keep literal tabs in displayed code and clipboard text.
  tabWidth: 0,
  themes: shellThemes(),
  customizeTheme(theme) {
    const dark = theme.type === 'dark'
    theme.settings.push(
      { scope: ['support.type.property-name.json'], settings: { foreground: dark ? '#f0a0c0' : '#963b63' } },
      { scope: ['string.quoted.double.json'], settings: { foreground: dark ? '#e6c86e' : '#755400' } },
      { scope: ['constant.language.json', 'constant.numeric.json'], settings: { foreground: dark ? '#c3a6f4' : '#6840a0' } },
    )
  },
  plugins: [shellPrompt(), copyReadiness(), codeFrame()],
  shiki: { langs: [tmuxUsage, ...bash, tmuxShell, tmuxConfig, properties, ...haskell, ...fileGrammars],
    langAlias: { sbt: 'scala', tmux: 'tmux-config', properties: properties.name } },
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
    // 13px: the design sets frame code a step under the 14px of signature headers (record 0032).
    codeFontSize: '0.8125rem',
    codeLineHeight: '1.7',
    uiFontFamily: 'var(--font-ibm-plex-sans)',
    uiFontSize: '0.875rem',
    frames: {
      frameBoxShadowCssValue: 'none',
      // The frame's copy button is a control: outlined in --control-border at full strength like the installer's (record 0067).
      inlineButtonBorder: 'var(--control-border)',
      inlineButtonBorderOpacity: '1',
    },
  },
})
