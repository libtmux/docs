#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { EXAMPLES, STALE_TARGET } from '../site/src/lib/mcp-examples.ts'
import { hasState, recordingStateProblems } from '../site/src/lib/mcp-tmux-state.ts'
import { contractsOf, sameContracts } from '../site/src/lib/mcp-contract.ts'
import { listedBy, listedValue, recordCalls, recordSettled, requireRefusal, standInCalls, standInControls } from './lib/mcp-session.mjs'
import { readTmuxState, settledState, stopSandboxServers } from './lib/mcp-tmux-state.mjs'
import { hostLeaks, sanitize, verifyRecording } from './lib/mcp-transcript-checks.mjs'

/**
 * Record what each port's MCP server answers to the worked example on the MCP
 * pages: its own EXAMPLES calls, replayed against the server it built, on a
 * tmux of its own. The result is `site/src/data/mcp-transcripts/<port>.json`.
 *
 * Like gen-mcp-protocol.mjs this runs against a clean checkout of the port at
 * the revision its protocol snapshot records, and refuses to write otherwise.
 * It fails on a tool error, a server that does not exit 0, a request whose id
 * no earlier result returned, or an expected value that is missing.
 *
 * A result states only what a tool returns: Go's `split_window` returns the new
 * pane's id and nothing of the layout. So before the first call and after each
 * one, the recorder reads the tmux server of its own sandbox, on that
 * sandbox's socket and never on the reader's or the default one, and stores
 * its sessions, its windows with the layout tmux reports and its panes with
 * their command and rectangle: `tmuxBefore` for the start and `tmux` on each
 * step. The page draws that state. A state that cannot be read fails the
 * recording, and so does one that does not follow from its call.
 *
 * A server that describes a pane the moment it splits it can catch the pane
 * before its shell has started: tmux then names the child `tmux` and reports
 * no path. A state read before tmux has renamed a window for its pane's
 * program is unsettled too, and so is one that never stops changing. Such an
 * answer is never written. Whether the settle check times out while the calls
 * run or the answers fail the check afterwards, the recorder stops the tmux
 * servers of its own sandbox, starts the borrowed session again when the
 * server borrows one, and records again, up to ATTEMPTS times in all.
 *
 * The transcript also stores the input and output schemas of each tool it
 * calls, from that snapshot. A page documenting another revision shows the
 * recording only while the tools still have those schemas and the tools a
 * result lists are the ones advertised, so the recording does not have to be
 * redone for every commit of the port. The values may still differ.
 *
 * Usage: node scripts/gen-mcp-transcript.mjs --port <port> [--check]
 * The checkout comes from LIBTMUX_DOCS_CHECKOUT_<PORT> or the port's worktree.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const checking = process.argv.includes('--check')
const expand = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

// How to build and start each port's server from its checkout, as gen-mcp-protocol.mjs does. `cwd` is below the checkout, `build` runs there,
// and `command` gets the checkout and the sandbox (a binary may be built into the latter).
const SERVERS = {
  ts: { prepare: [['bun', 'install', '--frozen-lockfile']], command: () => ['bun', 'packages/mcp/src/server.ts'] },
  rs: { prepare: [['cargo', 'build', '--locked', '-p', 'tmux-mcp', '--bin', 'tmux-mcp', '--jobs', '2']], command: () => ['target/debug/tmux-mcp'] },
  py: { prepare: [['uv', 'sync', '--frozen', '--python', '3.14']], command: () => ['.venv/bin/python', '-m', 'libtmux_mcp'] },
  java: { prepare: [['./gradlew', ':libtmux-mcp:installDist', '--max-workers=2']], command: () => ['libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp'] },
  csharp: { prepare: [['dotnet', 'build', 'src/LibTmux.Mcp/LibTmux.Mcp.csproj', '--configuration', 'Release', '-m:2']], command: () => ['dotnet', 'src/LibTmux.Mcp/bin/Release/net10.0/LibTmux.Mcp.dll'] },
  cxx: {
    prepare: [
      // The repository's gcc preset: this host's clang cannot link the libc++ the default one asks for (no libunwind).
      ['cmake', '--preset', 'cxx-gcc', '-DLIBTMUX_BUILD_TESTS=OFF', '-DLIBTMUX_BUILD_EXAMPLES=OFF', '-DLIBTMUX_BUILD_WORKSPACE_CLI=OFF'],
      ['cmake', '--build', '--preset', 'cxx-gcc', '--target', 'libtmux-mcp-server', '--parallel', '2'],
    ],
    command: () => ['build/cxx-gcc/apps/mcp/libtmux-mcp-server', '--socket-name', 'transcript'],
  },
  // On a host without libxml2.so.2 (Debian's current libxml2 is .16), swift-build does not start; a directory holding a libxml2.so.2 link to it, on LD_LIBRARY_PATH, lets the toolchain run. The server it builds does not use it.
  swift: { prepare: [['swift', 'build', '--force-resolved-versions', '--product', 'libtmux-mcp', '--jobs', '2']], command: () => ['.build/debug/libtmux-mcp'] },
  // This server borrows a tmux that is already running, so the recorder starts one on the sandbox's own tmpdir first.
  ruby: {
    borrowed: 'transcript',
    // `bundle exec` needs the Gemfile, found through the checkout. The server runs in the project directory: a session or pane it creates without a `cwd` starts there, where pytest and checks.log are.
    env: (checkout) => ({ BUNDLE_GEMFILE: join(checkout, 'Gemfile') }),
    prepare: [['bundle', 'install']],
    command: () => ['bundle', 'exec', 'libtmux-mcp', '--socket-name', 'transcript', '--endpoint', 'docs', '--timeout', '30', ...['tmux_capture', 'tmux_wait', 'tmux_create', 'tmux_send', 'tmux_close', 'tmux_run'].flatMap((tool) => ['--enable-tool', tool])],
  },
  go: { cwd: 'mcp', prepare: [], build: (sandbox) => [['go', 'build', '-mod=readonly', '-o', join(sandbox, 'libtmux-mcp'), './cmd/libtmux-mcp']], command: (_checkout, sandbox) => [join(sandbox, 'libtmux-mcp')] },
  // The documented install: both packages from the checkout into an environment, and the launcher `install_cli` writes for it. This server borrows a tmux that is already running, and the pane it reads shows the log.
  julia: {
    borrowed: 'transcript',
    pane: ['cat', 'checks.log', '-'],
    prepare: [],
    build: (sandbox, checkout) => [['julia', '--startup-file=no', '-e', 'using Pkg; Pkg.activate(ARGS[1]); Pkg.develop([Pkg.PackageSpec(path=ARGS[2]), Pkg.PackageSpec(path=joinpath(ARGS[2], "packages", "LibTmuxMCP"))]); Pkg.instantiate(); Pkg.precompile(); using LibTmuxMCP; install_cli(ARGS[3])', join(sandbox, 'julia-env'), checkout, join(sandbox, 'bin')]],
    // The sandbox's HOME holds no packages: the server reads the depot the build filled.
    env: () => ({ JULIA_DEPOT_PATH: process.env.JULIA_DEPOT_PATH || join(homedir(), '.julia') }),
    // Every tool the snapshot lists is enabled, and creation is allowed, as the example creates and removes a session.
    command: (_checkout, sandbox) => [join(sandbox, 'bin/libtmux-mcp'), '--socket-name', 'transcript', '--allow-create', ...JULIA_TOOLS.flatMap((tool) => ['--tool', tool])],
  },
}
const JULIA_TOOLS = ['capture_pane', 'create_session', 'kill_pane', 'list_panes', 'paste_text', 'resize_pane', 'run_operations', 'send_keys', 'send_keys_and_wait', 'teardown_session', 'wait_for_text']
const TOOLSETS = { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' }
// What each run step must have printed, in order: the project below has two passing tests and a log of two lines.
const EXPECTED_OUTPUT = ['2 passed', 'checks finished']
// Without a command to run, the last answer must still state this (a value the example's prompt asks about).
const PRESENT = {}
// What a pane runs once its shell has started: the sandbox pins SHELL, the borrowed Ruby and Julia sessions run cat, and Ruby's example creates panes that run sh.
const PANE_COMMANDS = { ruby: ['cat', 'sh'], julia: ['cat', 'sh'] }
// A server that describes a pane the moment it is split can catch it before its shell has started; the answer is recorded again.
const ATTEMPTS = 6
// A Julia or Ruby target carries `generation`, the tmux server's process id and start time. list_panes returns it, capture_pane must send it back, and no two runs share one: the call goes out with the listed value and the recording keeps the example's stand-in. A control call with the stand-in must be refused, and the recording states how.
const GENERATION = { ruby: '3f9a1c', julia: '3f9a1c' }
const LOG_FILE = '2026-01-01 checks started\n2026-01-01 checks finished\n'
const TEST_FILE = 'def test_adds():\n    assert 1 + 1 == 2\n\n\ndef test_upper():\n    assert "tmux".upper() == "TMUX"\n'

if (!only || !SERVERS[only]) throw new Error(`--port must be one of ${Object.keys(SERVERS).join(', ')}`)
const port = PORTS.find((entry) => entry.slug === only)
const example = EXAMPLES[only]
const standIn = GENERATION[only]
const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`] || (only === 'py' ? '~/work/python/libtmux-mcp' : port.worktree))
if (!existsSync(checkout)) throw new Error(`${only}: no checkout at ${checkout}`)
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`${only}: the checkout must be clean`)
const revision = git('rev-parse', 'HEAD')
const snapshot = JSON.parse(readFileSync(join(root, 'site/src/data/mcp-protocol', `${only}.json`), 'utf8'))
if (snapshot.revision !== revision) throw new Error(`${only}: checkout is at ${revision}, the protocol snapshot at ${snapshot.revision}`)
const contracts = contractsOf(snapshot.protocol.tools, example.steps.map((step) => step.tool))

// A tmux and a home of its own: nothing here may reach the reader's server, socket or shell setup.
const sandbox = mkdtempSync(join(tmpdir(), `t239-${only}-`))
const sandboxReal = realpathSync(sandbox)
const project = join(sandbox, 'project')
let transcript
let listed
// Every tmux server the sandbox started; the sandbox is the only place they can be, and a socket that resolves outside it is not stopped.
const stopServers = () => stopSandboxServers(sandboxReal)
try {
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'test_example.py'), TEST_FILE)
  writeFileSync(join(project, 'checks.log'), LOG_FILE)
  execFileSync('uv', ['venv', '-q', join(sandbox, 'venv')], { stdio: 'inherit' })
  execFileSync('uv', ['pip', 'install', '-q', '--python', join(sandbox, 'venv/bin/python'), 'pytest'], { stdio: 'inherit' })
  const pytest = execFileSync(join(sandbox, 'venv/bin/pytest'), ['--version'], { encoding: 'utf8' }).trim()
  const server = SERVERS[only]
  const workdir = server.cwd ? join(checkout, server.cwd) : checkout
  for (const [command, ...args] of [...server.prepare, ...(server.build?.(sandbox, checkout) ?? [])]) execFileSync(command, args, { cwd: workdir, stdio: 'inherit' })
  const [command, ...args] = server.command(checkout, sandbox)
  // The tmux server inherits this PATH, so a pane it starts finds the sandbox's pytest.
  // A borrowed session names its window when it is created: tmux names it `tmux` until it renames it for the program a moment after that starts.
  const pane = server.pane ?? ['/bin/cat']
  const startBorrowed = () => {
    if (server.borrowed) execFileSync('tmux', ['-L', server.borrowed, '-f', '/dev/null', 'new-session', '-d', '-s', 'docs', '-n', basename(pane[0]), ...pane], { cwd: project, env: { ...process.env, TMUX: '', TMUX_TMPDIR: sandbox, PATH: `${join(sandbox, 'venv/bin')}:${process.env.PATH}` }, stdio: 'inherit' })
  }
  const environment = {
    TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: sandbox, HOME: join(sandbox, 'home'), SHELL: '/bin/sh',
    // No user tmux configuration, whichever way tmux looks for it.
    XDG_CONFIG_HOME: join(sandbox, 'config'), XDG_CONFIG_DIRS: join(sandbox, 'config'),
    PATH: `${join(sandbox, 'venv/bin')}:${process.env.PATH}`, PS1: '$ ', ENV: '', LIBTMUX_SOCKET: 'transcript',
    ...TOOLSETS, ...server.env?.(checkout),
  }
  mkdirSync(environment.HOME)
  // The tool that runs commands is the one whose requests carry a `command`; a name is not trusted to say so.
  const runTool = [...new Set(example.steps.filter((step) => typeof step.arguments.command === 'string').map((step) => step.tool))]
  if (runTool.length > 1) throw new Error(`${only}: the example must run commands through one run_ tool, found ${runTool.join(', ')}`)
  const run = await recordSettled({
    attempts: ATTEMPTS,
    record: () => {
      startBorrowed()
      return recordCalls({
        command: command.startsWith('/') || !command.includes('/') ? command : join(checkout, command), args: args.map((arg) => (arg.includes('/') && !arg.startsWith('-') ? join(checkout, arg) : arg)),
        cwd: project, env: environment, calls: standInCalls(example.steps, standIn, 'generation'), controls: standInControls(example.steps, standIn),
        observe: settledState({ read: readTmuxState({ sandbox: sandboxReal }), commands: PANE_COMMANDS[only] ?? ['sh'], port: only }),
      })
    },
    check: (recorded) => {
      try {
        verifyRecording(recorded.steps, { port: only, runTool: runTool[0] ?? '', expected: runTool.length ? EXPECTED_OUTPUT : [], present: PRESENT[only] ?? [], commands: PANE_COMMANDS[only] ?? ['sh'], before: recorded.before, states: true })
      } catch (error) {
        // The raw answers, for whoever is adding a port: nothing is written.
        if (process.argv.includes('--debug')) console.error(JSON.stringify(recorded.steps, null, 1))
        throw error
      }
    },
    reset: stopServers,
    warn: (message) => console.warn(`gen-mcp-transcript: ${message}`),
  })

  // The project directory is a fresh temporary one each run; a fixed name keeps the file stable.
  const FIXED = '/home/user/project'
  // tmux titles a new pane with the host name, and a server may report the user's: as a token, anywhere in a string or in JSON inside one, each becomes "host".
  listed = standIn && listedValue(run.steps, 'generation')
  // The stand-in is only a token for the page if the server refuses it: a real call has to send the listed value.
  const refusedAs = standIn ? requireRefusal(run.controls[0], { port: only, standIn, expected: STALE_TARGET, listedBy: listedBy(run.steps, 'generation') }) : undefined
  const marks = { paths: [[join(sandboxReal, 'project'), FIXED], [project, FIXED], ...(listed ? [[listed, standIn]] : [])], names: [hostname(), userInfo().username] }
  run.steps = run.steps.map((step) => sanitize(step, marks))
  run.before = sanitize(run.before, marks)
  transcript = {
    generated: 'scripts/gen-mcp-transcript.mjs',
    repo: snapshot.repo, revision,
    sandbox: { tmux: execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim(), pytest, project: ['test_example.py', 'checks.log'], expected: EXPECTED_OUTPUT, rewritten: { projectDirectory: FIXED, ...(standIn ? { generation: standIn, generationListedBy: listedBy(run.steps, 'generation'), generationRefusedAs: refusedAs } : {}) } },
    serverInfo: run.serverInfo,
    contracts,
    prompt: example.prompt,
    tmuxBefore: run.before,
    steps: run.steps.map((step, index) => ({ ...step, caption: example.steps[index].caption })),
  }
} finally {
  try {
    stopServers()
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}
const out = join(root, 'site/src/data/mcp-transcripts', `${only}.json`)
const text = `${JSON.stringify(transcript, null, 2)}\n`
const found = hostLeaks(transcript, { sandbox, sandboxReal, home: homedir(), checkout, listed, user: userInfo().username, machine: hostname() })
if (found.length) throw new Error(`${only}: the recording names the host: ${found.join(', ')}`)
if (checking) {
  const stored = JSON.parse(readFileSync(out, 'utf8'))
  const unstated = hasState(stored) ? recordingStateProblems(stored) : ['no tmux state is recorded']
  if (unstated.length) throw new Error(`${only}: ${unstated.join('; ')}`)
  if (stored.revision !== transcript.revision || !sameContracts(stored.contracts, transcript.contracts) || JSON.stringify(stored.steps.map((s) => [s.tool, s.arguments])) !== JSON.stringify(transcript.steps.map((s) => [s.tool, s.arguments]))) throw new Error(`${only}: transcript is stale`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
}
console.log(`gen-mcp-transcript: ${only} ${transcript.steps.length} steps at ${revision.slice(0, 9)}`)
