/**
 * Find the public methods whose name says they send a tmux command and that no recorded entry credits.
 *
 * A scan credits a symbol only when the command literal is in its body or one private helper away. A
 * method that reaches the literal through a plan, a builder or two helpers is missed, and the page of
 * the command then says no method sends it. The name of a method is only how a miss is found, never
 * what lists it: every candidate is settled by a reviewed claim that cites the hops, or by a review that
 * says why the method does not send the command and cites the line that shows it.
 */
import { bareName } from './tmux-usage-derive.mjs'

/** Words a method may use for the verb of a command, where the library's wording differs from tmux's. */
const VERB_ALIASES = {
  list: ['list', 'search', 'find', 'get'],
  show: ['show', 'get', 'read'],
  display: ['display', 'show'],
  new: ['new', 'create'],
  kill: ['kill', 'close', 'destroy', 'remove', 'delete'],
  set: ['set', 'unset', 'append', 'configure', 'apply'],
}

/** Commands that tmux keeps as spellings of `set-option -w` and `show-options -w`; libraries send the option commands. */
export const OPTION_SPELLINGS = new Set(['set-window-option', 'show-window-options'])

/** Where the library itself lives in each port, so a consumer package or a test helper is not swept. */
export const LIBRARY_ROOTS = {
  py: ['src/libtmux/'],
  ruby: ['gems/libtmux/', 'gems/libtmux-async/'],
  lua: ['lua/libtmux/'],
  julia: ['src/'],
  ts: ['packages/libtmux/'],
  rs: ['crates/libtmux/'],
  go: ['tmux/'],
  java: ['libtmux/src/'],
  kotlin: ['libtmux-kotlin/'],
  scala: ['libtmux-scala/', 'libtmux-scala-cats/'],
  csharp: ['src/LibTmux/'],
  fsharp: ['src/LibTmux.FSharp/'],
  powershell: ['src/LibTmux.PowerShell/'],
  cxx: ['include/libtmux/'],
  swift: ['Sources/LibTmux/'],
}
const NOT_LIBRARY = /(^|\/)(tmuxtest|testing|tests?|examples?)(\/|$)/i
/** Members every type has, whose names are never about a tmux command: `GetHashCode` is not a getter of a list. */
const OBJECT_MEMBERS = new Set(['GetHashCode', 'GetType', 'ToString', 'Equals', 'hashCode', 'toString', 'equals', 'hash', 'eql?', '__hash__', '__eq__', '__str__', '__repr__', 'inspect', 'to_s'])

/** `panes` is a plural, `previous` and `access` are not. */
const singular = (word) => (/(?:ss|us|is)$/.test(word) ? word : word.replace(/s$/, ''))

