import { describe, expect, it } from 'vitest'
import { mapLine, parseHunks } from '../src/source-lines.ts'

/**
 * Diffs are written as literal `git diff -U0` output rather than built from
 * objects, because the parsing is half of what can go wrong: an omitted count
 * means one line, and `-0` and `+0` mean the change sits *between* lines.
 */
describe('parseHunks', () => {
  it('reads an omitted count as one line', () => {
    expect(parseHunks('@@ -3 +3 @@\n-old\n+new\n')).toEqual([
      { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 },
    ])
  })

  it('reads several hunks in one diff', () => {
    const diff = ['@@ -1,2 +1,4 @@', '@@ -10,0 +12,3 @@', '@@ -40,5 +45,0 @@'].join('\n')
    expect(parseHunks(diff).map((h) => h.newStart)).toEqual([1, 12, 45])
  })

  it('ignores content that merely looks like a header', () => {
    // A removed line of source can itself contain `@@`; only a line that
    // starts one is a header.
    expect(parseHunks('@@ -1 +1 @@\n-x = "@@ -9,9 +9,9 @@"\n')).toHaveLength(1)
  })
})

describe('mapLine', () => {
  it('is the identity when nothing changed', () => {
    expect(mapLine([], 42)).toBe(42)
  })

  it('leaves lines above every change alone', () => {
    const h = parseHunks('@@ -100,0 +100,5 @@')
    expect(mapLine(h, 50)).toBe(50)
  })

  /**
   * The case this exists for: a docs branch adds comment lines above a
   * declaration, so the declaration is unchanged but its line number is not.
   */
  it('shifts a line back by an insertion above it', () => {
    const h = parseHunks('@@ -10,0 +11,3 @@')
    expect(mapLine(h, 20)).toBe(17)
  })

  it('shifts a line forward by a deletion above it', () => {
    const h = parseHunks('@@ -10,3 +10,0 @@')
    expect(mapLine(h, 20)).toBe(23)
  })

  it('accumulates several changes above the line', () => {
    const h = parseHunks(['@@ -5,0 +6,2 @@', '@@ -20,4 +22,1 @@'].join('\n'))
    // +2 from the first, -3 from the second, so a line below both moves by 1.
    expect(mapLine(h, 60)).toBe(61)
  })

  it('refuses a line inside a rewritten range', () => {
    const h = parseHunks('@@ -10,2 +10,2 @@')
    expect(mapLine(h, 11)).toBeNull()
  })

  it('refuses a line that was added', () => {
    const h = parseHunks('@@ -10,0 +11,3 @@')
    expect(mapLine(h, 12)).toBeNull()
  })

  /**
   * A pure deletion is recorded at the line it follows. That line still
   * exists and still maps; only what comes after it moves.
   */
  it('maps the line a deletion sits after, rather than refusing it', () => {
    const h = parseHunks('@@ -10,3 +9,0 @@')
    expect(mapLine(h, 9)).toBe(9)
    expect(mapLine(h, 10)).toBe(13)
  })

  it('maps the first line of a file with a change below', () => {
    expect(mapLine(parseHunks('@@ -5,1 +5,2 @@'), 1)).toBe(1)
  })
})
