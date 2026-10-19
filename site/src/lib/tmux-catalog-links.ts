/** Find tmux options, hooks and format variables named in prose and code. */
import { tmuxCatalog, tmuxCatalogHref, type CatalogEntry, type CatalogKind } from './tmux-catalog'
import { tmuxManual } from './tmux-manual-data'

export interface CatalogMention {
  start: number
  end: number
  text: string
  kind: CatalogKind
  name: string
  href: string
}

export interface MentionContext {
  /** The text is an inline code literal, not prose. */
  code?: boolean
  version?: string
  /** Text next to the literal, used only to choose between readings of an ambiguous name. */
  before?: string
  after?: string
}

export interface Lookup {
  entries: Map<string, CatalogEntry[]>
  commands: Set<string>
}
const lookups = new Map<string, Lookup>()

function lookupFor(version: string): Lookup {
  const model = tmuxCatalog(version)
  let lookup = lookups.get(model.sourceCommit)
  if (!lookup) {
    const entries = new Map<string, CatalogEntry[]>()
    for (const entry of model.entries) {
      for (const name of [entry.name, ...(entry.aliases ?? [])]) entries.set(name, [...(entries.get(name) ?? []), entry])
    }
    lookup = { entries, commands: new Set(tmuxManual(version).commands.flatMap((command) => [command.name, command.alias].filter(Boolean))) }
    lookups.set(model.sourceCommit, lookup)
  }
  return lookup
}

const KIND_WORDS: [CatalogKind, RegExp][] = [
  ['option', /^options?$/i], ['hook', /^hooks?$/i], ['format', /^(?:formats?|variables?)$/i],
]

/** The kind a neighbouring word asks for: "the `status` option", "hook `x`". */
function contextKind(before = '', after = ''): CatalogKind | undefined {
  const next = /^[\s)'"\u2019\u201d]*([A-Za-z]+)(?:\s+([A-Za-z]+))?/.exec(after)
  const following = next && /^format$/i.test(next[1]) && /^variables?$/i.test(next[2] ?? '') ? next[2] : next?.[1]
  const previous = /([A-Za-z]+)[\s:('"\u2018\u201c]*$/.exec(before.slice(-48))?.[1]
  const word = [following, previous].find((candidate) => candidate && KIND_WORDS.some(([, pattern]) => pattern.test(candidate)))
  return word ? KIND_WORDS.find(([, pattern]) => pattern.test(word))![0] : undefined
}

const segmented = (name: string) => /[-_]/.test(name)

/**
 * The entry a bare name denotes, or nothing.
 *
 * A multi-word name that only the catalog uses is unambiguous. A single word
 * (`status`, `host`), a name two kinds share, or a command's name is read only
 * when a neighbouring word says which kind is meant.
 */
export function resolveCatalogName(name: string, lookup: Lookup, context: MentionContext, kinds?: CatalogKind[]): CatalogEntry | undefined {
  const candidates = (lookup.entries.get(name) ?? []).filter((entry) => !kinds || kinds.includes(entry.kind))
  if (!candidates.length) return undefined
  const wanted = contextKind(context.before, context.after)
  if (wanted) {
    // tmux stores hooks as array options, so a hook may be called an option.
    const matching = candidates.filter((entry) => entry.kind === wanted || (wanted === 'option' && entry.kind === 'hook'))
    return matching.length === 1 ? matching[0] : undefined
  }
  if (kinds) return candidates.length === 1 ? candidates[0] : undefined
  if (candidates.length !== 1 || !segmented(name) || lookup.commands.has(name)) return undefined
  return candidates[0]
}

const NAME = /[A-Za-z0-9_@-]+/g
const OPTION_COMMANDS = new Set(['set-option', 'set', 'set-window-option', 'setw', 'show-options', 'show', 'show-window-options', 'showw'])
const HOOK_COMMANDS = new Set(['set-hook', 'show-hooks'])

function mention(text: string, start: number, end: number, entry: CatalogEntry, version: string): CatalogMention {
  return { start, end, text: text.slice(start, end), kind: entry.kind, name: entry.name, href: tmuxCatalogHref(entry.kind, entry.name, version)! }
}

/**
 * Multi-word names in running text. Pages do not link these, because prose
 * is not a deliberate reference, but documentation that names an entry uses it.
 */
export function tmuxCatalogProseMentions(text: string, version = 'latest'): CatalogMention[] {
  const lookup = lookupFor(version)
  const found: CatalogMention[] = []
  for (const match of text.matchAll(NAME)) {
    const name = match[0]
    if (!segmented(name) || name.startsWith('@')) continue
    const start = match.index!
    const end = start + name.length
    if (/[\w./:$%@#-]/.test(text[start - 1] ?? '') || /^[\w/-]|^\.[A-Za-z]/.test(text.slice(end))) continue
    const entry = resolveCatalogName(name, lookup, {})
    if (entry) found.push(mention(text, start, end, entry, version))
  }
  return found
}

/** `set -g name`, `show-options -t pane name`, `set-hook name`: the argument after the flags. */
function commandLineMentions(text: string, lookup: Lookup, context: MentionContext, version: string): CatalogMention[] {
  const tokens = [...text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z0-9_@-]+|[^\s]/g)]
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }))
  const found: CatalogMention[] = []
  for (let at = 0; at < tokens.length; at++) {
    const command = tokens[at].text
    const options = OPTION_COMMANDS.has(command)
    if ((!options && !HOOK_COMMANDS.has(command)) || (at > 0 && !['tmux', ';', '{', '&&', '||', '|'].includes(tokens[at - 1].text))) continue
    let next = at + 1
    while (tokens[next]?.text.startsWith('-') && tokens[next].text !== '--') next += /^-[A-Za-z]*t$/.test(tokens[next].text) ? 2 : 1
    if (tokens[next]?.text === '--') next++
    const token = tokens[next]
    if (!token) continue
    const quoted = /^(["'])(.*)\1$/.exec(token.text)
    const name = (quoted ? quoted[2] : token.text).replace(/\[\d*\]$/, '')
    const entry = resolveCatalogName(name, lookup, { ...context, before: '', after: '' }, options ? ['option', 'hook'] : ['hook'])
    if (entry) found.push(mention(text, token.start + (quoted ? 1 : 0), token.start + (quoted ? 1 : 0) + name.length, entry, version))
  }
  return found
}

/**
 * Variables and options referenced inside `#{...}`.
 *
 * A reference follows `#{`, `#{?`, or the colon of a modifier that takes a
 * variable (`E:`, `T:`, `t:`, `S:`...). Words after a comparison operator or a
 * comma are literals and stay plain.
 */
function formatMentions(text: string, lookup: Lookup, version: string): CatalogMention[] {
  const found: CatalogMention[] = []
  if (!text.includes('#{')) return found
  for (const match of text.matchAll(/[a-z][a-z0-9_-]*/g)) {
    const start = match.index!
    const end = start + match[0].length
    const prefix = text.slice(0, start)
    const position = /#\{\??$/.test(prefix) || /#\{[ETtbdqnwSWPL](?:[;/=][^:{}]*)?:$/.test(prefix)
    if (!position || !/^[},]/.test(text.slice(end))) continue
    const candidates = (lookup.entries.get(match[0]) ?? []).filter((entry) => entry.kind !== 'hook')
    if (candidates.length === 1) found.push(mention(text, start, end, candidates[0], version))
  }
  return found
}

