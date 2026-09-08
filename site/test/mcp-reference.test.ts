import { expect, it } from 'vitest'
import { MCP_REFERENCE, renderToolDescription, toolSummary } from '../src/lib/mcp-reference'

it('preserves protocol description structure while keeping index summaries short', async () => {
  const description = 'Read a pane.\n\n## Example\n\n```json\n{"pane_id":"%1"}\n```'
  expect(toolSummary(description)).toBe('Read a pane.')
  const html = await renderToolDescription(description)
  expect(html).toContain('<h2 id="example">Example</h2>')
  expect(html).toContain('<pre')
  expect(html).toContain('pane_id')
})

it('keeps the advertised wire name and input schema for every documented tool', () => {
  for (const reference of Object.values(MCP_REFERENCE)) {
    expect(reference.registrations.length).toBeGreaterThan(0)
    const names = reference.registrations.map((tool) => tool.wireName)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of reference.registrations) {
      expect(tool.schemaStatus).toBe('runtime')
      expect(tool.inputSchema?.type).toBe('object')
    }
  }
  expect(MCP_REFERENCE.dotnet.registrations.some((tool) => tool.wireName === 'tmux_list_sessions')).toBe(true)
})
