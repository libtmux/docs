import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname
const files = [
  'scripts/gen-mcp-protocol.mjs', 'scripts/gen-mcp-tools.mjs', 'scripts/lib/mcp-protocol.mjs',
  'packages/api-model/src/source-lines.ts', 'site/src/lib/ports.ts',
  'site/src/lib/site-root.ts', 'site/src/lib/cooldown.ts',
]
const tool = { name: 'list_sessions', description: 'Selected source contract', inputSchema: {
  type: 'object', properties: { label: { type: 'string', description: 'Selected source argument' } },
} }

function fixture(slug: 'go' | 'py', run: (fixture: {
  directory: string; checkout: string; sha: string; model: string; snapshot: string; catalog: string;
  discovery: string; env: NodeJS.ProcessEnv;
  invoke: (script: 'protocol' | 'tools', args?: string[], env?: NodeJS.ProcessEnv) => SpawnSyncReturns<string>;
}) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-mcp-source-'))
  const checkout = join(directory, 'source')
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    for (const file of files) {
      const target = join(directory, file)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(root, file), target)
    }
    write(join(directory, 'package.json'), '{"type":"module"}')
    write(join(checkout, slug === 'go' ? 'mcp/manifest_catalog.go' : 'src/libtmux_mcp/tools/sessions.py'),
      slug === 'go' ? 'var catalog = []tool{{name: "list_sessions"}}\n' : 'mcp.tool()(list_sessions)\n')
    if (slug === 'py') write(join(checkout, 'docs/tools/list-sessions.md'), '# List sessions\n')
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Source fixture')
    const sha = git('rev-parse', 'HEAD')
    const coreSha = slug === 'py' ? 'c'.repeat(40) : sha
    const model = join(directory, `site/src/data/api/${slug}.json`)
    const snapshot = join(directory, `site/src/data/mcp-protocol/${slug}.json`)
    const catalog = join(directory, 'site/src/data/mcp-tools.json')
    const repo = slug === 'py' ? 'tmux-python/libtmux-mcp' : 'libtmux/libtmux-go'
    write(model, JSON.stringify({ port: slug, revision: coreSha, sources: [{ product: 'mcp', repo, revision: sha, extractedRevision: sha }] }))
    write(catalog, JSON.stringify({ generated: 'fixture', referenceDocumented: 54,
      ports: Object.fromEntries(['py', 'ruby', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'].map((port) => [port, {
        tools: ['old_tool'], registrations: [{ wireName: 'old_tool' }], revision: 'a'.repeat(40),
      }])),
    }))
    const discovery = join(directory, 'discovery.json')
    const server = join(directory, 'server.mjs')
    write(server, `
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
writeFileSync(process.env.DISCOVERY, JSON.stringify({ tmp: process.env.TMUX_TMPDIR, tmux: process.env.TMUX,
  pane: process.env.TMUX_PANE, toolsets: process.env.LIBTMUX_TOOLSETS, socket: process.env.LIBTMUX_SOCKET }))
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (!message.id) return
  if (process.env.CHANGE_SOURCE === '1' && message.method === 'tools/list')
    execFileSync('git', ['-C', process.env.SOURCE, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Changed during discovery'])
  const result = message.method === 'initialize'
    ? { protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
    : { tools: process.env.EMPTY_TOOLS === '1' ? [] : [${JSON.stringify(tool)}] }
  console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
})
`)
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(directory, 'empty-home'),
      LIBTMUX_DOCS_PORT: slug, LIBTMUX_DOCS_SOURCE_SHA: coreSha,
      [`LIBTMUX_DOCS_CHECKOUT_${slug.toUpperCase()}`]: checkout, LIBTMUX_DOCS_MCP_PY: checkout,
      [`LIBTMUX_DOCS_MCP_COMMAND_${slug.toUpperCase()}`]: JSON.stringify([process.execPath, server]),
      TMUX: 'inherited-session', TMUX_PANE: '%123', LIBTMUX_TOOLSETS: 'teardown', LIBTMUX_SOCKET_PATH: '/must-not-use',
      DISCOVERY: discovery, SOURCE: checkout,
    }
    const invoke = (script: 'protocol' | 'tools', args: string[] = [], overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath,
      [join(directory, `scripts/gen-mcp-${script}.mjs`), '--port', slug, '--source-bound', ...args],
      { encoding: 'utf8', timeout: 10000, env: { ...env, ...overrides } })
    run({ directory, checkout, sha, model, snapshot, catalog, discovery, env, invoke })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it.each(['go', 'py'] as const)('binds the %s catalog to its actual MCP source and preserves unrelated catalogs', (slug) => {
  fixture(slug, ({ sha, catalog, snapshot, discovery, invoke }) => {
    const previous = JSON.parse(readFileSync(catalog, 'utf8'))
    const captured = invoke('protocol')
    expect(captured.status, captured.stderr).toBe(0)
    const generated = invoke('tools')
    expect(generated.status, generated.stderr).toBe(0)
    const result = JSON.parse(readFileSync(catalog, 'utf8'))
    expect(result.ports[slug].revision).toBe(sha)
    expect(result.ports[slug].extractedRevision).toBe(sha)
    expect(result.ports[slug].registrations[0]).toMatchObject({ ...tool, schemaStatus: 'runtime', source: { revision: sha, extractedRevision: sha } })
    expect(JSON.parse(readFileSync(snapshot, 'utf8')).revision).toBe(sha)
    for (const port of Object.keys(previous.ports).filter((port) => port !== slug)) expect(result.ports[port]).toEqual(previous.ports[port])
    if (slug === 'go') expect(result.referenceDocumented).toBe(54)
    else expect(result.referenceDocumented).toBe(1)
    const environment = JSON.parse(readFileSync(discovery, 'utf8'))
    expect(environment).toMatchObject({ toolsets: 'inspect,manage,execute,teardown', socket: 'libtmux-docs-protocol' })
    expect(environment.tmux).toBeUndefined()
    expect(environment.pane).toBeUndefined()
    expect(environment.tmp).toContain('libtmux-docs-mcp-')
    expect(existsSync(environment.tmp)).toBe(false)
  })
})

