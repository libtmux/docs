import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { UnsettledPaneError } from './mcp-transcript-checks.mjs'

/**
 * Run a stdio MCP server through a fixed list of tool calls and record each
 * request with the response it got.
 *
 * Unlike `captureProtocol`, this invokes tools, so the caller must give the
 * server a private tmux (its own TMUX_TMPDIR and HOME), never the reader's.
 * The server must also exit 0 by itself once its input closes.
 *
 * A call's `arguments` may be a function of the steps recorded so far, for a
 * value only an earlier result can supply. The step records what was sent.
 *
 * `observe` reads the state of the server's tmux: once before the first call
 * (without a step; the result is returned as `before`) and after each call,
 * once the pause that stands for an agent reading the result has passed. What
 * it returns is stored on the step as `tmux`. An error it throws ends the
 * session, so a step whose state could not be read is never recorded.
 *
 * `controls` are calls made after the last one, in the same session, to check
 * a claim about the recording. Their answers come back in `controls` and are
 * not steps.
 *
 * @typedef {{ tool: string, arguments: Record<string, unknown>, isError: boolean, content: unknown[], structuredContent?: unknown, tmux?: unknown }} RecordedStep
 * @param {{ command: string, args?: string[], cwd?: string, env?: Record<string, string | undefined>, calls: { tool: string, arguments: Record<string, unknown> | ((steps: RecordedStep[]) => Record<string, unknown>) }[], controls?: { tool: string, arguments: Record<string, unknown> }[], observe?: (step?: RecordedStep) => unknown, callTimeoutMs?: number, exitTimeoutMs?: number, pauseMs?: number }} options
 * @returns {Promise<{ serverInfo: unknown, before?: unknown, steps: RecordedStep[], controls: RecordedStep[] }>}
 */
export async function recordCalls({ command, args = [], cwd, env = {}, calls, controls = [], observe, callTimeoutMs = 60000, exitTimeoutMs = 10000, pauseMs = 1500 }) {
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
    const answered = []
    const before = observe ? await observe() : undefined
    const pause = () => new Promise((resolve) => setTimeout(resolve, pauseMs))
    const call = async (tool, callArguments, into, more) => {
      const sent = typeof callArguments === 'function' ? callArguments(steps) : callArguments
      const result = await request('tools/call', { name: tool, arguments: sent }, callTimeoutMs)
      const step = {
        tool, arguments: sent, isError: result?.isError === true,
        content: result?.content ?? [], ...(result?.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      }
      // An agent takes a moment to read each result; a pane's shell needs one to draw its prompt before it is typed into.
      if (observe && into === steps) { await pause(); step.tmux = await observe(step) } else if (more) await pause()
      into.push(step)
    }
    for (const [index, { tool, arguments: callArguments }] of calls.entries()) await call(tool, callArguments, steps, index < calls.length - 1 || controls.length > 0)
    for (const [index, { tool, arguments: callArguments }] of controls.entries()) await call(tool, callArguments, answered, index < controls.length - 1)
    child.stdin.end()
    const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), exitTimeoutMs))])
    if (outcome === 'timeout') throw new Error(`server did not exit within ${exitTimeoutMs}ms of its input closing: ${stderr}`)
    if (outcome.code !== 0) throw new Error(`server exited ${outcome.code ?? outcome.signal}: ${stderr}`)
    return { serverInfo: initialized?.serverInfo, ...(observe ? { before } : {}), steps, controls: answered }
  } finally {
    lines.close()
    // Whatever the server left running goes with it, including when it would not exit by itself.
    if (alive) { child.stdin.end(); stop('SIGTERM'); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]); if (alive) stop('SIGKILL') }
  }
}

