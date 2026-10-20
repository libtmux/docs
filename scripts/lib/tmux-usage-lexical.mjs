/**
 * Read the source of the two languages that have no tree-sitter grammar here, Julia and F#, by their
 * text: comments and strings are stepped over, a function is the lines an offside rule or an `end`
 * gives it, and a call is a name written against its brackets. The result has the shape of a grammar
 * scan, so the same derivation reads it.
 */
/**
 * The object a call is made on, as its last identifier in lower case: `window` for
 * `Window!.GetPanesAsync(...)`, `server` for `this.server.list()`. A library's own handles are named
 * for their type, which is how a wrapper's call finds the core method it forwards to.
 */
export function receiverOf(calleeText) {
  const parts = calleeText.replace(/<[^<>()]*>/g, '').split(/\?\.|!\.|->|::|[.:]/)
  if (parts.length < 2) return undefined
  const receiver = /([A-Za-z_]\w*)\W*$/.exec(parts.at(-2).replace(/\([^()]*\)|\[[^\]]*\]/g, ''))?.[1]
  return receiver?.toLowerCase()
}


const LANGUAGES = {
  julia: { line: '#', block: ['#=', '=#'], triple: true, verbatim: false },
  fsharp: { line: '//', block: ['(*', '*)'], triple: true, verbatim: true },
}

/**
 * Words and punctuation of a source text, with strings kept whole and comments dropped.
 * @returns {{ t: 'str' | 'id' | 'sym', v: string, line: number, col: number }[]}
 */
