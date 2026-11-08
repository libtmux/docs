/**
 * Read written Erlang calls for tmux-usage attribution. OTP scans literals
 * and canonical atom spellings; this reader groups forms without expanding
 * macros or following variable dataflow. Unsupported declaration heads fail.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function tokenize(text) {
  if (!text.trim()) return []
  if (Buffer.byteLength(text) > 1048576) throw new Error('Erlang source exceeds the 1 MiB scanner limit')
  const result = spawnSync('escript', [fileURLToPath(new URL('./tmux-usage-erlang.escript', import.meta.url))], {
    input: text, encoding: 'utf8', timeout: 5000, maxBuffer: 16 << 20,
  })
  if (result.error || result.status !== 0) throw new Error(`OTP 29 source scan failed: ${result.error?.message ?? result.stderr}`)
  const scanned = JSON.parse(result.stdout)
  const tokens = []
  let sigil
  for (const token of scanned) {
    if (token.t === 'sigil_prefix') { sigil = token.v; continue }
    if (token.t === 'sigil_suffix') { sigil = undefined; continue }
    if (token.t === 'str' && sigil !== undefined && !['', 's', 'S', 'b', 'B'].includes(sigil)) token.t = 'custom_sigil'
    if (token.t === 'str' && tokens.at(-1)?.t === 'str' && sigil === undefined) tokens.at(-1).v += token.v
    else tokens.push(token)
  }
  return tokens
}

/** Bracket and expression-block pairs keep nested commas out of call arity. */
function groupsOf(tokens) {
  const pairs = new Map()
  const stack = []
  const closes = { '(': ')', '[': ']', '{': '}', '<<': '>>' }
  tokens.forEach((token, index) => {
    if (token.t !== 'sym') return
    if (closes[token.v]) stack.push({ open: index, close: closes[token.v] })
    else if (token.t === 'sym' && ['case', 'if', 'receive', 'try', 'begin', 'maybe'].includes(token.v)) stack.push({ open: index, close: 'end' })
    else if (token.v === 'fun' && (tokens[index + 1]?.v === '(' || tokens[index + 2]?.v === '(')) stack.push({ open: index, close: 'end' })
    else if (stack.at(-1)?.close === token.v) { const { open } = stack.pop(); pairs.set(open, index) }
  })
  return pairs
}

/** Scope switches use tmux's list-command option grammar; an operand is never another flag. */
function flagsOf(command, words) {
  if (words.includes(null)) return ''
  const takesValue = new Set(['list-panes', 'list-windows', 'list-sessions'].includes(command) ? ['F', 'f', 'O', 't'] : [])
  const flags = new Set()
  for (let at = 0; at < words.length; at++) {
    const word = words[at]
    if (word === undefined) return ''
    if (word === '--' || !/^-[A-Za-z]/.test(word)) break
    for (let index = 1; index < word.length; index++) {
      const letter = word[index]
      if (!/[A-Za-z]/.test(letter)) break
      flags.add(letter)
      if (takesValue.has(letter)) { if (index === word.length - 1) at++; break }
    }
  }
  return [...flags].sort().join('')
}

