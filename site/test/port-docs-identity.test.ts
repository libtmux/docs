import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { publicationMatrix } from '../../scripts/port-docs-matrix.mjs'

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

  it('publishes an opted-in same-repository preview from the tested merge commit', () => {
    const result = identity({ EVENT: 'pull_request', PUBLISH_PREVIEWS: 'true',
      PR_NUMBER: '37', SAME_REPOSITORY_PR: 'true' })
    expect(result.status).toBe(0)
    expect(result.outputs.source_ref).toBe('abc123')
    expect(versions(result.entries)).toEqual([['pr-37', 'pr', false, '']])
    expect(result.outputs.should_publish).toBe('true')
    for (const port of ['powershell', 'julia', 'elixir']) {
      const matrix = publicationMatrix({ include: result.entries }, port, `libtmux/libtmux-${port}`)
      expect(matrix.include).toEqual([{ ...result.entries[0], port }])
    }
  })

  it.each(['false', ''])('keeps fork or missing-identity previews unpublishable (%s)', (sameRepository) => {
    const result = identity({ EVENT: 'pull_request', PUBLISH_PREVIEWS: 'true',
      PR_NUMBER: '37', SAME_REPOSITORY_PR: sameRepository })
    expect(result.status).toBe(0)
    expect(versions(result.entries)).toEqual([['pr-37', 'pr', false, '']])
    expect(result.outputs.should_publish).toBe('false')
  })

  it.each(['', '../latest', '37/../../latest'])('rejects an invalid opted-in preview number: %s', (number) => {
    const result = identity({ EVENT: 'pull_request', PUBLISH_PREVIEWS: 'true',
      PR_NUMBER: number, SAME_REPOSITORY_PR: 'true' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('preview requires a numeric pull request number')
  })

  it('publishes latest from the default branch only, as the default until a final release', () => {
    const trunk = identity({ EVENT: 'push', REF_NAME: 'master' })
    expect(versions(trunk.entries)).toEqual([['latest', 'trunk', true, '']])
    expect(trunk.outputs.should_publish).toBe('true')
    const prerelease = identity({ EVENT: 'push', REF_NAME: 'master', TAG_PREFIX: 'libtmux@',
      TAGS: 'libtmux@v0.1.0-alpha.14\ntmux-mcp@v1.0.0\nv2.0.0' })
    expect(versions(prerelease.entries), 'another package\'s release').toEqual([['latest', 'trunk', true, '']])
    const released = identity({ EVENT: 'push', REF_NAME: 'master', TAG_PREFIX: 'libtmux@',
      TAGS: 'libtmux@v0.1.0-alpha.14\nlibtmux@v0.1.0' })
    expect(versions(released.entries), 'after a final release').toEqual([['latest', 'trunk', false, '']])
    const other = identity({ EVENT: 'push', REF_NAME: 'docs-site' })
    expect(other.status).toBe(1)
    expect(other.stderr).toContain('unsupported documentation branch')
  })

  it('publishes a tag for every port grammar, the default only for a final release', () => {
    const cases: [string, string, string, string | null][] = [
      ['libtmux@v0.1.0-alpha.14', 'libtmux@', 'v0.1.0-alpha.14', 'next'],
      ['libtmux@v1.0.0', 'libtmux@', 'v1.0.0', null],
      ['0.1.0-alpha.6', '', '0.1.0-alpha.6', 'next'],
      ['v0.62.0', '', 'v0.62.0', null],
      ['v0.63.0a1', '', 'v0.63.0a1', 'next'],
      ['v0.1.0.alpha.1', '', 'v0.1.0.alpha.1', 'next'],
      ['v0.1.0alpha1', '', 'v0.1.0alpha1', 'next'],
    ]
    for (const [name, prefix, version, alias] of cases) {
      const result = tag(name, prefix)
      expect(result.status, `${name}: ${result.stderr}`).toBe(0)
      expect(versions(result.entries), name).toEqual([
        [version, 'tag', alias === null, ''],
        ...(alias ? [[alias, 'alias', false, version]] : []),
      ])
    }
  })

  it('keeps the default on the newest final release when an older tag is pushed', () => {
    const push = (name: string, tags: string) => identity({ EVENT: 'push', REF_TYPE: 'tag', REF_NAME: name, TAGS: tags })
    const tags = 'v0.45.9\nv0.46.2\nv0.47.0a1\nv0.9.0'
    expect(versions(push('v0.45.9', tags).entries), 'older backport').toEqual([['v0.45.9', 'tag', false, '']])
    expect(versions(push('v0.9.0', tags).entries), 'lower minor that sorts last as text').toEqual([['v0.9.0', 'tag', false, '']])
    expect(versions(push('v0.46.2', tags).entries), 'the newest final').toEqual([['v0.46.2', 'tag', true, '']])
    expect(versions(push('v0.47.0', `${tags}\nv0.47.0`).entries), 'a newer final').toEqual([['v0.47.0', 'tag', true, '']])
    expect(versions(push('v0.47.0a1', tags).entries), 'a prerelease').toEqual([
      ['v0.47.0a1', 'tag', false, ''], ['next', 'alias', false, 'v0.47.0a1']])
  })

  it('emits only latest, a pull request, a release tag or next, for any event', () => {
    const results = [
      tag('v1.0.0'), tag('v1.0.0-alpha.1'), identity({ EVENT: 'push', REF_NAME: 'master', TAGS: 'v1.0.0' }),
      identity({ EVENT: 'push', REF_NAME: 'master' }), identity({ EVENT: 'pull_request', REF_NAME: '1/merge' }),
    ]
    for (const { entries } of results) {
      expect(entries.length).toBeGreaterThan(0)
      for (const { version } of entries) expect(version).toMatch(/^(?:latest|next|pr-\d+|(?:[A-Za-z][\w.-]*[@/])?v?\d[\w.-]*)$/)
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
  it('builds wrapper versions under their parent repository ownership', () => {
    const entries = tag('v0.0.1-alpha.17').entries
    const matrix = publicationMatrix({ include: entries }, 'java', 'libtmux/libtmux-java', true)
    expect(matrix.include.map(({ port, version }) => `${port}/${version}`)).toEqual([
      'java/v0.0.1-alpha.17', 'kotlin/v0.0.1-alpha.17', 'scala/v0.0.1-alpha.17',
      'java/next', 'kotlin/next', 'scala/next',
    ])
    expect(publicationMatrix({ include: entries }, 'java', 'libtmux/libtmux-java').include).toHaveLength(2)
    expect(publicationMatrix({ include: entries }, 'fsharp', 'libtmux/libtmux-dotnet').include.every((entry) => entry.port === 'fsharp')).toBe(true)
    expect(() => publicationMatrix({ include: entries }, 'java', 'libtmux/libtmux-dotnet', true)).toThrow('cannot build java')
    expect(() => publicationMatrix({ include: entries }, 'scala', 'libtmux/libtmux-ts')).toThrow('cannot build scala')
    expect(() => publicationMatrix({ include: entries }, 'unknown', 'libtmux/docs')).toThrow('unknown documentation port')
  })

  it('builds with the scripts of its own commit, not a second pin', () => {
    const docsCheckouts = workflow.match(/repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}/g)
    expect(docsCheckouts).toHaveLength(2)
    expect(workflow).not.toMatch(/ref: [0-9a-f]{40}/)
  })

  it('never runs a pull request head or restores a cache', () => {
    expect(workflow).not.toContain('pull_request.head.sha')
    expect(workflow).toContain('SHA: ${{ github.sha }}')
    expect(workflow).not.toMatch(/uses: (?:actions\/cache|Swatinem\/rust-cache)@/)
    for (const [, key, value] of workflow.matchAll(/^\s+((?:enable-|bundler-|no-)?cache(?:-disabled)?):\s+(\S+)/gm)) {
      expect(value, key).toBe(['cache-disabled', 'no-cache'].includes(key) ? 'true' : 'false')
    }
  })
})
