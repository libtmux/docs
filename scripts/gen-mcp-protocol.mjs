#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS, productAvailable } from '../site/src/lib/ports.ts'
import { captureProtocol } from './lib/mcp-protocol.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
const only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const checking = process.argv.includes('--check')
const sourceBound = process.argv.includes('--source-bound')
if (only && !PORTS.some((port) => port.slug === only)) throw new Error(`Unknown MCP port: ${only}`)
if (sourceBound && (!only || process.env.LIBTMUX_DOCS_PORT !== only || !/^[0-9a-f]{40}$/.test(process.env.LIBTMUX_DOCS_SOURCE_SHA ?? ''))) {
  throw new Error('source-bound MCP discovery requires --port, matching LIBTMUX_DOCS_PORT and LIBTMUX_DOCS_SOURCE_SHA')
}
const checkoutFor = (port) => expand(port.slug === 'py'
  ? process.env.LIBTMUX_DOCS_MCP_PY || '~/work/python/libtmux-mcp'
  : process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.worktree)
const commands = {
  py: ['.venv/bin/python', '-m', 'libtmux_mcp'],
  ruby: [
    'bundle', 'exec', 'libtmux-mcp',
    '--socket-name', 'libtmux-docs-protocol',
    '--endpoint', 'docs',
    '--enable-tool', 'tmux_capture',
    '--enable-tool', 'tmux_wait',
    '--enable-tool', 'tmux_create',
    '--enable-tool', 'tmux_send',
    '--enable-tool', 'tmux_close',
    '--enable-tool', 'tmux_run',
  ],
  ts: ['bun', 'packages/mcp/src/server.ts'],
  rs: ['target/debug/tmux-mcp'],
  java: ['libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp'],
  csharp: ['dotnet', 'src/LibTmux.Mcp/bin/Release/net10.0/LibTmux.Mcp.dll'],
  cxx: ['build/cxx-dev/apps/mcp/libtmux-mcp-server', '--socket-name', 'libtmux-docs-protocol'],
  swift: ['.build/debug/libtmux-mcp'],
}
const builds = {
  rs: [['cargo', 'build', '--locked', '-p', 'tmux-mcp', '--bin', 'tmux-mcp', '--jobs', '2']],
  java: [['./gradlew', ':libtmux-mcp:installDist', '--max-workers=2']],
  csharp: [['dotnet', 'build', 'src/LibTmux.Mcp/LibTmux.Mcp.csproj', '--configuration', 'Release', '-m:2']],
  cxx: [
    ['cmake', '--preset', 'cxx-dev', '-DLIBTMUX_BUILD_TESTS=OFF', '-DLIBTMUX_BUILD_EXAMPLES=OFF'],
    ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux-mcp-server', '--parallel', '2'],
  ],
  swift: [['swift', 'build', '--force-resolved-versions', '--product', 'libtmux-mcp', '--jobs', '2']],
}
const selections = {
  py: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  ruby: {
    mode: 'explicit CLI options',
    tools: 'tmux_capabilities,tmux_snapshot,tmux_capture,tmux_wait,tmux_create,tmux_send,tmux_close,tmux_run',
  },
  ts: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  java: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  rs: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  go: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  csharp: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  swift: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  cxx: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
}
const selectionVariables = [...new Set(Object.values(selections).flatMap(Object.keys)), 'LIBTMUX_TOOLS', 'LIBTMUX_EXCLUDE_TOOLS', 'LIBTMUX_MCP_TOOLS', 'LIBTMUX_SAFETY', 'TMUX_MCP_SAFETY', 'LIBTMUX_MCP_CAPABILITIES', 'LIBTMUX_MCP_PROMPTS_AS_TOOLS', 'LIBTMUX_SOCKET_NAME', 'LIBTMUX_SOCKET_PATH']
const sourceStatus = (checkout, slug) => {
  // Publication records the clean/dirty state before native generation.
  // Generated, untracked artifacts such as Swift's symbolgraph are not edits.
  const args = sourceBound ? ['--untracked-files=no'] : slug === 'ruby' ? ['--', 'gems/libtmux-mcp/lib'] : []
  return execFileSync('git', ['-C', checkout, 'status', '--porcelain', ...args], { encoding: 'utf8' }).trim()
}
const sourceRevision = (checkout, slug) => {
  const revision = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const dirty = sourceStatus(checkout, slug)
  if (dirty) throw new Error('source checkout must be clean before recording a protocol snapshot')
  return revision
}

