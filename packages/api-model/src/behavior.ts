/**
 * Behaviour facts read from a declaration's own doc comment and signature.
 *
 * A fact is a sentence the author already wrote, kept verbatim and tied to the line it stands on at the pinned
 * revision, or a structural statement about the signature (an `async` Rust function returns a future). Nothing is
 * paraphrased, and nothing is inferred from another port or from a name. A sentence is filed under the first row its
 * wording names: ownership, a bound (context, deadline, cancellation), completion, errors, transport, cleanup,
 * mutation. Sentences that match no row are left in the doc comment, which still renders in full.
 *
 * The extractor works on a source file's lines, because the model does not keep the line of a comment sentence.
 * `verifyBehavior` re-reads the same lines, so a regenerated model cannot cite a line that does not say it.
 */
import type { ApiSymbol, Behavior, BehaviorFact } from './model.ts'

export type CommentStyle = 'go' | 'rust'

/** Languages whose doc comments this reads, and how a doc comment line starts. */
const PREFIX: Record<CommentStyle, RegExp> = { go: /^\s*\/\/ ?/, rust: /^\s*\/\/\/ ?/ }

export interface Sentence {
  text: string
  /** 1-based line of the sentence's first character. */
  line: number
  /** The rustdoc section the sentence sits in (`Errors`), when there is one. */
  section?: string
  /** Sentences of one paragraph share a number; two sentences are one statement only within a paragraph. */
  paragraph: number
}

/** The kinds of declaration that have a call to describe. */
const CALLABLE = new Set(['method', 'function'])

/**
 * Rows in the order a sentence is tried. The first match files it; ownership and bounds come before errors because
 * a sentence about both ("context failures return partial output") is first a statement about the bound.
 */
