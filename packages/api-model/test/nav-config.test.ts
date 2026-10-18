import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NAV } from '../src/nav-config.ts'
import { compileNav } from '../src/nav.ts'
import { navSidecar } from '../src/nav-sidecar.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const symbol = (
  id: string,
  name: string,
  file: string,
  apiScope: ApiSymbol['apiScope'] = 'exported',
): ApiSymbol => ({
  id,
  name,
  kind: 'class',
  modifiers: [],
  signatures: [],
  apiScope,
  source: { file },
})

it('places Rust package runtime, text and command-budget helpers by their role', () => {
  const expected = {
    runtime: ['driver.runtime.Runtime', 'driver.runtime.RuntimeExt', 'driver.runtime.AbortHandle',
      'driver.runtime.TaskHandle', 'libtmux_tokio.runtime.TokioRuntime', 'libtmux_tokio.blocking.Runtime',
      'libtmux_tokio.driver.Runtime', 'libtmux_tokio.driver.RuntimeExt', 'libtmux_tokio.driver.AbortHandle'],
    formats: ['formats.text.TmuxText', 'libtmux_core.text.TmuxText', 'text.TmuxText',
      'primitives.text.TmuxText', 'libtmux_tokio.TmuxText'],
    commands: ['limits.OutputLimits', 'libtmux_tokio.OutputLimits', 'libtmux_tokio.limits.OutputLimits',
      'cancellation.CancellationToken', 'libtmux_tokio.CancellationToken'],
    control: ['wait.WaitExt'],
  }
  const compiled = compileNav(NAV.rs, Object.values(expected).flat().map((id) =>
    symbol(id, id.split('.').at(-1)!, 'crates/libtmux/src/lib.rs')), { conceptIds: {}, moduleOf: () => '' })
  for (const [bucket, ids] of Object.entries(expected)) expect(compiled.assignments[bucket]).toEqual(ids)
  expect(compiled.diagnostics.unmatched).toEqual([])
  expect(compiled.diagnostics.ambiguous).toEqual([])
  expect(compiled.diagnostics.staleUnsettled).toEqual([])
})

describe('Lua reference navigation', () => {
  it('places public tmux objects ahead of their implementation directory', () => {
    const compiled = compileNav(
      NAV.lua,
      [
        symbol('libtmux.Server', 'Server', 'lua/libtmux/_internal/server.lua'),
        symbol('libtmux.Implementation', 'Implementation', 'lua/libtmux/_internal/implementation.lua', 'internal'),
      ],
      { conceptIds: {}, moduleOf: () => 'libtmux' },
    )
    expect(compiled.assignments.server).toContain('libtmux.Server')
    expect(compiled.assignments.internal).toContain('libtmux.Implementation')
  })
})

it('keeps explicit workspace helpers out of unrelated naming buckets', () => {
  const compiled = compileNav(
    NAV.cxx,
    [
      { ...symbol('libtmux::workspace::BuildEvent', 'BuildEvent', 'examples/workspace/include/libtmux_consumers/workspace.hpp'), kind: 'struct' },
      symbol('libtmux::OtherEvent', 'OtherEvent', 'include/libtmux/events.hpp'),
    ],
    { conceptIds: {}, moduleOf: () => 'libtmux' },
  )
  expect(compiled.assignments.workspace).toContain('libtmux::workspace::BuildEvent')
  expect(compiled.assignments.constants).toContain('libtmux::OtherEvent')
  expect(compiled.diagnostics.ambiguous).toEqual([])
})

it('groups F# command composition and dispatch failures by their task', () => {
  const compiled = compileNav(
    NAV.fsharp,
    ['Chain', 'Retry', 'TmuxFailure'].map((name) => ({
      ...symbol(`LibTmux.FSharp.${name}`, name, 'src/LibTmux.FSharp/Library.fsi'),
      kind: 'module',
    })),
    { conceptIds: {}, moduleOf: () => 'LibTmux.FSharp' },
  )
  expect(compiled.assignments.commands).toEqual(['LibTmux.FSharp.Chain', 'LibTmux.FSharp.Retry'])
  expect(compiled.assignments.errors).toEqual(['LibTmux.FSharp.TmuxFailure'])
  expect(compiled.diagnostics.unmatched).toEqual([])
  expect(compiled.diagnostics.ambiguous).toEqual([])
})

