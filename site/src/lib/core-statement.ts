/**
 * Where an API call sits in a displayed program.
 *
 * A recording names each call by an anchor, the text of its first line, and the
 * page finds the call's lines in whichever view of the program it shows. The
 * Error handling and Cleanup views add and remove lines, so no line number is
 * stored. `scripts/gen-core-recording.mjs` uses the same function to place its
 * markers, so the page and the recorder agree on what a call is.
 */

/** Inclusive, one-based line numbers. */
export type LineRange = readonly [start: number, end: number]

/**
 * The lines of the statement that holds `anchor`: from the line that contains
 * it to the line where the first parenthesis opened at or after it closes.
 * Strings, runes and `//` comments are skipped, so a bracket inside them does
 * not count. It returns nothing when the anchor is on no line or on several,
 * since a call that cannot be found once cannot be highlighted. A program that
 * makes the same call on several lines says which one with `occurrence`
 * (one-based, among the lines that hold the anchor).
 */
export function statementLines(code: string, anchor: string, comment = '//', occurrence?: number): LineRange | undefined {
  const lines = code.split('\n')
  const hits = lines.flatMap((line, index) => (line.includes(anchor) ? [index] : []))
  if (occurrence === undefined ? hits.length !== 1 : !Number.isInteger(occurrence) || occurrence < 1 || occurrence > hits.length) return undefined
  const first = hits[occurrence === undefined ? 0 : occurrence - 1]!
  let depth = 0
  let opened = false
  let quote: string | undefined
  for (let index = first; index < lines.length; index++) {
    const line = lines[index]!
    for (let column = index === first ? line.indexOf(anchor) : 0; column < line.length; column++) {
      const char = line[column]!
      if (quote) {
        if (char === '\\' && quote !== '`') column++
        else if (char === quote) quote = undefined
        continue
      }
      if (line.startsWith(comment, column)) break
      if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '(') { depth++; opened = true }
      else if (char === ')') { depth--; if (opened && depth === 0) return [first + 1, index + 1] }
    }
    // A quote that is not closed by the end of its line is a raw string only when it is a backtick.
    if (quote && quote !== '`') quote = undefined
    if (!opened) return [first + 1, first + 1]
  }
  return undefined
}
