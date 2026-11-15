import { describe, expect, it } from 'vitest'
import { countLabel, highlightRanges, matchesQuery, queryWords, tally } from '../src/lib/member-filter'

/** The pure rules of a member collection's search and group chips (record 0056). */
describe('the member search', () => {
  it('splits a query into lower-case words and ignores extra space', () => {
    expect(queryWords('  Capture   PANE ')).toEqual(['capture', 'pane'])
    expect(queryWords('   ')).toEqual([])
  })

  it('matches a row only when every word is in its name or its summary', () => {
    const row = 'CapturePane Reads the text a pane shows.'
    expect(matchesQuery(row, queryWords('capture'))).toBe(true)
    expect(matchesQuery(row, queryWords('capture text'))).toBe(true)
    expect(matchesQuery(row, queryWords('capture window'))).toBe(false)
    expect(matchesQuery(row, [])).toBe(true)
  })

  it('marks every match once and joins matches that touch or overlap', () => {
    expect(highlightRanges('SendKeys sends keys', ['send', 'keys'])).toEqual([[0, 8], [9, 13], [15, 19]])
    expect(highlightRanges('abcabc', ['abc', 'bca'])).toEqual([[0, 6]])
    expect(highlightRanges('nothing here', ['zzz'])).toEqual([])
  })
})

describe('the group chips', () => {
  const rows = [
    { group: 'parent', kind: 'method', text: 'Session Returns the session.' },
    { group: 'operations', kind: 'method', text: 'Capture Reads the pane.' },
    { group: 'operations', kind: 'method', text: 'SendKeys Types into the pane.' },
    { group: 'other', kind: 'property', text: 'Title The pane title.' },
  ]

  it('counts what the search leaves in each group and in all', () => {
    expect(tally(rows, [], '', '')).toEqual({ all: 4, groups: { parent: 1, operations: 2, other: 1 }, kinds: { method: 3, property: 1 } })
    const left = tally(rows, ['pane'], '', '')
    expect(left.all).toBe(3)
    expect(left.groups).toEqual({ parent: 0, operations: 2, other: 1 })
  })

  it('counts a group with no match as zero, which the chip shows disabled', () => {
    expect(tally(rows, ['title'], '', '').groups.operations).toBe(0)
  })

  it('narrows the group counts by the kind chip, and the kind counts by the group chip', () => {
    expect(tally(rows, [], '', 'property').groups).toEqual({ parent: 0, operations: 0, other: 1 })
    expect(tally(rows, [], 'operations', '').kinds).toEqual({ method: 2, property: 0 })
  })
})

describe('the count beside the heading', () => {
  it('reads "12 of 175 members" while anything narrows the list, and the plain total otherwise', () => {
    expect(countLabel(12, 175, 'members')).toBe('12 of 175 members')
    expect(countLabel(175, 175, 'members')).toBe('175 members')
    expect(countLabel(0, 175, 'methods')).toBe('0 of 175 methods')
  })
})
