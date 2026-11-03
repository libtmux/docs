import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registrationFileProblems, registrationLinkProblems } from '../../scripts/lib/mcp-source-links.mjs'

it('audits protocol names with the renderer’s resolver in bare Node', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const directory = mkdtempSync(join(tmpdir(), 'mcp-prose-audit-'))
  const file = join(directory, 'guide.md')
  try {
    writeFileSync(file, '---\nport: py\nproduct: mcp\n---\nUse `capture_pane`, `mcp:prompt:run_and_wait`, and `mcp:resource-template:tmux://panes/{pane_id}{?socket_name}`.\n')
    const report = JSON.parse(execFileSync(process.execPath, ['scripts/check-api-links.mjs', file, '--json'], { cwd: root, encoding: 'utf8' }))
    expect(report.tally.willLink).toBe(3)
    expect(report.unresolved).toEqual([])
    writeFileSync(file, '---\nport: ts\nproduct: mcp\n---\nUse `mcp:resource:tmux://capabilities` and `mcp:prompt:run_and_wait`.\n')
    try {
      execFileSync(process.execPath, ['scripts/check-api-links.mjs', file, '--json'], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
      expect.fail('The TypeScript server does not advertise the Python prompt')
    } catch (error) {
      const failure = error as { status: number; stdout: string }
      expect(failure.status).toBe(1)
      const report = JSON.parse(failure.stdout)
      expect(report.tally.willLink).toBe(1)
      expect(report.unresolved).toEqual([expect.objectContaining({ text: 'mcp:prompt:run_and_wait' })])
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

describe('the source link of an MCP registration', () => {
  const source = (file: string, line: number | undefined, revision = 'a'.repeat(40)) => ({ revision, file, ...(line === undefined ? {} : { line }) })
  const row = (name: string, file: string, line: number | undefined, revision?: string) => ({ name, wireName: name, source: source(file, line, revision) })
  const file = ['import { server } from "./server"', '', 'server.registerTool(', '  "list_windows",', '  { description: "x" },', ')', '', 'server.registerTool("kill_session", {})', ''].join('\n')
  const read = (revision: string, path: string) => (revision === 'a'.repeat(40) && path === 'src/tools.ts' ? file : undefined)

  it('resolves when the file exists at the revision and the lines from the cited one name the tool', () => {
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', 3), row('kill_session', 'src/tools.ts', 8)], read)).toEqual([])
  })

  it('refuses a tool whose file does not exist at the cited revision', () => {
    expect(registrationLinkProblems('ts', [row('start_program', 'src/programs.ts', 3)], read))
      .toEqual(['ts: start_program cites src/programs.ts at aaaaaaaaa, which does not exist'])
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', 3, 'b'.repeat(40))], read))
      .toEqual(['ts: list_windows cites src/tools.ts at bbbbbbbbb, which does not exist'])
  })

  it('refuses a file that exists but does not register the tool', () => {
    expect(registrationLinkProblems('ts', [row('run_program', 'src/tools.ts', 3)], read))
      .toEqual(['ts: run_program cites src/tools.ts#L3 at aaaaaaaaa, where run_program is not registered'])
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', 8)], read), 'the line after the registration').toHaveLength(1)
  })

  it('refuses a line past the end of the file, or none', () => {
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', 200)], read)).toEqual(['ts: list_windows cites line 200 of src/tools.ts at aaaaaaaaa, which has 9 lines'])
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', 0)], read)).toHaveLength(1)
    expect(registrationLinkProblems('ts', [row('list_windows', 'src/tools.ts', undefined)], read), 'a registration the revision lacks keeps no line')
      .toEqual(['ts: list_windows cites src/tools.ts at aaaaaaaaa with no line, where list_windows is not registered'])
  })

  it('takes the name as a whole word, within its own registration', () => {
    expect(registrationLinkProblems('ts', [row('list', 'src/tools.ts', 3)], read), 'part of list_windows').toHaveLength(1)
    // alpha is registered at line 1 and its name comes at line 8, after beta's registration begins at line 5
    const far = ['server.registerTool(', '  {', '    description: "a long description",', '  },', 'server.registerTool(', '  "beta",', '  {', '  "alpha",', ''].join('\n')
    const readFar = (_revision: string, path: string) => (path === 'far.ts' ? far : undefined)
    expect(registrationLinkProblems('ts', [row('alpha', 'far.ts', 1), row('beta', 'far.ts', 5)], readFar)).toEqual(['ts: alpha cites far.ts#L1 at aaaaaaaaa, where alpha is not registered'])
    expect(registrationLinkProblems('ts', [row('alpha', 'far.ts', 5)], readFar), 'the last registration reaches the end of the file').toEqual([])
    // a long description before the name is part of the registration
    const long = ['server.registerTool(', '  {', '    description: "one",', '    note: "two",', '  },', '  "alpha",', 'server.registerTool("beta")', ''].join('\n')
    expect(registrationLinkProblems('ts', [row('alpha', 'long.ts', 1), row('beta', 'long.ts', 7)], (_revision, path) => (path === 'long.ts' ? long : undefined))).toEqual([])
  })

  it('fails the check, and names the tool, when run over a repository that lacks the cited file', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const directory = mkdtempSync(join(tmpdir(), 'mcp-source-links-'))
    try {
      const git = (...args: string[]) => execFileSync('git', ['-C', join(directory, 'repo'), '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' })
      execFileSync('git', ['init', '-q', join(directory, 'repo')])
      writeFileSync(join(directory, 'repo', 'tools.ts'), file)
      git('add', 'tools.ts')
      git('commit', '-q', '-m', 'tools')
      const revision = git('rev-parse', 'HEAD').trim()
      const matrix = (rows: ReturnType<typeof row>[]) => {
        const path = join(directory, 'mcp-tools.json')
        writeFileSync(path, JSON.stringify({ ports: { ts: { registrations: rows.map((entry) => ({ ...entry, source: { ...entry.source, revision } })) } } }))
        return path
      }
      const run = (tools: string) => spawnSync(process.execPath, ['scripts/check-mcp-source-links.mjs', '--port', 'ts', '--tools', tools], {
        cwd: root, encoding: 'utf8', env: { ...process.env, LIBTMUX_DOCS_CHECKOUT_TS: join(directory, 'repo') },
      })
      const clean = run(matrix([row('list_windows', 'tools.ts', 3)]))
      expect(clean.status, clean.stderr).toBe(0)
      expect(clean.stdout).toContain('ts 1 registrations resolve')
      const broken = run(matrix([row('list_windows', 'tools.ts', 3), row('start_program', 'programs.ts', 1), row('run_program', 'tools.ts', 3)]))
      expect(broken.status).toBe(1)
      expect(broken.stderr).toMatch(/start_program cites programs\.ts at [0-9a-f]{9}, which does not exist/)
      expect(broken.stderr).toMatch(/run_program cites tools\.ts#L3 at [0-9a-f]{9}, where run_program is not registered/)
      expect(broken.stderr).toContain('2 link(s) do not resolve')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('the committed registrations', () => {
  const data = (path: string) => new URL(`../src/data/${path}`, import.meta.url)
  const matrix = JSON.parse(readFileSync(data('mcp-tools.json'), 'utf8')) as { ports: Record<string, { registrations: { name: string, source: { revision: string, file: string } }[] }> }
  const treeOf = (port: string) => {
    if (!existsSync(data(`api/${port}.paths.json`))) return undefined
    const { revision, paths } = JSON.parse(readFileSync(data(`api/${port}.paths.json`), 'utf8')) as { revision: string, paths: string[] }
    return { revision, paths: new Set(paths) }
  }

  it('cite a file that the model of their revision holds', () => {
    const covered: string[] = []
    const problems = Object.entries(matrix.ports).flatMap(([port, { registrations }]) => {
      const tree = treeOf(port)
      if (tree && registrations.some(({ source }) => source.revision === tree.revision)) covered.push(port)
      return tree ? registrationFileProblems(port, registrations, tree) : []
    })
    expect(problems).toEqual([])
    // A matrix that runs ahead of a model is judged by neither, so these two must be on the model's revision.
    expect(covered).toEqual(expect.arrayContaining(['ts', 'rs']))
  })

  it('refuse a tool whose file the model of its revision lacks, as a matrix ahead of its model would', () => {
    const tree = { revision: 'a'.repeat(40), paths: new Set(['packages/mcp/src/tools/windows.ts']) }
    const registration = (name: string, file: string, revision = tree.revision) => ({ name, source: { revision, file } })
    expect(registrationFileProblems('ts', [registration('list_windows', 'packages/mcp/src/tools/windows.ts')], tree)).toEqual([])
    expect(registrationFileProblems('ts', [registration('start_program', 'packages/mcp/src/tools/programs.ts')], tree))
      .toEqual(['ts: start_program cites packages/mcp/src/tools/programs.ts at aaaaaaaaa, which does not exist'])
    expect(registrationFileProblems('ts', [registration('start_program', 'packages/mcp/src/tools/programs.ts', 'b'.repeat(40))], tree), 'another revision is for a checkout to judge').toEqual([])
  })
})
