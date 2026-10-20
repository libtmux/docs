/**
 * Excerpts of tested example sources.
 *
 * A fence quotes part of a tested file by naming its first and last line
 * instead of copying them, so a step cannot drift from the program the page
 * runs. The build fails when an anchor stops resolving.
 */

/** A bad excerpt: the message names the source and the anchor to fix. */
export class ExcerptError extends Error {
  override name = 'ExcerptError'
}

export type FenceAttributes = Record<string, string>

const ATTRIBUTE = /(\w+)=(?:"([^"]*)"|'([^']*)')/g

/** `name="value"` and `name='value'` pairs of a fence's info string. */
export function parseFenceAttributes(meta: string | null | undefined): FenceAttributes {
  const attributes: FenceAttributes = {}
  for (const match of (meta ?? '').matchAll(ATTRIBUTE)) attributes[match[1]!] = match[2] ?? match[3]!
  return attributes
}

/** An info string without the named attributes; the others keep their order. */
export function withoutAttributes(meta: string, names: readonly string[]): string {
  return meta.replace(ATTRIBUTE, (all, name: string) => names.includes(name) ? '\0' : all)
    .replace(/ *\0 */g, ' ').trim()
}

export interface ExcerptRequest {
  /** Text on the first line; exactly one line of the source may contain it. */
  from: string
  /** Text on the last line; the first line after `from` that contains it ends the excerpt. */
  to?: string
}

/**
 * Lines that match an anchor. Text matches any line that contains it; text
 * after a leading `=` matches only a line equal to it, indentation included,
 * which names a closing `}` or `fi` at the depth of the block it ends. `\t`
 * in that text stands for a tab.
 */
const matching = (lines: readonly string[], anchor: string) => {
  const exact = anchor.startsWith('=') ? anchor.slice(1).replaceAll('\\t', '\t') : undefined
  return lines.flatMap((line, index) => (exact === undefined ? line.includes(anchor) : line === exact) ? [index] : [])
}

/** Leading whitespace shared by every non-blank line. */
function commonIndent(lines: readonly string[]): string {
  let indent: string | undefined
  for (const line of lines) {
    if (!line.trim()) continue
    const own = /^\s*/.exec(line)![0]
    if (indent === undefined) indent = own
    else {
      let length = 0
      while (length < indent.length && length < own.length && indent[length] === own[length]) length++
      indent = indent.slice(0, length)
    }
  }
  return indent ?? ''
}

/**
 * The lines of `source` from the one that contains `from` through the first
 * later one that contains `to`, or just the first when `to` is omitted. The
 * indentation they share is removed.
 *
 * `from` must match exactly one line. `to` ends the range at its first match
 * after `from`, so a block can end at a closing line such as `fi` or `}` that
 * the file repeats; `to="=  }"` names the closer at that indentation.
 */
export function sliceExcerpt(source: string, { from, to }: ExcerptRequest, label: string): string {
  if (!from) throw new ExcerptError(`${label}: empty from anchor`)
  if (to === '') throw new ExcerptError(`${label}: empty to anchor`)
  const lines = source.replace(/\r\n/g, '\n').split('\n')

  const starts = matching(lines, from)
  if (!starts.length) throw new ExcerptError(`${label}: from anchor "${from}" matches no line`)
  if (starts.length > 1) {
    throw new ExcerptError(`${label}: from anchor "${from}" is ambiguous: it matches lines ${starts.map((index) => index + 1).join(', ')}`)
  }
  const start = starts[0]!

  let end = start
  if (to !== undefined) {
    const found = matching(lines, to)
    const later = found.find((index) => index > start)
    if (later === undefined) {
      if (!found.length) throw new ExcerptError(`${label}: to anchor "${to}" matches no line`)
      throw new ExcerptError(found[0]! === start
        ? `${label}: to anchor "${to}" appears only at line ${start + 1}, the from anchor's own line`
        : `${label}: to anchor "${to}" appears only at line ${found[0]! + 1}, above the from anchor at line ${start + 1}`)
    }
    end = later
  }

  const picked = lines.slice(start, end + 1)
  const indent = commonIndent(picked)
  return picked.map((line) => line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()).join('\n')
}

/** Where an excerpt's text comes from. */
export type ExcerptSource =
  /** A titled, literal code block elsewhere on the same page. */
  | { kind: 'page'; name: string }
  /** A file in a port's revision-bound example cache. */
  | { kind: 'file'; name: string }

export interface ExcerptFence extends ExcerptRequest {
  source: ExcerptSource
}

/** Attributes that make a fence an excerpt, removed from the rendered and exported fence. */
export const EXCERPT_ATTRIBUTES = ['excerpt', 'file', 'from', 'to'] as const

/**
 * The excerpt a fence asks for, or undefined for any other fence.
 *
 * `excerpt="send-command.sh"` quotes the page's block of that title and
 * `file="examples/main.go"` quotes the port's cached file; `from` and `to`
 * select the lines. A fence with `file` alone still includes the whole file.
 */
export function excerptRequest(attributes: FenceAttributes): ExcerptFence | undefined {
  const { excerpt, file, from, to } = attributes
  if (from === undefined && to === undefined && excerpt === undefined) return undefined
  if (excerpt !== undefined && file !== undefined) throw new ExcerptError('an excerpt names both excerpt and file; use one source')
  if (excerpt === undefined && file === undefined) throw new ExcerptError('an excerpt names no source; add excerpt="<title>" or file="<path>"')
  if (!from) throw new ExcerptError(`an excerpt of ${excerpt ?? file} needs a from anchor`)
  return excerpt !== undefined
    ? { source: { kind: 'page', name: excerpt }, from, to }
    : { source: { kind: 'file', name: file! }, from, to }
}

export interface PageBlock {
  meta?: string | null
  value: string
}

/** The one literal block titled `title`; excerpts and file inclusions are not sources. */
export function pageSource(blocks: readonly PageBlock[], title: string, label: string): string {
  const sources = blocks.filter((block) => {
    const attributes = parseFenceAttributes(block.meta)
    return attributes.title === title && attributes.file === undefined && attributes.excerpt === undefined
  })
  if (sources.length !== 1) {
    throw new ExcerptError(sources.length
      ? `${label}: ${sources.length} code blocks titled "${title}"; an excerpt needs exactly one`
      : `${label}: no code block titled "${title}" for an excerpt to quote`)
  }
  return sources[0]!.value
}
