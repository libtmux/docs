import { describe, expect, it } from 'vitest'
import { rewriteLinks, stagedPortGuides, stagedRoutesFor } from '../../scripts/stage-port-docs.mjs'

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

  it('takes reader routes and aliases from the port documentation catalog', () => {
    expect(stagedRoutesFor('ruby')['gems/libtmux-async/README.md']).toMatchObject({
      route: 'guides/async',
      aliases: ['guides/source/async'],
      package: 'async',
    })
    expect(stagedRoutesFor('lua')['docs/runtime.md']).toMatchObject({
      route: 'guides/runtime',
      aliases: ['guides/source/runtime'],
      domain: 'runtime',
    })
  })

  it('rewrites source-relative links to canonical catalog routes', () => {
    const catalog = stagedRoutesFor('lua')
    const routes = Object.fromEntries(Object.entries(catalog).map(([path, guide]) => [path, [guide.route]]))
    const result = rewriteLinks(
      '[query](query.md#filters)',
      'docs/runtime.md',
      catalog['docs/runtime.md'].route,
      routes,
      'libtmux/libtmux-lua',
      'abc123',
    )
    expect(result).toContain('[query](../query/#filters)')
  })

  it('stages canonical routes with aliases and reader domain metadata', () => {
    const guides = Object.keys(stagedRoutesFor('ruby')).map((path) => ({ path, content: '# Guide\n\nbody\n' }))
    const files = stagedPortGuides('ruby', {
      source: { repository: 'libtmux/libtmux-ruby', revision: '0123456789abcdef' },
      guides,
    })
    const async = files.get('ruby/guides/async/index.md')
    expect(async).toContain('aliases: ["guides/source/async"]')
    expect(async).toContain('package: "async"')
    expect(async).toContain('domain: "async"')
  })
})
