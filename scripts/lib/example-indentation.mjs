/**
 * Whether an example kept the indentation its doc comment gave it.
 *
 * The comment margin (`*`, `///`, `#`, `--`) belongs to the comment; what
 * follows it is the author's code, and a model that flattens it shows
 * `.filter(...)` under `Session mine = ...` at the same column.
 */

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }
const decode = (text) => text.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])

/** A comment leader and the one space after it; a line without one is already code. */
const LEADER = /^(\s*)(?:\/\/[/!]?|\*(?!\/)|#+|--+|;+)( ?)/

/** A source line without its comment margin, and where its own indentation begins. */
export function sourceLine(line) {
  const leader = LEADER.exec(line)
  const rest = leader ? line.slice(leader[0].length) : line
  return { text: decode(rest).trim(), indent: /^[ \t]*/.exec(rest)[0].length }
}

/** Positions of each example line in the source, in order, or undefined when the block is not there. */
function locate(lines, source, start, window) {
  const found = [start]
  let at = start
  for (const line of lines.slice(1)) {
    let next = at + 1
    while (next < source.length && next <= at + window && source[next].text !== line.trim()) next++
    if (next >= source.length || next > at + window) return undefined
    found.push(next)
    at = next
  }
  return found
}

/**
 * Compare one example's relative indentation with its source comment's.
 *
 * `ok` and `lost` mean the block was found; `unlocated` means the source does
 * not contain it line for line (a doctest prompt, a rewritten fence), which
 * says nothing about its indentation. `single` has no relative indentation.
 */
export function compareIndentation(code, sourceText, window = 8) {
  const lines = code.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return { status: 'single' }
  const source = sourceText.split('\n').map(sourceLine)
  const relative = (indents) => indents.map((indent) => indent - Math.min(...indents))
  const expected = relative(lines.map((line) => /^[ \t]*/.exec(line)[0].length))
  let mismatch
  for (let start = 0; start < source.length; start++) {
    if (!source[start].text || source[start].text !== lines[0].trim()) continue
    const positions = locate(lines, source, start, window)
    if (!positions) continue
    const actual = relative(positions.map((position) => source[position].indent))
    const wrong = actual.findIndex((indent, i) => indent !== expected[i])
    if (wrong === -1) return { status: 'ok' }
    mismatch ??= { status: 'lost', line: lines[wrong], expected: actual[wrong], found: expected[wrong] }
  }
  return mismatch ?? { status: 'unlocated' }
}
