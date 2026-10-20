import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'
import { MAX_SHARED_BY, classify, definitionsOf, deriveUsage, verifyClaims } from '../../scripts/lib/tmux-usage-derive.mjs'
import { guardFlag, libraryScopes, scopeProblems } from '../../scripts/lib/tmux-usage-scopes.mjs'

const known = new Set(['list-panes', 'list-windows', 'list-sessions', 'new-window'])
const scan = (grammar: string, text: string, command = 'list-panes') => scanSource({ grammar, text, commands: new Set([command]), known })
const scopes = readFileSync(new URL('../src/data/tmux-usage/scopes.json', import.meta.url), 'utf8')
const spec = { scopes: libraryScopes(JSON.parse(scopes).commands['list-panes']) }

describe('scanning a send site', () => {
  it('reads the flags written beside the command and ignores a docstring and a default value', async () => {
    const { functions } = await scan('python', [
      'class Session:',
      '    @property',
      '    def panes(self):',
      '        """Runs list-panes with -a."""',
      '        return fetch(list_cmd="list-panes", list_extra_args=["-s", "-t", self.id])',
      '',
      '    def windows(self):',
      '        return fetch(list_cmd="list-windows", list_extra_args=["-t", self.id])',
      '',
      '    def refresh(self, list_cmd: str = "list-panes"):',
      '        return None',
      '',
    ].join('\n'))
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.panes.sites).toEqual([{ command: 'list-panes', line: 5, flags: 'st' }])
    // The control: a different command in the same class, and a default value, are not sends.
    expect(byName.windows.sites).toEqual([])
    expect(byName.refresh.sites).toEqual([])
  })

  it('reads a command line that starts with the command, and not a message that mentions it', async () => {
    const { functions } = await scan('python', [
      'def run(self):',
      '    self.cmd("list-panes -a -F x")',
      '    raise Unsupported("list-panes state")',
      '    raise Unsupported("list-panes")',
      '',
    ].join('\n'))
    expect(functions[0].sites.map((site) => [site.line, site.flags])).toEqual([[2, 'Fa'], [4, '']])
  })

  it('does not lend a neighbouring command its flags', async () => {
    const { functions } = await scan('python', [
      'def capture():',
      '    return [("list-windows", "-a"), ("list-panes", "-t", "x")]',
      '',
    ].join('\n'))
    expect(functions[0].sites.map((site) => site.flags)).toEqual(['t'])
  })

  it('drops the Windows-only branch of a C++ method, which talks to psmux and not tmux', async () => {
    const { functions } = await scan('cpp', [
      'int Server::panes() {',
      '#if defined(_WIN32)',
      '  return run({"list-panes", "-s", "-t", ":"});',
      '#else',
      '  return run({"list-panes", "-a"});',
      '#endif',
      '}',
      '',
    ].join('\n'))
    expect(functions[0]).toMatchObject({ name: 'panes', owner: 'Server' })
    expect(functions[0].sites).toEqual([{ command: 'list-panes', line: 5, flags: 'a' }])
  })

  it('names a Lua method by its table', async () => {
    const { functions } = await scan('lua', 'function Server:snapshot(options)\n  return run({ "list-panes", "-a" })\nend\n')
    expect(functions).toMatchObject([{ name: 'snapshot', owner: 'Server' }])
    expect(functions[0].sites[0].flags).toBe('a')
  })

  it('keeps a site outside any function apart, so a module constant is not credited to a neighbour', async () => {
    const { functions, orphans } = await scan('python', 'LISTINGS = [("list-panes", "-a")]\n\ndef other():\n    return 1\n')
    expect(orphans).toEqual([{ command: 'list-panes', line: 1, flags: 'a' }])
    expect(functions[0].sites).toEqual([])
  })
})

const located = (over: Record<string, unknown>) => ({
  file: 'lib.py', name: 'f', owner: undefined, start: 1, nameLine: 1, end: 3, kind: 'function_definition', sites: [], calls: new Map<string, number>(), ...over,
}) as Parameters<typeof deriveUsage>[0]['functions'][number]
const site = (flags: string, line = 2) => ({ command: 'list-panes', line, flags })
const symbol = (name: string, line: number, over: Record<string, unknown> = {}) => ({ id: `S.${name}`, name, file: 'lib.py', line, ...over })

