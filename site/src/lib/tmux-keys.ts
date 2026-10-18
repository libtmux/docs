import type { Element, ElementContent } from 'astro-expressive-code/hast'

/**
 * tmux key notation, and where a spelling counts as a key.
 *
 * The grammar follows `key_string_lookup_string` in tmux's key-string.c, with
 * one deliberate restriction: modifiers are the upper-case `C-`, `M-` and
 * `S-`, and key names use the spelling the manual prints. tmux also accepts
 * `c-b` and `enter`, but prose that spells a key that way is not naming one.
 *
 * Spelling alone never decides. `c`, `Enter` and `n` are keys in a binding
 * table and ordinary literals in a format string or a sentence about typed
 * text, so every caller states how much evidence its context supplies.
 */

/** How much evidence the surrounding context gives that a literal is a key. */
export type KeyPolicy =
  /** Nothing beyond the literal itself: only `C-b`-style modified keys qualify. */
  | 'literal'
  /** A quoted or emphasised literal in the manual: modified keys and key names. */
  | 'mention'
  /** A key table, binding list or key-command description: every key qualifies. */
  | 'key'

export interface TmuxKey {
  /** The spelling as written. */
  text: string
  /** Modifier letters in order, `C-M-f` giving `CM`. A caret contributes `C`. */
  modifiers: string
  /** Whether the Ctrl modifier was written `^`, which is also a regex anchor. */
  caret: boolean
  /** The key without modifiers: one character or a key name. */
  base: string
  /** Whether `base` is a key name rather than a single character. */
  named: boolean
}

const NAMES = new Set([
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  'IC', 'Insert', 'DC', 'Delete', 'Home', 'End',
  'NPage', 'PageDown', 'PgDn', 'PPage', 'PageUp', 'PgUp',
  'BTab', 'Tab', 'Space', 'BSpace', 'Enter', 'Escape',
  'Up', 'Down', 'Left', 'Right',
  'KPEnter', 'KP/', 'KP*', 'KP-', 'KP+', 'KP.', ...Array.from({ length: 10 }, (_, index) => `KP${index}`),
  // The manual's "Any key": a binding that matches every key.
  'Any',
])

/** The manual's spellings of keys in the default binding list. */
const DISPLAY_NAMES = new Set(['Page Up', 'Page Down'])

const printable = /^[\p{L}\p{N}\p{P}\p{S}]$/u

/** Parse one key, without surrounding space. Mouse events are not keys here. */
export function parseTmuxKey(text: string): TmuxKey | undefined {
  if (!text || /\s/.test(text)) return undefined
  if (NAMES.has(text)) return { text, modifiers: '', caret: false, base: text, named: true }
  let rest = text
  let modifiers = ''
  let caret = false
  if (rest[0] === '^' && rest.length > 1) {
    const [, second, ...more] = Array.from(rest)
    if (!more.length) {
      return printable.test(second) ? { text, modifiers: 'C', caret: true, base: second, named: false } : undefined
    }
    caret = true
    modifiers = 'C'
    rest = rest.slice(1)
  }
  while (rest.length >= 2 && rest[1] === '-' && 'CMS'.includes(rest[0])) {
    modifiers += rest[0]
    rest = rest.slice(2)
  }
  if (!rest) return undefined
  if (printable.test(rest)) return { text, modifiers, caret, base: rest, named: false }
  if (NAMES.has(rest)) return { text, modifiers, caret, base: rest, named: true }
  return undefined
}

/** `C-`, `M-`, `S-` and `^` as the manual names the modifiers themselves. */
export const isModifierPrefix = (text: string): boolean => /^(?:[CMS]-|\^)$/.test(text)

/** Whether the key carries evidence in its own spelling under a policy. */
function qualifies(key: TmuxKey, policy: KeyPolicy): boolean {
  if (policy === 'key') return true
  // `^a` is also a regular expression, so only the hyphen spelling is distinctive.
  if (key.modifiers && !key.caret) return true
  return policy === 'mention' && key.named && !key.modifiers
}

/**
 * The keys of a literal pressed one after another, such as `C-b c`.
 *
 * Outside a key context a sequence needs one key that qualifies by its own
 * spelling, so `C-b c` is a sequence and `n n` is not.
 */
export function tmuxKeySequence(text: string, policy: KeyPolicy): string[] | undefined {
  const parts = text.trim().split(/\s+/)
  if (parts.length === 1 && parts[0] === '') return undefined
  const keys = parts.map((part) => parseTmuxKey(part))
  if (policy === 'key' && parts.length === 1 && isModifierPrefix(parts[0])) return parts
  if (keys.some((key) => !key)) return undefined
  if (!keys.some((key) => qualifies(key!, policy))) return undefined
  return parts
}

