/**
 * Render tmux window layouts as inline SVG that looks like a terminal.
 *
 * A TypeScript port of tmuxp's `tmux-layout` Sphinx directive. A layout and a
 * screen size place panes so they tile the screen with no gaps, the way tmux
 * splits a window. Each pane's shell commands are drawn top-left in a
 * fixed-width font and highlighted with Pygments' Bash classes, so the diagram
 * reads like the real terminal and carries the class names tmuxp's stylesheet
 * and ours colour (`gp`, `s1`, `c1` and the rest).
 *
 * The geometry, text placement, clipping and class names follow the Python
 * module; `site/test/tmux-layout.test.ts` pins that correspondence.
 */

/** Pixels per tmux character cell: column width, then row height. */
const CELL_WIDTH = 8
const CELL_HEIGHT = 17
/** Padding between a pane edge and its text. */
const PAD = 6
/** Approximate font ascent, for placing the first baseline below the padding. */
const FONT = 12
/** Baseline-to-baseline distance for stacked command lines. */
const LINE_HEIGHT = 17
/** The shell prompt before each command. `gp` is Pygments' Generic.Prompt. */
const PROMPT = '<tspan class="gp">❯ </tspan>'

/** The arrangements tmux's `select-layout` names. */
export const LAYOUTS = ['even-vertical', 'even-horizontal', 'main-vertical', 'main-horizontal', 'tiled'] as const
export type TmuxLayout = (typeof LAYOUTS)[number]

/** A layout could not be drawn: an unknown name, a bad size or no panes. */
export class TmuxLayoutError extends Error {
  override name = 'TmuxLayoutError'
}

/** A pane rectangle in character-cell coordinates. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function even(count: number, width: number, height: number, vertical: boolean): Rect[] {
  return Array.from({ length: count }, (_, index) => {
    if (vertical) {
      const top = (index * height) / count
      return { x: 0, y: top, w: width, h: ((index + 1) * height) / count - top }
    }
    const left = (index * width) / count
    return { x: left, y: 0, w: ((index + 1) * width) / count - left, h: height }
  })
}

function main(count: number, width: number, height: number, vertical: boolean, ratio = 0.5): Rect[] {
  if (vertical) {
    const mainWidth = width * ratio
    return [
      { x: 0, y: 0, w: mainWidth, h: height },
      ...even(count - 1, width - mainWidth, height, true).map((rect) => ({ ...rect, x: mainWidth + rect.x })),
    ]
  }
  const mainHeight = height * ratio
  return [
    { x: 0, y: 0, w: width, h: mainHeight },
    ...even(count - 1, width, height - mainHeight, false).map((rect) => ({ ...rect, y: mainHeight + rect.y })),
  ]
}

/** A grid that fills the screen; the last row spans the full width among its own panes. */
function tiled(count: number, width: number, height: number): Rect[] {
  let rows = 1
  let cols = 1
  while (rows * cols < count) {
    rows += 1
    if (rows * cols < count) cols += 1
  }
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const inRow = row < rows - 1 ? cols : count - cols * (rows - 1)
    const left = (col * width) / inRow
    const top = (row * height) / rows
    return { x: left, y: top, w: ((col + 1) * width) / inRow - left, h: ((row + 1) * height) / rows - top }
  })
}

/**
 * Place `count` panes on a `width` x `height` screen.
 *
 * @throws {TmuxLayoutError} When `count` is below one or the layout name is unknown.
 */
export function arrange(layout: string, count: number, width: number, height: number): Rect[] {
  if (count < 1) throw new TmuxLayoutError('a tmux layout needs at least one pane')
  if (count === 1) return [{ x: 0, y: 0, w: width, h: height }]
  switch (layout) {
    case 'even-vertical': return even(count, width, height, true)
    case 'even-horizontal': return even(count, width, height, false)
    case 'main-vertical': return main(count, width, height, true)
    case 'main-horizontal': return main(count, width, height, false)
    case 'tiled': return tiled(count, width, height)
    default: throw new TmuxLayoutError(`unknown layout '${layout}'; expected one of ${LAYOUTS.join(', ')}`)
  }
}

/**
 * Parse a `WxH` screen size.
 *
 * @throws {TmuxLayoutError} When the text is not two integers around an `x`.
 */
export function parseSize(size: string): [number, number] {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim())
  if (!match) throw new TmuxLayoutError(`invalid size '${size}'; expected WxH (e.g. 80x24)`)
  return [Number(match[1]), Number(match[2])]
}

