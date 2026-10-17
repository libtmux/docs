import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fixtures = join(import.meta.dirname, 'fixtures/capabilities')

function generate(manifest: string) {
  const out = join(mkdtempSync(join(tmpdir(), 'capabilities-')), 'capabilities.json')
  const run = spawnSync('node', ['scripts/gen-capabilities.mjs', '--port', 'py', '--manifest', `py=${join(fixtures, manifest)}`, '--out', out], {
    cwd: root,
    encoding: 'utf8',
  })
  return { run, out }
}

describe('gen-capabilities', () => {
  it('links every API name in a manifest to the API model', () => {
    const { run, out } = generate('py.json')
    expect(run.status, run.stderr).toBe(0)
    const data = JSON.parse(readFileSync(out, 'utf8'))
    const entry = data.ports.py.capabilities[0]
    expect(entry.apis).toEqual(['libtmux.Server.new_session'])
    expect(entry.error).toBe('libtmux.exc.VersionTooLow')
    expect(data.releases[0]).toBe('3.3a')
  })

  it('fails on a name the API model does not have', () => {
    const { run } = generate('py-unresolved.json')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('"libtmux.Server.no_such_method", which is not in the API model')
  })
})
