import { fromMarkdown } from 'mdast-util-from-markdown'
import { looksLikeApiMention } from './prose.ts'
export { looksLikeApiMention } from './prose.ts'

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
  /** Authored destination; a linked label must not be resolved by name again. */
  href?: string
  /** 1-based source line. */
  line: number
  /** Source offsets including the code span's delimiters. */
  start: number
  end: number
}

const FENCE_PORT: Record<string, string> = {
  python: 'py', py: 'py', typescript: 'ts', ts: 'ts', javascript: 'ts', js: 'ts',
  rust: 'rs', rs: 'rs', go: 'go', java: 'java', csharp: 'csharp', cs: 'csharp',
  cpp: 'cxx', 'c++': 'cxx', swift: 'swift',
  powershell: 'powershell', pwsh: 'powershell', ps1: 'powershell', julia: 'julia',
  elixir: 'elixir', ex: 'elixir', exs: 'elixir',
}

/** Inline references in prose, including port sections, tables, and existing links. */
export function proseMentions(markdown: string, portByLabel: Record<string, string>, portAt?: (offset: number) => string | undefined): ProseMention[] {
  const out: ProseMention[] = []
  const lines = markdown.split('\n')
  const context: { port?: string; before: string }[] = []
  // Keep offsets stable when frontmatter, headings and examples are masked.
  const bodyLines = lines.map((line) => ' '.repeat(line.length))
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
  interface MarkdownNode {
    type: string
    value?: string
    identifier?: string
    url?: string
    children?: MarkdownNode[]
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  const tree = fromMarkdown(body)
  const definitions = new Map<string, string>()
  const collectDefinitions = (node: MarkdownNode) => {
    if (node.type === 'definition' && node.identifier && node.url !== undefined) {
      const id = node.identifier.toLowerCase()
      if (!definitions.has(id)) definitions.set(id, node.url)
    }
    node.children?.forEach(collectDefinitions)
  }
  collectDefinitions(tree)
  const spans: { text: string; start: number; end: number; href?: string }[] = []
  const collectSpans = (node: MarkdownNode, href?: string) => {
    if (node.type === 'image' || node.type === 'imageReference') return
    if (node.type === 'link') href = node.url
    if (node.type === 'linkReference') href = definitions.get(node.identifier!.toLowerCase())
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (node.type === 'inlineCode' && start !== undefined && end !== undefined) {
      spans.push({ text: node.value!, start, end, ...(href !== undefined ? { href } : {}) })
    }
    node.children?.forEach((child) => collectSpans(child, href))
  }
  collectSpans(tree)
  for (const span of spans) {
    const text = span.text.replace(/\n/g, ' ').trim()
    if (!text) continue
    const beforeMatch = body.slice(0, span.start)
    const line = beforeMatch.split('\n').length
    const ctx = context[line - 1]
    if (!ctx) continue
    const before = ctx.before + beforeMatch.slice(beforeMatch.lastIndexOf('\n') + 1)
    out.push({ text, port: portAt?.(span.start) ?? ctx.port, before, line,
      start: span.start, end: span.end,
      ...(span.href !== undefined ? { linked: true, href: span.href } : {}) })
  }
  return out
}
