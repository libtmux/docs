import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { plan } from '../../scripts/publish-plan.mjs'
import * as versions from '../src/lib/versions'

const workflow = readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf8')

const catalog = [
  { slug: 'py', repo: 'tmux-python/libtmux', tagGrammar: 'pep440' },
  { slug: 'rs', repo: 'libtmux/libtmux-rs', tagPrefix: 'libtmux@', tagGrammar: 'semver' },
  { slug: 'go', repo: 'libtmux/libtmux-go', tagGrammar: 'semver' },
  { slug: 'swift', repo: 'libtmux/libtmux-swift', tagGrammar: 'semver' },
]
const tags: Record<string, string[]> = {
  'libtmux/libtmux-rs': ['libtmux@v0.1.0-alpha.13', 'libtmux@v0.1.0-alpha.14', 'tmux-mcp@v9.0.0'],
  'libtmux/libtmux-go': ['v1.2.0', 'v1.10.0-alpha.1', 'v1.9.0', 'mcp/v2.0.0'],
  'libtmux/libtmux-swift': [],
}
const lookup = (repo: string) => ({ defaultBranch: 'master', tags: tags[repo] ?? [] })
const run = (inputs: Record<string, unknown>) =>
  plan({ ports: 'all', ref: 'latest', ...inputs } as never, catalog, lookup, versions)
const rows = (entries: ReturnType<typeof plan>) =>
  entries.map((e: Record<string, unknown>) => [e.port, e.sourceRef, e.version, e.kind, e.isDefault, e.resolvesTo])

describe('publish plan', () => {
  it('publishes every dispatchable default branch as latest, the default until a stable release', () => {
    expect(rows(run({}))).toEqual([
      ['rs', 'master', 'latest', 'trunk', true, ''],
      ['go', 'master', 'latest', 'trunk', false, ''],
      ['swift', 'master', 'latest', 'trunk', true, ''],
    ])
  })

  it('republishes each newest release with the alias its grammar implies', () => {
    expect(rows(run({ ref: 'release' }))).toEqual([
      ['rs', 'libtmux@v0.1.0-alpha.14', 'v0.1.0-alpha.14', 'tag', false, ''],
      ['rs', 'libtmux@v0.1.0-alpha.14', 'next', 'alias', false, 'v0.1.0-alpha.14'],
      ['go', 'v1.10.0-alpha.1', 'v1.10.0-alpha.1', 'tag', false, ''],
      ['go', 'v1.10.0-alpha.1', 'next', 'alias', false, 'v1.10.0-alpha.1'],
    ])
  })

  it('publishes one port at an exact ref as the inputs name it', () => {
    expect(rows(run({ ports: 'go', ref: 'v1.9.0', version: 'v1.9.0', versionKind: 'tag' }))).toEqual([
      ['go', 'v1.9.0', 'v1.9.0', 'tag', false, ''],
    ])
    expect(rows(run({ ports: 'go', ref: 'v1.9.0', version: 'stable', versionKind: 'alias', resolvesTo: 'v1.9.0', isDefault: true })))
      .toEqual([['go', 'v1.9.0', 'stable', 'alias', true, 'v1.9.0']])
  })

  it('selects each parent and wrapper once through its owning repository', () => {
    const family = [
      { slug: 'java', repo: 'libtmux/libtmux-java', tagGrammar: 'semver' },
      { slug: 'kotlin', repo: 'libtmux/libtmux-java', tagGrammar: 'semver', parentLibrary: { slug: 'java' } },
      { slug: 'scala', repo: 'libtmux/libtmux-java', tagGrammar: 'semver', parentLibrary: { slug: 'java' } },
      { slug: 'dotnet', repo: 'libtmux/libtmux-dotnet', tagGrammar: 'semver' },
      { slug: 'fsharp', repo: 'libtmux/libtmux-dotnet', tagGrammar: 'semver', parentLibrary: { slug: 'dotnet' } },
    ]
    const lookups: string[] = []
    const entries = plan({ ports: 'all', ref: 'latest' }, [...catalog, ...family], (repo) => {
      lookups.push(repo)
      return lookup(repo)
    }, versions)
    expect(lookups).toHaveLength(5)
    expect(new Set(lookups).size).toBe(5)
    expect(entries.map((entry) => [entry.port, entry.language])).toEqual([
      ['rs', ''], ['go', ''], ['swift', ''],
      ['java', 'java'], ['kotlin', 'kotlin'], ['scala', 'scala'], ['dotnet', 'dotnet'], ['fsharp', 'fsharp'],
    ])
    expect(plan({ ports: 'kotlin,fsharp', ref: 'latest' }, family, lookup, versions)).toMatchObject([
      { port: 'kotlin', repo: 'libtmux/libtmux-java', language: 'kotlin' },
      { port: 'fsharp', repo: 'libtmux/libtmux-dotnet', language: 'fsharp' },
    ])
    expect(plan({ ports: 'scala', ref: 'v0.1.0', version: 'v0.1.0', versionKind: 'tag' }, family, lookup, versions))
      .toMatchObject([{ language: 'scala', sourceRef: 'v0.1.0' }])
  })

  it('refuses what it cannot dispatch or publish', () => {
    const refusals: [Record<string, unknown>, string][] = [
      [{ ports: 'py' }, 'py has no dispatchable docs workflow'],
      [{ ports: 'nope' }, 'unknown port nope'],
      [{ ports: 'rs,go', ref: 'v1.9.0' }, 'select one port'],
      [{ ports: 'go', ref: 'v1.9.0', version: 'v1.9.0' }, 'needs version-kind'],
      [{ ports: 'go', ref: 'v1.9.0', version: '../x', versionKind: 'tag' }, 'invalid version slug'],
      [{ ports: 'go', ref: 'v1.9.0', version: 'next', versionKind: 'alias' }, 'an alias requires resolves-to'],
      [{ ports: 'go', ref: 'v1.9.0', version: 'v1.9.0', versionKind: 'tag', resolvesTo: 'x' }, 'only to aliases'],
      [{ ref: 'latest', version: 'v1' }, 'apply only to an exact ref'],
    ]
    for (const [inputs, message] of refusals) expect(() => run(inputs), JSON.stringify(inputs)).toThrow(message)
  })
})

