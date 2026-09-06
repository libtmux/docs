import { parseMarkdownDocFull, type ParsedMarkdownDoc } from './markdown.ts'

/**
 * Javadoc's HTML, translated into the Markdown the block parser reads.
 *
 * A javadoc comment is HTML by specification, and the reference was parsing it
 * as prose: 289 `<p>` and 36 `<pre>` from libtmux-java reached the page as
 * printed tags, on 146 of its pages. This is the same failure C# XML had, and
 * has the same fix — read the comment in the dialect it was written in.
 *
 * The source keeps its HTML. Javadoc output is generated from these comments
 * by javadoc itself, which needs the tags; this converts a copy on the way
 * into our own doc model.
 *
 * Only javadoc's formatting vocabulary is translated. A doc comment also
 * contains `List<String>` and `<socket>`, so a rule that acted on angle
 * brackets in general would eat a type parameter and a placeholder alike.
 */

/**
 * `<pre>{@code … }</pre>`, javadoc's fenced block.
 *
 * Handled before anything else and as a unit: the `{@code}` wrapper is part of
 * the block's spelling rather than an inline literal, and an inline pass that
 * reached it first would leave the fence holding a stray brace.
 */
const PRE_BLOCK = /<pre>\s*(?:\{@code\b)?\s*\n?([\s\S]*?)\n?\s*\}?\s*<\/pre>/g

/** Inline formatting, as `[tag, markdown]`. `<code>` is javadoc's `{@code}`. */
const INLINE: [RegExp, string][] = [
  [/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/g, '**$1**'],
  [/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/g, '*$1*'],
  [/<code>([\s\S]*?)<\/code>/g, '`$1`'],
]

/** Translate one javadoc comment body into Markdown. */
export function javadocToMarkdown(raw: string): string {
  let text = raw.replace(PRE_BLOCK, (_, code: string) => {
    const lines = code.split('\n').map((l) => l.replace(/^\s*/, ''))
    return `\n\`\`\`java\n${lines.join('\n')}\n\`\`\`\n`
  })

  // `<p>` opens a paragraph in javadoc and closes nothing; every one of
  // libtmux-java's sits at the start of a line that a blank line already
  // precedes, so the tag is all that has to go.
  text = text.replace(/^([ \t]*)<\/?p>[ \t]*/gm, '$1')
  text = text.replace(/^([ \t]*)<h([1-6])>([\s\S]*?)<\/h\2>[ \t]*$/gm, (_, i, l, t) => `${i}${'#'.repeat(Number(l))} ${t}`)
  text = text.replace(/^([ \t]*)<li>([\s\S]*?)(?:<\/li>)?[ \t]*$/gm, '$1- $2')
  text = text.replace(/^[ \t]*<\/?[uo]l>[ \t]*$\n?/gm, '')
  text = text.replace(/<br\s*\/?>/g, '  \n')

  for (const [pattern, replacement] of INLINE) text = text.replace(pattern, replacement)
  return text
}

/** Parse a javadoc comment: its HTML translated, then read as Markdown. */
export function parseJavadoc(raw: string): ParsedMarkdownDoc {
  return parseMarkdownDocFull(javadocToMarkdown(raw), 'java')
}
