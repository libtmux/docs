import { describe, expect, it } from 'vitest'
import { keptVersions, prefixesFrom, toPrune } from '../../scripts/prune-versions.mjs'

/**
 * Reconciling the deployed tree against the manifest.
 *
 * `reusable-deploy.yml` syncs each build with `--delete`, which removes files
 * within a prefix that the build stopped producing. Nothing removes a prefix
 * once it stops being built at all — retire `v0.9` and its tree stays in the
 * bucket, reachable and crawlable but linked from no switcher, which is the
 * worst of both.
 *
 * The delete is the dangerous direction, so the rules that decide it are
 * tested here rather than exercised against a bucket.
 */
describe('deployed version pruning', () => {
  const manifest = {
    ports: {
      py: [
        { slug: 'latest', supported: true },
        { slug: 'stable', supported: true },
        { slug: 'v0.46', supported: false, eol: true },
      ],
      ts: [{ slug: 'latest', supported: true }],
      rs: [],
    },
  }

  it('reads the directory prefixes out of an s3 listing', () => {
    const listing = ['                           PRE latest/', '                           PRE v0.9/', '2026-01-01 12:00:00  1024 index.html'].join('\n')
    expect(prefixesFrom(listing)).toEqual(['latest', 'v0.9'])
  })

  it('deletes a version the manifest no longer mentions', () => {
    const present = new Map([['py', ['latest', 'stable', 'v0.9']]])
    expect(toPrune(keptVersions(manifest), present)).toEqual(['py/v0.9'])
  })

  it('keeps an end-of-life version that is still listed', () => {
    // EOL is not deletion. The version is still published, still linked from
    // the switcher with a banner, and every link anyone wrote to it still
    // works. What gets pruned is a version the manifest stopped mentioning.
    const present = new Map([['py', ['latest', 'stable', 'v0.46']]])
    expect(toPrune(keptVersions(manifest), present)).toEqual([])
  })

  it('leaves a port with no manifest entries entirely alone', () => {
    // An ecosystem port has no local tree and no entries — and so does a
    // half-written manifest. The safe reading of "no entry" is "not mine".
    const present = new Map([['rs', ['latest', 'stable']]])
    expect(toPrune(keptVersions(manifest), present)).toEqual([])
  })

  it('leaves a port the manifest does not know about', () => {
    const present = new Map([['kotlin', ['latest']]])
    expect(toPrune(keptVersions(manifest), present)).toEqual([])
  })

  it('prunes across several ports at once, in a stable order', () => {
    const present = new Map([
      ['py', ['latest', 'v0.9', 'v0.8']],
      ['ts', ['latest', 'v1']],
    ])
    expect(toPrune(keptVersions(manifest), present)).toEqual(['py/v0.8', 'py/v0.9', 'ts/v1'])
  })

  it('agrees with the published manifest that nothing is stale', () => {
    // The real one, against what the assembly builds: latest and stable per
    // self-hosted port. If this ever finds something to prune, either a
    // version was retired or the manifest lost an entry it should have kept.
    const present = new Map([
      ['py', ['latest', 'stable']],
      ['ts', ['latest', 'stable']],
    ])
    const real = {
      ports: {
        py: [{ slug: 'latest' }, { slug: 'stable' }],
        ts: [{ slug: 'latest' }, { slug: 'stable' }],
      },
    }
    expect(toPrune(keptVersions(real), present)).toEqual([])
  })
})
