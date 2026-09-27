import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/port-docs-identity.sh', import.meta.url))
const workflow = readFileSync(new URL('../../.github/workflows/port-docs.yml', import.meta.url), 'utf8')

interface Entry { version: string; kind: string; isDefault: boolean; resolvesTo: string; publish: boolean }

function identity(env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-port-docs-identity-'))
  const output = join(directory, 'output')
  try {
    const result = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 10000,
      env: {
        PATH: process.env.PATH ?? '', GITHUB_OUTPUT: output, SHA: 'abc123', DEFAULT_BRANCH: 'master',
        REF_NAME: '', REF_TYPE: 'branch', TAG_PREFIX: '', INPUT_SOURCE_REF: '', INPUT_VERSION: '',
        INPUT_KIND: '', INPUT_DEFAULT: 'false', INPUT_RESOLVES_TO: '', INPUT_PUBLISH: 'false', ...env,
      },
    })
    const outputs = result.status === 0
      ? Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
        const at = line.indexOf('=')
        return [line.slice(0, at), line.slice(at + 1)]
      }))
      : {}
    const entries: Entry[] = outputs.matrix ? JSON.parse(outputs.matrix).include : []
    return { status: result.status, stderr: result.stderr, outputs, entries }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const tag = (name: string, prefix = '') => identity({ EVENT: 'push', REF_TYPE: 'tag', REF_NAME: name, TAG_PREFIX: prefix })
const versions = (entries: Entry[]) => entries.map(({ version, kind, isDefault, resolvesTo }) => [version, kind, isDefault, resolvesTo])

describe('port docs identity', () => {
  it('builds a pull request at the merge commit and publishes nothing', () => {
    const result = identity({ EVENT: 'pull_request', REF_NAME: '37/merge' })
    expect(result.outputs.source_ref).toBe('abc123')
    expect(versions(result.entries)).toEqual([['latest', 'trunk', false, '']])
    expect(result.outputs.should_publish).toBe('false')
  })

  it('publishes latest from the default branch only, as the default until a stable release', () => {
    const trunk = identity({ EVENT: 'push', REF_NAME: 'master' })
    expect(versions(trunk.entries)).toEqual([['latest', 'trunk', true, '']])
    expect(trunk.outputs.should_publish).toBe('true')
    const prerelease = identity({ EVENT: 'push', REF_NAME: 'master', TAG_PREFIX: 'libtmux@',
      TAGS: 'libtmux@v0.1.0-alpha.14\ntmux-mcp@v1.0.0\nv2.0.0' })
    expect(versions(prerelease.entries), 'another package\'s release').toEqual([['latest', 'trunk', true, '']])
    const released = identity({ EVENT: 'push', REF_NAME: 'master', TAG_PREFIX: 'libtmux@',
      TAGS: 'libtmux@v0.1.0-alpha.14\nlibtmux@v0.1.0' })
    expect(versions(released.entries), 'after a stable release').toEqual([['latest', 'trunk', false, '']])
    const other = identity({ EVENT: 'push', REF_NAME: 'docs-site' })
    expect(other.status).toBe(1)
    expect(other.stderr).toContain('unsupported documentation branch')
  })

  it('publishes a tag and the alias its grammar implies, for every port grammar', () => {
    const cases: [string, string, string, string][] = [
      ['libtmux@v0.1.0-alpha.14', 'libtmux@', 'v0.1.0-alpha.14', 'next'],
      ['libtmux@v1.0.0', 'libtmux@', 'v1.0.0', 'stable'],
      ['0.1.0-alpha.6', '', '0.1.0-alpha.6', 'next'],
      ['v0.62.0', '', 'v0.62.0', 'stable'],
      ['v0.63.0a1', '', 'v0.63.0a1', 'next'],
      ['v0.1.0.alpha.1', '', 'v0.1.0.alpha.1', 'next'],
      ['v0.1.0alpha1', '', 'v0.1.0alpha1', 'next'],
    ]
    for (const [name, prefix, version, alias] of cases) {
      const result = tag(name, prefix)
      expect(result.status, `${name}: ${result.stderr}`).toBe(0)
      expect(versions(result.entries), name).toEqual([
        [version, 'tag', false, ''],
        [alias, 'alias', alias === 'stable', version],
      ])
    }
  })

  it('refuses a tag that is not this package\'s release', () => {
    expect(tag('tmux-mcp@v0.1.0', 'libtmux@').stderr).toContain('does not start with libtmux@')
    expect(tag('libtmux@nightly', 'libtmux@').stderr).toContain('unsupported release tag')
  })

  it('publishes exactly what a dispatch names, and refuses what cannot be published', () => {
    const dispatch = (inputs: Record<string, string>) => identity({
      EVENT: 'workflow_dispatch', INPUT_SOURCE_REF: 'libtmux@v0.1.0-alpha.14', INPUT_VERSION: 'v0.1.0-alpha.14',
      INPUT_KIND: 'tag', INPUT_PUBLISH: 'true', ...inputs,
    })
    const ok = dispatch({})
    expect(ok.outputs.source_ref).toBe('libtmux@v0.1.0-alpha.14')
    expect(versions(ok.entries)).toEqual([['v0.1.0-alpha.14', 'tag', false, '']])
    expect(ok.outputs.should_publish).toBe('true')
    expect(dispatch({ INPUT_KIND: 'alias' }).stderr).toContain('an alias requires resolves-to')
    expect(dispatch({ INPUT_RESOLVES_TO: 'v1' }).stderr).toContain('resolves-to applies only to aliases')
    expect(dispatch({ INPUT_VERSION: '../latest' }).stderr).toContain('invalid version slug')
    expect(dispatch({ INPUT_KIND: 'pr' }).stderr).toContain('invalid version-kind')
    expect(dispatch({ INPUT_SOURCE_REF: '' }).stderr).toContain('requires source-ref')
  })
})

describe('port docs workflow', () => {
  it('builds with the scripts of its own commit, not a second pin', () => {
    const docsCheckouts = workflow.match(/repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}/g)
    expect(docsCheckouts).toHaveLength(2)
    expect(workflow).not.toMatch(/ref: [0-9a-f]{40}/)
  })

  it('never runs a pull request head or restores a cache', () => {
    expect(workflow).not.toContain('pull_request.head')
    expect(workflow).not.toMatch(/^\s+cache[-a-z]*:/m)
  })
})
