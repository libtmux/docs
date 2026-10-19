#!/usr/bin/env node
/**
 * Extract tmux's options, hooks and format variables for each pinned release.
 *
 * Existence, scope, type, defaults and source lines come from the C tables at
 * the pinned commit. Descriptions come from that release's tmux.1, through the
 * rendered manual in `site/src/data/tmux/<version>.json`, whose digest must
 * match the tmux.1 at the commit.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { rowAnchor } from '../site/src/lib/row-anchors.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'site/src/data/tmux')
const defaultCatalogDir = join(dataDir, 'catalog')
export const SCHEMA_VERSION = 1
const digest = (text) => createHash('sha256').update(text).digest('hex')
const compact = (text) => text.replace(/\s+/g, ' ').trim()

/* ---------------------------------------------------------------- C source */

const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '?': '?' }

function literalEnd(source, start) {
  const quote = source[start]
  let index = start + 1
  while (index < source.length && source[index] !== quote) index += source[index] === '\\' ? 2 : 1
  return index + 1
}

function decode(body) {
  return body.replace(/\\(?:([0-7]{1,3})|x([0-9a-fA-F]+)|(.))/gs, (_, octal, hex, char) =>
    octal ? String.fromCharCode(parseInt(octal, 8)) : hex ? String.fromCharCode(parseInt(hex, 16)) : (ESCAPES[char] ?? char))
}

/** Blank out comments, keeping every newline so token lines stay true. */
export function stripComments(source) {
  let out = ''
  for (let index = 0; index < source.length;) {
    const char = source[index]
    if (char === '"' || char === "'") {
      const end = literalEnd(source, index)
      out += source.slice(index, end)
      index = end
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) throw new Error('Unterminated C comment')
      out += source.slice(index, end + 2).replace(/[^\n]/g, ' ')
      index = end + 2
    } else if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') { out += ' '; index++ }
    } else { out += char; index++ }
  }
  return out
}

/** Tokens of C source; preprocessor lines are not code and are skipped. */
export function tokenize(source) {
  const text = stripComments(source)
  const tokens = []
  let line = 1
  let lineStart = true
  for (let index = 0; index < text.length;) {
    const char = text[index]
    if (char === '\n') { line++; lineStart = true; index++; continue }
    if (/\s/.test(char)) { index++; continue }
    if (lineStart && char === '#') {
      // A directive continues over backslash-newline pairs.
      while (index < text.length && (text[index] !== '\n' || text[index - 1] === '\\')) {
        if (text[index] === '\n') line++
        index++
      }
      continue
    }
    lineStart = false
    if (char === '"') {
      const end = literalEnd(text, index)
      tokens.push({ type: 'str', value: decode(text.slice(index + 1, end - 1)), line })
      index = end
    } else if (char === "'") {
      const end = literalEnd(text, index)
      tokens.push({ type: 'chr', value: decode(text.slice(index + 1, end - 1)).charCodeAt(0), line })
      index = end
    } else if (/[0-9]/.test(char)) {
      const match = /^(?:0[xX][0-9a-fA-F]+|[0-9]+)[uUlL]*/.exec(text.slice(index))
      tokens.push({ type: 'num', value: Number(match[0].replace(/[uUlL]+$/, '')), line })
      index += match[0].length
    } else if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index))
      tokens.push({ type: 'id', value: match[0], line })
      index += match[0].length
    } else {
      const punct = text.slice(index, index + 2)
      const two = ['->', '||', '&&', '<<', '>>', '==', '!='].includes(punct) ? punct : char
      tokens.push({ type: 'punct', value: two, line })
      index += two.length
    }
  }
  return tokens
}

/** Object-like `#define` values and enum members, enough to resolve table cells. */
export function parseSymbols(...sources) {
  const symbols = new Map()
  const evaluate = (text) => {
    const tokens = tokenize(text)
    if (!tokens.length) return undefined
    const string = cellString(tokens)
    if (string !== undefined) return string
    try { return evaluateTokens(tokens, symbols) } catch { return undefined }
  }
  for (const source of sources) {
    const joined = source.replace(/\\\n/g, ' ')
    for (const match of joined.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_(])[ \t]+(.+)$/gm)) {
      if (symbols.has(match[1])) continue
      const value = evaluate(match[2])
      if (value !== undefined) symbols.set(match[1], value)
    }
    for (const match of stripComments(joined).matchAll(/\benum\b[^{;]*\{([^}]*)\}/g)) {
      let next = 0
      for (const member of match[1].split(',')) {
        const parsed = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*([\s\S]+))?$/.exec(member)
        if (!parsed) continue
        const explicit = parsed[2] === undefined ? undefined : evaluate(parsed[2])
        if (parsed[2] !== undefined && explicit === undefined) { next = undefined; continue }
        if (explicit !== undefined) next = explicit
        if (next === undefined) continue
        if (!symbols.has(parsed[1])) symbols.set(parsed[1], next)
        next = typeof next === 'number' ? next + 1 : undefined
      }
    }
  }
  return symbols
}

