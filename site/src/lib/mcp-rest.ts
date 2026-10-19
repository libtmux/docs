import { tokenizeDoc } from '@libtmux/api-model'
import { API_MODELS } from './api-models'
import { asideFor, asideMarkdown } from './aside'
import { resolveMcpObject } from './mcp-catalog'
import { PORT_BY_SLUG, portPageUrl } from './ports'
import { createProseLinker } from './prose-resolver'

/**
 * Sphinx markup in MCP descriptions.
 *
 * A server publishes its tool docstrings verbatim, so the Python server's
 * descriptions carry roles (`:func:`), directives (`.. warning::`) and
 * double-backtick literals that a Markdown renderer prints as text. This
 * rewrites the roles and directives into Markdown before rendering; the
 * links it cannot resolve become plain code, never role text.
 */

/** Sphinx sites that own the documents a server's `:doc:` roles name. */
const UPSTREAM_DOCS: Record<string, string> = { py: 'https://libtmux-mcp.git-pull.com' }

/** Roles whose argument is a literal, not a destination. */
const LITERAL_ROLES = new Set(['envvar', 'option', 'command', 'samp', 'file', 'program', 'mimetype'])

const ROLE = /:([a-z][a-z0-9]*(?::[a-z][a-z0-9]*)*):`([^`]+)`/g
const DIRECTIVE = /^(\s*)\.\.\s+([a-z][a-z-]*)::\s*(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/

export interface RestContext { port: string; version: string }

function code(text: string): string {
  const fence = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map((run) => run[0].length + 1)))
  const pad = /^`|`$/.test(text) ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/** One role as Markdown: a link when its target has a page, otherwise code or text. */
function role(match: string, name: string, argument: string, context: RestContext | undefined): string {
  if (name === 'doc') {
    const titled = /^(.*?)\s*<([^>]+)>$/.exec(argument.trim())
    const path = (titled?.[2] ?? argument).trim()
    const label = titled?.[1].trim() || path.replace(/^\//, '')
    const base = context && UPSTREAM_DOCS[context.port]
    return base && path.startsWith('/') ? `[${label}](${base}${path.replace(/\/$/, '')}/)` : label
  }
  const [span] = tokenizeDoc(match)
  if (!span) return match
  if (span.kind === 'text') return LITERAL_ROLES.has(name) ? code(span.text) : span.text
  if (span.kind !== 'ref') return match
  if (!context || span.target.startsWith('.')) return code(span.label)
  const model = API_MODELS[context.port]
  const implementation = model?.symbols.some((symbol) => symbol.product === 'mcp' && symbol.kind === 'function' &&
    (symbol.publicId ?? symbol.id) === span.target)
  // A tool's implementing function documents the tool: send readers to its protocol page.
  const tool = implementation ? resolveMcpObject(context.port, span.target.split('.').at(-1)!, 'tool') : undefined
  if (tool) return `[${code(span.label)}](${portPageUrl(PORT_BY_SLUG[context.port], context.version, tool.path)})`
  const decision = createProseLinker('mcp')(span.target, { pagePort: context.port })
  return decision.kind === 'link' ? `[${code(span.label)}](${decision.href})` : code(span.label)
}

function aside(kind: string, argument: string, body: string, context: RestContext | undefined): string {
  const lead = argument.trim()
  const versioned = ({ versionadded: 'Added in', versionchanged: 'Changed in', deprecated: 'Deprecated since' } as Record<string, string>)[kind]
  const { type, title } = asideFor(kind)
  const text = versioned ? body : [lead, body].filter(Boolean).join('\n\n')
  return asideMarkdown(type, versioned ? `${versioned} ${lead}`.trim() : title, restToMarkdown(text, context))
}

/** Prose lines, with each directive and the lines it owns replaced by an aside. */
function prose(lines: string[], context: RestContext | undefined): string {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const start = DIRECTIVE.exec(lines[i])
    if (!start) {
      out.push(lines[i])
      continue
    }
    // A directive owns every following line that is blank or indented past its marker.
    const body: string[] = []
    while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].length - lines[i + 1].trimStart().length > start[1].length)) body.push(lines[++i])
    while (body.length && !body.at(-1)!.trim()) body.pop()
    const margin = Math.min(...body.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length))
    const text = body.map((line) => line.slice(Number.isFinite(margin) ? margin : 0)).join('\n').trim()
    out.push('', aside(start[2], start[3], text, context), '')
  }
  return out.join('\n').replace(ROLE, (match, name: string, argument: string) => role(match, name, argument, context))
}

/** Rewrite Sphinx roles and directives outside fenced code into Markdown. */
export function restToMarkdown(text: string, context?: RestContext): string {
  if (!/:[a-z][a-z0-9:]*:`|^\s*\.\.\s+[a-z-]+::/m.test(text)) return text
  const segments: string[] = []
  let current: string[] = []
  let fence: string | undefined
  const flush = () => {
    if (current.length) segments.push(prose(current, context))
    current = []
  }
  const verbatim: string[] = []
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      verbatim.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.replace(FENCE, '').trim()) {
        segments.push(verbatim.splice(0).join('\n'))
        fence = undefined
      }
    } else if (marker) {
      flush()
      fence = marker
      verbatim.push(line)
    } else {
      current.push(line)
    }
  }
  if (verbatim.length) segments.push(verbatim.join('\n'))
  flush()
  return segments.join('\n')
}
