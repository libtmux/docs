#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { recordingProblems, sha256 } from '../site/src/lib/core-recording.ts'
import { recordSettled } from './lib/mcp-session.mjs'
import { readTmuxState, recordedState, settledState, stopSandboxServers } from './lib/mcp-tmux-state.mjs'
import { hostLeaks, sanitize, UnsettledPaneError } from './lib/mcp-transcript-checks.mjs'
import { describeInvocation, readTrace, shimScript, splitCommandLine, splitInvocation } from './lib/core-trace.mjs'
import { matchMarks, withoutMarks } from './lib/core-recipes/common.mjs'

/**
 * Record what a port's landing-page program does, call by call, on a tmux of
 * its own. The result is `site/src/data/core-recordings/<port>.json`, which
 * `components/core/CorePlayer.astro` plays.
 *
 * The program is the one the page displays (the quickstart in
 * `home-examples.json`, or a capability's program in `example-sources.json`),
 * built against a clean checkout of the port at the revision that source
 * records, and run twice in a sandbox with a tmux and a home of its own:
 *
 * 1. As displayed. This run shows that the program works and prints what the
 *    page says it prints, and gives the commands it sends. A recipe with a
 *    `setup` first starts the server that the page's own setup commands start.
 * 2. With a marker line after each call of the step map
 *    (`lib/core-recipes/<port>.mjs`). The marker runs `docs-mark`, which stores the
 *    value the call returned and the settled state of tmux; a `tmux` shim
 *    first on PATH stores each command the library sent with tmux's reply and
 *    the state after it (`lib/core-trace.mjs`).
 *
 * The recording is refused unless both runs sent the same commands, so the
 * markers did not change what the program does. The step map is hand-written
 * (see the recipe); everything a step holds besides its label and anchor was
 * read from tmux or returned by the call.
 *
 * A call that repeats (one in a loop) marks once per iteration, and each
 * iteration is a step of its own. A control client the program starts is traced
 * as it talks: its commands count as the step's commands, and what tmux sends
 * unasked is kept with the step it arrived in (`lib/core-trace.mjs`).
 *
 * Usage: node scripts/gen-core-recording.mjs --port go [--capability watch] [--check] [--debug <file>]
 * The capability is the quickstart, `typed-graph`, unless named.
 * `--keep` leaves the sandbox, and its traces, behind. `--check` records again and compares with the stored recording instead of
 * writing it; `--debug` writes the recording to <file> when it is refused.
 * The checkout comes from LIBTMUX_DOCS_CHECKOUT_<PORT> or the port's worktree,
 * and must be clean at the example's revision. The build is a heavy job.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => (flag(name) ? args[args.indexOf(name) + 1] : fallback)
const only = option('--port')
const capabilityId = option('--capability', 'typed-graph')
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const port = PORTS.find((entry) => entry.slug === only)
if (!port) throw new Error(`--port must be the slug of a port, not ${only}`)
const recipes = existsSync(join(root, `scripts/lib/core-recipes/${only}.mjs`)) ? (await import(`./lib/core-recipes/${only}.mjs`)).RECIPES : {}
const recipe = recipes[capabilityId]
if (!recipe) throw new Error(`${only} has no recipe for ${capabilityId}; its recipes are ${Object.keys(recipes).join(', ') || 'none'}`)
const program = recipe.source(root)
const checkout = recipe.checkout(port, process.env, expand)
if (!existsSync(checkout)) throw new Error(`${only}: no checkout at ${checkout}`)
const git = (...gitArgs) => execFileSync('git', ['-C', checkout, ...gitArgs], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`${only}: the checkout must be clean`)
if (git('rev-parse', 'HEAD') !== program.revision) throw new Error(`${only}: the checkout is at ${git('rev-parse', 'HEAD')}, the example at ${program.revision}; make a detached worktree of that revision and set LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`)

const ATTEMPTS = 6
const FIXED = { pid: '12345', uid: '1000', tmux: '/usr/bin/tmux' }
/** A string longer than this is shortened in the recording, and says so. */
const LONG = 400

const searchPath = (name) => process.env.PATH.split(delimiter).map((dir) => join(dir, name)).find((path) => existsSync(path))
const realTmux = searchPath('tmux')
if (!realTmux) throw new Error('tmux is not on PATH')

// The sandbox is short because a unix socket path is: tmux refuses a long one.
const sandbox = mkdtempSync('/tmp/libtmux-docs-')
const sandboxReal = realpathSync(sandbox)
const stopServers = () => stopSandboxServers(sandboxReal)
// A server that has been killed leaves its socket file, and a second socket would make the sandbox ambiguous (`readTmuxState`).
const resetServers = () => { stopServers(); rmSync(join(sandbox, `tmux-${process.getuid()}`), { recursive: true, force: true }) }
const read = readTmuxState({ sandbox: sandboxReal })

