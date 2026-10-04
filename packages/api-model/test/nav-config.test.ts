import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NAV } from '../src/nav-config.ts'
import { compileNav } from '../src/nav.ts'
import { navSidecar } from '../src/nav-sidecar.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const symbol = (id: string, name: string, file: string, apiScope: ApiSymbol['apiScope'] = 'exported'): ApiSymbol => ({
  id,
  name,
  kind: 'class',
  modifiers: [],
  signatures: [],
  apiScope,
  source: { file },
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
      {
        ...symbol(
          'libtmux::workspace::BuildEvent',
          'BuildEvent',
          'examples/workspace/include/libtmux_consumers/workspace.hpp',
        ),
        kind: 'struct',
      },
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
  const model = (port: string): ApiModel =>
    JSON.parse(readFileSync(new URL(`../../../site/src/data/api/${port}.json`, import.meta.url), 'utf8'))

  it('places PowerShell command chains, literal pane input and owned event operations by task', () => {
    const nav = navSidecar('powershell', model('powershell'))!
    expect(nav.placement).toMatchObject({
      'LibTmux\\Invoke-TmuxChain': 'commands',
      'LibTmux\\Send-TmuxText': 'pane',
      'LibTmux\\Wait-TmuxChannel': 'control',
      'LibTmux\\Watch-TmuxEvent': 'control',
    })
    expect(nav.assignments.server.slice(0, 3).map((entry) => entry.id)).toEqual([
      'LibTmux\\New-TmuxServer',
      'LibTmux\\Get-TmuxServer',
      'LibTmux\\Connect-TmuxServer',
    ])
    expect(nav.unplaced.map((entry) => entry.id)).toEqual(['LibTmux'])
    expect(nav.diagnostics.unmatched).toEqual([])
    expect(nav.diagnostics.ambiguous).toEqual([])
    expect(nav.diagnostics.staleUnsettled).toEqual([])
  })

  it('keeps Julia predicates, native interface extensions and workspace functions with their operations', () => {
    const nav = navSidecar('julia', model('julia'))!
    const expected = {
      queries: [
        'Criterion',
        'Selection',
        'WireObject',
        'Filters.OneOf',
        'Filters.AllRelated',
        'RowProjection',
        'Base.IndexStyle',
        'Base.getindex',
        'Tables.schema',
        'Tables.rows',
      ],
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
    expect(nav.buckets.slice(0, 5).map((bucket) => bucket.id)).toEqual([
      'server',
      'session',
      'window',
      'pane',
      'client',
    ])
    expect(nav.diagnostics.unmatched).toEqual([])
    expect(nav.diagnostics.ambiguous).toEqual([])
    expect(nav.diagnostics.staleUnsettled).toEqual([])
    expect(nav.unplaced.map((entry) => entry.id).sort()).toEqual(
      [
        'LibTmux',
        'LibTmux.EntityRef',
        'LibTmux.TmuxID',
        'LibTmux.entitykey',
        ...['==', 'hash', 'isequal', 'string', 'show'].map((name) => `LibTmux.Base.${name}`),
      ].sort(),
    )
  })

  it.each(['powershell', 'julia'])('still reports a new unrelated public declaration in %s', (port) => {
    const fresh = symbol('LibTmux.Unreviewed', 'Unreviewed', 'src/model.jl')
    const nav = compileNav(NAV[port], [fresh], { conceptIds: {}, moduleOf: () => 'LibTmux' })
    expect(nav.diagnostics.unmatched).toEqual([fresh.id])
  })
})
