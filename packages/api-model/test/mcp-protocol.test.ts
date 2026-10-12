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

  it.each(['tools', 'prompts', 'resources', 'resourceTemplates'])('rejects a missing %s array instead of publishing an empty catalog', async (key) => {
    const capability = key === 'resourceTemplates' ? 'resources' : key
    const fixture = `
      const { createInterface } = require('node:readline');
      createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (!message.id) return;
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { ${capability}: {} } }
          : message.method === 'resources/list' && '${key}' === 'resourceTemplates'
            ? { resources: [] } : {};
        console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });`
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow(`missing or invalid ${key} array`)
  })

  it('rejects an incomplete later page instead of publishing a partial catalog', async () => {
    const fixture = server.replace("{ tools: [{ name: 'second', inputSchema: { type: 'object', properties: {} } }] }", '{}')
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow('missing or invalid tools array')
  })

  it.each(['tools', 'prompts', 'resources', 'resourceTemplates'])('rejects an invalid %s registration', async (key) => {
    const capability = key === 'resourceTemplates' ? 'resources' : key
    const fixture = `
      const { createInterface } = require('node:readline');
      createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (!message.id) return;
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { ${capability}: {} } }
          : message.method === 'resources/list' && '${key}' === 'resourceTemplates'
            ? { resources: [] } : { ${key}: [{ description: 'Missing the registration identity.' }] };
        console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });`
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow(`invalid ${key} registration`)
  })

  it('follows an empty opaque pagination cursor', async () => {
    const fixture = server.replace('message.params.cursor', "Object.hasOwn(message.params, 'cursor')")
      .replace("nextCursor: 'page-two'", "nextCursor: ''")
    const protocol = await captureProtocol({ command: process.execPath, args: ['-e', fixture] })
    expect(protocol.tools.map((tool) => tool.name)).toEqual(['first', 'second'])
  })

  it('rejects a missing capabilities object while accepting an explicitly empty one', async () => {
    const empty = server.replace('capabilities: { tools: {} }', 'capabilities: {}')
    expect((await captureProtocol({ command: process.execPath, args: ['-e', empty] })).tools).toEqual([])
    await expect(captureProtocol({ command: process.execPath, args: ['-e', server.replace('capabilities: { tools: {} }', 'invalid: {}')] }))
      .rejects.toThrow('missing or invalid capabilities object')
  })

  it.each(['null', 'false', '[]'])('rejects a malformed advertised capability %s', async (value) => {
    const fixture = server.replace('capabilities: { tools: {} }', `capabilities: { tools: ${value} }`)
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow('invalid tools capability object')
  })

  it('requires the negotiated protocol and server identity', async () => {
    const fixture = server.replace("protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' },", '')
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow('missing or invalid protocolVersion or serverInfo')
  })

  it.each([-32601, -32603])('handles resource template discovery error %i', async (code) => {
    const resources = server
      .replace('tools: {}', 'resources: {}')
      .replace("} else if (message.method === 'tools/list') {", `} else if (message.method === 'resources/list') {
        result = { resources: [{ name: 'capabilities', uri: 'tmux://capabilities' }] };
      } else if (message.method === 'resources/templates/list') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: ${code}, message: 'template discovery failed' } }) + '\\n');
        return;
      } else if (message.method === 'tools/list') {`)
    const discovery = captureProtocol({ command: process.execPath, args: ['-e', resources] })
    if (code === -32601) {
      const protocol = await discovery
      expect(protocol.resources.map((resource) => resource.uri)).toEqual(['tmux://capabilities'])
      expect(protocol.resourceTemplates).toEqual([])
      expect(protocol.unsupportedMethods).toEqual(['resources/templates/list'])
    } else {
      await expect(discovery).rejects.toThrow('template discovery failed')
    }
  })

  it('rejects method-not-found after a successful template page instead of publishing a partial catalog', async () => {
    const fixture = `
      const { createInterface } = require('node:readline');
      createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (!message.id) return;
        if (message.method === 'resources/templates/list' && Object.hasOwn(message.params, 'cursor')) {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Second page disappeared' } }));
          return;
        }
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { resources: {} } }
          : message.method === 'resources/list' ? { resources: [] }
          : { resourceTemplates: [{ name: 'first', uriTemplate: 'tmux://first/{id}' }], nextCursor: '' };
        console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });`
    await expect(captureProtocol({ command: process.execPath, args: ['-e', fixture] }))
      .rejects.toThrow('Second page disappeared')
  })
})