/** Split directive content on `---` lines into the command lines of each pane. */
export function splitPanes(content: readonly string[]): string[][] {
  const panes: string[][] = [[]]
  for (const line of content) {
    if (line.trim() === '---') panes.push([])
    else panes.at(-1)!.push(line.trimEnd())
  }
  return panes.filter((pane) => pane.some((line) => line.trim())).map((pane) => pane.filter((line) => line.trim()))
}

/* ---------------------------------------------------------------------- */
/* Bash highlighting                                                       */
/* ---------------------------------------------------------------------- */

/**
 * Pygments' `BashLexer`, rule for rule.
 *
 * The state machine and its patterns are the lexer's own, so a command takes
 * the same classes here as in tmuxp's docs. Token names are Pygments' short
 * CSS classes; the empty string is plain text. Python's inline `(?s)` becomes
 * the `s` flag, and `\A` becomes `^`, which only matches at the start because
 * every rule is sticky.
 */
type Action = string | (string | null)[]
interface Rule { re: RegExp; action: Action; state?: string; id: string }
type Entry = Rule | { include: string }

const WORD = '\\p{L}\\p{N}_'
const SPACE = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`

/**
 * Rewrite a Python pattern so JavaScript matches the same text.
 *
 * Python reads `\w \d \s \b` and `.` over Unicode, while JavaScript's are
 * ASCII-only or differ at the edges (`\s` takes U+FEFF but not U+0085, `.`
 * stops at U+2028).
 */
function pythonPattern(pattern: string, dotAll: boolean): string {
  let out = ''
  let inClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (char === '\\') {
      index += 1
      const next = pattern[index]!
      if (next === 'w') out += inClass ? WORD : `[${WORD}]`
      else if (next === 's') out += inClass ? SPACE : `[${SPACE}]`
      else if (next === 'd') out += '\\p{Nd}'
      else if (next === 'b' && !inClass) out += BOUNDARY
      // The `u` flag rejects an escape that Python reads as the bare character.
      else out += /[\w^$\\.*+?()[\]{}|/]/.test(next) ? `\\${next}` : next
    } else if (char === '[' && !inClass) {
      if (pattern.startsWith('[\\w\\W]', index)) {
        out += '[^]'
        index += 5
      } else {
        inClass = true
        out += char
      }
    } else if (char === ']' && inClass) {
      inClass = false
      out += char
    } else if (char === '.' && !inClass && !dotAll) {
      out += '[^\\n]'
    } else {
      out += char
    }
  }
  return out
}

const rule = (pattern: string, action: Action, state?: string, flags = ''): Entry =>
  ({ re: new RegExp(pythonPattern(pattern, flags.includes('s')), `yu${flags}`), action, state, id: '' })
const include = (name: string): Entry => ({ include: name })

const STATES: Record<string, Entry[]> = {
  root: [include('basic'), rule('`', 'sb', 'backticks'), include('data'), include('interp')],
  interp: [
    rule('\\$\\(\\(', 'k', 'math'),
    rule('\\$\\(', 'k', 'paren'),
    rule('\\$\\{#?', 'si', 'curly'),
    rule('\\$[a-zA-Z_]\\w*', 'nv'),
    rule('\\$(?:\\d+|[#$?!_*@-])', 'nv'),
    rule('\\$', ''),
  ],
  basic: [
    rule('\\b(if|fi|else|while|in|do|done|for|then|return|function|case|select|break|continue|until|esac|elif)(?![\\w#$?!*@-])(\\s*)', ['k', 'w']),
    rule('\\b(alias|bg|bind|builtin|caller|cd|command|compgen|complete|declare|dirs|disown|echo|enable|eval|exec|exit|export|false|fc|fg|getopts|hash|help|history|jobs|kill|let|local|logout|popd|printf|pushd|pwd|read|readonly|set|shift|shopt|source|suspend|test|time|times|trap|true|type|typeset|ulimit|umask|unalias|unset|wait)(?=[\\s)`])', 'nb'),
    rule('^#!.+\\n', 'ch'),
    rule('#.*\\n', 'c1'),
    rule('\\\\[\\w\\W]', 'se'),
    rule('(\\b\\w+)(\\s*)(\\+?=)', ['nv', 'w', 'o']),
    rule('[\\[\\]{}()=]', 'o'),
    rule('<<<', 'o'),
    rule('<<-?\\s*(\'?)\\\\?(\\w+)[\\w\\W]+?\\2', 's'),
    rule('&&|\\|\\|', 'o'),
  ],
  data: [
    rule('\\$?"(\\\\.|[^"\\\\$])*"', 's2', undefined, 's'),
    rule('"', 's2', 'string'),
    rule("\\$'(\\\\\\\\|\\\\[0-7]+|\\\\.|[^'\\\\])*'", 's1', undefined, 's'),
    rule("'.*?'", 's1', undefined, 's'),
    rule(';', 'p'),
    rule('&', 'p'),
    rule('\\|', 'p'),
    rule('\\s+', 'w'),
    rule('\\d+\\b', 'm'),
    rule('[^=\\s\\[\\]{}()$"\'`\\\\<&|;]+', ''),
    rule('<', ''),
  ],
  string: [
    rule('"', 's2', '#pop'),
    rule('(\\\\\\\\|\\\\[0-7]+|\\\\.|[^"\\\\$])+', 's2', undefined, 's'),
    include('interp'),
  ],
  curly: [
    rule('\\}', 'si', '#pop'),
    rule(':-', 'k'),
    rule('\\w+', 'nv'),
    rule('[^}:"\'`$\\\\]+', 'p'),
    rule(':', 'p'),
    include('root'),
  ],
  paren: [rule('\\)', 'k', '#pop'), include('root')],
  math: [
    rule('\\)\\)', 'k', '#pop'),
    rule('\\*\\*|\\|\\||<<|>>|[-+*/%^|&<>]', 'o'),
    rule('\\d+#[\\da-zA-Z]+', 'm'),
    rule('\\d+#(?! )', 'm'),
    rule('0[xX][\\da-fA-F]+', 'm'),
    rule('\\d+', 'm'),
    rule('[a-zA-Z_]\\w*', 'nv'),
    include('root'),
  ],
  backticks: [rule('`', 'sb', '#pop'), include('root')],
}

