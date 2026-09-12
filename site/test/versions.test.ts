import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareTags, parseTag, selectBuildVersions, sortVersions, type VersionEntry, type VersionManifest } from '../src/lib/versions'

it('keeps the production fallback manifest in sync with the seed generator', () => {
  const generated = execFileSync(process.execPath, [
    new URL('../../scripts/gen-versions.mjs', import.meta.url).pathname, '--seed',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const fallback = readFileSync(new URL('../public/versions.json', import.meta.url), 'utf8')
  expect(JSON.parse(fallback)).toEqual(JSON.parse(generated))
})

// The bookkeeping the build sources, driven here rather than reassembled from
// the script's text.
const bookkeeping = fileURLToPath(new URL('../../scripts/version-bookkeeping.sh', import.meta.url))

describe('assembly version selection', () => {
  const candidate: VersionManifest = {
    schema: 1,
    ports: {
      py: [
        { slug: 'stable', label: 'stable', kind: 'alias', resolvesTo: 'v0.62.0', supported: true },
        { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
        { slug: 'v0.62.0', label: 'v0.62.0', kind: 'tag', supported: true },
      ],
      go: [{ slug: 'latest', label: 'latest', kind: 'trunk', supported: true }],
    },
    defaultVersion: { py: 'stable', go: 'latest' },
  }

  it('keeps alias metadata without inventing versions or mutating the candidate', () => {
    const original = structuredClone(candidate)
    const selected = selectBuildVersions(candidate, ['stable'])
    expect(selected.ports).toEqual({ py: [candidate.ports.py[0]], go: [] })
    expect(selected.defaultVersion).toEqual({ py: 'stable' })
    expect(candidate).toEqual(original)
  })

  it.each([
    ['latest', 'latest'],
    ['latest,stable', 'stable'],
  ])('sets rendered defaults from --versions %s before building', (selected, pythonDefault) => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-build-versions-'))
    try {
      writeFileSync(join(directory, 'gen-versions.mjs'),
        "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[3], process.env.TEST_VERSION_MANIFEST);\n")
      const output = execFileSync('bash', ['-euc', `. ${bookkeeping}\nnode -e 'console.log(process.env.LIBTMUX_DOCS_PORT_DEFAULTS)'`], {
        encoding: 'utf8',
        env: {
          ...process.env, scratch: directory, script_dir: directory,
          repo_root: new URL('../../', import.meta.url).pathname,
          site_dir: new URL('../', import.meta.url).pathname,
          locale: 'en', versions_arg: selected,
          TEST_VERSION_MANIFEST: JSON.stringify(candidate),
        },
      })
      expect(JSON.parse(output)).toEqual({ py: pythonDefault, go: 'latest' })
      const manifest = JSON.parse(readFileSync(join(directory, 'versions.json'), 'utf8')) as VersionManifest
      expect(manifest.ports.py.map((entry) => entry.slug)).toEqual(selected === 'latest' ? ['latest'] : ['stable', 'latest'])
      expect(manifest.defaultVersion).toEqual({ py: pythonDefault, go: 'latest' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  // Naming a slug the build never produced would mislabel which page is
  // canonical, so the absent key has to stop the build rather than default.
  it('refuses a default version for a port this build kept nothing of', () => {
    const directory = mkdtempSync(join(tmpdir(), 'libtmux-build-versions-'))
    try {
      writeFileSync(join(directory, 'gen-versions.mjs'),
        "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[3], process.env.TEST_VERSION_MANIFEST);\n")
      const result = spawnSync('bash', ['-euc', `. ${bookkeeping}\ndefault_version_for go`], {
        encoding: 'utf8',
        env: {
          ...process.env, scratch: directory, script_dir: directory,
          repo_root: new URL('../../', import.meta.url).pathname,
          site_dir: new URL('../', import.meta.url).pathname,
          locale: 'en', versions_arg: 'stable',
          TEST_VERSION_MANIFEST: JSON.stringify(candidate),
        },
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('kept none of its versions')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

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
