import { describe, expect, it } from 'vitest'
import { rewriteLinks } from '../../scripts/stage-port-docs.mjs'

describe('staged port guide links', () => {
  const routes = {
    'docs/runtime.md': ['guides/source/runtime'],
    'docs/query.md': ['guides/source/query'],
  } as Record<string, string[]>

  it('routes selected guides and pins other source files', () => {
    const result = rewriteLinks(
      '[query](query.md#filters) [fixture](../tests/runtime.lua)',
      'docs/runtime.md',
      'guides/source/runtime',
      routes,
      'libtmux/libtmux-lua',
      'abc123',
    )
    expect(result).toContain('[query](../query/#filters)')
    expect(result).toContain('https://github.com/libtmux/libtmux-lua/blob/abc123/tests/runtime.lua')
  })
})