/** Every own rule's id, `state#position`, so a test can tell which ones a command reached. */
export const LEXER_RULE_IDS: readonly string[] = Object.entries(STATES).flatMap(([name, entries]) => {
  const ids: string[] = []
  entries.forEach((entry, index) => {
    if ('include' in entry) return
    entry.id = `${name}#${index}`
    ids.push(entry.id)
  })
  return ids
})

const flattened = new Map<string, Rule[]>()
function rulesOf(state: string): Rule[] {
  let rules = flattened.get(state)
  if (!rules) {
    rules = STATES[state]!.flatMap((entry): Rule[] => 'include' in entry ? rulesOf(entry.include) : [entry])
    flattened.set(state, rules)
  }
  return rules
}

/**
 * Lex one line as Bash into `[css class, text]` tokens, in order.
 *
 * `used` collects the id of each rule that matched.
 */
export function lexBash(line: string, used?: Set<string>): [string, string][] {
  // Pygments drops a leading byte-order mark, makes every line break `\n`,
  // strips outer newlines and guarantees exactly one at the end.
  const text = `${line.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')}\n`
  const tokens: [string, string][] = []
  const stack = ['root']
  let pos = 0
  while (pos < text.length) {
    let matched = false
    for (const { re, action, state, id } of rulesOf(stack.at(-1)!)) {
      re.lastIndex = pos
      const match = re.exec(text)
      if (!match) continue
      used?.add(id)
      if (typeof action === 'string') tokens.push([action, match[0]])
      else action.forEach((css, index) => { if (css !== null && match[index + 1]) tokens.push([css, match[index + 1]!]) })
      pos += match[0].length
      if (state === '#pop') { if (stack.length > 1) stack.pop() }
      else if (state) stack.push(state)
      matched = true
      break
    }
    if (matched) continue
    if (text[pos] === '\n') {
      stack.length = 1
      tokens.push(['w', '\n'])
      pos += 1
    } else {
      // Pygments reads code points, so an unmatched astral character is one token.
      const char = String.fromCodePoint(text.codePointAt(pos)!)
      tokens.push(['err', char])
      pos += char.length
    }
  }
  return tokens
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)

/**
 * A shell command as Pygments-classed `<tspan>`s.
 *
 * The command name (a builtin such as `echo` or `pwd`) keeps the default text
 * colour, like a freshly typed command; strings, comments and the rest keep
 * their Pygments classes.
 */
export function highlight(line: string): string {
  return lexBash(line).map(([token, value]) => {
    const text = value.replace(/\n+$/, '')
    if (!text) return ''
    const css = token === 'nb' ? '' : token
    return css ? `<tspan class="${css}">${escapeHtml(text)}</tspan>` : escapeHtml(text)
  }).join('')
}

/* ---------------------------------------------------------------------- */
/* SVG                                                                     */
/* ---------------------------------------------------------------------- */

