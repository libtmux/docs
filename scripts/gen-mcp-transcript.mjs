#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { EXAMPLES } from '../site/src/lib/mcp-examples.ts'
import { recordCalls } from './lib/mcp-session.mjs'
import { leaks, verifyRecording } from './lib/mcp-transcript-checks.mjs'

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
    // `bundle exec` needs the Gemfile; the session it borrows was started in the project directory.
    inCheckout: true,
    prepare: [['bundle', 'install']],
    command: () => ['bundle', 'exec', 'libtmux-mcp', '--socket-name', 'transcript', '--endpoint', 'docs', ...['tmux_capture', 'tmux_wait', 'tmux_create', 'tmux_send', 'tmux_close', 'tmux_run'].flatMap((tool) => ['--enable-tool', tool])],
  },
  go: { cwd: 'mcp', prepare: [], build: (sandbox) => [['go', 'build', '-mod=readonly', '-o', join(sandbox, 'libtmux-mcp'), './cmd/libtmux-mcp']], command: (_checkout, sandbox) => [join(sandbox, 'libtmux-mcp')] },
}
const TOOLSETS = { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' }
// What each run step must have printed, in order: the project below has two passing tests and a log of two lines.
const EXPECTED_OUTPUT = ['2 passed', 'checks finished']
// Without a command to run, the last answer must still state this (a value the example's prompt asks about).
const PRESENT = { ruby: ['%0'] }
const LOG_FILE = '2026-01-01 checks started\n2026-01-01 checks finished\n'
const TEST_FILE = 'def test_adds():\n    assert 1 + 1 == 2\n\n\ndef test_upper():\n    assert "tmux".upper() == "TMUX"\n'

if (!only || !SERVERS[only]) throw new Error(`--port must be one of ${Object.keys(SERVERS).join(', ')}`)
const port = PORTS.find((entry) => entry.slug === only)
const example = EXAMPLES[only]
const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`] || (only === 'py' ? '~/work/python/libtmux-mcp' : port.worktree))
if (!existsSync(checkout)) throw new Error(`${only}: no checkout at ${checkout}`)
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`${only}: the checkout must be clean`)
const revision = git('rev-parse', 'HEAD')
const snapshot = JSON.parse(readFileSync(join(root, 'site/src/data/mcp-protocol', `${only}.json`), 'utf8'))
if (snapshot.revision !== revision) throw new Error(`${only}: checkout is at ${revision}, the protocol snapshot at ${snapshot.revision}`)

// A tmux and a home of its own: nothing here may reach the reader's server, socket or shell setup.
const sandbox = mkdtempSync(join(tmpdir(), `t239-${only}-`))
const sandboxReal = realpathSync(sandbox)
const project = join(sandbox, 'project')
let transcript
try {
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'test_example.py'), TEST_FILE)
  writeFileSync(join(project, 'checks.log'), LOG_FILE)
  execFileSync('uv', ['venv', '-q', join(sandbox, 'venv')], { stdio: 'inherit' })
  execFileSync('uv', ['pip', 'install', '-q', '--python', join(sandbox, 'venv/bin/python'), 'pytest'], { stdio: 'inherit' })
  const pytest = execFileSync(join(sandbox, 'venv/bin/pytest'), ['--version'], { encoding: 'utf8' }).trim()
  const server = SERVERS[only]
  const workdir = server.cwd ? join(checkout, server.cwd) : checkout
  for (const [command, ...args] of [...server.prepare, ...(server.build?.(sandbox) ?? [])]) execFileSync(command, args, { cwd: workdir, stdio: 'inherit' })
  const [command, ...args] = server.command(checkout, sandbox)
  if (server.borrowed) {
    execFileSync('tmux', ['-L', server.borrowed, '-f', '/dev/null', 'new-session', '-d', '-s', 'docs', '/bin/cat'], { cwd: project, env: { ...process.env, TMUX: '', TMUX_TMPDIR: sandbox }, stdio: 'inherit' })
  }
  const environment = {
    TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: sandbox, HOME: join(sandbox, 'home'), SHELL: '/bin/sh',
    // No user tmux configuration, whichever way tmux looks for it.
    XDG_CONFIG_HOME: join(sandbox, 'config'), XDG_CONFIG_DIRS: join(sandbox, 'config'),
    PATH: `${join(sandbox, 'venv/bin')}:${process.env.PATH}`, PS1: '$ ', ENV: '', LIBTMUX_SOCKET: 'transcript',
    ...TOOLSETS,
  }
  mkdirSync(environment.HOME)
  const run = await recordCalls({
    command: command.startsWith('/') || !command.includes('/') ? command : join(checkout, command), args: args.map((arg) => (arg.includes('/') && !arg.startsWith('-') ? join(checkout, arg) : arg)),
    cwd: server.inCheckout ? workdir : project, env: environment, calls: example.steps.map(({ tool, arguments: callArguments }) => ({ tool, arguments: callArguments })),
  })

  // The tool that runs commands is the one whose requests carry a `command`; a name is not trusted to say so.
  const runTool = [...new Set(example.steps.filter((step) => typeof step.arguments.command === 'string').map((step) => step.tool))]
  if (runTool.length > 1) throw new Error(`${only}: the example must run commands through one run_ tool, found ${runTool.join(', ')}`)
  try {
    verifyRecording(run.steps, { port: only, runTool: runTool[0] ?? '', expected: runTool.length ? EXPECTED_OUTPUT : [], present: PRESENT[only] ?? [] })
  } catch (error) {
    // The raw answers, for whoever is adding a port: nothing is written.
    if (process.argv.includes('--debug')) console.error(JSON.stringify(run.steps, null, 1))
    throw error
  }

  // The project directory is a fresh temporary one each run; a fixed name keeps the file stable.
  const FIXED = '/home/user/project'
  // tmux titles a new pane with the host name, and a server may report the user's; as whole values they become "host".
  const rewrite = (value) => typeof value === 'string' && (value === hostname() || value === userInfo().username) ? 'host' : typeof value === 'string' ? value.replaceAll(join(sandboxReal, 'project'), FIXED).replaceAll(project, FIXED)
    : Array.isArray(value) ? value.map(rewrite)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value
  run.steps = run.steps.map(rewrite)
  transcript = {
    generated: 'scripts/gen-mcp-transcript.mjs',
    repo: snapshot.repo, revision,
    sandbox: { tmux: execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim(), pytest, project: ['test_example.py', 'checks.log'], expected: EXPECTED_OUTPUT, rewritten: { projectDirectory: FIXED } },
    serverInfo: run.serverInfo,
    prompt: example.prompt,
    steps: run.steps.map((step, index) => ({ ...step, caption: example.steps[index].caption })),
  }
} finally {
  try {
    const socket = join(sandbox, `tmux-${process.getuid?.() ?? ''}`)
    if (existsSync(socket)) for (const name of readdirSync(socket)) try { execFileSync('tmux', ['-S', join(socket, name), 'kill-server'], { stdio: 'ignore' }) } catch { /* no server left on that socket */ }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}
const out = join(root, 'site/src/data/mcp-transcripts', `${only}.json`)
const text = `${JSON.stringify(transcript, null, 2)}\n`
const found = leaks(text, [sandbox, sandboxReal, homedir(), userInfo().username, hostname(), checkout])
if (found.length) throw new Error(`${only}: the recording names the host: ${found.join(', ')}`)
if (checking) {
  const stored = JSON.parse(readFileSync(out, 'utf8'))
  if (stored.revision !== transcript.revision || JSON.stringify(stored.steps.map((s) => [s.tool, s.arguments])) !== JSON.stringify(transcript.steps.map((s) => [s.tool, s.arguments]))) throw new Error(`${only}: transcript is stale`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
}
console.log(`gen-mcp-transcript: ${only} ${transcript.steps.length} steps at ${revision.slice(0, 9)}`)
