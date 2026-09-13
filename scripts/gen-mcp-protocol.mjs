#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { captureProtocol } from './lib/mcp-protocol.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
const only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const commands = {
  py: ['.venv/bin/python', '-m', 'libtmux_mcp'],
  ts: ['bun', 'packages/mcp/src/server.ts'],
  rs: ['target/debug/tmux-mcp'],
  go: ['go', 'run', './cmd/libtmux-mcp'],
  java: ['libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp'],
  dotnet: ['dotnet', 'src/LibTmux.Mcp/bin/Release/net10.0/LibTmux.Mcp.dll'],
  cxx: ['build/cxx-dev/apps/mcp/libtmux-mcp-server', '--socket-name', 'libtmux-docs-protocol'],
  swift: ['.build/debug/libtmux-mcp'],
}
const builds = {
  rs: [['cargo', 'build', '--locked', '-p', 'tmux-mcp', '--bin', 'tmux-mcp', '--jobs', '2']],
  java: [['./gradlew', ':libtmux-mcp:installDist', '--max-workers=2']],
  dotnet: [['dotnet', 'build', 'src/LibTmux.Mcp/LibTmux.Mcp.csproj', '--configuration', 'Release', '-m:2']],
  cxx: [
    ['cmake', '--preset', 'cxx-dev', '-DLIBTMUX_BUILD_TESTS=OFF', '-DLIBTMUX_BUILD_EXAMPLES=OFF'],
    ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux-mcp-server', '--parallel', '2'],
  ],
  swift: [['swift', 'build', '--product', 'libtmux-mcp', '--jobs', '2']],
}
const selections = {
  py: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  ts: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  java: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  rs: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  go: { LIBTMUX_SAFETY: 'destructive', LIBTMUX_MCP_CAPABILITIES: 'all', LIBTMUX_MCP_PROMPTS_AS_TOOLS: '1' },
  dotnet: { LIBTMUX_SAFETY: 'destructive' },
  swift: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  cxx: {},
}
const selectionVariables = [...new Set(Object.values(selections).flatMap(Object.keys)), 'LIBTMUX_TOOLS', 'LIBTMUX_EXCLUDE_TOOLS', 'LIBTMUX_MCP_TOOLS', 'TMUX_MCP_SAFETY', 'LIBTMUX_SOCKET_NAME', 'LIBTMUX_SOCKET_PATH']
const sourceRevision = (checkout) => {
  const revision = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (dirty) throw new Error('source checkout must be clean before recording a protocol snapshot')
  return revision
}

for (const port of PORTS) {
  if (only && only !== port.slug) continue
  const checkout = expand(port.slug === 'py'
    ? process.env.LIBTMUX_DOCS_MCP_PY || '~/work/python/libtmux-mcp'
    : process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.worktree)
  const revision = sourceRevision(checkout)
  const override = process.env[`LIBTMUX_DOCS_MCP_COMMAND_${port.slug.toUpperCase()}`]
  if (!override) for (const [build, ...buildArgs] of builds[port.slug] ?? []) {
    execFileSync(build, buildArgs, { cwd: checkout, stdio: 'inherit' })
  }
  const [command, ...args] = override ? JSON.parse(override) : commands[port.slug]
  const cwd = port.slug === 'go' ? join(checkout, 'mcp') : checkout
  const selection = selections[port.slug]
  const socketRoot = mkdtempSync(join(tmpdir(), `libtmux-docs-mcp-${port.slug}-`))
  const environment = {
    ...Object.fromEntries(selectionVariables.map((key) => [key, undefined])), ...selection,
    TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: socketRoot, LIBTMUX_SOCKET: 'libtmux-docs-protocol',
  }
  let protocol
  try {
    protocol = await captureProtocol({ command, args, cwd, env: environment })
    if (sourceRevision(checkout) !== revision) throw new Error(`${port.slug}: source revision changed during discovery`)
  } finally {
    const socket = join(socketRoot, `tmux-${process.getuid?.() ?? ''}`, 'libtmux-docs-protocol')
    if (existsSync(socket)) execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' })
    rmSync(socketRoot, { recursive: true, force: true })
  }
  const payload = {
    generated: 'scripts/gen-mcp-protocol.mjs',
    repo: port.slug === 'py' ? 'tmux-python/libtmux-mcp' : port.repo,
    revision, selection, protocol,
  }
  const out = join(root, 'site/src/data/mcp-protocol', `${port.slug}.json`)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== text) throw new Error(`${port.slug}: protocol snapshot is stale`)
  } else {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, text)
  }
  console.log(`gen-mcp-protocol: ${port.slug} ${protocol.tools.length} tools, ${protocol.resources.length} resources, ${protocol.resourceTemplates.length} resource templates, ${protocol.prompts.length} prompts`)
}