export function tokenize(text, language) {
  const { line: lineComment, block, triple, verbatim } = LANGUAGES[language]
  const tokens = []
  let line = 1
  let col = 0
  let index = 0
  const step = (count = 1) => {
    for (let n = 0; n < count; n++) {
      if (text[index] === '\n') { line++; col = 0 } else col++
      index++
    }
  }
  while (index < text.length) {
    const here = text[index]
    if (text.startsWith(block[0], index)) {
      let depth = 1
      step(block[0].length)
      while (index < text.length && depth) {
        if (text.startsWith(block[0], index)) { depth++; step(block[0].length) }
        else if (text.startsWith(block[1], index)) { depth--; step(block[1].length) }
        else step()
      }
      continue
    }
    if (text.startsWith(lineComment, index)) { while (index < text.length && text[index] !== '\n') step(); continue }
    const start = { line, col }
    if (triple && text.startsWith('"""', index)) {
      const end = text.indexOf('"""', index + 3)
      const stop = end < 0 ? text.length : end + 3
      const value = text.slice(index + 3, end < 0 ? text.length : end)
      step(stop - index)
      tokens.push({ t: 'str', v: value, ...start, doc: true })
      continue
    }
    if (here === '"' || (verbatim && here === '@' && text[index + 1] === '"')) {
      const raw = here === '@'
      step(raw ? 2 : 1)
      let value = ''
      while (index < text.length && text[index] !== '"') {
        if (!raw && text[index] === '\\') { value += text[index + 1] ?? ''; step(2); continue }
        value += text[index]
        step()
      }
      step()
      tokens.push({ t: 'str', v: value, ...start })
      continue
    }
    if (/[A-Za-z_]/.test(here)) {
      let end = index + 1
      while (end < text.length && /[\w!']/.test(text[end])) end++
      const word = text.slice(index, end)
      step(end - index)
      tokens.push({ t: 'id', v: word, ...start })
      continue
    }
    if (/\s/.test(here)) { step(); continue }
    step()
    tokens.push({ t: 'sym', v: here, ...start })
  }
  return tokens
}

const indentOf = (lines, line) => /^\s*/.exec(lines[line - 1] ?? '')[0].length

const JULIA_KEYWORDS = new Set(['function', 'if', 'elseif', 'for', 'while', 'return', 'begin', 'let', 'do', 'try', 'catch', 'finally', 'struct', 'mutable', 'macro', 'module', 'end', 'else', 'in', 'isa', 'where', 'quote', 'throw', 'new', 'import', 'using', 'export', 'const', 'global', 'local', 'abstract', 'primitive', 'type', 'typeof'])

/** The open and close brackets of a token list, as `{ open, close }` indexes. */
function bracketGroups(tokens) {
  const groups = []
  const stack = []
  tokens.forEach((token, index) => {
    if (token.t !== 'sym') return
    if ('([{'.includes(token.v)) stack.push(index)
    else if (')]}'.includes(token.v) && stack.length) groups.push({ open: stack.pop(), close: index })
  })
  return groups
}

const FLAG = /^-[A-Za-z]+$/
const flagLetters = (tokens) => new Set(tokens.filter((token) => token.t === 'str').flatMap((token) =>
  token.v.split(/\s+/).filter((word) => FLAG.test(word)).flatMap((word) => word.slice(1).split(''))))

/** Julia: `function name(...)`, the `end` at its indent, short-form `name(...) = ...`, and the sends and calls inside. */
export function scanJulia(text, { commands, known }) {
  const lines = text.split('\n')
  const tokens = tokenize(text, 'julia')
  const groups = bracketGroups(tokens)
  const functions = []
  const first = new Map()
  tokens.forEach((token, index) => { if (!first.has(token.line)) first.set(token.line, index) })
  for (const [line, index] of first) {
    const head = tokens[index]
    let at = index
    let named
    if (head.t === 'id' && head.v === 'function') at = index + 1
    else if (head.t === 'id' && !JULIA_KEYWORDS.has(head.v) && head.col === indentOf(lines, line)) named = true
    else continue
    // `a.b.name`, with an optional `{T}` before the argument list.
    const path = []
    while (tokens[at]?.t === 'id') {
      path.push(tokens[at].v)
      if (tokens[at + 1]?.v === '.' && tokens[at + 2]?.t === 'id') at += 2
      else { at++; break }
    }
    if (!path.length) continue
    if (tokens[at]?.v === '{') at = groups.find((group) => group.open === at)?.close + 1 || at
    if (tokens[at]?.v !== '(') continue
    const close = groups.find((group) => group.open === at)?.close
    if (close === undefined) continue
    const indent = indentOf(lines, line)
    let end = line
    if (named) {
      // Short form: `name(args) = body`, or `name(args) where T = body`.
      let after = close + 1
      if (tokens[after]?.v === 'where') while (tokens[after] && tokens[after].v !== '=' && tokens[after].line === tokens[close].line) after++
      if (tokens[after]?.v !== '=' || tokens[after + 1]?.v === '=') continue
      while (lines[end] !== undefined && lines[end].trim() && indentOf(lines, end + 1) > indent) end++
    } else {
      for (let next = line + 1; next <= lines.length; next++) {
        if (new RegExp(`^\\s{${indent}}end\\b`).test(lines[next - 1] ?? '')) { end = next; break }
      }
      if (end === line) continue
    }
    // A docstring directly above belongs to the function.
    let start = line
    const above = tokens.findLast((token) => token.line < line)
    const docEnd = above ? above.line + (above.v.match(/\n/g)?.length ?? 0) : 0
    if (above?.doc && !lines.slice(docEnd, line - 1).some((value) => value.trim())) start = above.line
    functions.push({ name: path.at(-1), start, nameLine: line, end, kind: 'function', sites: [], calls: new Map(), receivers: new Map() })
  }
  /** The name a function is declared with is not a call of it. */
  const isDefinitionName = (token, index, fn) => token.line === fn.nameLine && token.v === fn.name
    && (tokens[index - 1]?.v === 'function' || tokens[index - 1]?.line !== token.line || tokens[index - 1]?.v === '.')
  const owner = (line) => functions.findLast((fn) => fn.nameLine <= line && line <= fn.end)
  const isCommand = (token) => {
    if (token.t !== 'str' || token.doc) return undefined
    const [head, next] = token.v.split(/\s+/)
    return known.has(head) && (next === undefined || next.startsWith('-')) ? head : undefined
  }
  tokens.forEach((token, index) => {
    const command = isCommand(token)
    const fn = owner(token.line)
    if (command && commands.has(command) && fn) {
      const holds = (group) => tokens.slice(group.open + 1, group.close).some((other) => {
        const found = isCommand(other)
        return found && found !== command
      })
      const enclosing = groups.filter((group) => group.open < index && index < group.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))
      let around = [token]
      for (const group of enclosing) {
        if (holds(group)) break
        around = tokens.slice(group.open, group.close + 1)
      }
      fn.sites.push({ command, line: token.line, flags: [...flagLetters(around)].sort().join('') })
    }
    if (token.t === 'id' && !JULIA_KEYWORDS.has(token.v) && tokens[index + 1]?.v === '(' && tokens[index + 1].line === token.line
      && tokens[index + 1].col === token.col + token.v.length && fn && !isDefinitionName(token, index, fn)) {
      if (!fn.calls.has(token.v)) fn.calls.set(token.v, token.line)
      const receiver = tokens[index - 1]?.v === '.' && tokens[index - 2]?.t === 'id' ? tokens[index - 2].v.toLowerCase() : undefined
      if (receiver) fn.receivers.set(token.v, new Set([...(fn.receivers.get(token.v) ?? []), receiver]))
    }
  })
  return { functions, types: [], orphans: [] }
}

/**
 * F#: `let` bindings and members with their module or type, by the offside rule, and the member calls
 * inside them. F# in this tree sends nothing itself, so only the shape a wrapper needs is read.
 */
export function scanFSharp(text) {
  const lines = text.split('\n')
  const tokens = tokenize(text, 'fsharp')
  const owners = []
  const functions = []
  const types = []
  const first = new Map()
  tokens.forEach((token, index) => { if (!first.has(token.line)) first.set(token.line, index) })
  for (const [line, index] of first) {
    const indent = indentOf(lines, line)
    while (owners.length && indent <= owners.at(-1).indent) {
      const closed = owners.pop()
      types.push({ name: closed.name, start: closed.line, end: line - 1 })
    }
    let at = index
    const words = []
    while (tokens[at]?.t === 'id' && tokens[at].line === line && words.length < 8) words.push(tokens[at++].v)
    const keyword = words.find((word) => ['let', 'member', 'module', 'type'].includes(word))
    if (!keyword) continue
    if (keyword === 'module' || keyword === 'type') {
      const name = words[words.indexOf(keyword) + 1]
      // `module A.B` with no `=` names the whole file, so no later line at its indent closes it.
      const fileWide = keyword === 'module' && !tokens.some((token) => token.line === line && token.v === '=')
      if (name && !['rec', 'internal', 'private', 'public'].includes(name)) owners.push({ name, indent: fileWide ? -1 : indent, line })
      continue
    }
    const rest = words.slice(words.indexOf(keyword) + 1).filter((word) => !['inline', 'private', 'internal', 'public', 'rec', 'mutable', 'static', 'override', 'abstract', 'default', 'extern'].includes(word))
    let name = rest[0]
    if (keyword === 'member') {
      // `member this.Name(...)`: the name follows the self identifier and a dot.
      const dot = tokens.findIndex((token, i) => i >= index && token.line === line && token.v === '.')
      name = dot > 0 && tokens[dot + 1]?.t === 'id' ? tokens[dot + 1].v : rest[0]
    }
    if (!name || name === '_' || name === '(') continue
    let end = line
    while (lines[end] !== undefined && (!lines[end].trim() || indentOf(lines, end + 1) > indent)) end++
    while (end > line && !lines[end - 1].trim()) end--
    functions.push({ name, owner: owners.at(-1)?.name, start: line, nameLine: line, end, kind: keyword, sites: [], calls: new Map(), receivers: new Map() })
  }
  for (const closed of owners) types.push({ name: closed.name, start: closed.line, end: lines.length })
  tokens.forEach((token, index) => {
    if (token.t !== 'id' || tokens[index - 1]?.v !== '.' || tokens[index - 2]?.t !== 'id') return
    const next = tokens[index + 1]
    if (next?.v !== '(' || next.line !== token.line || next.col !== token.col + token.v.length) return
    const fn = functions.findLast((candidate) => candidate.start <= token.line && token.line <= candidate.end)
    if (!fn) return
    if (!fn.calls.has(token.v)) fn.calls.set(token.v, token.line)
    fn.receivers.set(token.v, new Set([...(fn.receivers.get(token.v) ?? []), receiverOf(`${tokens[index - 2].v}.${token.v}`)]))
  })
  return { functions, types, orphans: [] }
}
