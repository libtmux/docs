import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'
import { MAX_SHARED_BY, applyExclusions, classify, definitionsOf, deriveUsage, verifyClaims } from '../../scripts/lib/tmux-usage-derive.mjs'
import { forwardUsage } from '../../scripts/lib/tmux-usage-forward.mjs'
import { carriesCommand, memberWords, selects, settleCandidates, sweepCandidates } from '../../scripts/lib/tmux-usage-sweep.mjs'
import { scanFSharp, scanJulia } from '../../scripts/lib/tmux-usage-lexical.mjs'
import { guardFlag, libraryScopes, scopeProblems } from '../../scripts/lib/tmux-usage-scopes.mjs'

type Forwarded = { symbol: string; command: string; scope: string | null; evidence: string[]; hops: number; via: { port: string; symbol: string; evidence: string[]; reviewed?: boolean } }
type Scanned = { name: string; owner?: string; start: number; end: number; sites: { command: string; line: number; flags: string }[]; calls: Map<string, number>; receivers: Map<string, Set<string>> }

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
    // A name given to an error that says it is unsupported is a message too, whether or not flags follow it.
    expect(functions[0].sites.map((site) => [site.line, site.flags])).toEqual([[2, 'Fa']])
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

  it('does not read a command named for a check or a failure as a command that runs', async () => {
    const { functions } = await scan('python', [
      'def save(self):',
      '    validate_args("list-panes", self.name)',
      '    raise LibTmuxException("list-panes", self.name)',
      '    return None',
      '',
      'def run(self):',
      '    return checked_run("list-panes", "-a")',
      '',
    ].join('\n'))
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.save.sites).toEqual([])
    // The control: a runner whose name only starts with a checking verb still runs the command.
    expect(byName.run.sites).toEqual([{ command: 'list-panes', line: 7, flags: 'a' }])
  })

  it('reads the same label in Go, where the failure is built by a constructor', async () => {
    const { functions } = await scan('go', [
      'package tmux',
      'func (s Server) SaveBuffer() error {',
      '\tif err := validateBufferName("list-panes", s.name); err != nil { return err }',
      '\treturn newRedactedCommandError("list-panes", s.result)',
      '}',
      'func (s Server) Run() error {',
      '\t_, err := s.literalCmd(ctx, "list-panes", "-a")',
      '\treturn err',
      '}',
      '',
    ].join('\n'))
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.SaveBuffer.sites).toEqual([])
    expect(byName.Run.sites).toEqual([{ command: 'list-panes', line: 7, flags: 'a' }])
  })

  it('does not read a command compared against, or named by a case, as one that runs', async () => {
    const java = await scan('java', [
      'class A {',
      '    String format(String[] command, String format) {',
      '        return switch (command[0]) {',
      '            case "list-panes" -> format;',
      '            default -> "";',
      '        };',
      '    }',
      '    void run() { server.run(List.of("list-panes", "-a")); }',
      '}',
      '',
    ].join('\n'))
    expect(Object.fromEntries(java.functions.map((fn) => [fn.name, fn.sites]))).toEqual({
      format: [], run: [{ command: 'list-panes', line: 8, flags: 'a' }],
    })
    const python = await scan('python', [
      'def check(name):',
      '    if name == "list-panes":',
      '        return 1',
      '    return run("list-panes", "-a")',
      '',
    ].join('\n'))
    expect(python.functions[0].sites).toEqual([{ command: 'list-panes', line: 4, flags: 'a' }])
    const rust = await scan('rust', [
      'fn pick(name: &str) -> u8 {',
      '    match name { "list-panes" => run(["list-panes", "-a"]), _ => 0 }',
      '}',
      '',
    ].join('\n'))
    // The arm's pattern is a name being recognised; the command in its body still runs.
    expect(rust.functions[0].sites).toEqual([{ command: 'list-panes', line: 2, flags: 'a' }])
  })

  it('credits a local variable\'s send to the function around it, not to a function named for the variable', async () => {
    const { functions } = await scan('kotlin', [
      'class Server {',
      '    fun newSession() {',
      '        val reply = run(listOf("list-panes", "-a"))',
      '        println(reply)',
      '    }',
      '    val count = run(listOf("list-panes", "-s"))',
      '}',
      '',
    ].join('\n'))
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn.sites.map((site) => site.line)]))
    expect(byName.newSession).toEqual([3])
    expect(byName).not.toHaveProperty('reply')
    // The control: a property of the type itself is still a function-like scope with its own sites.
    expect(byName.count).toEqual([6])
  })

  it('keeps a site outside any function apart, so a module constant is not credited to a neighbour', async () => {
    const { functions, orphans } = await scan('python', 'LISTINGS = [("list-panes", "-a")]\n\ndef other():\n    return 1\n')
    expect(orphans).toEqual([{ command: 'list-panes', line: 1, flags: 'a' }])
    expect(functions[0].sites).toEqual([])
  })
})