// A missing or dirty checkout used to reach `sourceRevision` and crash (or,
// for a dirty one, throw by its own design). This classifies every checkout
// up front, before anything builds or spawns a server, on the same terms as
// gen-mcp-tools.mjs: --check tolerates either, because CI clones this
// repository alone and the comparison belongs where the checkouts are —
// and a checkout this machine's other work left dirty is not evidence of a
// stale snapshot. Writing a snapshot set tolerates neither, because a
// partial or unreliable set is worse than none.
const relevant = PORTS.filter((port) => (!only || only === port.slug) && productAvailable(port, 'mcp'))
const checkoutStates = new Map(relevant.map((port) => {
  const checkout = checkoutFor(port)
  if (!existsSync(checkout)) return [port.slug, 'missing']
  const status = sourceStatus(checkout)
  return [port.slug, status ? 'dirty' : 'ready']
}))
const missing = [...checkoutStates].filter(([, state]) => state === 'missing').map(([slug]) => slug)
const dirty = [...checkoutStates].filter(([, state]) => state === 'dirty').map(([slug]) => slug)
if (missing.length || dirty.length) {
  const note = `gen-mcp-protocol: ${[
    missing.length && `no checkout for ${missing.join(', ')}`,
    dirty.length && `uncommitted changes in ${dirty.join(', ')}`,
  ].filter(Boolean).join('; ')}`
  if (checking && !sourceBound) {
    console.log(`${note} — skipping the comparison`)
    process.exit(0)
  }
  console.error(`${note} — refusing to write a partial snapshot set`)
  process.exit(1)
}

for (const port of relevant) {
  const checkout = checkoutFor(port)
  const revision = sourceRevision(checkout, port.slug)
  const repository = port.slug === 'py' ? 'tmux-python/libtmux-mcp' : port.repo
  if (sourceBound) {
    const model = JSON.parse(readFileSync(join(root, 'site/src/data/api', `${port.slug}.json`), 'utf8'))
    const source = model.sources?.find((entry) => entry.product === 'mcp' && entry.repo === repository)
    if (model.port !== port.slug || model.revision !== process.env.LIBTMUX_DOCS_SOURCE_SHA ||
        (source?.extractedRevision ?? source?.revision) !== revision) {
      throw new Error(`${port.slug}: API model must describe the selected source and actual MCP checkout ${revision}`)
    }
  }
  const override = process.env[`LIBTMUX_DOCS_MCP_COMMAND_${port.slug.toUpperCase()}`]
  const cwd = port.slug === 'go' ? join(checkout, 'mcp') : checkout
  const selection = selections[port.slug]
  const socketRoot = mkdtempSync(join(tmpdir(), `libtmux-docs-mcp-${port.slug}-`))
  const socket = join(socketRoot, `tmux-${process.getuid?.() ?? ''}`, 'libtmux-docs-protocol')
  const environment = {
    ...Object.fromEntries(selectionVariables.map((key) => [key, undefined])),
    ...(port.slug === 'ruby' ? {} : selection),
    TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: socketRoot, LIBTMUX_SOCKET: 'libtmux-docs-protocol',
  }
  let protocol
  let failure
  try {
    const goBinary = join(socketRoot, 'libtmux-mcp')
    // Dependency downloads and compilation precede the protocol deadline.
    if (!override) {
      for (const [build, ...buildArgs] of builds[port.slug] ?? []) {
        execFileSync(build, buildArgs, { cwd: checkout, stdio: 'inherit' })
      }
      if (port.slug === 'go') execFileSync('go', ['build', '-mod=readonly', '-o', goBinary, './cmd/libtmux-mcp'], { cwd, stdio: 'inherit' })
    }
    // Ruby borrows an existing daemon even for protocol discovery.
    if (port.slug === 'ruby') execFileSync('tmux', [
      '-L', 'libtmux-docs-protocol', '-f', '/dev/null', 'new-session', '-d', '-s', 'docs', '/bin/cat',
    ], { env: { ...process.env, ...environment }, stdio: 'inherit' })
    const [command, ...args] = override ? JSON.parse(override) : port.slug === 'go' ? [goBinary] : commands[port.slug]
    protocol = await captureProtocol({ command, args, cwd, env: environment })
    if (sourceRevision(checkout, port.slug) !== revision) throw new Error(`${port.slug}: source revision changed during discovery`)
  } catch (error) {
    failure = error
    throw error
  } finally {
    const cleanupErrors = []
    try {
      if (existsSync(socket)) execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'inherit' })
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      rmSync(socketRoot, { recursive: true, force: true })
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length) throw new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors,
      `${port.slug}: MCP discovery cleanup failed`)
  }
  const payload = {
    generated: 'scripts/gen-mcp-protocol.mjs',
    repo: repository,
    revision, selection, protocol,
  }
  const out = join(root, 'site/src/data/mcp-protocol', `${port.slug}.json`)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  if (checking) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) throw new Error(`${port.slug}: protocol snapshot is stale`)
  } else {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, text)
  }
  console.log(`gen-mcp-protocol: ${port.slug} ${protocol.tools.length} tools, ${protocol.resources.length} resources, ${protocol.resourceTemplates.length} resource templates, ${protocol.prompts.length} prompts`)
}
