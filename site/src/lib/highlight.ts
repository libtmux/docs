import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki'
import { createRenderer } from 'astro-expressive-code'
import ecConfig from '../../ec.config.mjs'
import { COOLDOWN_FORMATS, COOLDOWN_MARKERS, COOLDOWN_SLOTS, formatCooldown, type CooldownUnit } from './cooldown.ts'
import { promptElement, SESSION_LANGS, sessionLines, shellThemes } from '../plugins/ec-shell-prompt.mjs'
import { tmuxUsage } from './tmux-usage.mjs'
import { tmuxShell } from './tmux-shell.mjs'
import { tmuxConfig } from './tmux-config.mjs'
import { properties } from './properties.mjs'

/**
 * Syntax highlighting for the examples in doc comments.
 *
 * gp-sphinx runs Pygments over its doctest blocks; these rendered as plain
 * monospace, which was the most visible thing left on the parity list. 914
 * blocks across three ports — small enough to highlight at build time and
 * ship as markup, so no highlighter reaches the reader.
 *
 * One highlighter for the whole build. Creating one costs about a second
 * because it loads grammars and a theme; doing that per block would cost
 * fifteen minutes.
 */
let instance: Promise<Highlighter> | undefined

/** Frequent languages load once; other supported grammars load on demand. */
const LANGS = [
  'python', 'ruby', 'lua', 'rust', 'ts', 'js', 'bash', 'console', 'json', 'yaml', 'text',
  // The install widget's build-file panels: a Gradle script, a Maven POM
  // fragment, a Package.swift dependency and a CMakeLists block. Three of the
  // eight ports cannot be installed from a command line at all, so without
  // these their only install instructions render as flat grey.
  'kotlin', 'scala', 'fsharp', 'csharp', 'xml', 'swift', 'cmake', 'toml', 'nix', 'powershell', 'julia', 'ini',
] as const

/**
 * Themes, one per colour scheme.
 *
 * Shiki emits both and CSS picks between them, which matches how the rest of
 * this site handles dark mode: no flash, no JavaScript, and the same markup
 * serves a reader who has never chosen.
 */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const

/** Give the dynamic prompt tokens the same palette as the code highlighter. */
export function promptThemeRules(): string {
  return shellThemes().map((theme) => {
    const foreground = theme.colors?.['editor.foreground']
    const background = theme.colors?.['editor.background']
    if (!foreground || !background) throw new Error(`Prompt theme ${theme.name} has no editor colors`)
    const token = (scope: string) => [...theme.tokenColors].reverse().find((rule) =>
      (Array.isArray(rule.scope) ? rule.scope : [rule.scope]).includes(scope),
    )?.settings.foreground ?? foreground
    const selector = theme.type === 'dark' ? 'html[data-theme-mode="dark"]' : 'html:not([data-theme-mode="dark"])'
    return `${selector} .lm-agent-prompt {
      --lm-agent-prompt-code-bg: ${background};
      --lm-agent-prompt-code-fg: ${foreground};
      --lm-agent-prompt-url: ${token('support')};
      --lm-agent-prompt-cmd: ${foreground};
      --lm-agent-prompt-inline: ${token('string')};
      --lm-agent-prompt-key: ${token('entity')};
      --lm-agent-prompt-marker: ${token('keyword')};
    }`
  }).join('\n')
}

async function highlighter(): Promise<Highlighter> {
  instance ??= createRenderer(ecConfig).then(({ ec }) => createHighlighter({
    // Include Expressive Code's contrast correction as well as its custom scopes.
    themes: ec.themes.map(({ name, type, settings, colors, fg, bg }) => ({ name, type, settings, colors, fg, bg })),
    langs: [...LANGS, tmuxUsage, tmuxShell, tmuxConfig, properties],
  }))
  return instance
}

/** Load supported block languages on demand rather than flattening previews. */
async function known(hl: Highlighter, lang: string): Promise<string> {
  const normalized = codeLang(lang)
  const resolved = normalized === 'properties' ? properties.name
    : LANGS.includes(lang as typeof LANGS[number]) ? lang : normalized
  if (resolved !== 'text' && !hl.getLoadedLanguages().includes(resolved)) {
    await hl.loadLanguage(resolved as BundledLanguage)
  }
  return resolved
}

/**
 * Highlight one block, returning `<pre>` markup.
 *
 * Returns undefined rather than throwing when highlighting fails: an example
 * that renders unhighlighted is a small loss, and a build that fails because
 * a docstring contains something Shiki dislikes is a large one.
 */
