import type { DocSpan, LinkTarget } from '@libtmux/api-model'
import { tmuxManual, tmuxManualUrl } from './tmux-manual-data'

type Command = ReturnType<typeof tmuxManual>['commands'][number]
const commandNames = new WeakMap<ReturnType<typeof tmuxManual>, Map<string, Command>>()

export interface TmuxMention {
  start: number
  end: number
  text: string
  command: string
  href: string
}

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
  const words = code ? /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|[A-Za-z0-9_/-]+|[^\s]/g : /[A-Za-z0-9_/-]+|[^\s]/g
  const tokens = [...text.matchAll(words)]
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }))
  const found = new Map<number, TmuxMention>()
  const add = (position: number, aliases = false) => {
    const token = tokens[position]
    if (!token) return
    const command = byName.get(token.text)
    if (!command || (!aliases && command.name !== token.text)) return
    if (/[\w./:$-]/.test(text[token.start - 1] ?? '') || /^[\w/-]|^\.[A-Za-z]/.test(text.slice(token.end))) return
    found.set(token.start, { ...token, command: command.name, href: tmuxManualUrl(version, command.name) })
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

type LinkedDocSpan = DocSpan & { link?: LinkTarget }

/** Add native command links after language API and authored-link resolution. */
export function linkTmuxDoc(spans: LinkedDocSpan[], version = 'latest'): LinkedDocSpan[] {
  return spans.flatMap((span): LinkedDocSpan[] => {
    if (!['text', 'code', 'ref'].includes(span.kind) || span.link) return [span]
    const text = 'text' in span ? span.text : span.label
    const code = span.kind !== 'text'
    const mentions = tmuxCommandMentions(text, { code, version })
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

/** Link one Markdown prose node without touching executable fences. */
export function tmuxMentionMarkdown(text: string, code: boolean, project: (href: string) => string = (href) => href): string | undefined {
  const mentions = tmuxCommandMentions(text, { code })
  if (!mentions.length) return undefined
  const literal = (value: string) => {
    if (!code) return value
    const fence = '`'.repeat(Math.max(1, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)))
    const pad = /^`|`$|^ .* $/.test(value) ? ' ' : ''
    return `${fence}${pad}${value}${pad}${fence}`
  }
  if (code && mentions.length === 1) return `[${literal(text)}](${project(mentions[0].href)})`
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