describe('native PowerShell and Julia navigation', () => {
  const model = (port: string): ApiModel => JSON.parse(
    readFileSync(new URL(`../../../site/src/data/api/${port}.json`, import.meta.url), 'utf8'),
  )

  it('places PowerShell command chains, literal pane input and owned event operations by task', () => {
    const nav = navSidecar('powershell', model('powershell'))!
    expect(nav.placement).toMatchObject({
      'LibTmux\\Invoke-TmuxChain': 'commands', 'LibTmux\\Send-TmuxText': 'pane',
      'LibTmux\\Wait-TmuxChannel': 'control', 'LibTmux\\Watch-TmuxEvent': 'control',
    })
    expect(nav.assignments.server.slice(0, 3).map((entry) => entry.id)).toEqual([
      'LibTmux\\New-TmuxServer', 'LibTmux\\Get-TmuxServer', 'LibTmux\\Connect-TmuxServer',
    ])
    expect(nav.unplaced.map((entry) => entry.id)).toEqual(['LibTmux'])
    expect(nav.diagnostics.unmatched).toEqual([])
    expect(nav.diagnostics.ambiguous).toEqual([])
    expect(nav.diagnostics.staleUnsettled).toEqual([])
  })

  it('keeps Julia predicates, native interface extensions and workspace functions with their operations', () => {
    const nav = navSidecar('julia', model('julia'))!
    const expected = {
      queries: ['Criterion', 'Selection', 'WireObject', 'Filters.OneOf', 'Filters.AllRelated',
        'RowProjection', 'Base.IndexStyle', 'Base.getindex', 'Tables.schema', 'Tables.rows'],
      control: ['ObservationCursor', 'ObservationStream', 'observe_output', 'Base.iterate', 'Base.take!'],
      snapshots: ['snapshotof', 'hascoverage', 'Base.propertynames'],
      commands: ['run_batch', 'run_group'],
      pane: ['paste_text', 'decode!', 'paneoccurrences'],
      window: ['windowlinks'],
      errors: ['CrossServerReference', 'StaleReference', 'ObservationLost', 'UnsupportedCriterion', 'Base.showerror'],
    }
    for (const [bucket, names] of Object.entries(expected)) {
      for (const name of names) expect(nav.placement[`LibTmux.${name}`], name).toBe(bucket)
    }
    expect(nav.placement['LibTmuxWorkspace.ConfigLimits']).toBe('workspace')
    for (const name of ['apply', 'freeze', 'parse_config', 'read_config', 'main', 'Base.close']) {
      expect(nav.placement[`LibTmuxWorkspace.${name}`], name).toBe('workspace-functions')
    }
    expect(nav.placement['LibTmuxWorkspace.Base.showerror']).toBe('errors')
    expect(nav.assignments.server[0].id).toBe('LibTmux.Server')
    expect(nav.assignments.session[0].id).toBe('LibTmux.sessions')
    expect(nav.buckets.slice(0, 5).map((bucket) => bucket.id)).toEqual(['server', 'session', 'window', 'pane', 'client'])
    expect(nav.diagnostics.unmatched).toEqual([])
    expect(nav.diagnostics.ambiguous).toEqual([])
    expect(nav.diagnostics.staleUnsettled).toEqual([])
    expect(nav.unplaced.map((entry) => entry.id).sort()).toEqual([
      'LibTmux', 'LibTmux.EntityRef', 'LibTmux.TmuxID', 'LibTmux.entitykey',
      ...['==', 'hash', 'isequal', 'string', 'show'].map((name) => `LibTmux.Base.${name}`),
    ].sort())
  })

  it.each(['powershell', 'julia'])('still reports a new unrelated public declaration in %s', (port) => {
    const fresh = symbol('LibTmux.Unreviewed', 'Unreviewed', 'src/model.jl')
    const nav = compileNav(NAV[port], [fresh], { conceptIds: {}, moduleOf: () => 'LibTmux' })
    expect(nav.diagnostics.unmatched).toEqual([fresh.id])
  })
})


