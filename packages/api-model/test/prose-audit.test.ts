import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { Resolver, notASymbol } from '../src/resolver.ts'
import { decideFilePath, decideMention } from '../src/prose.ts'
import { extractWithSpec } from '../src/languages/spec.ts'
import { GO } from '../src/languages/specs.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const audit = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-api-links.mjs', ...args, '--json'], { cwd: root, encoding: 'utf8' })

describe('product prose audit', () => {
  it('checks the product collection by default', () => {
    const result = audit()
    expect(JSON.parse(result.stdout).pages).toContain('ports/ts/mcp/index.md')
  })

  it('does not let another language satisfy an authored port reference', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'libtmux-prose-audit-'))
    const file = join(scratch, 'topic.md')
    try {
      writeFileSync(file, '---\ntitle: Capture\nport: ts\nproduct: mcp\n---\n\nUse `capture_pane()` for output.\n')
      const result = audit(file)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).unresolved.map((entry: { text: string }) => entry.text)).toEqual(['capture_pane()'])
    } finally {
      rmSync(scratch, { recursive: true })
    }
  })
})

describe('product context in prose', () => {
  const symbols = [
    { id: 'tmux.Window', name: 'Window', kind: 'struct', product: 'core' },
    { id: 'tmux.Window.Open', name: 'Open', kind: 'method', parent: 'tmux.Window', product: 'core' },
    { id: 'workspace.Window', name: 'Window', kind: 'struct', product: 'workspace' },
    { id: 'workspace.Window.Open', name: 'Open', kind: 'method', parent: 'workspace.Window', product: 'workspace' },
    { id: 'tmux.Server', name: 'Server', kind: 'struct', product: 'core' },
    { id: 'tmux.Scope.Server', name: 'Server', kind: 'constant', parent: 'tmux.Scope', product: 'core' },
    { id: 'mcp.Target.Server', name: 'Server', kind: 'constant', parent: 'mcp.Target', product: 'mcp' },
    { id: 'mcp.Run', name: 'Run', kind: 'function', product: 'mcp' },
  ].map((s) => ({ ...s, signatures: [] })) as ApiSymbol[]
  const model = { port: 'go', version: '0', symbols } as ApiModel
  const resolver = new Resolver([model])
  const id = (text: string, product?: 'core' | 'workspace' | 'mcp') => {
    const result = resolver.resolve('go', text, product)
    return 'symbol' in result ? result.symbol.id : result.how
  }

  it('prefers the current product while preserving default core links', () => {
    expect(id('Window')).toBe('tmux.Window')
    expect(id('Window', 'workspace')).toBe('workspace.Window')
    expect(id('window.Open()', 'workspace')).toBe('workspace.Window.Open')
    expect(id('window.Open()')).toBe('tmux.Window.Open')
    expect(id('tmux.Window', 'workspace')).toBe('tmux.Window')
    expect(id('workspace.Window')).toBe('workspace.Window')
  })

  it('falls back to the core type without confusing it with enum members', () => {
    expect(id('Server', 'workspace')).toBe('tmux.Server')
    expect(id('Server', 'mcp')).toBe('tmux.Server')
    expect(id('tmux.Scope.Server', 'workspace')).toBe('tmux.Scope.Server')
  })

  it('does not borrow another language when the page already names its port', () => {
    const other = { port: 'py', version: '0', symbols: [{ id: 'Other', name: 'Other', kind: 'class', signatures: [] }] } as ApiModel
    const result = decideMention('Other', { pagePort: 'go', product: 'workspace' }, new Resolver([model, other]), { go: model, py: other })
    expect(result.kind).toBe('unresolved')
  })

  it('classifies MCP resource URIs and newly authored filenames explicitly', () => {
    expect(notASymbol('tmux://sessions/{session_id}')).toBe('a protocol URI')
    expect(decideFilePath('dev.yaml', { before: 'Save this description as ' }, {})).toEqual({ kind: 'skip', why: 'file created by the example' })
    expect(decideFilePath('missing.yaml', { before: 'The implementation reads ' }, {}).kind).toBe('unresolved')
  })
})

it('extracts exported Go error variables with their source documentation', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'libtmux-go-api-'))
  const file = join(scratch, 'workspace.go')
  try {
    writeFileSync(file, 'package workspace\n\n// ErrInvalidWorkspace matches parse and validation failures.\nvar ErrInvalidWorkspace = errors.New("workspace: invalid workspace")\nvar privateError = errors.New("private")\n')
    const symbols = await extractWithSpec(GO, file, 'workspace')
    expect(symbols.map((symbol) => symbol.id)).toEqual(['workspace.ErrInvalidWorkspace'])
    expect(symbols[0].doc?.summary).toContain('parse and validation failures')
    expect(symbols[0].source?.line).toBe(4)
  } finally {
    rmSync(scratch, { recursive: true })
  }
})
