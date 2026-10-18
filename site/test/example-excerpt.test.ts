import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { remarkPortCode, resolvePortCode } from '../src/plugins/remark-port-code.mjs'
import {
  ExcerptError,
  excerptRequest,
  pageSource,
  parseFenceAttributes,
  sliceExcerpt,
  withoutAttributes,
} from '../src/lib/example-excerpt.ts'

const SCRIPT = [
  '#!/bin/sh',
  'set -eu',
  'socket="$directory/tmux.sock"',
  '',
  'cleanup() {',
  '    tmux -S "$socket" kill-server',
  '}',
  'trap cleanup 0',
  '',
  "tmux -S \"$socket\" new-session -d -s demo 'sh'",
  "tmux -S \"$socket\" send-keys -l -t \"$pane\" 'text'",
  'tmux -S "$socket" send-keys -t "$pane" Enter',
  'for attempt in 1 2 3; do',
  '    if grep -Fx ready screen.txt; then',
  '        break',
  '    fi',
  'done',
].join('\n')

describe('fence attributes', () => {
  it('reads double- and single-quoted values', () => {
    expect(parseFenceAttributes(`title="a.sh" from='say "hi"' to="x"`)).toEqual({
      title: 'a.sh', from: 'say "hi"', to: 'x',
    })
  })

  it('does not read an attribute inside a quoted value', () => {
    expect(parseFenceAttributes(`from='socket="$d/x"' to="end"`)).toEqual({ from: 'socket="$d/x"', to: 'end' })
  })

  it('ignores bare words and empty metadata', () => {
    expect(parseFenceAttributes('wrap {1-3} title="a"')).toEqual({ title: 'a' })
    expect(parseFenceAttributes(undefined)).toEqual({})
    expect(parseFenceAttributes(null)).toEqual({})
  })

  it('removes only the named attributes and keeps the rest in order', () => {
    expect(withoutAttributes(`title="a" excerpt="b" from='c d' to="e"`, ['excerpt', 'from', 'to'])).toBe('title="a"')
    expect(withoutAttributes(`excerpt="b" from="c"`, ['excerpt', 'from'])).toBe('')
  })
})

