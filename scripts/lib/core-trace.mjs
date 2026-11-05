import { appendFileSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { join } from 'node:path'
import { readTmuxState, recordedState, runTmux, settledState } from './mcp-tmux-state.mjs'
import { UnsettledPaneError } from './mcp-transcript-checks.mjs'

/**
 * What a program under recording leaves behind, port by port: a `tmux` shim
 * that sits first on the program's PATH, and a `mark` command the program runs
 * when an API call returns. Both append one JSON line to a trace file.
 *
 * The shim runs the real tmux with the same arguments and answers the program
 * with tmux's own stdout, stderr and exit status. It then reads the state of
 * the sandbox's tmux with `readTmuxState`, the reader the MCP recorder uses,
 * so every command carries the state tmux was in just after it. `mark` waits
 * for that state to settle (`settledState`) and stores it with the value the
 * call returned. A program needs nothing from tmux or from this module except
 * a `tmux` that is found on PATH and a way to run one command.
 *
 * The environment tells both where things are:
 * LIBTMUX_DOCS_TRACE (the trace file), LIBTMUX_DOCS_REAL_TMUX (the tmux to run),
 * LIBTMUX_DOCS_SANDBOX (the TMUX_TMPDIR the program runs in) and
 * LIBTMUX_DOCS_PANE_COMMANDS (what a settled pane runs, comma separated).
 */

const need = (env, name) => env[name] || (() => { throw new Error(`${name} is not set; the shim runs only inside gen-core-recording.mjs`) })()

const reader = (env) => {
  const real = need(env, 'LIBTMUX_DOCS_REAL_TMUX')
  // The state is read with the real tmux, so reading it never goes back through the shim.
  return readTmuxState({ sandbox: realpathSync(need(env, 'LIBTMUX_DOCS_SANDBOX')), run: (socket, args) => runTmux(socket, args, { command: real }) })
}

const append = (env, entry) => appendFileSync(need(env, 'LIBTMUX_DOCS_TRACE'), `${JSON.stringify(entry)}\n`)

/** Exit status the way a shell reports it: a signal is 128 plus its number. */
const exitStatus = (child) => child.status ?? 128 + (constants.signals[child.signal] ?? 1)

/**
 * Run tmux for the program and log what happened. Output goes through files,
 * not pipes: the tmux server a command starts keeps a copy of its standard
 * output open, and a pipe would then never close.
 *
 * @param {string[]} argv the program's arguments to tmux
 * @param {NodeJS.ProcessEnv} [env]
 */
export function runShim(argv, env = process.env) {
  const real = need(env, 'LIBTMUX_DOCS_REAL_TMUX')
  const files = mkdtempSync(join(need(env, 'LIBTMUX_DOCS_SANDBOX'), 'io-'))
  const [out, err] = ['out', 'err'].map((name) => openSync(join(files, name), 'w'))
  const start = Date.now()
  const child = spawnSync(real, argv, { stdio: ['inherit', out, err], env })
  const end = Date.now()
  closeSync(out)
  closeSync(err)
  const stdout = readFileSync(join(files, 'out'))
  const stderr = readFileSync(join(files, 'err'))
  rmSync(files, { recursive: true, force: true })
  const exit = exitStatus(child)
  let after
  let stateError
  try { after = recordedState(reader(env)()) } catch (error) { stateError = error.message }
  append(env, { type: 'tmux', start, end, argv, exit, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), after, ...(stateError ? { stateError } : {}) })
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  process.exitCode = exit
}

/** Exit status of a mark whose state never settled: the recorder runs the program again. */
export const UNSETTLED_EXIT = 75