export async function highlight(code: string, lang: string): Promise<string | undefined> {
  try {
    const hl = await highlighter()
    // A session highlights as Bash with its prompts drawn back in, the same
    // way the Expressive Code plugin in `ec-shell-prompt.mjs` renders one.
    const session = SESSION_LANGS.has(lang) ? sessionLines(code.split('\n')) : undefined
    // Output reaches the grammar as a blank line, so the apostrophe in `can't`
    // cannot open a string that runs on into the next command.
    return hl.codeToHtml(session ? session.map(({ kind, text }) => (kind === 'output' ? '' : text)).join('\n') : code, {
      lang: session ? 'bash' : await known(hl, lang),
      themes: THEMES,
      defaultColor: false,
      cssVariablePrefix: '--shiki-',
      transformers: session ? [{
        line(node, line) {
          const { kind, text } = session[line - 1] ?? {}
          if (kind === 'prompt') node.children.unshift(promptElement())
          else if (kind === 'output') node.children = [{ type: 'text', value: text ?? '' }]
        },
      }] : [],
    })
  } catch {
    return undefined
  }
}

/** Unsupported doc-comment labels retain a plain-text frame instead of failing builds. */
const EC_LANGS = new Set([
  'python', 'ruby', 'lua', 'rust', 'ts', 'tsx', 'js', 'jsx', 'java', 'kotlin', 'scala', 'fsharp', 'swift',
  'csharp', 'cpp', 'c', 'go', 'bash', 'shell', 'console', 'json', 'yaml',
  'toml', 'xml', 'diff', 'text', 'tmux-usage', 'tmux-shell', 'tmux-config', 'powershell', 'julia', 'properties', 'ini',
])

const EC_ALIASES: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  'c++': 'cpp',
  cxx: 'cpp',
  py: 'python',
  rs: 'rust',
  'c#': 'csharp',
  cs: 'csharp',
  sh: 'bash',
  zsh: 'bash',
  shellsession: 'console',
  tmux: 'tmux-config',
  plaintext: 'text',
  '': 'text',
}

export function codeLang(lang?: string): string {
  const name = (lang ?? '').trim().toLowerCase()
  const resolved = EC_ALIASES[name] ?? name
  return EC_LANGS.has(resolved) ? resolved : 'text'
}

/** Inert themed tokens; browsers construct text nodes rather than parsing HTML. */
export interface CodeHighlight {
  language: string
  light: { foreground: string; background: string }
  dark: { foreground: string; background: string }
  lines: { content: string; light: { color: string; fontStyle: number }; dark: { color: string; fontStyle: number } }[][]
}

/** Compact code uses the same grammar and palettes as ordinary blocks. */
export async function highlightTokens(code: string, lang: string): Promise<CodeHighlight | undefined> {
  try {
    const hl = await highlighter()
    const language = await known(hl, lang)
    const palette = (theme: string) => {
      const { fg, bg } = hl.getTheme(theme)
      return { foreground: fg, background: bg }
    }
    return { language, light: palette(THEMES.light), dark: palette(THEMES.dark),
      // Shiki's type union excludes the custom grammars already loaded by known().
      lines: hl.codeToTokensWithThemes(code, { lang: language as BundledLanguage, themes: THEMES }).map((line) =>
        line.map((token) => ({ content: token.content,
          light: { color: token.variants.light.color ?? hl.getTheme(THEMES.light).fg, fontStyle: token.variants.light.fontStyle ?? 0 },
          dark: { color: token.variants.dark.color ?? hl.getTheme(THEMES.dark).fg, fontStyle: token.variants.dark.fontStyle ?? 0 },
        }))),
    }
  } catch { return undefined }
}

/**
 * The same highlighting, as the inner markup of a `<code>` element.
 *
 * The install widgets assemble their own container — a copy button, a
 * language attribute, and in the MCP config live slots that JavaScript
 * rewrites — so they cannot take Shiki's `<pre>` wrapper. Without this they
 * rendered as plain text next to highlighted code everywhere else on the
 * page.
 *
 * Returns the code unhighlighted, escaped, if Shiki declines it, for the same
 * reason `highlight` returns undefined rather than throwing.
 */
export async function highlightInline(code: string, lang: string): Promise<string> {
  const html = await highlight(code, lang)
  if (html === undefined) {
    return code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
  }
  return html.replace(/^[\s\S]*?<code[^>]*>/, '').replace(/<\/code>[\s\S]*$/, '')
}

/**
 * `highlightInline`, with each cooldown placeholder left as an element the
 * widget scripts rewrite when the reader changes the day count:
 * `<span data-cooldown-scale="1440" data-cooldown-template="{}">10080</span>`.
 */
export async function highlightWithCooldownSlots(code: string, lang: string, days: number): Promise<string> {
  const units = Object.keys(COOLDOWN_SLOTS) as CooldownUnit[]
  let text = code
  for (const unit of units) text = text.replaceAll(COOLDOWN_SLOTS[unit], COOLDOWN_MARKERS[unit])
  let html = await highlightInline(text, lang)
  for (const unit of units) {
    html = html.replaceAll(
      COOLDOWN_MARKERS[unit],
      `<span class="lm-cooldown-slot" data-cooldown-unit="${unit}" data-cooldown-scale="${COOLDOWN_FORMATS[unit].scale}" ` +
        `data-cooldown-template="${COOLDOWN_FORMATS[unit].template}">${formatCooldown(unit, days)}</span>`,
    )
  }
  return html
}
