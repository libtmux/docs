import type { DocSpan, LinkTarget } from '@libtmux/api-model'
import { tmuxManual, tmuxManualEntityHref, tmuxManualEntities, type TmuxEntityKind } from './tmux-manual-data'

export type { TmuxEntityKind } from './tmux-manual-data'

/**
 * The one place a tmux name becomes a destination.
 *
 * Every command, option, hook and format-variable link resolves here, and an
 * unknown name has none. Swap the body to move them all to another reference.
 */
export function tmuxEntityHref(kind: TmuxEntityKind, name: string, version = 'latest'): string | undefined {
  return tmuxManualEntityHref(kind, name, version)
}

type Command = ReturnType<typeof tmuxManual>['commands'][number]
const commandNames = new WeakMap<ReturnType<typeof tmuxManual>, Map<string, Command>>()

export interface TmuxMention {
  start: number
  end: number
  text: string
  command: string
  href: string
}

const CODE_WORDS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|[A-Za-z0-9_/-]+|[^\s]/g
const PROSE_WORDS = /[A-Za-z0-9_/-]+|[^\s]/g
const tokenize = (text: string, code: boolean) => [...text.matchAll(code ? CODE_WORDS : PROSE_WORDS)]
  .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }))
/** A word inside a longer path, flag, option value or sentence continuation is not a name. */
const standalone = (text: string, token: { start: number; end: number }) =>
  !/[\w./:$-]/.test(text[token.start - 1] ?? '') && !/^[\w/-]|^\.[A-Za-z]/.test(text.slice(token.end))

/** Locate documented command names; aliases need an explicit code invocation. */
export function tmuxCommandMentions(text: string, { code = false, version = 'latest' } = {}): TmuxMention[] {
  const manual = tmuxManual(version)
  if (!/-|\btmux\b/.test(text)) return []
  let byName = commandNames.get(manual)
  if (!byName) {
    byName = new Map(manual.commands.flatMap((command) => [
      [command.name, command], ...(command.alias ? [[command.alias, command]] : []),
    ] as [string, Command][]))
    commandNames.set(manual, byName)
  }
  const tokens = tokenize(text, code)
  const found = new Map<number, TmuxMention>()
  const add = (position: number, aliases = false) => {
    const token = tokens[position]
    if (!token) return
    const command = byName.get(token.text)
    if (!command || (!aliases && command.name !== token.text)) return
    if (!standalone(text, token)) return
    found.set(token.start, { ...token, command: command.name, href: tmuxEntityHref('command', command.name, version)! })
  }

  // Global option values are not commands, even when named run-shell.
  for (let position = 0; position < tokens.length; position++) {
    if (tokens[position].text !== 'tmux' || /[\w./:$-]/.test(text[tokens[position].start - 1] ?? '')) continue
    let next = position + 1
    while (tokens[next]?.text.startsWith('-') && tokens[next].text !== '--') {
      const option = tokens[next].text.slice(1)
      let valid = true
      let value = false
      for (let offset = 0; offset < option.length; offset++) {
        const flag = option[offset]
        if ('fLST'.includes(flag)) {
          value = offset === option.length - 1
          break
        }
        if (!'2CDlNuv'.includes(flag)) { valid = false; break }
      }
      if (!valid || !option) { next = tokens.length; break }
      next += value ? 2 : 1
    }
    if (tokens[next]?.text === '--') next++
    if (next < tokens.length && /^\s*$/.test(text.slice(tokens[position].end, tokens[position + 1]?.start ?? text.length))) add(next, code)
  }

  // Canonical hyphenated names are unambiguous in prose. In inline code,
  // admit a bare command or subcommand invocation, not an argument or path.
  for (let position = 0; position < tokens.length; position++) {
    if ((!code || position === 0) && tokens[position].text.includes('-')) add(position)
  }
  return [...found.values()].sort((a, b) => a.start - b.start)
}

/**
 * A name in text that has a page or anchor of its own, whatever documents it.
 * tmux names, workspace commands and keys, and MCP tools all link through it,
 * so one renderer badges them and one exporter writes them as plain links.
 */
export interface Mention {
  start: number
  end: number
  text: string
  /** The badge kind: a tmux kind, a workspace `key`, or an MCP object kind. */
  kind: string
  name: string
  href: string
  /** Names the kind in the badge's tooltip when the kind alone does not. */
  title?: string
  /** Which documentation owns the name; unset means tmux. */
  family?: 'workspace' | 'mcp'
  /** Link just the name, not the code span around it, however many names the span holds. */
  inline?: boolean
}

/** A documented tmux name found in text, whatever its kind. */
export interface TmuxReference extends Mention {
  kind: TmuxEntityKind
}

/**
 * Names from `preferred` plus every name of `others` that does not overlap one.
 * The caller decides which source the page itself owns.
 */
export function mergeMentions<T extends Mention>(preferred: T[], others: T[]): T[] {
  const free = others.filter((other) => !preferred.some((mention) => other.start < mention.end && mention.start < other.end))
  return [...preferred, ...free].sort((a, b) => a.start - b.start)
}

