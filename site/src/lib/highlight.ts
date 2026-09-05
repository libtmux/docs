import { createHighlighter, type Highlighter } from 'shiki'

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

/**
 * Languages loaded up front.
 *
 * Only the ones doc comments in this estate actually use — `gen-api-model`
 * reports 618 Python blocks, 192 TypeScript and 104 Rust, and nothing else.
 * A grammar that is never used is a megabyte of startup for nothing.
 */
const LANGS = ['python', 'rust', 'ts', 'js', 'bash', 'console', 'json', 'text'] as const

/**
 * Themes, one per colour scheme.
 *
 * Shiki emits both and CSS picks between them, which matches how the rest of
 * this site handles dark mode: no flash, no JavaScript, and the same markup
 * serves a reader who has never chosen.
 */
const THEMES = { light: 'github-light', dark: 'github-dark' }

async function highlighter(): Promise<Highlighter> {
  instance ??= createHighlighter({
    themes: Object.values(THEMES),
    langs: [...LANGS],
  })
  return instance
}

/** Whether a language has a grammar loaded, so an unknown one degrades. */
function known(lang: string): string {
  const normalised = lang === 'typescript' ? 'ts' : lang === 'javascript' ? 'js' : lang
  return (LANGS as readonly string[]).includes(normalised) ? normalised : 'text'
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
    return hl.codeToHtml(code, {
      lang: known(lang),
      themes: THEMES,
      defaultColor: false,
      cssVariablePrefix: '--shiki-',
    })
  } catch {
    return undefined
  }
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
