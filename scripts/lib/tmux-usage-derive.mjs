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

/** Calls a method can make before it is said to reach no send, when it is checked against its sibling methods. */
export const DEEP_HOPS = 3

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

/** Whether a call can be a call of a function: the arguments it passes fit the parameters it takes, where both are known. */
export function shapeFits(call, fn) {
  if (!call || !fn) return true
  if (call.labels && fn.labels) {
    let at = 0
    for (const parameter of fn.labels) {
      if (call.labels[at] === parameter.label) at++
      else if (!parameter.optional) return false
    }
    return at === call.labels.length
  }
  return call.count >= fn.min && call.count <= fn.max
}

/**
 * Whether a call in `caller` is a call of `callee`. A name that only one function has can be nothing else. A name that
 * several share is resolved by what the call is made on: an unqualified call or one on `self` is the caller's own type's
 * (a free function, when the callee has no type), and a call on a handle named for a type is that type's. A call on
 * anything else is left unresolved, because naming `into_command` is not naming the one in `CaptureOptions`. Among the
 * overloads of one type, the arguments the call passes pick the one it takes.
 *
 * Each call of the name is judged by its own receiver and arguments when the scan kept them; `call` names the one to judge.
 *
 * @param {{ calls: Map<string, number>, receivers: Map<string, Set<string>>, callList?: { name: string, receiver?: string, shape?: object }[], owner?: string }} caller
 * @param {{ name: string, owner?: string, file?: string, shape?: object }} callee
 * @param {{ owner?: string, file?: string }[]} named every function of the port that has the callee's name
 * @param {{ name: string, receiver?: string, shape?: object }} [call]
 */
export function callTargets(caller, callee, named, call) {
  if (!caller.calls.has(callee.name)) return false
  if (named.length <= 1) return true
  const calls = call ? [call] : (caller.callList ?? []).filter((candidate) => candidate.name === callee.name)
  // Overloads of one type are not always in one file: a Swift extension and a C# partial class add to the type from another.
  const overloaded = named.some((other) => other !== callee && other.owner === callee.owner && callee.owner !== undefined)
  if (!calls.length) return resolves(caller, caller.receivers.get(callee.name), callee, named)
  return calls.some((one) => resolves(caller, one.receiver ? new Set([one.receiver]) : undefined, callee, named) && (!overloaded || shapeFits(one.shape, callee.shape)))
}

