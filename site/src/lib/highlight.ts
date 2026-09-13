import { createHighlighter, type Highlighter } from 'shiki'
import { promptElement, SESSION_LANGS, sessionLines } from '../plugins/ec-shell-prompt.mjs'

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
const LANGS = [
  'python', 'rust', 'ts', 'js', 'bash', 'console', 'json', 'text',
  // The install widget's build-file panels: a Gradle script, a Maven POM
  // fragment, a Package.swift dependency and a CMakeLists block. Three of the
  // eight ports cannot be installed from a command line at all, so without
  // these their only install instructions render as flat grey.
  'kotlin', 'xml', 'swift', 'cmake', 'toml',
] as const

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
    // A session highlights as Bash with its prompts drawn back in, the same
    // way the Expressive Code plugin in `ec-shell-prompt.mjs` renders one.
    const session = SESSION_LANGS.has(lang) ? sessionLines(code.split('\n')) : undefined
    // Output reaches the grammar as a blank line, so the apostrophe in `can't`
    // cannot open a string that runs on into the next command.
    return hl.codeToHtml(session ? session.map(({ kind, text }) => (kind === 'output' ? '' : text)).join('\n') : code, {
      lang: session ? 'bash' : known(lang),
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

/**
 * The language name to hand Expressive Code for a doc-comment example.
 *
 * `<Code>` throws on a grammar Shiki does not know, and one bad `lang` in one
 * docstring would fail the whole build — the opposite of the tradeoff
 * `highlight` makes two functions above. The list is what the extracted
 * models actually carry (`python`, `rust`, `ts`, `java`, `swift`, `csharp`,
 * `console`) plus the aliases a doc comment spells them with; anything else
 * renders as plain text in the same frame rather than as a build failure.
 *
 * Not the `LANGS` list above: that one is small on purpose, because every
 * grammar it names is loaded eagerly into one long-lived highlighter.
 * Expressive Code loads grammars lazily from the full Shiki bundle, so naming
 * a language here costs nothing until a block uses it — which is why `java`,
 * `swift` and `csharp` can be highlighted here and were flattened to `text`
 * there.
 */
const EC_LANGS = new Set([
  'python', 'rust', 'ts', 'tsx', 'js', 'jsx', 'java', 'kotlin', 'swift',
  'csharp', 'cpp', 'c', 'go', 'bash', 'shell', 'console', 'json', 'yaml',
  'toml', 'xml', 'diff', 'text',
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
  plaintext: 'text',
  '': 'text',
}

export function codeLang(lang?: string): string {
  const name = (lang ?? '').trim().toLowerCase()
  const resolved = EC_ALIASES[name] ?? name
  return EC_LANGS.has(resolved) ? resolved : 'text'
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
