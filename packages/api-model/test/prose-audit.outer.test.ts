// Outer: the real CLI loads the complete prose corpus in subprocesses.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const audit = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-api-links.mjs', ...args, '--json'], { cwd: root, encoding: 'utf8' })

describe('product prose audit', () => {
  it('audits native commands and dependency types without accepting invented commands', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'libtmux-powershell-audit-'))
    const file = join(scratch, 'topic.md')
    try {
      writeFileSync(file, '---\ntitle: Snapshot\nport: powershell\n---\n\nUse `Get-TmuxSnapshot` with `LibTmux.Server`.\n')
      expect(audit(file).status).toBe(0)
      writeFileSync(file, '---\ntitle: Snapshot\nport: powershell\n---\n\nUse `Invent-TmuxSnapshot`.\n')
      const result = audit(file)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).unresolved.map((entry: { text: string }) => entry.text)).toEqual(['Invent-TmuxSnapshot'])
    } finally {
      rmSync(scratch, { recursive: true })
    }
  })

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
