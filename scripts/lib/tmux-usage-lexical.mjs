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

/**
 * Julia: `function name(...)`, the `end` at its indent, short-form `name(...) = ...`, and the sends and calls inside.
 * @param {string} text
 * @param {{ commands: ReadonlySet<string>, known: ReadonlySet<string>, dispatch?: ReadonlySet<string> }} input
 */
export function scanJulia(text, { commands, known, dispatch }) {
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
      // The arguments can span lines, and the body starts where the `=` is.
      end = Math.max(line, tokens[after].line)
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
    // A method of a generic function is told apart by the type of its first argument: `server::Server`, `connection::ControlConnection{T}`.
    const selfType = tokens[at + 1]?.t === 'id' && tokens[at + 2]?.v === ':' && tokens[at + 3]?.v === ':' && tokens[at + 4]?.t === 'id' ? tokens[at + 4].v : undefined
    functions.push({ name: path.at(-1), start, nameLine: line, end, kind: 'function', sites: [], calls: new Map(), receivers: new Map(), ...(selfType ? { receiverType: selfType } : {}) })
  }
  /**
   * A table loop defines one function per row: `for (op, command, Ref) in ((:kill_pane, "kill-pane", PaneRef), ...)`
   * with an `@eval function $op(...)` body. Each row is a function over the whole loop, and a `$command` in the
   * body is the command of the row.
   */
  const loops = []
  for (const [line, index] of first) {
    if (tokens[index].t !== 'id' || tokens[index].v !== 'for' || tokens[index + 1]?.v !== '(') continue
    const pattern = groups.find((group) => group.open === index + 1)
    const rowsOpen = pattern && tokens[pattern.close + 1]?.v === 'in' && tokens[pattern.close + 2]?.v === '(' ? pattern.close + 2 : undefined
    const rowsGroup = rowsOpen && groups.find((group) => group.open === rowsOpen)
    if (!rowsGroup) continue
    const vars = tokens.slice(pattern.open + 1, pattern.close).filter((token) => token.t === 'id').map((token) => token.v)
    const indent = indentOf(lines, line)
    let end = 0
    for (let next = tokens[rowsGroup.close].line + 1; next <= lines.length; next++) {
      if (new RegExp(`^\\s{${indent}}end\\b`).test(lines[next - 1] ?? '')) { end = next; break }
    }
    if (!end) continue
    const rows = []
    for (let at = rowsGroup.open + 1; at < rowsGroup.close; at++) {
      const row = tokens[at]?.v === '(' ? groups.find((group) => group.open === at) : undefined
      if (!row) continue
      const elements = []
      let current = []
      for (let item = row.open + 1; item < row.close; item++) {
        if (tokens[item].v === ',') { elements.push(current); current = [] } else current.push(tokens[item])
        if ('([{'.includes(tokens[item].v)) item = groups.find((group) => group.open === item)?.close ?? item
      }
      elements.push(current)
      const name = elements[0]?.length === 2 && elements[0][0].v === ':' ? elements[0][1].v : undefined
      const spelled = elements.findIndex((parts) => parts.length === 1 && parts[0].t === 'str' && known.has(parts[0].v.split(/\s+/)[0]))
      if (name && spelled >= 0) rows.push({ name, command: elements[spelled][0].v, commandVar: vars[spelled] })
      at = row.close
    }
    if (!rows.length) continue
    const fns = rows.map((row) => ({ name: row.name, start: line, nameLine: line, end, kind: 'loop', sites: [], calls: new Map(), receivers: new Map(), synthetic: true, row }))
    functions.push(...fns)
    loops.push({ bodyStart: tokens[rowsGroup.close].line + 1, end, fns })
  }
  /** The name a function is declared with is not a call of it. */
  const isDefinitionName = (token, index, fn) => token.line === fn.nameLine && token.v === fn.name
    && (tokens[index - 1]?.v === 'function' || tokens[index - 1]?.line !== token.line || tokens[index - 1]?.v === '.')
  const owner = (line) => functions.findLast((fn) => !fn.synthetic && fn.nameLine <= line && line <= fn.end)
  const isCommand = (token) => {
    if (token.t !== 'str' || token.doc) return undefined
    const [head, next] = token.v.split(/\s+/)
    return known.has(head) && (next === undefined || next.startsWith('-')) ? head : undefined
  }
  /** The flags written in the widest bracket group around a token that holds no other command. */
  const flagsAround = (index, command) => {
    const holds = (group) => tokens.slice(group.open + 1, group.close).some((other) => {
      const found = isCommand(other)
      return found && found !== command
    })
    const enclosing = groups.filter((group) => group.open < index && index < group.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))
    let around = [tokens[index]]
    for (const group of enclosing) {
      if (holds(group)) break
      around = tokens.slice(group.open, group.close + 1)
    }
    return [...flagLetters(around)].sort().join('')
  }
  const adjacentCall = (index) => tokens[index]?.t === 'id' && !JULIA_KEYWORDS.has(tokens[index].v) && tokens[index + 1]?.v === '(' && tokens[index + 1].line === tokens[index].line
    && tokens[index + 1].col === tokens[index].col + tokens[index].v.length
  const symbolAt = (i, ...values) => tokens[i]?.t === 'sym' && values.includes(tokens[i].v)
  /**
   * Whether a `?` on the line chooses this command against another one. A condition that only gates the call, `isempty(ss) ? [] : rows("list-windows")`,
   * leaves a single command on the line and sends it when the condition holds.
   */
  const chosenOnLine = (index) => {
    const line = tokens[index].line
    if (!tokens.some((other, at) => other.line === line && symbolAt(at, '?'))) return false
    const here = isCommand(tokens[index])
    return tokens.some((other) => other.line === line && other !== tokens[index] && isCommand(other) && isCommand(other) !== here)
  }
  /** A command that is compared with, or one of several a `?:` chooses between, names a command and sends nothing. */
  const chosenOrCompared = (index) => symbolAt(index - 1, '=', '!') && symbolAt(index - 2, '=', '!', '<', '>') || (symbolAt(index + 1, '=', '!') && symbolAt(index + 2, '='))
    || tokens[index - 1]?.v === 'in' || tokens[index - 1]?.v === '∈' || tokens[index + 1]?.v === 'in'
    || chosenOnLine(index)
  /** The variables an `=` before the literal, in the same statement, binds it to. */
  const boundNames = (index) => {
    let depth = 0
    for (let at = index - 1, steps = 0; at >= 0 && steps < 80; at--, steps++) {
      const token = tokens[at]
      if (token.t === 'sym' && ')]}'.includes(token.v)) depth++
      else if (token.t === 'sym' && '([{'.includes(token.v) && depth) depth--
      else if (!depth && token.t === 'id' && JULIA_KEYWORDS.has(token.v) && !['local', 'const', 'global'].includes(token.v)) return []
      else if (!depth && symbolAt(at, '=') && !symbolAt(at - 1, '=', '!', '<', '>') && !symbolAt(at + 1, '=')) {
        let name = at - 1
        // `args::Vector{String} = ...` names args.
        while (name >= 0 && !(tokens[name].t === 'id' && !symbolAt(name + 1, '.'))) name--
        return name >= 0 && at - name < 12 ? [tokens[name].v] : []
      }
    }
    return []
  }
  /** Decide whether a site is sent: now when a dispatcher call encloses it, at the end of the file when it is bound. */
  const classify = (fn, site, index) => {
    const never = (why) => { site.dispatch = null; site.why = why }
    if (chosenOrCompared(index)) return never('a condition chooses it, or it is compared with')
    const enclosing = groups.filter((group) => group.open < index && index < group.close).sort((a, b) => (a.close - a.open) - (b.close - b.open))
    for (const group of enclosing) {
      if (adjacentCall(group.open - 1) && dispatch.has(tokens[group.open - 1].v)) { site.dispatch = { line: tokens[group.open - 1].line, name: tokens[group.open - 1].v }; return undefined }
    }
    const names = boundNames(index)
    if (!names.length) return never('it reaches no call that sends')
    ;(fn.pending ??= []).push({ site, names, after: index, command: site.command })
    return undefined
  }
  tokens.forEach((token, index) => {
    const loop = loops.find((candidate) => candidate.bodyStart <= token.line && token.line <= candidate.end)
    const targets = loop ? loop.fns : [owner(token.line)].filter(Boolean)
    const command = isCommand(token)
    if (command && commands.has(command)) {
      for (const fn of targets) {
        const site = { command, line: token.line, flags: flagsAround(index, command) }
        if (dispatch) classify(fn, site, index)
        fn.sites.push(site)
      }
    }
    // `$command` in a table loop is the command of each row.
    if (loop && token.v === '$' && tokens[index + 1]?.t === 'id') {
      for (const fn of loop.fns) {
        if (fn.row.commandVar === tokens[index + 1].v && commands.has(fn.row.command.split(/\s+/)[0])) {
          const site = { command: fn.row.command.split(/\s+/)[0], line: token.line, flags: flagsAround(index + 1, fn.row.command.split(/\s+/)[0]) }
          if (dispatch) classify(fn, site, index)
          fn.sites.push(site)
        }
      }
    }
    if (dispatch && adjacentCall(index) && dispatch.has(token.v)) {
      const group = groups.find((candidate) => candidate.open === index + 1)
      const inside = group ? tokens.slice(group.open + 1, group.close) : []
      const call = {
        name: token.v, line: token.line, start: index,
        names: new Set(inside.filter((part) => part.t === 'id').map((part) => part.v)),
        commands: new Set(inside.map((part) => isCommand(part)).filter(Boolean)),
      }
      for (const fn of targets) if (!isDefinitionName(token, index, fn)) (fn.sends ??= []).push(call)
    }
    if (token.t === 'id' && !JULIA_KEYWORDS.has(token.v) && tokens[index + 1]?.v === '(' && tokens[index + 1].line === token.line
      && tokens[index + 1].col === token.col + token.v.length) {
      for (const fn of targets) {
        if (isDefinitionName(token, index, fn)) continue
        if (!fn.calls.has(token.v)) fn.calls.set(token.v, token.line)
        const receiver = tokens[index - 1]?.v === '.' && tokens[index - 2]?.t === 'id' ? tokens[index - 2].v.toLowerCase() : undefined
        if (receiver) fn.receivers.set(token.v, new Set([...(fn.receivers.get(token.v) ?? []), receiver]))
      }
    }
  })
  for (const fn of functions) {
    for (const { site, names, after, command } of fn.pending ?? []) {
      const call = (fn.sends ?? []).find((candidate) => candidate.start > after && names.some((name) => candidate.names.has(name))
        && [...candidate.commands].every((other) => other === command))
      if (call) site.dispatch = { line: call.line, name: call.name }
      else { site.dispatch = null; site.why = 'it reaches no call that sends' }
    }
    delete fn.pending
    delete fn.sends
  }
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
