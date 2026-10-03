import { describe, expect, it } from 'vitest'
import { NAV } from '../src/nav-config.ts'
import { compileNav } from '../src/nav.ts'
import type { ApiSymbol } from '../src/model.ts'

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
