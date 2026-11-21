import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { wrapsProblems } from '../../scripts/lib/mcp-wraps.mjs'

describe('the line an MCP tool cites for the library call it makes', () => {
  const revision = 'a'.repeat(40)
  const text = [
    'package mcp',
    '',
    'func capturePane(ctx context.Context, pane tmux.Pane) {',
    '\tlines, err := pane.Capture(ctx, request)',
    '\tif err != nil {',
    '\t\treturn err',
    '\t}',
    '\tcaptured := pane.CaptureAll(ctx)',
    '}',
    '',
  ].join('\n')
  const read = (rev: string, path: string) => (rev === revision && path === 'mcp/capture_tools.go' ? text : undefined)
  const symbols = [
    { id: 'tmux.Pane.Capture', name: 'Capture', product: 'core' },
    { id: 'tmux.Session.Kill', publicId: 'tmux.Session.Kill', name: 'Kill' },
    { id: 'mcp.Server.Capture', name: 'Capture', product: 'mcp' },
    { id: 'Server.capture(_:since:limit:)', publicId: 'Server.capture(_:since:limit:)', name: 'capture(_:since:limit:)', product: 'core' },
  ]
  const entry = (call: string, source: string) => ({ repo: 'libtmux/libtmux-go', revision, tools: { capture_pane: { call, source } } })
  const problems = (call: string, source: string, source_text = read) => wrapsProblems('go', entry(call, source), symbols, source_text)

  it('resolves when the cited line makes the call', () => {
    expect(problems('tmux.Pane.Capture', 'mcp/capture_tools.go:4')).toEqual([])
  })

  it('refuses a wrong line number: the line before, the line after, one past the file, or zero', () => {
    for (const line of [3, 5, 99, 0]) {
      expect(problems('tmux.Pane.Capture', `mcp/capture_tools.go:${line}`), `line ${line}`).toHaveLength(1)
    }
    expect(problems('tmux.Pane.Capture', 'mcp/capture_tools.go:3')).toEqual(['go: capture_pane cites mcp/capture_tools.go#L3 at aaaaaaaaa, where Capture is not called'])
    expect(problems('tmux.Pane.Capture', 'mcp/capture_tools.go:99')).toEqual(['go: capture_pane cites line 99 of mcp/capture_tools.go at aaaaaaaaa, which has 10 lines'])
  })

  it('takes the call name as a whole word, so a longer call on the line is not the call', () => {
    expect(problems('tmux.Pane.Capture', 'mcp/capture_tools.go:8')).toHaveLength(1)
  })

  it('reads a Swift-style name without its argument labels', () => {
    const swift = 'let output = try await server.capture(pane, since: cursor)\n'
    expect(wrapsProblems('swift', entry('Server.capture(_:since:limit:)', 'Sources/Pane.swift:1'), symbols, () => swift)).toEqual([])
  })

  it('refuses a file that is not at the cited revision', () => {
    expect(problems('tmux.Pane.Capture', 'mcp/other.go:4')).toEqual(['go: capture_pane cites mcp/other.go at aaaaaaaaa, which does not exist'])
    expect(wrapsProblems('go', { ...entry('tmux.Pane.Capture', 'mcp/capture_tools.go:4'), revision: 'b'.repeat(40) }, symbols, read))
      .toEqual(['go: capture_pane cites mcp/capture_tools.go at bbbbbbbbb, which does not exist'])
  })

  it('refuses a call that is not a library symbol of the port, or a source that is not path:line', () => {
    expect(problems('tmux.Pane.NoSuchCall', 'mcp/capture_tools.go:4')).toEqual(['go: capture_pane wraps tmux.Pane.NoSuchCall, which is not a library symbol in the port\'s API model'])
    expect(problems('mcp.Server.Capture', 'mcp/capture_tools.go:4'), 'the server\'s own symbol is not the library').toHaveLength(1)
    expect(problems('tmux.Pane.Capture', 'mcp/capture_tools.go')).toEqual(['go: capture_pane cites "mcp/capture_tools.go", which is not path:line'])
  })
})

describe('a port whose source the check cannot read', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const run = (directory: string, args: string[], { checkout = '', revision = 'a'.repeat(40) } = {}) => {
    const wraps = { go: { repo: 'libtmux/libtmux-go', revision, tools: { capture_pane: { call: 'tmux.Pane.Capture', source: 'capture.go:1' } } } }
    writeFileSync(join(directory, 'wraps.json'), JSON.stringify(wraps))
    writeFileSync(join(directory, 'tools.json'), JSON.stringify({ ports: { go: { repo: wraps.go.repo, revision, registrations: [{ wireName: 'capture_pane' }] } } }))
    // HOME points nowhere, so no standard checkout of the port can stand in for the missing one.
    return spawnSync(process.execPath, ['scripts/check-mcp-wraps.mjs', '--wraps', join(directory, 'wraps.json'), '--tools', join(directory, 'tools.json'), ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, HOME: directory, LIBTMUX_DOCS_CHECKOUT_GO: checkout },
    })
  }
  const inDirectory = (check: (directory: string) => void) => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-wraps-'))
    try { check(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
  }

  it('fails the check unless the run names that port as allowed to lack a checkout', () => inDirectory((directory) => {
    const missing = run(directory, [])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('go: not checked, no checkout')
    expect(missing.stdout).toContain('line-checked 0 of 1 calls in no port')
    const allowed = run(directory, ['--allow-missing', 'go'])
    expect(allowed.status, allowed.stderr).toBe(0)
    expect(allowed.stdout).toContain('skipped go (no checkout)')
    expect(run(directory, ['--allow-missing', 'py']).status, 'naming another port allows nothing for this one').toBe(1)
  }))

  it('fails a checkout that lacks the cited revision, and names the ports whose lines it read', () => inDirectory((directory) => {
    const repo = join(directory, 'repo')
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' })
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'capture.go'), 'lines, err := pane.Capture(ctx, request)\n')
    git('add', 'capture.go')
    git('commit', '-q', '-m', 'capture')
    const stale = run(directory, [], { checkout: repo })
    expect(stale.status).toBe(1)
    expect(stale.stderr).toMatch(/go: not checked, a{9} not in /)
    const read = run(directory, [], { checkout: repo, revision: git('rev-parse', 'HEAD').trim() })
    expect(read.status, read.stderr).toBe(0)
    expect(read.stdout).toContain('line-checked 1 of 1 calls in go (1)')
  }))
})
