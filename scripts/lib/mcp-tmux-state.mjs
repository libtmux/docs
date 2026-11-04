import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { UnsettledPaneError } from './mcp-transcript-checks.mjs'

/**
 * Read a recording's own tmux server directly, on its socket, so a recording
 * can store what tmux looked like after each call instead of what the call
 * returned. The state is the one `site/src/lib/mcp-tmux-state.ts` describes.
 */

const SESSION = ['session_id', 'session_name']
const WINDOW = ['session_id', 'window_id', 'window_index', 'window_name', 'window_active', 'window_layout']
const PANE = ['window_id', 'pane_id', 'pane_current_command', 'pane_left', 'pane_top', 'pane_width', 'pane_height', 'pane_active']
const SEPARATOR = '|'
/** Each listing is tagged, so one tmux invocation answers all three from the same moment. */
const format = (tag, fields) => `${tag}${SEPARATOR}${fields.map((field) => `#{${field}}`).join(SEPARATOR)}`
const LISTINGS = ['list-sessions', '-F', format('S', SESSION), ';', 'list-windows', '-a', '-F', format('W', WINDOW), ';', 'list-panes', '-a', '-F', format('P', PANE)]

/** tmux's answer when the server is gone or has nothing left in it: the state of a server that has exited. */
const NO_SERVER = /no server running|no sessions|error connecting to .*\((?:No such file or directory|Connection refused)\)/

/**
 * Parse what the three tagged listings printed. A field count that is not the
 * expected one means a name held the separator, and nothing is guessed.
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
    else if (tag === 'W') state.windows.push({ session: fields[0], id: fields[1], index: number(fields[2]), name: fields[3], active: flag(fields[4]), layout: fields[5] })
    else state.panes.push({ window: fields[0], id: fields[1], command: fields[2], left: number(fields[3]), top: number(fields[4]), width: number(fields[5]), height: number(fields[6]), active: flag(fields[7]) })
  }
  return state
}

/** The sockets of the tmux servers a sandbox started; tmux keeps them under `tmux-<uid>` in its `TMUX_TMPDIR`. */
export function sandboxSockets(sandbox) {
  const directory = join(sandbox, `tmux-${process.getuid?.() ?? ''}`)
  return existsSync(directory) ? readdirSync(directory).map((name) => join(directory, name)).filter((path) => statSync(path).isSocket()) : []
}

/** Run tmux against one socket and return what it printed; a failure carries tmux's own message. */
const runTmux = (socket, args) => {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  try {
    return execFileSync('tmux', ['-S', socket, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw Object.assign(new Error(`${String(error.stderr ?? error.message).trim()}`), { noServer: NO_SERVER.test(String(error.stderr ?? '')) })
  }
}

/**
 * A function that reads the state of the one tmux server the sandbox started.
 * It refuses a socket outside the sandbox, so it can never reach a reader's
 * server, and more than one server in the sandbox, because it could not say
 * which one the recording is of. A sandbox with no server, or a server with no
 * session, is a tmux with nothing in it. Any other failure to read throws.
 *
 * @param {{ sandbox: string, run?: (socket: string, args: string[]) => string, sockets?: (sandbox: string) => string[] }} options
 * @returns {() => { sessions: object[], windows: object[], panes: object[] }}
 */
export function readTmuxState({ sandbox, run = runTmux, sockets = sandboxSockets }) {
  return () => {
    const found = sockets(sandbox)
    for (const socket of found) if (!socket.startsWith(`${sandbox}${sep}`)) throw new Error(`${socket} is outside the sandbox ${sandbox}; its tmux is not read`)
    if (found.length > 1) throw new Error(`the sandbox runs more than one tmux server (${found.map((socket) => socket.split(sep).at(-1)).join(', ')}); which one the recording is of is not known`)
    if (found.length === 0) return { sessions: [], windows: [], panes: [] }
    let listed
    try {
      // A server that is still running with no session answers the window and pane listings with "no current target", so the sessions are asked for first.
      if (run(found[0], ['list-sessions', '-F', '#{session_id}']).trim() === '') return { sessions: [], windows: [], panes: [] }
      listed = run(found[0], LISTINGS)
    } catch (error) {
      if (error.noServer) return { sessions: [], windows: [], panes: [] }
      throw new Error(`tmux could not be read: ${error.message}`, { cause: error })
    }
    return parseListings(listed)
  }
}

/**
 * The `observe` function for `recordCalls`: it reads the state until two reads
 * a moment apart agree and every pane runs one of `commands`, because a pane
 * is described as `tmux` until its shell replaces it and a window is renamed
 * for the program a pane runs a moment after that program starts. A state
 * that has not settled by `timeoutMs` is an `UnsettledPaneError`, which the
 * recorder answers by recording again.
 *
 * @param {{ read: () => object, commands: string[], port: string, timeoutMs?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> }} options
 */
export function settledState({ read, commands, port, timeoutMs = 8000, intervalMs = 250, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  return async (step) => {
    const deadline = Date.now() + timeoutMs
    let previous
    for (;;) {
      const state = read()
      const odd = state.panes.find((pane) => !commands.includes(pane.command))
      const text = JSON.stringify(state)
      if (!odd && text === previous) return state
      if (Date.now() >= deadline) {
        throw new UnsettledPaneError(odd
          ? `${port}: tmux ran ${JSON.stringify(odd.command)} in ${odd.id} after ${step ? step.tool : 'the server started'}, not ${commands.join(' or ')}`
          : `${port}: tmux was still changing ${timeoutMs}ms after ${step ? step.tool : 'the server started'}`)
      }
      previous = text
      await sleep(intervalMs)
    }
  }
}
