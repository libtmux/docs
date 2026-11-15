import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { badgesStale, findOffOriginBadges, localizeBadges } from '../../scripts/lib/badges.mjs'
import { stagedPortGuides } from '../../scripts/stage-port-docs.mjs'

const registry = { ports: { ruby: { version: '0.1.0', packages: { libtmux: { version: '0.1.0' }, 'libtmux-async': { version: '1.2.0' } } } } }
const guideCache = join(import.meta.dirname, '../src/data/port-guides')
const cached = readdirSync(guideCache).map((file) => file.replace(/\.json$/, ''))

describe('staged guides serve badges from the site origin', () => {
  it.each(cached)('%s guides hold no off-origin badge', (port) => {
    const artifact = JSON.parse(readFileSync(join(guideCache, `${port}.json`), 'utf8'))
    const staged = stagedPortGuides(port, artifact)
    expect([...staged].filter(([file]) => !file.startsWith('badges/')).flatMap(([, text]) => findOffOriginBadges(text))).toEqual([])
  })

  it('flags a guide that brings its own badge (negative control)', () => {
    expect(findOffOriginBadges('[![x](https://img.shields.io/badge/a-b-blue)](https://example.com)')).toHaveLength(1)
    expect(findOffOriginBadges('<img src="https://github.com/o/r/actions/workflows/ci.yml/badge.svg">')).toHaveLength(1)
    expect(findOffOriginBadges('[![x](/badges/abc.svg)](https://rubygems.org/gems/libtmux)')).toEqual([])
  })
})

describe('pages outside the guide cache', () => {
  it('embed no off-origin badge', () => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
    const content = join(import.meta.dirname, '../src/content')
    expect(walk(content).filter((file) => /\.mdx?$/.test(file)).flatMap((file) => findOffOriginBadges(readFileSync(file, 'utf8')).map((url) => `${file}: ${url}`))).toEqual([])
  })
})

describe('localizeBadges', () => {
  it('renders a static badge with its label, message, colour and link', () => {
    const { content, files } = localizeBadges('[![docs](https://img.shields.io/badge/docs-libtmux.org-0b7285)](https://libtmux.org/)', 'ruby', registry)
    expect(content).toMatch(/^\[!\[docs\]\(\/badges\/[0-9a-f]{12}\.svg\)\]\(https:\/\/libtmux\.org\/\)$/)
    const [svg] = [...files.values()]
    expect(svg).toContain('aria-label="docs: libtmux.org"')
    expect(svg).toContain('fill="#0b7285"')
  })

  it('takes a registry version from staged data and colours a pre-1.0 release orange', () => {
    const { files } = localizeBadges('![libtmux](https://img.shields.io/gem/v/libtmux?label=libtmux)', 'ruby', registry)
    expect([...files.values()][0]).toContain('aria-label="libtmux: v0.1.0"')
    expect([...files.values()][0]).toContain('#ea7233')
    const stable = localizeBadges('![a](https://img.shields.io/gem/v/libtmux-async)', 'ruby', registry).files
    expect([...stable.values()][0]).toContain('aria-label="gem: v1.2.0"')
    expect([...stable.values()][0]).toContain('#007ec6')
  })

  it.each([
    ['0.62.0', '#ea7233'],
    ['0.1.0-1', '#ea7233'],
    ['1.0.0', '#007ec6'],
    ['10.2.0', '#007ec6'],
    ['1.0.0-rc.1', '#ea7233'],
    ['2.0.0-beta.3', '#ea7233'],
    ['3.1.0-SNAPSHOT', '#ea7233'],
    ['v0.1.0', '#ea7233'],
    ['v1.4.0', '#007ec6'],
  ])('colours version %s as shields does (%s)', (version, colour) => {
    const data = { ports: { ruby: { version, packages: { libtmux: { version } } } } }
    const [svg] = localizeBadges('![a](https://img.shields.io/gem/v/libtmux)', 'ruby', data).files.values()
    expect(svg).toContain(`fill="${colour}"`)
    expect(svg).toContain(`aria-label="gem: ${version.startsWith('v') ? version : `v${version}`}"`)
  })

  it.each([
    ['lua', 'https://img.shields.io/luarocks/v/tony/libtmux', '0.1.0-1', 'luarocks: v0.1.0-1'],
    ['elixir', 'https://img.shields.io/hexpm/v/libtmux', '0.1.0', 'hex: v0.1.0'],
    ['kotlin', 'https://img.shields.io/maven-central/v/io.github.libtmux/libtmux-kotlin', '0.1.0', 'maven-central: v0.1.0'],
    ['scala', 'https://img.shields.io/maven-central/v/io.github.libtmux/libtmux-scala_3', '0.1.0', 'maven-central: v0.1.0'],
    ['perl', 'https://img.shields.io/cpan/v/LibTmux', '0.003', 'cpan: v0.003'],
  ])('renders the %s registry badge from a port entry without packages', (port, url, version, aria) => {
    const data = { ports: { [port]: { version } } }
    const [svg] = localizeBadges(`![x](${url})`, port, data).files.values()
    expect(svg).toContain(`aria-label="${aria}"`)
    expect(svg).toContain('fill="#ea7233"')
    const [labelled] = localizeBadges(`![x](${url}?label=libtmux)`, port, data).files.values()
    expect(labelled).toContain(`aria-label="libtmux: v${version}"`)
  })

  it('does not double the v of a registry version that has one', () => {
    const [svg] = localizeBadges('![a](https://img.shields.io/gem/v/x)', 'go', { ports: { go: { packages: { x: { version: 'v0.1.0' } } } } }).files.values()
    expect(svg).toContain('aria-label="gem: v0.1.0"')
    expect(svg).not.toContain('vv0.1.0')
  })

  it('is deterministic and shares one file between identical badges', () => {
    const text = '![a](https://img.shields.io/badge/license-MIT-blue) ![b](https://img.shields.io/badge/license-MIT-blue)'
    const first = localizeBadges(text, 'ruby', registry)
    expect(first.files.size).toBe(1)
    expect(localizeBadges(text, 'ruby', registry).content).toBe(first.content)
  })

  it('drops a CI status badge and its link', () => {
    const { content } = localizeBadges('[![ci](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://github.com/o/r/actions/workflows/ci.yml) after', 'ruby', registry)
    expect(content).toBe(' after')
  })

  it('renders and drops the badges of a README written as HTML', () => {
    const { content, files } = localizeBadges([
      '<p>',
      '  <a href="https://github.com/o/r/actions/workflows/ci.yml"><img src="https://github.com/o/r/actions/workflows/ci.yml/badge.svg" alt="checks"></a>',
      '  <a href="https://libtmux.org/"><img src="https://img.shields.io/badge/docs-libtmux.org-0b7285" alt="docs"></a>',
      '</p>',
    ].join('\n'), 'ruby', registry)
    expect(content).not.toContain('actions/workflows')
    expect(content).toMatch(/<a href="https:\/\/libtmux\.org\/"><img src="\/badges\/[0-9a-f]{12}\.svg" alt="docs"><\/a>/)
    expect(findOffOriginBadges(content)).toEqual([])
    expect([...files.values()]).toHaveLength(1)
    expect([...files.values()][0]).toContain('aria-label="docs: libtmux.org"')
  })

  it('refuses a badge it cannot render rather than hotlinking it', () => {
    expect(() => localizeBadges('![x](https://img.shields.io/github/stars/o/r)', 'ruby', registry)).toThrow(/unsupported badge/)
    expect(() => localizeBadges('![x](https://img.shields.io/hexpm/dt/libtmux)', 'elixir', { ports: { elixir: { version: '0.1.0' } } })).toThrow(/unsupported badge/)
    expect(() => localizeBadges('![x](https://img.shields.io/maven-central/v/libtmux)', 'kotlin', { ports: { kotlin: { version: '0.1.0' } } })).toThrow(/unsupported badge/)
    expect(() => localizeBadges('![x](https://img.shields.io/gem/v/missing)', 'ruby', registry)).toThrow(/registry data does not carry/)
    expect(() => localizeBadges('<img src="https://img.shields.io/github/stars/o/r">', 'ruby', registry)).toThrow(/unsupported badge/)
  })
})

