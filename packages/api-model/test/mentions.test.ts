import { describe, expect, it } from 'vitest'
import type { ApiModel } from '../src/model.ts'
import { LinkedOwners, pageMentions, proseMentions, type LinkedOwner } from '../src/mentions.ts'
import { Resolver } from '../src/resolver.ts'
import { isLikelyReference, notApiReason } from '../src/prose.ts'

const LABELS = { Python: 'py', TypeScript: 'ts', Go: 'go' }

describe('prose mentions', () => {
  it('reports exact source spans without including frontmatter or fenced code', () => {
    const source = '---\ntitle: `Server`\n---\nUse ``Server`` and `Session.panes`.\n\n```python\n`Server`\n```'
    const mentions = proseMentions(source, LABELS)
    expect(mentions.map(({ start, end }) => source.slice(start, end))).toEqual(['``Server``', '`Session.panes`'])
  })

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
    expect(proseMentions(source, LABELS).map(({ start: _start, end: _end, ...mention }) => mention)).toEqual([
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
    expect(proseMentions(source, LABELS).map(({ start: _start, end: _end, ...mention }) => mention)).toEqual([
      { text: 'Session.new_window(name, attach=False)', port: 'py', before: 'Use ', line: 2 },
    ])
  })

  it('retains authored destinations for inline, reference and descriptive links', () => {
    const source = [
      '[`capture_pane`](/julia/latest/mcp/tools/capture_pane/)',
      '[`error.effects`][effects]',
      '[Read `Session` details](<../reference/session/#members> "Session")',
      '[`Server`][] and [`Pane`].',
      '',
      '[effects]: /julia/latest/mcp/tools/run_operations/#output',
      '[`Server`]: https://example.org/server',
      '[`Pane`]: /reference/pane/',
    ].join('\n')
    expect(proseMentions(source, LABELS).map(({ text, linked, href }) => ({ text, linked, href }))).toEqual([
      { text: 'capture_pane', linked: true, href: '/julia/latest/mcp/tools/capture_pane/' },
      { text: 'error.effects', linked: true, href: '/julia/latest/mcp/tools/run_operations/#output' },
      { text: 'Session', linked: true, href: '../reference/session/#members' },
      { text: 'Server', linked: true, href: 'https://example.org/server' },
      { text: 'Pane', linked: true, href: '/reference/pane/' },
    ])
  })

  it('does not read image alt text or escaped code delimiters as API mentions', () => {
    const source = '![`Server`](server.svg) and \\`Pane\\` beside `Window`.'
    expect(proseMentions(source, LABELS).map(({ text }) => text)).toEqual(['Window'])
  })
})

describe('spans that are code but not API', () => {
  it('names tmux releases and variable expressions, which otherwise read as references', () => {
    for (const text of ['3.3a', '3.8-rc2', '3.3a-rc', 'next-3.9', 'next-3.3a']) {
      expect(isLikelyReference(text), text).toBe(true)
      expect(notApiReason(text), text).toBe('tmux release name')
    }
    for (const text of ['$captured.Windows[0]', '$server.Sessions', '$_.Panes.Count']) {
      expect(isLikelyReference(text), text).toBe(true)
      expect(notApiReason(text), text).toBe('variable expression')
    }
  })

  it('names the C compiler variable, which is too short for the general environment variable rule', () => {
    expect(isLikelyReference('CC')).toBe(true)
    expect(notApiReason('CC')).toBe('environment variable')
    expect(notApiReason('CFLAGS')).toBe('environment variable')
    // Another two-letter name is a candidate symbol: Elixir's `IO` is a module.
    for (const text of ['IO', 'CD', 'CCx']) expect(notApiReason(text), text).toBeUndefined()
  })

  it('leaves qualified names and versioned identifiers to the resolver', () => {
    for (const text of ['Server.panes', 'LibTmux.Server', 'v3.3a', '3.3a.Server', 'Version.next', 'TmuxVersion.V3_3a']) {
      expect(notApiReason(text), text).toBeUndefined()
    }
  })
})