const LIMITS = new Map([
  ['INT_MAX', 2147483647], ['UINT_MAX', 4294967295], ['SHRT_MAX', 32767], ['USHRT_MAX', 65535],
])

/** Integers, character constants, symbols, unary minus and bitwise or. */
export function evaluateTokens(tokens, symbols) {
  let position = 0
  const unary = () => {
    const token = tokens[position++]
    if (!token) throw new Error('Unexpected end of expression')
    if (token.type === 'punct' && token.value === '-') return -unary()
    if (token.type === 'punct' && token.value === '(') {
      const inner = bitwiseOr()
      if (tokens[position++]?.value !== ')') throw new Error('Unbalanced expression')
      return inner
    }
    if (token.type === 'num' || token.type === 'chr') return token.value
    if (token.type === 'id') {
      const value = symbols.get(token.value) ?? LIMITS.get(token.value)
      if (value === undefined) throw new Error(`Unresolved C symbol: ${token.value}`)
      return value
    }
    throw new Error(`Unsupported expression token: ${token.value}`)
  }
  const bitwiseOr = () => {
    let value = unary()
    while (tokens[position]?.value === '|') { position++; value = Number(BigInt(value) | BigInt(unary())) }
    return value
  }
  const value = bitwiseOr()
  if (position !== tokens.length) throw new Error('Unsupported C expression')
  return value
}

function splitTop(tokens, separator) {
  const parts = [[]]
  let depth = 0
  for (const token of tokens) {
    if (token.type === 'punct' && '({['.includes(token.value)) depth++
    if (token.type === 'punct' && ')}]'.includes(token.value)) depth--
    if (depth === 0 && token.type === 'punct' && token.value === separator) parts.push([])
    else parts.at(-1).push(token)
  }
  return parts.filter((part) => part.length)
}

function matching(tokens, open) {
  const closing = { '{': '}', '(': ')', '[': ']' }[tokens[open].value]
  let depth = 0
  for (let index = open; index < tokens.length; index++) {
    if (tokens[index].type !== 'punct') continue
    if (tokens[index].value === tokens[open].value) depth++
    else if (tokens[index].value === closing && --depth === 0) return index
  }
  throw new Error(`Unbalanced ${tokens[open].value} at line ${tokens[open].line}`)
}

/** Adjacent string literals concatenate; any other single token is itself. */
function cellString(tokens) {
  if (tokens.length && tokens.every((token) => token.type === 'str')) return tokens.map((token) => token.value).join('')
  return undefined
}

/** `.name = value, ...` cells of one initializer, keyed by field. */
function fieldsOf(tokens) {
  const fields = {}
  for (const part of splitTop(tokens, ',')) {
    if (part[0]?.value !== '.' || part[2]?.value !== '=') throw new Error(`Unsupported initializer at line ${part[0]?.line}`)
    fields[part[1].value] = part.slice(3)
  }
  return fields
}

/** Names of `static const char *x[] = { "a", ..., NULL };` lists. */
export function parseChoiceLists(source) {
  const lists = new Map()
  const tokens = tokenize(source)
  for (let index = 0; index < tokens.length - 3; index++) {
    if (tokens[index].value !== '*' || tokens[index + 1].type !== 'id' || tokens[index + 2].value !== '[') continue
    const open = tokens.findIndex((token, at) => at > index && token.value === '{')
    if (tokens[index + 3].value !== ']' || tokens[index + 4]?.value !== '=' || open !== index + 5) continue
    const end = matching(tokens, open)
    lists.set(tokens[index + 1].value, tokens.slice(open + 1, end).filter((token) => token.type === 'str').map((token) => token.value))
  }
  return lists
}