/** The lower-case words of a member name, plural stripped: `sendKeysAsync`, `send_keys` and `Send-TmuxText` each give `send` first. */
export function memberWords(name) {
  // Swift names carry their argument labels: `newWindow(in:named:startDirectory:)` is about a window, not about starting.
  return name.replace(/\(.*$/s, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase())
    .filter((word) => word && word !== 'async' && word !== 'tmux').map(singular)
}

/** Owners whose handle a command may belong to beyond the noun it names: a pane splits a window. */
const NOUN_OWNERS = { 'split-window': ['pane', 'window'], 'send-keys': ['pane'], 'capture-pane': ['pane'], 'clear-history': ['pane'], 'rotate-window': ['window'], 'copy-mode': ['pane'] }

/** Whether a member's name carries the verb of the command and the noun, in its own name or its owner's. */
export function carriesCommand(command, member, owner) {
  const parts = command.split('-')
  const accepted = VERB_ALIASES[parts[0]] ?? [parts[0]]
  const words = memberWords(member)
  if (!words.some((word) => accepted.includes(word))) return false
  const noun = singular(parts.at(-1))
  const ownerWords = owner ? memberWords(bareName(owner)) : []
  return words.includes(noun) || ownerWords.includes(noun) || (NOUN_OWNERS[command] ?? []).some((name) => ownerWords.includes(name))
}

/**
 * @typedef {{ id: string, name: string, parentName?: string, file: string, kind?: string }} SweepSymbol
 * @typedef {{ symbol: string, name: string, owner?: string, command: string, file: string }} Candidate
 * A method named for one command that has the noun of another only through its owner, `Session.newWindow` for
 * `new-session`, is the other command's when the data records that it sends it. That is deduced from an entry
 * that cites its own lines, so it settles the candidate without a review.
 *
 * @param {{ port: string, commands: string[], symbols: SweepSymbol[], has: ReadonlySet<string> }} input
 *   `has` holds `symbol\0command` for every entry the data records.
 * @returns {{ candidates: Candidate[], siblings: number }} `siblings` counts the candidates the method's own sibling command settled.
 */
export function sweepCandidates({ port, commands, symbols, has }) {
  const roots = LIBRARY_ROOTS[port] ?? []
  const found = []
  let siblings = 0
  for (const symbol of symbols) {
    if (symbol.kind === 'attribute' || OBJECT_MEMBERS.has(symbol.name) || NOT_LIBRARY.test(symbol.file) || !roots.some((root) => symbol.file.startsWith(root))) continue
    for (const command of commands) {
      if (OPTION_SPELLINGS.has(command) || has.has(`${symbol.id}\0${command}`)) continue
      if (!carriesCommand(command, symbol.name, symbol.parentName)) continue
      if (commands.some((other) => other !== command && has.has(`${symbol.id}\0${other}`) && carriesCommand(other, symbol.name, symbol.parentName)
        && sameVerb(command, other) && !carriesOwn(command, symbol.name))) { siblings++; continue }
      found.push({ symbol: symbol.id, name: symbol.name, owner: symbol.parentName, command, file: symbol.file })
    }
  }
  return { candidates: found, siblings }
}

const verbOf = (command) => command.split('-')[0]
const sameVerb = (a, b) => verbOf(a) === verbOf(b)
/** Whether the member's own words, and not only its owner's, carry the command's noun. */
const carriesOwn = (command, member) => memberWords(member).includes(singular(command.split('-').at(-1)))

/**
 * What a review says it covers: the symbols of one owner or by member name, for some commands, in some files.
 *
 * An entry must hold on every tmux release the port supports at its revision. A method that sends one command on
 * some releases and another on the rest is `version-gated`: it is recorded as neither, because each would be false
 * on part of the supported range. Its review cites the gate, the branch it opens, the branch it closes, and the
 * line that sets the supported floor below the gate, so the range the gate splits is shown to be supported. A gate
 * the floor has moved past is not a review but a plain `other-command`: only the branch that remains is sent.
 *
 * @typedef {{ port: string, kind: 'builds' | 'other-command' | 'values' | 'no-send' | 'version-gated', why: string, owner?: string, ownerSuffix?: string, names?: string[], commands?: string[], in?: string, evidence: { at: string, has?: string[] }[] }} Review
 */
export const REVIEW_KINDS = ['builds', 'other-command', 'values', 'no-send', 'version-gated']

/** A gate review shows the gate, both branches and the floor, each by the text that is on the cited line. */
const GATE_EVIDENCE = 4

/** Whether a rule that names an owner, member names and a file prefix selects a candidate. */
export function selects(rule, candidate) {
  return (!rule.owner || (candidate.owner && bareName(candidate.owner) === rule.owner))
    && (!rule.ownerSuffix || (candidate.owner && bareName(candidate.owner).endsWith(rule.ownerSuffix)))
    && (!rule.names || rule.names.includes(candidate.name) || rule.names.includes(candidate.name.replace(/\(.*$/s, '')))
    && (!rule.commands || rule.commands.includes(candidate.command))
    && (!rule.in || candidate.file.startsWith(rule.in))
}

/**
 * Settle the candidates with the reviews, and check each review against the pinned source.
 *
 * @param {{ port: string, candidates: Candidate[], reviews: Review[], covering?: Omit<Review, 'kind' | 'why'>[], readSource?: (path: string) => string | undefined }} input
 *   Without `readSource` the evidence lines are not read, which is what a check without a checkout can do.
 *   `covering` rules settle the candidates they select without being checked here: they are held to their own evidence elsewhere.
 * @returns {{ unreviewed: Candidate[], reviewed: number, problems: string[] }}
 */
export function settleCandidates({ port, candidates, reviews, covering = [], readSource }) {
  const problems = []
  const covered = new Set()
  for (const rule of covering) for (const candidate of candidates) if (selects(rule, candidate)) covered.add(candidate)
  for (const review of reviews) {
    const label = `${port}: review of ${review.owner ?? review.ownerSuffix ?? ''}${review.names ? `.${review.names.join('|')}` : ''}${review.commands ? ` for ${review.commands.join(',')}` : ''}`
    if (!review.owner && !review.ownerSuffix && !review.names && !review.commands) { problems.push(`${label}: names no owner, member or command`); continue }
    if (!REVIEW_KINDS.includes(review.kind)) { problems.push(`${label}: kind ${JSON.stringify(review.kind)} is not one of ${REVIEW_KINDS.join(', ')}`); continue }
    if (!review.why?.trim()) { problems.push(`${label}: gives no reason`); continue }
    if (!review.evidence?.length) { problems.push(`${label}: cites no evidence`); continue }
    if (review.kind === 'version-gated' && (review.evidence.length < GATE_EVIDENCE || review.evidence.some((item) => !item.has?.length))) {
      problems.push(`${label}: a version-gated review cites the gate, both branches and the supported floor, ${GATE_EVIDENCE} lines at least, each with the text that shows it`)
      continue
    }
    let broken = false
    for (const item of readSource ? review.evidence : []) {
      const file = item.at.slice(0, item.at.lastIndexOf(':'))
      const line = readSource(file)?.split('\n')[Number(item.at.slice(item.at.lastIndexOf(':') + 1)) - 1]
      if (line === undefined) { problems.push(`${label}: ${item.at} is not a line of the pinned source`); broken = true; continue }
      for (const needle of item.has ?? []) {
        if (!line.includes(needle)) { problems.push(`${label}: ${item.at} does not contain ${JSON.stringify(needle)}`); broken = true }
      }
    }
    if (broken) continue
    const hit = candidates.filter((candidate) => selects(review, candidate))
    if (!hit.length) problems.push(`${label}: settles no candidate, so it is stale`)
    for (const candidate of hit) covered.add(candidate)
  }
  return { unreviewed: candidates.filter((candidate) => !covered.has(candidate)), reviewed: covered.size, problems }
}
