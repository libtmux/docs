import { describe, expect, it } from 'vitest'
import { createRenderer } from 'astro-expressive-code'
import { select } from 'astro-expressive-code/hast'
import { sessionLines, shellPrompt } from '../src/plugins/ec-shell-prompt.mjs'

const copied = (lines: string[]) => sessionLines(lines)
  .filter((line) => line.kind !== 'output').map((line) => line.text).join('\n')

describe('console command continuations', () => {
  it('copies a multiline quoted program including comment lines, then omits output', async () => {
    const renderer = await createRenderer({ plugins: [shellPrompt()] })
    const command = "ruby -e '\n# Ruby source\nputs \"ready\"\n'"
    const rendered = await renderer.ec.render({ code: `$ ${command}\nready`, language: 'console' })
    const button = select('[data-code]', rendered.renderedGroupAst)
    expect(button?.properties.dataCode).toBe(command.replace(/\n/g, '\x7f'))
  })

  it.each(["'", '"', '`'])('keeps %s quote state across command lines', (quote) => {
    const lines = [`$ echo ${quote}first`, '$ literal prompt', `last${quote} &&`, '  next', 'output', '$ done']
    expect(copied(lines)).toBe(`echo ${quote}first\n$ literal prompt\nlast${quote} &&\n  next\ndone`)
    expect(sessionLines(lines).map((line) => line.kind))
      .toEqual(['prompt', 'command', 'command', 'command', 'output', 'prompt'])
  })

  it('renders complete chained clipboard bytes and omits session output', async () => {
    const renderer = await createRenderer({ plugins: [shellPrompt()] })
    const code = '$ first &&\n  # prepare the next step\n\n  (second ||\n    third) |\n  fourth\noutput &&\nstill output'
    const rendered = await renderer.ec.render({ code, language: 'console' })
    const button = select('[data-code]', rendered.renderedGroupAst)
    expect(button?.properties.dataCode).toBe('first &&\x7f  # prepare the next step\x7f\x7f  (second ||\x7f    third) |\x7f  fourth')
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

  it('leaves escaped quotes open and preserves a quoted final backslash', () => {
    const lines = ['$ echo "first \\"', 'next\\', 'last"', 'output']
    expect(copied(lines)).toBe(lines.slice(0, -1).join('\n').slice(2))
  })

  it('does not extend a command ending in an escaped backslash', () => {
    expect(copied(['$ echo \\\\', 'output', '$ next'])).toBe('echo \\\\\nnext')
  })

  it('keeps a hash inside a word after escaped whitespace', () => {
    const command = String.raw`printf '%s\n' alpha\ #beta` + '\\'
    expect(copied([`$ ${command}`, '  gamma', 'output'])).toBe(`${command}\n  gamma`)
  })

  it('keeps a hash inside a word after closing a continued quote', () => {
    const lines = ["$ echo 'first", "last'#literal\\", '  next', 'output']
    expect(copied(lines)).toBe(lines.slice(0, -1).join('\n').slice(2))
  })

  it('keeps a joined word across a backslash-newline', () => {
    const lines = ['$ echo alpha\\', '#beta\\', '  gamma', 'output']
    expect(copied(lines)).toBe(lines.slice(0, -1).join('\n').slice(2))
  })

  it('keeps a word boundary before a backslash-newline', () => {
    const lines = ['$ echo alpha \\', '# comment', 'output']
    expect(copied(lines)).toBe('echo alpha \\\n# comment')
    expect(sessionLines(lines).map((line) => line.kind))
      .toEqual(['prompt', 'command', 'output'])
  })

  it('does not let a quote in output consume the next prompt', () => {
    expect(copied(['$ echo first', "output with ' an apostrophe", '$ next'])).toBe('echo first\nnext')
  })

  it('preserves existing backslash continuations and bare command lists', () => {
    expect(copied(['$ first \\', '  second', 'output'])).toBe('first \\\n  second')
    expect(copied(['first &&', '  second'])).toBe('first &&\n  second')
  })
})
