import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every statement of a tmux minimum names the floor of the port it is about.
 *
 * A requirement phrased "tmux X or newer", "tmux X and later", "tmux >= X",
 * "at least tmux X", "tmux X+" or "tmux X through Y" is a support promise.
 * These pages, example prerequisites and install notes must agree with the
 * floor in the core tmux support contract, which is 3.3a unless the port
 * declares another. Facts about tmux itself, such as the release that added a
 * format field, are not promises and are not matched when the version follows
 * a word that dates the fact. Staged port guides come from pinned port
 * revisions and carry their own floor.
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
 * a file that speaks for several ports. `near` selects the statement by its
 * paragraph (its line, outside Markdown), so a wrong floor elsewhere in the
 * same file still fails. An entry that matches no statement fails, so an
 * exemption cannot outlive the text it covers.
 */
export const OTHER_FLOORS = [
  {
    path: 'site/src/content/_workspace-shared/workspace/guides/installation.md',
    version: '3.2a',
    near: /tmuxp/,
    why: 'the tmuxp paragraph; tmuxp depends on libtmux~=0.62.0, whose TMUX_MIN_VERSION is 3.2a, although its own README, quickstart and plugin.py say 3.2',
  },
  {
    path: 'site/src/data/home-examples.json',
    version: '3.2a',
    near: /Python \d/,
    why: 'the Python quickstart prerequisites',
  },
  {
    path: 'site/src/data/home-examples.json',
    version: '3.3',
    near: /Elixir \d/,
    why: 'the Elixir quickstart prerequisites; priv/tmux/support.json declares tmux_minimum 3.3',
  },
  {
    path: 'site/src/lib/ports.ts',
    version: '3.3',
    near: /Elixir \d/,
    why: 'the Elixir install notes; priv/tmux/support.json declares tmux_minimum 3.3',
  },
  {
    path: 'site/src/content/docs/ports/rs/concepts/standard-library-core.md',
    version: '3.2a',
    why: 'documents a prototype pinned at an older libtmux-rs revision whose own README says 3.2a',
  },
  {
    path: 'site/src/content/docs/ports/rs/mcp/topics/tool-selection.md',
    version: '3.7',
    near: /history limit/,
    why: 'a tmux behaviour of the history-limit option from tmux 3.7, not a library minimum',
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

/**
 * "tmux" and a version, followed by a floor phrase ("or newer", "and later",
 * "+", "through Y") or led by one (">=", "at least"). Emphasis marks may sit
 * between the words.
 */
const MINIMUM = new RegExp(
  String.raw`(?<least>\bat\s+least\s+)?\btmux\s+[*_\x60]*(?:version\s+)?(?<ge>(?:>=|≥)\s*)?` +
  String.raw`(?<version>\d+\.\d+[a-z]?)[*_\x60]*` +
  String.raw`(?<tail>\s+(?:or|and)\s+(?:newer|later|higher|greater|above)\b|\+|\s+through\s+\d)?`,
  'gi',
)

/**
 * The words before a version that make it a fact about tmux: what a release
 * added or dated ("added on", "present in", "since"), or a format field
 * ("`pane_dead_signal` on"). "runs on" and "works on" are promises.
 */
const FACT_LEAD = /(?:\b(?:added|introduced|present|arrived|appears?|appeared|exists?)\s+(?:on|in|with|since)|\bsince|\x60[a-z]+(?:_[a-z]+)+\x60\s+on)\s+$/i

function scan(text: string): { version: string, index: number }[] {
  const found = []
  for (const match of text.matchAll(MINIMUM)) {
    const { least, ge, version, tail } = match.groups!
    if (!(least || ge || tail)) continue
    if (FACT_LEAD.test(text.slice(Math.max(0, match.index - 40), match.index))) continue
    found.push({ version, index: match.index })
  }
  return found
}

/** A minimum promise: the versions that pass the phrasing and fact rules above. */
export function minimums(text: string): string[] {
  return scan(text).map((found) => found.version)
}

interface Floor { path: string, version: string, near?: RegExp }
interface Statement { path: string, version: string, context: string }

/** The paragraph around an index in Markdown, otherwise its line. */
function around(path: string, text: string, index: number): string {
  const separator = /\.mdx?$/.test(path) ? '\n\n' : '\n'
  const before = text.lastIndexOf(separator, index)
  const after = text.indexOf(separator, index)
  return text.slice(before < 0 ? 0 : before + separator.length, after < 0 ? text.length : after)
}

export function statementsIn(path: string, text: string): Statement[] {
  return scan(text).map(({ version, index }) => ({ path, version, context: around(path, text, index) }))
}

/** Statements that disagree with their floor, then entries that excuse or require nothing. */
export function mismatches(statements: Statement[], ports: Floor[], others: Floor[]): string[] {
  const covers = (entry: Floor, statement: Statement) =>
    statement.version === entry.version && statement.path.startsWith(entry.path) &&
    (entry.near?.test(statement.context) ?? true)
  const expected = (statement: Statement) =>
    ports.find((port) => statement.path.startsWith(port.path))?.version ?? FLOOR
  const wrong = statements
    .filter((statement) => statement.version !== expected(statement) && !others.some((entry) => covers(entry, statement)))
    .map((statement) => `${statement.path}: tmux ${statement.version}, expected ${expected(statement)}`)
  const unused = [...ports, ...others]
    .filter((entry) => !statements.some((statement) => covers(entry, statement)))
    .map((entry) => `stale entry: ${entry.path} names tmux ${entry.version}${entry.near ? ` near ${entry.near}` : ''}, which no statement there states`)
  return [...wrong, ...unused]
}

const statement = (path: string, version: string, context = ''): Statement => ({ path, version, context })

describe('tmux minimum statements', () => {
  it('recognizes each phrasing of a minimum', () => {
    expect(minimums('Use tmux 3.2a or newer.')).toEqual(['3.2a'])
    expect(minimums('Use tmux 3.2\nor newer.')).toEqual(['3.2'])
    expect(minimums('Use tmux 3.2a through 3.7c.')).toEqual(['3.2a'])
    expect(minimums('tmux 3.2a+ is a target')).toEqual(['3.2a'])
    expect(minimums('The example ran on tmux 3.2a and 3.7c.')).toEqual([])
    expect(minimums('Use **tmux 3.2a** or later.')).toEqual(['3.2a'])
    expect(minimums('Needs tmux version 3.2a or newer.')).toEqual(['3.2a'])
  })

  it('recognizes a minimum that "on" or a comparison would hide', () => {
    expect(minimums('It runs on tmux 3.2a or newer.')).toEqual(['3.2a'])
    expect(minimums('It works on tmux 3.2a and later.')).toEqual(['3.2a'])
    expect(minimums('It supports tmux 3.2a and newer.')).toEqual(['3.2a'])
    expect(minimums('It supports tmux 3.2a or later.')).toEqual(['3.2a'])
    expect(minimums('It needs tmux >= 3.2a.')).toEqual(['3.2a'])
    expect(minimums('Ensure you have tmux **>= 3.2**.')).toEqual(['3.2'])
    expect(minimums('It needs at least tmux 3.2a.')).toEqual(['3.2a'])
    expect(minimums('It needs at least tmux 3.2a or newer.')).toEqual(['3.2a'])
  })

  it('leaves facts about tmux alone', () => {
    expect(minimums('A field present on tmux 3.3 or\nnewer is optional.')).toEqual([])
    expect(minimums('Hooks were added on tmux 3.4 or newer.')).toEqual([])
    expect(minimums('Available since tmux 3.2a and later, the hook fires.')).toEqual([])
    expect(minimums('Read `pane_dead_signal` on tmux 3.3 or\nnewer.')).toEqual([])
    expect(minimums('The flag appears in tmux 3.2a and newer.')).toEqual([])
    expect(minimums('Use tmux 3.2a for the manual.')).toEqual([])
  })

  it('names the floor of its port everywhere a minimum is stated', () => {
    const statements: Statement[] = []
    for (const path of RANGES.flatMap(files)) {
      if (!/\.(md|mdx|json|ts)$/.test(path) || path.includes('/_staged/')) continue
      statements.push(...statementsIn(path, readFileSync(join(ROOT, path), 'utf8')))
    }
    expect(statements.length).toBeGreaterThan(50)
    expect(statements.some((found) => found.path.endsWith('guides/tmux-support.md'))).toBe(true)
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
      statement('a/b.md', '3.2a'),
      statement('c.md', FLOOR),
      statement('m.md', '3.3'),
    ]
    expect(mismatches(clean, ports, others)).toEqual([])
    expect(mismatches([...clean, statement('c.md', '3.2a')], ports, others)).toEqual([
      'c.md: tmux 3.2a, expected 3.3a',
    ])
    expect(mismatches([...clean, statement('a/d.md', FLOOR)], ports, others)).toEqual([
      'a/d.md: tmux 3.3a, expected 3.2a',
    ])
    expect(mismatches(clean.slice(1), ports, others)).toEqual([
      'stale entry: a/ names tmux 3.2a, which no statement there states',
    ])
    expect(mismatches(clean.slice(0, 2), ports, others)).toEqual([
      'stale entry: m.md names tmux 3.3, which no statement there states',
    ])
  })

  it.each([
    'tmux {v} or newer',
    'tmux {v} or later',
    'tmux {v} and newer',
    'tmux {v} and later',
    'tmux {v}+',
    'tmux {v} through 3.7c',
    'tmux >= {v}',
    'at least tmux {v}',
    'runs on tmux {v} or newer',
    'works on tmux {v} and later',
  ])('fails a wrong floor phrased "%s" beside a clean control', (phrase) => {
    const page = (version: string) => statementsIn('c.md', `Note: ${phrase.replace('{v}', version)}.`)
    expect(mismatches(page(FLOOR), [], [])).toEqual([])
    expect(mismatches(page('3.2a'), [], [])).toEqual(['c.md: tmux 3.2a, expected 3.3a'])
  })

  it('passes a version in a fact about tmux whatever its value', () => {
    const facts = [
      'A field present on tmux 3.2a or newer is optional.',
      'Hooks were added on tmux 3.2a or newer.',
      'Since tmux 3.2a and later, the hook fires.',
    ]
    for (const fact of facts) expect(mismatches(statementsIn('c.md', fact), [], [])).toEqual([])
  })

  it('limits an exemption to the statement it names', () => {
    const others = [{ path: 'm.json', version: '3.3', near: /Elixir/ }]
    const elixir = '{ "elixir": "Elixir 1.20 and tmux 3.3 or newer" }'
    const go = '{ "go": "Go 1.26 and tmux 3.3 or newer" }'
    expect(mismatches(statementsIn('m.json', elixir), [], others)).toEqual([])
    expect(mismatches(statementsIn('m.json', `${elixir}\n${go}`), [], others)).toEqual([
      'm.json: tmux 3.3, expected 3.3a',
    ])
    expect(mismatches(statementsIn('m.json', go), [], others)).toEqual([
      'm.json: tmux 3.3, expected 3.3a',
      'stale entry: m.json names tmux 3.3 near /Elixir/, which no statement there states',
    ])
    const paragraphs = 'The Elixir port needs tmux 3.3 or newer.\n\nThe Go port needs tmux 3.3 or newer.'
    expect(mismatches(statementsIn('m.md', paragraphs), [], [{ path: 'm.md', version: '3.3', near: /Elixir/ }])).toEqual([
      'm.md: tmux 3.3, expected 3.3a',
    ])
  })
})
