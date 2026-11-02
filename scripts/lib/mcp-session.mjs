import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * Run a stdio MCP server through a fixed list of tool calls and record each
 * request with the response it got.
 *
 * Unlike `captureProtocol`, this invokes tools, so the caller must give the
 * server a private tmux (its own TMUX_TMPDIR and HOME), never the reader's.
 * The server must also exit 0 by itself once its input closes.
 *
 * @param {{ command: string, args?: string[], cwd?: string, env?: Record<string, string | undefined>, calls: { tool: string, arguments: Record<string, unknown> }[], callTimeoutMs?: number, exitTimeoutMs?: number, pauseMs?: number }} options
 * @returns {Promise<{ serverInfo: unknown, steps: { tool: string, arguments: Record<string, unknown>, isError: boolean, content: unknown[], structuredContent?: unknown }[] }>}
 */
export async function recordCalls({ command, args = [], cwd, env = {}, calls, callTimeoutMs = 60000, exitTimeoutMs = 10000, pauseMs = 1500 }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096) })
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  const pending = new Map()
  const fail = (error) => { for (const request of pending.values()) request.reject(error); pending.clear() }
  child.on('error', fail)
  child.stdin.on('error', (error) => fail(new Error(`${error.message}: ${stderr}`)))
  child.on('exit', (code) => fail(new Error(`MCP process exited ${code} before the session ended: ${stderr}`)))
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`))
    else request.resolve(message.result)
  })
  let nextId = 0
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const request = (method, params, timeoutMs) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs}ms: ${stderr}`)) }, timeoutMs)
    pending.set(id, { method, resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    send({ id, method, params })
  })
  const stop = (signal) => {
    try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  let alive = true
  child.once('exit', () => { alive = false })
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'libtmux-docs-transcript', version: '1' },
    }, callTimeoutMs)
    send({ method: 'notifications/initialized' })
    const steps = []
    for (const call of calls) {
      // An agent takes a moment to read each result; a pane's shell needs one to draw its prompt before it is typed into.
      if (steps.length) await new Promise((resolve) => setTimeout(resolve, pauseMs))
      const result = await request('tools/call', { name: call.tool, arguments: call.arguments }, callTimeoutMs)
      steps.push({
        tool: call.tool, arguments: call.arguments, isError: result?.isError === true,
        content: result?.content ?? [], ...(result?.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      })
    }
    child.stdin.end()
    const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), exitTimeoutMs))])
    if (outcome === 'timeout') throw new Error(`server did not exit within ${exitTimeoutMs}ms of its input closing: ${stderr}`)
    if (outcome.code !== 0) throw new Error(`server exited ${outcome.code ?? outcome.signal}: ${stderr}`)
    return { serverInfo: initialized?.serverInfo, steps }
  } finally {
    lines.close()
    // Whatever the server left running goes with it, including when it would not exit by itself.
    if (alive) { child.stdin.end(); stop('SIGTERM'); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]); if (alive) stop('SIGKILL') }
  }
}
