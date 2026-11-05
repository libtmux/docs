#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { recordingProblems, sha256 } from '../site/src/lib/core-recording.ts'
import { recordSettled } from './lib/mcp-session.mjs'
import { readTmuxState, recordedState, stopSandboxServers } from './lib/mcp-tmux-state.mjs'
import { hostLeaks, sanitize, UnsettledPaneError } from './lib/mcp-transcript-checks.mjs'
import { describeInvocation, readTrace } from './lib/core-trace.mjs'
import { RECIPES, withoutMarks } from './lib/core-recipes.mjs'

/**
 * Record what a port's landing-page program does, call by call, on a tmux of
 * its own. The result is `site/src/data/core-recordings/<port>.json`, which
 * `components/core/CorePlayer.astro` plays.
 *
 * The program is the one the page displays (`home-examples.json`), built
 * against a clean checkout of the port at the revision that example records,
 * and run twice in a sandbox with a tmux and a home of its own:
 *
 * 1. As displayed. This run shows that the program works and prints what the
 *    page says it prints, and gives the commands it sends.
 * 2. With a marker line after each call of the step map
 *    (`lib/core-recipes.mjs`). The marker runs `docs-mark`, which stores the
 *    value the call returned and the settled state of tmux; a `tmux` shim
 *    first on PATH stores each command the library sent with tmux's reply and
 *    the state after it (`lib/core-trace.mjs`).
 *
 * The recording is refused unless both runs sent the same commands, so the
 * markers did not change what the program does. The step map is hand-written
 * (see the recipe); everything a step holds besides its label and anchor was
 * read from tmux or returned by the call.
 *
 * Usage: node scripts/gen-core-recording.mjs --port go [--check] [--debug <file>]
 * `--check` records again and compares with the stored recording instead of
 * writing it; `--debug` writes the recording to <file> when it is refused.
 * The checkout comes from LIBTMUX_DOCS_CHECKOUT_<PORT> or the port's worktree,
 * and must be clean at the example's revision. The build is a heavy job.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const only = flag('--port') ? args[args.indexOf('--port') + 1] : undefined
const expand = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const recipe = RECIPES[only]
if (!recipe) throw new Error(`--port must be one of ${Object.keys(RECIPES).join(', ')}`)
const port = PORTS.find((entry) => entry.slug === only)
const home = JSON.parse(readFileSync(join(root, 'site/src/data/home-examples.json'), 'utf8'))[only]
const program = home.files.find((file) => file.name === recipe.file)
const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`] || port.worktree)
if (!existsSync(checkout)) throw new Error(`${only}: no checkout at ${checkout}`)
const git = (...gitArgs) => execFileSync('git', ['-C', checkout, ...gitArgs], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`${only}: the checkout must be clean`)
if (git('rev-parse', 'HEAD') !== home.sourceRevision) throw new Error(`${only}: the checkout is at ${git('rev-parse', 'HEAD')}, the example at ${home.sourceRevision}; make a detached worktree of that revision and set LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`)

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
  writeFileSync(join(sandbox, 'bin/tmux'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} shim "$@"\n`)
  writeFileSync(join(sandbox, 'bin/docs-mark'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entry)} mark "$@"\n`)
  for (const name of ['tmux', 'docs-mark']) chmodSync(join(sandbox, 'bin', name), 0o755)
  const goMod = `module example.com/libtmux-home\n\ngo 1.26.0\n\nrequire github.com/libtmux/libtmux-go v0.1.0\n\nreplace github.com/libtmux/libtmux-go => ${checkout}\n`
  const marked = recipe.instrument(program.code, recipe.steps)
  if (withoutMarks(marked) !== program.code) throw new Error('the instrumented program is not the displayed one with marker lines added')
  for (const [dir, source] of [['exact', program.code], ['marked', marked]]) {
    writeFileSync(join(sandbox, dir, 'go.mod'), goMod)
    writeFileSync(join(sandbox, dir, recipe.file), source)
  }
  writeFileSync(join(sandbox, 'marked', recipe.helper.file), recipe.helper.source)
  const build = { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOWORK: 'off' }
  for (const dir of ['exact', 'marked']) execFileSync('go', ['build', '-p', '2', '-o', join(sandbox, dir, 'program'), '.'], { cwd: join(sandbox, dir), env: build, stdio: 'inherit' })
}

/** A run of one built program: its own trace, its own server, nothing of the reader's environment. */
function run(dir) {
  resetServers()
  const trace = join(sandbox, `${dir}.trace`)
  writeFileSync(trace, '')
  const before = recordedState(read())
  const env = {
    PATH: `${join(sandbox, 'bin')}${delimiter}${process.env.PATH}`, TMUX_TMPDIR: sandbox, HOME: join(sandbox, 'home'), SHELL: '/bin/sh', ENV: '/dev/null', BASH_ENV: '/dev/null',
    XDG_CONFIG_HOME: join(sandbox, 'config'), XDG_CONFIG_DIRS: join(sandbox, 'config'), LANG: 'C.UTF-8', TERM: 'xterm-256color',
    LIBTMUX_DOCS_TRACE: trace, LIBTMUX_DOCS_REAL_TMUX: realTmux, LIBTMUX_DOCS_SANDBOX: sandboxReal, LIBTMUX_DOCS_MARK: join(sandbox, 'bin/docs-mark'),
    LIBTMUX_DOCS_PANE_COMMANDS: recipe.paneCommands.join(','), LIBTMUX_DOCS_PORT: only,
  }
  const finished = spawnSync(join(sandbox, dir, 'program'), [], { cwd: join(sandbox, dir), env, encoding: 'utf8', timeout: 120000 })
  const entries = readTrace(trace)
  const unsettled = entries.find((entry) => entry.unsettled)
  if (unsettled) throw new UnsettledPaneError(`${only}: ${unsettled.unsettled}`)
  if (finished.status !== 0) throw new Error(`${only}: the ${dir} program exited ${finished.status} (${finished.signal ?? 'no signal'}): ${finished.stderr}`)
  const broken = entries.find((entry) => entry.stateError)
  if (broken) throw new Error(`${only}: tmux could not be read after ${broken.argv.join(' ')}: ${broken.stateError}`)
  return { before, entries, stdout: finished.stdout, stderr: finished.stderr }
}

