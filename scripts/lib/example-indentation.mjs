/**
 * Whether an example kept what its doc comment gave it: the indentation of
 * each line, and every line.
 *
 * The comment margin (`*`, `///`, `#`, `--`) belongs to the comment; what
 * follows it is the author's code, and a model that flattens it shows
 * `.filter(...)` under `Session mine = ...` at the same column. A model
 * that drops a `# comment` line has lost part of the example the same way.
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

/**
 * rustdoc's own rule for a line of a Rust code block: `# ` and a bare `#`
 * hide it, and `##` escapes to a literal `#`.
 */
export function rustdocLine(text) {
  if (text.startsWith('##')) return { text: text.replace('##', '#') }
  if (text === '#' || text.startsWith('# ')) return { hidden: true, text }
  return { text }
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
 * Compare one example with its source comment.
 *
 * `ok`, `lost` and `dropped` mean the block was found: `lost` changed a
 * line's relative indentation, `dropped` left out a line the source has
 * between the example's first and last lines. `unlocated` means the source
 * does not contain the block line for line (a doctest prompt, a rewritten
 * fence), which says nothing about it. `single` has no relative indentation.
 * With `rust`, a line rustdoc hides is not expected in the example.
 */
export function compareIndentation(code, sourceText, { window = 8, rust = false } = {}) {
  const lines = code.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return { status: 'single' }
  const source = sourceText.split('\n').map(sourceLine).map((line) => {
    if (!rust) return line
    const shown = rustdocLine(line.text)
    return { ...line, text: shown.text, hidden: shown.hidden }
  })
  const relative = (indents) => indents.map((indent) => indent - Math.min(...indents))
  const expected = relative(lines.map((line) => /^[ \t]*/.exec(line)[0].length))
  let mismatch
  for (let start = 0; start < source.length; start++) {
    if (!source[start].text || source[start].hidden || source[start].text !== lines[0].trim()) continue
    const positions = locate(lines, source.map((line) => (line.hidden ? { ...line, text: '\0' } : line)), start, window)
    if (!positions) continue
    // A comment line at the block's edge is a dropped line too, not a boundary.
    const comment = (line) => line && !line.hidden && (line.text === '#' || line.text.startsWith('# '))
    let from = start
    while (comment(source[from - 1])) from--
    let to = positions.at(-1)
    while (comment(source[to + 1])) to++
    const skipped = source.slice(from, to + 1)
      .filter((line, i) => !positions.includes(from + i) && line.text && !line.hidden)
    if (skipped.length) {
      mismatch ??= { status: 'dropped', line: skipped[0].text }
      continue
    }
    const actual = relative(positions.map((position) => source[position].indent))
    const wrong = actual.findIndex((indent, i) => indent !== expected[i])
    if (wrong === -1) return { status: 'ok' }
    mismatch ??= { status: 'lost', line: lines[wrong], expected: actual[wrong], found: expected[wrong] }
  }
  return mismatch ?? { status: 'unlocated' }
}
