import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const checker = fileURLToPath(new URL('../scripts/check-fonts.mjs', import.meta.url))
const scratch: string[] = []
afterEach(() => scratch.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

function audit(html: string) {
  const path = mkdtempSync(join(tmpdir(), 'libtmux-font-audit-'))
  scratch.push(path)
  writeFileSync(join(path, 'index.html'), html)
  const result = spawnSync(process.execPath, [checker, '--site', path, '--url', 'http://127.0.0.1:1', '--json'], {
    encoding: 'utf8', timeout: 5000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  return { status: result.status, ...JSON.parse(result.stdout) as { notes: string[]; failures: string[] } }
}

describe('font audit redirect exemptions', () => {
  it('recognizes an Astro redirect with long paths in its title and code labels', () => {
    const target = '/en/dotnet/latest/workspace/internals/api/libtmux-workspace-workspacebuilder-buildsessionasync/'
    const source = target.replace('/internals/', '/')
    const result = audit(`<!doctype html>
<title>Redirecting to: ${target}</title>
<meta http-equiv="refresh" content="0;url=${target}">
<meta name="robots" content="noindex">
<link rel="canonical" href="https://libtmux.org${target}">
<body><a href="${target}">Redirecting from <code>${source}</code> to <code>${target}</code></a></body>`)
    expect(result.status, result.failures.join('\n')).toBe(0)
    expect(result.notes).toContain('1 pages: 0 styled, 1 redirect stubs')
    expect(result.failures).toEqual([])
  })

  it.each(['article', 'main'])('does not exempt unstyled %s content with a meta refresh', (tag) => {
    const result = audit(`<meta http-equiv="refresh" content="60;url=/">
<${tag}><h1>Workspace configuration</h1><p>Build a session from this file.</p></${tag}>`)
    expect(result.status).toBe(1)
    expect(result.failures).toEqual([expect.stringContaining('render text without the full font setup')])
  })

  it('does not exempt long prose outside an article', () => {
    const prose = 'A workspace file defines the windows and panes to create in a tmux session. '.repeat(5)
    const result = audit(`<meta http-equiv="refresh" content="60;url=/"><body><p>${prose}</p></body>`)
    expect(result.status).toBe(1)
    expect(result.failures).toEqual([expect.stringContaining('render text without the full font setup')])
  })
})
