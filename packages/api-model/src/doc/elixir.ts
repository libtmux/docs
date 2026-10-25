import { parseMarkdownDocFull, type ParsedMarkdownDoc } from './markdown.ts'

const FENCE = /^\s*(`{3,}|~{3,})/
const PROMPT = /^\s*(?:iex(?:\(\d+\))?|\.\.\.(?:\(\d+\))?)>/
/** ExDoc's admonition: `> #### Heading {: .warning}`. */
const ADMONITION = /^>\s*#{1,6}\s+(.*?)\s*\{:\s*\.(warning|error|info|tip|neutral)\s*\}\s*$/
const ADMONITION_KIND: Record<string, string> = { warning: 'WARNING', error: 'CAUTION', info: 'NOTE', tip: 'TIP', neutral: 'NOTE' }

const indentOf = (line: string) => /^ */.exec(line)![0].length

/**
 * An `iex>` doctest is an indented block in ExDoc's Markdown, and the shared
 * parser reads only fenced code. Fence it, keeping the prompts: a doctest is a
 * session, and its expected results are the lines without a prompt.
 *
 * A block belongs to the doctest it starts, so the blank lines inside a run of
 * `iex>` expressions do not end it; the first unindented or unprompted line
 * after a blank one does.
 */
function fenceDoctests(lines: string[]): string[] {
  const out: string[] = []
  let fence: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const opening = FENCE.exec(line)
    if (fence) {
      // A closing fence repeats the opening character at least as many times and carries no info string.
      if (opening && opening[1]![0] === fence[0] && opening[1]!.length >= fence.length && !line.replace(/^\s*[`~]+/, '').trim()) fence = undefined
      out.push(line)
      continue
    }
    if (opening) { fence = opening[1]!; out.push(line); continue }
    if (indentOf(line) >= 4 && PROMPT.test(line)) {
      const base = indentOf(line)
      const block: string[] = []
      while (i < lines.length) {
        const next = lines[i]!
        if (next.trim() && indentOf(next) < base) break
        if (!next.trim()) {
          // A blank line continues the session only while another prompt follows.
          const following = lines.slice(i + 1).find((entry) => entry.trim())
          if (!following || indentOf(following) < base || !PROMPT.test(following)) break
        }
        block.push(next.slice(Math.min(base, indentOf(next))))
        i++
      }
      i--
      out.push('```elixir', ...block, '```')
      continue
    }
    out.push(line)
  }
  return out
}

/** Rewrite ExDoc admonitions as the GitHub alerts the shared parser lifts into callouts. */
function alertAdmonitions(lines: string[]): string[] {
  const out: string[] = []
  let fence = false
  for (const line of lines) {
    if (FENCE.test(line)) fence = !fence
    const match = fence ? null : ADMONITION.exec(line)
    if (!match) { out.push(line); continue }
    out.push(`> [!${ADMONITION_KIND[match[2]!]}]`)
    if (match[1]) out.push(`> **${match[1]}**`)
  }
  return out
}

/** ExDoc Markdown: fenced and indented `iex>` examples, `## Examples` sections and `{: .warning}` admonitions. */
export function parseElixirDoc(raw: string): ParsedMarkdownDoc {
  const lines = alertAdmonitions(fenceDoctests(raw.replaceAll('\r\n', '\n').split('\n')))
  return parseMarkdownDocFull(lines.join('\n'), 'elixir')
}