function resolves(caller, receivers, callee, named) {
  // Go names its receiver, `func (p Pane) ...`, and calls its own methods on it.
  const unqualified = !receivers || [...receivers].every((receiver) => SELF_RECEIVERS.has(receiver) || receiver === caller.selfName)
  // A call with no handle in front of it is a free function's, and with a second free function of the name it is the one in the caller's own file or none: which one an import names is not read.
  // The overloads of one free function, all in one file, are that file's whichever file the call is in.
  if (callee.owner === undefined) return !receivers && (caller.file === callee.file || new Set(named.filter((other) => other.owner === undefined).map((other) => other.file)).size === 1)
  if (unqualified) return caller.owner === callee.owner
  return [...receivers].some((receiver) => receiver.replace(/^_+/, '') === callee.owner.toLowerCase())
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
 * @param {{ command: string, spec?: { scopes?: { id: string, flags: string }[] }, functions: LocatedFunction[], symbols: UsageSymbol[], definitionOptions?: { sharedOwner?: boolean, freeFunctions?: boolean } }} input
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

  /** Public symbols reached from `fn`, each with the call sites walked to reach it and the definition that reaches it. */
  const reach = (fn, trail, depth) => {
    const own = definitions.get(fn)
    if (own) return own.map((symbol) => ({ symbol, trail, method: fn }))
    if (depth >= MAX_HOPS) return []
    return callersOf(fn).flatMap((caller) => reach(caller, [...trail, `${caller.file}:${caller.calls.get(fn.name)}`], depth + 1))
  }

  const entries = new Map()
  /** The definitions of a symbol that send an entry's command, by entry: a symbol with several methods is not credited with one's send for all. */
  const senders = new Map()
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
      for (const { symbol, trail, method } of reached) {
        const key = `${symbol.id}\0${scope}`
        senders.set(key, (senders.get(key) ?? new Set()).add(method))
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
  /**
   * Whether a function reaches a site that sends the command at the scope within a few calls: by the calls it resolves to, which is
   * what credits a symbol, or (`liberal`) by every function of the called name, which is what a function that is not credited
   * could still reach.
   */
  const reaches = (start, command, scope, liberal) => {
    const sends = (fn) => [...fn.sites, ...(built.get(fn) ?? [])].some((site) => site.command === command && site.dispatch !== null && classify(spec, site.flags) === scope)
    const seen = new Set([start])
    let frontier = [start]
    for (let hop = 0; hop <= DEEP_HOPS && frontier.length; hop++) {
      const next = []
      for (const fn of frontier) {
        if (sends(fn)) return true
        for (const name of fn.calls.keys()) {
          const named = byName.get(name) ?? []
          for (const callee of named) if (!seen.has(callee) && (liberal || callTargets(fn, callee, named))) { seen.add(callee); next.push(callee) }
        }
      }
      frontier = next
    }
    return false
  }
  // Which of a symbol's definitions send the command, for a symbol that has several: those a call credits, and those that
  // only reach it through more calls than a symbol is credited across.
  for (const [key, entry] of entries) {
    const all = [...definitions].filter(([, owned]) => owned.some((symbol) => symbol.id === entry.symbol)).map(([fn]) => fn)
    const sends = [...senders.get(key)]
    const others = all.filter((method) => !sends.includes(method))
    Object.defineProperty(entry, 'methods', {
      value: {
        sends, all,
        // A method no call reaches the command from, however far.
        lacks: others.filter((method) => !reaches(method, command, entry.scope, true)),
        // A method that reaches it only through calls the symbol is not credited across, or only by name.
        deep: others.filter((method) => reaches(method, command, entry.scope, true) && reaches(method, command, entry.scope, false)),
        unsure: others.filter((method) => reaches(method, command, entry.scope, true) && !reaches(method, command, entry.scope, false)),
      },
    })
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
 * @typedef {{ port: string, symbol: string, command: string, scope: string | null, evidence: Evidence[], forwardable?: boolean, incidental?: boolean, via?: { port: string, symbol: string } }} Claim
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
    const wrong = conditionProblem(claim.when, claim.conditional)
    if (wrong) { fail(wrong); continue }
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
        hops: claim.evidence.length - 1, reviewed: true, ...(claim.forwardable ? { forwardable: true } : {}), ...(claim.incidental ? { incidental: true } : {}), ...(claim.when ? { when: claim.when } : {}),
        ...(core ? { via: { port: claim.via.port, symbol: claim.via.symbol, revision: core.revision, evidence: core.evidence, ...(core.reviewed ? { reviewed: true } : {}) } } : {}),
      })
    }
  }
  return { entries, problems }
}

/** The longest qualifier a table can carry beside a method: it is one line, and a sentence belongs on a page. */
export const WHEN_WORDS = 8

/**
 * What is wrong with the condition of a send, or nothing. A send that only some calls make says when in a few words,
 * and a send marked conditional that says nothing would be listed as if every call made it.
 */
export function conditionProblem(when, conditional) {
  if (when === undefined) return conditional ? 'is marked conditional, so it must say when' : undefined
  if (typeof when !== 'string' || !when.trim()) return 'says when with no words'
  if (/\n/.test(when)) return 'says when on more than one line'
  const words = when.trim().split(/\s+/).length
  return words > WHEN_WORDS ? `says when in ${words} words, and a qualifier is at most ${WHEN_WORDS}: ${when}` : undefined
}

/**
 * A scanned send that only some calls make, such as the one a method makes under a condition on its argument, says when.
 * The condition is not a claim about the send, which the scan found and the audit reads back; it qualifies it, and cites the
 * lines that show the condition. One that qualifies no entry has gone stale and fails.
 *
 * @param {{ conditions: { port: string, symbol: string, command: string, scope: string | null, when: string, evidence: { at: string, has?: string[] }[] }[], found: Map<string, object>, readSource: (path: string) => string | undefined, lenient?: boolean }} input
 *   `lenient` leaves a condition whose entry is not there yet for a later call, which is how an entry that a method inherits from another is qualified like it.
 */
export function applyConditions({ conditions, found, readSource, lenient = false }) {
  const problems = []
  for (const item of conditions) {
    const label = `${item.port}: ${item.symbol} ${item.command} ${item.scope}: condition`
    const wrong = conditionProblem(item.when, true)
    if (wrong) { problems.push(`${label} ${wrong}`); continue }
    if (!item.evidence?.length) { problems.push(`${label} cites no lines`); continue }
    for (const line of item.evidence) {
      const cut = line.at.lastIndexOf(':')
      const text = readSource(line.at.slice(0, cut))?.split('\n')[Number(line.at.slice(cut + 1)) - 1]
      if (text === undefined) { problems.push(`${label} ${line.at} is not a line of the pinned source`); continue }
      for (const needle of line.has ?? []) if (!text.includes(needle)) problems.push(`${label} ${line.at} does not contain ${JSON.stringify(needle)}`)
    }
    const entry = found.get(`${item.symbol}\0${item.command}\0${item.scope}`)
    if (!entry) { if (!lenient) problems.push(`${label} qualifies no entry`) }
    else if (entry.when && entry.when !== item.when) problems.push(`${label} differs from the one its claim says: ${entry.when}`)
    else {
      entry.when = item.when
      if (!lenient && item.receiver !== undefined) problems.push(...receiverProblems(label, item, entry))
    }
  }
  return problems
}