/** A run of text in a key list: plain words, or the keys pressed together. */
export type KeySpan = { text: string } | { keys: string[] }

/**
 * Split a key table cell or binding term into words and keys: `F1 or C-h`,
 * `Up, Down`, `M-1 to M-7`, `Page Up`. Every part must be a key, so a cell
 * that holds anything else is left alone.
 */
export function tmuxKeyList(text: string): KeySpan[] | undefined {
  const normal = text.replace(/\s+/g, ' ').trim()
  if (!normal) return undefined
  const spans: KeySpan[] = []
  for (const [index, part] of normal.split(/(, | or | to )/).entries()) {
    if (index % 2) {
      spans.push({ text: part })
      continue
    }
    const keys = DISPLAY_NAMES.has(part) ? [part] : tmuxKeySequence(part, 'key')
    if (!keys) return undefined
    spans.push({ keys })
  }
  return spans
}

/** `NPage/PageDown/PgDn`: one entry naming several spellings of a key. */
export function tmuxKeyAliases(text: string): string[] | undefined {
  const names = text.trim().split('/')
  return names.length > 1 && names.every((name) => NAMES.has(name)) ? names : undefined
}

/**
 * The manual's own words for a key mention: ‘c’ is bound to, the ‘b’ key.
 * `before` and `after` are the text on either side of the literal, quotes
 * included, as a quoted literal in the manual or an inline code span in prose.
 */
export function hasKeyCue(before: string, after: string): boolean {
  return /\b(?:bound to|press(?:es|ed|ing)?)\s*[‘'"`]?\s*$/i.test(before)
    || /^[’'"`]?\s+keys?\b/.test(after)
}

/** One child of a paragraph, as far as key detection is concerned. */
export type ProseItem = { type: 'text'; value: string } | { type: 'code'; value: string } | { type: 'other' }

/** Between literals of one list: "a, b, and c", "a or b", "0 to 9", quoted or not. */
const RUN_SEPARATOR = /^’?(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to)\s+)‘?$/

/**
 * Which inline literals in a paragraph name tmux keys.
 *
 * - A literal in modified notation (`C-b d`, `M-x`) is a key.
 * - Literals in the same list as such a key are keys too, so the `Enter` and
 *   `Up` of "`Enter`, `C-c`, and `Up`" qualify with it.
 * - A list with the manual's key vocabulary beside it ("the `Enter` key",
 *   "press `q`", "bound to `[`") is a list of keys.
 *
 * Anything else stays code: `Enter` after "the word" is text typed into a
 * pane, not a key.
 */
export function tmuxKeysInProse(items: ProseItem[]): boolean[] {
  const flags = items.map(() => false)
  const textAt = (index: number) => {
    const item = items[index]
    return item?.type === 'text' ? item.value : ''
  }
  let start = 0
  while (start < items.length) {
    if (items[start].type !== 'code') { start++; continue }
    let end = start
    while (items[end + 1]?.type === 'text' && items[end + 2]?.type === 'code' && RUN_SEPARATOR.test(textAt(end + 1))) end += 2
    const members = Array.from({ length: (end - start) / 2 + 1 }, (_, offset) => start + 2 * offset)
    const evidence = hasKeyCue(textAt(start - 1), textAt(end + 1))
      || members.some((index) => tmuxKeySequence((items[index] as { value: string }).value, 'literal'))
    for (const index of members) flags[index] = evidence && tmuxKeySequence((items[index] as { value: string }).value, 'key') !== undefined
    start = end + 1
  }
  return flags
}

const kbd = (children: ElementContent[]): Element => ({ type: 'element', tagName: 'kbd', properties: {}, children })
const word = (value: string): ElementContent => ({ type: 'text', value })

/** One key is a key cap; a sequence is a cap around one per key, as MDN nests them. */
export const keyCap = (keys: string[]): Element => keys.length === 1 ? kbd([word(keys[0])])
  : kbd(keys.flatMap((key, index) => [...(index ? [word(' ')] : []), kbd([word(key)])]))

/** A key list as nodes: its words as text, its keys as key caps. */
export const keySpanNodes = (spans: KeySpan[]): ElementContent[] =>
  spans.map((span) => 'keys' in span ? keyCap(span.keys) : word(span.text))