describe('sliceExcerpt', () => {
  it('returns the single line that contains the from anchor', () => {
    expect(sliceExcerpt(SCRIPT, { from: 'new-session -d' }, 'x')).toBe(
      "tmux -S \"$socket\" new-session -d -s demo 'sh'",
    )
  })

  it('runs from the first line to the first later line that contains the to anchor', () => {
    expect(sliceExcerpt(SCRIPT, { from: 'cleanup() {', to: 'trap cleanup' }, 'x')).toBe(
      ['cleanup() {', '    tmux -S "$socket" kill-server', '}', 'trap cleanup 0'].join('\n'),
    )
  })

  it('ends a block at the first closing line after the start, as a sed range does', () => {
    expect(sliceExcerpt(SCRIPT, { from: 'for attempt', to: 'done' }, 'x').split('\n')).toHaveLength(5)
    expect(sliceExcerpt(SCRIPT, { from: 'if grep', to: 'fi' }, 'x')).toBe(
      ['if grep -Fx ready screen.txt; then', '    break', 'fi'].join('\n'),
    )
  })

  it('removes the indentation every line shares and keeps the rest', () => {
    expect(sliceExcerpt(SCRIPT, { from: 'if grep', to: 'fi' }, 'x')).toContain('\n    break\n')
    const nested = 'main() {\n\t\tfirst()\n\t\t\tsecond()\n\t}'
    expect(sliceExcerpt(nested, { from: 'first()', to: 'second()' }, 'x')).toBe('first()\n\tsecond()')
  })

  it('ends a nested block at the closing line of its own depth with an = anchor', () => {
    const go = ['func f() {', '  for {', '    if x {', '      y()', '    }', '  }', '}'].join('\n')
    expect(sliceExcerpt(go, { from: 'for {', to: '=  }' }, 'x')).toBe('for {\n  if x {\n    y()\n  }\n}')
    expect(sliceExcerpt(go, { from: 'if x', to: '=    }' }, 'x')).toBe('if x {\n  y()\n}')
    expect(() => sliceExcerpt(go, { from: 'for {', to: '=}}' }, 'x')).toThrow(/matches no line/)
    expect(() => sliceExcerpt(go, { from: '=  for {' }, 'x')).not.toThrow()
  })

  it('reads CRLF sources as lines', () => {
    expect(sliceExcerpt('a\r\nb\r\nc', { from: 'b', to: 'c' }, 'x')).toBe('b\nc')
  })

  describe('failures', () => {
    it('rejects a from anchor that matches no line', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'rename-window' }, 'send-command.sh')).toThrow(
        /send-command\.sh: from anchor "rename-window" matches no line/,
      )
    })

    it('rejects a from anchor that matches several lines and names them', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'tmux -S' }, 'send-command.sh')).toThrow(
        /from anchor "tmux -S" is ambiguous: it matches lines 6, 10, 11, 12/,
      )
    })

    it('rejects a to anchor that matches no line', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'cleanup() {', to: 'rename-window' }, 'x')).toThrow(
        /to anchor "rename-window" matches no line/,
      )
    })

    it('rejects a to anchor that only appears above the from anchor', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'for attempt', to: 'set -eu' }, 'x')).toThrow(
        /to anchor "set -eu" appears only at line 2, above the from anchor at line 13/,
      )
    })

    it('rejects a to anchor that only appears on the from line', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'new-session -d', to: 'new-session' }, 'x')).toThrow(
        /to anchor "new-session" appears only at line 10, the from anchor's own line/,
      )
    })

    it('rejects empty anchors', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: '' }, 'x')).toThrow(ExcerptError)
      expect(() => sliceExcerpt(SCRIPT, { from: 'trap', to: '' }, 'x')).toThrow(/empty to anchor/)
    })

    it('throws ExcerptError so a build can name the page', () => {
      expect(() => sliceExcerpt(SCRIPT, { from: 'absent' }, 'x')).toThrow(ExcerptError)
    })
  })
})

describe('excerptRequest', () => {
  it('is not an excerpt without a from or to anchor, so whole-file fences are untouched', () => {
    expect(excerptRequest({ file: 'examples/main.go' })).toBeUndefined()
    expect(excerptRequest({ title: 'main.go' })).toBeUndefined()
  })

  it('names a page source with excerpt and a file source with file', () => {
    expect(excerptRequest({ excerpt: 'send-command.sh', from: 'a', to: 'b' })).toEqual({
      source: { kind: 'page', name: 'send-command.sh' }, from: 'a', to: 'b',
    })
    expect(excerptRequest({ file: 'examples/main.go', from: 'a' })).toEqual({
      source: { kind: 'file', name: 'examples/main.go' }, from: 'a', to: undefined,
    })
  })

  it('rejects an excerpt that names no source, two sources, or no from anchor', () => {
    expect(() => excerptRequest({ from: 'a' })).toThrow(/names no source/)
    expect(() => excerptRequest({ excerpt: 'a.sh', file: 'b.go', from: 'a' })).toThrow(/both excerpt and file/)
    expect(() => excerptRequest({ excerpt: 'a.sh', to: 'b' })).toThrow(/needs a from anchor/)
    expect(() => excerptRequest({ excerpt: 'a.sh' })).toThrow(/needs a from anchor/)
  })
})

describe('pageSource', () => {
  const blocks = [
    { meta: 'title="send-command.sh"', value: 'echo one' },
    { meta: 'title="workspace.conf"', value: 'new-session' },
    { meta: 'excerpt="send-command.sh" from="echo"', value: '' },
    { meta: 'file="examples/main.go" title="main.go"', value: '' },
    { meta: '', value: 'untitled' },
  ]

  it('finds the one literal block with that title', () => {
    expect(pageSource(blocks, 'send-command.sh', 'page')).toBe('echo one')
  })

  it('does not take an excerpt or a file inclusion as a source', () => {
    expect(() => pageSource(blocks, 'main.go', 'page')).toThrow(/no code block titled "main\.go"/)
  })

  it('rejects a missing title and a duplicated one', () => {
    expect(() => pageSource(blocks, 'absent.sh', 'page')).toThrow(/no code block titled "absent\.sh"/)
    expect(() => pageSource([...blocks, { meta: 'title="send-command.sh"', value: 'echo two' }], 'send-command.sh', 'page'))
      .toThrow(/2 code blocks titled "send-command\.sh"/)
  })
})