function prepare() {
  for (const name of ['home', 'config', 'bin', 'exact', 'marked']) mkdirSync(join(sandbox, name), { recursive: true })
  const entry = join(root, 'scripts/core-trace.mjs')
  writeFileSync(join(sandbox, 'bin/tmux'), shimScript({ node: process.execPath, entry }))
  writeFileSync(join(sandbox, 'bin/docs-mark'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} mark "$@"\n`)
  for (const name of ['tmux', 'docs-mark']) chmodSync(join(sandbox, 'bin', name), 0o755)
  const marked = recipe.instrument(program.code, recipe.steps)
  if (withoutMarks(marked) !== program.code) throw new Error('the instrumented program is not the displayed one with marker lines added')
  recipe.build({ sandbox, checkout, code: program.code, marked, helpers: recipe.helpers })
}

/** A run of one built program: its own trace, its own server, nothing of the reader's environment. */
async function run(dir) {
  resetServers()
  const trace = join(sandbox, `${dir}.trace`)
  writeFileSync(trace, '')
  const env = {
    PATH: `${join(sandbox, 'bin')}${delimiter}${process.env.PATH}`, TMUX_TMPDIR: sandbox, HOME: join(sandbox, 'home'), SHELL: '/bin/sh', ENV: '/dev/null', BASH_ENV: '/dev/null',
    XDG_CONFIG_HOME: join(sandbox, 'config'), XDG_CONFIG_DIRS: join(sandbox, 'config'), LANG: 'C.UTF-8', TERM: 'xterm-256color',
    LIBTMUX_DOCS_TRACE: trace, LIBTMUX_DOCS_REAL_TMUX: realTmux, LIBTMUX_DOCS_SANDBOX: sandboxReal, LIBTMUX_DOCS_MARK: join(sandbox, 'bin/docs-mark'),
    LIBTMUX_DOCS_PANE_COMMANDS: recipe.paneCommands.join(','), LIBTMUX_DOCS_PORT: only,
  }
  // A program whose displayed setup starts the server it connects to: the setup is not a call of the program, so it runs
  // before tmux is read for the state before the first call, and without the shim, so that no step is credited with it.
  if (recipe.setup) recipe.setup({ dir: join(sandbox, dir), env })
  const before = recipe.setup ? await settledState({ read, commands: recipe.paneCommands, port: only })() : recordedState(read())
  const [command, ...commandArgs] = recipe.command(join(sandbox, dir))
  const finished = spawnSync(command, commandArgs, { cwd: join(sandbox, dir), env, encoding: 'utf8', timeout: 120000 })
  const entries = readTrace(trace)
  const unsettled = entries.find((entry) => entry.unsettled)
  if (unsettled) throw new UnsettledPaneError(`${only}: ${unsettled.unsettled}`)
  if (finished.status !== 0) throw new Error(`${only}: the ${dir} program exited ${finished.status} (${finished.signal ?? 'no signal'}): ${finished.stderr}`)
  const broken = entries.find((entry) => entry.stateError)
  if (broken) throw new Error(`${only}: tmux could not be read after ${broken.argv.join(' ')}: ${broken.stateError}`)
  return { before, entries, stdout: finished.stdout, stderr: finished.stderr }
}

/**
 * The commands a run sent, in the order they were sent: a plain invocation, or
 * a command written to a control client. A control command's reply is looked
 * up by the client and the place of the command in what that client was sent,
 * so a reply that arrives after a mark still belongs to its command.
 */
function commandsOf(entries) {
  const replies = repliesOf(entries)
  return entries.flatMap((entry) => {
    if (entry.type === 'tmux') return [entry]
    if (entry.type !== 'send') return []
    const command = asCommand(entry, replies)
    return command.hidden ? [] : [command]
  })
}

const repliesOf = (entries) => new Map(entries.filter((entry) => entry.type === 'reply').map((entry) => [`${entry.client}:${entry.seq}`, entry]))

/** A command sent to a control client, in the form of a plain invocation, with tmux's replies to it: one for each command the line held. */
function asCommand(sent, replies) {
  const text = sent.line ?? sent.argv.join(' ')
  // A line that holds nothing but fenced commands (a library's own guard or end-of-reply marker) is not shown, whether or not tmux answered it before the client closed.
  const lone = splitInvocation(sent.argv ?? splitCommandLine(sent.line)).commands
  if (recipe.fence && lone.length > 0 && lone.every((command) => recipe.fence(recipe.unwrap?.(command) ?? command))) return { type: 'tmux', control: true, hidden: true }
  const answers = Array.from({ length: sent.count }, (_, offset) => replies.get(`${sent.client}:${sent.seq + offset}`))
  if (answers.length === 0 || answers.includes(undefined)) throw new Error(`${only}: tmux never answered the control command ${text}`)
  const broken = answers.find((reply) => reply.stateError)
  if (broken) throw new Error(`${only}: tmux could not be read after ${text}: ${broken.stateError}`)
  const argv = sent.argv ?? splitCommandLine(sent.line)
  // A command the recipe fences (the library's own guard) is not shown, so neither is its reply.
  const commands = splitInvocation(argv).commands
  const shown = commands.length === answers.length && recipe.fence ? answers.filter((_, index) => !recipe.fence(recipe.unwrap?.(commands[index]) ?? commands[index])) : answers
  return {
    type: 'tmux', control: true, at: sent.at, argv, ...(sent.line === undefined ? {} : { line: sent.line }),
    exit: Math.max(0, ...shown.map((reply) => reply.exit)), stdout: shown.map((reply) => reply.stdout).join(''), stderr: '', after: answers.at(-1).after,
  }
}

/**
 * The command names a run sent, in order, for comparing two runs. A command a
 * recipe lists in `polls` is one a wait repeats until its condition holds; how
 * often depends on how soon the output arrives, which a mark's delay changes,
 * so a run of them counts once. A wait that polls with several commands
 * (`display-message`, then `capture-pane`) counts once as well, and in no
 * particular order: the poll names between two commands that are not polls are
 * kept once each, sorted.
 */
const withoutRepeatedPolls = (names) => {
  const result = []
  let run = new Set()
  const flush = () => { result.push(...[...run].sort()); run = new Set() }
  for (const name of names) {
    if ((recipe.polls ?? []).some((poll) => name.endsWith(`:${poll}`))) { run.add(name); continue }
    flush()
    result.push(name)
  }
  flush()
  return result
}
const sequence = (entries) => withoutRepeatedPolls(commandsOf(entries)
  .map((entry) => { const d = describeInvocation(entry, recipe); return `${entry.control ? 'control:' : ''}${d.role}:${d.tmux.split(' ')[0]}` }))

/** What the program printed, as the page states it: a recipe says how the port's own test reads it. */
const normalized = (text) => recipe.normalizeOutput?.(text) ?? text

const short = (text) => (text.length > LONG ? `${text.slice(0, LONG)}…` : text)

/** The steps of the marked run: the commands between one mark and the next, and tmux at the mark. */
function stepsOf({ before, entries }) {
  const arrivals = matchMarks(entries.filter((entry) => entry.type === 'mark').map((entry) => entry.step), recipe.steps)
  const replies = repliesOf(entries)
  const steps = []
  let commands = []
  let notifications = []
  let earlier = before
  let mark = 0
  for (const entry of entries) {
    if (entry.type === 'tmux') { commands.push(entry); continue }
    if (entry.type === 'send') { const command = asCommand(entry, replies); if (!command.hidden) commands.push(command); continue }
    if (entry.type === 'notification') { notifications.push(entry.line); continue }
    if (entry.type !== 'mark') continue
    const { step, iteration } = arrivals[mark++]
    const final = entry.tmux
    // A window that existed during the call and is gone at its end: it came and went inside it.
    const known = new Set([...earlier.windows, ...final.windows].map((window) => window.id))
    const transient = []
    for (const window of commands.flatMap((command) => command.after?.windows ?? [])) if (!known.has(window.id)) { known.add(window.id); transient.push({ window: window.id, name: window.name }) }
    steps.push({
      id: step.repeat ? `${step.id}-${iteration}` : step.id, label: step.label, anchor: step.anchor, ...(step.occurrence ? { occurrence: step.occurrence } : {}), ...(step.repeat ? { iteration } : {}), type: step.type, returned: entry.value,
      commands: commands.map((command) => {
        const described = describeInvocation(command, recipe)
        // A probe's reply names the daemon's process and start time, which differ on every run, and says nothing a reader needs.
        if (described.role === 'probe') return { role: 'probe', tmux: described.tmux, mutates: false, exit: described.exit, stdout: '', stderr: '' }
        const cut = [described.tmux, described.stdout, described.stderr].some((text) => text.length > LONG)
        return { ...described, tmux: short(described.tmux), stdout: short(described.stdout), stderr: short(described.stderr), ...(cut ? { shortened: true } : {}) }
      }),
      ...(notifications.length ? { notifications: notifications.map(short) } : {}),
      transient, ...(step.stopsServer ? { stopsServer: true } : {}), tmux: final,
    })
    earlier = final
    commands = []
    notifications = []
  }
  if (commands.length) throw new Error(`${only}: ${commands.length} tmux command(s) ran after the last marked call; the step map does not cover them`)
  return steps
}

const out = join(root, 'site/src/data/core-recordings', `${only}.json`)
const stored = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined
let recording
try {
  prepare()
  const pinned = await recordSettled({
    attempts: ATTEMPTS,
    record: async () => {
      const exact = await run('exact')
      if (normalized(exact.stdout) !== program.expectedOutput) throw new Error(`${only}: the displayed program printed ${JSON.stringify(exact.stdout)}, the page says ${JSON.stringify(program.expectedOutput)}`)
      const marked = await run('marked')
      if (normalized(marked.stdout) !== normalized(exact.stdout)) throw new Error(`${only}: the marked program printed ${JSON.stringify(marked.stdout)}, the displayed one ${JSON.stringify(exact.stdout)}`)
      if (sequence(exact.entries).join() !== sequence(marked.entries).join()) throw new Error(`${only}: the marked program sent other commands than the displayed one:\n${sequence(exact.entries).join(' ')}\n${sequence(marked.entries).join(' ')}`)
      return { exact, marked, steps: stepsOf(marked) }
    },
    reset: resetServers,
    warn: (message) => console.warn(`gen-core-recording: ${message}`),
  })
  const server = (name, rest) => execFileSync(name, rest, { encoding: 'utf8' }).trim()
  const pid = /libtmux-quickstart-(\d+)/.exec(JSON.stringify(pinned.steps))?.[1]
  // A program that names its socket with a random token (`quickstart-<guid>`) says how to find it and what to call it.
  const named = recipe.socket ? new RegExp(recipe.socket.pattern).exec(JSON.stringify(pinned.steps))?.[0] : undefined
  const marks = {
    paths: [[join(sandboxReal, 'bin/tmux'), FIXED.tmux], [sandboxReal, '/tmp'], [`tmux-${process.getuid()}`, `tmux-${FIXED.uid}`], ...(pid ? [[`libtmux-quickstart-${pid}`, `libtmux-quickstart-${FIXED.pid}`]] : []), ...(named ? [[named, recipe.socket.fixed]] : [])],
    names: [hostname(), userInfo().username],
  }
  // The recording names one revision; a program recorded at another says its own.
  const revision = stored?.revision ?? program.revision
  const capability = sanitize({
    program: { file: recipe.file, sha256: sha256(program.code) },
    ...(program.revision === revision ? {} : { revision: program.revision }),
    stepMap: recipe.stepMap,
    printed: normalized(pinned.exact.stdout).split('\n').filter(Boolean),
    tmuxBefore: pinned.marked.before,
    steps: pinned.steps,
  }, marks)
  const problems = recordingProblems({ port: only, capabilities: { [recipe.capability]: capability } }, { programs: { [recipe.capability]: program.code } })
  if (problems.length && flag('--debug')) writeFileSync(args[args.indexOf('--debug') + 1], `${JSON.stringify(capability, null, 2)}\n`)
  if (problems.length) throw new Error(`${only}: the recording is not sound:\n${problems.join('\n')}`)
  recording = {
    generated: 'scripts/gen-core-recording.mjs', port: only, repo: stored?.repo ?? program.repository, revision,
    sandbox: { tmux: server(realTmux, ['-V']), ...recipe.toolchain(), shell: '/bin/sh', rewritten: { socket: recipe.socket?.fixed ?? `libtmux-quickstart-${FIXED.pid}`, tmuxExecutable: FIXED.tmux, tmpdir: '/tmp' } },
    capabilities: { ...stored?.capabilities, [recipe.capability]: capability },
  }
} finally {
  try { stopServers() } finally { if (flag('--keep')) console.error(`gen-core-recording: kept ${sandbox}`); else rmSync(sandbox, { recursive: true, force: true }) }
}

const found = hostLeaks(recording, { sandbox, sandboxReal, home: homedir(), checkout, user: userInfo().username, machine: hostname() })
if (found.length) throw new Error(`${only}: the recording names the host: ${found.join(', ')}`)
if (flag('--check')) {
  const stored = JSON.parse(readFileSync(out, 'utf8'))
  const same = (value) => JSON.stringify([value.capabilities[recipe.capability].revision ?? value.revision, value.capabilities[recipe.capability].program, value.capabilities[recipe.capability].steps.map((step) => [step.id, step.anchor, withoutRepeatedPolls(step.commands.map((command) => `${command.role}:${command.tmux.split(' ')[0]}`))])])
  if (same(stored) !== same(recording)) throw new Error(`${only}: the stored recording is stale`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`)
}
console.log(`gen-core-recording: ${only} ${recording.capabilities[recipe.capability].steps.length} steps at ${program.revision.slice(0, 9)}`)