const quotedLiteral = /^(["'])([A-Za-z0-9_-]+)\1$/
const QUOTED_NAME = /(?<![\w'"])(["'])([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)\1(?![\w'"])/g

/**
 * Names that running text writes as deliberately as code: a quoted multi-word
 * name (`'session-renamed'`) and the variables of a `#{...}` expression. A
 * bare word in a sentence is still only a word.
 */
export function tmuxCatalogProseReferences(text: string, version = 'latest'): CatalogMention[] {
  if (!text.includes('#{') && !/["']/.test(text)) return []
  const lookup = lookupFor(version)
  const found = formatMentions(text, lookup, version)
  for (const match of text.matchAll(QUOTED_NAME)) {
    const start = match.index! + 1
    const end = start + match[2].length
    const entry = resolveCatalogName(match[2], lookup, {})
    if (entry && !found.some((other) => other.start < end && start < other.end)) found.push(mention(text, start, end, entry, version))
  }
  return found.sort((a, b) => a.start - b.start)
}
const CODE_WORDS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|[A-Za-z0-9_/-]+|[^\s]/g

/**
 * An option or hook written as a separate word of a code run. A word inside a
 * path, flag, expression or longer name is something else, and a quoted
 * string is read only when it is the whole literal.
 */
function standaloneMentions(text: string, lookup: Lookup, version: string): CatalogMention[] {
  const found: CatalogMention[] = []
  for (const match of text.matchAll(CODE_WORDS)) {
    const name = match[0]
    const start = match.index!
    const end = start + name.length
    if (!segmented(name) || /[\w./:$%@-]/.test(text[start - 1] ?? '') || /^[\w/-]|^\.[A-Za-z]/.test(text.slice(end))) continue
    const entry = resolveCatalogName(name, lookup, {})
    if (entry && entry.kind !== 'format') found.push(mention(text, start, end, entry, version))
  }
  return found
}

/**
 * Catalog names mentioned in one code literal.
 *
 * Unknown names, single words without a context word, and anything that more
 * than one entry could mean are left alone.
 */
export function tmuxCatalogMentions(text: string, context: MentionContext = {}): CatalogMention[] {
  const version = context.version ?? 'latest'
  if (!context.code) return []
  const lookup = lookupFor(version)

  const trimmed = text.trim()
  const offset = text.indexOf(trimmed)
  // An array option or hook may carry an index: `after-new-window[0]`.
  const bare = /^[A-Za-z0-9_-]+(?:\[\d*\])?$/.test(trimmed) ? trimmed.replace(/\[\d*\]$/, '') : quotedLiteral.exec(trimmed)?.[2]
  if (bare) {
    const entry = resolveCatalogName(bare, lookup, context)
    if (!entry) return []
    const start = offset + trimmed.indexOf(bare)
    return [mention(text, start, start + bare.length, entry, version)]
  }
  const found = [...commandLineMentions(text, lookup, context, version)]
  for (const other of [...formatMentions(text, lookup, version), ...standaloneMentions(text, lookup, version)]) {
    if (!found.some((mentioned) => mentioned.start < other.end && other.start < mentioned.end)) found.push(other)
  }
  return found.sort((a, b) => a.start - b.start)
}