const located = (over: Record<string, unknown>) => ({
  file: 'lib.py', name: 'f', owner: undefined, start: 1, nameLine: 1, end: 3, kind: 'function_definition', sites: [], calls: new Map<string, number>(), receivers: new Map<string, Set<string>>(), ...over,
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

  describe('a method that forwards to a free function of its own name', () => {
    const helper = (over: Record<string, unknown> = {}) => located({ file: 'ops/io.ts', name: 'sendKeys', start: 1, nameLine: 1, end: 5, sites: [{ command: 'list-panes', line: 3, flags: 'st' }], ...over })
    const method = (over: Record<string, unknown> = {}) => located({ file: 'pane.ts', name: 'sendKeys', owner: 'Pane', start: 10, nameLine: 10, end: 12, calls: new Map([['sendKeys', 11]]), ...over })
    const symbols = [{ id: 'pane.Pane.sendKeys', name: 'sendKeys', parentName: 'Pane', file: 'pane.ts', line: 10 }]

    it('credits the method for the free function it calls without a handle', () => {
      const { entries } = deriveUsage({ command: 'list-panes', spec, functions: [helper(), method()], symbols })
      expect(entries).toEqual([{ symbol: 'pane.Pane.sendKeys', command: 'list-panes', scope: 'session', evidence: ['ops/io.ts:3', 'pane.ts:11'], hops: 1 }])
    })

    it('does not, when the call is made on an object, or when a second free function has the name', () => {
      const onObject = method({ receivers: new Map([['sendKeys', new Set(['other'])]]) })
      expect(deriveUsage({ command: 'list-panes', spec, functions: [helper(), onObject], symbols }).entries).toEqual([])
      const twin = helper({ file: 'mcp/io.ts', start: 1, nameLine: 1, end: 5, sites: [] })
      const { entries, unresolved } = deriveUsage({ command: 'list-panes', spec, functions: [helper(), twin, method()], symbols })
      expect(entries).toEqual([])
      expect(unresolved.map((item: { reason: string }) => item.reason)).toEqual(['no public symbol reaches it'])
    })
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
  const verify = (claims: unknown[]) => verifyClaims({
    claims: claims as Parameters<typeof verifyClaims>[0]['claims'], spec, functions, types: [], symbols,
    readSource: (path: string) => (path === 'server.rs' ? source : undefined),
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

describe('symbols that only build a command', () => {
  const symbols = [
    { id: 'tmux.Plan.KillPane', name: 'KillPane', parentName: 'Plan', file: 'tmux/plan_pane.go', line: 10 },
    { id: 'tmux.Plan.Run', name: 'Run', parentName: 'Plan', file: 'tmux/plan.go', line: 5 },
    { id: 'tmux.Pane.Kill', name: 'Kill', parentName: 'Pane', file: 'tmux/pane.go', line: 1 },
  ]
  const entry = (symbol: string) => ({ symbol, command: 'kill-pane', scope: null, evidence: ['x.go:1'], hops: 0 })
  const found = () => new Map(symbols.map((candidate) => [candidate.id, entry(candidate.id)]))
  const source = ['func (p *Plan) add(op Op) Ref {', '\tp.ops = append(p.ops, op)', '}'].join('\n')
  const exclusion = (over: Record<string, unknown> = {}) => ({
    port: 'go', owner: 'Plan', in: 'tmux/plan_', why: 'A Plan records steps.',
    evidence: [{ at: 'tmux/plan.go:1', has: ['func (p *Plan) add('] }, { at: 'tmux/plan.go:2', has: ['append(p.ops, op)'] }], ...over,
  })
  const apply = (items: unknown[], held = found()) => ({
    held, ...applyExclusions({ exclusions: items as Parameters<typeof applyExclusions>[0]['exclusions'], found: held, symbols, readSource: (path: string) => (path === 'tmux/plan.go' ? source : undefined) }),
  })

  it('removes what an owner builds, inside the files it names, and keeps what it does not', () => {
    const { held, removed, problems } = apply([exclusion()])
    expect(problems).toEqual([])
    expect(removed.map((item: { symbol: string }) => item.symbol)).toEqual(['tmux.Plan.KillPane'])
    // Plan.Run is the owner's, but declared outside the builder files, and Pane.Kill is another type's.
    expect([...held.keys()]).toEqual(['tmux.Plan.Run', 'tmux.Pane.Kill'])
  })

  it('selects by member name as well, and needs one of the two', () => {
    expect(apply([exclusion({ owner: undefined, names: ['Kill'], in: 'tmux/pane' })]).removed.map((item: { symbol: string }) => item.symbol)).toEqual(['tmux.Pane.Kill'])
    expect(apply([exclusion({ owner: undefined })]).problems[0]).toMatch(/neither an owner nor member names/)
  })

  it.each([
    ['a line that no longer holds the text', { evidence: [{ at: 'tmux/plan.go:2', has: ['p.steps = append('] }] }, /does not contain/],
    ['a line past the end of the file', { evidence: [{ at: 'tmux/plan.go:99' }] }, /not a line of the pinned source/],
    ['no evidence', { evidence: [] }, /cites no evidence/],
    ['an owner that has nothing left to remove', { owner: 'Chain' }, /removes no entry, so it is stale/],
  ])('refuses %s, and removes nothing', (_name, over, message) => {
    const { held, removed, problems } = apply([exclusion(over)])
    expect(problems.join('\n')).toMatch(message)
    expect(removed).toEqual([])
    expect(held.size).toBe(3)
  })
})

describe('crediting a wrapper with the core method it calls', () => {
  const coreSymbols = new Map([
    ['core.Server.panes', { name: 'panes', parentName: 'Server' }],
    ['core.Session.panes', { name: 'panes', parentName: 'Session' }],
    ['core.Server.snapshot', { name: 'snapshot', parentName: 'Server' }],
  ])
  const coreEntry = (symbol: string, scope: string, over: Record<string, unknown> = {}) => ({ symbol, command: 'list-panes', scope, evidence: ['Core.java:10'], ...over })
  const core = (entries: ReturnType<typeof coreEntry>[]) => ({ entries, symbols: coreSymbols })
  const wrapper = (name: string, parentName: string, id = `w.${parentName}.${name}`) => ({ id, name, parentName, file: 'W.kt', line: 1 })
  const fn = (name: string, owner: string, calls: [string, number][], receivers: [string, string[]][] = []) =>
    located({ file: 'W.kt', name, owner, start: 1, nameLine: 1, end: 9, calls: new Map(calls), receivers: new Map(receivers.map(([callee, who]) => [callee, new Set(who)])) })
  const forward = (functions: ReturnType<typeof fn>[], symbols: ReturnType<typeof wrapper>[], entries: ReturnType<typeof coreEntry>[]) =>
    forwardUsage({ parent: 'java', functions, types: [], symbols, core: core(entries) }) as unknown as { entries: Forwarded[]; silent: string[] }

  it('credits the scope the core method sends at, with the line of the call and the core evidence', () => {
    const { entries } = forward([fn('panes', 'Server', [['panes', 4]], [['panes', ['server']]])], [wrapper('panes', 'Server')], [coreEntry('core.Server.panes', 'server')])
    expect(entries).toEqual([{
      symbol: 'w.Server.panes', command: 'list-panes', scope: 'server', evidence: ['W.kt:4'], hops: 1,
      via: { port: 'java', symbol: 'core.Server.panes', evidence: ['Core.java:10'] },
    }])
  })

  it('credits the type the call is made on, and not the type the wrapper method belongs to', () => {
    // F#'s Server.newSession lists the panes of the session it made, with `session.GetPanesAsync`.
    const { entries } = forward([fn('newSession', 'Server', [['panes', 4]], [['panes', ['session']]])], [wrapper('newSession', 'Server')],
      [coreEntry('core.Server.panes', 'server'), coreEntry('core.Session.panes', 'session')])
    expect(entries.map((entry) => entry.scope)).toEqual(['session'])
    // The control: with no named handle the call is made on the wrapper's own type.
    const own = forward([fn('refresh', 'Server', [['panes', 4]])], [wrapper('refresh', 'Server')], [coreEntry('core.Server.panes', 'server'), coreEntry('core.Session.panes', 'session')])
    expect(own.entries.map((entry) => entry.scope)).toEqual(['server'])
  })

  it('leaves a wrapper that builds a query and calls no sender out, and names it', () => {
    const { entries, silent } = forward([fn('plan', 'Server', [['listOf', 3]])], [wrapper('plan', 'Server')], [coreEntry('core.Server.panes', 'server')])
    expect(entries).toEqual([])
    expect(silent).toEqual(['w.Server.plan'])
  })

  it('does not forward a reviewed claim that holds only for the arguments it was read with', () => {
    const functions = [fn('snapshot', 'Server', [['snapshot', 4]], [['snapshot', ['server']]])]
    const symbols = [wrapper('snapshot', 'Server')]
    expect(forward(functions, symbols, [coreEntry('core.Server.snapshot', 'server', { reviewed: true })]).entries).toEqual([])
    // A claim that says it holds for every call is forwarded, and the forwarded entry says it was reviewed.
    const [entry] = forward(functions, symbols, [coreEntry('core.Server.snapshot', 'server', { reviewed: true, forwardable: true })]).entries
    expect(entry.via).toMatchObject({ symbol: 'core.Server.snapshot', reviewed: true })
  })

  it('forwards a generated operation by the annotation above the core method, and not one without', () => {
    const generated = { under: ['gen/'], evidence: ['Gen.kt:183'], forwards: (entry: { symbol: string }) => (entry.symbol === 'core.Server.panes' ? 'Core.java:9' : undefined) }
    const symbols = [{ ...wrapper('panes', 'Server'), file: 'gen/Ops.kt' }, { ...wrapper('snapshot', 'Server'), file: 'gen/Ops.kt' }]
    const { entries } = forwardUsage({ parent: 'java', functions: [], types: [], symbols, generated,
      core: core([coreEntry('core.Server.panes', 'server'), coreEntry('core.Server.snapshot', 'server')]) }) as unknown as { entries: Forwarded[] }
    expect(entries.map((entry) => [entry.symbol, entry.evidence])).toEqual([['w.Server.panes', ['Gen.kt:183', 'Core.java:9']]])
  })
})

describe('reading Julia and F# by their text', () => {
  const commands = new Set(['list-panes'])

  it('finds the sends and calls of Julia functions, short form included, and not a docstring', () => {
    const text = [
      '"""Run list-panes -a on the server."""',
      'function panes(conn)',
      '    run(conn, ["list-panes", "-a"])',
      '    return _rows(conn)',
      'end',
      '',
      'snapshot(conn) = _capture(conn; depth=1)',
      '',
    ].join('\n')
    const { functions } = scanJulia(text, { commands, known: commands }) as unknown as { functions: Scanned[] }
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.panes.sites).toEqual([{ command: 'list-panes', line: 3, flags: 'a' }])
    expect([...byName.panes.calls.keys()]).toEqual(expect.arrayContaining(['run', '_rows']))
    expect([...byName.snapshot.calls.keys()]).toEqual(['_capture'])
    expect(byName.snapshot.sites).toEqual([])
  })

  it('reads F# members with their owner, and the calls inside with the object they are made on', () => {
    const text = [
      'module Hierarchy',
      '',
      'type Server with',
      '    member server.newSession (spec: Spec) =',
      '        backgroundTask {',
      '            let! panes = session.GetPanesAsync(token)',
      '            return panes',
      '        }',
      '',
      'let helper (x: int) = x',
      '',
    ].join('\n')
    const { functions } = scanFSharp(text) as unknown as { functions: Scanned[] }
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.newSession).toMatchObject({ owner: 'Server', start: 4, end: 8 })
    expect(byName.newSession.receivers.get('GetPanesAsync')).toEqual(new Set(['session']))
    expect(byName.helper.owner).toBe('Hierarchy')
    expect(byName.helper.calls.size).toBe(0)
  })
})

describe('finding the methods a scan misses', () => {
  const method = (name: string, owner: string, over: Record<string, unknown> = {}) => ({ id: `S.${owner}.${name}`, name, parentName: owner, file: 'src/libtmux/lib.py', kind: 'method', ...over })
  const find = (symbols: ReturnType<typeof method>[], has: string[] = [], commands = ['new-session', 'new-window', 'kill-pane', 'send-keys']) =>
    sweepCandidates({ port: 'py', commands, symbols, has: new Set(has) }) as { candidates: { symbol: string; command: string }[]; siblings: number }

  it('reads the verb and the noun of a command in a method name, in whole words', () => {
    expect(carriesCommand('new-session', 'newSession', 'Server')).toBe(true)
    expect(carriesCommand('capture-pane', 'capture', 'Pane')).toBe(true)
    expect(carriesCommand('send-keys', 'sendKeys', 'Pane')).toBe(true)
    // The controls: another noun, another verb, and a word that only ends like a plural.
    expect(carriesCommand('kill-window', 'kill', 'Pane')).toBe(false)
    expect(carriesCommand('list-panes', 'sendKeys', 'Pane')).toBe(false)
    expect(memberWords('previousLayout')).toEqual(['previous', 'layout'])
    expect(memberWords('newWindow(in:named:startDirectory:)')).toEqual(['new', 'window'])
    expect(carriesCommand('previous-window', 'previous', 'Window')).toBe(true)
  })

  it('finds a method named for a command that has no entry, in the library and not in a test or a consumer', () => {
    const symbols = [method('new_session', 'Server'), method('helper', 'Server'), method('new_session', 'Fixture', { file: 'tests/fixtures.py' }),
      method('new_session', 'Plugin', { file: 'src/other_package/plugin.py' }), method('new_session', 'Field', { kind: 'attribute' }), method('GetHashCode', 'Server')]
    expect(find(symbols).candidates.map((item) => `${item.symbol} ${item.command}`)).toEqual(['S.Server.new_session new-session'])
    // The control: once the data records an entry for it, there is nothing to find.
    expect(find(symbols, ['S.Server.new_session\0new-session']).candidates).toEqual([])
  })

  it('settles a method named for one command by the sibling command it is recorded as sending', () => {
    const symbols = [method('newWindow', 'Session')]
    // Session.newWindow carries new-session only through its owner; its own noun is the window's.
    expect(find(symbols, ['S.Session.newWindow\0new-window'])).toEqual({ candidates: [], siblings: 1 })
    expect(find(symbols).candidates.map((item) => item.command)).toEqual(['new-session', 'new-window'])
  })

  describe('settling what is found', () => {
    const candidates = [{ symbol: 'S.Pane.clear', name: 'clear', owner: 'Pane', command: 'clear-history', file: 'src/libtmux/pane.py' }]
    const review = (over: Record<string, unknown> = {}) => ({
      port: 'py', kind: 'other-command', why: 'clear types reset with send-keys.', owner: 'Pane', names: ['clear'], commands: ['clear-history'],
      evidence: [{ at: 'src/libtmux/pane.py:2', has: ['send_keys("reset")'] }], ...over,
    })
    const source = (path: string) => (path === 'src/libtmux/pane.py' ? 'def clear(self):\n    self.send_keys("reset")\n' : undefined)
    const settle = (reviews: unknown[], covering: unknown[] = [], readSource: typeof source | null = source) =>
      settleCandidates({ port: 'py', candidates, reviews: reviews as Parameters<typeof settleCandidates>[0]['reviews'], covering: covering as never, readSource: readSource ?? undefined })

    it('leaves a candidate with no review unreviewed, and settles one whose review holds', () => {
      expect(settle([]).unreviewed).toEqual(candidates)
      expect(settle([review()])).toEqual({ unreviewed: [], reviewed: 1, problems: [] })
      expect(selects({ owner: 'Pane', names: ['clear'] }, { ...candidates[0] })).toBe(true)
      expect(selects({ owner: 'Pane', names: ['reset'] }, { ...candidates[0] })).toBe(false)
    })

    it.each([
      ['a line that no longer holds the text', { evidence: [{ at: 'src/libtmux/pane.py:2', has: ['clear-history'] }] }, /does not contain/],
      ['a line past the end of the file', { evidence: [{ at: 'src/libtmux/pane.py:99' }] }, /not a line of the pinned source/],
      ['a review that settles nothing', { names: ['gone'] }, /settles no candidate, so it is stale/],
      ['no reason', { why: ' ' }, /gives no reason/],
      ['no evidence', { evidence: [] }, /cites no evidence/],
      ['a kind that is not one of the four', { kind: 'probably-fine' }, /is not one of/],
      ['a review that names nothing', { owner: undefined, names: undefined, commands: undefined }, /names no owner, member or command/],
    ])('refuses %s, and leaves the candidate unreviewed', (_name, over, message) => {
      const result = settle([review(over)])
      expect(result.problems.join('\n')).toMatch(message)
      expect(result.unreviewed).toEqual(candidates)
    })

    it('does not read the evidence without a checkout, and lets a covering rule settle without being checked', () => {
      expect(settle([review({ evidence: [{ at: 'nowhere.py:1', has: ['x'] }] })], [], null)).toEqual({ unreviewed: [], reviewed: 1, problems: [] })
      expect(settle([], [{ port: 'py', owner: 'Pane', names: ['to_command'] }])).toEqual({ unreviewed: candidates, reviewed: 0, problems: [] })
      expect(settle([], [{ port: 'py', owner: 'Pane', names: ['clear'] }]).unreviewed).toEqual([])
    })
  })
})
