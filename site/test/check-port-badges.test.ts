import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(import.meta.dirname, '../../scripts/check-port-badges.mjs')
let directory = ''
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const run = (readme: string) => {
  directory = mkdtempSync(join(tmpdir(), 'port-badges-'))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'README.md'), `# libtmux-lua\n\n${readme}\n`)
  return spawnSync(process.execPath, [script, '--port', 'lua'], {
    encoding: 'utf8', env: { ...process.env, LIBTMUX_DOCS_CHECKOUT_LUA: directory },
  })
}

describe('check-port-badges', () => {
  it('fails on an unmapped shields service, naming the port and URL (negative control)', () => {
    const url = 'https://img.shields.io/hackage/v/libtmux-nonexistent'
    const result = run(`![hackage](${url})`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`lua: README.md: ${url}`)
  })

  it('passes a README whose badges all map', () => {
    const result = run('![docs](https://img.shields.io/badge/docs-libtmux.org-0b7285)')
    expect(result.status, result.stderr).toBe(0)
  })
})
