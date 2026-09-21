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
