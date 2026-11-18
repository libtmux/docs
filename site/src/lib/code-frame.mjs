/**
 * What a code frame says about its own code: whether it is an excerpt or a
 * complete program, which source lines an excerpt quotes, and how many lines
 * it shows before it scrolls.
 *
 * `remark-port-code.mjs` and the landing page write these into a fence's info
 * string; `plugins/ec-code-frame.mjs` reads them back when Expressive Code
 * draws the frame. Plain `.mjs`, because `ec.config.mjs` loads it outside the
 * Astro build.
 *
 * The info string attributes:
 *   role="excerpt" | "program"   the label in the frame header
 *   lines="59-78"                the source lines an excerpt quotes; ranges
 *                                joined by a comma ("12-40,55-60") are shown
 *                                one after the other with a blank row between
 *   height="16" | "full"         show this many lines, then scroll; without it a
 *                                frame shows every line
 *   program="main.go"            on an excerpt: the complete program on the same
 *                                page holds these lines, so the range links to them
 *   cite="6,59-78"               on a complete program: the lines excerpts of the
 *                                page quote, so the program numbers its lines and
 *                                the range links land on them (record 0054)
 */

const EN_DASH = '–'

/** The role names a frame header can carry. */
const ROLE_NAMES = { excerpt: 'Excerpt', program: 'Complete program' }

/** A cap this close to the total hides a line or two behind a button, so it is dropped. */
const CAP_SLACK = 3

/**
 * `"59-78"`, `"12-40,55-60"` or `"7"` as ranges of source lines. A spec that is
 * not a list of ascending line numbers gives none, so a typo never shows as a
 * wrong range.
 * @param {string | undefined} spec
 * @returns {{ start: number, end: number }[]}
 */
export function parseLines(spec) {
  if (!spec) return []
  const ranges = []
  for (const part of spec.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!match) return []
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (start < 1 || end < start) return []
    ranges.push({ start, end })
  }
  return ranges
}

/**
 * The ranges as the header writes them: `lines 59–78`, `line 7`, `lines 12–40, 55–60`.
 * @param {{ start: number, end: number }[]} ranges
 */
export function formatLines(ranges) {
  if (!ranges.length) return ''
  const one = ranges.length === 1 && ranges[0].start === ranges[0].end
  const text = ranges.map(({ start, end }) => (start === end ? `${start}` : `${start}${EN_DASH}${end}`)).join(', ')
  return `${one ? 'line' : 'lines'} ${text}`
}

/**
 * The words of a frame's role label, or undefined for a role the design does not name.
 * @param {string | undefined} role
 * @param {{ start: number, end: number }[]} ranges
 */
export function roleLabel(role, ranges) {
  const name = role && Object.hasOwn(ROLE_NAMES, role) ? ROLE_NAMES[role] : undefined
  if (!name) return undefined
  return { name, detail: role === 'excerpt' ? formatLines(ranges) : '' }
}

/**
 * A line range as the URL fragment of a numbered program names it: `L63-L72`, or `L7`.
 * @param {{ start: number, end: number }} range
 */
export function rangeFragment({ start, end }) {
  return start === end ? `L${start}` : `L${start}-L${end}`
}

/**
 * The `cite` attribute of a complete program: the ranges its excerpts quote,
 * once each and in source order; undefined when nothing quotes it.
 * @param {{ start: number, end: number }[]} ranges
 */
export function citeMeta(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const unique = sorted.filter((range, index) => index === 0 || range.start !== sorted[index - 1].start || range.end !== sorted[index - 1].end)
  return unique.length ? unique.map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`)).join(',') : undefined
}

/**
 * The source line number of each row of an excerpt; a blank row between two
 * ranges has none. Undefined when the rows are not the lines the ranges
 * describe, so a frame never shows numbers that are wrong.
 * @param {{ start: number, end: number }[]} ranges
 * @param {number} count the rows of code
 * @returns {(number | undefined)[] | undefined}
 */
export function lineNumbers(ranges, count) {
  if (!ranges.length) return undefined
  /** @type {(number | undefined)[]} */
  const rows = []
  ranges.forEach(({ start, end }, index) => {
    if (index > 0) rows.push(undefined)
    for (let line = start; line <= end; line++) rows.push(line)
  })
  return rows.length === count ? rows : undefined
}

/**
 * How many lines a frame of `total` lines shows before it scrolls; 0 shows
 * them all. A cap within three lines of the total is ignored.
 * @param {number} total
 * @param {number} requested
 */
export function lineCap(total, requested) {
  if (!Number.isInteger(requested) || requested < 1) return 0
  return total <= requested + CAP_SLACK ? 0 : requested
}

/**
 * The cap a frame asks for: its author's `height`, and nothing else. A frame
 * shows every line unless its author sets a cap (record 0027).
 * @param {{ height?: string, role?: string }} request
 * @param {number} total
 */
export function requestedCap(request, total) {
  // An excerpt is short and every line of it is explained.
  if (request.height === undefined || request.height === 'full' || request.role === 'excerpt') return 0
  return lineCap(total, Number(request.height))
}

/**
 * The info string attributes of an excerpt: its role and source lines, and
 * its file in a file-tab frame when the caller does not name one itself.
 * `program` names the complete program on the page that holds these lines.
 * @param {{ title?: string, ranges: { start: number, end: number }[], program?: string }} excerpt
 */
export function excerptMeta({ title, ranges, program }) {
  const lines = ranges.map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`)).join(',')
  return `${title === undefined ? '' : `title="${title}" frame="code" `}role="excerpt" lines="${lines}"${program === undefined ? '' : ` program="${program}"`}`
}
