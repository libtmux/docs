import { createHash } from 'node:crypto'

/**
 * @typedef {{ sha256: string, functions: { name: string, owner?: string, start: number, nameLine: number, end: number, kind: string }[], tokens: { t: string, v: string, line: number, function: number }[], types?: { name?: string, start: number, end: number }[] }} NativePerlInput
 */

/** Read native PPI locations and tokens; source text is never parsed as JavaScript. */
/** @param {string} text
 * @param {NativePerlInput | undefined} native
 * @param {{ commands: ReadonlySet<string>, known: ReadonlySet<string> }} options
 */
export function scanPerl(text, native, { commands, known }) {
  if (!text) return { functions: [], types: [], orphans: [] }
  const sha = createHash('sha256').update(text).digest('hex')
  if (!native || native.sha256 !== sha || !Array.isArray(native.functions) || !Array.isArray(native.tokens)) {
    throw new Error('Perl source analysis requires fresh native PPI input for these exact bytes')
  }
  const functions = native.functions.map((fn) => ({ ...fn, sites: [], calls: new Map(), receivers: new Map(), callList: [] }))
  const keyword = new Set(['sub', 'if', 'elsif', 'unless', 'while', 'until', 'for', 'foreach', 'try', 'catch', 'return', 'map', 'grep', 'sort'])
  const grouped = Map.groupBy(native.tokens, (token) => token.function)
  for (const [index, tokens] of grouped) {
    const fn = functions[index]
    if (!fn) throw new Error('Perl native token names an unknown function')
    for (let at = 0; at < tokens.length; at++) {
      const token = tokens[at]
      if (token.t === 'id' && !keyword.has(token.v) && tokens[at - 1]?.v !== 'sub' && tokens[at + 1]?.v === '(') {
        const receiver = tokens[at - 1]?.v === '->' ? tokens[at - 2]?.v.replace(/^[$@%]/, '').toLowerCase() : undefined
        fn.calls.set(token.v, token.line)
        const receivers = fn.receivers.get(token.v) ?? new Set()
        if (receiver) receivers.add(receiver)
        fn.receivers.set(token.v, receivers)
        fn.callList.push({ name: token.v, line: token.line, ...(receiver ? { receiver } : {}) })
      }
      if (token.t !== 'str') continue
      const [command, next] = token.v.split(/\s+/)
      if (!known.has(command) || !commands.has(command) || next !== undefined && !next.startsWith('-')) continue
      // Operation plans select command vectors dynamically. A literal alone
      // proves neither dispatch nor its caller's scope; reviewed claims do.
      fn.sites.push({ command, line: token.line, flags: '', dispatch: null,
        why: 'PPI literal in a dynamic operation plan; dispatch and scope require reviewed source evidence' })
    }
  }
  return { functions, types: native.types ?? [], orphans: [] }
}
