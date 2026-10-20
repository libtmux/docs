/**
 * Decide which public symbols send a tmux command, and at which scope.
 *
 * A symbol sends a command when a send site sits in its own body or in a
 * private helper it calls. The walk goes up the callers of a helper and stops
 * at the first public symbol on each path, so a method that only reads what
 * another public method captured is not credited with the capture.
 */

/** Calls between a send site and the public symbol that wraps it. */
export const MAX_HOPS = 1

/**
 * A helper that this many public symbols call is infrastructure, such as a
 * refresh after every mutation, and crediting each caller would list methods
 * whose purpose is another command.
 */
export const MAX_SHARED_BY = 4

/** The scope a site's flags select, `null` for a command without scopes, `unknown` when no flag settles it. */
export function classify(spec, flags) {
  if (!spec?.scopes) return null
  for (const scope of spec.scopes) if ([...scope.flags].every((flag) => flags.includes(flag))) return scope.id
  return 'unknown'
}

/**
 * Whether a claim, an exclusion or a review is read against the source at `revision`. One without a `revision` holds
 * for the revision its port's model was extracted at; one with a `revision` holds for the revision it starts with,
 * which is how a wrapper that shares a repository with its core library reads the core where the wrapper is pinned.
 */
export const ruleHolds = (rule, revision, pinned) => (rule.revision ? revision.startsWith(rule.revision) : revision === pinned)

const SELF_RECEIVERS = new Set(['this', 'self', 'base', 'super', 'cls', 'me'])

/**
 * Whether a call in `caller` is a call of `callee`. A name that only one function has can be nothing else. A name that
 * several share is resolved by what the call is made on: an unqualified call or one on `self` is the caller's own type's
 * (a free function, when the callee has no type), and a call on a handle named for a type is that type's. A call on
 * anything else is left unresolved, because naming `into_command` is not naming the one in `CaptureOptions`.
 *
 * @param {{ calls: Map<string, number>, receivers: Map<string, Set<string>>, owner?: string }} caller
 * @param {{ name: string, owner?: string, file?: string }} callee
 * @param {{ owner?: string, file?: string }[]} named every function of the port that has the callee's name
 */
export function callTargets(caller, callee, named) {
  if (!caller.calls.has(callee.name)) return false
  if (named.length <= 1) return true
  const receivers = caller.receivers.get(callee.name)
  // Go names its receiver, `func (p Pane) ...`, and calls its own methods on it.
  const unqualified = !receivers || [...receivers].every((receiver) => SELF_RECEIVERS.has(receiver) || receiver === caller.selfName)
  // A call with no handle in front of it is a free function's, and with a second free function of the name it is the one in the
  // caller's own file or none: which one an import names is not read.
  if (callee.owner === undefined) return !receivers && (caller.file === callee.file || named.filter((other) => other.owner === undefined).length === 1)
  if (unqualified) return caller.owner === callee.owner
  return receivers.has(callee.owner.toLowerCase())
}