describe('excerpts in a page', () => {
  const page = [
    'Start the session.',
    '',
    '```sh excerpt="send-command.sh" from=\'new-session -d\'',
    '```',
    '',
    'Wait for the line.',
    '',
    '```sh title="step.sh" excerpt="send-command.sh" from="for attempt" to="done"',
    '```',
    '',
    '```sh title="send-command.sh"',
    SCRIPT,
    '```',
    '',
  ].join('\n')

  const render = async (markdown: string) => {
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], syntaxHighlight: false })
    return (await renderer.render(markdown, { fileURL: new URL('file:///site/page.md') })).code
  }
  const codeOf = (html: string) => {
    const window = new Window()
    window.document.body.innerHTML = html
    return [...window.document.querySelectorAll('pre > code')].map((code) => code.textContent)
  }

  it('fills each excerpt from the titled block, before or after it on the page', async () => {
    const blocks = codeOf(await render(page))
    expect(blocks[0]).toBe("tmux -S \"$socket\" new-session -d -s demo 'sh'\n")
    expect(blocks[1]).toBe(sliceExcerpt(SCRIPT, { from: 'for attempt', to: 'done' }, 'x') + '\n')
    expect(blocks[2]).toBe(SCRIPT + '\n')
  })

  it('exports the same lines and drops the anchors from the fence', () => {
    const exported = resolvePortCode(page)
    expect(exported).toContain("```sh\ntmux -S \"$socket\" new-session -d -s demo 'sh'\n```")
    expect(exported).toContain('```sh title="step.sh"\nfor attempt in 1 2 3; do')
    expect(exported).not.toMatch(/excerpt=|from=|to=/)
  })

  it('fails the render with the page path when an anchor stops resolving', async () => {
    const drifted = page.replace('new-session -d', 'new-session -x')
    await expect(render(drifted)).rejects.toThrow(/\/site\/page\.md: excerpt of send-command\.sh: from anchor "new-session -x" matches no line/)
    expect(() => resolvePortCode(drifted)).toThrow(/from anchor "new-session -x" matches no line/)
  })

  it('fails the render for an ambiguous or reversed anchor', async () => {
    await expect(render(page.replace('new-session -d', 'tmux -S'))).rejects.toThrow(/ambiguous/)
    await expect(render(page.replace('to="done"', 'to="set -eu"'))).rejects.toThrow(/above the from anchor/)
  })

  it('fails the render when the source block is missing', async () => {
    await expect(render(page.replace('title="send-command.sh"', 'title="other.sh"'))).rejects.toThrow(
      /no code block titled "send-command\.sh"/,
    )
  })

  it('quotes a port file from the revision-bound cache', async () => {
    const quoted = [
      '```go file="examples/quickstart/main.go" from="server, err := tmux.NewServer" to="return run(ctx, server)"',
      '```',
      '',
    ].join('\n')
    const [block] = codeOf(await render(quoted))
    expect(block).toBe([
      'server, err := tmux.NewServer(tmux.ServerOptions{})',
      'if err != nil {',
      '\treturn fmt.Errorf("configure tmux server: %w", err)',
      '}',
      'return run(ctx, server)',
      '',
    ].join('\n'))
    await expect(render(quoted.replace('server, err := tmux.NewServer', 'server, err := tmux.NewGizmo')))
      .rejects.toThrow(/examples\/quickstart\/main\.go: from anchor/)
  })

  it('leaves a whole-file inclusion alone', async () => {
    const [block] = codeOf(await render('```go file="examples/quickstart/main.go"\n```\n'))
    expect(block).toContain('package main')
    expect(block).toContain('docs:end')
  })
})
