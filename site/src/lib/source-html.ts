/**
 * A source file as numbered, highlighted lines.
 *
 * The tokens come from the same Shiki setup as every code block on the site,
 * so a file reads in the colours of an Expressive Code frame in both themes.
 * Each distinct colour pair is one class, written once per page, because a
 * style attribute on every token would make a large file several times its size.
 */
import { highlightTokens, type CodeHighlight } from './highlight'
import { kindMark, kindPalette, markClass } from './api-labels'
import type { SourceDeclaration } from './source-declarations'

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** A reference page a gutter mark links to. */
export interface GutterMark {
  href: string
  title: string
  kind: string
}

export interface SourceLines {
  /** The `<span>` of each line, ready to sit in a `<pre>`. */
  html: string
  /** Rules for the token classes and for the line ranges the page can target. */
  css: string
  lines: number
}

type Token = CodeHighlight['lines'][number][number]

/** One class per distinct colour and style, numbered in order of first use. */
function tokenClasses() {
  const classes = new Map<string, string>()
  const rules: string[] = []
  const classOf = (token: Token) => {
    const style = token.light.fontStyle | token.dark.fontStyle
    const key = `${token.light.color}|${token.dark.color}|${style}`
    let name = classes.get(key)
    if (!name) {
      name = `t${classes.size}`
      classes.set(key, name)
      const decorations = [style & 4 ? 'underline' : '', style & 8 ? 'line-through' : ''].filter(Boolean).join(' ')
      rules.push(`.lm-src .${name}{--shiki-light:${token.light.color};--shiki-dark:${token.dark.color}`
        + `${style & 1 ? ';font-style:italic' : ''}${style & 2 ? ';font-weight:600' : ''}${decorations ? `;text-decoration:${decorations}` : ''}}`)
    }
    return name
  }
  return { classOf, rules }
}

/** The mark of a documented declaration, drawn as the reference's compact kind mark. */
function gutterMark({ href, title, kind }: GutterMark): string {
  const mark = kindMark(kind) ?? kind.slice(0, 1)
  return `<b class="gm"><a href="${escape(href)}" title="${escape(title)}" aria-label="${escape(title)}">`
    + `<span class="api-nav__kind api-badge--kind-${kindPalette(kind)}" aria-hidden="true">`
    + `<span class="api-badge__label" data-mark="${markClass(mark)}">${escape(mark)}</span></span></a></b>`
}

/**
 * Numbered lines of `content`. `marks` maps a 1-based line to its gutter mark and
 * `ranges` lists the spans a fragment such as `#L112-L129` can name, so the page
 * highlights them from CSS alone.
 */
export async function sourceLines(
  content: string,
  language: string,
  marks: ReadonlyMap<number, GutterMark> = new Map(),
  ranges: readonly Pick<SourceDeclaration, 'from' | 'to'>[] = [],
): Promise<SourceLines> {
  const text = content.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const highlight = await highlightTokens(text, language)
  const rows = text.split('\n')
  const { classOf, rules } = highlight ? tokenClasses() : { classOf: () => '', rules: [] as string[] }
  const anchors = new Map<number, string[]>()
  const seen = new Set<string>()
  const targets: string[] = []
  for (const { from, to } of ranges) {
    const id = `L${from}-L${to}`
    if (to <= from || seen.has(id)) continue
    seen.add(id)
    anchors.set(from, [...(anchors.get(from) ?? []), `<i class="lm-range" id="${id}" aria-hidden="true"></i>`])
    targets.push(`.lm-src:has(#${id}:target)>span:nth-child(n+${from}):nth-child(-n+${to})>code`)
  }
  const html = rows.map((row, index) => {
    const number = index + 1
    const tokens = highlight?.lines[index]
    const code = tokens?.length ? tokens.map((token) => `<span class="${classOf(token)}">${escape(token.content)}</span>`).join('') : escape(row)
    const mark = marks.get(number)
    return `<span id="L${number}" data-n="${number}">${anchors.get(number)?.join('') ?? ''}${mark ? gutterMark(mark) : ''}<code>${code}</code>\n</span>`
  }).join('')
  const target = targets.length ? `${targets.join(',')}{background:var(--color-highlight-on-target)}` : ''
  return { html, css: [...rules, target].filter(Boolean).join('\n'), lines: rows.length }
}
