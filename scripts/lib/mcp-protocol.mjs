import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/** Schema object order is not semantic; some SDKs emit hash maps in random order. */
export function orderedProtocol(value) {
  if (Array.isArray(value)) return value.map(orderedProtocol)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, orderedProtocol(item)]))
  return value
}

/**
 * Read advertised MCP contracts over stdio without invoking a tool or resource.
 * @param {{ command: string, args?: string[], cwd?: string, env?: Record<string, string | undefined>, timeoutMs?: number }} options
 */
export async function captureProtocol({ command, args = [], cwd, env = {}, timeoutMs = 30000 }) {
  const grouped = process.platform !== 'win32'
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: grouped })
  const closed = new Promise((resolve) => child.once('close', resolve))
  const stop = (signal) => {
    if (!child.pid) return
    try {
      if (grouped) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
  const pending = new Map()
  let nextId = 0
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096) })
  const lines = createInterface({ input: child.stdout })
  const fail = (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  child.on('error', fail)
  child.stdin.on('error', (error) => fail(new Error(`${error.message}: ${stderr}`)))
  child.on('exit', (code) => fail(new Error(`MCP process exited ${code}: ${stderr}`)))
  lines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    send({ id, method, ...(params ? { params } : {}) })
  })
  const timeout = setTimeout(() => {
    fail(new Error(`MCP discovery timed out: ${stderr}`))
    stop('SIGKILL')
  }, timeoutMs)
  const list = async (method, key) => {
    const entries = []
    let cursor
    do {
      const result = await request(method, cursor ? { cursor } : {})
      entries.push(...(result[key] ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return entries.sort((a, b) => (a.name ?? a.uri ?? a.uriTemplate).localeCompare(b.name ?? b.uri ?? b.uriTemplate))
  }
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'libtmux-docs-reference', version: '1' },
    })
    send({ method: 'notifications/initialized' })
    const capabilities = initialized.capabilities ?? {}
    return orderedProtocol({
      serverInfo: initialized.serverInfo,
      protocolVersion: initialized.protocolVersion,
      capabilities,
      tools: capabilities.tools ? await list('tools/list', 'tools') : [],
      resources: capabilities.resources ? await list('resources/list', 'resources') : [],
      resourceTemplates: capabilities.resources ? await list('resources/templates/list', 'resourceTemplates') : [],
      prompts: capabilities.prompts ? await list('prompts/list', 'prompts') : [],
    })
  } finally {
    clearTimeout(timeout)
    lines.close()
    child.stdin.end()
    stop('SIGTERM')
    const force = setTimeout(() => stop('SIGKILL'), 1000)
    await closed
    clearTimeout(force)
    stop('SIGKILL')
  }
}