/** Hook-declaring macros: `#define NAME(params) { .field = ... }`. */
function parseHookMacros(source) {
  const macros = new Map()
  const joined = source.replace(/\\\n/g, ' ')
  for (const match of joined.matchAll(/^[ \t]*#[ \t]*define[ \t]+(OPTIONS_TABLE_[A-Z_]*HOOK)\(([^)]*)\)[ \t]+(.+)$/gm)) {
    macros.set(match[1], { params: match[2].split(',').map((name) => name.trim()), body: tokenize(match[3]) })
  }
  return macros
}

/** The top-level `options_table[]` entries with their source lines. */
export function parseOptionsTable(source, symbols) {
  const lists = parseChoiceLists(source)
  const macros = parseHookMacros(source)
  const tokens = tokenize(source)
  const start = tokens.findIndex((token, index) => token.value === 'options_table' && tokens[index + 1]?.value === '[' && tokens[index + 3]?.value === '=')
  if (start < 0) throw new Error('options_table not found')
  const open = tokens.findIndex((token, index) => index > start && token.value === '{')
  const body = tokens.slice(open + 1, matching(tokens, open))
  const entries = []
  for (const item of splitTop(body, ',')) {
    let line = item[0].line
    let fields
    if (item[0].value === '{') {
      fields = fieldsOf(item.slice(1, -1))
    } else if (item[0].type === 'id' && macros.has(item[0].value) && item[1]?.value === '(') {
      const macro = macros.get(item[0].value)
      const args = splitTop(item.slice(2, -1), ',')
      const bound = new Map(macro.params.map((name, at) => [name, args[at]]))
      const expanded = macro.body.flatMap((token) => token.type === 'id' && bound.has(token.value) ? bound.get(token.value) : [token])
      fields = fieldsOf(expanded.slice(1, -1))
    } else throw new Error(`Unsupported options_table item at line ${item[0].line}`)
    if (fields.name?.length === 1 && fields.name[0].value === 'NULL') continue
    const name = cellString(fields.name ?? [])
    if (name === undefined) throw new Error(`Option without a literal name at line ${line}: ${JSON.stringify(fields.name)}`)
    const flag = (cell) => (cell ?? []).filter((token) => token.type === 'id').map((token) => token.value.replace(/^OPTIONS_TABLE_/, '').toLowerCase())
    const type = flag(fields.type)[0]
    const entry = { name, line, type, scope: flag(fields.scope), flags: flag(fields.flags) }
    if (fields.text) entry.text = cellString(fields.text)
    if (fields.separator) entry.separator = cellString(fields.separator)
    if (fields.unit) entry.unit = cellString(fields.unit)
    if (fields.pattern) entry.pattern = cellString(fields.pattern)
    if (fields.default_str) {
      entry.defaultString = cellString(fields.default_str)
      if (entry.defaultString === undefined) entry.defaultString = evaluateString(fields.default_str, symbols)
    }
    if (fields.default_arr) {
      const list = fields.default_arr[0].value
      const values = parseStringArrays(source).get(list)
      if (!values) throw new Error(`Unknown default array ${list} for ${name}`)
      entry.defaultArray = values
    }
    if (fields.default_num) {
      if (type === 'key') entry.defaultKey = keyName(fields.default_num, name)
      else entry.defaultNumber = evaluateTokens(fields.default_num, symbols)
    }
    if (fields.minimum) entry.minimum = evaluateTokens(fields.minimum, symbols)
    if (fields.maximum) entry.maximum = evaluateTokens(fields.maximum, symbols)
    if (fields.choices) {
      const list = lists.get(fields.choices[0].value)
      if (!list) throw new Error(`Unknown choice list ${fields.choices[0].value} for ${name}`)
      entry.choices = list
    }
    entries.push(entry)
  }
  const aliasStart = tokens.findIndex((token, index) => token.value === 'options_other_names' && tokens[index + 1]?.value === '[')
  const aliases = []
  if (aliasStart >= 0) {
    const aliasOpen = tokens.findIndex((token, index) => index > aliasStart && token.value === '{')
    for (const item of splitTop(tokens.slice(aliasOpen + 1, matching(tokens, aliasOpen)), ',')) {
      const strings = item.filter((token) => token.type === 'str')
      if (strings.length === 2) aliases.push({ alias: strings[0].value, name: strings[1].value })
    }
  }
  return { entries, aliases }
}

/** Key defaults are character constants, optionally control-modified, or no key. */
function keyName(tokens, option) {
  const values = tokens.map((token) => token.value)
  if (values.length === 1 && values[0] === 'KEYC_NONE') return 'None'
  const control = values.length === 3 && values[1] === '|' && values[2] === 'KEYC_CTRL'
  const char = tokens[0].type === 'chr' && (tokens.length === 1 || control) ? tokens[0].value : undefined
  if (char === undefined) throw new Error(`Unsupported key default for ${option}: ${values.join(' ')}`)
  if (control) return `C-${String.fromCharCode(char)}`
  if (char === 127) return 'C-?'
  return char < 32 ? `C-${String.fromCharCode(char + 96)}` : String.fromCharCode(char)
}

/** `static const char *name[] = { OPTIONS_TABLE_X, ... }` lists of macros or strings. */
function parseStringArrays(source) {
  const arrays = new Map()
  const defines = new Map()
  for (const match of source.replace(/\\\n/g, '').matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Z_0-9]+)[ \t]+((?:"(?:\\.|[^"\\])*"[ \t]*)+)$/gm)) {
    defines.set(match[1], cellString(tokenize(match[2])))
  }
  const tokens = tokenize(source)
  for (let index = 0; index < tokens.length - 5; index++) {
    if (tokens[index].value !== '*' || tokens[index + 2].value !== '[' || tokens[index + 3].value !== ']' || tokens[index + 4].value !== '=') continue
    const end = matching(tokens, index + 5)
    const names = splitTop(tokens.slice(index + 6, end), ',').map((part) => part.length === 1 && part[0].type === 'id' ? part[0] : undefined).filter(Boolean)
    const values = names.flatMap((token) => token.value === 'NULL' ? [] : [defines.get(token.value)])
    if (values.length && values.every((value) => value !== undefined)) arrays.set(tokens[index + 1].value, values)
  }
  return arrays
}