/**
 * Record that an API call has returned: the value it returned, as JSON, and
 * the settled state of tmux. A state that does not settle is logged as such
 * and the program is told to stop.
 *
 * @param {string[]} argv `[step, json]`
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function runMark([step, json], env = process.env) {
  const commands = (env.LIBTMUX_DOCS_PANE_COMMANDS || 'sh').split(',')
  try {
    const tmux = await settledState({ read: reader(env), commands, port: env.LIBTMUX_DOCS_PORT || 'port' })({ tool: step })
    append(env, { type: 'mark', step, at: Date.now(), value: JSON.parse(json), tmux })
  } catch (error) {
    if (!(error instanceof UnsettledPaneError)) throw error
    append(env, { type: 'mark', step, at: Date.now(), unsettled: error.message })
    process.exitCode = UNSETTLED_EXIT
  }
}

/** The entries a trace file holds, in the order the programs wrote them. */
export const readTrace = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

const VALUE_FLAGS = new Set(['c', 'f', 'L', 'S', 'T'])

/**
 * An invocation of tmux split into its global flags and its commands. The
 * flags are the dashed words before the first command, and a flag that takes a
 * value (`-L name`, `-f/dev/null`) brings it along. The commands are what
 * follows, split at each `;` word.
 *
 * @param {string[]} argv
 * @returns {{ flags: string[], commands: string[][] }}
 */
export function splitInvocation(argv) {
  const flags = []
  let position = 0
  while (position < argv.length && /^-./.test(argv[position])) {
    const word = argv[position++]
    flags.push(word)
    // A value flag with nothing attached to it takes the next word.
    const valued = word.slice(1).split('').findIndex((letter) => VALUE_FLAGS.has(letter))
    if (valued >= 0 && valued === word.length - 2 && position < argv.length) flags.push(argv[position++])
  }
  const commands = [[]]
  for (const word of argv.slice(position)) {
    if (word === ';') commands.push([])
    else commands.at(-1).push(word)
  }
  return { flags, commands: commands.filter((command) => command.length > 0) }
}

/** The tmux commands that never change what a server holds, by name; anything else counts as a change. */
export const READ_ONLY = new Set(['list-sessions', 'list-windows', 'list-panes', 'list-clients', 'list-commands', 'list-keys', 'list-buffers', 'display-message', 'show-options', 'show-option', 'show-environment', 'show-hooks', 'show-messages', 'show-buffer', 'capture-pane', 'has-session', 'wait-for', 'if-shell'])

/** A word as tmux's own command parser reads it back: quoted when it holds white space or a quote. */
export const quoted = (word) => (/[\s'"\\;]/.test(word) || word === '' ? `'${word.replaceAll("'", "'\\''")}'` : word)

/**
 * What one traced invocation was, for a port's recorded profile: the commands
 * a reader would call "what the library sent", with the library's own preamble
 * taken off.
 *
 * `fence` recognises a command the library puts in front of every command to
 * prove that the server is the one it checked (libtmux-go's `if-shell -F`
 * guard); it is dropped. `probe` recognises an invocation that only asks tmux
 * who it is (`tmux -V`, a version query), which the library makes before it
 * sends a command; it is kept apart.
 *
 * @param {{ argv: string[], exit: number, stdout: string, stderr: string }} entry
 * @param {{ fence?: (command: string[]) => boolean, probe?: (invocation: { flags: string[], commands: string[][] }) => boolean }} profile
 */
export function describeInvocation(entry, profile = {}) {
  const invocation = splitInvocation(entry.argv)
  const kept = invocation.commands.filter((command) => !profile.fence?.(command))
  const role = profile.probe?.({ flags: invocation.flags, commands: kept }) ? 'probe' : 'command'
  const text = kept.map((command) => command.map(quoted).join(' ')).join(' ; ')
  return {
    role,
    tmux: role === 'probe' && kept.length === 0 ? invocation.flags.join(' ') : text,
    mutates: kept.some((command) => !READ_ONLY.has(command[0])),
    exit: entry.exit,
    stdout: entry.stdout.replace(/\n$/, ''),
    stderr: entry.stderr.replace(/\n$/, ''),
  }
}
