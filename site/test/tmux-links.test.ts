import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_MODELS, indexFor } from '../src/lib/api-models'
import { tmuxCommandMentions, linkTmuxDoc, tmuxMentionMarkdown } from '../src/lib/tmux-links'
import { tmuxManual } from '../src/lib/tmux-manual-data'
import { fromMarkdown } from 'mdast-util-from-markdown'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('contextual tmux command mentions', () => {
  it('resolves canonical names and explicit invocation aliases from the selected native catalog', () => {
    const input = '$ tmux -L run-shell -f "file name" -S /tmp/example run -b true'
    expect(tmuxCommandMentions(input, { code: true })).toEqual([{
      start: input.indexOf('run -b'), end: input.indexOf('run -b') + 3, text: 'run',
      command: 'run-shell', href: '/tmux/latest/manual/run-shell/',
    }])
    expect(tmuxCommandMentions('tmux -CLexample -- has -t work', { code: true })[0]?.command).toBe('has-session')
    for (const version of ['3.2a', '3.7c']) {
      for (const command of tmuxManual(version).commands) {
        expect(tmuxCommandMentions(command.name, { code: true, version })[0]?.href)
          .toBe(`/tmux/${version}/manual/${command.name}/`)
        if (command.alias) expect(tmuxCommandMentions(`tmux ${command.alias}`, { code: true, version })[0]?.command).toBe(command.name)
      }
    }
    expect(tmuxCommandMentions('new-pane', { code: true, version: '3.2a' })).toEqual([])
    expect(tmuxCommandMentions('new-pane', { code: true, version: '3.7c' })[0]?.command).toBe('new-pane')
  })

  it('leaves ordinary aliases, filenames, flags, quoted strings and unknown invocations literal', () => {
    for (const input of ['tmux has many panes.', 'tmux run and wait.', 'run', 'has', 'libtmux.run-shell', '/tmp/run-shell', 'run-shell.md', '--run-shell', '"run-shell"', "'tmux run-shell'", '# run-shell', 'tmux -Q run-shell', 'tmux -c "run-shell"', 'tmux -V run-shell', 'tmux missing-command']) {
      const code = !input.startsWith('tmux has ') && !input.startsWith('tmux run and ')
      expect(tmuxCommandMentions(input, { code }), input).toEqual([])
    }
    expect(tmuxCommandMentions('Use resize-pane and display-message.').map((mention) => mention.command))
      .toEqual(['resize-pane', 'display-message'])
  })

  it('preserves actual native summaries, API references and selected text in every port', () => {
    const cases = [
      ['py', 'libtmux.Server.run_shell', 'run-shell'],
      ['py', 'libtmux.Server.set_buffer', 'set-buffer'],
      ['go', 'tmux.Pane.Resize', 'resize-pane'],
      ['rs', 'control.Event.Message', 'display-message'],
    ]
    for (const [port, id, command] of cases) {
      const model = API_MODELS[port]
      const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === id)!
      expect(symbol, id).toBeDefined()
      const index = indexFor(model, (entry) => `#${entry.id}`)
      const before = index.linkText(symbol.doc!.summary!, symbol)
      const after = linkTmuxDoc(before)
      expect(after.map((span) => 'text' in span ? span.text : span.label).join(''))
        .toBe(before.map((span) => 'text' in span ? span.text : span.label).join(''))
      expect(after.some((span) => span.kind === 'link' && span.href === `/tmux/latest/manual/${command}/`), id).toBe(true)
      for (const span of before.filter((entry) => entry.link)) expect(after).toContainEqual(span)
    }
    const authored = { kind: 'link' as const, text: 'run-shell', code: true, href: 'https://example.com/authored' }
    expect(linkTmuxDoc([authored])).toEqual([authored])
  })

  it('preserves Markdown code text while giving multiple commands independent destinations', () => {
    const input = 'tmux run-shell true && tmux display-message "hello"'
    const markdown = tmuxMentionMarkdown(input, true)!
    const children = (fromMarkdown(markdown).children[0] as { children: { type: string; value?: string; children?: { value: string }[] }[] }).children
    expect(children.map((node) => node.value ?? node.children?.map((child) => child.value).join('')).join('')).toBe(input)
    expect(markdown).toContain('/tmux/latest/manual/run-shell/')
    expect(markdown).toContain('/tmux/latest/manual/display-message/')
  })

  it('keeps native command destinations under the real preview root rather than a library version', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-123/en')
    const links = await import('../src/lib/tmux-links')
    expect(links.tmuxCommandMentions('run-shell', { code: true, version: '3.2a' })[0]?.href)
      .toBe('/pr-123/en/tmux/3.2a/manual/run-shell/')
  })
})
