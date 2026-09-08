import { describe, expect, it } from 'vitest'
import { captureProtocol, orderedProtocol } from '../../../scripts/lib/mcp-protocol.mjs'

const server = `
const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  let result;
  if (message.method === 'initialize') {
    result = { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } };
  } else if (message.method === 'tools/list') {
    result = message.params.cursor
      ? { tools: [{ name: 'second', inputSchema: { type: 'object', properties: {} } }] }
      : { tools: [{ name: 'first', description: 'Read a snapshot.', inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] }, annotations: { readOnlyHint: true } }], nextCursor: 'page-two' };
  } else throw Error('Discovery must not call ' + message.method);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});
`

describe('MCP protocol discovery', () => {
  it('normalizes object order while preserving tuple and enumeration order', () => {
    expect(JSON.stringify(orderedProtocol({ z: { b: 1, a: 2 }, a: ['z', 'a'] })))
      .toBe('{"a":["z","a"],"z":{"a":2,"b":1}}')
  })
  it('collects paginated advertised contracts without invoking tools or unsupported capabilities', async () => {
    const protocol = await captureProtocol({ command: process.execPath, args: ['-e', server] })
    expect(protocol.tools.map((tool) => tool.name)).toEqual(['first', 'second'])
    expect(protocol.tools[0].inputSchema.required).toEqual(['target'])
    expect(protocol.tools[0].annotations.readOnlyHint).toBe(true)
    expect(protocol.resources).toEqual([])
    expect(protocol.prompts).toEqual([])
  })

  it('bounds an unresponsive process', async () => {
    await expect(captureProtocol({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 50 }))
      .rejects.toThrow('MCP discovery timed out')
  })
})
