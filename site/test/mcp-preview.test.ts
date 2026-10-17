import { expect, it } from 'vitest'
import { MCP_REFERENCE, mcpObjects } from '../src/lib/mcp-catalog'
import { mcpObjectPreview } from '../src/lib/mcp-preview'
import { highlightedPreview } from '../src/lib/link-preview'
import { linkPreviewTarget } from '../src/lib/link-preview-browser'
import { portPageUrl, PORT_BY_SLUG } from '../src/lib/ports'

it('previews every captured protocol object at its actual versioned route', () => {
  const kinds = new Set<string>()
  for (const port of Object.keys(MCP_REFERENCE)) {
    for (const object of mcpObjects(port)) {
      kinds.add(object.kind)
      const preview = mcpObjectPreview(port, 'v1', object)
      expect(preview.title).toBe(object.name)
      expect(preview.kind).toBe(object.kind)
      expect(preview.href).toBe(portPageUrl(PORT_BY_SLUG[port], 'v1', object.path))
      expect(linkPreviewTarget(preview.href, 'https://libtmux.org')?.endpoint).toBe(preview.href.replace(/\/$/, '.preview.json'))
      expect(preview.signature).toBe(object.item?.uriTemplate ?? object.item?.uri)
    }
  }
  expect([...kinds].sort()).toEqual(['prompt', 'resource', 'resource-template', 'tool'])
})

it('preserves opt-in tool availability without inventing a callable signature', () => {
  const object = mcpObjects('julia').find((entry) => entry.tool?.enabledByDefault === false)!
  expect(object).toBeDefined()
  const preview = mcpObjectPreview('julia', 'latest', object)
  expect(preview.detail).toBe(`Enable with ${object.tool!.enableOption}.`)
  expect(preview.signature).toBeUndefined()
  expect(preview.source).toContain(`/blob/${object.tool!.source.revision}/`)
})

it('keeps protocol URIs as plain selectable content and does not invent absent signatures', async () => {
  const [port, resource] = Object.keys(MCP_REFERENCE).flatMap((port) => mcpObjects(port)
    .filter((entry) => entry.kind === 'resource-template').map((entry) => [port, entry] as const))[0]
  const preview = await highlightedPreview(mcpObjectPreview(port, 'latest', resource))
  expect(preview.signature).toBe(resource.item?.uriTemplate)
  expect(preview.signatureHighlight!.language).toBe('text')
  expect(preview.signatureHighlight!.lines.flat().map((token) => token.content).join('')).toBe(preview.signature)
  expect(new Set(preview.signatureHighlight!.lines.flat().map((token) => token.light.color)).size).toBe(1)
  const empty = { schema: 1 as const, title: 'No signature', description: '', href: '/reference/none/' }
  expect(await highlightedPreview(empty)).toBe(empty)
})

it('does not turn protocol indexes or unknown categories into object previews', () => {
  for (const path of ['/en/ts/latest/mcp/tools/', '/en/ts/latest/mcp/prompts/', '/en/ts/latest/mcp/resources/',
    '/en/ts/latest/mcp/resources/templates/', '/en/ts/latest/mcp/unknown/foo/']) {
    expect(linkPreviewTarget(path, 'https://libtmux.org')).toBeUndefined()
  }
})
