import { fromMarkdown } from 'mdast-util-from-markdown'
import { SKIP, visit } from 'unist-util-visit'
import { proseMentions, type ApiProduct } from '@libtmux/api-model'
import { resolvePortContent } from './workspace-shared-slots'
import { createProseLinker, PORT_BY_LABEL } from './prose-resolver'
import { PORT_BY_SLUG } from './ports'
import { rewriteMarkdownLinks } from '../plugins/remark-port-code.mjs'

interface MarkdownLinkProjection {
  /** Resolved API URLs already include their deployment prefix. */
  resolved?: (href: string) => string
  /** Authored links need the ownership region and the selected build version. */
  authored?: (href: string, owner?: string) => string
}

/** Add resolved links without reserializing prose or executable examples. */
export function linkProseMarkdown(raw: string, port?: string, product?: ApiProduct, project: MarkdownLinkProjection = {}): string {
  const { body, portAt } = resolvePortContent(raw, port)
  const linkApi = !port || PORT_BY_SLUG[port]?.referenceKind !== 'guide'
  const spans = new Set<number>()
  const edits: { start: number; end: number; text: string }[] = []
  let htmlDepth = 0
  visit(fromMarkdown(body), (node) => {
    if (project.authored && (node.type === 'link' || node.type === 'definition')) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        const owner = portAt(start) ?? port
        edits.push({ start, end, text: rewriteMarkdownLinks(body.slice(start, end), (href: string) => project.authored!(href, owner)) })
      }
    }
    if (['link', 'linkReference', 'image', 'imageReference', 'code', 'definition'].includes(node.type)) return SKIP
    if (node.type === 'html') {
      for (const tag of node.value.matchAll(/<(\/?)(?:a|code|pre)\b[^>]*>/gi)) {
        htmlDepth = Math.max(0, htmlDepth + (tag[1] ? -1 : 1))
      }
    }
    if (linkApi && node.type === 'inlineCode' && !htmlDepth && node.position?.start.offset !== undefined) {
      spans.add(node.position.start.offset)
    }
  })
  const link = createProseLinker(product)
  for (const mention of proseMentions(body, PORT_BY_LABEL, portAt)) {
    if (!spans.has(mention.start)) continue
    const decision = link(mention.text, { pagePort: portAt(mention.start) ?? port ?? mention.port, before: mention.before })
    if (decision.kind !== 'link') continue
    // Angle destinations preserve balanced punctuation in API slugs.
    const href = (project.resolved?.(decision.href) ?? decision.href).replaceAll('<', '%3C').replaceAll('>', '%3E')
    edits.push({ start: mention.start, end: mention.end, text: `[${body.slice(mention.start, mention.end)}](<${href}>)` })
  }
  let out = body
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
  return out
}
