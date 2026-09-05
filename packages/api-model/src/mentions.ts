/**
 * Which code spans in prose are worth resolving against the reference.
 *
 * Shared, because two things need the same answer and would otherwise drift:
 * `rehype-api-links` decides it while rendering an HTML table, and
 * `scripts/gen-mentions.mjs` decides it while reading the Markdown that table
 * came from. A heuristic living in one of them and copied into the other is a
 * divergence waiting for the first edit.
 */

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