// Plain words stay plain: only a hyphenated option or hook and an underscored
// format variable are unlikely enough in running code to claim without context.
const namedEntities = new WeakMap<ReturnType<typeof tmuxManual>, Map<string, Exclude<TmuxEntityKind, 'command'>>>()
function entityKinds(version: string) {
  const manual = tmuxManual(version)
  let kinds = namedEntities.get(manual)
  if (!kinds) {
    kinds = new Map(tmuxManualEntities(version)
      .filter((entity) => entity.name.includes(entity.kind === 'format' ? '_' : '-'))
      .map((entity) => [entity.name, entity.kind]))
    namedEntities.set(manual, kinds)
  }
  return kinds
}

/** Whether an offset sits inside the braces of a `#{...}` format expression. */
function insideFormat(text: string, offset: number): boolean {
  const groups: boolean[] = []
  for (let index = 0; index < offset; index++) {
    if (text[index] === '{') groups.push(text[index - 1] === '#')
    else if (text[index] === '}') groups.pop()
  }
  return groups.includes(true)
}

/**
 * A format variable is a mention when it is the whole span or part of a
 * format expression, quoted or not. A name in a URI template or a call is
 * something else.
 */
function formatVariable(text: string, start: number, end: number): boolean {
  if (text.trim() === text.slice(start, end)) return true
  return insideFormat(text, start) && /[{?!,:]/.test(text[start - 1] ?? '') && !/^[\w/-]|^\.[A-Za-z]/.test(text.slice(end))
}

const FORMAT_NAME = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g

/**
 * Locate every documented tmux name. Commands also match in prose; options,
 * hooks and format variables only inside code, where a name is deliberate.
 */
export function tmuxMentions(text: string, { code = false, version = 'latest' } = {}): TmuxReference[] {
  const found: TmuxReference[] = tmuxCommandMentions(text, { code, version })
    .map(({ command, ...mention }) => ({ ...mention, kind: 'command', name: command }))
  if (!code || !/[-_]/.test(text)) return found
  const kinds = entityKinds(version)
  const taken = new Set(found.map((mention) => mention.start))
  const add = (kind: Exclude<TmuxEntityKind, 'command'>, name: string, start: number) => {
    const href = tmuxEntityHref(kind, name, version)
    if (href && !taken.has(start)) found.push({ start, end: start + name.length, text: name, kind, name, href })
  }
  for (const token of tokenize(text, true)) {
    const kind = kinds.get(token.text)
    if (kind && kind !== 'format' && standalone(text, token)) add(kind, token.text, token.start)
  }
  for (const match of text.matchAll(FORMAT_NAME)) {
    if (kinds.get(match[0]) === 'format' && formatVariable(text, match.index!, match.index! + match[0].length)) add('format', match[0], match.index!)
  }
  return found.sort((a, b) => a.start - b.start)
}

type LinkedDocSpan = DocSpan & { link?: LinkTarget }

/** Add native tmux links after language API and authored-link resolution. */
export function linkTmuxDoc(spans: LinkedDocSpan[], version = 'latest'): LinkedDocSpan[] {
  return spans.flatMap((span): LinkedDocSpan[] => {
    if (!['text', 'code', 'ref'].includes(span.kind) || span.link) return [span]
    const text = 'text' in span ? span.text : span.label
    const code = span.kind !== 'text'
    const mentions = tmuxMentions(text, { code, version })
    if (!mentions.length) return [span]
    if (code && mentions.length === 1) return [{ kind: 'link', text, code: true, href: mentions[0].href }]
    const linked: LinkedDocSpan[] = []
    let end = 0
    for (const mention of mentions) {
      if (mention.start > end) linked.push({ kind: code ? 'code' : 'text', text: text.slice(end, mention.start) })
      linked.push({ kind: 'link', text: mention.text, href: mention.href, code })
      end = mention.end
    }
    if (end < text.length) linked.push({ kind: code ? 'code' : 'text', text: text.slice(end) })
    return linked
  })
}

/** Link the given names of one Markdown prose node without touching executable fences. */
export function mentionMarkdown(text: string, code: boolean, mentions: Mention[], project: (href: string) => string = (href) => href): string | undefined {
  if (!mentions.length) return undefined
  const literal = (value: string) => {
    if (!code) return value
    const fence = '`'.repeat(Math.max(1, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)))
    const pad = /^`|`$|^ .* $/.test(value) ? ' ' : ''
    return `${fence}${pad}${value}${pad}${fence}`
  }
  if (code && mentions.length === 1 && !mentions[0].inline) return `[${literal(text)}](${project(mentions[0].href)})`
  let linked = ''
  let end = 0
  for (const mention of mentions) {
    if (mention.start > end) linked += literal(text.slice(end, mention.start))
    linked += `[${literal(mention.text)}](${project(mention.href)})`
    end = mention.end
  }
  if (end < text.length) linked += literal(text.slice(end))
  return linked
}

/** Link one Markdown prose node's tmux names. */
export function tmuxMentionMarkdown(text: string, code: boolean, project?: (href: string) => string): string | undefined {
  return mentionMarkdown(text, code, tmuxMentions(text, { code }), project)
}
