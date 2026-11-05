import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { UnsettledPaneError } from './mcp-transcript-checks.mjs'

/**
 * Read a recording's own tmux server directly, on its socket, so a recording
 * can store what tmux looked like after each call instead of what the call
 * returned. The state is the one `site/src/lib/mcp-tmux-state.ts` describes.
 */

const SESSION = ['session_id', 'session_name']
// `automatic-rename` is read to know whether tmux still names the window after its pane's program; a recording does not store it.
const WINDOW = ['session_id', 'window_id', 'window_index', 'window_name', 'window_active', 'window_layout', 'automatic-rename']
const PANE = ['window_id', 'pane_id', 'pane_current_command', 'pane_left', 'pane_top', 'pane_width', 'pane_height', 'pane_active']
const SEPARATOR = '|'
/** Each listing is tagged, so one tmux invocation answers all three from the same moment. */
const format = (tag, fields) => `${tag}${SEPARATOR}${fields.map((field) => `#{${field}}`).join(SEPARATOR)}`
const LISTINGS = ['list-sessions', '-F', format('S', SESSION), ';', 'list-windows', '-a', '-F', format('W', WINDOW), ';', 'list-panes', '-a', '-F', format('P', PANE)]

/**
 * tmux's answer when the server is gone or has nothing left in it: the state of a server that has exited.
 * A server told to exit stays up until its last client has gone, and drops every client that connects
 * meanwhile with "server exited unexpectedly".
 */
const NO_SERVER = /no server running|no sessions|server exited unexpectedly|error connecting to .*\((?:No such file or directory|Connection refused)\)/

/**
 * Parse what the three tagged listings printed. A field count that is not the
 * expected one means a name held the separator, and nothing is guessed. A
 * window also carries `automaticName`, whether tmux still renames it after its
 * pane's program; `settledState` reads it and leaves it out of the state it
 * returns (`recordedState`).
 *
 * @param {string} output
 * @returns {{ sessions: object[], windows: object[], panes: object[] }}
 */
export function parseListings(output) {
  const state = { sessions: [], windows: [], panes: [] }
  const fail = (line, why) => { throw new Error(`tmux listed a line that could not be read (${why}): ${JSON.stringify(line)}`) }
  for (const line of output.split('\n').filter(Boolean)) {
    const [tag, ...fields] = line.split(SEPARATOR)
    const number = (text) => (/^\d+$/.test(text) ? Number(text) : fail(line, `${JSON.stringify(text)} is not a number`))
    const flag = (text) => (text === '1' ? true : text === '0' ? false : fail(line, `${JSON.stringify(text)} is not a flag`))
    const expected = { S: SESSION, W: WINDOW, P: PANE }[tag]
    if (!expected) fail(line, 'unknown listing')
    if (fields.length !== expected.length) fail(line, `expected ${expected.length} fields, found ${fields.length}`)
    if (tag === 'S') state.sessions.push({ id: fields[0], name: fields[1] })
    else if (tag === 'W') state.windows.push({ session: fields[0], id: fields[1], index: number(fields[2]), name: fields[3], active: flag(fields[4]), layout: fields[5], automaticName: flag(fields[6]) })
    else state.panes.push({ window: fields[0], id: fields[1], command: fields[2], left: number(fields[3]), top: number(fields[4]), width: number(fields[5]), height: number(fields[6]), active: flag(fields[7]) })
  }
  return state
}

/**
 * The sockets under a sandbox's `tmux-<uid>` directory: sockets, and symbolic
 * links, which `ownSockets` resolves, so a link out of the sandbox is listed
 * and then refused rather than followed or left unseen.
 */
export function sandboxSockets(sandbox) {
  const directory = join(sandbox, `tmux-${process.getuid?.() ?? ''}`)
  return existsSync(directory)
    ? readdirSync(directory).map((name) => join(directory, name)).filter((path) => { const kind = lstatSync(path); return kind.isSocket() || kind.isSymbolicLink() })
    : []
}

/**
 * The sockets of a sandbox as the real paths tmux is run against, and those
 * that are not in it. A socket is in the sandbox only if what it resolves to
 * is: a link from inside the sandbox to a reader's server resolves outside it.
 *
 * @param {string} sandbox
 * @param {{ sockets?: (sandbox: string) => string[], realpath?: (path: string) => string }} [options]
 * @returns {{ own: string[], foreign: string[] }}
 */
export function ownSockets(sandbox, { sockets = sandboxSockets, realpath = realpathSync } = {}) {
  const found = sockets(sandbox)
  const own = []
  const foreign = []
  if (found.length === 0) return { own, foreign }
  const inside = `${realpath(sandbox)}${sep}`
  for (const socket of found) {
    let real
    try { real = realpath(socket) } catch (error) { throw new Error(`${socket} cannot be resolved (${error.message}); its tmux is not read`, { cause: error }) }
    if (socket.startsWith(`${sandbox}${sep}`) && real.startsWith(inside)) own.push(real)
    else foreign.push(socket === real ? socket : `${socket} (${real})`)
  }
  return { own, foreign }
}

