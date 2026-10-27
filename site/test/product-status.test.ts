import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONCEPT_DESCRIPTION, PORT_BY_SLUG, PORTS, PRODUCT_STATUS_GUIDE, PRODUCT_STATUS_LINK, productAvailable, productStatusLine, isReleaseSeries, productStatus, releaseMaturity,
  type ProductStatus, type RegistryEntry,
} from '../src/lib/ports'
import { REGISTRY } from '../src/lib/registry'
import { newestPublishedTag, releaseTag, type TagGrammar } from '../src/lib/versions'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const entry = (overrides: Partial<RegistryEntry>): RegistryEntry => ({ status: 'prerelease', version: null, release: null, tag: null, ...overrides })

// What the registry resolver recorded for Julia when its first final release
// was tagged and General did not carry it yet.
const JULIA_FINAL_TAG: RegistryEntry = { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }

describe('release maturity', () => {
  it.each([
    ['0.0.1-alpha.17', 'alpha'], ['v0.0.1-alpha.10', 'alpha'], ['0.1.0.alpha.2', 'alpha'], ['0.1.0alpha1-1', 'alpha'],
    ['0.1.0-alpha2', 'alpha'], ['0.1.0a22', 'alpha'], ['0.1.0b3', 'beta'], ['1.0.0-beta.2', 'beta'], ['1.0.0-rc.1', 'rc'], ['1.0.0rc1', 'rc'],
  ])('reads the stage of %s as %s', (version, stage) => {
    expect(releaseMaturity(entry({ version }))).toBe(stage)
  })

  it('reads an unpublished package from its tag, and one with neither as unreleased', () => {
    expect(releaseMaturity(entry({ status: 'unpublished', tag: 'v0.1.0-alpha.11' }))).toBe('alpha')
    expect(releaseMaturity(entry({ status: 'unpublished' }))).toBe('unreleased')
  })

  it('lets a registry declaration outrank the version and a final release outrank the rest', () => {
    expect(releaseMaturity(entry({ version: '0.1.0a22', maturity: 'pre-alpha' }))).toBe('pre-alpha')
    expect(releaseMaturity(entry({ status: 'release', version: '1.74.0', release: '1.74.0' }))).toBe('1.x')
    // Neither outcome comes from the name: a declared stage beats a final name, and a release
    // status beats a LuaRocks revision (`-1`) that the name grammar refuses.
    expect(releaseMaturity(entry({ version: '1.74.0', maturity: 'beta' }))).toBe('beta')
    expect(releaseMaturity(entry({ status: 'release', version: '0.1.0-1' }))).toBe('0.x')
  })

  it('refuses a prerelease whose stage it cannot read', () => {
    expect(() => releaseMaturity(entry({ version: '0.1.0-dev.3' }))).toThrow(/no release stage in "0.1.0-dev.3"/)
  })

  it('reads the live Julia entry, a final tag that General does not carry yet, as 0.x', () => {
    expect(releaseMaturity(JULIA_FINAL_TAG)).toBe('0.x')
  })

  it.each([
    'v0.1.0', '0.1.0', 'libtmux@v0.1.0', 'libtmux@0.1.0', 'tmux-workspace@v0.1.0', 'workspace/v0.1.0',
  ])('reads the final release %s, below 1.0, as 0.x, from a tag or a version', (name) => {
    expect(releaseMaturity(entry({ status: 'unpublished', tag: name }))).toBe('0.x')
    expect(releaseMaturity(entry({ version: name }))).toBe('0.x')
  })

  it.each([
    'v10.20.30', 'v1.0.0', 'mcp/v1.2.3',
    // A stage word in the package label is not the release's stage.
    'arc-tools@v1.0.0',
  ])('reads the final release %s, from 1.0, as its series, from a tag or a version', (name) => {
    const series = `${/(\d+)\.\d+\.\d+$/.exec(name)![1]}.x`
    expect(releaseMaturity(entry({ status: 'unpublished', tag: name }))).toBe(series)
    expect(releaseMaturity(entry({ version: name }))).toBe(series)
  })

  it('reads a registry release as its series and never names a stage beyond rc', () => {
    expect(releaseMaturity(entry({ status: 'release', version: '0.1.0', release: '0.1.0' }))).toBe('0.x')
    expect(releaseMaturity(entry({ status: 'release', version: 'v0.1.0', release: 'v0.1.0', tag: 'v0.1.0' }))).toBe('0.x')
    expect(releaseMaturity(entry({ status: 'release', version: '1.76.0', release: '1.76.0' }))).toBe('1.x')
    for (const value of Object.values(REGISTRY.ports).flatMap((port) => [port, ...Object.values(port.packages ?? {})])) {
      expect(['pre-alpha', 'alpha', 'beta', 'rc', 'unreleased'].includes(releaseMaturity(value)) ||
        isReleaseSeries(releaseMaturity(value))).toBe(true)
    }
  })

  it.each([
    '0.1.0-dev.3', 'v0.1.0-dev.3', '0.1.0.dev1', '0.1.0.post1', '0.1.0+build.5', 'v0.1.0-1', '0.1.0-snapshot', 'libtmux@v0.1.0-dev.3',
    'workspace/0.1.0-x', 'v1.0', 'v1', '1.0.0.0', '01.0.0', 'latest', 'master', 'v0.1.0 ', '@v0.1.0', 'tmux-workspace@', '/v1.0.0',
  ])('refuses %j, a name whose marker it cannot place', (name) => {
    expect(() => releaseMaturity(entry({ status: 'unpublished', tag: name }))).toThrow(`no release stage in "${name}"`)
    expect(() => releaseMaturity(entry({ version: name }))).toThrow(`no release stage in "${name}"`)
  })

  const PRERELEASE_TAG: Record<TagGrammar, string> = {
    semver: 'v0.1.0-alpha.1', pep440: 'v0.1.0a1', rubygems: 'v0.1.0.alpha.1', luarocks: 'v0.1.0alpha1',
  }

  it.each(PORTS)('reads every tag $slug records, final or alpha, as its stage', (port) => {
    const prefix = port.tagPrefix ?? ''
    const final = `${prefix}v0.1.0`
    const alpha = `${prefix}${PRERELEASE_TAG[port.tagGrammar]}`
    // The resolver stores a tag only when the port's own grammar accepts it.
    expect(releaseTag(final, port), final).not.toBeNull()
    expect(releaseTag(alpha, port), alpha).not.toBeNull()
    expect(releaseMaturity(entry({ status: 'unpublished', tag: final })), final).toBe('0.x')
    expect(releaseMaturity(entry({ status: 'unpublished', tag: alpha })), alpha).toBe('alpha')
  })

  it('reads a stage for every package the registry records', () => {
    for (const [slug, port] of Object.entries(REGISTRY.ports)) {
      for (const [name, item] of [[slug, port], ...Object.entries(port.packages ?? {})] as const) {
        expect(() => releaseMaturity(item), `${slug} ${name}`).not.toThrow()
      }
    }
  })
})

