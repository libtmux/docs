/*
 * A tmux server this process owns, lent to one port example through that
 * port's arena adapter.
 *
 * The contract is the one each port's `tmux-arena` branch implements.
 * `LIBTMUX_ARENA_DESCRIPTOR` is the only activation signal; a complete
 * contract adds the artifact name, the exact socket, and the exact tmux
 * client. The adapter runs the example body through the port's production
 * API, then prints one `LIBTMUX_ARENA_EVIDENCE=<JSON>` line naming the live
 * challenge, server PID, and socket it reached. It never stops the server.
 * This module does, after proving the same server survived the run.
 *
 * `TMUX_TMPDIR` points into the private root for the server and the example,
 * but it only routes default and `-L` sockets, so it is not what makes the
 * server ours. Ownership comes from starting it here with `-D -S` and an
 * empty config, and from authenticating its PID before anything is lent. A
 * socket that appears under that `TMUX_TMPDIR` belongs to a server nobody was
 * lent: leak evidence after a complete contract, and an ambient fallback
 * after an incomplete one.
 *
 * Cleanup is process-group containment, not a process-tree reaper. A pane
 * descendant that double-forks out of tmux's reach survives `kill-server`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  accessSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const EVIDENCE_PREFIX = 'LIBTMUX_ARENA_EVIDENCE='
export const CHALLENGE_OPTION = '@libtmux_arena_challenge'
// Short and fixed, because a Unix socket path has a small length limit.
const ROOT_PARENT = '/tmp'
const ROOT_PREFIX = 'lta-docs-'
const HOLD_SESSION = 'arena-hold'
const OUTPUT_LIMIT = 8 * 1024 * 1024
const RECORD_LIMIT = 16 * 1024
const TAIL = 2000

export class ArenaFailure extends Error {}

const isExecutable = (path) => {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The tmux client every command here uses: an absolute override, or the first on PATH. */
export function resolveTmux(override = process.env.LIBTMUX_DOCS_ARENA_TMUX) {
  if (override) {
    if (!override.startsWith('/') || !isExecutable(override)) throw new ArenaFailure(`no executable tmux at ${override}`)
    return override
  }
  const found = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .map((dir) => join(dir, 'tmux')).find(isExecutable)
  if (!found) throw new ArenaFailure('tmux is not on PATH')
  return found
}

