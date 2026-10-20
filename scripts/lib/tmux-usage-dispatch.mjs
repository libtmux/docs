/**
 * Checks the calls that `dispatchers.json` says send a tmux command.
 *
 * A dispatching call is a name, and a scan reads every call of that name as a send of the command it is handed. That is
 * only true if the function behind the name really sends, so each definition a rule cites must reach a transport: the
 * point where the library starts the tmux process or writes the command to a control client. The rule cites the chain,
 * one line per hop, and the chain is read back against the scan of the pinned source.
 *
 * - The definition is a line of a function with the rule's name.
 * - Each hop is a line of the function the hop before it leads to, and holds the text it cites. It calls the next
 *   function (`calls`), which the scan has read; or it leads to it in a way the scan does not follow (`leads`): a bare
 *   method name in Ruby, or a command put on a queue that another function writes from.
 * - The last line holds the transport: a process start or a write to the control client's input.
 * - A definition whose own line starts the process needs no chain.
 */

/** The line of a port's source that starts a tmux process or writes to a control client, and the files that may hold it. */
export const TRANSPORT = {
  py: { pattern: /subprocess\.(?:Popen|check_call)\(/, files: /\.py$/ },
  ruby: { pattern: /Process\.spawn\(@env|@input\.write_nonblock\(request\.wire/, files: /(?:process|control)\.rb$/ },
  lua: { pattern: /pcall\(uv\.spawn|uv\.spawn,|transport:write\(/, files: /(?:process|control_io)\.lua$/ },
  julia: { pattern: /^\s*run\(|write\(connection\.input\.in/, files: /(?:process|control|lifecycle)\.jl$/ },
  ts: { pattern: /\bspawn\(|stdin\.write\(/, files: /(?:node_spawn_transport|control\/child|control\/connection)\.ts$/ },
  rs: { pattern: /\.spawn\(\)|\.write_all\(/, files: /(?:subprocess|process|protocol)\.rs$/ },
  go: { pattern: /exec\.Command(?:Context)?\(|io\.WriteString\(c\.stdin/, files: /(?:runner|control_startup|control_request)\.go$/ },
  java: { pattern: /starter\.start\(|output\.write\(request\.line\)/, files: /(?:ControlWriter|ProcessTransport)\.java$/ },
  csharp: { pattern: /\bprocess\.Start\(\)|StandardInput\.WriteLineAsync/, files: /(?:TmuxProcessTransport|SystemControlModeProcess)\.cs$/ },
  cxx: { pattern: /::posix_spawnp?\(|::write\(/, files: /(?:posix_child|connection|process)\.cpp$/ },
  swift: { pattern: /Subprocess\.run\(|Glibc\.write\(/, files: /Sources\/LibTmux\/(?:Transport|ControlMode|NonblockingLineWriter)\.swift$/ },
}

const CONSTRUCTOR = /^(?:__init__|constructor|init|new|initialize)$/

/** `Server.cmd`, `Server#cmd` and `cmd(...)` all name `cmd`. */
export const bareName = (name) => name.replace(/\(.*$/s, '').replace(/`/g, '').split(/[.:#\\]+/).filter(Boolean).at(-1) ?? name

const split = (cite) => {
  const colon = cite.lastIndexOf(':')
  return { file: cite.slice(0, colon), line: Number(cite.slice(colon + 1)) }
}

/** The innermost function of a file that holds a line. */
const functionAt = (functions, file, line) => functions
  .filter((fn) => fn.file === file && fn.start <= line && line <= fn.end)
  .sort((a, b) => b.start - a.start)[0]

/** Whether a function is the one a call or a hand-off names: a function of that name, or the constructor of a type of that name. */
const isNamed = (fn, name) => fn.name === name || (fn.owner === name && CONSTRUCTOR.test(fn.name))

/**
 * @param {{ port: string, rule: { name: string }, item: { at: string, has?: string[], reaches?: { at: string, has?: string[], calls?: string, leads?: string }[] },
 *   functions: { file: string, name: string, owner?: string, start: number, end: number, calls: Map<string, number> }[],
 *   readSource: (path: string) => string | undefined }} input
 * @returns {string[]}
 */
export function chainProblems({ port, rule, item, functions, readSource }) {
  const label = `${port}: dispatcher ${rule.name} at ${item.at}`
  const transport = TRANSPORT[port]
  const textAt = (cite) => {
    const { file, line } = split(cite)
    return readSource(file)?.split('\n')[line - 1]
  }
  const reachesTransport = (cite) => {
    const { file } = split(cite)
    return transport && transport.files.test(file) && transport.pattern.test(textAt(cite) ?? '')
  }
  // A definition that starts the process itself, `subprocess.check_call(`, needs no chain.
  if (reachesTransport(item.at)) return []
  const chain = item.reaches ?? []
  if (!transport) return [`${label}: ${port} has no transport to reach`]
  if (!chain.length) return [`${label}: reaches no transport, and cites no chain to one`]

  const problems = []
  const head = split(item.at)
  let current = functionAt(functions, head.file, head.line)
  if (!current || current.name !== bareName(rule.name)) return [`${label}: is not a line of a function named ${bareName(rule.name)}`]
  for (const [index, hop] of chain.entries()) {
    const at = split(hop.at)
    const where = `${label}: hop ${hop.at}`
    const text = textAt(hop.at)
    if (text === undefined) { problems.push(`${where} is not a line of the pinned source`); break }
    for (const needle of hop.has ?? []) if (!text.includes(needle)) problems.push(`${where} does not contain ${JSON.stringify(needle)}`)
    if (current.file !== at.file || current.start > at.line || at.line > current.end) {
      problems.push(`${where} is not in ${current.owner ? `${current.owner}.` : ''}${current.name}, the function the chain has reached`)
      break
    }
    if (index === chain.length - 1) {
      if (!reachesTransport(hop.at)) problems.push(`${where} is not a transport: no process start or write to a control client`)
      break
    }
    const target = hop.calls ?? hop.leads
    if (!target) { problems.push(`${where} names neither the function it calls nor the one it leads to`); break }
    if (hop.calls && !current.calls.has(hop.calls)) problems.push(`${where} is in a function that does not call ${hop.calls}`)
    const next = split(chain[index + 1].at)
    const reached = functionAt(functions, next.file, next.line)
    if (!reached || !isNamed(reached, target)) {
      problems.push(`${where} leads to ${target}, but ${chain[index + 1].at} is not a line of it`)
      break
    }
    current = reached
  }
  return problems
}

/**
 * The dispatching and the building calls of a port: each names the code that defines it, the definition must still be
 * there, and a dispatching call must reach a transport through a cited chain. A call is recorded as a send only where it
 * reaches one of these. Without the function table of the scan, which a document check does not have, only the cited
 * lines are read back.
 *
 * @param {{ port: string, dispatchers: { name: string, why?: string, kind?: string, evidence?: { at: string, has?: string[], reaches?: unknown[] }[],
 *   labels?: { at: number, name: string }[] }[], readSource: (path: string) => string | undefined,
 *   functions?: { file: string, name: string, owner?: string, start: number, end: number, calls: Map<string, number> }[] }} input
 * @returns {string[]}
 */
export function dispatcherProblems({ port, dispatchers, readSource, functions }) {
  const problems = []
  for (const rule of dispatchers) {
    const label = `${port}: dispatcher ${rule.name}`
    if (!rule.name || !rule.why?.trim()) { problems.push(`${label}: names no call or gives no reason`); continue }
    if (!rule.evidence?.length) { problems.push(`${label}: cites no definition`); continue }
    let defined = false
    for (const item of rule.evidence) {
      const cut = item.at.lastIndexOf(':')
      const line = readSource(item.at.slice(0, cut))?.split('\n')[Number(item.at.slice(cut + 1)) - 1]
      if (line === undefined) { problems.push(`${label}: ${item.at} is not a line of the pinned source`); continue }
      for (const needle of item.has ?? []) if (!line.includes(needle)) problems.push(`${label}: ${item.at} does not contain ${JSON.stringify(needle)}`)
      if ((item.has ?? []).some((needle) => needle.includes(rule.name))) defined = true
      if (rule.kind !== 'builder' && functions) problems.push(...chainProblems({ port, rule, item, functions, readSource }))
    }
    if (!defined) problems.push(`${label}: no cited line shows ${rule.name} defined`)
    // An argument that only names the command for a failure message is not the command the call sends.
    for (const named of rule.labels ?? []) {
      if (!Number.isInteger(named.at) || named.at < 0 || !named.name) { problems.push(`${label}: a label names no argument position or parameter`); continue }
      const takes = rule.evidence.some((item) => {
        const { file, line } = split(item.at)
        const text = (readSource(file) ?? '').split('\n').slice(line - 1, line + 9).join('\n').replace(/\{[\s\S]*$/, '')
        return new RegExp(`\\b${named.name}\\b`).test(text)
      })
      if (!takes) problems.push(`${label}: no cited definition takes a parameter named ${named.name}`)
    }
  }
  return problems
}

/**
 * The functions that wrap a command in `if-shell` to make tmux refuse a stale or foreign target. Such a guard is
 * transparent: the command inside it is the one the library sends, and the `if-shell` is the means, so a scan records
 * the command and not the guard. A conditional whose purpose is the condition is not a guard, and is recorded as
 * `if-shell` with the command inside it as a conditional send.
 *
 * Each guard names the function that builds the wrapper, cites the lines that show it does and where it sits, and says
 * what it refuses. A guard that applies only on some paths says when.
 */
export function guardProblems({ port, guards, readSource, functions }) {
  const problems = []
  for (const guard of guards) {
    const label = `${port}: guard ${guard.owner ? `${guard.owner}.` : ''}${guard.name}`
    if (!guard.name || !guard.purpose?.trim()) { problems.push(`${label}: names no function or states no purpose`); continue }
    if (!guard.evidence?.length) { problems.push(`${label}: cites no lines`); continue }
    if (guard.conditional && !guard.when?.trim()) problems.push(`${label}: is conditional, so it must say when`)
    const defined = functions.filter((fn) => fn.name === guard.name && (!guard.owner || fn.owner === guard.owner))
    if (!defined.length) { problems.push(`${label}: no function of that name in the pinned source`); continue }
    const builds = defined.filter((fn) => (readSource(fn.file) ?? '').split('\n').slice(fn.start - 1, fn.end).some((text) => text.includes('if-shell')))
    if (!builds.length) problems.push(`${label}: no function of that name builds an if-shell`)
    let shown = false
    for (const item of guard.evidence) {
      const { file, line } = split(item.at)
      const text = readSource(file)?.split('\n')[line - 1]
      if (text === undefined) { problems.push(`${label}: ${item.at} is not a line of the pinned source`); continue }
      for (const needle of item.has ?? []) if (!text.includes(needle)) problems.push(`${label}: ${item.at} does not contain ${JSON.stringify(needle)}`)
      if (text.includes('if-shell') && builds.some((fn) => fn.file === file && fn.start <= line && line <= fn.end)) shown = true
    }
    if (!shown && builds.length) problems.push(`${label}: no cited line is the if-shell the guard builds`)
  }
  return problems
}
