import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const fixtures = join(import.meta.dirname, 'fixtures/capabilities')

/**
 * A tmux checkout holding only release tags, so a run never depends on a clone
 * outside the repository. The generator reads releases from tmux's own refs,
 * and the default path is a developer's clone that a hosted runner lacks.
 */
function tmuxSource() {
  const dir = mkdtempSync(join(tmpdir(), 'tmux-source-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'release')
  for (const tag of ['3.2a', '3.3', '3.3a', '3.4']) git('tag', tag)
  return dir
}

function generate(manifest: string) {
  const out = join(mkdtempSync(join(tmpdir(), 'capabilities-')), 'capabilities.json')
  const run = spawnSync('node', ['scripts/gen-capabilities.mjs', '--port', 'py', '--manifest', `py=${join(fixtures, manifest)}`, '--tmux', tmuxSource(), '--out', out], {
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
    expect(data.releases).toEqual(['3.3a', '3.4'])
  })

  it('fails on a name the API model does not have', () => {
    const { run } = generate('py-unresolved.json')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('"libtmux.Server.no_such_method", which is not in the API model')
  })
})