describe('navigation checker member ownership', () => {
  const source = { file: 'src/owners.rs' }
  const owner = (id: string, kind: ApiSymbol['kind'], extra: Partial<ApiSymbol> = {}): ApiSymbol => ({
    id, name: id.split('.').at(-1)!, kind, modifiers: [], signatures: [], source, ...extra,
  })
  const declarations = (kind: ApiSymbol['kind']): NonNullable<ApiSymbol['declarations']> => [
    { kind, text: 'authored declaration', source },
  ]
  const parents = [
    owner('control.Event', 'enum'),
    owner('control.Event.Output', 'constant', { parent: 'control.Event', variant: 'struct' }),
    owner('control.Event.Tuple', 'constant', { parent: 'control.Event', variant: 'tuple' }),
    owner('control.Event.Ready', 'constant', { parent: 'control.Event', variant: 'unit' }),
    owner('control.Event.Scalar', 'constant', { parent: 'control.Event' }),
    owner('control.Container', 'struct'),
    owner('control.handler', 'function'),
    owner('constants.Direction', 'constant', { declarations: declarations('constant') }),
    owner('constants.DirectionType', 'typealias', { declarations: [...declarations('typealias'), ...declarations('constant')] }),
    owner('constants.ZERO', 'constant', { type: 'number', modifiers: ['readonly'] }),
    owner('constants.TypeOnly', 'constant', { declarations: declarations('typealias') }),
    owner('constants.callback', 'function', { declarations: declarations('constant') }),
  ]
  const fixture: ApiModel = {
    port: 'rs', extractor: 'fixture', symbols: [
      ...parents,
      ...[...parents.map((entry) => entry.id), 'control.Missing'].map((parent) =>
        owner(`${parent}.child`, parent === 'control.handler' ? 'function' : 'attribute', { parent })),
    ],
  }
  interface Failure { check: string; names: string[] }
  const check = (model: ApiModel): Failure[] => {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-nav-owners-'))
    try {
      writeFileSync(join(dir, `${model.port}.json`), JSON.stringify(model))
      writeFileSync(join(dir, `${model.port}.nav.json`), `${JSON.stringify(navSidecar(model.port, model))}\n`)
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL('../../../scripts/check-nav.mjs', import.meta.url)), '--json', '--dir', dir,
      ], { encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.stderr).toBe('')
      expect([0, 1]).toContain(result.status)
      const failures = (JSON.parse(result.stdout) as { failures: Failure[] }).failures
      // Small catalogs leave unrelated shared buckets empty; ownership is the invariant here.
      expect(failures.filter((failure) => !['dead', 'unmatched', 'unreachable'].includes(failure.check))).toEqual([])
      return failures.filter((failure) => failure.check === 'unreachable')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('accepts structured variants and constant objects that the reference tree opens', () => {
    const failures = check(fixture).flatMap((failure) => failure.names)
    for (const parent of ['control.Event.Output', 'control.Event.Tuple', 'constants.Direction']) {
      expect(failures, parent).not.toContain(`${parent}.child (in constant)`)
    }
  })

  it('accepts type owners and rejects unit variants, scalar constants, functions and missing parents', () => {
    const failures = check(fixture).flatMap((failure) => failure.names)
    for (const parent of ['control.Event', 'control.Container', 'constants.DirectionType']) {
      expect(failures.some((failure) => failure.startsWith(`${parent}.child (`)), parent).toBe(false)
    }
    for (const parent of ['control.Event.Ready', 'control.Event.Scalar', 'control.handler', 'constants.ZERO',
      'constants.TypeOnly', 'constants.callback', 'control.Missing']) {
      const kind = parents.find((entry) => entry.id === parent)?.kind ?? 'a missing parent'
      expect(failures).toContain(`${parent}.child (in ${kind})`)
    }
  })

  it('accepts every native Rust payload field in the current model', () => {
    const model: ApiModel = JSON.parse(readFileSync(new URL('../../../site/src/data/api/rs.json', import.meta.url), 'utf8'))
    const payloads = new Set(model.symbols.filter((entry) => entry.variant === 'struct' || entry.variant === 'tuple').map((entry) => entry.id))
    const fields = model.symbols.filter((entry) => entry.parent && payloads.has(entry.parent))
    for (const source of model.sources!.filter((source) => ['libtmux', 'libtmux-tokio'].includes(source.package))) {
      const prefix = source.package === 'libtmux' ? '' : 'libtmux_tokio.'
      expect(fields.filter((field) => field.parent === `${prefix}control.Event.Output`).map((field) => field.name))
        .toEqual(['pane', 'bytes'])
      expect(fields.some((field) => field.id === `${prefix}control.Subscription.Pane.0`)).toBe(true)
    }
    expect(check(model)).toEqual([])
  })
})
