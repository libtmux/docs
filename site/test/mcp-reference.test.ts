import { expect, it } from 'vitest'
import { equivalentMcpTool, MCP_REFERENCE, renderToolDescription, toolSummary } from '../src/lib/mcp-reference'

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

it('links equivalent operations whose registered names differ', () => {
  const groups = [
    [['py', 'run_command'], ['ts', 'run_shell_command'], ['rs', 'run_shell_command'], ['go', 'run_command'], ['java', 'run_shell_command'], ['dotnet', 'tmux_run'], ['swift', 'run_shell_command']],
    [['py', 'create_session'], ['swift', 'create_session']],
    [['py', 'create_window'], ['rs', 'create_window'], ['cxx', 'new_window'], ['swift', 'create_window']],
    [['py', 'split_window'], ['rs', 'split_window'], ['dotnet', 'tmux_split_pane'], ['swift', 'split_window']],
    [['rs', 'clear_pane_scrollback'], ['ts', 'clear_pane_scrollback'], ['java', 'clear_pane_scrollback'], ['swift', 'clear_pane_scrollback']],
    [['ts', 'snapshot_pane'], ['rs', 'snapshot_pane'], ['swift', 'snapshot_pane']],
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
  expect(equivalentMcpTool('rs', 'clear_pane_scrollback', 'py')).toBeUndefined()
  expect(equivalentMcpTool('py', 'run_command', 'cxx')).toBeUndefined()
  expect(equivalentMcpTool('ts', 'snapshot_pane', 'cxx')).toBeUndefined()
  expect(equivalentMcpTool('py', 'missing', 'py')).toBeUndefined()
  expect(equivalentMcpTool('missing', 'list_sessions', 'py')).toBeUndefined()
  expect(equivalentMcpTool('py', 'list_sessions', 'missing')).toBeUndefined()
  expect(equivalentMcpTool('py', 'capture_pane', 'dotnet')?.wireName).toBe('tmux_capture_pane')
})

it('links only registered tool mentions in description prose', async () => {
  const description = 'Use capture_since after `capture_pane`. Keep `missing_tool` plain.\n\n[send_keys](https://example.com/) already has a link.\n\n```json\n{"name":"capture_pane"}\n```'
  const html = await renderToolDescription(description, { port: 'py', version: 'stable', toolName: 'capture_since' })
  expect(html).toContain('/py/stable/mcp/tools/capture_pane/"')
  expect(html).not.toContain('/py/stable/mcp/tools/capture_since/"')
  expect(html).not.toContain('/mcp/tools/missing_tool/')
  expect(html).not.toContain('/mcp/tools/send_keys/')
  expect(html.match(/\/py\/stable\/mcp\/tools\/capture_pane\/"/g)).toHaveLength(1)
  const dotnet = await renderToolDescription('Use tmux_capture_pane or `tmux_run`.', { port: 'dotnet', version: 'latest' })
  expect(dotnet).toContain('/dotnet/latest/mcp/tools/tmux_capture_pane/')
  expect(dotnet).toContain('/dotnet/latest/mcp/tools/tmux_run/')
})