describe('stage --check compares badge files', () => {
  let directory = ''
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'libtmux-badges-')) })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))
  const files = new Map([['badges/abc123abc123.svg', '<svg>a</svg>']])

  it('is stale when a badge file is missing or holds other bytes, and clean when it matches', () => {
    expect(badgesStale(files, directory)).toBe(true)
    writeFileSync(join(directory, 'abc123abc123.svg'), '<svg>other</svg>')
    expect(badgesStale(files, directory)).toBe(true)
    writeFileSync(join(directory, 'abc123abc123.svg'), '<svg>a</svg>')
    expect(badgesStale(files, directory)).toBe(false)
  })

  it('ignores guide files and badge files that belong to other ports', () => {
    writeFileSync(join(directory, 'abc123abc123.svg'), '<svg>a</svg>')
    writeFileSync(join(directory, 'other-port.svg'), '<svg>b</svg>')
    expect(badgesStale(new Map([...files, ['ruby/index.md', '# x']]), directory)).toBe(false)
  })
})

describe('badge URLs in a rendered guide', () => {
  afterEach(() => vi.unstubAllEnvs())

  const render = async (port: string, markdown = '![x](/badges/abc.svg)', root = '') => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', port)
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    vi.stubEnv('LIBTMUX_DOCS_ROOT', root)
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', root)
    vi.resetModules()
    const { rehypeSiteRoot } = await import('../src/plugins/rehype-site-root.mjs')
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeSiteRoot], syntaxHighlight: false })
    return (await processor.render(markdown, { frontmatter: { port: 'ruby' } })).code
  }

  // Erlang's README header is HTML, so its localized badges are raw `<img>` tags, not Markdown images.
  const htmlHeader = '<p>\n  <a href="https://hex.pm/packages/x"><img src="/badges/abc.svg" alt="x"></a>\n</p>'

  it('serves an HTML header\'s badges from the port build\'s own mount', async () => {
    const html = await render('ruby', htmlHeader)
    expect(html).toContain('src="/ruby/latest/badges/abc.svg"')
    expect(html).not.toContain('src="/badges/')
  })

  it('keeps an HTML header\'s badges inside a preview root', async () => {
    expect(await render('ruby', htmlHeader, '/pr-317')).toContain('src="/pr-317/ruby/latest/badges/abc.svg"')
  })

  it('serves a port build\'s badges from its own mount', async () => {
    expect(await render('ruby')).toContain('src="/ruby/latest/badges/abc.svg"')
  })

  it('serves badges from the root when no port is being built', async () => {
    expect(await render('')).toContain('src="/badges/abc.svg"')
  })
})