function killGroup(pid, signal) {
  if (!pid) return
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

const equal = (actual, expected) => typeof actual === 'string' && actual.length === expected.length
  && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
const tail = (text) => (text.length > TAIL ? `...${text.slice(-TAIL)}` : text)

function tmux(arena, args, timeout = 2000) {
  const result = spawnSync(arena.tmuxBin, ['-S', arena.socketPath, ...args], {
    encoding: 'utf8', env: arena.serverEnv, timeout,
  })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

/** The PID of whatever answers at the lent socket, or undefined when nothing does. */
function endpointPid(arena) {
  try {
    if (!lstatSync(arena.socketPath).isSocket()) return undefined
  } catch {
    return undefined
  }
  // display-message never starts a server, so a missing one stays missing.
  const { ok, out } = tmux(arena, ['display-message', '-p', '#{pid}\t#{socket_path}'], 1000)
  const [pid, socket] = out.split('\t')
  return ok && socket === arena.socketPath && /^\d+$/.test(pid) ? Number(pid) : undefined
}

/** Sockets under the private TMUX_TMPDIR: servers this run never lent. */
function strays(arena) {
  const dir = join(arena.runtime, `tmux-${process.getuid()}`)
  return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : []
}

function serverLog(arena) {
  try {
    return readFileSync(join(arena.root, 'server.log'), 'utf8').trim()
  } catch {
    return ''
  }
}

async function authenticate(arena, artifact) {
  const started = Date.now()
  let pid
  while ((pid = endpointPid(arena)) === undefined) {
    if (arena.spawnError || arena.server.exitCode !== null || arena.server.signalCode !== null) {
      throw new ArenaFailure(`tmux exited before serving ${arena.socketPath}: ${arena.spawnError?.message ?? serverLog(arena)}`)
    }
    if (Date.now() - started > 5000) throw new ArenaFailure(`tmux did not serve ${arena.socketPath} in time`)
    await delay(20)
  }
  if (pid !== arena.server.pid) {
    throw new ArenaFailure(`the server at ${arena.socketPath} is PID ${pid}, not the one started here (${arena.server.pid})`)
  }
  if (!tmux(arena, ['new-session', '-d', '-s', HOLD_SESSION]).ok || endpointPid(arena) !== pid) {
    throw new ArenaFailure('the tmux endpoint changed while it was being prepared')
  }
  const challenge = randomBytes(32).toString('hex')
  if (!tmux(arena, ['set-option', '-gq', CHALLENGE_OPTION, challenge]).ok
    || !equal(tmux(arena, ['show-options', '-gv', CHALLENGE_OPTION]).out, challenge)) {
    throw new ArenaFailure('the tmux challenge could not be installed')
  }
  arena.pid = pid
  arena.challenge = challenge
  // The challenge stays out of the descriptor: an adapter has to read it from the live server.
  arena.descriptor = join(arena.root, 'descriptor.json')
  const descriptor = {
    schema: 1,
    artifact: { name: artifact },
    tmux: { executable: arena.tmuxBin, socket: arena.socketPath, pid, hold_session: HOLD_SESSION },
  }
  writeFileSync(arena.descriptor, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 })
}

async function startArena(tmuxBin, artifact) {
  const root = mkdtempSync(join(ROOT_PARENT, ROOT_PREFIX))
  const rootStat = lstatSync(root)
  const dirs = Object.fromEntries(['home', 'config', 'runtime', 'tmp'].map((name) => [name, join(root, name)]))
  for (const dir of Object.values(dirs)) mkdirSync(dir, { mode: 0o700 })
  const config = join(root, 'tmux.conf')
  writeFileSync(config, '', { mode: 0o600 })

  // The example keeps HOME so its toolchain finds its caches; tmux never reads it,
  // because the server was started with an explicit empty config. The server
  // keeps the caller's SHELL, as an ordinary tmux would, but its panes load no
  // dotfiles from a private HOME. Swapping in another shell changes how early
  // keystrokes echo, and examples that match captured lines notice.
  const inherited = Object.entries(process.env)
    .filter(([key]) => key !== 'TMUX' && key !== 'TMUX_PANE' && !key.startsWith('LIBTMUX_'))
  const artifactEnv = {
    ...Object.fromEntries(inherited),
    PATH: `${dirname(tmuxBin)}${delimiter}${process.env.PATH ?? ''}`,
    TMUX_TMPDIR: dirs.runtime,
  }
  const serverEnv = {
    ...artifactEnv, HOME: dirs.home, TMPDIR: dirs.tmp,
    XDG_CONFIG_HOME: dirs.config, XDG_RUNTIME_DIR: dirs.runtime,
  }

  const log = openSync(join(root, 'server.log'), 'w')
  const socketPath = join(root, 's')
  const server = spawn(tmuxBin, ['-D', '-S', socketPath, '-f', config], {
    detached: true, env: serverEnv, stdio: ['ignore', log, log],
  })
  closeSync(log)
  const arena = {
    root, rootIdentity: [rootStat.dev, rootStat.ino], runtime: dirs.runtime,
    socketPath, tmuxBin, server, serverEnv, artifactEnv,
  }
  server.on('error', (error) => {
    arena.spawnError = error
  })
  try {
    await authenticate(arena, artifact)
  } catch (error) {
    await stopArena(arena)
    throw error
  }
  return arena
}

function removeRoot({ root, rootIdentity: [dev, ino] }) {
  let current
  try {
    current = lstatSync(root)
  } catch {
    return
  }
  if (!root.startsWith(join(ROOT_PARENT, ROOT_PREFIX)) || !current.isDirectory()
    || current.dev !== dev || current.ino !== ino) {
    throw new ArenaFailure(`refusing to remove ${root}: it is not the root this run created`)
  }
  rmSync(root, { recursive: true, force: true })
}

async function stopArena(arena) {
  for (const socket of strays(arena)) {
    spawnSync(arena.tmuxBin, ['-S', socket, 'kill-server'], { env: arena.serverEnv, stdio: 'ignore', timeout: 2000 })
  }
  const { server } = arena
  if (!arena.spawnError && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve))
    tmux(arena, ['kill-server'])
    await Promise.race([exited, delay(2000)])
  }
  killGroup(server.pid, 'SIGKILL')
  removeRoot(arena)
}

function runArtifact({ command, cwd, env, deadlineMs }) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { cwd, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const run = { stdout: '', stderr: '', overflow: false, timedOut: false }
    const take = (key) => (chunk) => {
      if (run[key].length + chunk.length > OUTPUT_LIMIT) run.overflow = true
      else run[key] += chunk
    }
    child.stdout.setEncoding('utf8').on('data', take('stdout'))
    child.stderr.setEncoding('utf8').on('data', take('stderr'))
    const timer = setTimeout(() => {
      run.timedOut = true
      killGroup(child.pid, 'SIGKILL')
    }, deadlineMs)
    child.on('error', (error) => {
      run.error = error
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      // Nothing the example started in its own process group outlives it.
      killGroup(child.pid, 'SIGKILL')
      resolve({ ...run, code, signal })
    })
  })
}

function contractEnv(arena, artifact, extra, complete) {
  return {
    ...arena.artifactEnv,
    ...extra,
    LIBTMUX_ARENA_DESCRIPTOR: arena.descriptor,
    LIBTMUX_ARENA_ARTIFACT: artifact,
    LIBTMUX_SOCKET_PATH: complete ? arena.socketPath : '',
    LIBTMUX_TMUX_BIN: arena.tmuxBin,
  }
}

const context = (run) => `\n--- stdout\n${tail(run.stdout)}\n--- stderr\n${tail(run.stderr)}`