/** Python's `:g`: six significant digits, no trailing zeros. */
const g = (value: number) => String(Number(value.toPrecision(6)))

export interface RenderOptions {
  /**
   * Prefix of the SVG's `clipPath` ids. Two diagrams on one page need
   * different ids when their panes differ; the default derives one from the
   * layout, so identical diagrams share an id and identical clip geometry.
   */
  id?: string
  /**
   * What the diagram shows, for a reader who cannot see it: set as the
   * SVG's `aria-label` and as its `<title>`. Without it the markup is exactly
   * what tmuxp's module writes, which the parity fixture pins.
   */
  label?: string
}

/** A short, stable id for one diagram. */
function diagramId(panes: readonly (readonly string[])[], layout: string, size: readonly [number, number]): string {
  let hash = 0x811c9dc5
  for (const char of JSON.stringify([layout, size, panes])) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0
  return `tmux-layout-${hash.toString(36)}`
}

/**
 * Render panes, each a list of command lines, to an inline `<svg>`.
 *
 * Pane fills come first. The window border and the single dividers go on top
 * so a shared edge is one line, not two abutting pane strokes. Text is clipped
 * to its pane, so a long command is cut at the edge rather than shrunk.
 *
 * @throws {TmuxLayoutError} When there are no panes or the layout is unknown.
 */
export function renderLayout(
  panes: readonly (readonly string[])[],
  layout: string,
  size: readonly [number, number],
  options: RenderOptions = {},
): string {
  const [width, height] = size
  const rects = arrange(layout, panes.length, width, height)
  const viewWidth = width * CELL_WIDTH
  const viewHeight = height * CELL_HEIGHT
  const id = options.id ?? diagramId(panes, layout, size)
  const clipId = (index: number) => `${id}-clip-${index}`
  const parts = [
    `<svg class="gp-tmux-layout" viewBox="0 0 ${g(viewWidth)} ${g(viewHeight)}" width="${g(viewWidth)}" height="${g(viewHeight)}" role="img"${options.label ? ` aria-label="${escapeHtml(options.label)}"` : ''} xmlns="http://www.w3.org/2000/svg">`,
    ...(options.label ? [`<title>${escapeHtml(options.label)}</title>`] : []),
    '<defs>',
  ]
  rects.forEach((rect, index) => {
    parts.push(
      `<clipPath id="${clipId(index)}" clipPathUnits="userSpaceOnUse">`
      + `<rect x="${g(rect.x * CELL_WIDTH + 1)}" y="${g(rect.y * CELL_HEIGHT + 1)}" `
      + `width="${g(Math.max(rect.w * CELL_WIDTH - 2, 1))}" height="${g(Math.max(rect.h * CELL_HEIGHT - 2, 1))}"/></clipPath>`,
    )
  })
  parts.push('</defs>')
  for (const rect of rects) {
    parts.push(`<rect class="pane" x="${g(rect.x * CELL_WIDTH)}" y="${g(rect.y * CELL_HEIGHT)}" width="${g(rect.w * CELL_WIDTH)}" height="${g(rect.h * CELL_HEIGHT)}"/>`)
  }
  for (const rect of rects) {
    const right = rect.x + rect.w
    const bottom = rect.y + rect.h
    if (right < width) {
      parts.push(`<line class="divider" x1="${g(right * CELL_WIDTH)}" y1="${g(rect.y * CELL_HEIGHT)}" x2="${g(right * CELL_WIDTH)}" y2="${g(bottom * CELL_HEIGHT)}"/>`)
    }
    if (bottom < height) {
      parts.push(`<line class="divider" x1="${g(rect.x * CELL_WIDTH)}" y1="${g(bottom * CELL_HEIGHT)}" x2="${g((rect.x + rect.w) * CELL_WIDTH)}" y2="${g(bottom * CELL_HEIGHT)}"/>`)
    }
  }
  parts.push(`<rect class="window" x="0" y="0" width="${g(viewWidth)}" height="${g(viewHeight)}"/>`)
  parts.push('<g class="highlight">')
  rects.forEach((rect, index) => {
    const x = rect.x * CELL_WIDTH + PAD
    const baseline = rect.y * CELL_HEIGHT + PAD + FONT
    panes[index]!.forEach((command, line) => {
      const body = highlight(command)
      if (!body) return
      parts.push(`<text class="cmd" clip-path="url(#${clipId(index)})" x="${g(x)}" y="${g(baseline + line * LINE_HEIGHT)}" xml:space="preserve">${PROMPT}${body}</text>`)
    })
  })
  parts.push('</g></svg>')
  return parts.join('')
}