export function scanErlang(text, { commands, known, dispatch, builders = new Set(), labels = new Map() }) {
  const tokens = tokenize(text)
  const pairs = groupsOf(tokens)
  const arity = (open) => {
    const close = pairs.get(open)
    if (close === undefined) return undefined
    if (close === open + 1) return 0
    let count = 1
    for (let at = open + 1; at < close; at++) {
      if (pairs.has(at)) at = pairs.get(at)
      else if (tokens[at].t === 'sym' && tokens[at].v === ',') count++
    }
    return count
  }
  const callable = (at) => tokens[at]?.t === 'atom' && tokens[at + 1]?.v === '(' && pairs.has(at + 1)
    && tokens[at - 1]?.v !== '?'
  const callName = (at) => `${tokens[at].n}/${arity(at + 1)}`
  // Flatten written argv lists, retaining unknown words so a missing operand
  // cannot make a later literal look like an independent scope switch.
  const wordsIn = (open, close) => {
    const words = []
    for (let at = open + 1; at < close; at++) {
      const token = tokens[at]
      if (token.t === 'sym' && token.v === ',') continue
      if (token.t === 'sym' && ['++', '--', '|', '||', '<-', '<:-'].includes(token.v)) { words.push({ value: null, at }); continue }
      if (token.t === 'str') words.push({ value: token.v, at })
      else if (token.v === '[' && pairs.has(at)) words.push(...wordsIn(at, pairs.get(at)))
      else if (token.v === '<<' && pairs.get(at) === at + 2 && tokens[at + 1]?.t === 'str') words.push({ value: tokens[at + 1].v, at: at + 1 })
      else {
        words.push({ value: undefined, at })
        // A call's module/name and arguments are one computed word.
        if (callable(at)) at = pairs.get(at + 1)
        else if (tokens[at + 1]?.v === ':' && callable(at + 2)) at = pairs.get(at + 3)
      }
      if (pairs.has(at)) at = pairs.get(at)
    }
    return words
  }
  let module
  const imports = new Map()
  const functions = []
  let formStart = 0
  for (let end = 0; end < tokens.length; end++) {
    if (tokens[end].t !== 'stop') continue
    const first = tokens[formStart]
    if (first?.v === '-' && tokens[formStart + 1]?.v === 'module' && tokens[formStart + 3]?.t === 'atom') module = tokens[formStart + 3].n
    else if (first?.v === '-' && tokens[formStart + 1]?.v === 'import' && tokens[formStart + 3]?.t === 'atom') {
      for (let at = formStart + 5; at < end; at++) {
        if (tokens[at].t === 'atom' && tokens[at + 1]?.v === '/' && tokens[at + 2]?.t === 'number') imports.set(`${tokens[at].n}/${tokens[at + 2].v}`, tokens[formStart + 3].n)
      }
    }
    else if (callable(formStart)) {
      if (module === undefined) throw new Error('Erlang module identity is unresolved; macro-expanded module declarations need a native source adapter')
      const fn = { name: callName(formStart), owner: module, module, start: first.line, nameLine: first.line, end: tokens[end].line,
        kind: 'function', sites: [], calls: new Map(), receivers: new Map(), callList: [], deferredCalls: [] }
      const heads = new Set([formStart])
      for (let at = formStart; at < end; at++) {
        if (pairs.has(at)) at = pairs.get(at)
        else if (tokens[at].t === 'sym' && tokens[at].v === ';' && callable(at + 1) && callName(at + 1) === fn.name) heads.add(at + 1)
      }
      const calls = []
      const deferred = [...pairs].filter(([open, close]) => tokens[open].v === 'fun' && open > formStart && close < end)
      const isDeferred = (at) => deferred.some(([open, close]) => open < at && at < close)
      for (let at = formStart; at < end; at++) {
        if (!callable(at) || heads.has(at)) continue
        const name = callName(at)
        const qualified = tokens[at - 1]?.v === ':'
        const receiver = qualified ? (tokens[at - 2]?.t === 'atom' ? tokens[at - 2].n : undefined) : imports.get(name)
        // A variable module or record field is not a statically resolved call.
        if (tokens[at - 1]?.v === '.' || (tokens[at - 1]?.v === ':' && !receiver)) continue
        const call = { name, ...(receiver ? { receiver } : {}), line: tokens[at].line, calleeLine: tokens[at].line }
        if (isDeferred(at)) { fn.deferredCalls.push(call); continue }
        fn.calls.set(name, tokens[at].line)
        if (receiver) fn.receivers.set(name, new Set([...(fn.receivers.get(name) ?? []), receiver]))
        fn.callList.push(call)
        calls.push({ ...call, open: at + 1, close: pairs.get(at + 1) })
      }
      for (let at = formStart; at < end; at++) {
        const token = tokens[at]
        if (token.t !== 'str') continue
        const [command, next] = token.v.split(/\s+/)
        if (!known.has(command) || !commands.has(command) || (next !== undefined && !next.startsWith('-'))) continue
        const enclosing = [...pairs].filter(([open, close]) => open < at && at < close).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))
        const nearest = calls.filter((call) => call.open < at && at < call.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))[0]
        const words = nearest ? wordsIn(nearest.open, nearest.close) : []
        const wordIndex = words.findIndex((word) => word.at === at)
        const flags = wordIndex < 0 ? '' : flagsOf(command, words.slice(wordIndex + 1).map((word) => word.value))
        const site = { command, line: token.line, flags }
        if (dispatch) {
          const path = calls.filter((call) => call.open < at && at < call.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))
          const senderIndex = path.findIndex((call) => dispatch.has(call.name))
          const sender = path[senderIndex]
          const blocked = path.slice(0, senderIndex).some((call) => !builders.has(call.name))
          const computed = sender && enclosing.some(([open, close]) => {
            if (open < sender.open) return false
            if (tokens[open].v === '{') return true
            if (tokens[open].v === '<<' && (close !== open + 2 || tokens[open + 1].t !== 'str')) return true
            if (tokens[open].t === 'sym' && /^[a-z]/.test(tokens[open].v)) return true
            for (let index = open + 1; index < close; index++) {
              if (pairs.has(index)) index = pairs.get(index)
              else if (tokens[index].t === 'sym' && ['=:=', '=/=', '==', '/=', '<', '>', '=<', '>=', 'andalso', 'orelse', 'not', '++', '--'].includes(tokens[index].v)) return true
            }
            return false
          })
          const diagnostic = path.some((call) => {
            if (!labels.has(call.name)) return false
            let argument = 0
            for (let index = call.open + 1; index < at; index++) {
              if (pairs.has(index)) index = pairs.get(index)
              else if (tokens[index].t === 'sym' && tokens[index].v === ',') argument++
            }
            return labels.get(call.name).has(argument)
          })
          if (sender && !blocked && !computed && !diagnostic && !isDeferred(at)) site.dispatch = { line: sender.line, name: sender.name }
          else { site.dispatch = null; site.why = isDeferred(at) ? 'it is inside a deferred fun body' : 'it reaches no declared dispatcher call' }
        }
        fn.sites.push(site)
      }
      functions.push(fn)
    }
    else if (first?.v !== '-') throw new Error('Erlang function head is unresolved; macro-generated functions need a native source adapter')
    formStart = end + 1
  }
  if (formStart < tokens.length) throw new Error('unterminated Erlang form')
  return { functions, types: module ? [{ name: module, start: 1, end: text.split('\n').length }] : [], orphans: [] }
}