describe('deciding which symbol sends a command', () => {
  it('maps a method that sends with -s to the session scope and a method that sends nothing to nothing', () => {
    const functions = [
      located({ name: 'panes', start: 1, nameLine: 1, end: 3, sites: [site('st', 2)] }),
      located({ name: 'windows', start: 5, nameLine: 5, end: 7 }),
    ]
    const { entries, unresolved } = deriveUsage({ command: 'list-panes', spec, functions, symbols: [symbol('panes', 1), symbol('windows', 5)] })
    expect(entries).toEqual([{ symbol: 'S.panes', command: 'list-panes', scope: 'session', evidence: ['lib.py:2'], hops: 0 }])
    expect(unresolved).toEqual([])
  })

  it('selects the scope by the flag: -a before -s before a target, and none when no flag settles it', () => {
    expect(classify(spec, 'aF')).toBe('server')
    expect(classify(spec, 'st')).toBe('session')
    expect(classify(spec, 't')).toBe('window')
    // A command with no flag at all may take its scope from somewhere else, so it stays unlinked.
    expect(classify(spec, 'F')).toBe('unknown')
    expect(classify(undefined, 'a')).toBeNull()
  })

  it('credits the public caller of a private helper once, with both lines as evidence', () => {
    const functions = [
      located({ name: '_list', start: 10, nameLine: 10, end: 14, sites: [site('a', 12)] }),
      located({ name: 'everything', start: 1, nameLine: 1, end: 4, calls: new Map([['_list', 3]]) }),
    ]
    const { entries } = deriveUsage({ command: 'list-panes', spec, functions, symbols: [symbol('everything', 1)] })
    expect(entries).toEqual([{ symbol: 'S.everything', command: 'list-panes', scope: 'server', evidence: ['lib.py:12', 'lib.py:3'], hops: 1 }])
  })

  it('does not credit a method that only calls another public sender', () => {
    const functions = [
      located({ name: 'snapshot', start: 1, nameLine: 1, end: 3, sites: [site('a', 2)] }),
      located({ name: 'panes', start: 5, nameLine: 5, end: 7, calls: new Map([['snapshot', 6]]) }),
    ]
    const { entries } = deriveUsage({ command: 'list-panes', spec, functions, symbols: [symbol('snapshot', 1), symbol('panes', 5)] })
    expect(entries.map((entry) => entry.symbol)).toEqual(['S.snapshot'])
  })

  it('leaves a helper that lists at several scopes to its claims, because a caller cannot choose', () => {
    const functions = [
      located({ name: '_command', start: 10, nameLine: 10, end: 16, sites: [site('t', 11), site('st', 12), site('a', 13)] }),
      located({ name: 'panes', start: 1, nameLine: 1, end: 4, calls: new Map([['_command', 3]]) }),
    ]
    const { entries, unresolved } = deriveUsage({ command: 'list-panes', spec, functions, symbols: [symbol('panes', 1)] })
    expect(entries).toEqual([])
    expect(unresolved.map((item) => item.reason)).toEqual(['a shared helper lists at several scopes'])
  })

  it('leaves a helper that many public methods call alone, because it is not what they are for', () => {
    const callers = Array.from({ length: MAX_SHARED_BY + 1 }, (_, index) =>
      located({ name: `op${index}`, start: 20 + index * 3, nameLine: 20 + index * 3, end: 22 + index * 3, calls: new Map([['_refresh', 21 + index * 3]]) }))
    const functions = [located({ name: '_refresh', start: 10, nameLine: 10, end: 14, sites: [site('t', 12)] }), ...callers]
    const symbols = callers.map((fn) => symbol(fn.name, fn.start))
    const { entries, unresolved } = deriveUsage({ command: 'list-panes', spec, functions, symbols })
    expect(entries).toEqual([])
    expect(unresolved[0].reason).toMatch(/shared by 5 public symbols/)
  })

  it('finds a C++ definition from the header that declares it, and not from a same-named type', () => {
    const functions = [located({ file: 'src/entities.cpp', name: 'panes', owner: 'Window', start: 5, nameLine: 5, end: 9, sites: [site('t', 7)] })]
    const symbols = [
      { id: 'a::Window::panes', name: 'panes', qualified: 'a::Window::panes', parentName: 'a::Window', file: 'include/a/entities.hpp', line: 40 },
      { id: 'a::workspace::Window::panes', name: 'panes', qualified: 'a::workspace::Window::panes', parentName: 'a::workspace::Window', file: 'examples/workspace.hpp', line: 9 },
    ]
    const owned = [...definitionsOf(functions, symbols).values()].flat().map((entry) => entry.id)
    expect(owned).toEqual(['a::Window::panes'])
  })
})