describe('product status', () => {
  const table = (slug: string) => {
    const port = PORTS.find((entry) => entry.slug === slug)!
    return Object.fromEntries((['core', 'mcp', 'workspace'] as const)
      .filter((product) => product === 'core' || productAvailable(port, product))
      .map((product) => [product, productStatus(port, product, REGISTRY)]))
  }

  it('states the stage or series of each of Python\'s PyPI projects', () => {
    expect(table('py')).toEqual({ core: '0.x', mcp: 'pre-alpha', workspace: '1.x' })
    const { packages } = REGISTRY.ports.py!
    expect(Object.keys(packages!).sort()).toEqual(['libtmux', 'libtmux-mcp', 'tmuxp'])
    // The MCP server and tmuxp release from their own repositories, so libtmux's tag is not theirs.
    expect(packages!['libtmux-mcp']!.tag).toBeNull()
    expect(packages!.tmuxp!.tag).toBeNull()
  })

  it('badges the library with its stage and every other port companion as a concept', () => {
    expect(table('go')).toEqual({ core: '0.x', mcp: 'concept', workspace: 'concept' })
    expect(table('java')).toEqual({ core: '0.x', mcp: 'concept', workspace: 'concept' })
    expect(table('powershell')).toEqual({ core: '0.x', workspace: 'concept' })
    expect(table('kotlin')).toEqual({ core: '0.x' })
  })

  it.each(PORTS)('gives every available product of $slug a badge', (port) => {
    for (const product of ['core', 'mcp', 'workspace'] as const) {
      if (product !== 'core' && !productAvailable(port, product)) continue
      const status = productStatus(port, product, REGISTRY)
      expect(status, `${port.slug} ${product}`).toBeDefined()
      expect(productStatusLine(status as ProductStatus).length).toBeGreaterThan(10)
    }
  })

  it('badges Julia 0.x from its final tag and states the line without naming a registry', async () => {
    const julia = PORT_BY_SLUG.julia!
    const status = productStatus(julia, 'core', { schema: 2, ports: { julia: JULIA_FINAL_TAG } })
    expect(status).toBe('0.x')
    // Python's releases are on PyPI and Julia's is not on General; one line has to be true of both.
    expect(productStatusLine('0.x')).not.toMatch(/registry/i)
    const html = await renderAstroTemplate(await loadAstroTemplate('components/StatusBadge.astro'), {
      props: { status, product: julia.projectName, id: 'julia-core-status' },
    })
    expect(html).toContain('data-status="0.x"')
    expect(html).toContain(`<span class="status-toggletip__line">${productStatusLine('0.x')}</span>`)
  })

  it.each([
    ['General lists nothing', null, { status: 'unpublished', version: null, release: null, tag: 'v0.1.0' }, '0.x'],
    ['General lists only 0.1.0-alpha.2', ['0.1.0-alpha.2'], { status: 'prerelease', version: '0.1.0-alpha.2', release: null, tag: 'v0.1.0-alpha.2' }, 'alpha'],
    ['General lists 0.1.0', ['0.1.0'], { status: 'release', version: '0.1.0', release: '0.1.0', tag: 'v0.1.0' }, '0.x'],
  ] as const)('reads the newest release tag only while the registry lists no release: %s', (_state, published, resolved, stage) => {
    // The repository carries both tags in every state; the resolver records v0.1.0 only when nothing or v0.1.0 is listed.
    expect(newestPublishedTag(['v0.1.0-alpha.2', 'v0.1.0'], PORT_BY_SLUG.julia!, published)).toBe(resolved.tag)
    expect(releaseMaturity(resolved)).toBe(stage)
  })

  it('keeps the support page to the scope of that rule', () => {
    const page = readFileSync(new URL('../src/pages/meta/support.astro', import.meta.url), 'utf8').replace(/\s+/g, ' ')
    expect(page).toContain('lists no release at all')
    expect(page).toContain('exactly <code>MAJOR.MINOR.PATCH</code>')
  })

  it('keeps each badge line short, apart from the long description that only the guide and data carry', () => {
    const statuses: ProductStatus[] = ['concept', 'pre-alpha', 'alpha', 'beta', 'rc', '0.x', '1.x', 'unreleased']
    for (const [status, line] of statuses.map((status) => [status, productStatusLine(status)] as const)) {
      // About eight words and sixty characters: a toggletip is a label, not a paragraph.
      expect(line.length, status).toBeLessThanOrEqual(60)
      expect(line.split(/\s+/).length, status).toBeLessThanOrEqual(8)
      expect(line, status).toMatch(/^[A-Z][^.]*\.$/)
      expect(line, status).not.toBe(CONCEPT_DESCRIPTION)
    }
    expect(new Set(statuses.map(productStatusLine)).size).toBe(statuses.length - 1)
    expect(PRODUCT_STATUS_LINK).toBe('Read more')
    expect(PRODUCT_STATUS_GUIDE).toBe('/meta/support/#concept-and-alpha')
  })
})
