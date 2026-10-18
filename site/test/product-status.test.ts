import { describe, expect, it } from 'vitest'
import {
  PORTS, PRODUCT_STATUS_GUIDE, PRODUCT_STATUS_SUMMARY, productAvailable, productStatus, releaseMaturity,
  type ProductStatus, type RegistryEntry,
} from '../src/lib/ports'
import { REGISTRY } from '../src/lib/registry'

const entry = (overrides: Partial<RegistryEntry>): RegistryEntry => ({ status: 'prerelease', version: null, stable: null, tag: null, ...overrides })

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
  })

  it('refuses a prerelease whose stage it cannot read', () => {
    expect(() => releaseMaturity(entry({ version: '0.1.0-dev.3' }))).toThrow(/no release stage in "0.1.0-dev.3"/)
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
      expect(PRODUCT_STATUS_SUMMARY[status as ProductStatus].length).toBeGreaterThan(20)
    }
  })

  it('explains each badge in one sentence and points at the section that covers it', () => {
    for (const [status, summary] of Object.entries(PRODUCT_STATUS_SUMMARY)) {
      expect(summary, status).toMatch(/^[A-Z][^.]*\.$/)
    }
    expect(PRODUCT_STATUS_GUIDE).toBe('/tmux/guides/concept-examples/#concept-and-alpha')
  })
})