describe('reviewed claims', () => {
  const source = [
    'impl Server {',
    '    pub async fn panes(&self) {',
    '        listing::panes(&self.core, Scope::Server).await',
    '    }',
    '}',
    'match self { Self::Server => command.arg("-a") }',
  ].join('\n')
  const functions = [located({ file: 'server.rs', name: 'panes', owner: 'Server', start: 2, nameLine: 2, end: 4 })]
  const symbols = [{ id: 'server.Server.panes', name: 'panes', parentName: 'Server', file: 'server.rs', line: 2 }]
  const claim = (over: Record<string, unknown> = {}) => ({
    port: 'rs', symbol: 'server.Server.panes', command: 'list-panes', scope: 'server',
    evidence: [
      { at: 'server.rs:6', has: ['Self::Server', '.arg("-a")'] },
      { at: 'server.rs:3', has: ['listing::panes', 'Scope::Server'], in: 'server.Server.panes' },
    ],
    ...over,
  })
  const verify = (claims: unknown[], sends?: () => boolean) => verifyClaims({
    claims: claims as Parameters<typeof verifyClaims>[0]['claims'], spec, functions, types: [], symbols,
    readSource: (path: string) => (path === 'server.rs' ? source : undefined), sends,
  })

  it('accepts a claim whose lines still say what it says, anchored in the symbol', () => {
    expect(verify([claim()])).toEqual({
      problems: [],
      entries: [{ symbol: 'server.Server.panes', command: 'list-panes', scope: 'server', evidence: ['server.rs:6', 'server.rs:3'], hops: 1, reviewed: true }],
    })
  })

  it.each([
    ['a line that no longer holds the text', { evidence: [{ at: 'server.rs:6', has: ['.arg("-s")'] }, { at: 'server.rs:3', in: 'server.Server.panes' }] }, /does not contain/],
    ['a line past the end of the file', { evidence: [{ at: 'server.rs:99' }, { at: 'server.rs:3', in: 'server.Server.panes' }] }, /not a line of the pinned source/],
    ['a line outside the symbol body', { evidence: [{ at: 'server.rs:6', in: 'server.Server.panes' }] }, /outside the body/],
    ['no line anchored in the symbol', { evidence: [{ at: 'server.rs:3' }] }, /no evidence line is anchored/],
    ['a symbol the model does not have', { symbol: 'server.Server.gone' }, /no such public symbol/],
    ['a scope the command does not have', { scope: 'pane' }, /not a scope of this command/],
    ['no evidence', { evidence: [] }, /cites no evidence/],
  ])('rejects %s', (_name, over, message) => {
    const { entries, problems } = verify([claim(over)])
    expect(entries).toEqual([])
    expect(problems.join('\n')).toMatch(message)
  })

  it('stands on a library symbol only while that symbol sends the command at that scope', () => {
    const wrapped = claim({ via: { port: 'csharp', symbol: 'LibTmux.Server.GetPanesAsync' } })
    expect(verify([wrapped], () => true).problems).toEqual([])
    expect(verify([wrapped], () => false).problems.join('\n')).toMatch(/does not send list-panes at that scope/)
  })
})

describe('the scope table against tmux', () => {
  const entry = JSON.parse(scopes).commands['list-panes']
  const source = [
    'static enum cmd_retval', 'cmd_list_panes_exec(struct cmd *self, struct cmdq_item *item)', '{',
    "\tif (args_has(args, 'a'))", '\t\tcmd_list_panes_server(self, item);', "\telse if (args_has(args, 's'))",
    '\t\tcmd_list_panes_session(self, s, item, 1);', '\telse', '\t\tcmd_list_panes_window(self, s, wl, item, 0);',
  ].join('\n')
  const call = (name: string, line: number) => ({ target: `c:function:x.c:${name}`, kind: 'call', sites: [{ file: 'x.c', line }] })
  const model = {
    commands: [{ name: 'list-panes', callback: 'c:function:x.c:cmd_list_panes_exec' }],
    symbols: [
      { id: 'c:function:x.c:cmd_list_panes_exec', name: 'cmd_list_panes_exec', references: [call('cmd_list_panes_server', 5), call('cmd_list_panes_session', 7), call('cmd_list_panes_window', 9)] },
      ...['server', 'session', 'window'].map((scope) => ({ id: `c:function:x.c:cmd_list_panes_${scope}`, name: `cmd_list_panes_${scope}` })),
    ],
  }
  const read = (file: string) => (file === 'x.c' ? source : undefined)

  it('reads the flag that guards each call', () => {
    expect([5, 7, 9].map((line) => guardFlag(source, line))).toEqual(['a', 's', ''])
    expect(guardFlag('foo();\nbar();\n', 2)).toBeUndefined()
  })

  it('accepts the table that matches the dispatch and rejects one that does not', () => {
    expect(scopeProblems(entry, model, 'list-panes', read)).toEqual([])
    const swapped = { scopes: entry.scopes.map((scope: { id: string }) => scope.id === 'server' ? { ...scope, flag: 's' } : scope) }
    expect(scopeProblems(swapped, model, 'list-panes', read)).toEqual(["list-panes: cmd_list_panes_server is called under 'a', not 's'"])
    expect(scopeProblems(entry, model, 'list-panes', () => source.replace("if (args_has(args, 'a'))", 'if (flag)'))[0]).toMatch(/no readable guard/)
  })

  it.each(['3.7c', '3.2a'])('matches the C dispatch of tmux %s', (version) => {
    const real = JSON.parse(readFileSync(new URL(`../src/data/tmux/api/${version}.json`, import.meta.url), 'utf8'))
    expect(scopeProblems(entry, real, 'list-panes')).toEqual([])
    const gone = { scopes: entry.scopes.map((scope: { id: string }) => scope.id === 'server' ? { ...scope, function: 'cmd_list_panes_gone' } : scope) }
    expect(scopeProblems(gone, real, 'list-panes').join('\n')).toMatch(/does not call cmd_list_panes_gone/)
  })
})
