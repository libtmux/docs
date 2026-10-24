/**
 * The scopes tmux gives one command, read from its C dispatch.
 *
 * `list-panes` lists the server with `-a`, a session with `-s`, and otherwise
 * the target window. Each scope has a C function, so a libtmux method that
 * sends the command at a scope can be linked to that function and back.
 */

/** The flags a library call must spell to count as a scope: the C flag, or the target flag of the default scope. */
export function libraryScopes(entry) {
  return entry.scopes.map((scope) => ({ id: scope.id, flags: scope.flag || scope.target || '' }))
}

/**
 * The flag that guards the call on `line` (1-based) of a tmux source file:
 * `a` for `if (args_has(args, 'a'))`, an empty string for a bare `else`.
 * Anything else is not a dispatch this table can describe.
 */
export function guardFlag(source, line) {
  const lines = source.split('\n')
  for (let index = line - 2; index >= Math.max(0, line - 3); index--) {
    const text = lines[index]
    if (/^\s*$/.test(text)) continue
    const flag = /args_has\(\s*args\s*,\s*'(\w)'\s*\)/.exec(text)
    if (flag) return flag[1]
    if (/^\s*(?:\}\s*)?else\s*(?:\{\s*)?$/.test(text)) return ''
    return undefined
  }
  return undefined
}

/**
 * Problems with one command's scope table against one release's C model.
 * @param {{ scopes: { id: string, flag: string, function: string, inline?: string[] }[] }} entry
 * @param {{ version?: string, commands: { name: string, callback: string }[], symbols: { id: string, name: string, references?: { target: string, kind: string, sites?: { file: string, line: number }[] }[] }[] }} model
 * @param {string} command
 * @param {(file: string) => string | undefined} [readSource] The release's C source, when a checkout is at hand.
 */
export function scopeProblems(entry, model, command, readSource) {
  const problems = []
  const registered = model.commands.find((candidate) => candidate.name === command)
  const exec = registered && model.symbols.find((symbol) => symbol.id === registered.callback)
  if (!exec) return [`${command}: no registered callback`]
  for (const scope of entry.scopes) {
    const target = model.symbols.find((symbol) => symbol.name === scope.function && symbol.id.startsWith('c:function:'))
    // A release can dispatch inline, with no function for the scope; the table must say so and the function must really be absent.
    if (scope.inline?.includes(model.version)) {
      if (target) problems.push(`${command}: ${scope.function} exists in tmux ${model.version}, so the scope is not inline there`)
      continue
    }
    const call = target && exec.references?.find((reference) => reference.kind === 'call' && reference.target === target.id)
    if (!call) { problems.push(`${command}: ${exec.name} does not call ${scope.function}`); continue }
    const site = call.sites?.[0]
    const source = site && readSource?.(site.file)
    if (source === undefined || !site) continue
    const flag = guardFlag(source, site.line)
    if (flag !== scope.flag) problems.push(`${command}: ${scope.function} is called under ${flag === undefined ? 'no readable guard' : `'${flag}'`}, not '${scope.flag}'`)
  }
  return problems
}
