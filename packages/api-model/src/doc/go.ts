import type { Parser } from 'web-tree-sitter'
import type { ParsedMarkdownDoc } from './markdown.ts'

const LIST = /^[ \t]*(?:[-+*•]|\d+[.)])[ \t]+\S/
const FENCE = /^ {0,3}(`{3,}|~{3,})([^`~]*)$/

/** Native Go documentation removes a common literal space/tab prefix. */
function unindent(source: string[]): string[] {
  const lines = [...source]
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()
  let prefix = /^[ \t]*/.exec(lines[0] ?? '')![0]
  for (const line of lines.filter((line) => line.trim())) {
    while (!line.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  return lines.map((line) => line.trim() ? line.slice(prefix.length) : '')
}

/** Syntax classification preserves non-Go preformatted output as plain text. */
function codeLanguage(code: string, parser: Parser): 'go' | 'text' {
  for (const source of [`package doc\n${code}`, `package doc\nfunc example() {\n${code}\n}`]) {
    const tree = parser.parse(source)
    const valid = tree && !tree.rootNode.hasError
    tree?.delete()
    if (valid) return 'go'
  }
  return 'text'
}

/** Preserve native block boundaries in Markdown without moving code past prose. */
export function parseGoDoc(raw: string, parser: Parser): ParsedMarkdownDoc {
  const lines = unindent(raw.replaceAll('\r\n', '\n').split('\n'))
  const blocks: { kind: 'prose' | 'other'; text: string }[] = []
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const fence = FENCE.exec(line)
    if (fence) {
      const code = [fence[2].trim() ? line : `${fence[1]}go`]
      const end = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      while (++index < lines.length) {
        code.push(lines[index])
        if (end.test(lines[index])) { index++; break }
      }
      blocks.push({ kind: 'other', text: code.join('\n') })
      continue
    }
    if (/^[ \t]/.test(line)) {
      const indented: string[] = []
      while (index < lines.length && (!lines[index].trim() || /^[ \t]/.test(lines[index]))) {
        indented.push(lines[index++])
      }
      const content = unindent(indented).join('\n')
      if (LIST.test(line)) {
        blocks.push({ kind: 'other', text: content.replace(/^([ \t]*)•(?=[ \t])/gm, '$1-')
          .replace(/^([ \t]*\d+)\)(?=[ \t])/gm, '$1.') })
      } else {
        const marker = '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map((match) => match[0].length + 1)))
        blocks.push({ kind: 'other', text: `${marker}${codeLanguage(content, parser)}\n${content}\n${marker}` })
      }
      continue
    }
    if (/^#\s+/.test(line)) {
      blocks.push({ kind: 'other', text: line }); index++; continue
    }
    const prose: string[] = []
    while (index < lines.length && lines[index].trim() && !/^[ \t]|^#\s+/.test(lines[index]) && !FENCE.test(lines[index])) {
      prose.push(lines[index++])
    }
    blocks.push({ kind: LIST.test(line) ? 'other' : 'prose', text: prose.join('\n') })
  }
  const first = blocks[0]?.kind === 'prose' ? blocks.shift()!.text : ''
  return { doc: { summary: first.replace(/\s+/g, ' ').trim(), body: blocks.map((block) => block.text).join('\n\n') || undefined },
    params: new Map(), raises: [] }
}
