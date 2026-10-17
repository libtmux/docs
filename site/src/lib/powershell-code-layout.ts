import { doc } from 'prettier'
import type { ApiSymbol, Signature } from '@libtmux/api-model'
import { CODE_COLUMNS, codeWidthFailures, type CodeLayout } from './code-layout'

type Doc = doc.builders.Doc
const { group, indent, join, line } = doc.builders
const layouts = new Map<string, Promise<CodeLayout>>()

/*
 * PowerShell help syntax has no formatter. `Get-Help` wraps its SYNTAX block at
 * the console column, through names and types; `Get-Command -Syntax` prints one
 * unwrapped line; platyPS writes markdown that breaks only between parameter
 * groups, at a width it does not expose. This layout breaks only between
 * groups, like platyPS, and puts one group on each line, four spaces in, once
 * the whole syntax no longer fits. A group wider than its line breaks at the
 * space between its parameter name and its type, the one place it can.
 */

/** Split on whitespace outside `[]` and `<>`, which nest in names and types. */
function tokenize(raw: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let start = -1
  for (let at = 0; at <= raw.length; at++) {
    const char = raw[at]
    const space = char === undefined || /\s/.test(char)
    if (space && !depth) {
      if (start >= 0) tokens.push(raw.slice(start, at))
      start = -1
      continue
    }
    if (start < 0) start = at
    if (char === '[' || char === '<') depth++
    else if (char === ']' || char === '>') depth = Math.max(0, depth - 1)
  }
  if (depth) throw new Error(`Unbalanced PowerShell syntax: ${raw}`)
  return tokens
}

/** A bracketed group `[-Name <Type>]` keeps its name and type apart only when it cannot fit. */
function splitGroup(token: string): [string, string?] {
  if (!token.startsWith('[') || token.startsWith('[<')) return [token]
  let depth = 0
  for (let at = 0; at < token.length; at++) {
    const char = token[at]
    if (char === '[' || char === '<') depth++
    else if (char === ']' || char === '>') depth--
    else if (/\s/.test(char!) && depth === 1) return [token.slice(0, at), token.slice(at).trimStart()]
  }
  return [token]
}

/** The groups after the command name: a parameter name and the type token that follows it. */
function groups(tokens: string[]): [string, string?][] {
  const result: [string, string?][] = []
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!
    const next = tokens[at + 1]
    if (!token.includes('<') && next?.startsWith('<')) { result.push([token, next]); at++ }
    else result.push(splitGroup(token))
  }
  return result
}

/** The command name and each parameter group the layout keeps whole when it can. */
export function powershellGroups(raw: string): { name: string; groups: string[] } {
  const [name, ...rest] = tokenize(raw)
  if (!name) throw new Error('Empty PowerShell syntax')
  return { name, groups: groups(rest).map(([head, tail]) => tail === undefined ? head : `${head} ${tail}`) }
}

function printSyntax(tokens: string[]): Doc {
  const [name, ...rest] = tokens
  if (!rest.length) return name!
  return group([name!, indent([line, join(line, groups(rest).map(([head, tail]) =>
    tail === undefined ? head : group([head, indent([line, tail])])))])])
}

/** Native help syntax keeps its tokens; only the whitespace between groups is laid out. */
export function powershellSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const key = JSON.stringify([symbol.name, signature.raw, CODE_COLUMNS.api])
  let pending = layouts.get(key)
  if (!pending) {
    pending = formatSyntax(signature.raw!)
    layouts.set(key, pending)
  }
  return pending
}

export async function formatSyntax(raw: string): Promise<CodeLayout> {
  const tokens = tokenize(raw)
  if (!tokens.length) throw new Error('Empty PowerShell syntax')
  const text = doc.printer.printDocToString(printSyntax(tokens), { printWidth: CODE_COLUMNS.api, tabWidth: 4, useTabs: false }).formatted
  if (JSON.stringify(text.split(/\s+/)) !== JSON.stringify(raw.trim().split(/\s+/))) throw new Error(`Formatting changed PowerShell syntax: ${raw}`)
  // The command name is the declaration; parameter and type links resolve from the text.
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'), syntax: [{ start: 0, end: tokens[0]!.length, kind: 'name' }] }
}
