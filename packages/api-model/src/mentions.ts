/**
 * A code span that might name a symbol.
 *
 * Deliberately loose — the resolver is what decides whether a name exists, and
 * an unresolved mention renders as plain text, which is what it already was.
 * This only filters out spans that could not be a reference under any reading,
 * so the resolver is not asked about shell snippets and prose fragments.
 */
export function looksLikeApiMention(text: string): boolean {
  if (/\s/.test(text.trim()) && !/\(/.test(text)) return false
  if (/\(/.test(text)) return true
  if (/[.:]|->/.test(text)) return true
  // A bare identifier counts only when it is type-cased, which is how every
  // port in this estate spells a type.
  return /^[A-Z][A-Za-z0-9_]*$/.test(text)
}

/** One code span found in a port-labelled table row. */
export interface TableMention {
  port: string
  text: string
  /** 1-based line in the source, for reporting. */
  line: number
}

/**
 * Read the port-labelled tables out of a Markdown document.
 *
 * The estate's prose compares the same operation across ports in a table whose
 * first column names the language — `| Python | \`server.sessions\` | …`. That
 * is the structure `rehype-api-links` reads from the rendered tree, and this
 * reads the same structure from the source, so a mention index can be built
 * before anything renders.
 *
 * Pipe tables only. A cell's code spans are its backticked runs; anything else
 * in the cell is prose.
 */
/**
 * Split a pipe-table row into cells.
 *
 * Scanned rather than matched with a regex, because a pipe inside a code span
 * is content: `str | None` is one type annotation, and a lookahead clever
 * enough to know that is a lookahead nobody can read. Tracking backtick state
 * across the line is both shorter and right.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (const ch of line.replace(/^\|/, '').replace(/\|$/, '')) {
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += ch
  }
  cells.push(cell.trim())
  return cells
}

export function tableMentions(
  markdown: string,
  portByLabel: Record<string, string>,
): TableMention[] {
  const out: TableMention[] = []
  const lines = markdown.split('\n')

  for (const [i, line] of lines.entries()) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = splitRow(line.trim())
    if (cells.length < 2) continue

    const port = portByLabel[cells[0]]
    if (!port) continue

    for (const cell of cells.slice(1)) {
      for (const m of cell.matchAll(/`([^`]+)`/g)) {
        const text = m[1].trim()
        if (text && looksLikeApiMention(text)) out.push({ port, text, line: i + 1 })
      }
    }
  }
  return out
}

export interface ProseMention {
  text: string
  port?: string
  before: string
  linked?: boolean
  /** 1-based source line. */
  line: number
}

const FENCE_PORT: Record<string, string> = {
  python: 'py', py: 'py', typescript: 'ts', ts: 'ts', javascript: 'ts', js: 'ts',
  rust: 'rs', rs: 'rs', go: 'go', java: 'java', csharp: 'dotnet', cs: 'dotnet',
  cpp: 'cxx', 'c++': 'cxx', swift: 'swift',
}

/** Inline references in prose, including port sections, tables, and existing links. */
export function proseMentions(markdown: string, portByLabel: Record<string, string>): ProseMention[] {
  const out: ProseMention[] = []
  const lines = markdown.split('\n')
  const context: { port?: string; before: string }[] = []
  const bodyLines = lines.map(() => '')
  const sections: { depth: number; port?: string }[] = []
  let fence: string | undefined
  let fencePort: string | undefined
  let paragraph = ''
  let frontmatter = false

  for (const [i, line] of lines.entries()) {
    if (i === 0 && line.trim() === '---') { frontmatter = true; continue }
    if (frontmatter) {
      if (line.trim() === '---') frontmatter = false
      continue
    }
    const boundary = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/.exec(line)
    if (fence) {
      if (boundary && boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = undefined
      continue
    }
    if (boundary) {
      fence = boundary[1]
      fencePort = FENCE_PORT[boundary[2].toLowerCase()]
      paragraph = ''
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      while (sections.length && sections.at(-1)!.depth >= depth) sections.pop()
      sections.push({ depth, port: portByLabel[heading[2]] ?? sections.at(-1)?.port })
      fencePort = undefined
      paragraph = ''
      continue
    }
    if (!line.trim()) { paragraph = ''; continue }
    const row = line.trim().startsWith('|') ? splitRow(line.trim()) : undefined
    const port = (row && portByLabel[row[0]]) ?? fencePort ?? sections.at(-1)?.port
    context[i] = { port, before: paragraph }
    bodyLines[i] = line
    paragraph = row ? '' : `${paragraph}${line}\n`
  }

  const body = bodyLines.join('\n')
  for (const match of body.matchAll(/(?<!`)(`+)([^`]+)\1(?!`)/g)) {
    if (/\n\s*\n/.test(match[2])) continue
    const text = match[2].replace(/\n/g, ' ').trim()
    if (!text) continue
    const beforeMatch = body.slice(0, match.index)
    const line = beforeMatch.split('\n').length
    const ctx = context[line - 1]
    if (!ctx) continue
    const before = ctx.before + beforeMatch.slice(beforeMatch.lastIndexOf('\n') + 1)
    const linked = body[match.index - 1] === '[' && body.slice(match.index + match[0].length).startsWith('](')
    out.push({ text, port: ctx.port, before, line, ...(linked ? { linked: true } : {}) })
  }
  return out
}