function requireFinished(run, deadlineMs, condition = '') {
  if (run.error) throw new ArenaFailure(`the artifact did not start: ${run.error.message}`)
  if (run.timedOut) throw new ArenaFailure(`the artifact missed its ${deadlineMs} ms deadline${condition}${context(run)}`)
  if (run.overflow) throw new ArenaFailure(`the artifact printed more output than the arena keeps${context(run)}`)
}

function requireSameServer(arena) {
  if (arena.server.exitCode !== null || arena.server.signalCode !== null || endpointPid(arena) !== arena.pid) {
    throw new ArenaFailure('the lent server exited or changed during the run')
  }
  if (!equal(tmux(arena, ['show-options', '-gv', CHALLENGE_OPTION]).out, arena.challenge)) {
    throw new ArenaFailure('the lent server lost its challenge during the run')
  }
}

/** The one evidence record an adapter printed, parsed as a JSON object. */
export function parseEvidence(stdout) {
  const records = stdout.split('\n').filter((line) => line.startsWith(EVIDENCE_PREFIX))
    .map((line) => line.slice(EVIDENCE_PREFIX.length).replace(/\r$/, ''))
  if (records.length !== 1) throw new ArenaFailure(`the adapter printed ${records.length} evidence records, not exactly one`)
  if (Buffer.byteLength(records[0]) > RECORD_LIMIT) throw new ArenaFailure('the evidence record is larger than the arena accepts')
  let record
  try {
    record = JSON.parse(records[0])
  } catch (error) {
    throw new ArenaFailure(`the evidence record is not JSON: ${error.message}`)
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new ArenaFailure('the evidence record is not a JSON object')
  }
  return record
}

/** Prove the evidence names the lent artifact, socket, server, and live challenge. */
export function validateEvidence(record, { artifact, pid, socketPath, challenge }) {
  if (record.artifact !== artifact) {
    throw new ArenaFailure(`the evidence names artifact ${JSON.stringify(record.artifact)}, not ${artifact}`)
  }
  if (record.schema !== 1 || !Number.isInteger(record.server_pid) || typeof record.socket_path !== 'string') {
    throw new ArenaFailure('the evidence record has the wrong schema or field types')
  }
  if (typeof record.challenge !== 'string' || !/^[0-9a-f]{64}$/.test(record.challenge) || !equal(record.challenge, challenge)) {
    throw new ArenaFailure('the evidence challenge is not the one the lent server holds')
  }
  if (record.socket_path !== socketPath) {
    throw new ArenaFailure(`the evidence socket ${record.socket_path} is not the lent socket ${socketPath}`)
  }
  if (record.server_pid !== pid) throw new ArenaFailure(`the evidence PID ${record.server_pid} is not the lent server's ${pid}`)
}

/**
 * Lend a fresh server to one artifact under the complete contract. Returns
 * the evidence it printed once the evidence, the server's survival, and the
 * absence of any other server have all been proven.
 */
export async function runInArena({ tmuxBin, artifact, command, cwd, env = {}, deadlineMs = 180_000 }) {
  const arena = await startArena(tmuxBin, artifact)
  try {
    const run = await runArtifact({ command, cwd, env: contractEnv(arena, artifact, env, true), deadlineMs })
    requireFinished(run, deadlineMs)
    if (run.code !== 0) throw new ArenaFailure(`the artifact exited with ${run.code ?? run.signal}${context(run)}`)
    const evidence = parseEvidence(run.stdout)
    validateEvidence(evidence, { artifact, pid: arena.pid, socketPath: arena.socketPath, challenge: arena.challenge })
    requireSameServer(arena)
    const extra = strays(arena)
    if (extra.length) throw new ArenaFailure(`an extra tmux server appeared under the private TMUX_TMPDIR: ${extra.join(', ')}`)
    return evidence
  } finally {
    await stopArena(arena)
  }
}

/**
 * Lend a fresh server under a contract whose socket is left out. The artifact
 * has to fail, print no evidence, and reach no server at all: the adapter's
 * fail-closed path, observed from outside.
 */
export async function runFailClosed({ tmuxBin, artifact, command, cwd, env = {}, deadlineMs = 180_000 }) {
  const arena = await startArena(tmuxBin, artifact)
  try {
    const run = await runArtifact({ command, cwd, env: contractEnv(arena, artifact, env, false), deadlineMs })
    requireFinished(run, deadlineMs, ' under an incomplete contract')
    const ambient = strays(arena)
    if (ambient.length) {
      throw new ArenaFailure(`under an incomplete contract the artifact reached for a default tmux server: ${ambient.join(', ')}`)
    }
    if (run.code === 0) throw new ArenaFailure(`the artifact exited 0 under an incomplete contract${context(run)}`)
    if (run.stdout.split('\n').some((line) => line.startsWith(EVIDENCE_PREFIX))) {
      throw new ArenaFailure('the artifact printed evidence under an incomplete contract')
    }
    requireSameServer(arena)
  } finally {
    await stopArena(arena)
  }
}
