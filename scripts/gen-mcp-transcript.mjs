#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { EXAMPLES } from '../site/src/lib/mcp-examples.ts'
import { recordCalls } from './lib/mcp-session.mjs'

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
 * Usage: node scripts/gen-mcp-transcript.mjs --port ts|rs [--check]
 * The checkout comes from LIBTMUX_DOCS_CHECKOUT_<PORT> or the port's worktree.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const checking = process.argv.includes('--check')
const expand = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

// The servers this has been run for. A port joins by adding its command (and build) as gen-mcp-protocol.mjs has them.
const SERVERS = {
  ts: { command: ['bun', 'packages/mcp/src/server.ts'], prepare: [['bun', 'install', '--frozen-lockfile']] },
  rs: { command: ['target/debug/tmux-mcp'], prepare: [['cargo', 'build', '--locked', '-p', 'tmux-mcp', '--bin', 'tmux-mcp', '--jobs', '2']] },
}
const TOOLSETS = { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' }
// What the last run step must have printed: the project below has two passing tests.
const EXPECTED_OUTPUT = '2 passed'
const TEST_FILE = 'def test_adds():\n    assert 1 + 1 == 2\n\n\ndef test_upper():\n    assert "tmux".upper() == "TMUX"\n'

if (!only || !SERVERS[only]) throw new Error(`--port must be one of ${Object.keys(SERVERS).join(', ')}`)
const port = PORTS.find((entry) => entry.slug === only)
const example = EXAMPLES[only]
const checkout = expand(process.env[`LIBTMUX_DOCS_CHECKOUT_${only.toUpperCase()}`] || port.worktree)
if (!existsSync(checkout)) throw new Error(`${only}: no checkout at ${checkout}`)
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error(`${only}: the checkout must be clean`)
const revision = git('rev-parse', 'HEAD')
const snapshot = JSON.parse(readFileSync(join(root, 'site/src/data/mcp-protocol', `${only}.json`), 'utf8'))
if (snapshot.revision !== revision) throw new Error(`${only}: checkout is at ${revision}, the protocol snapshot at ${snapshot.revision}`)

// A tmux and a home of its own: nothing here may reach the reader's server, socket or shell setup.
const sandbox = mkdtempSync(join(tmpdir(), `t239-${only}-`))
const project = join(sandbox, 'project')
let transcript
try {
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'test_example.py'), TEST_FILE)
  execFileSync('uv', ['venv', '-q', join(sandbox, 'venv')], { stdio: 'inherit' })
  execFileSync('uv', ['pip', 'install', '-q', '--python', join(sandbox, 'venv/bin/python'), 'pytest'], { stdio: 'inherit' })
  const pytest = execFileSync(join(sandbox, 'venv/bin/pytest'), ['--version'], { encoding: 'utf8' }).trim()
  for (const [command, ...args] of SERVERS[only].prepare) execFileSync(command, args, { cwd: checkout, stdio: 'inherit' })
  const [command, ...args] = SERVERS[only].command
  const environment = {
    TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: sandbox, HOME: join(sandbox, 'home'), SHELL: '/bin/sh',
    PATH: `${join(sandbox, 'venv/bin')}:${process.env.PATH}`, PS1: '$ ', ENV: '', LIBTMUX_SOCKET: 'transcript',
    ...TOOLSETS,
  }
  mkdirSync(environment.HOME)
  const run = await recordCalls({
    command: command.includes('/') ? join(checkout, command) : command, args: args.map((arg) => (arg.includes('/') && !arg.startsWith('-') ? join(checkout, arg) : arg)),
    cwd: project, env: environment, calls: example.steps.map(({ tool, arguments: callArguments }) => ({ tool, arguments: callArguments })),
  })

  // Every step must have worked, and every id a request names must have come back in an earlier result.
  const results = []
  run.steps.forEach((step, index) => {
    const text = JSON.stringify([step.content, step.structuredContent ?? null])
    if (step.isError) throw new Error(`${only}: ${step.tool} returned an error: ${text.slice(0, 400)}`)
    for (const id of JSON.stringify(step.arguments).match(/[$%@]\d+/g) ?? []) {
      if (!results.slice(0, index).some((earlier) => earlier.includes(id))) throw new Error(`${only}: ${step.tool} names ${id}, which no earlier result returned`)
    }
    results.push(text)
  })
  const run$ = run.steps.findIndex((step) => /run|command/.test(step.tool))
  if (run$ === -1 || !results[run$].includes(EXPECTED_OUTPUT)) throw new Error(`${only}: the run step's result lacks "${EXPECTED_OUTPUT}": ${results[run$]?.slice(0, 400)}`)

  // The project directory is a fresh temporary one each run; a fixed name keeps the file stable.
  const FIXED = '/home/user/project'
  const rewrite = (value) => typeof value === 'string' ? value.replaceAll(project, FIXED)
    : Array.isArray(value) ? value.map(rewrite)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value
  run.steps = run.steps.map(rewrite)
  transcript = {
    generated: 'scripts/gen-mcp-transcript.mjs',
    repo: snapshot.repo, revision,
    sandbox: { tmux: execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim(), pytest, project: ['test_example.py'], expected: EXPECTED_OUTPUT, rewritten: { projectDirectory: FIXED } },
    serverInfo: run.serverInfo,
    prompt: example.prompt,
    steps: run.steps.map((step, index) => ({ ...step, caption: example.steps[index].caption })),
  }
} finally {
  try {
    const socket = join(sandbox, `tmux-${process.getuid?.() ?? ''}`)
    if (existsSync(socket)) for (const name of ['default', 'transcript']) if (existsSync(join(socket, name))) try { execFileSync('tmux', ['-S', join(socket, name), 'kill-server'], { stdio: 'ignore' }) } catch { /* no server left on that socket */ }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}
const out = join(root, 'site/src/data/mcp-transcripts', `${only}.json`)
const text = `${JSON.stringify(transcript, null, 2)}\n`
if (checking) {
  const stored = JSON.parse(readFileSync(out, 'utf8'))
  if (stored.revision !== transcript.revision || JSON.stringify(stored.steps.map((s) => [s.tool, s.arguments])) !== JSON.stringify(transcript.steps.map((s) => [s.tool, s.arguments]))) throw new Error(`${only}: transcript is stale`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
}
console.log(`gen-mcp-transcript: ${only} ${transcript.steps.length} steps at ${revision.slice(0, 9)}`)
