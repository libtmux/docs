import { readFileSync } from 'node:fs'
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

  it('fails a leg when the port publish it started fails', () => {
    expect(workflow).toContain('gh run watch "$run_id" --repo "$REPO" --exit-status')
    expect(workflow).toContain('::error::No dispatch credential')
  })
})