function evaluateString(tokens, symbols) {
  if (tokens.length === 1 && tokens[0].type === 'id') {
    const value = symbols.get(tokens[0].value)
    if (typeof value === 'string') return value
    throw new Error(`Unresolved C string symbol: ${tokens[0].value}`)
  }
  throw new Error(`Unsupported default string at line ${tokens[0]?.line}`)
}

/** `{ "name", FORMAT_TABLE_STRING, format_cb_name }` rows of `format_table[]`. */
export function parseFormatTable(source) {
  const tokens = tokenize(source)
  const start = tokens.findIndex((token, index) => token.value === 'format_table' && tokens[index + 1]?.value === '[' && tokens[index + 3]?.value === '=')
  if (start < 0) throw new Error('format_table not found')
  const open = tokens.findIndex((token, index) => index > start && token.value === '{')
  return splitTop(tokens.slice(open + 1, matching(tokens, open)), ',').flatMap((item) => {
    if (item[0].value !== '{') return []
    const cells = splitTop(item.slice(1, -1), ',')
    if (cells.length < 3 || cells[0][0].type !== 'str') return []
    return [{
      name: cells[0][0].value, line: item[0].line,
      valueType: cells[1][0].value.replace(/^FORMAT_TABLE_/, '').toLowerCase(), callback: cells[2][0].value,
    }]
  })
}

/** Literal first arguments of calls named by `calls`, with each call's name. */
export function stringArguments(source, calls, argument) {
  const tokens = tokenize(source)
  const found = []
  for (let index = 0; index < tokens.length - 1; index++) {
    if (tokens[index].type !== 'id' || !calls.test(tokens[index].value) || tokens[index + 1].value !== '(') continue
    const args = splitTop(tokens.slice(index + 2, matching(tokens, index + 1)), ',')
    const cell = args[argument]
    if (cell?.length === 1 && cell[0].type === 'str') found.push({ call: tokens[index].value, value: cell[0].value, line: cell[0].line })
  }
  return found
}

/* ------------------------------------------------------------------ manual */

const COLOURS = new Map([
  [-1, 'none'], [0, 'black'], [1, 'red'], [2, 'green'], [3, 'yellow'], [4, 'blue'], [5, 'magenta'],
  [6, 'cyan'], [7, 'white'], [8, 'default'], [9, 'terminal'], [90, 'brightblack'], [91, 'brightred'],
  [92, 'brightgreen'], [93, 'brightyellow'], [94, 'brightblue'], [95, 'brightmagenta'], [96, 'brightcyan'],
  [97, 'brightwhite'],
])

/** The first sentence, as tmux's own summaries for commands read. */
function firstSentence(text) {
  const plain = compact(text)
  return plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain
}

/** A description fragment safe to embed beside other manual fragments. */
function cleanFragment(node) {
  const clone = node.cloneNode(true)
  for (const link of clone.querySelectorAll('a.permalink')) link.replaceWith(...link.childNodes)
  for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id')
  for (const element of clone.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name)) throw new Error(`Unsafe manual attribute: ${attribute.name}`)
    }
  }
  for (const paragraph of clone.querySelectorAll('p.Pp')) if (!paragraph.textContent.trim() && !paragraph.children.length) paragraph.remove()
  // Example blocks keep their line breaks; everything else is flowing text.
  return clone.innerHTML.split(/(<pre[\s\S]*?<\/pre>)/).map((part, index) => index % 2 ? part : part.replace(/\s+/g, ' ').replace(/> </g, '><')).join('').trim()
}

