import { describe, expect, it } from 'vitest'
import {
  OTHER_LETTER,
  countStatus,
  firstLetter,
  groupByLetter,
  groupRepeats,
  isSpecialName,
  kindCounts,
  letterLabel,
  letterOf,
  sortEntries,
  summaryLine,
  type IndexEntry,
} from '../src/lib/symbol-index'

const entry = (name: string, port = 'go', over: Partial<IndexEntry> = {}): IndexEntry => ({ port, name, id: `${port}.${name}`, kind: 'method', ...over })

describe('letter grouping', () => {
  it('files a name under its first letter, skipping leading underscores and tildes', () => {
    expect(letterOf('capture')).toBe('C')
    expect(letterOf('__call__')).toBe('C')
    expect(letterOf('_clauses')).toBe('C')
    expect(letterOf('~CommandExecutor')).toBe('C')
    expect(letterOf('2D')).toBe(OTHER_LETTER)
    expect(letterOf('___')).toBe(OTHER_LETTER)
    expect(letterLabel(OTHER_LETTER)).toBe('#')
  })

  it('puts the same name in different cases together, public names before special ones', () => {
    const sorted = sortEntries([entry('_clauses'), entry('Capture', 'rs'), entry('capture'), entry('Capacity'), entry('~CommandExecutor'), entry('capture', 'py')])
    expect(sorted.map((e) => `${e.name}:${e.port}`)).toEqual([
      'Capacity:go', 'capture:go', 'capture:py', 'Capture:rs', '_clauses:go', '~CommandExecutor:go',
    ].map((value) => value))
    expect(isSpecialName('__call__')).toBe(true)
    expect(isSpecialName('Capture')).toBe(false)
  })

  it('groups by letter with the other bucket last and every entry in exactly one group', () => {
    const entries = [entry('zip'), entry('Alpha'), entry('9lives'), entry('_beta'), entry('alpine')]
    const groups = groupByLetter(entries)
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B', 'Z', OTHER_LETTER])
    expect(groups.flatMap((g) => g.entries)).toHaveLength(entries.length)
    expect(groups[0]!.entries.map((e) => e.name)).toEqual(['alpine', 'Alpha'].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
  })
})

describe('repeated names', () => {
  it('folds names declared by three or more owners into one row with an owner count', () => {
    const entries = [entry('Name', 'go', { owner: 'A' }), entry('String', 'go', { owner: 'A' }), entry('String', 'go', { owner: 'B' }), entry('String', 'go', { owner: 'C' }), entry('Valid', 'go', { owner: 'A' }), entry('Valid', 'go', { owner: 'B' })]
    const rows = groupRepeats(entries)
    expect(rows.map((row) => (row.type === 'group' ? `${row.name}×${row.entries.length}` : row.entry.name))).toEqual(['Name', 'String×3', 'Valid', 'Valid'])
  })
})

describe('counts', () => {
  it('lists the kinds present, most common first, and states both numbers when filtered', () => {
    expect(kindCounts([entry('a'), entry('b', 'go', { kind: 'struct' }), entry('c')])).toEqual([['method', 2], ['struct', 1]])
    expect(countStatus(12, 176)).toBe('12 of 176 symbols')
    expect(countStatus(176, 176)).toBe('176 symbols')
    expect(countStatus(1, 1)).toBe('1 symbol')
  })
})

describe('the index front link', () => {
  it('opens the first letter that has names, leaving # for ports with nothing else', () => {
    expect(firstLetter(['capture', 'Attach', '_hidden'])).toBe('A')
    expect(firstLetter(['_x', 'zed'])).toBe('X')
    expect(firstLetter(['9a', '___'])).toBe(OTHER_LETTER)
  })
})

describe('row summaries', () => {
  it('keeps one plain line, empty when the source has no summary', () => {
    expect(summaryLine('Reads `what` a **pane**\n  shows.')).toBe('Reads what a pane shows.')
    expect(summaryLine(undefined)).toBeUndefined()
    expect(summaryLine('   ')).toBeUndefined()
    expect(summaryLine('x'.repeat(200))).toHaveLength(160)
  })
})