/**
 * A generic function's methods are told apart by the type of the first argument, and a command that only some of them send
 * is qualified by that type. The qualifier is true when the methods the scan reaches the command from all take the type,
 * and at least one method that takes another type does not reach it, and the condition cites the body of one of each, so
 * that both can be read: a signature line that names the type shows neither.
 *
 * @param {string} label
 * @param {{ receiver: string, evidence: { at: string, through?: number }[] }} item
 * @param {{ methods?: { sends: { file: string, nameLine: number, end: number, receiverType?: string }[], all: { file: string, nameLine: number, end: number, receiverType?: string }[] } }} entry
 */
export function receiverProblems(label, item, entry) {
  if (!entry.methods) return [`${label} names the receiver ${item.receiver}, and the entry was not derived from the methods of a function`]
  const { sends, lacks, unsure } = entry.methods
  const problems = []
  const wrong = sends.filter((method) => method.receiverType !== item.receiver)
  if (wrong.length) problems.push(`${label} says on a ${item.receiver}, but the ${wrong.map((method) => method.receiverType ?? 'untyped').join(', ')} method at ${wrong[0].file}:${wrong[0].nameLine} sends it too`)
  if (!lacks.length) problems.push(`${label} says on a ${item.receiver}, but no method of the function is shown not to send it, and a send that every method makes takes no qualifier`)
  const same = lacks.filter((method) => method.receiverType === item.receiver)
  if (same.length) problems.push(`${label} says on a ${item.receiver}, but the ${item.receiver} method at ${same[0].file}:${same[0].nameLine} does not send it`)
  if (unsure.length) problems.push(`${label} cannot say which methods send it: ${unsure[0].file}:${unsure[0].nameLine} may reach it through a call that is not resolved`)
  const shown = (methods) => (item.evidence ?? []).some((line) => line.through !== undefined
    && methods.some((method) => line.at === `${method.file}:${method.nameLine}` && line.through === method.end))
  if (sends.length && !shown(sends)) problems.push(`${label} cites the body of no method that sends it`)
  if (lacks.length && !shown(lacks)) problems.push(`${label} cites the body of no method that does not send it`)
  return problems
}
/**
 * A command that some of a generic function's methods send and others do not is qualified, so that no method is credited with
 * another's send. An entry the scan derived that is sent by a part of the methods says when, in a condition or in a claim.
 *
 * @param {Map<string, { symbol: string, command: string, scope: string | null, when?: string, methods?: { sends: object[], all: object[] } }>} found
 */
export function partialProblems(found) {
  const problems = []
  for (const entry of found.values()) {
    if (!entry.methods) continue
    const { sends, lacks, unsure } = entry.methods
    const where = (methods) => `${methods[0].file}:${methods[0].nameLine}`
    if (unsure.length) problems.push(`${entry.symbol} ${entry.command} ${entry.scope}: the method at ${where(unsure)} may reach it through a call that is not resolved, so whether it sends it is not known`)
    if (lacks.length && !entry.when) {
      problems.push(`${entry.symbol} ${entry.command} ${entry.scope}: only the ${[...new Set(sends.map((method) => method.receiverType ?? 'untyped'))].join(', ')} methods send it, and ${lacks.length} other method${lacks.length > 1 ? 's' : ''} such as ${where(lacks)} do not, so it needs a condition that says when`)
    }
  }
  return problems
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
      if (matched.has(entry.symbol) && (!exclusion.commands || exclusion.commands.includes(entry.command))) {
        // A claim says the send is made and an exclusion says it is not: the exclusion would win and the claim would never show.
        if (entry.reviewed) problems.push(`${label}: removes the reviewed claim of ${entry.symbol} ${entry.command} ${entry.scope}, which says it sends it`)
        found.delete(key); removed.push(entry); count++
      }
    }
    if (!count) problems.push(`${label}: removes no entry, so it is stale`)
  }
  return { removed, problems }
}
