/**
 * The 80-column budget for code in examples, held as a ratchet.
 *
 * Each page keeps the count of over-budget lines it has today and may only
 * lower it. The count is per page, so a fix and a regression in the same page
 * cancel; the page-level record is what stays reviewable.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { SESSION_LANGS, sessionLines } from '../plugins/ec-shell-prompt.mjs'
import { CODE_COLUMNS, codeWidthFailures } from './code-layout.ts'

/** Over-budget line counts by page, relative to the content root; pages at zero are absent. */
export type ExampleColumns = Record<string, number>

/**
 * Fences that declare their text a transcript, which the site renders as plain
 * text. `text` is not here: it also labels authored diagrams and any language
 * the site does not know, so it is measured like code.
 */
const TRANSCRIPT_FENCES = new Set(['output', 'log'])

interface CodeBlock {
  /** The line of the page that holds the first line of `text`. */
  line: number
  language: string
  text: string
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Every code block of a page as the site's Markdown parser sees it: fenced
 * or indented, in a list, a quotation or at the top. A line scanner misses
 * the nested ones, so a block written there would go unmeasured.
 */
function codeBlocks(markdown: string): CodeBlock[] {
  // Front matter is data; blanking it keeps every offset and line.
  const source = markdown.replace(FRONT_MATTER, (front) => front.replaceAll(/[^\n]/g, ' '))
  const found: CodeBlock[] = []
  visit(fromMarkdown(source), 'code', (node) => {
    const { start, end } = node.position!
    const fenced = /^\s*(?:`{3,}|~{3,})/.test(source.slice(start.offset, end.offset))
    found.push({ line: start.line + (fenced ? 1 : 0), language: (node.lang ?? '').toLowerCase(), text: node.value })
  })
  return found
}

/** The block text a reader types or reads as code, with output lines blanked so line numbers hold. */
function budgetedText({ language, text }: CodeBlock): string {
  if (TRANSCRIPT_FENCES.has(language)) return ''
  if (!SESSION_LANGS.has(language)) return text
  const lines = text.split('\n')
  return sessionLines(lines).map(({ kind }, index) => (kind === 'output' ? '' : lines[index])).join('\n')
}

/** Every over-budget line in a page's code blocks, by line in the page. */
export async function wideLines(markdown: string): Promise<{ line: number; columns: number }[]> {
  const found: { line: number; columns: number }[] = []
  for (const block of codeBlocks(markdown)) {
    for (const { line, columns } of await codeWidthFailures(budgetedText(block), 'example')) {
      found.push({ line: block.line + line - 1, columns })
    }
  }
  return found
}

/**
 * Every Markdown and MDX page under the content root, in every locale and port.
 * `_staged` is the gitignored copy of guides that a port's repository owns.
 */
function pagesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((page) => page.split('/')[0] !== '_staged')
    .sort()
}

/** Over-budget line counts for every page under a content root. */
export async function measureExampleColumns(root: string): Promise<ExampleColumns> {
  const counts: ExampleColumns = {}
  for (const page of pagesUnder(root)) {
    const { length } = await wideLines(readFileSync(join(root, page), 'utf8'))
    if (length) counts[page] = length
  }
  return counts
}

/** Pages with more over-budget lines than the baseline records, new pages included. */
export function raisedPages(measured: ExampleColumns, baseline: ExampleColumns): string[] {
  return Object.keys(measured).filter((page) => measured[page]! > (baseline[page] ?? 0))
}

/**
 * Move baseline entries to the pages that replaced them. A rename keeps its
 * count and nothing else, so the new page may not measure higher than the
 * entry it takes over.
 */
export function renamePages(
  baseline: ExampleColumns, measured: ExampleColumns, renames: [from: string, to: string][],
): { baseline: ExampleColumns; problems: string[] } {
  const next = { ...baseline }
  const problems: string[] = []
  for (const [from, to] of renames) {
    if (!(from in next)) problems.push(`${from}: no baseline entry to rename`)
    else if (to in next) problems.push(`${to}: already has a baseline entry`)
    else if ((measured[to] ?? 0) > next[from]!) {
      problems.push(`${to}: ${measured[to]} lines over ${CODE_COLUMNS.example} columns, more than the ${next[from]} that ${from} recorded`)
    } else {
      next[to] = next[from]!
      delete next[from]
    }
  }
  return { baseline: next, problems }
}

/**
 * Why the measurement and the baseline disagree, one message per page. An
 * empty list means they match exactly: a lower count must lower the baseline
 * in the same change, or the slack would let the page regress unnoticed.
 */
export function ratchetProblems(measured: ExampleColumns, baseline: ExampleColumns): string[] {
  const limit = CODE_COLUMNS.example
  const problems = Object.entries(baseline)
    .filter(([, allowed]) => !Number.isInteger(allowed) || allowed < 1)
    .map(([page, allowed]) => `${page}: a baseline entry is a positive whole number of lines, not ${allowed}`)
  for (const page of [...new Set([...Object.keys(measured), ...Object.keys(baseline)])].sort()) {
    const found = measured[page] ?? 0
    const allowed = baseline[page] ?? 0
    if (found > allowed) {
      problems.push(page in baseline
        ? `${page}: ${found} lines over ${limit} columns, the baseline allows ${allowed}`
        : `${page}: ${found} lines over ${limit} columns, and the page is not in the baseline`)
    } else if (found < allowed) {
      problems.push(`${page}: ${found} lines over ${limit} columns, the baseline still records ${allowed}`)
    }
  }
  return problems
}
