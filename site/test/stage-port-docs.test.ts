import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { artifactFromRevision, rewriteLinks, stagedPortGuides, stagedRoutesFor } from '../../scripts/stage-port-docs.mjs'
import { PORTS } from '../src/lib/ports'
import scalaGuides from '../src/data/port-guides/scala.json'
import fsharpGuides from '../src/data/port-guides/fsharp.json'

describe('integrated guide inputs', () => {
  const port = PORTS.find((entry) => entry.slug === 'lua')!

  it('reads the integrated commit regardless of newer HEAD or dirty files', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'libtmux-integrated-guides-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
    try {
      git('init', '-q')
      for (const path of Object.keys(stagedRoutesFor('lua'))) {
        mkdirSync(dirname(join(checkout, path)), { recursive: true })
        writeFileSync(join(checkout, path), '# Integrated guide\n')
      }
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'integrated')
      const revision = git('rev-parse', 'HEAD')
      writeFileSync(join(checkout, 'README.md'), '# Newer guide\n')
      git('add', '.')
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'newer')
      writeFileSync(join(checkout, 'README.md'), '# Dirty guide\n')
      const artifact = artifactFromRevision(port, checkout, revision)
      expect(artifact.source).toEqual({ repository: port.repo, revision })
      expect(artifact.guides.length).toBe(Object.keys(stagedRoutesFor('lua')).length)
      expect(artifact.guides.every((guide: { content: string }) => guide.content === '# Integrated guide\n')).toBe(true)
    } finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it.each(['missing-checkout', 'missing-commit'])('reports the exact setup requirement for %s', (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-missing-guides-'))
    const checkout = mode === 'missing-checkout' ? join(directory, 'absent') : directory
    try {
      if (mode === 'missing-commit') execFileSync('git', ['-C', checkout, 'init', '-q'])
      expect(() => artifactFromRevision(port, checkout, 'a'.repeat(40)))
        .toThrow(`integrated guides need libtmux/libtmux-lua@${'a'.repeat(40)} in ${checkout}. Set LIBTMUX_DOCS_CHECKOUT_LUA to a local checkout containing that commit; this check does not fetch.`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

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

  it('keeps known source-guide URLs in the selected documentation tree', () => {
    const own = 'https://github.com/libtmux/libtmux-lua/blob/'
    const historical = `${own}older/docs/query.md`
    const otherRepo = 'https://github.com/other/project/blob/master/docs/query.md'
    const example = `\`${own}master/docs/query.md\``
    const result = rewriteLinks(
      `[current](${own}master/docs/query.md#filters) [main](${own}main/docs/query.md) `
        + `[pinned](${own}abc123/docs/query.md) [old](${historical}) [other](${otherRepo}) ${example}`,
      'docs/runtime.md', 'guides/source/runtime', routes, 'libtmux/libtmux-lua', 'abc123',
    )
    expect(result).toContain('[current](../query/#filters)')
    expect(result).toContain('[main](../query/)')
    expect(result).toContain('[pinned](../query/)')
    expect(result).toContain(`[old](${historical})`)
    expect(result).toContain(`[other](${otherRepo})`)
    expect(result).toContain(example)
  })

  it('routes the actual F# quickstart to its staged task guides', () => {
    const staged = stagedPortGuides('fsharp', fsharpGuides).get('fsharp/guides/quickstart/index.md')!
    for (const route of ['getting-started', 'queries', 'streams', 'supported-query-fields', 'modes', 'interop']) {
      expect(staged).toContain(`](../${route}/)`)
    }
    expect(staged).toContain('](../api-overview/)')
    expect(staged).not.toMatch(/https:\/\/github.com\/libtmux\/libtmux-dotnet\/blob\/master\/docs\/fsharp\//)
    expect(staged).toContain(`https://github.com/libtmux/libtmux-dotnet/blob/${fsharpGuides.source.revision}/examples/LibTmux.FSharp.Quickstart/Program.fs`)
  })

  it('pins non-staged source links while preserving historical links and inline images', () => {
    const own = 'https://github.com/libtmux/libtmux-lua/blob/'
    const destinations = ['master', 'main', 'abc123'].map((ref) => `[source](${own}${ref}/src/main.lua#run)`)
    const image = `![source](${own}master/art/example.png)`
    const historical = `[old](${own}older/src/main.lua#run)`
    const result = rewriteLinks([...destinations, image, historical].join('\n\n'),
      'docs/runtime.md', 'guides/source/runtime', routes, 'libtmux/libtmux-lua', 'abc123')
    expect(result.match(/\[source\]\(https:\/\/github.com\/libtmux\/libtmux-lua\/blob\/abc123\/src\/main.lua#run\)/g)).toHaveLength(3)
    expect(result).toContain(image)
    expect(result).toContain(historical)
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

  it('preserves code while rewriting real links beside it', () => {
    const examples = [
      '```scala\nScalaServer.fromJava[IO](java).use(identity)\n```',
      '~~~~scala\nScalaServer.resource[IO](config).use(identity)\n~~~~',
      '> ```scala\n> Control.attach[IO](session)\n> ```',
      '    Server.resource[IO](config)',
      '`Server.resource[IO](config)` and ``[query](query.md)``',
      '\\[query](query.md)',
    ]
    const content = `${examples.join('\n\n')}\n\n[query](query.md#filters "Read filters")\n`
    const result = rewriteLinks(content, 'docs/runtime.md', 'guides/source/runtime', routes,
      'libtmux/libtmux-java', 'abc123')
    for (const example of examples) expect(result).toContain(example)
    expect(result).toContain('[query](../query/#filters "Read filters")')
    expect(result).not.toContain('/docs/config')
    expect(result).not.toContain('/docs/java')
    expect(result).not.toContain('/docs/session')
  })

  it('rewrites images nested in links without damaging their labels', () => {
    const result = rewriteLinks('[![example](../art/example.png "Example")](query.md#filters)',
      'docs/runtime.md', 'guides/source/runtime', routes, 'libtmux/libtmux-java', 'abc123')
    expect(result).toContain('[![example](https://github.com/libtmux/libtmux-java/raw/abc123/art/example.png "Example")](../query/#filters)')
  })

  it('stages the actual Scala generic calls unchanged', () => {
    const files = stagedPortGuides('scala', scalaGuides)
    for (const [route, calls] of [
      ['ownership', ['ScalaServer.fromJava[IO](java)']],
      ['execution', ['ScalaServer.resource[IO](config)']],
      ['streaming', ['Server.resource[IO](config)', 'Control.attach[IO](session)']],
    ] as const) {
      const staged = files.get(`scala/guides/${route}/index.md`)!
      for (const call of calls) expect(staged).toContain(call)
      expect(staged).not.toContain('[IO](https://')
    }
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
