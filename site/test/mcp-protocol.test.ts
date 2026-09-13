import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { captureProtocol } from '../../scripts/lib/mcp-protocol.mjs'

it('retains startup diagnostics when the server closes stdin immediately', async () => {
  await expect(captureProtocol({
    command: process.execPath,
    args: ['-e', 'require("node:fs").writeSync(2, "fixture startup refused\\n"); process.exit(2)'],
    timeoutMs: 3000,
  })).rejects.toThrow('fixture startup refused')
})

it('joins a discovery process that ignores graceful shutdown', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-docs-protocol-test-'))
  const script = join(directory, 'server.mjs')
  const pidFile = join(directory, 'pid')
  writeFileSync(script, `
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
writeFileSync(process.argv[2], String(process.pid))
process.on('SIGTERM', () => {})
setInterval(() => {}, 1000)
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {
    protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: {},
  } }))
})
`)
  try {
    const result = await captureProtocol({ command: process.execPath, args: [script, pidFile], timeoutMs: 3000 })
    expect(result.serverInfo.name).toBe('fixture')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(() => process.kill(pid, 0), 'discovery must join its owned process before returning').toThrow()
  } finally {
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL') } catch { /* Already joined. */ }
    rmSync(directory, { recursive: true, force: true })
  }
}, 5000)