it.each(['core revision', 'MCP revision', 'MCP repository'])('rejects an API model with the wrong %s before starting the server', (field) => {
  fixture('go', ({ model, discovery, invoke }) => {
    const value = JSON.parse(readFileSync(model, 'utf8'))
    if (field === 'core revision') value.revision = 'b'.repeat(40)
    else if (field === 'MCP revision') value.sources[0].extractedRevision = 'b'.repeat(40)
    else value.sources[0].repo = 'other/repository'
    writeFileSync(model, JSON.stringify(value))
    for (const script of ['protocol', 'tools'] as const) {
      const result = invoke(script)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('API model must describe the selected source and actual MCP checkout')
    }
    expect(existsSync(discovery)).toBe(false)
  })
})

it.each(['revision', 'repo', 'missing', 'schema'])('rejects a %s protocol mismatch without replacing the catalog', (field) => {
  fixture('go', ({ snapshot, catalog, invoke }) => {
    expect(invoke('protocol').status).toBe(0)
    const before = readFileSync(catalog, 'utf8')
    const value = JSON.parse(readFileSync(snapshot, 'utf8'))
    if (field === 'revision') value.revision = 'b'.repeat(40)
    else if (field === 'repo') value.repo = 'other/repository'
    else if (field === 'schema') delete value.protocol.tools[0].inputSchema
    if (field === 'missing') rmSync(snapshot)
    else writeFileSync(snapshot, JSON.stringify(value))
    const result = invoke('tools')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/another source revision or repository|requires a runtime protocol snapshot|runtime schemas missing/)
    expect(readFileSync(catalog, 'utf8')).toBe(before)
  })
})

it('reports a missing runtime instead of retaining a stale snapshot', () => {
  fixture('go', ({ snapshot, invoke }) => {
    const result = invoke('protocol', [], { LIBTMUX_DOCS_MCP_COMMAND_GO: JSON.stringify(['/does-not-exist/libtmux-mcp']) })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ENOENT')
    expect(existsSync(snapshot)).toBe(false)
  })
})