/** Option, hook and format-variable text from the rendered manual of one release. */
export function parseManualCatalog(html, commandNames) {
  const window = new Window()
  const document = window.document
  document.body.innerHTML = html
  const section = (id) => document.getElementById(id)?.closest('section') ?? undefined
  const result = { options: new Map(), hooks: new Map(), notifications: new Map(), variables: new Map(), afterHook: undefined }
  const lists = (scope) => [...scope.querySelectorAll('dl.Bl-tag')].filter((list) => !list.closest('dd'))
  const items = (list) => {
    const out = []
    for (const child of list.children) {
      if (child.tagName === 'DT') out.push({ term: child, details: undefined })
      else if (child.tagName === 'DD' && out.at(-1) && !out.at(-1).details) out.at(-1).details = child
    }
    return out
  }

  const options = section('OPTIONS')
  if (!options) throw new Error('The manual has no OPTIONS section')
  // Consecutive `.It` lines with no text between them share the text that follows.
  let waiting = []
  for (const list of lists(options)) {
    for (const { term, details } of items(list)) {
      const label = term.querySelector('code.Ic')?.textContent.trim()
      if (!label || commandNames.has(label)) continue
      if (!details) throw new Error(`No description for option ${label}`)
      const name = label.replace(/\[\]$/, '')
      if (result.options.has(name)) throw new Error(`Duplicate manual option: ${name}`)
      const entry = { html: cleanFragment(details), array: label.endsWith('[]'), section: 'OPTIONS' }
      result.options.set(name, entry)
      if (!compact(details.textContent.replaceAll('\u00a0', ' '))) { waiting.push(entry); continue }
      for (const earlier of waiting) earlier.html = entry.html
      waiting = []
    }
  }
  if (waiting.length) throw new Error('An option description ends the manual list with no text')

  const hooks = section('HOOKS')
  if (!hooks) throw new Error('The manual has no HOOKS section')
  for (const list of lists(hooks)) {
    for (const { term, details } of items(list)) {
      if (term.querySelector('code')) continue
      const name = compact(term.textContent)
      if (!details) throw new Error(`No description for hook ${name}`)
      result.hooks.set(name, { html: cleanFragment(details), section: 'HOOKS' })
    }
  }
  const paragraph = [...hooks.querySelectorAll('p.Pp')].find((node) => compact(node.textContent).startsWith("A command's after hook"))
  if (paragraph) result.afterHook = cleanFragment(paragraph)

  const control = section('CONTROL_MODE')
  if (control) {
    for (const list of lists(control)) {
      for (const { term, details } of items(list)) {
        const name = term.querySelector('code.Ic')?.textContent.trim()
        if (name?.startsWith('%') && details) {
          result.notifications.set(name.slice(1), { html: cleanFragment(details), section: 'CONTROL_MODE', syntax: compact(term.textContent) })
        }
      }
    }
  }

  for (const table of document.querySelectorAll('table.Bl-column')) {
    const rows = [...table.querySelectorAll('tr')]
    const header = [...(rows[0]?.querySelectorAll('td') ?? [])].map((cell) => compact(cell.textContent))
    if (header[0] !== 'Variable name') continue
        const cells = header.length === 3 ? { alias: 1, text: 2 } : { text: 1 }
    for (const row of rows.slice(1)) {
      const columns = [...row.querySelectorAll('td')]
      const name = columns[0].querySelector('code.Li')?.textContent.trim()
      if (!name) throw new Error('A format variable row has no name')
      if (result.variables.has(name)) throw new Error(`Duplicate manual format variable: ${name}`)
      result.variables.set(name, {
        alias: cells.alias === undefined ? '' : compact(columns[cells.alias].textContent),
        html: cleanFragment(columns[cells.text]), text: compact(columns[cells.text].textContent),
        anchor: row.id || undefined,
      })
    }
  }
  window.happyDOM.abort()
  return result
}

/* ---------------------------------------------------------------- assembly */

const KIND_ORDER = { option: 0, hook: 1, format: 2 }
const compareEntries = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const SCOPE_NAMES = { server: 'server', session: 'session', window: 'window', pane: 'pane' }
const CONTEXT_MEMBERS = { wp: 'pane', w: 'window', wl: 'window', s: 'session', c: 'client', pb: 'buffer', m: 'mouse' }

/** Which object a format callback reads first; none means server-wide data. */
export function callbackContexts(source) {
  const tokens = tokenize(source)
  const contexts = new Map()
  for (let index = 0; index < tokens.length - 2; index++) {
    const token = tokens[index]
    if (token.type !== 'id' || !token.value.startsWith('format_cb_') || tokens[index + 1].value !== '(') continue
    const close = matching(tokens, index + 1)
    if (tokens[close + 1]?.value !== '{') continue
    const end = matching(tokens, close + 1)
    let context = 'server'
    for (let at = close + 2; at < end - 2; at++) {
      if (tokens[at].value === 'ft' && tokens[at + 1].value === '->' && CONTEXT_MEMBERS[tokens[at + 2].value]) {
        context = CONTEXT_MEMBERS[tokens[at + 2].value]
        break
      }
    }
    contexts.set(token.value, context)
    index = end
  }
  return contexts
}

