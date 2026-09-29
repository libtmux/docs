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

  it('rewrites Scala reference links across lines without changing external links', () => {
    const result = rewriteLinks(
      '[query]: query.md#filters\n[source]:\n  ../src/Server.scala\n[external]: https://example.org/\n',
      'docs/runtime.md', 'guides/source/runtime', routes, 'libtmux/libtmux-java', 'abc123',
    )
    expect(result).toContain('[query]: ../query/#filters')
    expect(result).toContain('[source]: https://github.com/libtmux/libtmux-java/blob/abc123/src/Server.scala')
    expect(result).toContain('[external]: https://example.org/')
  })

  it('extracts centered README titles without losing links or examples', () => {
    const header = [
      '<!-- libtmux-logo -->', '<p>artwork</p>', '<!-- /libtmux-logo -->', '',
      '<div align="center">', '', '# libtmux for Ruby', '',
      'Create tmux sessions from Ruby. [Guide](docs/modes.md)', '', '</div>', '',
      '## Example', '', '```ruby', 'puts "hello"', '```', '',
      '<div align="center">', '', 'A later centered block.', '', '</div>', '',
    ].join('\n')
    const guides = Object.keys(stagedRoutesFor('ruby')).map((path) => ({
      path, content: path === 'README.md' ? header : '# Guide\n\nbody\n',
    }))
    const files = stagedPortGuides('ruby', {
      source: { repository: 'libtmux/libtmux-ruby', revision: '0123456789abcdef' },
      guides,
    })
    const overview = files.get('ruby/guides/overview/index.md')!
    expect(files.get('ruby/examples/index.md')).toContain('../examples/recipes/')
    expect(files.get('ruby/topics/index.md')).toContain('../guides/execution-modes/')
    expect(overview).toContain('title: "libtmux for Ruby"')
    expect(overview).not.toContain('# libtmux for Ruby')
    expect(overview).not.toContain('artwork')
    expect(overview).toContain('Create tmux sessions from Ruby. [Guide](../execution-modes/)')
    expect(overview).toContain('```ruby\nputs "hello"\n```')
    expect(overview).toContain('<div align="center">\n\nA later centered block.\n\n</div>')
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
