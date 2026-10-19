import { fromHtml } from 'hast-util-from-html'
import { parsePythonDoc } from '@libtmux/api-model'
import { MCP_REFERENCE, mcpObjects, toolSummary, type McpObject } from '../src/lib/mcp-reference'
import { tmuxMentions } from '../src/lib/tmux-links'

/** One piece of server-authored text that an MCP page renders as prose. */
export interface DescriptionSource {
  port: string
  object: McpObject
  /** Where on the page the text appears. */
  where: string
  text: string
}

export type Finding = { kind: 'role' | 'directive' | 'backtick' | 'tmux' | 'literal'; text: string }
export type Render = (text: string, context: { port: string; version: string; objectId: string }) => Promise<string>

const SKIPPED = new Set(['default', 'const', 'enum', 'examples', 'example'])

function schemaDescriptions(schema: unknown, where: string): { where: string; text: string }[] {
  if (!schema || typeof schema !== 'object') return []
  return Object.entries(schema).flatMap(([key, value]) => {
    if (key === 'description' && typeof value === 'string') return [{ where, text: value }]
    return SKIPPED.has(key) ? [] : schemaDescriptions(value, `${where}/${key}`)
  })
}

/**
 * Every description an object's page hands to the renderer.
 *
 * Mirrors `ProtocolReference.astro`: the object's description, each schema
 * field and type, each prompt argument, and, for the Python resource
 * templates, the argument prose its docstring carries.
 */
export function descriptionSources(port: string): DescriptionSource[] {
  return mcpObjects(port).flatMap((object): DescriptionSource[] => {
    const source = (where: string, text: string): DescriptionSource => ({ port, object, where, text })
    const parsed = port === 'py' && object.kind === 'resource-template' ? parsePythonDoc(object.description) : undefined
    const description = parsed ? [parsed.doc.summary, parsed.doc.body].filter(Boolean).join('\n\n') : object.description
    return [
      source('description', description),
      source('summary', toolSummary(object.description)),
      ...(parsed?.returnsDoc ? [source('returns', parsed.returnsDoc)] : []),
      ...[...(parsed?.params ?? new Map<string, string>())].map(([name, text]) => source(`variable/${name}`, text)),
      ...(object.item?.arguments ?? []).flatMap((argument) => argument.description ? [source(`argument/${argument.name}`, argument.description)] : []),
      ...schemaDescriptions(object.tool?.inputSchema, 'input').map(({ where, text }) => source(where, text)),
      ...schemaDescriptions(object.tool?.outputSchema, 'output').map(({ where, text }) => source(where, text)),
    ].filter((entry) => entry.text.trim())
  })
}

/** Sphinx roles, by the names a docstring uses. */
const ROLE = /(?<![\w:]):(?:py:|c:|cpp:|js:|std:|rst:)?(?:class|meth|func|attr|data|mod|exc|obj|const|ref|doc|term|envvar|option|command|samp|file|kbd|program|mimetype|abbr|code|pep|rfc|any|math|guilabel|menuselection|download|numref|event|setting)(?::[a-z]+)?:/
const DIRECTIVE = /^\s*\.\. [a-z][a-z-]*::/m

interface Context { code: boolean; link: boolean; pre: boolean }
type Node = { type: string; tagName?: string; value?: string; properties?: { className?: string[] }; children?: Node[] }

/** Markup a plain-text field, such as a meta description, would print as it is. */
export function auditPlain(text: string): Finding[] {
  return [
    ...(ROLE.test(text) ? [{ kind: 'role' as const, text: ROLE.exec(text)![0] }] : []),
    ...(DIRECTIVE.test(text) ? [{ kind: 'directive' as const, text: text.trim().slice(0, 60) }] : []),
    ...(text.includes('`') ? [{ kind: 'backtick' as const, text: text.slice(0, 60) }] : []),
  ]
}

/** What a reader would still see as markup, or a tmux name the page leaves unlinked. */
export function auditHtml(html: string): Finding[] {
  const findings: Finding[] = []
  const walk = (node: Node, context: Context) => {
    for (const child of node.children ?? []) {
      if (child.type === 'text') {
        const text = child.value ?? ''
        if (context.pre) continue
        if (!context.code) {
          const role = ROLE.exec(text)
          if (role) findings.push({ kind: 'role', text: role[0] })
          if (DIRECTIVE.test(text)) findings.push({ kind: 'directive', text: text.trim().split('\n')[0] })
          if (text.includes('`')) findings.push({ kind: 'backtick', text: text.trim().slice(0, 60) })
        }
        if (!context.link) for (const mention of tmuxMentions(text, { code: context.code })) findings.push({ kind: 'tmux', text: mention.text })
        continue
      }
      if (child.type !== 'element') continue
      if (child.tagName === 'code' && !context.pre && !child.properties?.className?.includes('api-literal')) {
        findings.push({ kind: 'literal', text: (child.children ?? []).map((part) => part.value ?? '').join('').slice(0, 60) })
      }
      walk(child, {
        pre: context.pre || child.tagName === 'pre',
        code: context.code || child.tagName === 'code',
        link: context.link || child.tagName === 'a',
      })
    }
  }
  walk(fromHtml(html, { fragment: true }) as unknown as Node, { code: false, link: false, pre: false })
  return findings
}

const KINDS = ['role', 'directive', 'backtick', 'tmux', 'literal'] as const

export interface PortAudit {
  sources: number
  /** Anchors to the tmux manual that the rendered text carries. */
  tmuxLinks: number
  counts: Record<Finding['kind'], number>
  /** The same markup in each object's plain-text summary. */
  plain: Record<Finding['kind'], number>
  examples: Record<Finding['kind'], string[]>
  /** Every finding, named by object and place. */
  findings: (Finding & { object: string; where: string })[]
}

/** Render every description of a port and count what remains raw. */
export async function auditPort(port: string, render: Render, plain: (object: McpObject) => string, version = 'latest'): Promise<PortAudit> {
  const zero = () => Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<Finding['kind'], number>
  const result: PortAudit = { sources: 0, tmuxLinks: 0, counts: zero(), plain: zero(), examples: Object.fromEntries(KINDS.map((kind) => [kind, []])) as unknown as PortAudit['examples'], findings: [] }
  for (const source of descriptionSources(port)) {
    const html = await render(source.text, { port, version, objectId: source.object.id })
    result.sources++
    result.tmuxLinks += (html.match(/<a [^>]*href="\/tmux\/[^"]*"/g) ?? []).length
    for (const finding of auditHtml(html)) {
      result.counts[finding.kind]++
      result.findings.push({ ...finding, object: source.object.name, where: source.where })
      if (result.examples[finding.kind].length < 3) result.examples[finding.kind].push(`${source.object.name} ${source.where}: ${finding.text}`)
    }
  }
  for (const object of mcpObjects(port)) for (const finding of auditPlain(plain(object))) result.plain[finding.kind]++
  return result
}

export const MCP_PORTS = Object.keys(MCP_REFERENCE)
