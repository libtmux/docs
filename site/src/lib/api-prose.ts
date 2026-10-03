export interface ProseItem {
  text: string
  children: ProseItem[]
}

export type ProseBlock =
  | { kind: 'p'; text: string }
  | { kind: 'code'; code: string; lang: string }
  | { kind: 'ul'; items: ProseItem[] }
  /** `# Errors`, `# Panics`, `# Safety` — Rust's convention, and Go's. */
  | { kind: 'rubric'; text: string }

/**
 * Group lines into paragraphs and bullet lists.
 *
 * Nesting comes from indentation, which is how reST spells it. A bullet
 * deeper than the last opens a child list; a shallower one closes back to the
 * matching level.
 */
export function parseApiProse(source: string): ProseBlock[] {
  const blocks: ProseBlock[] = []
  const lines = source.split('\n')
  let para: string[] = []
  /** Open lists, innermost last, with the indent that opened each. */
  let stack: { indent: number; items: ProseItem[] }[] = []

  const flushPara = () => {
    const joined = para.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) blocks.push({ kind: 'p', text: joined })
    para = []
  }
  const flushList = () => {
    if (stack.length) blocks.push({ kind: 'ul', items: stack[0].items })
    stack = []
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const fence = /^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(raw)
    if (fence) {
      flushPara()
      flushList()
      const code: string[] = []
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i])
      blocks.push({ kind: 'code', code: code.join('\n'), lang: fence[2].trim().split(/\s+/)[0] || 'text' })
      continue
    }
    // A heading, not a comment: `#` opens a heading in a Markdown doc comment
    // and these render it. Left as text it printed "# Errors" mid-paragraph.
    const heading = /^\s*#{1,4}\s+(\S.*)$/.exec(raw)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ kind: 'rubric', text: heading[1].trim() })
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(raw)
    if (bullet) {
      flushPara()
      const indent = bullet[1].length
      const item: ProseItem = { text: bullet[2].trim(), children: [] }
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop()
      if (!stack.length) {
        stack.push({ indent, items: [item] })
      } else if (indent > stack[stack.length - 1].indent) {
        const parent = stack[stack.length - 1].items.at(-1)
        if (parent) {
          stack.push({ indent, items: parent.children })
          stack[stack.length - 1].items.push(item)
        }
      } else {
        stack[stack.length - 1].items.push(item)
      }
      continue
    }
    if (!raw.trim()) {
      // A blank line ends a paragraph but not a list: reST separates nested
      // bullets with blank lines, and treating one as a terminator flattened
      // every hierarchy in the corpus.
      flushPara()
      continue
    }
    if (stack.length) {
      // Prose at column zero after a list ends it; indented prose continues
      // the last item.
      if (/^\S/.test(raw)) flushList()
      else {
        const last = stack[stack.length - 1].items.at(-1)
        if (last) last.text += ` ${raw.trim()}`
        continue
      }
    }
    para.push(raw.trim())
  }
  flushPara()
  flushList()
  return blocks
}
