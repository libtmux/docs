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
 * What a language writes around code that holds no brackets: the comment that
 * runs to the end of a line and the quotes a string or a quoted name can sit in.
 * A bracket in any of them is text, so the scan below must read them as the
 * language does. Lisp's `'(a)` and Erlang's `$)` are code that looks like a
 * quote or a bracket to a scan written for C.
 */
export interface StatementSyntax {
  /** What starts a comment that runs to the end of the line. */
  comment: string
  /** The characters that open a string or quoted name. A backtick is raw: it has no escapes and may run past its line. */
  quotes: string
  /** What makes the next character a plain one, so that a quote or bracket it names is not one: Lisp's `#\`, Erlang's and Perl's `$`. */
  literal?: string
}

const DEFAULT: StatementSyntax = { comment: '//', quotes: '"\'`' }

/**
 * Syntax for the ports whose programs are not read as C is. Lisp quotes a form
 * with `'`, so `'("/bin/cat")` holds no string; Erlang's `'` quotes an atom and
 * its `%` starts a comment; Perl's `#` starts a comment except after the `$` of
 * `$#array`.
 */
const SYNTAX: Readonly<Record<string, StatementSyntax>> = {
  lisp: { comment: ';', quotes: '"', literal: '#\\' },
  erlang: { comment: '%', quotes: '"\'', literal: '$' },
  perl: { comment: '#', quotes: '"\'', literal: '$' },
}

/** How `port`'s programs are read: its own syntax if it needs one, else C's. */
export const syntaxOf = (port: string | undefined): StatementSyntax => (port === undefined ? undefined : SYNTAX[port]) ?? DEFAULT

/**
 * The lines of the statement that holds `anchor`: from the line that contains
 * it to the line where the first parenthesis opened at or after it closes.
 * Strings, character literals and comments are skipped, so a bracket inside
 * them does not count. It returns nothing when the anchor is on no line or on
 * several, since a call that cannot be found once cannot be highlighted. A
 * program that makes the same call on several lines says which one with
 * `occurrence` (one-based, among the lines that hold the anchor).
 *
 * `syntax` is a language's rules (`syntaxOf`), or just the text that starts its
 * comments, with the quotes of C, Go and Rust.
 */
export function statementLines(code: string, anchor: string, syntax: string | StatementSyntax = '//', occurrence?: number): LineRange | undefined {
  const { comment, quotes, literal } = typeof syntax === 'string' ? { ...DEFAULT, comment: syntax } : syntax
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
      if (literal && line.startsWith(literal, column)) {
        // The character after the prefix, and the one a backslash there escapes (Erlang's `$\n`; Lisp's `#\\` is complete).
        column += literal.length + (!literal.endsWith('\\') && line[column + literal.length] === '\\' ? 1 : 0)
        continue
      }
      if (quotes.includes(char)) quote = char
      else if (char === '(') { depth++; opened = true }
      else if (char === ')') { depth--; if (opened && depth === 0) return [first + 1, index + 1] }
    }
    // A quote that is not closed by the end of its line is a raw string only when it is a backtick.
    if (quote && quote !== '`') quote = undefined
    if (!opened) return [first + 1, first + 1]
  }
  return undefined
}
