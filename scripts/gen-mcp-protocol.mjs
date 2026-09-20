#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS } from '../site/src/lib/ports.ts'
import { captureProtocol } from './lib/mcp-protocol.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expand = (path) => path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
const only = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : undefined
const commands = {
  py: ['.venv/bin/python', '-m', 'libtmux_mcp'],
  ruby: [
    'mise', 'exec', '--', 'bundle', 'exec', 'libtmux-mcp',
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
  go: ['go', 'run', './cmd/libtmux-mcp'],
  java: ['libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp'],
  dotnet: ['dotnet', 'src/LibTmux.Mcp/bin/Release/net10.0/LibTmux.Mcp.dll'],
  cxx: ['build/apps/mcp/libtmux-mcp-server', '--socket-name', 'libtmux-docs-protocol'],
  swift: ['.build/debug/libtmux-mcp'],
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
  dotnet: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  swift: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
  cxx: { LIBTMUX_TOOLSETS: 'inspect,manage,execute,teardown' },
}
const selectionVariables = [...new Set(Object.values(selections).flatMap(Object.keys)), 'LIBTMUX_TOOLS', 'LIBTMUX_EXCLUDE_TOOLS', 'LIBTMUX_MCP_TOOLS', 'LIBTMUX_SAFETY', 'TMUX_MCP_SAFETY', 'LIBTMUX_MCP_CAPABILITIES', 'LIBTMUX_MCP_PROMPTS_AS_TOOLS']

for (const port of PORTS) {
  if (only && only !== port.slug) continue
  if (port.productAvailability?.mcp === 'unpublished') continue
  const checkout = expand(port.slug === 'py'
    ? process.env.LIBTMUX_DOCS_MCP_PY || '~/work/python/libtmux-mcp'
    : process.env[`LIBTMUX_DOCS_CHECKOUT_${port.slug.toUpperCase()}`] || port.worktree)
  const revision = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const dirtyArgs = port.slug === 'ruby'
    ? ['-C', checkout, 'diff', 'HEAD', '--name-only', '--', 'gems/libtmux-mcp/lib']
    : ['-C', checkout, 'diff', 'HEAD', '--name-only']
  const dirty = execFileSync('git', dirtyArgs, { encoding: 'utf8' }).trim()
  if (dirty) throw new Error(`${port.slug}: commit source changes before recording a protocol snapshot`)
  const override = process.env[`LIBTMUX_DOCS_MCP_COMMAND_${port.slug.toUpperCase()}`]
  const [command, ...args] = override ? JSON.parse(override) : commands[port.slug]
  const cwd = port.slug === 'go' ? join(checkout, 'mcp') : checkout
  const selection = selections[port.slug]
  const environment = {
    ...Object.fromEntries(selectionVariables.map((key) => [key, undefined])),
    ...(port.slug === 'ruby' ? {} : selection),
    TMUX: undefined,
    TMUX_PANE: undefined,
  }
  const protocol = await captureProtocol({ command, args, cwd, env: environment })
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
