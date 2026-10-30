import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import type { CollectionEntry } from 'astro:content'
import { describe, expect, it, vi } from 'vitest'

// `i18n/resolve` imports Astro's content module, which a bare vitest run cannot load.
// Its config module is aliased in vitest.config.ts, with `site/` as the Astro root.
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
const { translationState } = await import('../src/i18n/resolve')

const SHA = /^[0-9a-f]{40}$/
const LANDING = 'src/content/docs/ja/index.md'
const CONCEPTS = 'src/content/docs/ja/concepts/index.md'
const CONCEPTS_SOURCE = 'src/content/docs/concepts/index.md'

const absolute = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url))

// The content loader reports `filePath` relative to the Astro root, as these are.
function entryFor(relative: string, data: Record<string, unknown> = {}): CollectionEntry<'docs'> {
  const { frontmatter } = parseFrontmatter(readFileSync(absolute(relative), 'utf8'))
  return { id: relative, data: { ...frontmatter, ...data }, filePath: relative } as unknown as CollectionEntry<'docs'>
}

const sourceFor = (relative: string) => ({ id: relative, data: {}, filePath: relative }) as unknown as CollectionEntry<'docs'>

function git(...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: absolute(''), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** Whether `sha` is a commit that changed one of `paths`. */
const touched = (paths: readonly string[], sha: string) =>
  (git('log', '--format=%H', '--', ...paths.map(absolute)) ?? '').split('\n').includes(sha)

/**
 * A shallow checkout (the CI default) holds one commit, so no declared commit
 * can be found in it. Without git at all there is nothing to look in. Both
 * leave the history checks nothing to measure.
 */
const hasHistory = git('rev-parse', '--is-shallow-repository') === 'false'

function provenance(relative: string) {
  const { data } = entryFor(relative)
  expect(data.source_commit, `${relative} source_commit`).toMatch(SHA)
  expect(typeof data.translator, `${relative} translator`).toBe('string')
  expect(typeof data.reviewed, `${relative} reviewed`).toBe('boolean')
  return data.source_commit as string
}

describe('Japanese landing page', () => {
  /*
   * English has no index.md: the lead line comes from HomeIntro.astro and the
   * title and description from the route. The collection has no entry for
   * either, so translationState never runs for this page and readers are
   * shown no state. The route changes for reasons that do not touch the two
   * strings translated from it, so the test asks only that the declared
   * commit is a real change to one of its sources; a reviewer judges drift.
   */
  const sources = ['src/pages/index.astro', 'src/components/HomeIntro.astro']

  it('declares who made it and the English commit it follows', () => {
    provenance(LANDING)
  })

  describe.skipIf(!hasHistory)('against the repository history', () => {
    it('follows a commit that changed one of its English sources', () => {
      expect(touched(sources, provenance(LANDING))).toBe(true)
    })

    it('rejects a commit that changed none of them', () => {
      expect(touched(sources, '0'.repeat(40))).toBe(false)
    })
  })
})

describe('Japanese concepts index', () => {
  // The whole page is translated, so any edit to the English file makes it
  // stale and translationState says so.
  it('declares who made it and the English commit it follows', () => {
    provenance(CONCEPTS)
  })

  describe.skipIf(!hasHistory)('against the repository history', () => {
    it('reads as current', () => {
      expect(translationState(entryFor(CONCEPTS), sourceFor(CONCEPTS_SOURCE))).toBe('translated')
    })

    it('reads as stale for a commit the source has moved past, or none declared', () => {
      expect(translationState(entryFor(CONCEPTS, { source_commit: '0'.repeat(40) }), sourceFor(CONCEPTS_SOURCE))).toBe('stale')
      expect(translationState(entryFor(CONCEPTS, { source_commit: undefined }), sourceFor(CONCEPTS_SOURCE))).toBe('stale')
    })
  })

  it('offers the English page destinations, in order and for the same ports', () => {
    const cards = (relative: string) =>
      parseFrontmatter(readFileSync(absolute(relative), 'utf8')).frontmatter.cards as { label: string; href: string; body: string; ports?: string[] }[]
    const english = cards(CONCEPTS_SOURCE)
    const japanese = cards(CONCEPTS)
    expect(japanese.map(({ href, ports }) => ({ href, ports }))).toEqual(english.map(({ href, ports }) => ({ href, ports })))
    for (const card of japanese) expect(card.label && card.body, card.href).toBeTruthy()
  })
})