function optionDefault(row, name) {
  if (row.defaultArray) return row.defaultArray
  if (row.defaultKey !== undefined) return row.defaultKey
  if (row.defaultString !== undefined) {
    if ((row.flags.includes('is_array')) && row.separator && row.defaultString) {
      return row.defaultString.split(row.separator)
    }
    return row.defaultString
  }
  if (row.defaultNumber === undefined) return undefined
  switch (row.type) {
    case 'flag': return row.defaultNumber ? 'on' : 'off'
    case 'number': return row.defaultNumber
    case 'choice': {
      const choice = row.choices?.[row.defaultNumber]
      if (choice === undefined) throw new Error(`Default ${row.defaultNumber} is outside the choices of ${name}`)
      return choice
    }
    case 'colour': {
      const colour = COLOURS.get(row.defaultNumber)
      if (colour === undefined) throw new Error(`Unsupported colour default ${row.defaultNumber} for ${name}`)
      return colour
    }
    default: throw new Error(`Unsupported default for ${name} (${row.type})`)
  }
}

const object = (entries) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))

/**
 * Build one release's catalog from its C tables and rendered manual.
 *
 * `hookSites` holds literal firing calls; `formatAdds` holds `format_add`
 * literals for variables the callback table does not define.
 */
export function buildCatalog({ optionsSource, formatSource, symbols, manual, commandNames, hookSites, formatAdds }) {
  const table = parseOptionsTable(optionsSource, symbols)
  const formatRows = parseFormatTable(formatSource)
  const contexts = callbackContexts(formatSource)
  const aliasesOf = new Map()
  for (const { alias, name } of table.aliases) aliasesOf.set(name, [...(aliasesOf.get(name) ?? []), alias])
  const entries = []
  const unmatched = { options: [], hooks: [] }

  for (const row of table.entries) {
    const base = { name: row.name, scope: row.scope.map((scope) => SCOPE_NAMES[scope] ?? scope) }
    const source = { file: 'options-table.c', line: row.line }
    if (row.flags.includes('is_hook')) {
      const described = manual.hooks.get(row.name)
      const after = row.name.startsWith('after-') && commandNames.has(row.name.slice(6)) ? row.name.slice(6) : undefined
      const notification = manual.notifications.get(row.name)
      let html = ''
      let from = 'none'
      let anchor = 'HOOKS'
      if (described) { html = described.html; from = 'manual'; anchor = rowAnchor('HOOKS', row.name) }
      else if (notification) { html = notification.html; from = 'control-mode'; anchor = rowAnchor('CONTROL MODE', `%${row.name}`) }
      else if (after && manual.afterHook) { html = manual.afterHook; from = 'after-hook' }
      if (from === 'none') unmatched.hooks.push(row.name)
      const sites = (hookSites.get(row.name) ?? []).concat(after ? hookSites.get('after-%s') ?? [] : [])
      entries.push(object({
        kind: 'hook', ...base, after,
        notification: notification ? `%${row.name}` : undefined,
        firedFrom: sites.length ? sites : undefined,
        descriptionSource: from, html, summary: html ? firstSentence(htmlText(html)) : '',
        manual: { anchor }, source,
      }))
      continue
    }
    const described = manual.options.get(row.name)
    if (!described) unmatched.options.push(row.name)
    const defaultValue = optionDefault(row, row.name)
    const array = row.flags.includes('is_array')
    entries.push(object({
      kind: 'option', ...base, type: row.type, array: array || undefined, style: row.flags.includes('is_style') || undefined,
      default: defaultValue, choices: row.choices, minimum: row.minimum, maximum: row.maximum, unit: row.unit,
      pattern: row.pattern, separator: array || row.flags.includes('is_style') ? row.separator || undefined : undefined,
      aliases: aliasesOf.get(row.name),
      descriptionSource: described ? 'manual' : row.text ? 'source' : 'none',
      html: described?.html ?? '', summary: described ? firstSentence(htmlText(described.html)) : row.text ?? '',
      sourceText: row.text,
      manual: described ? { anchor: rowAnchor('OPTIONS', row.name) } : undefined, source,
    }))
  }

  const tableNames = new Set(formatRows.map((row) => row.name))
  const addNames = new Map(formatAdds.filter((add) => add.name).map((add) => [add.name, add]).reverse())
  const patterns = formatAdds.filter((add) => add.pattern)
  const variableNames = new Set([...formatRows.map((row) => row.name), ...manual.variables.keys()])
  const unlocated = []
  for (const name of [...variableNames].sort()) {
    const row = formatRows.find((entry) => entry.name === name)
    const described = manual.variables.get(name)
    const add = addNames.get(name) ?? patterns.find((entry) => name.endsWith(entry.pattern))
    const location = row ? { file: 'format.c', line: row.line } : add ? { file: add.file, line: add.line } : undefined
    if (!location) { unlocated.push(name); continue }
    const text = described?.text ?? ''
    entries.push(object({
      kind: 'format', name, alias: described?.alias || undefined, type: row?.valueType ?? 'string',
      scope: row ? [contexts.get(row.callback)] : undefined, callback: row?.callback,
      documented: Boolean(described), descriptionSource: described ? 'manual' : 'none',
      html: described?.html ?? '', summary: text,
      manual: described ? { anchor: described.anchor } : undefined, source: location,
    }))
  }
  if (unlocated.length) throw new Error(`Format variables without a source location: ${unlocated.join(', ')}`)
  const orphans = {
    options: [...manual.options.keys()].filter((name) => !table.entries.some((row) => row.name === name)),
    hooks: [...manual.hooks.keys()].filter((name) => !table.entries.some((row) => row.name === name && row.flags.includes('is_hook'))),
  }
  entries.sort(compareEntries)
  return { entries, unmatched, orphans, tableNames }
}

