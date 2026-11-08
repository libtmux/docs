/** Read Clojure definitions and Java interop calls without evaluating forms. */
function forms(text) {
  let at = 0
  let line = 1
  const step = () => { if (text[at++] === '\n') line++ }
  const skip = () => {
    while (at < text.length) {
      if (/[\s,]/.test(text[at])) step()
      else if (text[at] === ';') { while (at < text.length && text[at] !== '\n') step() }
      else break
    }
  }
  const read = () => {
    skip()
    const start = line
    if (at >= text.length) throw new Error(`Incomplete Clojure form at line ${line}`)
    if (text.startsWith('#_', at)) { step(); step(); read(); return { kind: 'ignored', start, end: line } }
    if (text[at] === '^') { step(); read(); return read() }
    if (text[at] === "'" || text[at] === '`' || text.startsWith("#'", at)) {
      if (text[at] === '#') step()
      step(); read(); return { kind: 'ignored', start, end: line }
    }
    let prefix = ''
    if (text[at] === '#' && '({"'.includes(text[at + 1] ?? ' ')) { prefix = '#'; step() }
    const open = text[at]
    if ('([{'.includes(open)) {
      const close = { '(': ')', '[': ']', '{': '}' }[open]
      const children = []
      step(); skip()
      while (at < text.length && text[at] !== close) { children.push(read()); skip() }
      if (text[at] !== close) throw new Error(`Unclosed Clojure form at line ${start}`)
      step()
      return { kind: open === '(' ? 'list' : 'data', children, start, end: line, prefix }
    }
    if (open === '"') {
      let value = ''
      step()
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\') { step(); value += text[at] ?? ''; step() }
        else { value += text[at]; step() }
      }
      if (text[at] !== '"') throw new Error(`Unclosed Clojure string at line ${start}`)
      step()
      return { kind: prefix ? 'ignored' : 'string', value, start, end: line }
    }
    const begin = at
    if (text[at] === '\\') { step(); if (at < text.length) step() }
    while (at < text.length && !/[\s,()[\]{}";]/.test(text[at])) step()
    if (at === begin) throw new Error(`Unexpected Clojure delimiter at line ${line}`)
    return { kind: 'symbol', value: text.slice(begin, at), start, end: line }
  }
  const result = []
  skip()
  while (at < text.length) { result.push(read()); skip() }
  return result
}

/** Source spans, calls and literal sends; dynamic argv stays unclassified. */
export function scanClojure(text, { commands, dispatch = new Set() }) {
  const functions = []
  const strings = (node) => node.kind === 'string' ? [node] : node.kind === 'data' ? node.children.flatMap(strings) : []
  const walk = (node, fn) => {
    if (node.kind === 'ignored' || node.children?.[0]?.value === 'comment') return
    if (node.kind === 'list') {
      const head = node.children[0]
      if (head?.kind === 'symbol') {
        let name = head.value
        let receiver
        if (name.startsWith('.')) { name = name.slice(1); receiver = node.children[1]?.value }
        else if (name.includes('/')) { [receiver, name] = name.split('/') }
        if (!fn.calls.has(name)) fn.calls.set(name, head.start)
        if (receiver) fn.receivers.set(name, new Set([...(fn.receivers.get(name) ?? []), receiver.toLowerCase()]))
        if (dispatch.has(name)) {
          const literals = node.children.slice(1).flatMap(strings)
          const command = literals[0]
          if (commands.has(command?.value)) fn.sites.push({
            command: command.value, line: command.start,
            flags: [...new Set(literals.slice(1).flatMap((token) => /^-[A-Za-z]+$/.test(token.value) ? Array.from(token.value.slice(1)) : []))].sort().join(''),
            dispatch: { name, line: head.start },
          })
        }
      }
    }
    for (const child of node.children ?? []) walk(child, fn)
  }
  for (const form of forms(text)) {
    const [head, name, ...body] = form.children ?? []
    if (form.kind !== 'list' || !['defn', 'defn-'].includes(head?.value) || name?.kind !== 'symbol') continue
    const fn = { name: name.value, start: form.start, nameLine: name.start, end: form.end,
      kind: 'function', sites: [], calls: new Map(), receivers: new Map() }
    for (const child of body) if (child.kind !== 'string') walk(child, fn)
    functions.push(fn)
  }
  return { functions, types: [], orphans: [] }
}
