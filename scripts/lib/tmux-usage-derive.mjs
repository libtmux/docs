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

/** `panes(where:)`, `Server.panes` and `Server#list_panes` all name their last identifier. */
export function bareName(name) {
  return name.replace(/\(.*$/s, '').split(/[.:#\\]+/).filter(Boolean).at(-1) ?? name
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
 * @returns {Map<LocatedFunction, UsageSymbol[]>}
 */
export function definitionsOf(functions, symbols) {
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
 * @param {{ command: string, spec?: { scopes?: { id: string, flags: string }[] }, functions: LocatedFunction[], symbols: UsageSymbol[] }} input
 * @returns {{ entries: UsageEntry[], unresolved: Unresolved[] }}
 */
export function deriveUsage({ command, spec, functions, symbols }) {
  const byName = Map.groupBy(functions, (fn) => fn.name)
  const definitions = definitionsOf(functions, symbols)

  const callersOf = (fn) => {
    const callers = (functions.filter((other) => other !== fn && other.calls.has(fn.name)))
    const sameFile = callers.filter((other) => other.file === fn.file)
    if (sameFile.length) return sameFile
    return (byName.get(fn.name) ?? []).length === 1 ? callers : []
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
    const sites = fn.sites.filter((site) => site.command === command)
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
        const entry = { symbol: symbol.id, command, scope, evidence: [`${fn.file}:${site.line}`, ...trail.toReversed()], hops: trail.length }
        if (!entries.has(key) || entries.get(key).hops > entry.hops) entries.set(key, entry)
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
 * A wrapper's claim can name the library symbol it calls, `via`, and then
 * stands only while that symbol sends the command at the same scope.
 *
 * @typedef {{ at: string, has?: string[], in?: string }} Evidence
 * @typedef {{ port: string, symbol: string, command: string, scope: string | null, evidence: Evidence[], via?: { port: string, symbol: string } }} Claim
 * @param {{
 *   claims: Claim[],
 *   spec?: { scopes?: { id: string }[] },
 *   functions: LocatedFunction[],
 *   types: { file: string, name?: string, start: number, end: number }[],
 *   symbols: UsageSymbol[],
 *   readSource: (path: string) => string | undefined,
 *   sends?: (port: string, symbol: string, command: string, scope: string | null) => boolean,
 * }} input
 * @returns {{ entries: UsageEntry[], problems: string[] }}
 */
export function verifyClaims({ claims, spec, functions, types, symbols, readSource, sends = () => false }) {
  const definitions = definitionsOf(functions, symbols)
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
      const text = readSource(file)
      const sourceLine = text?.split('\n')[line - 1]
      if (sourceLine === undefined) { fail(`${item.at} is not a line of the pinned source`); broken = true; continue }
      for (const needle of item.has ?? []) {
        if (!sourceLine.includes(needle)) { fail(`${item.at} does not contain ${JSON.stringify(needle)}`); broken = true }
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
    if (!broken && claim.via && !sends(claim.via.port, claim.via.symbol, claim.command, claim.scope)) {
      fail(`${claim.via.port} ${claim.via.symbol} does not send ${claim.command} at that scope`)
      broken = true
    }
    if (!broken) {
      entries.push({
        symbol: claim.symbol, command: claim.command, scope: claim.scope, evidence: claim.evidence.map((item) => item.at),
        hops: claim.evidence.length - 1, reviewed: true, ...(claim.via ? { via: claim.via } : {}),
      })
    }
  }
  return { entries, problems }
}