let scratch
/** Plain text of an HTML fragment. */
function htmlText(html) {
  scratch ??= new Window().document.createElement('div')
  scratch.innerHTML = html
  return scratch.textContent
}

/* -------------------------------------------------------------------- main */

const git = (source, ...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', maxBuffer: 256 << 20 })

function grepFiles(source, commit, pattern) {
  const out = git(source, 'grep', '-l', '-E', pattern, commit, '--', '*.c')
  return out.split('\n').filter(Boolean).map((line) => line.slice(commit.length + 1)).filter((file) => !file.startsWith('compat/')).sort()
}

/** Literal hook names passed to the notification and hook-queue calls. */
export function collectHookSites(sources) {
  const sites = new Map()
  const add = (name, site) => {
    const list = sites.get(name) ?? []
    if (!list.some((entry) => entry.file === site.file && entry.line === site.line)) list.push(site)
    sites.set(name, list)
  }
  for (const [file, text] of sources) {
    for (const found of stringArguments(text, /^notify_(?!hook$|paste_buffer$)[a-z_]+$/, 0)) add(found.value, { file, line: found.line, call: found.call })
    for (const found of stringArguments(text, /^cmdq_insert_hook$/, 3)) add(found.value, { file, line: found.line, call: found.call })
  }
  for (const list of sites.values()) list.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  return sites
}

/**
 * Variables set with a literal name, and the `%s_suffix` patterns that build
 * the rest from a prefix such as `next`.
 */
export function collectFormatAdds(sources) {
  const adds = []
  for (const [file, text] of sources) {
    for (const found of stringArguments(text, /^(?:format_add(?:_cb|_tv)?|cmdq_add_format)$/, 1)) {
      if (/^[a-z][a-z0-9_]*$/.test(found.value)) adds.push({ name: found.value, file, line: found.line })
    }
    for (const token of tokenize(text)) {
      if (token.type === 'str' && /^%s_[a-z][a-z0-9_]*$/.test(token.value)) adds.push({ pattern: token.value.slice(2), file, line: token.line })
    }
  }
  return adds.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
}

export function catalogForRelease({ source, version, revision, manualData }) {
  const sourceCommit = git(source, 'rev-parse', '--verify', `${revision}^{commit}`).trim()
  const sourceTree = git(source, 'rev-parse', `${sourceCommit}^{tree}`).trim()
  if (sourceCommit !== manualData.sourceCommit) throw new Error(`The ${version} manual snapshot is for ${manualData.sourceCommit}, not ${sourceCommit}`)
  const read = (file) => git(source, 'show', `${sourceCommit}:${file}`)
  if (digest(read('tmux.1')) !== manualData.manualSha256) throw new Error(`The ${version} manual snapshot does not match tmux.1 at ${sourceCommit}`)
  const hookFiles = grepFiles(source, sourceCommit, '(notify_[a-z_]+|cmdq_insert_hook)\\(')
  const formatFiles = grepFiles(source, sourceCommit, '(format_add(_cb|_tv)?|cmdq_add_format)\\(|"%s_')
  const symbols = parseSymbols(read('tmux.h'), read('compat.h'))
  const commandNames = new Set(manualData.commands.map((command) => command.name))
  const manual = parseManualCatalog(manualData.manual, commandNames)
  const built = buildCatalog({
    optionsSource: read('options-table.c'), formatSource: read('format.c'), symbols, manual, commandNames,
    hookSites: collectHookSites(hookFiles.map((file) => [file, read(file)])),
    formatAdds: collectFormatAdds(formatFiles.map((file) => [file, read(file)])),
  })
  const counts = { option: 0, hook: 0, format: 0 }
  for (const entry of built.entries) counts[entry.kind]++
  return {
    model: { schemaVersion: SCHEMA_VERSION, version, revision, sourceCommit, sourceTree, manualSha256: manualData.manualSha256, counts, entries: built.entries },
    report: { unmatched: built.unmatched, orphans: built.orphans },
  }
}

const REQUIRED = {
  option: ['scope', 'type', 'summary', 'source'],
  hook: ['scope', 'summary', 'source'],
  format: ['type', 'summary', 'source'],
}

/**
 * What a committed catalog must satisfy without the tmux checkout: it describes
 * the pinned release, matches the manual snapshot it took descriptions from,
 * and keeps the shape the pages rely on.
 */
export function verifyCatalog(model, pin, manualData) {
  const problems = []
  const note = (message) => problems.push(`${pin.version}: ${message}`)
  if (model.schemaVersion !== SCHEMA_VERSION) note(`schema ${model.schemaVersion}, expected ${SCHEMA_VERSION}`)
  if (model.version !== pin.version || model.revision !== pin.revision) note('does not describe the pinned release')
  for (const field of ['sourceCommit', 'sourceTree', 'manualSha256']) {
    if (model[field] !== manualData[field]) note(`${field} differs from the manual snapshot`)
  }
  const seen = new Set()
  const counts = { option: 0, hook: 0, format: 0 }
  let previous
  for (const entry of model.entries) {
    const key = `${entry.kind}/${entry.name}`
    if (!(entry.kind in KIND_ORDER)) { note(`unknown kind ${key}`); continue }
    counts[entry.kind]++
    if (seen.has(key)) note(`duplicate ${key}`)
    seen.add(key)
    if (previous && compareEntries(previous, entry) >= 0) note(`${key} is out of order`)
    previous = entry
    for (const field of REQUIRED[entry.kind]) {
      if (entry[field] === undefined || (field === 'scope' && !entry.scope.length)) note(`${key} has no ${field}`)
    }
    if (!Number.isInteger(entry.source?.line) || !entry.source?.file) note(`${key} has no source location`)
    if (entry.descriptionSource !== 'none' && !entry.summary) note(`${key} claims a description but has no summary`)
  }
  for (const kind of Object.keys(counts)) if (model.counts?.[kind] !== counts[kind]) note(`${kind} count is ${model.counts?.[kind]}, entries hold ${counts[kind]}`)
  return problems
}

function main() {
  const args = process.argv.slice(2)
  const option = (name) => args[args.indexOf(name) + 1]
  const check = args.includes('--check')
  const pins = JSON.parse(readFileSync(join(dataDir, 'versions.json'), 'utf8'))
  if (!args.includes('--source') && !check) throw new Error('Usage: gen-tmux-catalog.mjs --source <tmux-git> [--check]\n       gen-tmux-catalog.mjs --check')
  const source = args.includes('--source') ? resolve(option('--source')) : undefined
  const catalogDir = args.includes('--catalog') ? resolve(option('--catalog')) : defaultCatalogDir
  if (!check) mkdirSync(catalogDir, { recursive: true })
  const problems = []
  for (const pin of pins.versions) {
    const { version, revision } = pin
    const manualData = JSON.parse(readFileSync(join(dataDir, `${version}.json`), 'utf8'))
    const target = join(catalogDir, `${version}.json`)
    if (check) {
      let committed
      try { committed = readFileSync(target, 'utf8') } catch { problems.push(`Missing tmux catalog: ${version}`); continue }
      problems.push(...verifyCatalog(JSON.parse(committed), pin, manualData))
      if (source) {
        const { model } = catalogForRelease({ source, version, revision, manualData })
        if (committed !== `${JSON.stringify(model, null, 2)}\n`) problems.push(`Stale tmux catalog: ${version}`)
      }
      continue
    }
    const { model, report } = catalogForRelease({ source, version, revision, manualData })
    writeFileSync(target, `${JSON.stringify(model, null, 2)}\n`)
    console.log(`tmux ${version}: ${model.counts.option} options, ${model.counts.hook} hooks, ${model.counts.format} formats at ${revision}`)
    for (const [kind, names] of Object.entries(report.unmatched)) if (names.length) console.log(`  ${kind} without manual text: ${names.join(' ')}`)
    for (const [kind, names] of Object.entries(report.orphans)) if (names.length) console.log(`  manual ${kind} absent from the source table: ${names.join(' ')}`)
  }
  if (problems.length) throw new Error(problems.join('\n'))
  if (check) console.log(`tmux catalog: ${pins.versions.length} releases fresh${source ? '' : ' (digests and shape only; pass --source to regenerate)'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