it.each(['success', 'build failure', 'capture failure', 'override'])('prebuilds Go outside the protocol deadline: %s', (scenario) => {
  fixture('go', ({ directory, checkout, snapshot, discovery, env, invoke }) => {
    const bin = join(directory, 'bin')
    const buildLog = join(directory, 'build.json')
    const server = join(directory, 'server.mjs')
    const executable = join(bin, 'go')
    mkdirSync(bin)
    writeFileSync(executable, `#!${process.execPath}
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
writeFileSync(${JSON.stringify(buildLog)}, JSON.stringify({ args, cwd: process.cwd() }))
if (args[0] !== 'build') throw new Error('Go must compile before protocol discovery')
await new Promise((resolve) => setTimeout(resolve, 400))
if (${JSON.stringify(scenario)} === 'build failure') {
  process.stderr.write('fixture Go compile failed\\n')
  process.exit(42)
}
writeFileSync(args[args.indexOf('-o') + 1], ${JSON.stringify(`#!${process.execPath}\n${scenario === 'capture failure'
      ? "process.stderr.write('fixture compiled server failed\\n'); process.exit(37)"
      : `await import(${JSON.stringify(pathToFileURL(server).href)})`}`)}, { mode: 0o700 })
`)
    chmodSync(executable, 0o700)
    // Shorten only the copied fixture's deadline: compilation exceeds it,
    // while the already compiled server still answers in time.
    const helper = join(directory, 'scripts/lib/mcp-protocol.mjs')
    writeFileSync(helper, readFileSync(helper, 'utf8').replace('timeoutMs = 30000', 'timeoutMs = 200'))
    const result = invoke('protocol', [], {
      LIBTMUX_DOCS_MCP_COMMAND_GO: scenario === 'override' ? env.LIBTMUX_DOCS_MCP_COMMAND_GO : undefined,
      PATH: `${bin}:${env.PATH}`,
    })
    if (scenario === 'override') {
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(buildLog)).toBe(false)
      return
    }
    const build = JSON.parse(readFileSync(buildLog, 'utf8'))
    expect(build.cwd).toBe(join(checkout, 'mcp'))
    expect(build.args).toEqual(['build', '-mod=readonly', '-o', expect.stringContaining('libtmux-docs-mcp-go-'), './cmd/libtmux-mcp'])
    const binary = build.args[3]
    expect(binary.startsWith(checkout)).toBe(false)
    expect(existsSync(dirname(binary))).toBe(false)
    if (scenario === 'success') {
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(readFileSync(snapshot, 'utf8')).protocol.tools).toEqual([tool])
      expect(JSON.parse(readFileSync(discovery, 'utf8')).tmp).toBe(dirname(binary))
    } else {
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(scenario === 'build failure' ? 'fixture Go compile failed' : 'fixture compiled server failed')
      expect(existsSync(snapshot)).toBe(false)
      expect(existsSync(discovery)).toBe(false)
    }
  })
})

it('fails a source-bound check with a missing checkout', () => {
  fixture('go', ({ invoke }) => {
    for (const script of ['protocol', 'tools'] as const) {
      const result = invoke(script, ['--check'], { LIBTMUX_DOCS_CHECKOUT_GO: '/does-not-exist/libtmux-go' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('no checkout for go')
      expect(result.stdout).not.toContain('skipping')
    }
  })
})

it('rejects a checkout that changes revision during discovery', () => {
  fixture('go', ({ snapshot, invoke }) => {
    const result = invoke('protocol', [], { CHANGE_SOURCE: '1' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('source revision changed during discovery')
    expect(existsSync(snapshot)).toBe(false)
  })
})

it('rejects a runtime selection missing a registered tool', () => {
  fixture('go', ({ invoke }) => {
    expect(invoke('protocol', [], { EMPTY_TOOLS: '1' }).status).toBe(0)
    const result = invoke('tools')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('runtime schemas missing for list_sessions')
  })
})

it('rejects tracked source edits before discovery or catalog generation', () => {
  fixture('go', ({ checkout, discovery, invoke }) => {
    writeFileSync(join(checkout, 'mcp/manifest_catalog.go'), 'changed source\n')
    for (const script of ['protocol', 'tools'] as const) {
      const result = invoke(script)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/uncommitted changes|tracked source changes/)
    }
    expect(existsSync(discovery)).toBe(false)
  })
})

it('does not inherit another language\'s MCP product for a selected library', () => {
  fixture('go', ({ directory, catalog, discovery, env }) => {
    const before = readFileSync(catalog, 'utf8')
    for (const port of ['lua', 'kotlin', 'scala', 'fsharp']) {
      for (const script of ['protocol', 'tools']) {
        const result = spawnSync(process.execPath, [join(directory, `scripts/gen-mcp-${script}.mjs`), '--port', port, '--source-bound'], {
          encoding: 'utf8', env: { ...env, LIBTMUX_DOCS_PORT: port },
        })
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).toBe('')
      }
    }
    expect(readFileSync(catalog, 'utf8')).toBe(before)
    expect(existsSync(discovery)).toBe(false)
  })
})
