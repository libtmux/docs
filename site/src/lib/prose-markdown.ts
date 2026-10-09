import { fromMarkdown } from 'mdast-util-from-markdown'
import { SKIP, visit } from 'unist-util-visit'
import { proseMentions, type ApiProduct } from '@libtmux/api-model'
import { resolvePortContent } from './workspace-shared-slots'
import { createProseLinker, PORT_BY_LABEL } from './prose-resolver'
import { PORT_BY_SLUG } from './ports'

/** Add resolved links without reserializing prose or executable examples. */
export function linkProseMarkdown(raw: string, port?: string, product?: ApiProduct): string {
  const { body, portAt } = resolvePortContent(raw, port)
  if (port && PORT_BY_SLUG[port]?.referenceKind === 'guide') return body
  const spans = new Set<number>()
  let htmlDepth = 0
  visit(fromMarkdown(body), (node) => {
    if (['link', 'linkReference', 'image', 'imageReference', 'code', 'definition'].includes(node.type)) return SKIP
    if (node.type === 'html') {
      for (const tag of node.value.matchAll(/<(\/?)(?:a|code|pre)\b[^>]*>/gi)) {
        htmlDepth = Math.max(0, htmlDepth + (tag[1] ? -1 : 1))
      }
    }
    if (node.type === 'inlineCode' && !htmlDepth && node.position?.start.offset !== undefined) {
      spans.add(node.position.start.offset)
    }
  })
  const link = createProseLinker(product)
  let out = body
  for (const mention of proseMentions(body, PORT_BY_LABEL, portAt).reverse()) {
    if (!spans.has(mention.start)) continue
    const decision = link(mention.text, { pagePort: portAt(mention.start) ?? port ?? mention.port, before: mention.before })
    if (decision.kind !== 'link') continue
    // Angle destinations preserve balanced punctuation in API slugs.
    const href = decision.href.replaceAll('<', '%3C').replaceAll('>', '%3E')
    out = `${out.slice(0, mention.start)}[${body.slice(mention.start, mention.end)}](<${href}>)${out.slice(mention.end)}`
  }
  return out
}
