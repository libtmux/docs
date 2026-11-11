/** Native Haskell syntax and demanded action paths for the source-usage index. */
import { parserFor } from '../../packages/api-model/src/parser.ts'
import { createHash } from 'node:crypto'

const row = (node) => node.startPosition.row + 1
const field = (node, name) => node?.childForFieldName(name)
const nameOf = (node) => field(node, 'name')?.text.replace(/^\((.*)\)$/, '$1')
const expressions = (node) => node.childrenForFieldName('match').map((match) => field(match, 'expression')).filter(Boolean)
const unwrap = (node) => node?.type === 'parens' && node.namedChildren.length === 1 ? unwrap(node.namedChildren[0]) : node
const values = new Set(['pure', 'return', 'error', 'fail'])

/** Read the public modules and their local imports; unrelated hidden modules are not public command paths. */
export async function reachableHaskellSources(sources, roots) {
  const modules = new Map()
  for (const path of sources.keys()) {
    const module = path.replace(/^(?:src|internal)\//, '').replace(/\.l?hs$/, '').replaceAll('/', '.')
    const paths = modules.get(module) ?? []
    paths.push(path)
    modules.set(module, paths)
  }
  const selected = new Map()
  const pending = [...new Set(roots)]
  if (!pending.length) throw new Error('Haskell source usage coverage: no public source roots')
  // This profile requires the boot Prelude; a local one changes implicit imports.
  if (modules.has('Prelude')) throw new Error('Haskell source usage coverage: same-package Prelude requires separate qualification')
  const parser = await parserFor('haskell')
  try {
    while (pending.length) {
      const path = pending.shift()
      if (selected.has(path)) continue
      const text = sources.get(path)
      if (text === undefined) throw new Error(`Haskell source usage coverage: missing public or imported source ${path}`)
      if (path.endsWith('.lhs')) throw new Error(`Haskell source usage coverage: literate input is not qualified: ${path}`)
      const tree = parser.parse(text)
      try {
        const fail = (message) => { throw new Error(`Haskell source usage coverage (${path}): ${message}`) }
        if (tree.rootNode.hasError) fail('source contains a parse error or missing node')
        if (tree.rootNode.descendantsOfType('cpp').length) fail('conditional module dependencies are not qualified')
        const module = field(tree.rootNode.namedChildren.find((node) => node.type === 'header'), 'module')?.text
        if (!module || !modules.get(module)?.includes(path)) fail('module name differs from its Cabal source path')
        for (const node of field(tree.rootNode, 'imports')?.namedChildren ?? []) {
          const imported = field(node, 'module')?.text
          if (!imported) {
            if (!['comment', 'haddock'].includes(node.type)) fail('unsupported import declaration')
            continue
          }
          const candidates = modules.get(imported) ?? []
          if (candidates.length > 1) fail(`ambiguous local import ${imported}`)
          if (candidates.length) {
            if (field(node, 'package')) fail(`package-qualified local import ${imported} is not qualified`)
            pending.push(candidates[0])
          }
        }
      } finally {
        tree.delete()
      }
      selected.set(path, text)
    }
    return selected
  } finally {
    parser.delete()
  }
}

/** Parse the qualified source profile; unsupported command flow is a generation error. */
export async function scanHaskell(text, { commands, known, dispatch = new Set(), reviewedDigest }) {
  if (reviewedDigest && createHash('sha256').update(text).digest('hex') !== reviewedDigest) {
    throw new Error('Native Haskell usage qualification: source differs from its reviewed digest')
  }
  const parser = await parserFor('haskell')
  const tree = parser.parse(text)
  const module = field(tree.rootNode.namedChildren.find((node) => node.type === 'header'), 'module')?.text ?? 'Main'
  const fail = (node, message) => { throw new Error(`Haskell source usage coverage (${module}:${row(node)}): ${message}`) }
  const infos = []
  const scopes = new Map()
  const deferred = []
  try {
    if (tree.rootNode.hasError) fail(tree.rootNode, 'source contains a parse error or missing node')

    function scopeFor(container, parent) {
      if (!container) return parent
      if (scopes.has(container.id)) return scopes.get(container.id)
      const scope = { parent, names: new Map(), unnamed: [] }
      scopes.set(container.id, scope)
      const signatures = new Map()
      for (const node of container.namedChildren) {
        if (node.type === 'signature') {
          const names = field(node, 'names')?.namedChildren.map((part) => part.text) ?? [nameOf(node)]
          for (const name of names.filter(Boolean)) signatures.set(name, row(node))
        }
      }
      for (const node of container.namedChildren) {
        if (!['function', 'bind'].includes(node.type)) continue
        const name = nameOf(node)
        if (!name) { scope.unnamed.push(node); continue }
        let info = scope.names.get(name)
        if (!info) {
          const record = { name, owner: module, bindingId: `${module}:${node.startIndex}:${name}`,
            start: Math.min(signatures.get(name) ?? row(node), row(node)), nameLine: row(node), end: row(node),
            kind: node.type, sites: [], calls: new Map(), receivers: new Map(), callList: [] }
          info = { record, declarations: [], scope, state: 0 }
          scope.names.set(name, info)
          infos.push(info)
        }
        info.declarations.push(node)
        info.record.end = Math.max(info.record.end, node.endPosition.row + 1)
      }
      return scope
    }

    const root = scopeFor(field(tree.rootNode, 'declarations'), undefined) ?? { names: new Map() }
    // A separately qualified native catalogue supplies reviewed sends. This
    // index only proves the declaration bounds used by the shared claim audit.
    if (reviewedDigest) return { functions: infos.map((info) => info.record), types: [], orphans: [] }
    const preludeImports = field(tree.rootNode, 'imports')?.namedChildren.filter((node) => field(node, 'module')?.text === 'Prelude') ?? []
    const pragmas = tree.rootNode.descendantsOfType('pragma')
    const rebindable = pragmas.some((node) => /\bRebindableSyntax\b/.test(node.text))
    const customPrelude = rebindable || pragmas.some((node) => /\bNoImplicitPrelude\b/.test(node.text))
    const implicitPrelude = !customPrelude && !preludeImports.length
    const standard = (name) => implicitPrelude || preludeImports.some((node) => {
      if (node.children.some((child) => child.type === 'qualified')) return false
      const list = field(node, 'names')
      if (!list) return true
      const listed = list.descendantsOfType(['variable', 'operator']).some((part) => part.text === name)
      return node.children.some((child) => child.type === 'hiding') ? !listed : listed
    })
    const find = (scope, name) => {
      for (let current = scope; current; current = current.parent) if (current.names.has(name)) return current.names.get(name)
      return undefined
    }
    function parameters(node, parent) {
      const patterns = field(node, 'patterns')
      const names = patterns?.descendantsOfType('variable').map((part) => part.text) ?? []
      return { parent, names: new Map(names.map((name) => [name, null])) }
    }
    function context(info, declaration) {
      return scopeFor(field(declaration, 'binds'), parameters(declaration, info.scope))
    }
    function string(node) {
      node = unwrap(node)
      const literal = node?.type === 'literal' ? node.namedChildren[0] : node
      if (literal?.type !== 'string') return undefined
      try { return { value: JSON.parse(literal.text), node: literal } }
      catch { return { unknown: true, node: literal } }
    }
    const commandOf = (value) => {
      const [head, next] = value.split(/\s+/)
      return known.has(head) && (next === undefined || next.startsWith('-')) ? head : undefined
    }
    function mayCommand(node, scope, seen = new Set(), includeBindings = false) {
      if (!node) return false
      if (/quote|splice/.test(node.type) || node.type === 'cpp') return [...known].some((command) => node.text.includes(command))
      const literal = string(node)
      if (literal) return literal.unknown || Boolean(commandOf(literal.value))
      if (node.type === 'variable') {
        const info = find(scope, node.text)
        if (dispatch.has(node.text) && info?.scope === root) return true
        if (info && !seen.has(info)) {
          const next = new Set([...seen, info])
          return info.declarations.some((decl) => expressions(decl).some((expression) => mayCommand(expression, context(info, decl), next, includeBindings)))
        }
      }
      if (['patterns', 'signature'].includes(node.type) || (node.type === 'local_binds' && !includeBindings)) return false
      return node.namedChildren.some((child) => mayCommand(child, scope, seen, includeBindings))
    }
    function application(node, scope) {
      node = unwrap(node)
      if (node.type === 'apply') {
        const inner = application(field(node, 'function'), scope)
        return inner && { ...inner, args: [...inner.args, field(node, 'argument')] }
      }
      if (node.type === 'infix' && field(node, 'operator')?.text === '$' && find(scope, '$') === undefined && standard('$')) {
        const inner = application(field(node, 'left_operand'), scope)
        return inner && { ...inner, args: [...inner.args, field(node, 'right_operand')] }
      }
      if (node.type === 'variable') return { name: node.text, binding: find(scope, node.text), args: [], node }
      if (node.type === 'qualified') {
        const name = field(node, 'id')?.text
        return name && { name, binding: field(node, 'module')?.text === module ? find(root, name) : undefined, args: [], node }
      }
      return undefined
    }
    function argv(node, scope, seen = new Set()) {
      node = unwrap(node)
      const one = string(node)
      if (one) return { literals: [one], list: false }
      if (node.type === 'list') {
        const literals = node.namedChildren.filter((child) => !/comment/.test(child.type)).map(string)
        return literals.every(Boolean) ? { literals, list: true } : undefined
      }
      const call = application(node, scope)
      const info = call?.binding
      if (!info || seen.has(info) || info.declarations.length !== 1) return undefined
      const decl = info.declarations[0]
      const bodies = expressions(decl)
      if (bodies.length !== 1) return undefined
      const result = argv(bodies[0], context(info, decl), new Set([...seen, info]))
      return result && { ...result, origin: info }
    }
    function siteOf(args) {
      if (args.literals.some((literal) => literal.unknown)) fail(args.literals.find((literal) => literal.unknown).node, 'string escapes are not qualified in argv')
      const first = args.literals[0]
      if (!args.list || (first && commandOf(first.value) && !known.has(first.value))) fail(first.node, 'dispatcher requires an explicit argv list with a separate command name')
      const command = first?.value
      if (!commands.has(command)) return undefined
      for (const literal of args.literals) if (literal.value.endsWith(';')) fail(literal.node, 'tmux command separators are not qualified')
      // Without a command's option-arity schema, a second option-looking token may be an operand.
      let flags = ''
      let operand = false
      for (const literal of args.literals.slice(1)) {
        if (literal.value === '--') {
          if (flags || operand) fail(literal.node, 'option terminator may be an operand')
          break
        }
        if (literal.value.startsWith('-')) {
          if (flags || operand || !/^-[A-Za-z]$/.test(literal.value)) fail(literal.node, 'option arity or combined flags need qualification')
          flags = literal.value.slice(1)
        } else operand = true
      }
      return { command, flags, line: row(first.node) }
    }
    function recordCall(info, call, node) {
      const line = row(node)
      const entry = { name: call.name, line, bindingId: call.binding?.record.bindingId ?? null }
      info.record.calls.set(call.name, Math.min(info.record.calls.get(call.name) ?? line, line))
      info.record.callList.push(entry)
      return entry
    }
    function builder(info, args) {
      if (!args.list || args.literals.some((literal) => literal.unknown)) return
      const site = siteOf(args)
      if (site && !info.record.sites.some((other) => other.line === site.line && other.command === site.command)) {
        info.record.sites.push({ ...site, dispatch: null, builds: true, why: 'it builds argv for its caller' })
      }
    }
    function action(node, scope, info) {
      node = unwrap(node)
      if (!node) return
      if (node.type === 'let_in') {
        action(field(node, 'expression'), scopeFor(field(node, 'binds'), scope), info)
        return
      }
      if (node.type === 'do') {
        if (rebindable || node.namedChildren.some((child) => child.type === 'do_module')) fail(node, 'custom do semantics are not qualified')
        let current = scope
        for (const statement of node.childrenForFieldName('statement')) {
          if (statement.type === 'let') current = scopeFor(field(statement, 'binds'), current)
          else if (statement.type === 'exp') action(statement.namedChildren[0], current, info)
          else if (statement.type === 'bind') {
            action(field(statement, 'expression'), current, info)
            const pattern = field(statement, 'pattern')
            const names = pattern?.type === 'variable' ? [pattern.text] : pattern?.descendantsOfType('variable').map((part) => part.text) ?? []
            current = { parent: current, names: new Map(names.map((name) => [name, null])) }
          } else if (mayCommand(statement, current)) fail(statement, 'unsupported do statement')
        }
        return
      }
      if (node.type === 'list' || string(node)) {
        const args = argv(node, scope)
        if (args) builder(info, args)
        return
      }
      if (node.type === 'infix' && ['==', '/=', '<', '>', '<=', '>='].includes(field(node, 'operator')?.text)) return
      const call = application(node, scope)
      if (call) {
        if (call.binding === undefined && ((call.node.type === 'variable' && standard(call.name) && values.has(call.name)) || /^[A-Z]/.test(call.name))) return
        const entry = recordCall(info, call, call.node)
        if (dispatch.has(call.name) && call.binding && call.binding.scope === root) {
          const groups = call.args.map((argument) => ({ args: argv(argument, scope), node: argument }))
          const selected = groups.filter(({ args }) => args && (args.literals.some((literal) => literal.unknown) || commandOf(args.literals[0]?.value ?? '')))
          if (selected.length !== 1) {
            fail(node, 'dispatcher argv is not one known argument value')
          }
          const { args, node: argument } = selected[0]
          const site = siteOf(args)
          if (!site) return
          const sent = { name: call.name, line: row(call.node) }
          if (args.origin) {
            builder(args.origin, args)
            const built = recordCall(info, { name: args.origin.record.name, binding: args.origin }, argument)
            ;(info.record.callsites ??= []).push({ ...built, flows: sent })
          } else info.record.sites.push({ ...site, dispatch: sent })
          return
        }
        if (call.binding) {
          if (call.args.some((argument) => mayCommand(argument, scope, new Set(), true))) deferred.push({ target: call.binding, node })
          analyze(call.binding)
          return
        }
        if (mayCommand(node, scope, new Set(), true)) fail(node, `unresolved or higher-order action ${entry.name}`)
        info.unresolved = true
        return
      }
      if (mayCommand(node, scope, new Set(), true)) fail(node, `unsupported action expression ${node.type}`)
    }
    function analyze(info) {
      if (info.state) return
      info.state = 1
      for (const declaration of info.declarations) {
        const scope = context(info, declaration)
        for (const match of declaration.childrenForFieldName('match')) {
          const guards = field(match, 'guards')
          if (mayCommand(guards, scope, new Set(), true)) fail(guards, 'command-bearing guards are not qualified')
        }
        for (const expression of expressions(declaration)) action(expression, scope, info)
      }
      info.state = 2
    }
    if (tree.rootNode.descendantsOfType('cpp').length && mayCommand(tree.rootNode, root)) fail(tree.rootNode, 'CPP command alternatives are not qualified')
    for (const node of field(tree.rootNode, 'declarations')?.namedChildren ?? []) {
      if (!['function', 'bind', 'signature', 'comment'].includes(node.type) && mayCommand(node, root, new Set(), true)) fail(node, `unsupported declaration ${node.type}`)
    }
    for (const info of root.names.values()) analyze(info)
    for (const scope of scopes.values()) for (const node of scope.unnamed) {
      if (mayCommand(node, scope, new Set(), true)) fail(node, 'command-bearing pattern bindings are not qualified')
    }
    const byId = new Map(infos.map((info) => [info.record.bindingId, info]))
    let changed
    do {
      changed = false
      for (const info of infos) if (!info.unresolved && info.record.callList.some((call) => byId.get(call.bindingId)?.unresolved)) {
        info.unresolved = true
        changed = true
      }
    } while (changed)
    for (const { target, node } of deferred) if (target.unresolved) fail(node, 'command arguments cross an unresolved helper flow')
    return { functions: infos.map((info) => info.record), types: [], orphans: [] }
  } finally {
    tree.delete()
    parser.delete()
  }
}