/** `panes(where:)`, `Server.panes` and `Server#list_panes` all name their last identifier. */
export function bareName(name) {
  // Kotlin and Scala quote a name that is also a keyword: Buffers.`set`.
  return name.replace(/\(.*$/s, '').replace(/`/g, '').split(/[.:#\\]+/).filter(Boolean).at(-1) ?? name
}

/**
 * @typedef {import('./tmux-usage-scan.mjs').ScannedFunction & { file: string }} LocatedFunction
 * @typedef {{ id: string, name: string, qualified?: string, parentName?: string, file: string, line: number, overloaded?: boolean }} UsageSymbol
 * @typedef {{ symbol: string, command: string, scope: string | null, evidence: string[], hops: number }} UsageEntry
 * @typedef {{ file: string, line: number, function: string, reason: string }} Unresolved
 */

/**
 * The functions that are each public symbol's own definition, overloads included.
 * @param {LocatedFunction[]} functions
 * @param {UsageSymbol[]} symbols
 * @param {{ sharedOwner?: boolean, freeFunctions?: boolean }} [options] `sharedOwner` accepts the one same-named function of a file under
 *   another owner; `freeFunctions` gives a function with no owner every same-named function in the port, as Julia's methods of one function are.
 * @returns {Map<LocatedFunction, UsageSymbol[]>}
 */
export function definitionsOf(functions, symbols, { sharedOwner = false, freeFunctions = false } = {}) {
  const byFile = Map.groupBy(functions, (fn) => fn.file)
  const byName = Map.groupBy(functions, (fn) => fn.name)
  const definitions = new Map()
  for (const symbol of symbols) {
    const name = bareName(symbol.name)
    const inFile = (byFile.get(symbol.file) ?? []).filter((fn) => fn.name === name)
    let hits = inFile.filter((fn) => symbol.line >= fn.start && symbol.line <= fn.nameLine)
    if (!hits.length) hits = inFile.filter((fn) => symbol.line >= fn.start && symbol.line <= fn.end)
    if (hits.length && symbol.overloaded) hits = inFile.filter((fn) => hits.some((hit) => hit.owner === fn.owner))
    const owner = symbol.parentName && bareName(symbol.parentName)
    // A type annotation can sit apart from the function it describes, in the same file.
    if (!hits.length && owner) hits = inFile.filter((fn) => fn.owner === owner)
    // The methods of one Julia function are spread over files, and all of them answer to its one symbol.
    if (freeFunctions && !symbol.parentName) hits = (byName.get(name) ?? []).filter((fn) => !fn.owner)
    // Handles that share one implementation are declared apart from it: `Pane`, `Window` and `Session` methods all defined once on a base.
    if (!hits.length && sharedOwner && inFile.length === 1) hits = inFile
    // A declaration in a header is defined in another file under the same type name.
    if (!hits.length && owner && !inFile.length) {
      hits = (byName.get(name) ?? []).filter((fn) => fn.owner === owner
        && (fn.namespace === undefined || symbol.qualified === undefined || symbol.qualified === `${fn.namespace}::${owner}::${name}`))
    }
    for (const fn of hits) definitions.set(fn, [...(definitions.get(fn) ?? []), symbol])
  }
  // Several declarations can share one definition's name; the header named like the source file owns it.
  const stem = (path) => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
  for (const [fn, owned] of definitions) {
    const matching = owned.filter((symbol) => symbol.file !== fn.file && stem(symbol.file) === stem(fn.file))
    if (owned.length > 1 && matching.length) definitions.set(fn, owned.filter((symbol) => symbol.file === fn.file || matching.includes(symbol)))
  }
  return definitions
}

/**
 * A helper that builds a command and hands it back sends nothing itself: its caller sends the value it gets, by passing the
 * call to a dispatch call or the variable it binds the call to. That is a send of the caller, made with a command the helper
 * spelled, and it is recorded at the dispatch call with the call of the helper and the literal after it.
 *
 * @returns {Map<object, object[]>} the sites to add to each function that sends through a helper
 */
export function builtSites(functions) {
  const byName = Map.groupBy(functions, (fn) => fn.name)
  const built = new Map()
  for (const caller of functions) {
    for (const call of caller.callsites ?? []) {
      const candidates = byName.get(call.name) ?? []
      for (const builder of candidates) {
        const sites = builder.sites.filter((site) => site.builds)
        if (builder === caller || !sites.length) continue
        const pseudo = { file: caller.file, calls: new Map([[call.name, call.line]]), receivers: new Map(call.receiver ? [[call.name, new Set([call.receiver])]] : []), owner: caller.owner }
        if (!callTargets(pseudo, builder, candidates)) continue
        for (const site of sites) {
          const list = built.get(caller) ?? []
          if (list.some((held) => held.command === site.command && held.line === site.line && held.via.call === call.line)) continue
          list.push({ command: site.command, line: site.line, flags: site.flags, dispatch: call.flows, via: { call: call.line, file: builder.file, name: builder.name } })
          built.set(caller, list)
        }
      }
    }
  }
  return built
}

/**
 * @param {{ command: string, spec?: { scopes?: { id: string, flags: string }[] }, functions: LocatedFunction[], symbols: UsageSymbol[] }} input
 * @returns {{ entries: UsageEntry[], unresolved: Unresolved[] }}
 */
export function deriveUsage({ command, spec, functions, symbols, definitionOptions }) {
  const built = builtSites(functions)
  const byName = Map.groupBy(functions, (fn) => fn.name)
  const definitions = definitionsOf(functions, symbols, definitionOptions)

  /** The functions that call `fn`, by what each call resolves to and not by the name alone. */
  const callersOf = (fn) => {
    const named = byName.get(fn.name) ?? []
    return functions.filter((other) => other !== fn && callTargets(other, fn, named))
  }

  /** Public symbols reached from `fn`, each with the call sites walked to reach it. */
  const reach = (fn, trail, depth) => {
    const own = definitions.get(fn)
    if (own) return own.map((symbol) => ({ symbol, trail }))
    if (depth >= MAX_HOPS) return []
    return callersOf(fn).flatMap((caller) => reach(caller, [...trail, `${caller.file}:${caller.calls.get(fn.name)}`], depth + 1))
  }

  const entries = new Map()
  const unresolved = []
  for (const fn of functions) {
    const found = [...fn.sites, ...(built.get(fn) ?? [])].filter((site) => site.command === command)
    if (!found.length) continue
    // A literal that reaches no call that sends is a label, a comparison or a choice, and records nothing.
    for (const site of found.filter((candidate) => candidate.dispatch === null)) {
      unresolved.push({ file: fn.file, line: site.line, function: fn.name, reason: site.why ?? 'it reaches no call that sends' })
    }
    const sites = found.filter((site) => site.dispatch !== null)
    if (!sites.length) continue
    const scoped = sites.map((site) => ({ site, scope: classify(spec, site.flags) }))
    for (const { site, scope } of scoped) {
      if (scope === 'unknown') {
        unresolved.push({ file: fn.file, line: site.line, function: fn.name, reason: 'no scope flag beside the command' })
      }
    }
    const known = scoped.filter(({ scope }) => scope !== 'unknown')
    const isPublic = definitions.has(fn)
    // A helper that lists at several scopes cannot say which one its caller wants.
    const ambiguous = !isPublic && new Set(known.map(({ scope }) => scope)).size > 1
    if (ambiguous) {
      unresolved.push({ file: fn.file, line: known[0].site.line, function: fn.name, reason: 'a shared helper lists at several scopes' })
      continue
    }
    for (const { site, scope } of known) {
      const reached = reach(fn, [], 0)
      if (!reached.length) {
        unresolved.push({ file: fn.file, line: site.line, function: fn.name, reason: 'no public symbol reaches it' })
        continue
      }
      if (!isPublic && new Set(reached.map(({ symbol }) => symbol.id)).size > MAX_SHARED_BY) {
        unresolved.push({ file: fn.file, line: site.line, function: fn.name, reason: `a helper shared by ${new Set(reached.map(({ symbol }) => symbol.id)).size} public symbols` })
        continue
      }
      for (const { symbol, trail } of reached) {
        const key = `${symbol.id}\0${scope}`
        // The line to cite is the call that sends, which is where the command is dispatched and not where it is spelled.
        const lines = site.via
          ? [`${fn.file}:${site.dispatch.line}`, `${fn.file}:${site.via.call}`, `${site.via.file}:${site.line}`]
          : [`${fn.file}:${site.dispatch?.line ?? site.line}`]
        const entry = { symbol: symbol.id, command, scope, evidence: [...lines, ...trail.toReversed()], hops: trail.length + lines.length - 1 }
        // The same command sent on several paths is cited where the fewest calls reach it, then where it is under the fewest branches.
        Object.defineProperty(entry, 'depth', { value: site.depth ?? 0 })
        const held = entries.get(key)
        if (!held || held.hops > entry.hops || (held.hops === entry.hops && held.depth > entry.depth)) entries.set(key, entry)
      }
    }
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || String(a.scope).localeCompare(String(b.scope))),
    unresolved,
  }
}

/**
 * Reviewed claims for the sends a scan cannot see: a command named by a
 * template, a scope carried by a typed argument, or a call into a snapshot.
 * Each claim cites the lines that make it true, and the line text must still
 * say so at the pinned revision.
 *
 * A wrapper's claim can name the library symbol it calls, `via`, for a call the forwarding rule
 * cannot take on trust, such as one that passes the depth a reviewed claim depends on. It then
 * stands only while that symbol sends the command at the same scope, and keeps that symbol's lines.
 *
 * @typedef {{ at: string, has?: string[], span?: number, in?: string }} Evidence
 * @typedef {{ port: string, symbol: string, command: string, scope: string | null, evidence: Evidence[], forwardable?: boolean, via?: { port: string, symbol: string } }} Claim
 * @param {{
 *   claims: Claim[],
 *   spec?: { scopes?: { id: string }[] },
 *   functions: LocatedFunction[],
 *   types: { file: string, name?: string, start: number, end: number }[],
 *   symbols: UsageSymbol[],
 *   readSource: (path: string) => string | undefined,
 *   sends?: (port: string, symbol: string, command: string, scope: string | null) => { evidence: string[], revision: string, reviewed?: boolean } | undefined,
 * }} input
 * @returns {{ entries: UsageEntry[], problems: string[] }}
 */
export function verifyClaims({ claims, spec, functions, types, symbols, readSource, definitionOptions, sends = () => undefined }) {
  const definitions = definitionsOf(functions, symbols, definitionOptions)
  const bySymbol = new Map(symbols.map((symbol) => [symbol.id, symbol]))
  const entries = []
  const problems = []
  for (const claim of claims) {
    const label = `${claim.port}: ${claim.symbol} ${claim.command} ${claim.scope}`
    const fail = (message) => problems.push(`${label}: ${message}`)
    const symbol = bySymbol.get(claim.symbol)
    if (!symbol) { fail('no such public symbol in the API model'); continue }
    if (spec?.scopes ? !spec.scopes.some((scope) => scope.id === claim.scope) : claim.scope !== null) {
      fail('not a scope of this command')
      continue
    }
    if (!claim.evidence?.length) { fail('cites no evidence'); continue }
    let anchored = false
    let broken = false
    for (const item of claim.evidence) {
      const [file, line] = [item.at.slice(0, item.at.lastIndexOf(':')), Number(item.at.slice(item.at.lastIndexOf(':') + 1))]
      const lines = readSource(file)?.split('\n')
      const sourceLine = lines?.[line - 1]
      if (sourceLine === undefined) { fail(`${item.at} is not a line of the pinned source`); broken = true; continue }
      // A call that spans lines names its command a few lines below the call: the first text is on the cited
      // line, which is the one that sends, and the rest are in the next `span` lines of the same statement.
      const statement = lines.slice(line - 1, line - 1 + (item.span ?? 1)).join('\n')
      for (const [position, needle] of (item.has ?? []).entries()) {
        if (!(position === 0 ? sourceLine : statement).includes(needle)) { fail(`${item.at} does not contain ${JSON.stringify(needle)}`); broken = true }
      }
      if (item.in !== undefined) {
        if (item.in !== claim.symbol) { fail(`${item.at} anchors to ${item.in}, not the claimed symbol`); broken = true; continue }
        const inside = [...definitions].some(([fn, owned]) => owned.includes(symbol) && fn.file === file && line >= fn.start && line <= fn.end)
          || (![...definitions.values()].some((owned) => owned.includes(symbol))
            && types.some((type) => type.file === file && symbol.file === file && symbol.line >= type.start && symbol.line <= type.end && line >= type.start && line <= type.end))
        if (inside) anchored = true
        else { fail(`${item.at} is outside the body of ${claim.symbol}`); broken = true }
      }
    }
    if (!broken && !anchored) { fail('no evidence line is anchored in the symbol with "in"'); broken = true }
    const core = claim.via && sends(claim.via.port, claim.via.symbol, claim.command, claim.scope)
    if (!broken && claim.via && !core) {
      fail(`${claim.via.port} ${claim.via.symbol} does not send ${claim.command} at that scope`)
      broken = true
    }
    if (!broken) {
      entries.push({
        symbol: claim.symbol, command: claim.command, scope: claim.scope, evidence: claim.evidence.map((item) => item.at),
        hops: claim.evidence.length - 1, reviewed: true, ...(claim.forwardable ? { forwardable: true } : {}),
        ...(core ? { via: { port: claim.via.port, symbol: claim.via.symbol, revision: core.revision, evidence: core.evidence, ...(core.reviewed ? { reviewed: true } : {}) } } : {}),
      })
    }
  }
  return { entries, problems }
}

/**
 * Public symbols that carry a command's name and send nothing: a plan or a chain records the command
 * for a later run, a request turns itself into a command value, a function returns the line to type.
 * A scan cannot tell these from a sender, because the literal is the same. Each exclusion names the
 * symbols it removes, by owning type or by member name inside a file prefix, and cites the lines that
 * show they build or record the command, which must still hold at the pinned source. An exclusion
 * that removes nothing has gone stale and fails, as a claim does.
 *
 * `commands` limits an exclusion to those commands of the symbols it names: a lookup that passes the name of a list
 * command only to choose the format of its rows sends another command, and its other entries stay.
 *
 * @typedef {{ port: string, why: string, owner?: string, names?: string[], commands?: string[], in?: string, evidence: Evidence[] }} Exclusion
 * @param {{
 *   exclusions: Exclusion[],
 *   found: Map<string, UsageEntry>,
 *   symbols: UsageSymbol[],
 *   readSource: (path: string) => string | undefined,
 * }} input
 * @returns {{ removed: UsageEntry[], problems: string[] }} the entries taken out of `found`
 */
export function applyExclusions({ exclusions, found, symbols, readSource }) {
  const removed = []
  const problems = []
  for (const exclusion of exclusions) {
    const label = `${exclusion.port}: exclusion of ${exclusion.owner ?? ''}${exclusion.names ? `.${exclusion.names.join('|')}` : ''}${exclusion.commands ? ` for ${exclusion.commands.join(',')}` : ''}`
    if (!exclusion.owner && !exclusion.names) { problems.push(`${label}: names neither an owner nor member names`); continue }
    if (!exclusion.evidence?.length) { problems.push(`${label}: cites no evidence`); continue }
    let broken = false
    for (const item of exclusion.evidence) {
      const [file, line] = [item.at.slice(0, item.at.lastIndexOf(':')), Number(item.at.slice(item.at.lastIndexOf(':') + 1))]
      const sourceLine = readSource(file)?.split('\n')[line - 1]
      if (sourceLine === undefined) { problems.push(`${label}: ${item.at} is not a line of the pinned source`); broken = true; continue }
      for (const needle of item.has ?? []) {
        if (!sourceLine.includes(needle)) { problems.push(`${label}: ${item.at} does not contain ${JSON.stringify(needle)}`); broken = true }
      }
    }
    if (broken) continue
    const matched = new Set(symbols.filter((symbol) => (!exclusion.owner || (symbol.parentName && bareName(symbol.parentName) === exclusion.owner))
      && (!exclusion.names || exclusion.names.includes(symbol.name))
      && (!exclusion.in || symbol.file.startsWith(exclusion.in))).map((symbol) => symbol.id))
    let count = 0
    for (const [key, entry] of found) {
      if (matched.has(entry.symbol) && (!exclusion.commands || exclusion.commands.includes(entry.command))) { found.delete(key); removed.push(entry); count++ }
    }
    if (!count) problems.push(`${label}: removes no entry, so it is stale`)
  }
  return { removed, problems }
}
