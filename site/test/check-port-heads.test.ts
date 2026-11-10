import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { matrix, phasesFor } from '../../scripts/check-port-heads.mjs'

const script = join(import.meta.dirname, '../../scripts/check-port-heads.mjs')
let directory = ''
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const portHead = (readme: string) => {
  directory = mkdtempSync(join(tmpdir(), 'port-heads-'))
  writeFileSync(join(directory, 'README.md'), readme)
  const git = (...args: string[]) => spawnSync('git', ['-C', directory, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args])
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'fixture')
  return directory
}

describe('check-port-heads', () => {
  it('fails a port whose head README carries an unmapped badge, naming the port and URL (negative control)', () => {
    const url = 'https://img.shields.io/hackage/v/libtmux-nonexistent'
    const checkout = portHead(`# libtmux-lua\n\n![hackage](${url})\n`)
    const result = spawnSync(process.execPath, [script, 'run', '--port', 'lua', '--checkout', checkout, '--phases', 'badges'], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('lua: badges: FAIL')
    expect(result.stdout).toContain(url)
  })

  it('passes a port whose badges all map', () => {
    const checkout = portHead('# libtmux-lua\n\n![docs](https://img.shields.io/badge/docs-libtmux.org-0b7285)\n')
    const result = spawnSync(process.execPath, [script, 'run', '--port', 'lua', '--checkout', checkout, '--phases', 'badges'], { encoding: 'utf8' })
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('lua: badges: ok')
  })

  it('runs the model steps for a provisioned port and the usage scan for a wrapper', () => {
    expect(phasesFor('lisp', { provisioned: ['lisp'] }).map((phase) => phase.name)).toEqual(['badges', 'model'])
    expect(phasesFor('lisp').find((phase) => phase.name === 'model')?.skipped).toContain('not provisioned')
    expect(phasesFor('clojure').map((phase) => phase.name)).toEqual(['badges', 'usage'])
    expect(phasesFor('ts').map((phase) => phase.name)).toEqual(['model'])
  })

  it('has a leg for every port but python', () => {
    const slugs = matrix().include.map((leg: { port: string }) => leg.port)
    expect(slugs).toContain('lisp')
    expect(slugs).toContain('clojure')
    expect(slugs).not.toContain('py')
  })
})