describe('publish workflow', () => {
  it('plans without credentials and dispatches only on a real run', () => {
    const planJob = workflow.slice(workflow.indexOf('  plan:\n'), workflow.indexOf('  dispatch:\n'))
    expect(planJob).not.toMatch(/secrets\.|vars\./)
    expect(workflow).toContain("if: ${{ !inputs.dry-run && needs.plan.outputs.count != '0' }}")
    expect(workflow).toMatch(/dry-run:[\s\S]*?default: true/)
  })

  it.each(['', 'java', 'kotlin', 'scala', 'dotnet', 'fsharp'])('dispatches the selected language %j only when supported', (language) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-publish-dispatch-'))
    try {
      const calls = join(directory, 'calls')
      writeFileSync(join(directory, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$CALLS"
if [[ "$1" == workflow ]]; then printf 'https://github.com/example/actions/runs/123\\n'; fi
`, { mode: 0o755 })
      const body = /- name: Publish[^\n]*\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n  # The shell)/.exec(workflow)![1]
        .replace(/^ {10}/gm, '')
      execFileSync('bash', ['-c', body], { env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, CALLS: calls, GH_TOKEN: 'test',
        GITHUB_STEP_SUMMARY: join(directory, 'summary'), REPO: 'libtmux/libtmux-java',
        DISPATCH_REF: 'master', SOURCE_REF: 'reviewed-ref', VERSION: 'latest', KIND: 'trunk',
        IS_DEFAULT: 'true', RESOLVES_TO: '', LANGUAGE: language,
      } })
      const args = readFileSync(calls, 'utf8').trim().split('\n')
      expect(args.filter((arg) => arg.startsWith('language='))).toEqual(language ? [`language=${language}`] : [])
      expect(args).toContain('source-ref=reviewed-ref')
      expect(args).toContain('publish=true')
      expect(args.slice(-8)).toEqual(['run', 'watch', '123', '--repo', 'libtmux/libtmux-java', '--exit-status', '--interval', '30'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['dispatch', 'shell'])('propagates %s dispatch and child-run failures with visible diagnostics', (job) => {
    const body = (job === 'dispatch'
      ? /- name: Publish[^\n]*\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n  # The shell)/.exec(workflow)![1]
      : /  shell:\n[\s\S]*?        run: \|\n([\s\S]*)$/.exec(workflow)![1])
      .replace(/^ {10}/gm, '')
    const cases = [['success', 0], ['dispatch-failure', 17], ['invalid-id', 1], ['child-failure', 23]] as const
    for (const [mode, expected] of cases) {
      const directory = mkdtempSync(join(tmpdir(), 'libtmux-publish-failure-'))
      try {
        writeFileSync(join(directory, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1" == workflow ]]; then
  if [[ "$MODE" == dispatch-failure ]]; then echo 'dispatch refused' >&2; exit 17; fi
  if [[ "$MODE" == invalid-id ]]; then echo 'missing run URL'; exit 0; fi
  echo 'https://github.com/libtmux/docs/actions/runs/123'
elif [[ "$2" == watch ]]; then
  echo 'child run status'
  if [[ "$MODE" == child-failure ]]; then exit 23; fi
elif [[ "$2" == view ]]; then
  echo 'failed child step details'
fi
`, { mode: 0o755 })
        const result = spawnSync('bash', ['-c', body], { encoding: 'utf8', env: {
          ...process.env, PATH: `${directory}:${process.env.PATH}`, CALLS: join(directory, 'calls'),
          MODE: mode, GH_TOKEN: 'test', GITHUB_STEP_SUMMARY: join(directory, 'summary'),
          REPO: 'libtmux/docs', REF: 'main', DISPATCH_REF: 'main', SOURCE_REF: 'reviewed-ref',
          VERSION: 'latest', KIND: 'trunk', IS_DEFAULT: 'true', RESOLVES_TO: '', LANGUAGE: '',
        } })
        expect(result.status, `${job}: ${mode}: ${result.stderr}`).toBe(expected)
        const calls = readFileSync(join(directory, 'calls'), 'utf8')
        if (mode === 'dispatch-failure' || mode === 'invalid-id') {
          expect(calls).not.toContain('run watch')
          expect(result.stderr).toContain(mode === 'dispatch-failure' ? 'dispatch refused' : 'no run id')
        } else {
          expect(calls).toContain('run watch 123 --repo libtmux/docs --exit-status --interval 30')
          expect(result.stdout).toContain('child run status')
          const summary = readFileSync(join(directory, 'summary'), 'utf8')
          expect(summary).toContain('https://github.com/libtmux/docs/actions/runs/123')
          expect(summary).toContain(mode === 'success' ? 'Completed:' : 'Failed:')
          if (mode === 'child-failure') {
            expect(result.stdout).toContain('failed child step details')
            expect(result.stderr).toContain('::error::')
          }
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  })
})
