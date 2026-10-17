import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every statement of a tmux minimum names the core floor.
 *
 * A requirement phrased "tmux X or newer", "tmux X+" or "tmux X through Y"
 * is a support promise. These pages, example prerequisites and install notes
 * must agree with the floor in the core tmux support contract. Facts about
 * tmux itself, such as the release that added a format field, use other
 * phrasing, or follow "on", and are not matched. Staged port guides come from
 * pinned port revisions and carry their own floor.
 */
const FLOOR = '3.3a'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const RANGES = [
  'site/src/content',
  'site/src/data/home-examples.json',
  'site/src/lib/ports.ts',
  'packages/api-model/src/languages',
]

function files(path: string): string[] {
  const absolute = join(ROOT, path)
  let entries
  try { entries = readdirSync(absolute, { withFileTypes: true }) } catch { return [path] }
  return entries.flatMap((entry) => files(join(path, entry.name)))
}

/** A minimum promise: the version after "tmux" is followed by a floor phrase. */
export function minimums(text: string): string[] {
  const found: string[] = []
  const pattern = /(?<!\bon\s)tmux\s+(\d+\.\d+[a-z]?)(\s+or\s+newer|\+|\s+through\s+\d)/g
  for (const match of text.matchAll(pattern)) found.push(match[1])
  return found
}

describe('tmux minimum statements', () => {
  it('recognizes each phrasing of a minimum', () => {
    expect(minimums('Use tmux 3.2a or newer.')).toEqual(['3.2a'])
    expect(minimums('Use tmux 3.2\nor newer.')).toEqual(['3.2'])
    expect(minimums('Use tmux 3.2a through 3.7c.')).toEqual(['3.2a'])
    expect(minimums('tmux 3.2a+ is a target')).toEqual(['3.2a'])
    expect(minimums('A field present on tmux 3.3 or\nnewer is optional.')).toEqual([])
    expect(minimums('The example ran on tmux 3.2a and 3.7c.')).toEqual([])
  })

  it('names the core floor everywhere a minimum is stated', () => {
    const stale: string[] = []
    let seen = 0
    for (const path of RANGES.flatMap(files)) {
      if (!/\.(md|mdx|json|ts)$/.test(path) || path.includes('/_staged/')) continue
      for (const version of minimums(readFileSync(join(ROOT, path), 'utf8'))) {
        seen += 1
        if (version !== FLOOR) stale.push(`${path}: tmux ${version}`)
      }
    }
    expect(seen).toBeGreaterThan(50)
    expect(stale).toEqual([])
  })
})