const CUES: [row: keyof Omit<Behavior, 'requires'>, cue: RegExp][] = [
  ['ownership', /\b(caller-owned|owned by (the )?(caller|tmux|the receiver)|takes ownership|ownership|(is|are) borrowed|borrows?)\b/i],
  ['boundedBy', /\b(cancel(l?ed|l?ation|s)?|deadlines?|timeouts?|times? out|expires?)\b|\b(ctx|context)\b[^.]*\b(done|stops?|ends?)\b|\bcontext (failures?|errors?)\b/i],
  ['completion', /\b(point-in-time|not a stream|returns? (immediately|after|once|when)|blocks? until|(does|do) not (wait|block)|waits? (for|until)|completes? (when|after|once)|best-effort)\b/i],
  ['errors', /\b(becomes? an? \[?`?\w*Error|returns? (an? )?(\[?`?\w+`?\]? )?errors?|errors?\b|fail(s|ed|ure|ures)?\b)/i],
  ['transport', /\b(control (connection|client|mode)|subprocess|transport|socket)\b/i],
  ['cleanup', /\b(must be (closed|released|freed|dropped)|(call|use) `?\[?(Close|Release|Free|Drop)|clean ?up|leaks?)\b/i],
  ['mutation', /\b(mutates?|modif(y|ies) (the|its)|in place|overwrites?|(does|do) not (modify|mutate|change))\b/i],
]

const REQUIRES = /\b(?:requires?|needs?|since|from|before) tmux (\d+(?:\.\d+)+[a-z]?)\b/i

/** The doc comment directly above a declaration, line by line, without its comment markers. */
export function docCommentAbove(lines: string[], declarationLine: number, style: CommentStyle): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  for (let index = declarationLine - 2; index >= 0; index--) {
    const raw = lines[index] ?? ''
    if (style === 'rust' && /^\s*#\[.*\]\s*$/.test(raw)) continue
    if (!PREFIX[style].test(raw)) break
    out.unshift({ line: index + 1, text: raw.replace(PREFIX[style], '') })
  }
  return out
}

/** Sentences of a doc comment in reading order, each with its first line; code, lists and examples are left out. */
export function commentSentences(comment: { line: number; text: string }[], style: CommentStyle): Sentence[] {
  const out: Sentence[] = []
  let section: string | undefined
  let fenced = false
  let paragraph: { line: number; text: string }[] = []
  let paragraphs = 0
  const flush = () => {
    if (!paragraph.length) return
    let joined = ''
    const starts: { at: number; line: number }[] = []
    for (const entry of paragraph) {
      if (joined) joined += ' '
      starts.push({ at: joined.length, line: entry.line })
      joined += entry.text.trim()
    }
    let from = 0
    const parts = joined.split(/(?<=[.!?])\s+(?=[A-Z[`"'(])/)
    for (const part of parts) {
      const at = joined.indexOf(part, from)
      from = at + part.length
      const line = [...starts].reverse().find((start) => start.at <= at)?.line ?? paragraph[0].line
      out.push({ text: part, line, section, paragraph: paragraphs })
    }
    paragraphs++
    paragraph = []
  }
  for (const entry of comment) {
    const text = entry.text
    if (style === 'rust' && /^\s*(```|~~~)/.test(text)) { flush(); fenced = !fenced; continue }
    if (fenced) continue
    const heading = style === 'rust' ? /^#{1,6}\s+(.+?)\s*$/.exec(text) : undefined
    if (heading) { flush(); section = heading[1]; continue }
    // Indented text is code in Go doc comments; list items are not sentences.
    if (/^(\t|\s{3,})/.test(text) || /^\s*([-*]|\d+\.)\s/.test(text)) { flush(); continue }
    if (text.trim() === '') { flush(); continue }
    paragraph.push(entry)
  }
  flush()
  return out
}

const nameOf = (symbol: ApiSymbol) => symbol.name

/**
 * What the doc comment and signature of one callable state. `lines` is the declaration's source file at the pinned
 * revision. A declaration with nothing stated returns `undefined`, so an empty grid is never rendered.
 */
export function extractBehavior(symbol: ApiSymbol, lines: string[], style: CommentStyle): Behavior | undefined {
  if (!CALLABLE.has(symbol.kind) || !symbol.source.line || !symbol.source.file) return undefined
  const file = symbol.source.file
  const comment = docCommentAbove(lines, symbol.source.line, style)
  const sentences = commentSentences(comment, style)
  const behavior: Behavior = {}
  const filed = new Map<keyof Omit<Behavior, 'requires'>, Sentence[]>()
  const file_ = (row: keyof Omit<Behavior, 'requires'>, sentence: Sentence) => filed.set(row, [...(filed.get(row) ?? []), sentence])
  // The first sentence is the summary the page already leads with; rows come from what follows it.
  const structured = sentences.filter((sentence) => sentence.section === 'Errors')
  sentences.forEach((sentence, index) => {
    if (sentence.section === 'Errors') { file_('errors', sentence); return }
    if (sentence.section || index === 0) return
    const requires = REQUIRES.exec(sentence.text)
    // The version stands on the line that names it, which can be the line after the sentence begins.
    const versionLine = requires && (comment.find((entry) => entry.line >= sentence.line && entry.text.includes(`tmux ${requires[1]}`))?.line ?? sentence.line)
    if (requires && !behavior.requires) behavior.requires = { tmux: requires[1], source: { file, line: versionLine! } }
    const row = CUES.find(([, cue]) => cue.test(sentence.text))?.[0]
    // A structured `# Errors` section states the errors; a cue match elsewhere does not compete with it.
    if (row && !(row === 'errors' && structured.length)) file_(row, sentence)
  })
  for (const [row, found] of filed) {
    // One statement: a sentence, and the next one when it continues in the same paragraph. The doc comment still has the rest.
    const picked = found[1] && found[1].paragraph === found[0].paragraph && sentences.indexOf(found[1]) === sentences.indexOf(found[0]) + 1 ? found.slice(0, 2) : found.slice(0, 1)
    behavior[row] = { text: picked.map((sentence) => sentence.text).join(' '), source: { file, line: picked[0].line }, origin: 'doc comment' } satisfies BehaviorFact
  }
  // An async function returns a future that runs only when awaited: that is the language's rule, read from the signature.
  if (style === 'rust' && symbol.modifiers.includes('async') && !behavior.completion) {
    behavior.completion = { text: 'Returns a future that runs when awaited.', source: { file, line: symbol.source.line }, origin: 'signature' }
  }
  return Object.keys(behavior).length ? orderBehavior(behavior) : undefined
}

/** The rows in the order the page draws them, so a stored model reads the same everywhere. */
export const BEHAVIOR_ROWS = ['completion', 'boundedBy', 'returns', 'ownership', 'mutation', 'errors', 'transport', 'cleanup'] as const

export function orderBehavior(behavior: Behavior): Behavior {
  const ordered: Behavior = {}
  for (const row of BEHAVIOR_ROWS) if (behavior[row]) ordered[row] = behavior[row]
  if (behavior.requires) ordered.requires = behavior.requires
  return ordered
}

/** A hand-written fact: the sentence, the line it cites, and the words that line must still contain. */
export interface CuratedFact {
  row: (typeof BEHAVIOR_ROWS)[number]
  text: string
  line: number
  /** A substring of the cited line, so an edit that moves or rewrites it fails the check. */
  quote: string
  /** The declaration whose doc comment states it, when that is not the declaration it describes. */
  via?: string
}

/** Every fact the behaviour cites, with where: the rows plus `requires`. */
export function citations(behavior: Behavior): { row: string; fact: { text?: string; source: { file: string; line: number } }; origin: BehaviorFact['origin'] }[] {
  const out: ReturnType<typeof citations> = []
  for (const row of BEHAVIOR_ROWS) {
    const fact = behavior[row]
    if (fact) out.push({ row, fact, origin: fact.origin })
  }
  if (behavior.requires) out.push({ row: 'requires', fact: { source: behavior.requires.source }, origin: 'doc comment' })
  return out
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Whether a sentence begins on this line and the line says what the sentence says from there: the rest of the line is
 * a prefix of the sentence (it runs on to the next line) or the sentence is whole within it.
 */
function startsOn(line: string, sentence: string): boolean {
  const words = sentence.split(' ')
  const full = Math.min(3, words.length)
  for (let count = full; count >= 1; count--) {
    const head = words.slice(0, count).join(' ')
    const at = count === full ? line.indexOf(head) : line.endsWith(head) ? line.length - head.length : -1
    if (at < 0) continue
    const tail = line.slice(at)
    return sentence.startsWith(tail) || tail.startsWith(sentence)
  }
  return false
}

/**
 * Whether every fact's cited line says it. Doc-comment facts: the line (comment marker removed) holds the start of
 * the sentence. Signature facts: the line is the declaration. Curated facts: the line holds the entry's quote.
 * Returns the problems, empty when the behaviour is sound.
 */
export function verifyBehavior(symbol: ApiSymbol, behavior: Behavior, lines: string[], style: CommentStyle, quotes: Record<string, string> = {}): string[] {
  const problems: string[] = []
  for (const { row, fact, origin } of citations(behavior)) {
    const raw = lines[fact.source.line - 1]
    if (raw === undefined) { problems.push(`${nameOf(symbol)} ${row}: line ${fact.source.line} is past the end of ${fact.source.file}`); continue }
    if (fact.source.file !== symbol.source.file) { problems.push(`${nameOf(symbol)} ${row}: cites ${fact.source.file}, not the declaration's file`); continue }
    const line = squash(raw.replace(PREFIX[style], ''))
    if (origin === 'signature') {
      if (fact.source.line !== symbol.source.line) problems.push(`${nameOf(symbol)} ${row}: a signature fact cites the declaration line`)
    } else if (origin === 'curated') {
      const quote = quotes[row]
      if (!quote || !line.includes(squash(quote))) problems.push(`${nameOf(symbol)} ${row}: line ${fact.source.line} does not contain the quoted words`)
    } else if (row === 'requires') {
      if (!/\btmux \d/.test(line)) problems.push(`${nameOf(symbol)} requires: line ${fact.source.line} names no tmux version`)
    } else if (!startsOn(line, squash(fact.text ?? ''))) {
      problems.push(`${nameOf(symbol)} ${row}: line ${fact.source.line} does not start the sentence`)
    }
  }
  return problems
}
