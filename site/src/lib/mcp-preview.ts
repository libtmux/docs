import { docSummaryText } from '@libtmux/api-model'
import type { McpObject } from './mcp-catalog'
import type { LinkPreview } from './link-preview'
import { PORT_BY_SLUG, portPageUrl } from './ports'

/** Preview protocol objects from the same captured registration as their page. */
export function mcpObjectPreview(port: string, version: string, object: McpObject): LinkPreview {
  const source = object.tool?.source
  return {
    schema: 1,
    title: object.name,
    kind: object.kind,
    description: docSummaryText(object.description.split(/\n\s*\n/, 1)[0], port),
    signature: object.item?.uriTemplate ?? object.item?.uri,
    detail:
      object.tool?.enabledByDefault === false
        ? object.tool.enableOption
          ? `Enable with ${object.tool.enableOption}.`
          : 'Disabled in the default configuration.'
        : undefined,
    href: portPageUrl(PORT_BY_SLUG[port], version, object.path),
    source: source
      ? `https://github.com/${source.repo}/blob/${source.revision}/${source.file}${source.line ? `#L${source.line}` : ''}`
      : undefined,
  }
}
