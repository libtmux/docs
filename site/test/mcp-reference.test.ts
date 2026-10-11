import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import catalogs from '../src/data/mcp-tools.json'
import { equivalentMcpTool, MCP_REFERENCE, renderToolDescription, toolSummary } from '../src/lib/mcp-reference'

it.each(Object.entries(catalogs.ports))(
  'keeps the %s catalog bound to its committed native snapshot',
  (port, catalog) => {
    const snapshot = JSON.parse(readFileSync(new URL(`../src/data/mcp-protocol/${port}.json`, import.meta.url), 'utf8'))
    const { tools, ...protocol } = snapshot.protocol as {
      tools: (Record<string, unknown> & { name: string })[]
    }
    expect(catalog.repo).toBe(snapshot.repo)
    expect(catalog.extractedRevision).toBe(snapshot.revision)
    expect(catalog.selection).toEqual(snapshot.selection)
    expect(catalog.protocol).toEqual(protocol)
    expect(catalog.registrations.map((tool) => tool.wireName).sort()).toEqual(tools.map((tool) => tool.name).sort())
    const contract = ({
      description,
      inputSchema,
      outputSchema,
      annotations,
      meta,
      _meta,
    }: Record<string, unknown>) => ({ description, inputSchema, outputSchema, annotations, meta: meta ?? _meta })
    for (const tool of tools) {
      const registration = catalog.registrations.find((entry) => entry.wireName === tool.name)!
      expect(registration.source.repo, tool.name).toBe(snapshot.repo)
      expect(registration.source.extractedRevision, tool.name).toBe(snapshot.revision)
      expect(contract(registration), tool.name).toEqual(contract(tool))
    }
  },
)

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
  expect(MCP_REFERENCE.csharp.registrations.some((tool) => tool.wireName === 'list_sessions')).toBe(true)
})

it('links equivalent operations whose registered names differ', () => {
  const ports = ['ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift']
  const groups = [
    [['py', 'run_command'], ...ports.map((port) => [port, 'run_shell_command'])],
    ...['create_session', 'create_window', 'split_window', 'snapshot_pane'].map((name) =>
      ['py', ...ports].map((port) => [port, name]),
    ),
    ports.map((port) => [port, 'clear_pane_scrollback']),
  ]
  for (const group of groups) {
    for (const [sourcePort, sourceName] of group) {
      for (const [targetPort, targetName] of group) {
        expect(equivalentMcpTool(sourcePort, sourceName, targetPort)?.wireName).toBe(targetName)
      }
    }
  }
})

it('keeps different effects and unavailable tools out of the equivalents', () => {
  expect(equivalentMcpTool('swift', 'run_command', 'py')).toBeUndefined()
  expect(equivalentMcpTool('py', 'clear_pane', 'rs')).toBeUndefined()
  expect(equivalentMcpTool('rs', 'clear_pane', 'py')).toBeUndefined()
  expect(equivalentMcpTool('py', 'missing', 'py')).toBeUndefined()
  expect(equivalentMcpTool('missing', 'list_sessions', 'py')).toBeUndefined()
  expect(equivalentMcpTool('py', 'list_sessions', 'missing')).toBeUndefined()
  expect(equivalentMcpTool('py', 'capture_pane', 'csharp')?.wireName).toBe('capture_pane')
})

it('links only registered tool mentions in description prose', async () => {
  const description =
    'Use capture_since after `capture_pane`. Keep `missing_tool` plain.\n\n[send_keys](https://example.com/) already has a link.\n\n```json\n{"name":"capture_pane"}\n```'
  const html = await renderToolDescription(description, { port: 'py', version: 'stable', toolName: 'capture_since' })
  expect(html).toContain('/py/stable/mcp/tools/capture_pane/"')
  expect(html).not.toContain('/py/stable/mcp/tools/capture_since/"')
  expect(html).not.toContain('/mcp/tools/missing_tool/')
  expect(html).not.toContain('/mcp/tools/send_keys/')
  expect(html.match(/\/py\/stable\/mcp\/tools\/capture_pane\/"/g)).toHaveLength(1)
  const dotnet = await renderToolDescription('Use capture_pane or `run_shell_command`.', {
    port: 'csharp',
    version: 'latest',
  })
  expect(dotnet).toContain('/csharp/latest/mcp/tools/capture_pane/')
  expect(dotnet).toContain('/csharp/latest/mcp/tools/run_shell_command/')
})
