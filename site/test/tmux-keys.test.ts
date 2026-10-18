import { describe, expect, it } from 'vitest'
import {
  hasKeyCue, isModifierPrefix, parseTmuxKey, tmuxKeyAliases, tmuxKeyList, tmuxKeySequence, tmuxKeysInProse,
  type ProseItem,
} from '../src/lib/tmux-keys'

const code = (value: string): ProseItem => ({ type: 'code', value })
const text = (value: string): ProseItem => ({ type: 'text', value })
const flagged = (...items: ProseItem[]) => tmuxKeysInProse(items).flatMap((flag, index) => flag ? [(items[index] as { value: string }).value] : [])

describe('tmux key grammar', () => {
  it.each([
    ['C-b', 'C', 'b', false], ['M-x', 'M', 'x', false], ['S-Up', 'S', 'Up', true], ['C-Space', 'C', 'Space', true],
    ['M-C-f', 'MC', 'f', false], ['M--', 'M', '-', false], ['M-+', 'M', '+', false], ['^a', 'C', 'a', false],
    ['Enter', '', 'Enter', true], ['F1', '', 'F1', true], ['F12', '', 'F12', true], ['PageUp', '', 'PageUp', true],
    ['PPage', '', 'PPage', true], ['KP5', '', 'KP5', true], ['c', '', 'c', false], ['?', '', '?', false],
    ['[', '', '[', false], ['é', '', 'é', false],
  ])('reads %s', (spelling, modifiers, base, named) => {
    expect(parseTmuxKey(spelling)).toMatchObject({ modifiers, base, named })
  })

  it.each([
    'new-window', 'send-keys', 'status', 'vi', 'emacs', 'on', 'off', 'status-style', 'bg=cyan',
    '#{session_name}', '#S', '%1', '%%', '$TMUX_PANE', '/tmp/tmux.sock', '~/.tmux.conf', '-t', '-x', '10%',
    'mysession:1', '{start}', 'MouseDown1', 'WheelUp', 'User0', 'None',
    'enter', 'escape', 'c-b', 'm-x', 'Ctrl-b', 'Ctrl+b', 'C-', 'C--x', 'C-unwind', 'X-b', 'F13', '^[[27;6;65~', '',
  ])('does not read %s as a key', (spelling) => {
    expect(parseTmuxKey(spelling)).toBeUndefined()
  })

  it('names the modifiers themselves only in a key context', () => {
    for (const prefix of ['C-', 'M-', 'S-', '^']) expect(isModifierPrefix(prefix)).toBe(true)
    expect(tmuxKeySequence('C-', 'key')).toEqual(['C-'])
    expect(tmuxKeySequence('C-', 'mention')).toBeUndefined()
    expect(isModifierPrefix('C')).toBe(false)
  })
})

describe('key sequences by context', () => {
  it.each(['C-b c', 'C-b d', 'M-x', 'C-Space', 'C-c', 'C-b ?', 'C-b 0', 'S-Up'])('%s is a key literal anywhere', (spelling) => {
    for (const policy of ['literal', 'mention', 'key'] as const) {
      expect(tmuxKeySequence(spelling, policy)).toEqual(spelling.split(' '))
    }
  })

  it.each(['Enter', 'F1', 'Escape', 'Tab', 'Up'])('%s needs the manual or a key context', (spelling) => {
    expect(tmuxKeySequence(spelling, 'literal')).toBeUndefined()
    expect(tmuxKeySequence(spelling, 'mention')).toEqual([spelling])
    expect(tmuxKeySequence(spelling, 'key')).toEqual([spelling])
  })

  it.each(['c', 'n', 'q', '^a', '[', '0'])('%s is a key only where the context says so', (spelling) => {
    expect(tmuxKeySequence(spelling, 'literal')).toBeUndefined()
    expect(tmuxKeySequence(spelling, 'mention')).toBeUndefined()
    expect(tmuxKeySequence(spelling, 'key')).toEqual([spelling])
  })

  it('keeps ordinary literals out of every context', () => {
    for (const policy of ['literal', 'mention', 'key'] as const) {
      for (const spelling of ['new-window', 'status-style', '#{window_name}', 'set -g status off', 'C-b new-window']) {
        expect(tmuxKeySequence(spelling, policy)).toBeUndefined()
      }
    }
    // Bare characters are a sequence only where the context already says keys.
    expect(tmuxKeySequence('n n', 'literal')).toBeUndefined()
    expect(tmuxKeySequence('n n', 'mention')).toBeUndefined()
    expect(tmuxKeySequence('n n', 'key')).toEqual(['n', 'n'])
  })
})

