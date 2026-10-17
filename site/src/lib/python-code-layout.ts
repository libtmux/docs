import { util } from 'prettier'
import type { Param, Signature } from '@libtmux/api-model'
import { signatureParameterText } from './api-sections'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout } from './code-layout'

/** How the parameters share the declaration: on its line, on one indented line, or one per line. */
export type PythonLayoutMode = 'flat' | 'hug' | 'explode'
export interface PythonLayout extends CodeLayout {
  mode: PythonLayoutMode
  /** Each annotation as laid out, with the line breaks the layout adds to a long union or subscript. */
  parameters: { type?: string }[]
  /** The return annotation as laid out. */
  returns?: string
}
export interface PythonLayoutOptions {
  /** Everything shown before the opening parenthesis: keyword, module path and name. */
  name: string
  /** Columns that a formatter's own `def ` and trailing text would take; zero for a displayed bar. */
  reserve?: { head: number; tail: number }
}

const INDENT = 4
const width = (text: string): number => util.getStringWidth(text)
const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/** Visit each character outside string literals with its bracket depth. */
function scan(text: string, visit: (char: string, at: number, depth: number) => void): void {
  let quote = ''
  let depth = 0
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!
    if (quote) {
      if (char === '\\') at++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else {
      if (char in closers) visit(char, at, depth++)
      else if (')]}'.includes(char)) visit(char, at, --depth)
      else visit(char, at, depth)
    }
  }
}

/** Split at a separator that is outside every bracket and string. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  scan(text, (char, at, depth) => {
    if (char === separator && depth === 0) { parts.push(text.slice(start, at).trim()); start = at + 1 }
  })
  parts.push(text.slice(start).trim())
  return parts.filter(Boolean)
}

/** The last bracket pair at the top level: the one a formatter splits first. */
function lastGroup(text: string): { start: number; end: number; open: string } | undefined {
  let found: { start: number; end: number; open: string } | undefined
  let start = -1
  scan(text, (char, at, depth) => {
    if (depth !== 0) return
    if (char in closers) start = at
    else if (')]}'.includes(char) && start !== -1) found = { start, end: at, open: text[start]! }
  })
  return found
}

/**
 * Split a bracketed expression the way ruff does: contents on one indented
 * line when they fit, otherwise one item per line with a trailing comma.
 * A subscript of one item never gains a comma, which would make it a tuple.
 */
function wrap(text: string, indent: number, column: number, tail: number): string {
  if (column + width(text) + tail <= CODE_COLUMNS.api) return text
  const group = lastGroup(text)
  const items = group ? splitTop(text.slice(group.start + 1, group.end), ',') : []
  if (!group || !items.length) return text
  const inner = indent + INDENT
  const subscript = group.open === '[' && /[\w\])]$/.test(text.slice(0, group.start))
  const hugged = items.join(', ')
  const body = inner + width(hugged) <= CODE_COLUMNS.api
    ? [' '.repeat(inner) + hugged]
    : items.map((item) => ' '.repeat(inner) + wrap(item, inner, inner, 1) + (items.length > 1 || !subscript ? ',' : ''))
  return `${text.slice(0, group.start + 1)}\n${body.join('\n')}\n${' '.repeat(indent)}${text.slice(group.end)}`
}

/** A union breaks before each `|`, which stays at the parameter's indent. */
function wrapAnnotation(type: string, lead: string, suffix: string, indent: number): string {
  const column = indent + width(`${lead}: `)
  const tail = width(suffix) + 1
  if (column + width(type) + tail <= CODE_COLUMNS.api) return type
  const operands = splitTop(type, '|')
  if (operands.length < 2) return wrap(type, indent, column, tail)
  return operands.map((operand, i) => i
    ? `| ${wrap(operand, indent, indent + 2, i === operands.length - 1 ? tail : 0)}`
    : wrap(operand, indent, column, 0)).join(`\n${' '.repeat(indent)}`)
}

function parts(param: Param) {
  const lead = signatureParameterText({ ...param, type: undefined, default: undefined }, 'py')
  const suffix = param.default !== undefined ? ` = ${param.default}` : ''
  return { lead, type: param.type, suffix }
}

/** Lay out `name(parameters) -> returns` for the API budget, after ruff format. */
export async function pythonSignatureLayout(signature: Signature, options: PythonLayoutOptions): Promise<PythonLayout> {
  const { head, tail } = options.reserve ?? { head: 0, tail: 0 }
  const items = signature.params.map(parts)
  const flatParams = items.map((item) => item.lead + (item.type ? `: ${item.type}` : '') + item.suffix)
  const arrow = signature.returns ? ` -> ${signature.returns}` : ''
  const flatParameters = items.map((item) => ({ type: item.type }))
  const make = async (mode: PythonLayoutMode, text: string, parameters: PythonLayout['parameters'], returns = signature.returns): Promise<PythonLayout> =>
    ({ mode, text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), parameters, returns })
  const flat = `${options.name}(${flatParams.join(', ')})${arrow}`
  if (head + width(flat) + tail <= CODE_COLUMNS.api) return make('flat', flat, flatParameters)
  // A long return annotation splits at its last bracket; a union would need parentheses it does not have.
  const splittable = signature.returns !== undefined && splitTop(signature.returns, '|').length < 2
  const returnsAt = (column: number) => (splittable ? wrap(signature.returns!, 0, column, tail) : signature.returns)
  if (!items.length) {
    const returns = returnsAt(head + width(`${options.name}() -> `))
    return make('flat', `${options.name}()${returns ? ` -> ${returns}` : ''}`, flatParameters, returns)
  }
  const returns = returnsAt(width(') -> '))
  const closing = `)${returns ? ` -> ${returns}` : ''}`
  // A single parameter always takes its own line; several share one when they fit.
  if (items.length > 1 && INDENT + width(flatParams.join(', ')) <= CODE_COLUMNS.api) {
    return make('hug', `${options.name}(\n${' '.repeat(INDENT)}${flatParams.join(', ')}\n${closing}`, flatParameters, returns)
  }
  const types = items.map((item) => (item.type ? wrapAnnotation(item.type, item.lead, item.suffix, INDENT) : undefined))
  const rows = items.map((item, i) => `${' '.repeat(INDENT)}${item.lead}${types[i] === undefined ? '' : `: ${types[i]}`}${item.suffix},`)
  return make('explode', `${options.name}(\n${rows.join('\n')}\n${closing}`, types.map((type) => ({ type })), returns)
}