/** The first string held under `key`, at any depth, in the structured results of recorded steps. */
export function listedValue(steps, key) {
  const find = (value) => {
    if (value === null || typeof value !== 'object') return undefined
    if (typeof value[key] === 'string') return value[key]
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const found = find(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  return find(steps.map((step) => step.structuredContent))
}

/**
 * A call's arguments for `recordCalls`, with `standIn` replaced by the `key`
 * string an earlier result returned. It throws when no result returned one, so
 * a call is never sent with the stand-in.
 *
 * @param {Record<string, unknown>} callArguments
 * @param {string} standIn
 * @param {string} key
 */
export const withListed = (callArguments, standIn, key) => (steps) => {
  const real = listedValue(steps, key)
  if (real === undefined) throw new Error(`no earlier result returned a "${key}" to send in place of ${standIn}`)
  return JSON.parse(JSON.stringify(callArguments).replaceAll(JSON.stringify(standIn), JSON.stringify(real)))
}

/**
 * The calls of an example for `recordCalls`: a call whose arguments hold
 * `standIn` is sent the value an earlier result returned for `key` (see
 * `withListed`), and every other call goes out as written. Without a
 * `standIn`, the calls are unchanged.
 *
 * @param {{ tool: string, arguments: Record<string, unknown> }[]} steps
 * @param {string | undefined} standIn
 * @param {string} key
 */
export const standInCalls = (steps, standIn, key) => steps.map(({ tool, arguments: callArguments }) => ({
  tool, arguments: standIn && JSON.stringify(callArguments).includes(JSON.stringify(standIn)) ? withListed(callArguments, standIn, key) : callArguments,
}))

/** The tool of the first step whose structured result holds a string under `key`. */
export const listedBy = (steps, key) => steps.find((step) => listedValue([step], key) !== undefined)?.tool

/**
 * The calls to make once the example is done, to check that the stand-in is
 * what a real call must not send: the first call that carries it, as written.
 *
 * @param {{ tool: string, arguments: Record<string, unknown> }[]} steps
 * @param {string | undefined} standIn
 */
export const standInControls = (steps, standIn) => steps
  .filter(({ arguments: callArguments }) => standIn && JSON.stringify(callArguments).includes(JSON.stringify(standIn)))
  .slice(0, 1)
  .map(({ tool, arguments: callArguments }) => ({ tool, arguments: callArguments }))

/** The error code a refused control call carries, or nothing when the call was accepted. */
export const refusalCode = (control) => (control?.isError ? listedValue([control], 'code') : undefined)

/**
 * The code with which the server refused the stand-in, which must be the one
 * the page tells the reader (`expected`): a server that refuses it for another
 * reason, say a malformed target, has not shown that only the listed value
 * works.
 *
 * @param {{ isError?: boolean, structuredContent?: unknown } | undefined} control
 * @param {{ port: string, standIn: string, expected: string, listedBy?: string }} options
 * @returns {string}
 * @throws {Error} When the call was accepted, or refused with another code.
 */
export function requireRefusal(control, { port, standIn, expected, listedBy: tool }) {
  const code = refusalCode(control)
  if (code !== expected) throw new Error(`${port}: the server ${code ? `refused ${standIn} as ${code}, not ${expected}` : `did not refuse ${standIn}`}, so the recording cannot say a call must send the value ${tool} returned`)
  return code
}

/**
 * Record until a recording is settled. A pane described before its shell has
 * started, a window not yet renamed for its program, and a state that never
 * stops changing are all `UnsettledPaneError`s, whether `record` throws one
 * while the session runs or `check` throws one once it has ended. Each is
 * answered by `reset` and another recording, up to `attempts` in all; the
 * last one is thrown with the count. Any other error ends the run at once.
 *
 * @template T
 * @param {{ attempts: number, record: (attempt: number) => Promise<T>, check?: (recorded: T) => void, reset: () => unknown, warn?: (message: string) => void }} options
 * @returns {Promise<T>}
 */
export async function recordSettled({ attempts, record, check = () => {}, reset, warn = () => {} }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const recorded = await record(attempt)
      check(recorded)
      return recorded
    } catch (error) {
      if (!(error instanceof UnsettledPaneError)) throw error
      if (attempt >= attempts) throw new Error(`${error.message}; still unsettled after ${attempts} recordings`, { cause: error })
      warn(`${error.message}; recording again`)
      await reset()
    }
  }
}
