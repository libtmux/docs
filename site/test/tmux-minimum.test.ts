import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every statement of a tmux minimum names the floor of the port it is about.
 *
 * A requirement phrased "tmux X or newer", "tmux X+" or "tmux X through Y"
 * is a support promise. These pages, example prerequisites and install notes
 * must agree with the floor in the core tmux support contract, which is 3.3a
 * unless the port declares another. Facts about tmux itself, such as the
 * release that added a format field, use other phrasing, or follow "on", and
 * are not matched. Staged port guides come from pinned port revisions and
 * carry their own floor.
 */
const FLOOR = '3.3a'

/**
 * Ports whose own documented floor is not the core one. Every statement below
 * the path names that floor, so a page for the port cannot quietly claim the
 * core one. A path ending in "/" covers every file below it.
 */
export const PORT_FLOORS = [
  {
    path: 'site/src/content/docs/ports/py/',
    version: '3.2a',
    why: 'libtmux declares TMUX_MIN_VERSION 3.2a and libtmux-mcp documents >= 3.2a; tmuxp depends on libtmux, so its pages state 3.2a too',
  },
  {
    path: 'site/src/content/docs/ports/elixir/',
    version: '3.3',
    why: 'priv/tmux/support.json declares tmux_minimum 3.3, and 3.3 is a required CI release',
  },
]

/**
 * Single statements elsewhere that name another floor on purpose, usually in
 * a file that speaks for several ports. An entry that matches no statement
 * fails, so an exemption cannot outlive the text it covers.
 */
export const OTHER_FLOORS = [
  {
    path: 'site/src/content/_workspace-shared/workspace/guides/installation.md',
    version: '3.2a',
    why: 'the tmuxp paragraph; tmuxp depends on libtmux~=0.62.0, whose TMUX_MIN_VERSION is 3.2a, although its own README, quickstart and plugin.py say 3.2',
  },
  {
    path: 'site/src/data/home-examples.json',
    version: '3.2a',
    why: 'the Python quickstart prerequisites',
  },
  {
    path: 'site/src/data/home-examples.json',
    version: '3.3',
    why: 'the Elixir quickstart prerequisites; priv/tmux/support.json declares tmux_minimum 3.3',
  },
  {
    path: 'site/src/lib/ports.ts',
    version: '3.3',
    why: 'the Elixir install notes; priv/tmux/support.json declares tmux_minimum 3.3',
  },
  {
    path: 'site/src/content/docs/ports/rs/concepts/standard-library-core.md',
    version: '3.2a',
    why: 'documents a prototype pinned at an older libtmux-rs revision whose own README says 3.2a',
  },
]

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

interface Statement { path: string, version: string }
interface Floor { path: string, version: string }

/** Statements that disagree with their floor, then entries that excuse or require nothing. */
export function mismatches(statements: Statement[], ports: Floor[], others: Floor[]): string[] {
  const covers = (entry: Floor, statement: Statement) =>
    statement.version === entry.version && statement.path.startsWith(entry.path)
  const expected = (statement: Statement) =>
    ports.find((port) => statement.path.startsWith(port.path))?.version ?? FLOOR
  const wrong = statements
    .filter((statement) => statement.version !== expected(statement) && !others.some((entry) => covers(entry, statement)))
    .map((statement) => `${statement.path}: tmux ${statement.version}, expected ${expected(statement)}`)
  const unused = [...ports, ...others]
    .filter((entry) => !statements.some((statement) => covers(entry, statement)))
    .map((entry) => `stale entry: ${entry.path} names tmux ${entry.version}, which no statement there states`)
  return [...wrong, ...unused]
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

  it('names the floor of its port everywhere a minimum is stated', () => {
    const statements: Statement[] = []
    for (const path of RANGES.flatMap(files)) {
      if (!/\.(md|mdx|json|ts)$/.test(path) || path.includes('/_staged/')) continue
      for (const version of minimums(readFileSync(join(ROOT, path), 'utf8'))) statements.push({ path, version })
    }
    expect(statements.length).toBeGreaterThan(50)
    expect(mismatches(statements, PORT_FLOORS, OTHER_FLOORS)).toEqual([])
  })

  it('lists each floor in the support guide', () => {
    const guide = readFileSync(join(ROOT, 'site/src/content/docs/guides/tmux-support.md'), 'utf8')
    const section = guide.slice(guide.indexOf('## Minimum by port'), guide.indexOf('## The core minimum'))
    expect(section).not.toBe('')
    for (const version of [FLOOR, ...PORT_FLOORS.map((port) => port.version)]) {
      expect(section).toContain(`: tmux ${version}.`)
    }
  })

  it('fails a wrong floor, a port page on the core floor and an entry that matches nothing', () => {
    const ports = [{ path: 'a/', version: '3.2a' }]
    const others = [{ path: 'm.md', version: '3.3' }]
    const clean = [
      { path: 'a/b.md', version: '3.2a' },
      { path: 'c.md', version: FLOOR },
      { path: 'm.md', version: '3.3' },
    ]
    expect(mismatches(clean, ports, others)).toEqual([])
    expect(mismatches([...clean, { path: 'c.md', version: '3.2a' }], ports, others)).toEqual([
      'c.md: tmux 3.2a, expected 3.3a',
    ])
    expect(mismatches([...clean, { path: 'a/d.md', version: FLOOR }], ports, others)).toEqual([
      'a/d.md: tmux 3.3a, expected 3.2a',
    ])
    expect(mismatches(clean.slice(1), ports, others)).toEqual([
      'stale entry: a/ names tmux 3.2a, which no statement there states',
    ])
    expect(mismatches(clean.slice(0, 2), ports, others)).toEqual([
      'stale entry: m.md names tmux 3.3, which no statement there states',
    ])
  })
})
