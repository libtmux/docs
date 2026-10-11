import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

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