/** How long one tmux invocation may take before it is given up on; a server that does not answer must not hold the recorder. */
export const TMUX_TIMEOUT_MS = 10000

/**
 * Run tmux against one socket and return what it printed; a failure carries
 * tmux's own message, and a tmux that does not answer in `timeoutMs` is killed.
 *
 * @param {string} socket
 * @param {string[]} args
 * @param {{ timeoutMs?: number, command?: string }} [options]
 */
export function runTmux(socket, args, { timeoutMs = TMUX_TIMEOUT_MS, command = 'tmux' } = {}) {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  try {
    return execFileSync(command, ['-S', socket, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' })
  } catch (error) {
    if (error.code === 'ETIMEDOUT') throw Object.assign(new Error(`tmux did not answer within ${timeoutMs}ms`, { cause: error }), { noServer: false })
    throw Object.assign(new Error(`${String(error.stderr ?? error.message).trim()}`), { noServer: NO_SERVER.test(String(error.stderr ?? '')) })
  }
}

/** Stop the tmux servers of a sandbox, and only those: a socket that resolves outside it is left alone. */
export function stopSandboxServers(sandbox, { run = runTmux, ...options } = {}) {
  for (const socket of ownSockets(sandbox, options).own) try { run(socket, ['kill-server']) } catch { /* no server left on that socket */ }
}

/**
 * A function that reads the state of the one tmux server the sandbox started.
 * It refuses a socket that resolves outside the sandbox, so it can never reach
 * a reader's server, and more than one server in the sandbox, because it could
 * not say which one the recording is of. A sandbox with no server, a server
 * that is exiting, or a server with no session, is a tmux with nothing in it.
 * Any other failure to read throws.
 *
 * @param {{ sandbox: string, run?: (socket: string, args: string[]) => string, sockets?: (sandbox: string) => string[], realpath?: (path: string) => string }} options
 * @returns {() => { sessions: object[], windows: object[], panes: object[] }}
 */
export function readTmuxState({ sandbox, run = runTmux, sockets = sandboxSockets, realpath = realpathSync }) {
  return () => {
    const { own, foreign } = ownSockets(sandbox, { sockets, realpath })
    if (foreign.length > 0) throw new Error(`${foreign[0]} is outside the sandbox ${sandbox}; its tmux is not read`)
    if (own.length > 1) throw new Error(`the sandbox runs more than one tmux server (${own.map((socket) => socket.split(sep).at(-1)).join(', ')}); which one the recording is of is not known`)
    if (own.length === 0) return { sessions: [], windows: [], panes: [] }
    let listed
    try {
      // A server that is still running with no session answers the window and pane listings with "no current target", so the sessions are asked for first.
      if (run(own[0], ['list-sessions', '-F', '#{session_id}']).trim() === '') return { sessions: [], windows: [], panes: [] }
      listed = run(own[0], LISTINGS)
    } catch (error) {
      if (error.noServer) return { sessions: [], windows: [], panes: [] }
      throw new Error(`tmux could not be read: ${error.message}`, { cause: error })
    }
    return parseListings(listed)
  }
}

/** A state as a recording stores it: without the `automaticName` a reader keeps for the settle check. */
export const recordedState = (state) => ({ ...state, windows: state.windows.map(({ automaticName: _note, ...window }) => window) })

/**
 * The `observe` function for `recordCalls`: it reads the state until two reads
 * a moment apart agree, every pane runs one of `commands` and every window
 * that tmux still names automatically carries the name of its active pane's
 * program. A pane is described as `tmux` until its shell replaces it, and a
 * window is renamed for the program a pane runs a while after that program
 * starts, so a state read before either is not the state a reader would see. A
 * state that has not settled by `timeoutMs` is an `UnsettledPaneError`, which
 * the recorder answers by recording again.
 *
 * @param {{ read: () => object, commands: string[], port: string, timeoutMs?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> }} options
 */
export function settledState({ read, commands, port, timeoutMs = 8000, intervalMs = 250, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  return async (step) => {
    const deadline = Date.now() + timeoutMs
    const after = step ? step.tool : 'the server started'
    let previous
    for (;;) {
      const state = read()
      const odd = state.panes.find((pane) => !commands.includes(pane.command))
      const unnamed = state.windows.find((window) => window.automaticName && window.name !== state.panes.find((pane) => pane.window === window.id && pane.active)?.command)
      const text = JSON.stringify(state)
      if (!odd && !unnamed && text === previous) return recordedState(state)
      if (Date.now() >= deadline) {
        throw new UnsettledPaneError(odd
          ? `${port}: tmux ran ${JSON.stringify(odd.command)} in ${odd.id} after ${after}, not ${commands.join(' or ')}`
          : unnamed
            ? `${port}: tmux still named window ${unnamed.id} ${JSON.stringify(unnamed.name)} after ${after}, not the program its active pane runs`
            : `${port}: tmux was still changing ${timeoutMs}ms after ${after}`)
      }
      previous = text
      await sleep(intervalMs)
    }
  }
}