/** The command names a run sent, in order, for comparing two runs. */
const sequence = (entries) => entries.filter((entry) => entry.type === 'tmux').map((entry) => { const d = describeInvocation(entry, recipe); return `${d.role}:${d.tmux.split(' ')[0]}` })

const short = (text) => (text.length > LONG ? `${text.slice(0, LONG)}…` : text)

/** The steps of the marked run: the commands between one mark and the next, and tmux at the mark. */
function stepsOf({ before, entries }) {
  const marks = entries.filter((entry) => entry.type === 'mark').map((entry) => entry.step)
  const expected = recipe.steps.map((step) => step.id)
  if (marks.join() !== expected.join()) throw new Error(`${only}: the calls returned in the order ${marks.join(', ')}, the step map says ${expected.join(', ')}`)
  const steps = []
  let commands = []
  let earlier = before
  for (const entry of entries) {
    if (entry.type === 'tmux') { commands.push(entry); continue }
    const step = recipe.steps.find((candidate) => candidate.id === entry.step)
    const final = entry.tmux
    // A window that existed during the call and is gone at its end: it came and went inside it.
    const known = new Set([...earlier.windows, ...final.windows].map((window) => window.id))
    const transient = []
    for (const window of commands.flatMap((command) => command.after?.windows ?? [])) if (!known.has(window.id)) { known.add(window.id); transient.push({ window: window.id, name: window.name }) }
    steps.push({
      id: step.id, label: step.label, anchor: step.anchor, type: step.type, returned: entry.value,
      commands: commands.map((command) => {
        const described = describeInvocation(command, recipe)
        // A probe's reply names the daemon's process and start time, which differ on every run, and says nothing a reader needs.
        if (described.role === 'probe') return { role: 'probe', tmux: described.tmux, mutates: false, exit: described.exit, stdout: '', stderr: '' }
        const cut = [described.tmux, described.stdout, described.stderr].some((text) => text.length > LONG)
        return { ...described, tmux: short(described.tmux), stdout: short(described.stdout), stderr: short(described.stderr), ...(cut ? { shortened: true } : {}) }
      }),
      transient, tmux: final,
    })
    earlier = final
    commands = []
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
      const exact = run('exact')
      if (exact.stdout !== home.expectedOutput) throw new Error(`${only}: the displayed program printed ${JSON.stringify(exact.stdout)}, the page says ${JSON.stringify(home.expectedOutput)}`)
      const marked = run('marked')
      if (marked.stdout !== exact.stdout) throw new Error(`${only}: the marked program printed ${JSON.stringify(marked.stdout)}, the displayed one ${JSON.stringify(exact.stdout)}`)
      if (sequence(exact.entries).join() !== sequence(marked.entries).join()) throw new Error(`${only}: the marked program sent other commands than the displayed one:\n${sequence(exact.entries).join(' ')}\n${sequence(marked.entries).join(' ')}`)
      return { exact, marked, steps: stepsOf(marked) }
    },
    reset: resetServers,
    warn: (message) => console.warn(`gen-core-recording: ${message}`),
  })
  const server = (name, rest) => execFileSync(name, rest, { encoding: 'utf8' }).trim()
  const pid = /libtmux-quickstart-(\d+)/.exec(JSON.stringify(pinned.steps))?.[1]
  const marks = {
    paths: [[join(sandboxReal, 'bin/tmux'), FIXED.tmux], [sandboxReal, '/tmp'], [`tmux-${process.getuid()}`, `tmux-${FIXED.uid}`], ...(pid ? [[`libtmux-quickstart-${pid}`, `libtmux-quickstart-${FIXED.pid}`]] : [])],
    names: [hostname(), userInfo().username],
  }
  const capability = sanitize({
    program: { file: recipe.file, sha256: sha256(program.code) },
    stepMap: recipe.stepMap,
    printed: pinned.exact.stdout.split('\n').filter(Boolean),
    tmuxBefore: pinned.marked.before,
    steps: pinned.steps,
  }, marks)
  const problems = recordingProblems({ capabilities: { [recipe.capability]: capability } }, { programs: { [recipe.capability]: program.code } })
  if (problems.length && flag('--debug')) writeFileSync(args[args.indexOf('--debug') + 1], `${JSON.stringify(capability, null, 2)}\n`)
  if (problems.length) throw new Error(`${only}: the recording is not sound:\n${problems.join('\n')}`)
  recording = {
    generated: 'scripts/gen-core-recording.mjs', port: only, repo: home.sourceRepository, revision: home.sourceRevision,
    sandbox: { tmux: server(realTmux, ['-V']), go: server('go', ['version']).split(' ')[2], shell: '/bin/sh', rewritten: { socket: `libtmux-quickstart-${FIXED.pid}`, tmuxExecutable: FIXED.tmux, tmpdir: '/tmp' } },
    capabilities: { ...stored?.capabilities, [recipe.capability]: capability },
  }
} finally {
  try { stopServers() } finally { rmSync(sandbox, { recursive: true, force: true }) }
}

const found = hostLeaks(recording, { sandbox, sandboxReal, home: homedir(), checkout, user: userInfo().username, machine: hostname() })
if (found.length) throw new Error(`${only}: the recording names the host: ${found.join(', ')}`)
if (flag('--check')) {
  const stored = JSON.parse(readFileSync(out, 'utf8'))
  const same = (value) => JSON.stringify([value.revision, value.capabilities[recipe.capability].program, value.capabilities[recipe.capability].steps.map((step) => [step.id, step.anchor, step.commands.map((command) => command.role + command.tmux.split(' ')[0])])])
  if (same(stored) !== same(recording)) throw new Error(`${only}: the stored recording is stale`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`)
}
console.log(`gen-core-recording: ${only} ${recording.capabilities[recipe.capability].steps.length} steps at ${home.sourceRevision.slice(0, 9)}`)
