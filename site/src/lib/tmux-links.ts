import type { DocSpan, LinkTarget } from '@libtmux/api-model'
import { tmuxCatalogHref } from './tmux-catalog'
import { tmuxCatalogMentions, tmuxCatalogProseReferences } from './tmux-catalog-links'
import { tmuxManual, tmuxManualEntityHref, type TmuxEntityKind } from './tmux-manual-data'

export type { TmuxEntityKind } from './tmux-manual-data'

/**
 * The one place a tmux name becomes a destination.
 *
 * Every command, option, hook and format-variable link resolves here, and an
 * unknown name has none. Commands live in the CLI Manual; options, hooks and
 * format variables live in the catalog, which links back to the manual entry.
 */
export function tmuxEntityHref(kind: TmuxEntityKind, name: string, version = 'latest'): string | undefined {
  return kind === 'command' ? tmuxManualEntityHref(kind, name, version) : tmuxCatalogHref(kind, name, version)
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

/** Neighbouring text that settles which kind a single word or shared name means. */
export interface TmuxMentionContext {
  before?: string
  after?: string
}

/**
 * Locate every documented tmux name. Commands also match in prose; options,
 * hooks and format variables only where a name is deliberate: inside code,
 * in quotes, or in a `#{...}` expression. Which names those are, and which
 * stay plain, is `tmux-catalog-links.ts`.
 */
export function tmuxMentions(text: string, { code = false, version = 'latest', before, after }: { code?: boolean; version?: string } & TmuxMentionContext = {}): TmuxReference[] {
  const found: TmuxReference[] = tmuxCommandMentions(text, { code, version })
    .map(({ command, ...mention }) => ({ ...mention, kind: 'command', name: command }))
  const names = code ? tmuxCatalogMentions(text, { code, version, before, after }) : tmuxCatalogProseReferences(text, version)
  for (const mention of names) {
    if (found.some((other) => other.start < mention.end && mention.start < other.end)) continue
    found.push({ start: mention.start, end: mention.end, text: mention.text, kind: mention.kind, name: mention.name, href: tmuxEntityHref(mention.kind, mention.name, version)! })
  }
  return found.sort((a, b) => a.start - b.start)
}

type LinkedDocSpan = DocSpan & { link?: LinkTarget }

/** Add native tmux links after language API and authored-link resolution. */
export function linkTmuxDoc(spans: LinkedDocSpan[], version = 'latest'): LinkedDocSpan[] {
  const wording = (span?: LinkedDocSpan) => span && ('text' in span ? span.text : 'label' in span ? span.label : '') || ''
  return spans.flatMap((span, index): LinkedDocSpan[] => {
    if (!['text', 'code', 'ref'].includes(span.kind) || span.link) return [span]
    const text = 'text' in span ? span.text : span.label
    const code = span.kind !== 'text'
    const mentions = tmuxMentions(text, { code, version, before: wording(spans[index - 1]), after: wording(spans[index + 1]) })
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
export function tmuxMentionMarkdown(text: string, code: boolean, project?: (href: string) => string, context: TmuxMentionContext = {}): string | undefined {
  return mentionMarkdown(text, code, tmuxMentions(text, { code, ...context }), project)
}
