import { docSummaryText, tokenizeDoc } from '@libtmux/api-model'
import { MCP_SECTIONS, resolveMcpObject, type McpObject } from './mcp-catalog'
import { previewRuns, type LinkPreview, type PreviewReference } from './link-preview'
import { PORT_BY_SLUG, portPageUrl } from './ports'

/** The names a description gives its sibling tools and prompts, the way the object's own page links them. */
const BARE_NAME = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g

/**
 * The first paragraph as runs of text and the protocol objects it names, which resolve exactly as they do on the page
 * (a backticked name, or a bare tool name, never the object itself). Nothing is returned when no name resolves.
 */
function descriptionParts(port: string, version: string, object: McpObject, paragraph: string): LinkPreview['descriptionParts'] {
  const runs = previewRuns()
  const link = (text: string): PreviewReference | undefined => {
    const target = resolveMcpObject(port, text)
    if (!target || target.id === object.id || (target.kind === 'tool' && object.kind === 'tool' && target.name === object.name)) return undefined
    return { text, href: portPageUrl(PORT_BY_SLUG[port], version, target.path), kind: target.kind }
  }
  for (const span of tokenizeDoc(paragraph, port)) {
    if (span.kind === 'code') {
      const reference = link(span.text)
      if (reference) runs.reference(reference)
      else runs.text(span.text)
    } else if (span.kind === 'ref' || span.kind === 'citation') runs.text(span.label)
    else {
      let start = 0
      for (const match of span.text.matchAll(BARE_NAME)) {
        const reference = link(match[0])
        if (!reference) continue
        runs.text(span.text.slice(start, match.index))
        runs.reference(reference)
        start = match.index + match[0].length
      }
      runs.text(span.text.slice(start))
    }
  }
  return runs.finish(docSummaryText(paragraph, port))
}

/** Preview protocol objects from the same captured registration as their page. */
export function mcpObjectPreview(port: string, version: string, object: McpObject): LinkPreview {
  const source = object.tool?.source
  const paragraph = object.description.split(/\n\s*\n/, 1)[0]
  return {
    schema: 1, title: object.name, kind: object.kind,
    description: docSummaryText(paragraph, port),
    descriptionParts: descriptionParts(port, version, object, paragraph),
    footer: [PORT_BY_SLUG[port].name, `MCP ${MCP_SECTIONS[object.section].toLowerCase()}`],
    signature: object.item?.uriTemplate ?? object.item?.uri,
    detail: object.tool?.enabledByDefault === false
      ? object.tool.enableOption ? `Enable with ${object.tool.enableOption}.` : 'Disabled in the default configuration.'
      : undefined,
    href: portPageUrl(PORT_BY_SLUG[port], version, object.path),
    source: source ? `https://github.com/${source.repo}/blob/${source.revision}/${source.file}${source.line ? `#L${source.line}` : ''}` : undefined,
  }
}
