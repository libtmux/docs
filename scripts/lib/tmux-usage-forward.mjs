/**
 * Credit a wrapper library with the commands its core library sends.
 *
 * Kotlin and Scala wrap the Java library, F# and the PowerShell cmdlets wrap the .NET one. A wrapper
 * symbol sends a command when it calls a core method that sends it, at the scope the core method
 * sends it, and the entry keeps both hops: the line of the call, and the core entry that holds the
 * line that sends. A wrapper that only builds a query, or reads what another call captured, calls
 * no core sender and gets nothing.
 */
import { bareName, definitionsOf } from './tmux-usage-derive.mjs'

/**
 * @typedef {{ symbol: string, command: string, scope: string | null, evidence: string[], reviewed?: boolean, forwardable?: boolean, incidental?: boolean }} CoreEntry
 * @typedef {{ id: string, name: string, parentName?: string, file: string, line: number }} WrapperSymbol
 */

/**
 * @param {{
 *   parent: string,
 *   functions: import('./tmux-usage-derive.mjs').LocatedFunction[],
 *   types: { file: string, name?: string, start: number, end: number }[],
 *   symbols: WrapperSymbol[],
 *   core: { entries: CoreEntry[], symbols: Map<string, { name: string, parentName?: string }>, revision: string },
 *   generated?: { under: string[], evidence: string[], forwards: (entry: CoreEntry, symbol?: { name: string, file: string, line: number }) => string | undefined },
 *   delegate?: boolean,
 * }} input
 *   `core.revision` is the revision the core lines were read at, and every entry says so in its `via`. With `delegate`, the
 *   wrapper and the core are one library: a method is credited with what a public method of another type sends, when it
 *   calls it on a handle named for that type (`p.server.SaveBuffer(...)`), and not for the calls it makes on its own type.
 * @returns {{ entries: object[], silent: string[] }} `silent` names the wrapper symbols that call no core sender.
 */
export function forwardUsage({ parent, functions, types, symbols, core, generated, delegate = false }) {
  const definitions = definitionsOf(functions, symbols)
  const owned = new Map()
  for (const [fn, list] of definitions) for (const symbol of list) owned.set(symbol, [...(owned.get(symbol) ?? []), fn])
  // A reviewed claim can hold only for the arguments it was read with, such as a snapshot depth, so a
  // wrapper that passes its own does not inherit it unless the claim says it holds for every call.
  const forwardable = core.entries.filter((entry) => !entry.reviewed || entry.forwardable)
  const coreByName = Map.groupBy(forwardable, (entry) => bareName(core.symbols.get(entry.symbol)?.name ?? entry.symbol))
  const entries = new Map()
  const forwarding = new Set()

  const add = (symbol, entry, evidence) => {
    const key = `${symbol.id}\0${entry.command}\0${entry.scope}`
    const result = {
      symbol: symbol.id, command: entry.command, scope: entry.scope, evidence, hops: 1, ...(entry.when ? { when: entry.when } : {}),
      via: { port: parent, symbol: entry.symbol, revision: core.revision, evidence: entry.evidence, ...(entry.reviewed ? { reviewed: true } : {}), ...(entry.incidental ? { incidental: true } : {}) },
    }
    if (!entries.has(key)) entries.set(key, result)
    forwarding.add(symbol.id)
  }

  for (const symbol of symbols) {
    const wrapperOwner = symbol.parentName ? bareName(symbol.parentName).toLowerCase() : undefined
    if (generated?.under.some((prefix) => symbol.file.startsWith(prefix))) {
      // A generated operation takes its name and its handle from the core method it forwards to.
      for (const entry of coreByName.get(bareName(symbol.name)) ?? []) {
        const coreSymbol = core.symbols.get(entry.symbol)
        const annotation = generated.forwards(entry, coreSymbol)
        if (!annotation || !wrapperOwner || bareName(coreSymbol?.parentName ?? '').toLowerCase() !== wrapperOwner) continue
        add(symbol, entry, [...generated.evidence, annotation])
      }
      continue
    }
    // The functions that are the symbol's definition, or every function of the type a cmdlet is.
    let fns = owned.get(symbol) ?? []
    if (!fns.length) {
      const type = types.find((candidate) => candidate.file === symbol.file && candidate.start <= symbol.line && symbol.line <= candidate.end)
      if (type) fns = functions.filter((fn) => fn.file === symbol.file && fn.start >= type.start && fn.end <= type.end)
    }
    for (const fn of fns) {
      for (const [name, line] of fn.calls) {
        const receivers = fn.receivers.get(name) ?? new Set()
        for (const entry of coreByName.get(name) ?? []) {
          const coreOwner = bareName(core.symbols.get(entry.symbol)?.parentName ?? '').toLowerCase()
          if (!coreOwner) continue
          // A call on a handle named for a type is a call on that type: `session.GetPanesAsync()` is Session's, whatever
          // type the wrapper method belongs to. Only a call with no named handle, or on the wrapper's own `this`, is its owner's.
          const own = [...receivers].every((receiver) => ['this', 'self', 'base'].includes(receiver))
          if (delegate) {
            // Only a call on the way to the end of the method, not one under a condition, in a loop or in a cleanup that runs on failure.
            if (!receivers.has(coreOwner) || wrapperOwner === coreOwner || entry.symbol === symbol.id || fn.callDepths?.get(name) !== 0) continue
          } else if (!(receivers.has(coreOwner) || (own && wrapperOwner === coreOwner))) continue
          add(symbol, entry, [`${fn.file}:${line}`])
        }
      }
    }
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.command.localeCompare(b.command) || String(a.scope).localeCompare(String(b.scope))),
    silent: symbols.filter((symbol) => !forwarding.has(symbol.id)).map((symbol) => symbol.id),
  }
}
