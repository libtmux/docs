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
