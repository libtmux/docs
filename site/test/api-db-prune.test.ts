import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { allExtractions, seed, symbolsOfKind } from '../src/db'

vi.mock('../src/db/paths', async (original) => {
  const { fileURLToPath } = await import('node:url')
  return {
    ...await original<typeof import('../src/db/paths')>(),
    MODEL_DIR: fileURLToPath(new URL('./fixtures/api/', import.meta.url)),
  }
})

const temporary: string[] = []
afterAll(() => { for (const path of temporary) rmSync(path, { recursive: true, force: true }) })

/**
 * A version that leaves the manifest leaves the store.
 *
 * The claim is that no DELETE is needed because seeding rebuilds into a
 * scratch file and renames it over the old database, so the store can only
 * ever hold what the current manifest asked for. That is the kind of claim
 * that is true right up until someone makes seeding incremental for speed, at
 * which point it silently stops being true and old versions linger in queries
 * that look correct.
 *
 * So it is driven rather than asserted: seed with two versions, seed again
 * with one, and require the other to be gone.
 */

function manifestWith(versions: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'libtmux-manifest-'))
  temporary.push(dir)
  const path = join(dir, 'versions.json')
  const ports = Object.fromEntries(
    ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'].map((p) => [
      p,
      versions.map((slug) => ({ slug, label: slug, kind: 'tag', supported: true })),
    ]),
  )
  writeFileSync(path, JSON.stringify({ schema: 1, ports, defaultVersion: {} }))
  return path
}

describe('api projection pruning', () => {
  it('drops a version once the manifest stops listing it', () => {
    seed({ manifestPath: manifestWith(['latest', 'v0.9']) })
    expect(
      allExtractions()
        .filter((e) => e.port === 'py')
        .map((e) => e.version)
        .sort(),
    ).toEqual(['latest', 'v0.9'])
    expect(symbolsOfKind('py', 'v0.9', 'class').length).toBeGreaterThan(0)

    // The retirement.
    seed({ manifestPath: manifestWith(['latest']) })

    const versions = allExtractions().map((e) => e.version)
    expect(new Set(versions), 'only the surviving version remains').toEqual(new Set(['latest']))
    expect(symbolsOfKind('py', 'v0.9', 'class'), 'symbol rows for v0.9').toEqual([])
  })
})
