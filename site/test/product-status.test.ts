import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CONCEPT_DESCRIPTION, PORT_BY_SLUG, PORTS, PRODUCT_STATUS_GUIDE, PRODUCT_STATUS_LINE, PRODUCT_STATUS_LINK, productAvailable, productStatus, releaseMaturity,
  type ProductStatus, type RegistryEntry,
} from '../src/lib/ports'
import { REGISTRY } from '../src/lib/registry'
import { newestPublishedTag, releaseTag, type TagGrammar } from '../src/lib/versions'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const entry = (overrides: Partial<RegistryEntry>): RegistryEntry => ({ status: 'prerelease', version: null, stable: null, tag: null, ...overrides })

// What the registry resolver recorded for Julia when its first final release
// was tagged and General did not carry it yet.
const JULIA_FINAL_TAG: RegistryEntry = { status: 'unpublished', version: null, stable: null, tag: 'v0.1.0' }

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

  it('lets a registry declaration outrank the version and a stable release outrank the rest', () => {
    expect(releaseMaturity(entry({ version: '0.1.0a22', maturity: 'pre-alpha' }))).toBe('pre-alpha')
    expect(releaseMaturity(entry({ status: 'stable', version: '1.74.0', stable: '1.74.0' }))).toBe('stable')
    // Neither outcome comes from the name: a declared stage beats a final name, and a stable
    // status beats a LuaRocks revision (`-1`) that the name grammar refuses.
    expect(releaseMaturity(entry({ version: '1.74.0', maturity: 'beta' }))).toBe('beta')
    expect(releaseMaturity(entry({ status: 'stable', version: '0.1.0-1' }))).toBe('stable')
  })

  it('refuses a prerelease whose stage it cannot read', () => {
    expect(() => releaseMaturity(entry({ version: '0.1.0-dev.3' }))).toThrow(/no release stage in "0.1.0-dev.3"/)
  })

  it('reads the live Julia entry, a final tag that General does not carry yet, as stable', () => {
    expect(releaseMaturity(JULIA_FINAL_TAG)).toBe('stable')
  })

  it.each([
    'v0.1.0', '0.1.0', 'v10.20.30', 'libtmux@v0.1.0', 'libtmux@0.1.0', 'tmux-workspace@v0.1.0', 'workspace/v0.1.0', 'mcp/v1.2.3',
    // A stage word in the package label is not the release's stage.
    'arc-tools@v1.0.0',
  ])('reads the final release %s as stable, from a tag or a version', (name) => {
    expect(releaseMaturity(entry({ status: 'unpublished', tag: name }))).toBe('stable')
    expect(releaseMaturity(entry({ version: name }))).toBe('stable')
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
    expect(releaseMaturity(entry({ status: 'unpublished', tag: final })), final).toBe('stable')
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

  it('states the stage Python declares for each of its PyPI projects', () => {
    expect(table('py')).toEqual({ core: 'stable', mcp: 'pre-alpha', workspace: 'stable' })
    const { packages } = REGISTRY.ports.py!
    expect(Object.keys(packages!).sort()).toEqual(['libtmux', 'libtmux-mcp', 'tmuxp'])
    // The MCP server and tmuxp release from their own repositories, so libtmux's tag is not theirs.
    expect(packages!['libtmux-mcp']!.tag).toBeNull()
    expect(packages!.tmuxp!.tag).toBeNull()
  })

  it('badges the library with its stage and every other port companion as a concept', () => {
    expect(table('go')).toEqual({ core: 'alpha', mcp: 'concept', workspace: 'concept' })
    expect(table('java')).toEqual({ core: 'alpha', mcp: 'concept', workspace: 'concept' })
    expect(table('powershell')).toEqual({ core: 'alpha', workspace: 'concept' })
    expect(table('kotlin')).toEqual({ core: 'alpha' })
  })

  it.each(PORTS)('gives every available product of $slug a badge', (port) => {
    for (const product of ['core', 'mcp', 'workspace'] as const) {
      if (product !== 'core' && !productAvailable(port, product)) continue
      const status = productStatus(port, product, REGISTRY)
      expect(status, `${port.slug} ${product}`).toBeDefined()
      expect(PRODUCT_STATUS_LINE[status as ProductStatus].length).toBeGreaterThan(10)
    }
  })

  it('badges Julia stable from its final tag and states the line without naming a registry', async () => {
    const julia = PORT_BY_SLUG.julia!
    const status = productStatus(julia, 'core', { schema: 1, ports: { julia: JULIA_FINAL_TAG } })
    expect(status).toBe('stable')
    // Python's stable release is on PyPI and Julia's is not on General; one line has to be true of both.
    expect(PRODUCT_STATUS_LINE.stable).not.toMatch(/registry/i)
    const html = await renderAstroTemplate(await loadAstroTemplate('components/StatusBadge.astro'), {
      props: { status, product: julia.projectName, id: 'julia-core-status' },
    })
    expect(html).toContain('data-status="stable"')
    expect(html).toContain(`<span class="status-toggletip__line">${PRODUCT_STATUS_LINE.stable}</span>`)
  })

  it.each([
    ['General lists nothing', null, { status: 'unpublished', version: null, stable: null, tag: 'v0.1.0' }, 'stable'],
    ['General lists only 0.1.0-alpha.2', ['0.1.0-alpha.2'], { status: 'prerelease', version: '0.1.0-alpha.2', stable: null, tag: 'v0.1.0-alpha.2' }, 'alpha'],
    ['General lists 0.1.0', ['0.1.0'], { status: 'stable', version: '0.1.0', stable: '0.1.0', tag: 'v0.1.0' }, 'stable'],
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
    for (const [status, line] of Object.entries(PRODUCT_STATUS_LINE)) {
      // About eight words and sixty characters: a toggletip is a label, not a paragraph.
      expect(line.length, status).toBeLessThanOrEqual(60)
      expect(line.split(/\s+/).length, status).toBeLessThanOrEqual(8)
      expect(line, status).toMatch(/^[A-Z][^.]*\.$/)
      expect(line, status).not.toBe(CONCEPT_DESCRIPTION)
    }
    expect(Object.keys(PRODUCT_STATUS_LINE).sort()).toEqual(['alpha', 'beta', 'concept', 'pre-alpha', 'rc', 'stable', 'unreleased'])
    expect(PRODUCT_STATUS_LINK).toBe('Read more')
    expect(PRODUCT_STATUS_GUIDE).toBe('/meta/support/#concept-and-alpha')
  })
})
