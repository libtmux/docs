import { describe, expect, it } from 'vitest'
import { compareTags, parseTag, sortVersions, type VersionEntry } from '../src/lib/versions'

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
  const tags = (slugs: string[]): VersionEntry[] =>
    slugs.map((slug) => ({ slug, label: slug, kind: 'tag', supported: true }))

  it('puts a release above its own prereleases', () => {
    // Numeric collation on the raw slug read `v1.0.0-alpha.3` as later than
    // `v1.0.0`: a longer string sharing a prefix. This function is what the
    // switcher renders, so the ordering has to be right here, not only in
    // compareTags.
    expect(sortVersions(tags(['v1.0.0-alpha.3', 'v1.0.0', 'v1.0.0-alpha.10'])).map((e) => e.slug)).toEqual([
      'v1.0.0',
      'v1.0.0-alpha.10',
      'v1.0.0-alpha.3',
    ])
  })

  it('orders PEP 440 suffixes under that grammar', () => {
    // Python writes the suffix with no separator, and a post-release comes
    // after the release it follows. Both shapes are real tags in that repo.
    expect(
      sortVersions(tags(['v0.15.0a1', 'v0.15.0', 'v0.15.0post0', 'v0.15.0b2']), 'pep440').map((e) => e.slug),
    ).toEqual(['v0.15.0post0', 'v0.15.0', 'v0.15.0b2', 'v0.15.0a1'])
  })

  it('ranks aliases before trunk before tags', () => {
    const entries: VersionEntry[] = [
      { slug: 'v0.1.0', label: 'v0.1.0', kind: 'tag', supported: true },
      { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
      { slug: 'stable', label: 'stable', kind: 'alias', supported: true },
    ]
    expect(sortVersions(entries).map((e) => e.slug)).toEqual(['stable', 'latest', 'v0.1.0'])
  })
})

describe('parseTag', () => {
  it('reads a PEP 440 suffix that SemVer cannot', () => {
    expect(parseTag('v0.11.0b0', 'pep440')).toEqual({ nums: [0, 11, 0], pre: 'b0' })
    // The SemVer grammar rejects it outright rather than mis-reading it — the
    // previous hyphen-splitting parser produced NaN for the patch number.
    expect(parseTag('v0.11.0b0', 'semver')).toBeNull()
  })

  it('reads a bare release under either grammar', () => {
    expect(parseTag('v1.2.3', 'semver')).toEqual({ nums: [1, 2, 3], pre: null })
    expect(parseTag('v1.2.3', 'pep440')).toEqual({ nums: [1, 2, 3], pre: null })
  })

  it('rejects a two-component version', () => {
    // Python has v0.3, v0.4 and v0.5 from before it used three components.
    expect(parseTag('v0.3', 'pep440')).toBeNull()
  })
})

describe('compareTags across grammars', () => {
  it('ranks a post-release above its own release', () => {
    expect(compareTags('v0.15.0post0', 'v0.15.0', 'pep440')).toBeLessThan(0)
  })

  it('ranks a prerelease below its own release', () => {
    expect(compareTags('v0.15.0a1', 'v0.15.0', 'pep440')).toBeGreaterThan(0)
  })

  it('orders post-releases numerically among themselves', () => {
    expect(compareTags('v0.23.0post2', 'v0.23.0post1', 'pep440')).toBeLessThan(0)
  })
})