describe('key lists', () => {
  it('splits a cell into words and keys', () => {
    expect(tmuxKeyList('F1 or\n  C-h')).toEqual([{ keys: ['F1'] }, { text: ' or ' }, { keys: ['C-h'] }])
    expect(tmuxKeyList('Up, Down')).toEqual([{ keys: ['Up'] }, { text: ', ' }, { keys: ['Down'] }])
    expect(tmuxKeyList('M-1 to M-7')).toEqual([{ keys: ['M-1'] }, { text: ' to ' }, { keys: ['M-7'] }])
    expect(tmuxKeyList('Page Up')).toEqual([{ keys: ['Page Up'] }])
    expect(tmuxKeyList('C-b c')).toEqual([{ keys: ['C-b', 'c'] }])
  })

  it('leaves a cell alone unless every part is a key', () => {
    expect(tmuxKeyList('')).toBeUndefined()
    expect(tmuxKeyList('Cancel command prompt')).toBeUndefined()
    expect(tmuxKeyList('Up, Down and sideways')).toBeUndefined()
    expect(tmuxKeyList('q or exit')).toBeUndefined()
  })

  it('recognises one entry that names several spellings of a key', () => {
    expect(tmuxKeyAliases('NPage/PageDown/PgDn')).toEqual(['NPage', 'PageDown', 'PgDn'])
    expect(tmuxKeyAliases('Up')).toBeUndefined()
    expect(tmuxKeyAliases('/tmp/tmux')).toBeUndefined()
    expect(tmuxKeyAliases('Up/Sideways')).toBeUndefined()
  })
})

describe('key vocabulary', () => {
  it.each([
    ['bound to ‘', '’ by default'], ['the ‘', '’ key followed by'], ['press `', '` to quit'], ['', ' keys, which'],
    ['Pressing ', ' exits'],
  ])('finds a cue in %j and %j', (before, after) => {
    expect(hasKeyCue(before, after)).toBe(true)
  })

  it.each([
    ['the word ', ' into a pane'], ['contains ', ''], ['', ' to -l would type that word'], ['set ', ' on'], ['', ' keyboard layout'],
  ])('finds none in %j and %j', (before, after) => {
    expect(hasKeyCue(before, after)).toBe(false)
  })
})

describe('keys in prose', () => {
  it('marks modified keys wherever they appear', () => {
    expect(flagged(text('Detach with '), code('C-b d'), text(': press Ctrl-b.'))).toEqual(['C-b d'])
    expect(flagged(text('Send '), code('M-x'), text(' or '), code('C-c'), text('.'))).toEqual(['M-x', 'C-c'])
  })

  it('carries a list with a modified key', () => {
    expect(flagged(text('key names such as '), code('Enter'), text(', '), code('C-c'), text(', and '), code('Up'), text('.')))
      .toEqual(['Enter', 'C-c', 'Up'])
    expect(flagged(text('('), code('Enter'), text(', '), code('C-c'), text(') rather than'))).toEqual(['Enter', 'C-c'])
  })

  it('marks a name beside the word key and leaves typed text alone', () => {
    expect(flagged(text('sends the '), code('Enter'), text(' key separately'))).toEqual(['Enter'])
    expect(flagged(text('press '), code('q'), text(' to quit'))).toEqual(['q'])
    expect(flagged(text('Typing the word '), code('Enter'), text(' and pressing Enter'))).toEqual([])
    expect(flagged(text('types the word '), code('Enter'), text(' into a pane'))).toEqual([])
    expect(flagged(text('Supplying '), code('Enter'), text(' to '), code('-l'), text(' would type that word.'))).toEqual([])
    expect(flagged(text('The screen contains '), code('Enter'))).toEqual([])
  })

  it('does not mark ordinary literals', () => {
    expect(flagged(text('Run '), code('new-window'), text(' with '), code('-t'), text(' and '), code('c'), text('.'))).toEqual([])
    expect(flagged(code('status off'), text(', '), code('#{session_name}'), text(' and '), code('/tmp/tmux.sock'))).toEqual([])
    expect(flagged(text('Match '), code('^a'), text(' or '), code('^$'))).toEqual([])
  })

  it('shares the cue across a range', () => {
    expect(flagged(text('the '), code('0'), text(' to '), code('9'), text(' keys'))).toEqual(['0', '9'])
  })
})
