import type { DocBlock } from '../model.ts'

/**
 * Doc comments in the five languages that write Markdown in them.
 *
 * Rust, TypeScript, Go, Java and C# all put prose and fenced code in a
 * comment above the declaration. The spec extractor was splitting that on the
 * first blank line — summary, then everything else as one body string — which
 * meant 434 fenced examples in libtmux-rs reached the reference as literal
 * ```` ``` ```` fences inside a paragraph, and nothing carried them to the
 * renderer that knows how to draw an example.
 *
 * Python is not handled here. Its docstrings are NumPy-sectioned, which is a
 * different grammar with its own parser in `python.ts`.
 */

/** ` ```lang ` … ` ``` `, with the language optional. */
const FENCE = /^\s*(?:```|~~~)\s*([\w+-]*)\s*$/

/**
 * Rust spells doctest behaviour where other languages spell a language.
 *
 * ` ```no_run ` and ` ```compile_fail ` say what cargo should do with the
 * block, not what it is written in — it is Rust either way, and a renderer
 * asked to highlight `compile_fail` highlights nothing.
 */
const RUST_ATTRS = new Set([
  'no_run',
  'should_panic',
  'compile_fail',
  'ignore',
  'edition2015',
  'edition2018',
  'edition2021',
  'edition2024',
])

/**
 * A Rust-style section heading: `# Examples`, `# Panics`, `# Errors`.
 *
 * Matched only at the start of a line and only for the handful of headings
 * these conventions actually use, because `#` opens a comment in some of
 * these languages and a heading in others.
 */
const HEADING = /^\s*#{1,3}\s+(Examples?|Panics|Errors|Safety|Notes?|Returns?|Arguments)\s*$/i

/**
 * @param defaultLang what a bare fence means in this language. A ```` ``` ````
 * with no language in a Rust doc comment is Rust, and rendering it as plain
 * text throws away the highlighting for the 104 blocks that are written that
 * way.
 */
/**
 * A javadoc or TSDoc block tag: `@param name text`, `@return text`.
 *
 * Only at the start of a line, because `@` is ordinary inside prose and
 * `foo@example.com` is not a tag. Java writes 183 `@param` in libtmux-java
 * and none of them reached a field list, because this parser treated the
 * whole comment as prose.
 */
const BLOCK_TAG = /^\s*@(param|arg|argument|returns?|throws|exception|deprecated|since)\b\s*(.*)$/

export interface ParsedMarkdownDoc {
  doc: DocBlock
  params: Map<string, string>
  returnsDoc?: string
  raises: { type: string; doc?: string }[]
}

/**
 * Drop an example that repeats the one immediately before it.
 *
 * Four consecutive accessors in libtmux-ts carry their example twice, the
 * whole fenced block copied — an authoring slip, and the reference rendered
 * both. Only an *adjacent* repeat is dropped, never an identical block later
 * in the run: a walkthrough legitimately shows the same verification step
 * again after a different setup, which is how libtmux's own `set_hooks`
 * docstring is written, and deduplicating those would cut a step out of it.
 */
function dropAdjacentRepeats<T extends { code: string }>(list: T[]): T[] {
  return list.filter((e, i) => i === 0 || e.code !== list[i - 1].code)
}

export function parseMarkdownDoc(raw: string, defaultLang = 'text'): DocBlock {
  return parseMarkdownDocFull(raw, defaultLang).doc
}

export function parseMarkdownDocFull(raw: string, defaultLang = 'text'): ParsedMarkdownDoc {
  const lines = raw.split('\n')
  const prose: string[] = []
  const examples: { lang: string; code: string; intro?: string }[] = []

  let fence: { lang: string; code: string[]; indent: number } | undefined
  /** Prose since the last block, which introduces the next one. */
  let pending: string[] = []
  let inExamples = false

  const params = new Map<string, string>()
  const raises: { type: string; doc?: string }[] = []
  let returnsDoc: string | undefined
  /** The block tag currently collecting continuation lines. */
  let tag: { kind: string; name?: string; text: string[] } | undefined

  const closeTag = () => {
    if (!tag) return
    const text = tag.text.join(' ').replace(/\s+/g, ' ').trim()
    if (tag.kind === 'param' && tag.name) params.set(tag.name, text)
    else if (tag.kind === 'returns') returnsDoc = text || undefined
    else if (tag.kind === 'throws' && tag.name) raises.push({ type: tag.name, doc: text || undefined })
    tag = undefined
  }

  for (const line of lines) {
    const fenced = FENCE.exec(line)
    if (fence) {
      if (fenced) {
        const open = fence
        examples.push({
          lang: !open.lang || RUST_ATTRS.has(open.lang) ? defaultLang : open.lang,
          // Rust hides setup lines from rendered docs with a leading `#`.
          // They are part of the compiled doctest and not part of the example
          // a reader is being shown.
          code: open.code
            .filter((l) => !/^\s*#\s/.test(l) && l.trim() !== '#')
            .map((l) => l.slice(open.indent))
            .join('\n')
            .replace(/\s+$/, ''),
          intro: pending.join(' ').replace(/\s+/g, ' ').trim() || undefined,
        })
        pending = []
        fence = undefined
        continue
      }
      fence.code.push(line)
      continue
    }
    if (fenced) {
      fence = { lang: fenced[1], code: [], indent: line.length - line.trimStart().length }
      continue
    }
    const block = BLOCK_TAG.exec(line)
    if (block) {
      closeTag()
      const kind = /^(param|arg|argument)$/.test(block[1])
        ? 'param'
        : /^returns?$/.test(block[1])
          ? 'returns'
          : /^(throws|exception)$/.test(block[1])
            ? 'throws'
            : block[1]
      // `@param name description` — the name is the first word for param and
      // throws, and absent for the rest.
      const rest = block[2] ?? ''
      const needsName = kind === 'param' || kind === 'throws'
      const [first, ...tail] = rest.split(/\s+/)
      tag = needsName
        ? { kind, name: first || undefined, text: tail }
        : { kind, text: rest ? [rest] : [] }
      continue
    }
    if (tag) {
      // A blank line ends a tag; an indented continuation extends it.
      if (!line.trim()) closeTag()
      else tag.text.push(line.trim())
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      // A heading ends whatever prose was accumulating and, for Examples,
      // marks that what follows belongs to the block rather than the body.
      inExamples = /^examples?$/i.test(heading[1])
      pending = []
      if (!inExamples) prose.push(line)
      continue
    }
    if (inExamples) {
      if (line.trim()) pending.push(line.trim())
      continue
    }
    prose.push(line)
  }

  closeTag()

  const text = prose.join('\n').trim()
  const [summary, ...rest] = text.split(/\n\s*\n/)

  return {
    doc: {
      summary: (summary ?? '').replace(/\s+/g, ' ').trim(),
      body: rest.join('\n\n').trim() || undefined,
      examples: examples.length ? dropAdjacentRepeats(examples) : undefined,
    },
    params,
    returnsDoc,
    raises,
  }
}
