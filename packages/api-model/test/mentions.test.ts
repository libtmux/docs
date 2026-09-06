import { describe, expect, it } from 'vitest'
import { proseMentions } from '../src/mentions.ts'

const LABELS = { Python: 'py', TypeScript: 'ts', Go: 'go' }

describe('prose mentions', () => {
  it('retains port context through nested sections and resets it at sibling sections', () => {
    const source = [
      '## Python',
      'Use `Session.panes`.',
      '### Windows',
      'Read `Session.windows`.',
      '## Go',
      'Use `Session.Panes`.',
      '## Shared concepts',
      'A `Session` contains windows.',
    ].join('\n')
    expect(proseMentions(source, LABELS).map(({ port, text, line }) => ({ port, text, line }))).toEqual([
      { port: 'py', text: 'Session.panes', line: 2 },
      { port: 'py', text: 'Session.windows', line: 4 },
      { port: 'go', text: 'Session.Panes', line: 6 },
      { port: undefined, text: 'Session', line: 8 },
    ])
  })

  it('keeps sentence context and table port labels', () => {
    const source = "Python uses `Session.panes`.\n\n| Go | `Session.Panes` |"
    expect(proseMentions(source, LABELS)).toEqual([
      { text: 'Session.panes', port: undefined, before: 'Python uses ', line: 1 },
      { text: 'Session.Panes', port: 'go', before: '| Go | ', line: 3 },
    ])
  })

  it('ignores frontmatter and fenced examples but keeps a fence language for subsequent prose', () => {
    const source = [
      '---', 'description: "`Server`"', '---',
      '~~~python', '`not_a_reference`', '~~~',
      'Read `Server.sessions`.',
      '## Other material',
      'Read `Server`.',
    ].join('\n')
    expect(proseMentions(source, LABELS).map(({ port, text }) => ({ port, text }))).toEqual([
      { port: 'py', text: 'Server.sessions' },
      { port: undefined, text: 'Server' },
    ])
  })

  it('keeps a reference when its inline code wraps onto another source line', () => {
    const source = '## Python\nUse `Session.new_window(name,\nattach=False)` to create it.'
    expect(proseMentions(source, LABELS)).toEqual([
      { text: 'Session.new_window(name, attach=False)', port: 'py', before: 'Use ', line: 2 },
    ])
  })
})