describe('a name that earlier links on the page gave an owner', () => {
  const WAIT: LinkedOwner = { port: 'csharp', symbol: 'LibTmux.PaneWaitOutcome.PaneExited' }
  const RUN: LinkedOwner = { port: 'csharp', symbol: 'LibTmux.PaneRunResult.PaneExited' }
  const OWNERS: Record<string, LinkedOwner> = { '/csharp/latest/reference/wait/': WAIT, '/csharp/latest/reference/run/': RUN }

  // Two C# types declare PaneExited, so the bare name is ambiguous in the C# model, and PowerShell, which
  // wraps that library, defines nothing of the name.
  const model = (port: string, symbols: { id: string; name: string; kind: string; parent?: string }[]) =>
    ({ port, version: '0', symbols: symbols.map((symbol) => ({ ...symbol, signatures: [], docs: [] })) })
  const models = {
    csharp: model('csharp', [
      { id: 'LibTmux.PaneWaitOutcome', name: 'PaneWaitOutcome', kind: 'enum' },
      { id: 'LibTmux.PaneWaitOutcome.PaneExited', name: 'PaneExited', kind: 'constant', parent: 'LibTmux.PaneWaitOutcome' },
      { id: 'LibTmux.PaneRunResult', name: 'PaneRunResult', kind: 'class' },
      { id: 'LibTmux.PaneRunResult.PaneExited', name: 'PaneExited', kind: 'property', parent: 'LibTmux.PaneRunResult' },
    ]),
    powershell: model('powershell', [{ id: 'LibTmux\\Get-TmuxPane', name: 'Get-TmuxPane', kind: 'function' }]),
  } as unknown as Record<string, ApiModel>
  const resolver = new Resolver(Object.values(models))

  /** The page mentions the generator would record, with links to the owners above. */
  function page(body: string, portAt?: (offset: number) => string | undefined, authoredTarget = (href?: string) => OWNERS[href ?? '']) {
    return pageMentions({ body, portAt, portByLabel: LABELS, page: '/topics/waits/', nativeTmux: false, resolver, models, authoredTarget })
  }
  const unresolved = (port: string) => [expect.objectContaining({ port, text: 'PaneExited', page: '/topics/waits/' })]

  it('keeps that owner when the name recurs bare in the same section', () => {
    const body = '[`PaneExited`](/csharp/latest/reference/wait/) is a result. A killed server ends as `PaneExited`.'
    expect(page(body, () => 'powershell')).toEqual({ targets: [WAIT, WAIT], dangling: [] })
    // Control: the bare name alone is ambiguous, and is reported.
    expect(page('A killed server ends as `PaneExited`.', () => 'powershell')).toEqual({ targets: [], dangling: unresolved('powershell') })
  })

  it('keeps a link in one port section from naming the same word in another', () => {
    const body = '[`PaneExited`](/csharp/latest/reference/wait/) is a result.\n\nA killed server ends as `PaneExited`.'
    const split = body.indexOf('\n\n')
    expect(page(body, (offset) => (offset < split ? 'csharp' : 'powershell'))).toEqual({ targets: [WAIT], dangling: unresolved('powershell') })
    // Control: with both in the PowerShell section the bare name inherits.
    expect(page(body, () => 'powershell')).toEqual({ targets: [WAIT, WAIT], dangling: [] })
  })

  it('does not choose between two owners that links gave the name', () => {
    const both = '[`PaneExited`](/csharp/latest/reference/wait/) and [`PaneExited`](/csharp/latest/reference/run/) then `PaneExited`.'
    expect(page(both, () => 'powershell')).toEqual({ targets: [WAIT, RUN], dangling: unresolved('powershell') })
    // Control: the same owner linked twice is still one owner.
    const twice = '[`PaneExited`](/csharp/latest/reference/wait/) and [`PaneExited`](/csharp/latest/reference/wait/) then `PaneExited`.'
    expect(page(twice, () => 'powershell')).toEqual({ targets: [WAIT, WAIT, WAIT], dangling: [] })
  })

  it('gives no owner to a bare name that comes before its link, or whose link has no owner', () => {
    const before = 'A killed server ends as `PaneExited`. [`PaneExited`](/csharp/latest/reference/wait/) is a result.'
    expect(page(before, () => 'powershell')).toEqual({ targets: [WAIT], dangling: unresolved('powershell') })
    const unowned = '[`PaneExited`](https://example.org/outcome) is a result. A killed server ends as `PaneExited`.'
    expect(page(unowned, () => 'powershell')).toEqual({ targets: [], dangling: unresolved('powershell') })
  })

  it('tells names apart by their text', () => {
    const owners = new LinkedOwners()
    owners.link('csharp', 'PaneExited', WAIT)
    expect(owners.recur('csharp', 'PaneExited')).toBe(WAIT)
    expect(owners.recur('csharp', 'PollingFallback')).toBeUndefined()
    expect(owners.recur(undefined, 'PaneExited')).toBeUndefined()
  })
})
