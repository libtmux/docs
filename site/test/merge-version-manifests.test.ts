import { describe, expect, it } from 'vitest'
import { merge } from '../../scripts/merge-version-manifests.mjs'

const seed = {
  schema: 1,
  ports: { ruby: [{ slug: 'latest', label: 'latest', kind: 'trunk', supported: true }] },
  defaultVersion: { ruby: 'latest' },
}

describe('published version manifest merge', () => {
  it('replaces one port only after its publisher wrote a fragment', () => {
    const result = merge(seed, [{
      port: 'ruby',
      manifest: {
        schema: 1,
        ports: { ruby: [
          { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
          { slug: 'next', label: 'next', kind: 'alias', resolvesTo: 'v0.1.0.alpha.1', supported: true },
          { slug: 'v0.1.0.alpha.1', label: 'v0.1.0.alpha.1', kind: 'tag', supported: true },
        ] },
        defaultVersion: { ruby: 'latest' },
      },
    }])
    expect(result.ports.ruby.map((entry: { slug: string }) => entry.slug)).toEqual([
      'latest', 'next', 'v0.1.0.alpha.1',
    ])
    expect(seed.ports.ruby).toHaveLength(1)
  })

  it('rejects previews and defaults that do not name published entries', () => {
    expect(() => merge(seed, [{
      port: 'ruby',
      manifest: {
        schema: 1,
        ports: { ruby: [{ slug: 'pr-3', label: 'pr-3', kind: 'pr', supported: true }] },
        defaultVersion: {},
      },
    }])).toThrow('preview entry')
    expect(() => merge(seed, [{
      port: 'ruby',
      manifest: { schema: 1, ports: { ruby: [] }, defaultVersion: { ruby: 'stable' } },
    }])).toThrow('has no published entry')
  })

  it('rejects a fragment that writes another port', () => {
    expect(() => merge(seed, [{
      port: 'ruby',
      manifest: { schema: 1, ports: { lua: [] }, defaultVersion: {} },
    }])).toThrow('contains another port')
  })
})
