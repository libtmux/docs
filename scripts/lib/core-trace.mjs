import { appendFileSync, closeSync, createReadStream, createWriteStream, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
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
 *
 * A control client (`tmux -C` or `-CC`) stays up while the program talks to
 * it, so it is not run to completion: `shimScript` becomes the tmux client
 * with its input and output passing through readers that log, in order, a
 * `send` for each command line the program writes (the startup command first),
 * a `notification` for each line tmux sends unasked, and a `reply` for each
 * `%begin`...`%end` block with the state tmux was in when the command
 * finished. The reply is passed on to the program only after it is logged, so
 * the program's next mark comes after it in the trace.
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

/** Whether the invocation starts a control client: `-C` or `-CC` among the flags before the command. */
export const isControlInvocation = (argv) => splitInvocation(argv).flags.some((word) => {
  // Letters up to the first one that takes a value (\`-Lname\`): the rest of the word is that value.
  const letters = /^-([A-Za-z]+)$/.exec(word)?.[1] ?? ''
  const valued = letters.split('').findIndex((letter) => VALUE_FLAGS.has(letter))
  return (valued < 0 ? letters : letters.slice(0, valued)).includes('C')
})

/**
 * One command line as tmux's parser reads it, as words: white space separates,
 * single and double quotes group, a backslash quotes the next character, and a
 * `;` that ends a word is a command separator of its own.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCommandLine(line) {
  const words = []
  let word
  let quote
  const flush = () => { if (word !== undefined) words.push(word); word = undefined }
  for (let at = 0; at < line.length; at++) {
    const char = line[at]
    if (quote) {
      if (char === quote) quote = undefined
      else if (char === '\\' && quote === '"' && at + 1 < line.length) word += line[++at]
      else word += char
    } else if (char === "'" || char === '"') { quote = char; word ??= '' }
    else if (char === '\\' && at + 1 < line.length) word = (word ?? '') + line[++at]
    else if (/\s/.test(char)) flush()
    else if (char === ';' && (word === undefined || at + 1 === line.length || /\s/.test(line[at + 1]))) { flush(); words.push(';') }
    else word = (word ?? '') + char
  }
  flush()
  return words
}

/**
 * Reads what a control client prints, line by line: a `%begin` line opens a
 * reply, the lines up to `%end` or `%error` are its text, and any other line
 * outside a reply is a notification. Feed it bytes as they arrive.
 */
export class ControlReader {
  #pending = Buffer.alloc(0)
  #reply

  /** @returns {{ line: Buffer, event: { kind: 'notification', text: string } | { kind: 'reply', exit: number, text: string } | undefined }[]} each complete line, and what it completed */
  feed(chunk) {
    this.#pending = Buffer.concat([this.#pending, chunk])
    const out = []
    for (let end = this.#pending.indexOf(10); end >= 0; end = this.#pending.indexOf(10)) {
      const line = this.#pending.subarray(0, end + 1)
      this.#pending = this.#pending.subarray(end + 1)
      out.push({ line, event: this.#read(line.toString('utf8').replace(/\r?\n$/, '')) })
    }
    return out
  }

  /** What is left when the stream ends: a line with no newline. */
  rest() { return this.#pending }

  #read(text) {
    if (this.#reply) {
      if (/^%(end|error) /.test(text)) {
        const done = { kind: 'reply', exit: text.startsWith('%error') ? 1 : 0, text: this.#reply.join('\n') }
        this.#reply = undefined
        return done
      }
      this.#reply.push(text)
      return undefined
    }
    if (/^%begin /.test(text)) { this.#reply = []; return undefined }
    return text.startsWith('%') ? { kind: 'notification', text } : undefined
  }
}

/** How many commands a line, or a startup's arguments, holds: tmux answers each with a reply of its own. */
export const commandCount = (words) => splitInvocation(words).commands.length

/**
 * What stands in for `tmux` in the program's PATH. A control client must keep
 * the process id the program started, because libtmux-go finds its own client
 * by it, so a control invocation does not run inside the shim: the script logs
 * the startup command, starts a reader of the program's input and a reader of
 * tmux's output, and becomes the real tmux with both through pipes. Anything
 * else runs through `shim`.
 *
 * @param {{ node: string, entry: string }} where the node binary and `core-trace.mjs`
 */
export const shimScript = ({ node, entry }) => `#!/bin/sh
NODE=${JSON.stringify(node)}
ENTRY=${JSON.stringify(entry)}
for word in "$@"; do
  case $word in
    -*C*)
      if "$NODE" "$ENTRY" is-control "$@"; then
        dir=$(mktemp -d "$LIBTMUX_DOCS_SANDBOX/control-XXXXXX") || exit 70
        mkfifo "$dir/in" "$dir/out" || exit 70
        "$NODE" "$ENTRY" control-start "$$" "$@" || exit 70
        # A background job's standard input is /dev/null, even from <&0, so the program's input is kept on 3.
        exec 3<&0
        "$NODE" "$ENTRY" control-in "$$" "$dir/in" "$@" <&3 3<&- >/dev/null 2>&1 &
        "$NODE" "$ENTRY" control-out "$$" "$dir/out" "$dir" >&1 &
        exec "$LIBTMUX_DOCS_REAL_TMUX" "$@" 3<&- <"$dir/in" >"$dir/out"
      fi
      break ;;
  esac
done
exec "$NODE" "$ENTRY" shim "$@"
`

/** Log the startup command of a control client: the first thing it answers. */
export function controlStart(client, argv, env = process.env) {
  append(env, { type: 'send', client, seq: 0, count: commandCount(argv), at: Date.now(), argv })
}

/**
 * Relay the program's input to tmux, logging each line it writes before tmux
 * can answer it. Ends when the program closes its input or the tmux client
 * (process `client`, which the script became) is gone.
 */
export function controlIn(client, fifo, argv, env = process.env) {
  const out = createWriteStream(fifo)
  out.on('error', () => process.exit(0))
  let seq = commandCount(argv)
  const lines = new ControlReader()
  process.stdin.on('data', (chunk) => {
    for (const { line } of lines.feed(chunk)) {
      const text = line.toString('utf8').replace(/\r?\n$/, '')
      const count = commandCount(splitCommandLine(text))
      append(env, { type: 'send', client, seq, count, at: Date.now(), line: text })
      seq += count
    }
    out.write(chunk)
  })
  process.stdin.on('end', () => out.end())
  setInterval(() => { try { process.kill(Number(client), 0) } catch { process.exit(0) } }, 200)
}

/**
 * Pass tmux's output to the program, logging each line before the program can
 * see it: a notification as it is, a reply with the state of tmux when it
 * finished. Ends when tmux closes its output, and removes the script's directory.
 */
export async function controlOut(client, fifo, directory, env = process.env) {
  const read = reader(env)
  const output = new ControlReader()
  const pass = (line) => new Promise((done) => { process.stdout.write(line, () => done()) })
  process.stdout.on('error', () => {})
  let seq = 0
  for await (const chunk of createReadStream(fifo)) {
    for (const { line, event } of output.feed(chunk)) {
      if (event?.kind === 'notification') append(env, { type: 'notification', client, at: Date.now(), line: event.text })
      if (event?.kind === 'reply') {
        let after
        let stateError
        try { after = recordedState(read()) } catch (error) { stateError = error.message }
        append(env, { type: 'reply', client, seq: seq++, at: Date.now(), exit: event.exit, stdout: event.text ? `${event.text}\n` : '', after, ...(stateError ? { stateError } : {}) })
      }
      await pass(line)
    }
  }
  const rest = output.rest()
  if (rest.length > 0) await pass(rest)
  rmSync(directory, { recursive: true, force: true })
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
 * guard); it is dropped. `unwrap`, for a library that wraps the command itself
 * in its guard (`if-shell -F <check> '<command>' '<on failure>'`), gives the
 * command inside. `probe` recognises an invocation that only asks tmux
 * who it is (`tmux -V`, a version query), which the library makes before it
 * sends a command; it is kept apart.
 *
 * @param {{ argv: string[], exit: number, stdout: string, stderr: string }} entry
 * @param {{ fence?: (command: string[]) => boolean, unwrap?: (command: string[]) => string[] | undefined, probe?: (invocation: { flags: string[], commands: string[][] }) => boolean }} profile
 */
export function describeInvocation(entry, profile = {}) {
  const invocation = splitInvocation(entry.argv)
  const kept = invocation.commands.map((command) => profile.unwrap?.(command) ?? command).filter((command) => !profile.fence?.(command))
  const role = profile.probe?.({ flags: invocation.flags, commands: kept, line: entry.line }) ? 'probe' : 'command'
  const text = entry.line !== undefined && role === 'probe' ? entry.line : kept.map((command) => command.map(quoted).join(' ')).join(' ; ')
  return {
    role,
    tmux: role === 'probe' && kept.length === 0 ? invocation.flags.join(' ') : text,
    mutates: kept.some((command) => !READ_ONLY.has(command[0])),
    exit: entry.exit,
    stdout: entry.stdout.replace(/\n$/, ''),
    stderr: entry.stderr.replace(/\n$/, ''),
  }
}
