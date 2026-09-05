import { describe, expect, it } from 'vitest'
import { compareTags, sortVersions, type VersionEntry } from '../src/lib/versions'

/**
 * Ordering the switcher and the generated manifest both depend on.
 *
 * Every port but Python ships prereleases only, so prerelease precedence is
 * the common path here rather than an edge case.
 */
describe('compareTags', () => {
  const newestFirst = (tags: string[]) => [...tags].sort(compareTags)

  it('orders prerelease identifiers numerically', () => {
    const tags = ['v0.0.0-alpha.1', 'v0.0.0-alpha.2', 'v0.0.0-alpha.9', 'v0.0.0-alpha.10']
    expect(newestFirst(tags)).toEqual([
      'v0.0.0-alpha.10',
      'v0.0.0-alpha.9',
      'v0.0.0-alpha.2',
      'v0.0.0-alpha.1',
    ])
  })

  it('puts a release ahead of its own prereleases', () => {
    expect(newestFirst(['v1.0.0-alpha.3', 'v1.0.0', 'v1.0.0-beta.1'])[0]).toBe('v1.0.0')
  })

  it('orders by version number before prerelease', () => {
    expect(newestFirst(['v0.9.0', 'v0.62.0', 'v0.10.0'])).toEqual(['v0.62.0', 'v0.10.0', 'v0.9.0'])
  })

  it('is a total order — sorting twice changes nothing', () => {
    const tags = ['v0.1.0-alpha.7', 'v0.1.0', 'v0.0.1-alpha.10', 'v0.2.0']
    expect(newestFirst(newestFirst(tags))).toEqual(newestFirst(tags))
  })
})

describe('sortVersions', () => {
  it('ranks aliases before trunk before tags', () => {
    const entries: VersionEntry[] = [
      { slug: 'v0.1.0', label: 'v0.1.0', kind: 'tag', supported: true },
      { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
      { slug: 'stable', label: 'stable', kind: 'alias', supported: true },
    ]
    expect(sortVersions(entries).map((e) => e.slug)).toEqual(['stable', 'latest', 'v0.1.0'])
  })
})
