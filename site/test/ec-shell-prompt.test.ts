import { describe, expect, it } from 'vitest'
import { createRenderer } from 'astro-expressive-code'
import { select } from 'astro-expressive-code/hast'
import { sessionLines, shellPrompt } from '../src/plugins/ec-shell-prompt.mjs'

const copied = (lines: string[]) => sessionLines(lines)
  .filter((line) => line.kind !== 'output').map((line) => line.text).join('\n')

describe('console command continuations', () => {
  it('renders complete chained clipboard bytes and omits session output', async () => {
    const renderer = await createRenderer({ plugins: [shellPrompt()] })
    const code = '$ first &&\n  # prepare the next step\n\n  (second ||\n    third) |\n  fourth\noutput &&\nstill output'
    const rendered = await renderer.ec.render({ code, language: 'console' })
    const button = select('[data-code]', rendered.renderedGroupAst)
    expect(button?.properties.dataCode).toBe('first &&\x7f  (second ||\x7f    third) |\x7f  fourth')
  })

  it('copies a complete dependency setup and nested subshell chain', () => {
    const lines = [
      '$ git clone https://example.com/library.git source &&',
      '  git -C source checkout abc123 &&',
      '  (cd source &&',
      '    make install) &&',
      '  eval "$(package path)"',
      'installed',
    ]
    expect(copied(lines)).toBe(lines.slice(0, -1).join('\n').slice(2))
    expect(sessionLines(lines).map((line) => line.kind))
      .toEqual(['prompt', 'command', 'command', 'command', 'command', 'output'])
  })

  it.each(['&&', '||', '|'])('copies the continuation after %s, then omits output', (operator) => {
    expect(copied([`$ first ${operator}  `, '  second', 'output']))
      .toBe(`first ${operator}  \n  second`)
  })

  it.each([
    "printf '%s\\n' 'literal &&'",
    'printf "%s\\n" "literal ||"',
    'echo `printf "literal |"`',
    'printf done # comment &&',
    String.raw`printf '%s\n' \&&`,
    String.raw`printf '%s\n' \|`,
    'echo unfinished "quoted &&',
  ])('does not treat literal or commented operators as commands: %s', (command) => {
    expect(copied([`$ ${command}`, 'output', '$ next'])).toBe(`${command}\nnext`)
  })

  it('recognizes an operator before its trailing shell comment', () => {
    expect(copied(['$ first && # install first', '  second', 'output']))
      .toBe('first && # install first\n  second')
  })

  it.each(['  # install the next dependency', '', '   '])(
    'keeps an operator waiting across a comment or blank line: %j', (between) => {
      const lines = ['$ first &&', between, '  second', 'output']
      expect(copied(lines)).toBe(`first &&\n${between}\n  second`)
      expect(sessionLines(lines).map((line) => line.kind))
        .toEqual(['prompt', 'command', 'command', 'output'])
    },
  )

  it('does not extend a backslash continuation through a completed comment line', () => {
    expect(copied(['$ first \\', '  # comment', 'output'])).toBe('first \\\n  # comment')
  })

  it('does not make an output operator consume the next output line', () => {
    expect(copied(['$ print', 'output &&', 'still output', '$ next'])).toBe('print\nnext')
  })

  it('preserves existing backslash continuations and bare command lists', () => {
    expect(copied(['$ first \\', '  second', 'output'])).toBe('first \\\n  second')
    expect(copied(['first &&', '  second'])).toBe('first &&\n  second')
  })
})
