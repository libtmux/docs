import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { GRAMMARS, scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'
import { MAX_SHARED_BY, applyConditions, applyExclusions, builtSites, callTargets, classify, conditionProblem, definitionsOf, deriveUsage, partialProblems, ruleHolds, verifyClaims } from '../../scripts/lib/tmux-usage-derive.mjs'
import { auditEvidence } from '../../scripts/lib/tmux-usage-audit.mjs'
import { chainProblems, dispatcherProblems, guardProblems } from '../../scripts/lib/tmux-usage-dispatch.mjs'
import { forwardUsage } from '../../scripts/lib/tmux-usage-forward.mjs'
import { carriesCommand, memberWords, selects, settleCandidates, sweepCandidates } from '../../scripts/lib/tmux-usage-sweep.mjs'
import { scanElixir, scanFSharp, scanJulia, tokenizeElixir } from '../../scripts/lib/tmux-usage-lexical.mjs'
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

  it('does not read a command named to describe a failure, or quoted for tmux to run inside another command', async () => {
    const java = await scanSource({
      grammar: 'java', known: new Set(['show-environment', 'kill-server', 'if-shell']), commands: new Set(['show-environment', 'kill-server', 'if-shell']),
      text: [
        'class Environment {',
        '    Entry entry(String name) {',
        '        throw server.failed("show-environment", result);',
        '    }',
        '    Map listing() {',
        '        return server.run(List.of("show-environment", "-s"));',
        '    }',
        '    void close(long pid) {',
        '        server.cmd("if-shell", "-F", "#{==:#{pid}," + pid + "}", "kill-server", stale);',
        '    }',
        '    void both() {',
        '        server.request(List.of(List.of("if-shell", "-F", "x", "kill-server"), List.of("kill-server")));',
        '    }',
        '}',
      ].join('\n'),
    })
    const sites = (name: string) => java.functions.find((fn) => fn.name === name)!.sites.map((site) => `${site.command}@${site.line}`)
    // A failure built for a command names it and sends nothing; reading the listing sends it.
    expect(sites('entry')).toEqual([])
    expect(sites('listing')).toEqual(['show-environment@6'])
    // kill-server is the then-command of the if-shell: tmux runs it, and the library sends the if-shell.
    expect(sites('close')).toEqual(['if-shell@9'])
    // The control: a second command in a sequence of requests, outside any if-shell, is a send of its own.
    expect(sites('both')).toEqual(['if-shell@12', 'kill-server@12'])

    const rust = await scanSource({
      grammar: 'rust', known: new Set(['split-window', 'if-shell', 'resize-pane']), commands: new Set(['split-window', 'if-shell', 'resize-pane']),
      text: [
        'fn plan() {',
        '    let plan = projection(&version).map_err(decode_error("split-window"))?;',
        '    let refused = Error::from_refused_result("split-window", &result);',
        '    send(Command::new("resize-pane"));',
        '}',
      ].join('\n'),
    })
    expect(rust.functions[0].sites.map((site) => `${site.command}@${site.line}`)).toEqual(['resize-pane@4'])

    const typescript = await scanSource({
      grammar: 'typescript', known: new Set(['if-shell', 'resize-pane']), commands: new Set(['if-shell', 'resize-pane']),
      text: [
        'async function unzoom(at) {',
        '  await runCommand(["if-shell", "-F", ...at, "#{zoomed}", quoteCommand(["resize-pane", "-Z", ...at])])',
        '}',
        'async function resize(at) {',
        '  await runCommands([["select-pane", ...at], ["resize-pane", "-Z", ...at]])',
        '}',
      ].join('\n'),
    })
    expect(typescript.functions.map((fn) => [fn.name, fn.sites.map((site) => site.command)])).toEqual([['unzoom', ['if-shell']], ['resize', ['resize-pane']]])
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

  it('reads the rest of a statement that spans lines, as long as the first text is on the cited line', () => {
    const wrapped = [
      'fn set() {',
      '    run(',
      '        core,',
      '        "set-option",',
      '    )',
      '}',
    ].join('\n')
    const run = (over: Record<string, unknown>) => verifyClaims({
      claims: [{ port: 'rs', symbol: 'server.Server.panes', command: 'list-panes', scope: 'server', evidence: [{ at: 'set.rs:2', ...over }, { at: 'server.rs:3', in: 'server.Server.panes' }] }] as never,
      spec, functions, types: [], symbols, readSource: (path: string) => (path === 'server.rs' ? source : path === 'set.rs' ? wrapped : undefined),
    })
    // The send call is on the cited line, and the command is two lines below it, inside the same call.
    expect(run({ has: ['run(', '"set-option"'], span: 3 }).problems).toEqual([])
    // Without the span the command is not on the cited line, and a command above the cited line is never read.
    expect(run({ has: ['run(', '"set-option"'] }).problems.join('\n')).toMatch(/does not contain "\\"set-option\\""/)
    expect(run({ has: ['"set-option"', 'run('], span: 3 }).problems.join('\n')).toMatch(/does not contain "\\"set-option\\""/)
  })

  it('holds a rule that names a revision for that revision only, and one that names none for the revision its model was extracted at', () => {
    expect(ruleHolds({}, 'aaa', 'aaa')).toBe(true)
    expect(ruleHolds({}, 'bbb', 'aaa')).toBe(false)
    expect(ruleHolds({ revision: 'bbb' }, 'bbb111', 'aaa')).toBe(true)
    expect(ruleHolds({ revision: 'bbb' }, 'aaa', 'aaa')).toBe(false)
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

describe('the condition of a send', () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    port: 'rs', symbol: 'server.Server.panes', command: 'list-panes', scope: 'server', evidence: [{ at: 'server.rs:2', has: ['list-panes'] }, { at: 'server.rs:1', in: 'server.Server.panes' }], ...over,
  })
  const source = ['pub async fn panes() {', '    cmd("list-panes", "-a")', '}'].join('\n')
  const symbols = [{ id: 'server.Server.panes', name: 'panes', parentName: 'Server', file: 'server.rs', line: 1 }]
  const functions = [located({ file: 'server.rs', name: 'panes', owner: 'Server', start: 1, nameLine: 1, end: 3 })]
  const verify = (claims: unknown[]) => verifyClaims({ claims: claims as never, spec, functions, types: [], symbols, readSource: (path: string) => (path === 'server.rs' ? source : undefined) })

  it('accepts a few words and carries them to the entry, and refuses a long one, an empty one and a marked one with none', () => {
    expect(conditionProblem(undefined, false)).toBeUndefined()
    expect(conditionProblem('the window is zoomed', true)).toBeUndefined()
    expect(conditionProblem('one two three four five six seven eight', false)).toBeUndefined()
    expect(conditionProblem('one two three four five six seven eight nine', false)).toMatch(/9 words, and a qualifier is at most 8/)
    expect(conditionProblem('  ', false)).toMatch(/with no words/)
    expect(conditionProblem('one\ntwo', false)).toMatch(/more than one line/)
    expect(conditionProblem(undefined, true)).toMatch(/is marked conditional, so it must say when/)
    expect(verify([claim({ when: 'the target is "next"' })]).entries[0]).toMatchObject({ when: 'the target is "next"' })
    expect(verify([claim()]).entries[0]).not.toHaveProperty('when')
    expect(verify([claim({ when: 'one two three four five six seven eight nine' })]).problems.join('\n')).toMatch(/at most 8/)
    expect(verify([claim({ conditional: true })]).problems.join('\n')).toMatch(/marked conditional, so it must say when/)
  })

  describe('a condition on a scanned send', () => {
    const found = () => new Map([['S.panes\0list-panes\0server', { symbol: 'S.panes', command: 'list-panes', scope: 'server' } as Record<string, unknown>]])
    const lines = (path: string) => (path === 'lib.py' ? 'if synchronized:\n    run("list-panes")\n' : undefined)
    const condition = (over: Record<string, unknown> = {}) => ({ port: 'py', symbol: 'S.panes', command: 'list-panes', scope: 'server', when: 'the pane is synchronized', evidence: [{ at: 'lib.py:1', has: ['synchronized'] }], ...over })

    it('qualifies the entry it names, with the lines that show the condition', () => {
      const entries = found()
      expect(applyConditions({ conditions: [condition()], found: entries, readSource: lines })).toEqual([])
      expect(entries.get('S.panes\0list-panes\0server')).toMatchObject({ when: 'the pane is synchronized' })
    })

    it.each([
      ['an entry that is not there', { symbol: 'S.gone' }, /qualifies no entry/],
      ['a line that does not hold the text', { evidence: [{ at: 'lib.py:1', has: ['unsynchronized'] }] }, /does not contain/],
      ['a line past the end of the file', { evidence: [{ at: 'lib.py:9', has: ['x'] }] }, /not a line of the pinned source/],
      ['no lines', { evidence: [] }, /cites no lines/],
      ['too many words', { when: 'one two three four five six seven eight nine' }, /at most 8/],
    ])('refuses %s', (_name, over, message) => {
      expect(applyConditions({ conditions: [condition(over)], found: found(), readSource: lines }).join('\n')).toMatch(message)
    })

    it('leaves a condition for later when asked, and refuses one that differs from the claim it qualifies', () => {
      expect(applyConditions({ conditions: [condition({ symbol: 'S.gone' })], found: found(), readSource: lines, lenient: true })).toEqual([])
      const claimed = found()
      claimed.get('S.panes\0list-panes\0server')!.when = 'another reason'
      expect(applyConditions({ conditions: [condition()], found: claimed, readSource: lines }).join('\n')).toMatch(/differs from the one its claim says: another reason/)
    })
  })

  it('is kept by the wrapper that forwards the method, and by the method that delegates to another type', () => {
    const entry = { symbol: 'core.Pane.sendKeys', command: 'send-keys', scope: null, evidence: ['Pane.java:9'], hops: 0, when: 'the pane is synchronized' }
    const coreSymbols = new Map([[entry.symbol, { name: 'sendKeys', parentName: 'Pane' }]])
    const wrapper = located({ file: 'Pane.kt', name: 'sendKeys', owner: 'Pane', start: 1, nameLine: 1, end: 3, calls: new Map([['sendKeys', 2]]), receivers: new Map([['sendKeys', new Set(['this'])]]) })
    const wrapped = forwardUsage({ parent: 'java', functions: [wrapper], types: [], symbols: [{ id: 'kt.Pane.sendKeys', name: 'sendKeys', parentName: 'Pane', file: 'Pane.kt', line: 1 }],
      core: { entries: [entry], symbols: coreSymbols as never, revision: 'r1' } } as never)
    expect(wrapped.entries[0]).toMatchObject({ symbol: 'kt.Pane.sendKeys', when: 'the pane is synchronized' })
    // A method that calls another type's method on a handle named for it is credited with it, on the way and not under a branch.
    const caller = (depth: number) => located({
      file: 'pane.go', name: 'Refresh', owner: 'Session', start: 1, nameLine: 1, end: 3,
      calls: new Map([['Pane', 2]]), receivers: new Map([['Pane', new Set(['server'])]]), callDepths: new Map([['Pane', depth]]),
    } as never)
    const sym = { id: 'tmux.Server.Pane', name: 'Pane', parentName: 'Server', file: 'server.go', line: 1 }
    const run = (depth: number) => forwardUsage({
      parent: 'go', delegate: true, functions: [caller(depth)], types: [], symbols: [sym, { id: 'tmux.Session.Refresh', name: 'Refresh', parentName: 'Session', file: 'pane.go', line: 1 }],
      core: { entries: [{ symbol: 'tmux.Server.Pane', command: 'list-panes', scope: 'window', evidence: ['server.go:5'], hops: 0, when: 'any pane' }], symbols: new Map([[sym.id, sym]]) as never, revision: 'r1' },
    } as never)
    expect(run(0).entries[0]).toMatchObject({ symbol: 'tmux.Session.Refresh', command: 'list-panes', when: 'any pane', via: { port: 'go', symbol: 'tmux.Server.Pane' } })
    // The control: the same call under a branch, in a loop or in a cleanup that runs on failure is not credited.
    expect(run(1).entries).toEqual([])
  })
})

describe('the calls that send', () => {
  const text = [
    'class Server:', //                                            1
    '    def cmd(self, *args):', //                                2
    '        return tmux_cmd(*args)', //                           3
    '', //                                                          4
    'class tmux_cmd:', //                                           5
    '    def __init__(self, *args):', //                          6
    '        self.process = subprocess.Popen(args)', //            7
    '', //                                                          8
    'def listing(rows):', //                                       9
    '    return [row for row in rows]', //                        10
    '', //                                                         11
    'def check_call(args):', //                                   12
    '    subprocess.check_call(args)', //                         13
  ].join('\n')
  const fn = (name: string, start: number, end: number, over: Record<string, unknown> = {}) => ({ file: 'lib.py', name, start, end, calls: new Map<string, number>(), ...over })
  const functions = [
    fn('cmd', 2, 3, { owner: 'Server', calls: new Map([['tmux_cmd', 3]]) }), fn('__init__', 6, 7, { owner: 'tmux_cmd' }), fn('listing', 9, 10), fn('check_call', 12, 13),
  ]
  const readSource = (path: string) => (path === 'lib.py' ? text : undefined)
  const problems = (name: string, item: Record<string, unknown>) => chainProblems({ port: 'py', rule: { name }, item: { has: [name], ...item } as never, functions: functions as never, readSource })
  const reaches = [{ at: 'lib.py:3', has: ['tmux_cmd'], calls: 'tmux_cmd' }, { at: 'lib.py:7', has: ['subprocess.Popen('] }]

  it('accepts a definition that reaches the process through the calls it cites, and one that starts the process itself', () => {
    expect(problems('cmd', { at: 'lib.py:2', reaches })).toEqual([])
    expect(problems('check_call', { at: 'lib.py:13' })).toEqual([])
    // A hop the scan cannot follow, such as a command put on a queue, says where it leads.
    const queued = [{ at: 'lib.py:3', has: ['tmux_cmd'], leads: '__init__', why: 'the command goes onto a queue' }, { at: 'lib.py:7', has: ['subprocess.Popen('] }]
    expect(problems('cmd', { at: 'lib.py:2', reaches: queued })).toEqual([])
  })

  it.each([
    ['a function that never reaches a process', 'listing', { at: 'lib.py:9' }, /reaches no transport, and cites no chain to one/],
    ['a chain that stops short of the process', 'cmd', { at: 'lib.py:2', reaches: [reaches[0]] }, /hop lib.py:3 is not a transport/],
    ['a chain that skips the function between', 'cmd', { at: 'lib.py:2', reaches: [reaches[1]] }, /hop lib.py:7 is not in Server.cmd/],
    ['a hop that does not lead to the next line', 'cmd', { at: 'lib.py:2', reaches: [{ at: 'lib.py:3', has: ['tmux_cmd'], calls: 'tmux_cmd' }, { at: 'lib.py:10', has: ['row'] }] }, /leads to tmux_cmd, but lib.py:10 is not a line of it/],
    ['a hop whose function does not make the call', 'cmd', { at: 'lib.py:2', reaches: [{ at: 'lib.py:3', has: ['tmux_cmd'], calls: 'Popen' }, reaches[1]] }, /leads to Popen, but lib.py:7 is not a line of it/],
    ['a hop whose text is not on its line', 'cmd', { at: 'lib.py:2', reaches: [{ at: 'lib.py:3', has: ['elsewhere'], calls: 'tmux_cmd' }, reaches[1]] }, /does not contain "elsewhere"/],
    ['a definition that is not a function of that name', 'listing', { at: 'lib.py:2', reaches }, /is not a line of a function named listing/],
    ['a hop that names no destination', 'cmd', { at: 'lib.py:2', reaches: [{ at: 'lib.py:3', has: ['tmux_cmd'] }, reaches[1]] }, /names neither the function it calls nor the one it leads to/],
  ])('refuses %s', (_name, name, item, message) => {
    expect(problems(name, item).join('\n')).toMatch(message)
  })

  it('refuses a rule whose argument position names a parameter no cited definition takes', () => {
    const rule = (labels: unknown) => ({ name: 'cmd', why: 'Runs it.', evidence: [{ at: 'lib.py:2', has: ['cmd'], reaches }], labels })
    const check = (labels: unknown) => dispatcherProblems({ port: 'py', dispatchers: [rule(labels)] as never, readSource, functions: functions as never })
    expect(check(undefined)).toEqual([])
    expect(check([{ at: 1, name: 'args' }])).toEqual([])
    expect(check([{ at: 1, name: 'subcommand' }]).join('\n')).toMatch(/no cited definition takes a parameter named subcommand/)
    expect(check([{ at: -1, name: 'args' }]).join('\n')).toMatch(/names no argument position or parameter/)
  })

  describe('a guard that wraps a command in if-shell', () => {
    const source = ['def guarded(command):', '    return cmd("if-shell", "-F", check, command, stale)', '', 'def plain(command):', '    return cmd(command)'].join('\n')
    const functionsOf = [fn('guarded', 1, 2), fn('plain', 4, 5)]
    const read = (path: string) => (path === 'lib.py' ? source : undefined)
    const guard = (over: Record<string, unknown> = {}) => ({ name: 'guarded', purpose: 'refuses a stale target', evidence: [{ at: 'lib.py:2', has: ['"if-shell", "-F"'] }], ...over })
    const check = (guards: unknown[]) => guardProblems({ port: 'py', guards: guards as never, readSource: read, functions: functionsOf as never })

    it('is accepted when the function builds an if-shell and a cited line is that wrapper', () => {
      expect(check([guard()])).toEqual([])
      expect(check([guard({ conditional: true, when: 'the handle carries a daemon' })])).toEqual([])
    })

    it.each([
      ['a function that builds no if-shell', { name: 'plain', evidence: [{ at: 'lib.py:5', has: ['cmd'] }] }, /no function of that name builds an if-shell/],
      ['a function that is not there', { name: 'gone' }, /no function of that name in the pinned source/],
      ['a line that is not the wrapper', { evidence: [{ at: 'lib.py:1', has: ['guarded'] }] }, /no cited line is the if-shell the guard builds/],
      ['a line that does not hold the text', { evidence: [{ at: 'lib.py:2', has: ['"-t"'] }] }, /does not contain/],
      ['a purpose left out', { purpose: ' ' }, /states no purpose/],
      ['a conditional guard that says nothing about when', { conditional: true }, /is conditional, so it must say when/],
      ['no lines', { evidence: [] }, /cites no lines/],
    ])('is refused for %s', (_name, over, message) => {
      expect(check([guard(over)]).join('\n')).toMatch(message)
    })
  })
})

describe('a chain that is resolved by the call each hop makes', () => {
  type Source = { file: string; text: string }
  const functionsOf = async (grammar: string, sources: Source[]) => {
    const all: Record<string, unknown>[] = []
    for (const { file, text } of sources) {
      const { functions } = await scanSource({ grammar, text, commands: new Set(['x']), known: new Set(['x']), dispatch: new Set() })
      all.push(...functions.map((fn: object) => ({ ...fn, file })))
    }
    return all as unknown as Parameters<typeof chainProblems>[0]['functions']
  }
  const check = async (port: string, grammar: string, sources: Source[], name: string, item: Record<string, unknown>) =>
    chainProblems({
      port, rule: { name }, item: item as never, functions: await functionsOf(grammar, sources),
      readSource: (path: string) => sources.find((source) => source.file === path)?.text,
    })

  describe('two functions that share a name, and only one of them starts the process', () => {
    // The shape of the Rust executors: a tracing helper called `run`, and the `run` that spawns.
    const span = ['impl DispatchSpan {', '    fn run(self, future: F) -> DispatchFuture {', '        DispatchFuture::new(future)', '    }', '}', ''].join('\n')
    const control = ['impl ControlModeExecutor {', '    fn execute(&self, request: CommandRequest) -> DispatchFuture {', '        let span = DispatchSpan::new(&request, "control");', '        span.run(async move { sender.send_line(line).await })', '    }', '}', ''].join('\n')
    const subprocess = [
      'impl SubprocessExecutor {', //                                                   1
      '    async fn run(self, request: CommandRequest) {', //                            2
      '        let mut child = process.spawn();', //                                    3
      '    }', //                                                                       4
      '    fn execute(&self, request: CommandRequest) -> DispatchFuture {', //           5
      '        DispatchSpan::new(&request, "subprocess").run(self.clone().run(request))', // 6
      '    }', //                                                                       7
      '}', //                                                                           8
      '',
    ].join('\n')
    const sources = [{ file: 'executor.rs', text: span }, { file: 'control_executor.rs', text: control }, { file: 'subprocess.rs', text: subprocess }]
    const hop = (at: string, over: Record<string, unknown> = {}) => ({ at, has: [], ...over })

    it('refuses a chain that goes through the tracing helper to the spawn', async () => {
      // `span.run(...)` is DispatchSpan::run, and the spawn is in SubprocessExecutor::run, though both are `run`. Nothing names the
      // handle for the executor, so the hop has to say what it holds, which is the reader's cue that it holds the tracing span.
      const wrong = { at: 'control_executor.rs:2', reaches: [hop('control_executor.rs:4', { calls: 'run' }), hop('subprocess.rs:3')] }
      expect((await check('rs', 'rust', sources, 'execute', wrong)).join('\n')).toMatch(/is a call of span\.run\(\), which resolves to no function the scan has read, and not to SubprocessExecutor\.run at subprocess\.rs:2/)
    })

    it('refuses a hop that says the call is made on a type its receiver is not', async () => {
      const core = ['impl Core {', '    fn execute(&self, request: Request) {', '        self.executor.execute(request)', '    }', '}', 'impl Server {', '    fn cmd(&self, command: Command) {', '        self.core.execute(command)', '    }', '}', ''].join('\n')
      const files = [...sources, { file: 'core.rs', text: core }]
      // `core.execute` is Core::execute; the chain that goes on in the executor and skips it is not this call.
      const skipped = { at: 'core.rs:7', reaches: [hop('core.rs:8', { calls: 'execute', on: 'SubprocessExecutor' }), hop('subprocess.rs:6', { calls: 'run', on: 'SubprocessExecutor' }), hop('subprocess.rs:3')] }
      expect((await check('rs', 'rust', files, 'cmd', skipped)).join('\n')).toMatch(/says the call is made on a SubprocessExecutor, but its receiver resolves it to Core\.execute at core\.rs:2/)
      const right = { at: 'core.rs:7', reaches: [hop('core.rs:8', { calls: 'execute' }), hop('core.rs:3', { leads: 'execute', why: 'a trait object' }), hop('subprocess.rs:6', { calls: 'run', on: 'SubprocessExecutor' }), hop('subprocess.rs:3')] }
      expect(await check('rs', 'rust', files, 'cmd', right)).toEqual([])
    })

    it('accepts the call that does start it, and a hop that says what a field holds', async () => {
      const right = { at: 'subprocess.rs:5', reaches: [hop('subprocess.rs:6', { calls: 'run', on: 'SubprocessExecutor' }), hop('subprocess.rs:3')] }
      expect(await check('rs', 'rust', sources, 'execute', right)).toEqual([])
      // The trait call has no receiver the scan can type, so the chain says why it leads on.
      const trait = { at: 'control_executor.rs:2', reaches: [hop('control_executor.rs:4', { leads: 'run' }), hop('subprocess.rs:3')] }
      expect((await check('rs', 'rust', sources, 'execute', trait)).join('\n')).toMatch(/leads to run and says nothing about why the scan cannot follow it/)
      const said = { at: 'control_executor.rs:2', reaches: [hop('control_executor.rs:4', { leads: 'run', why: 'a trait object' }), hop('subprocess.rs:3')] }
      expect(await check('rs', 'rust', sources, 'execute', said)).toEqual([])
    })

    it('refuses a hop whose line has no call of the name it says', async () => {
      // Line 7 closes `execute`; it makes no call of `run`.
      const none = { at: 'subprocess.rs:5', reaches: [hop('subprocess.rs:7', { calls: 'run' }), hop('subprocess.rs:3')] }
      expect((await check('rs', 'rust', sources, 'execute', none)).join('\n')).toMatch(/has no call of run on that line/)
    })
  })

  describe('overloads of one type', () => {
    const java = [
      'class Server {', //                                                                1
      '    CommandResult cmd(List<String> argv) {', //                                    2
      '        return cmd(argv, timeout, "");', //                                        3
      '    }', //                                                                         4
      '    CommandResult cmd(ServerSnapshot snapshot, List<String> argv) {', //          5
      '        return fence.guarded(snapshot, argv);', //                                 6
      '    }', //                                                                         7
      '    CommandResult cmd(List<String> argv, Duration timeout, String input) {', //    8
      '        return starter.start(argv);', //                                           9
      '    }', //                                                                        10
      '    CommandResult run(List<String> argv) {', //                                   11
      '        return cmd(argv);', //                                                    12
      '    }', //                                                                        13
      '}', //                                                                            14
      '',
    ].join('\n')
    const sources = [{ file: 'ProcessTransport.java', text: java }]
    const hop = (at: string, over: Record<string, unknown> = {}) => ({ at, has: [], ...over })

    it('takes the overload that the arguments of the call fit, and refuses the one they do not', async () => {
      const right = { at: 'ProcessTransport.java:11', reaches: [hop('ProcessTransport.java:12', { calls: 'cmd' }), hop('ProcessTransport.java:3', { calls: 'cmd' }), hop('ProcessTransport.java:9')] }
      expect(await check('java', 'java', sources, 'run', right)).toEqual([])
      // `cmd(argv)` passes one argument, so it is not the `cmd(snapshot, argv)` that calls the fence.
      const wrong = { at: 'ProcessTransport.java:11', reaches: [hop('ProcessTransport.java:12', { calls: 'cmd' }), hop('ProcessTransport.java:6')] }
      expect((await check('java', 'java', sources, 'run', wrong)).join('\n')).toMatch(/is a call of cmd\(1\), which resolves to Server\.cmd at ProcessTransport\.java:2, and not to Server\.cmd at ProcessTransport\.java:5/)
    })
  })

  describe('overloads told apart by their labels', () => {
    const swift = [
      'struct Server {', //                                                                       1
      '    func run(_ command: TmuxCommand) async throws -> TmuxReply {', //                      2
      '        try await run(rawArguments: command.argumentVector)', //                           3
      '    }', //                                                                                  4
      '    func run(rawArguments: [String]) async throws -> TmuxReply {', //                      5
      '        try await Subprocess.run(rawArguments)', //                                       6
      '    }', //                                                                                  7
      '    func send(_ list: TmuxCommandList) async throws -> TmuxReply {', //                    8
      '        try await run(list)', //                                                           9
      '    }', //                                                                                 10
      '}', //                                                                                    11
      '',
    ].join('\n')
    const sources = [{ file: 'Sources/LibTmux/Transport.swift', text: swift }]
    const hop = (at: string, over: Record<string, unknown> = {}) => ({ at, has: [], ...over })

    it('does not read run(rawArguments:) as the run(_:) that calls it', async () => {
      const labelled = { at: 'Sources/LibTmux/Transport.swift:2', reaches: [hop('Sources/LibTmux/Transport.swift:3', { calls: 'run' }), hop('Sources/LibTmux/Transport.swift:6')] }
      expect(await check('swift', 'swift', sources, 'run', labelled)).toEqual([])
      // `run(list)` has no label: it is the first `run`, which is not where the process is started.
      const unlabelled = { at: 'Sources/LibTmux/Transport.swift:8', reaches: [hop('Sources/LibTmux/Transport.swift:9', { calls: 'run' }), hop('Sources/LibTmux/Transport.swift:6')] }
      const named = await check('swift', 'swift', sources, 'send', unlabelled)
      expect(named.join('\n')).toMatch(/is a call of run\(_\), which resolves to Server\.run at Sources\/LibTmux\/Transport\.swift:2, and not to Server\.run at Sources\/LibTmux\/Transport\.swift:5/)
    })
  })
})

describe('scanning a command that a guard wraps, a conditional and a label', () => {
  const scanned = async (grammar: string, text: string, options: Record<string, unknown>, commands: string[]) => {
    const { functions } = await scanSource({ grammar, text, commands: new Set(commands), known: new Set(commands), ...options } as never)
    return Object.fromEntries(functions.map((found) => [found.name, found.sites.map((site) => (
      site.dispatch ? `${site.command}@${site.line}->${site.dispatch.name}@${site.dispatch.line}` : `${site.command}@${site.line} ${site.why}`))]))
  }
  const java = [
    'class Fixture {',
    '    void killOwnedServer() {',
    '        server.cmd("if-shell", "-F", check, "kill-server", stale);',
    '    }',
    '    void wrap(String command) {',
    '        server.cmd("if-shell", "-F", check, command, "stale");',
    '    }',
    '    void use() {',
    '        wrap("select-pane");',
    '    }',
    '}',
    '',
  ].join('\n')
  const commands = ['if-shell', 'kill-server', 'select-pane']

  it('records the command inside a declared guard and not the if-shell, and the if-shell of a conditional that is not one', async () => {
    const guarded = await scanned('java', java, { dispatch: new Set(['cmd']), guards: [{ name: 'killOwnedServer' }] }, commands)
    expect(guarded.killOwnedServer).toEqual(['if-shell@3 it is the check a guard wraps a command in', 'kill-server@3->cmd@3'])
    // The conditional whose purpose is the condition: the library sends if-shell, and tmux runs the command inside it when the condition holds.
    const conditional = await scanned('java', java, { dispatch: new Set(['cmd']) }, commands)
    expect(conditional.killOwnedServer).toEqual(['if-shell@3->cmd@3'])
  })

  it('passes a command through a declared guard that dispatches, and stops it at a wrapper that is not declared', async () => {
    const declared = await scanned('java', java, { dispatch: new Set(['cmd', 'wrap']), guards: [{ name: 'wrap' }] }, commands)
    expect(declared.use).toEqual(['select-pane@9->wrap@9'])
    expect(declared.wrap).toEqual(['if-shell@6 it is the check a guard wraps a command in'])
    const undeclared = await scanned('java', java, { dispatch: new Set(['cmd']) }, commands)
    expect(undeclared.use).toEqual(['select-pane@9 it is an argument of wrap, which neither sends it nor builds a command from it'])
    expect(undeclared.wrap).toEqual(['if-shell@6->cmd@6'])
  })

  it('does not read an argument that only names the command for a failure message as the command', async () => {
    const rust = [
      'async fn find(core: &Core, request: Command) {',
      '    listing::mutate(',
      '        core,',
      '        "find-window",',
      '        Command::new("find-window").arg("-x"),',
      '    ).await',
      '}',
      'async fn label(core: &Core, request: Command) {',
      '    listing::mutate(core, "find-window", request).await',
      '}',
      '',
    ].join('\n')
    const labels = new Map([['mutate', new Set([1])]])
    const found = await scanned('rust', rust, { dispatch: new Set(['mutate']), labels }, ['find-window'])
    expect(found.find).toEqual(['find-window@4 it names the command mutate reports a failure under, and is not the command it sends', 'find-window@5->mutate@2'])
    // With nothing but the label, the command is not sent by this call.
    expect(found.label).toEqual(['find-window@9 it names the command mutate reports a failure under, and is not the command it sends'])
    // The control: without the declaration the label counts as the command.
    expect((await scanned('rust', rust, { dispatch: new Set(['mutate']) }, ['find-window'])).label).toEqual(['find-window@9->mutate@9'])
  })

  it('counts a call under a branch apart from one that runs on every call, and a header or a one-statement closure with the main path', async () => {
    const go = [
      'package tmux',
      'func (p Pane) Refresh() error {',
      '\tif err := p.server.Pane(ctx); err != nil {',
      '\t\treturn err',
      '\t}',
      '\tif p.ready {',
      '\t\tp.server.Session(ctx)',
      '\t}',
      '\tdefer func() { _ = p.server.Close(ctx) }()',
      '\tdefer func() {',
      '\t\tif failed { p.server.Kill(ctx) }',
      '\t}()',
      '\treturn nil',
      '}',
      '',
    ].join('\n')
    const { functions } = await scanSource({ grammar: 'go', text: go, commands: new Set(['x']), known: new Set(['x']), dispatch: new Set(['literalCmd']) })
    const depths = Object.fromEntries(functions[0].callDepths as Map<string, number>)
    expect(depths).toMatchObject({ Pane: 0, Session: 1, Close: 0, Kill: 1 })
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

  it('removes only the commands an exclusion names, so the other commands of the same symbols stay', () => {
    const held = new Map([
      ...found(),
      ['tmux.Plan.KillPane|display-message', { ...entry('tmux.Plan.KillPane'), command: 'display-message' }],
    ])
    const { removed, problems } = apply([exclusion({ commands: ['kill-pane'] })], held)
    expect(problems).toEqual([])
    expect(removed.map((item: { symbol: string; command: string }) => `${item.symbol} ${item.command}`)).toEqual(['tmux.Plan.KillPane kill-pane'])
    expect([...held.values()].map((item: { symbol: string; command: string }) => `${item.symbol} ${item.command}`)).toContain('tmux.Plan.KillPane display-message')
    // The control: naming a command the symbols do not send removes nothing, and says the exclusion is stale.
    expect(apply([exclusion({ commands: ['new-window'] })]).problems.join('\n')).toMatch(/removes no entry, so it is stale/)
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
  const core = (entries: ReturnType<typeof coreEntry>[]) => ({ entries, symbols: coreSymbols, revision: 'c0ffee' })
  const wrapper = (name: string, parentName: string, id = `w.${parentName}.${name}`) => ({ id, name, parentName, file: 'W.kt', line: 1 })
  const fn = (name: string, owner: string, calls: [string, number][], receivers: [string, string[]][] = []) =>
    located({ file: 'W.kt', name, owner, start: 1, nameLine: 1, end: 9, calls: new Map(calls), receivers: new Map(receivers.map(([callee, who]) => [callee, new Set(who)])) })
  const forward = (functions: ReturnType<typeof fn>[], symbols: ReturnType<typeof wrapper>[], entries: ReturnType<typeof coreEntry>[]) =>
    forwardUsage({ parent: 'java', functions, types: [], symbols, core: core(entries) }) as unknown as { entries: Forwarded[]; silent: string[] }

  it('credits the scope the core method sends at, with the line of the call and the core evidence', () => {
    const { entries } = forward([fn('panes', 'Server', [['panes', 4]], [['panes', ['server']]])], [wrapper('panes', 'Server')], [coreEntry('core.Server.panes', 'server')])
    expect(entries).toEqual([{
      symbol: 'w.Server.panes', command: 'list-panes', scope: 'server', evidence: ['W.kt:4'], hops: 1,
      // The via says which revision of the core library its lines were read at.
      via: { port: 'java', symbol: 'core.Server.panes', revision: 'c0ffee', evidence: ['Core.java:10'] },
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

  it('reads a call that a condition only gates as a send, and a choice between two commands as none', () => {
    const both = new Set(['list-panes', 'list-windows'])
    const text = [
      'function gated(conn, ss)',
      '    ws = isempty(ss) ? [] : run(conn, "list-windows")',
      '    pick = flag ? "list-panes" : "list-windows"',
      '    run(conn, pick)',
      'end',
      '',
    ].join('\n')
    const { functions } = scanJulia(text, { commands: both, known: both, dispatch: new Set(['run']) }) as unknown as { functions: { sites: { command: string; line: number; dispatch?: { name: string } | null }[] }[] }
    expect(functions[0].sites.map((found) => [found.line, found.command, found.dispatch?.name ?? null])).toEqual([[2, 'list-windows', 'run'], [3, 'list-panes', null], [3, 'list-windows', null]])
  })

  it('takes the body of a short-form function from the equals sign, when its arguments span lines', () => {
    const text = [
      'read(',
      '    connection::ControlConnection,',
      '    fields::AbstractVector;',
      '    kwargs...,',
      ') = _read(connection, fields; kwargs...)',
      '',
      'other() = nothing',
      '',
    ].join('\n')
    const { functions } = scanJulia(text, { commands, known: commands }) as unknown as { functions: (Scanned & { nameLine: number; receiverType?: string })[] }
    const read = functions.find((fn) => fn.name === 'read')!
    expect([read.nameLine, read.end, read.receiverType]).toEqual([1, 5, 'ControlConnection'])
    expect([...read.calls.keys()]).toContain('_read')
    expect(functions.find((fn) => fn.name === 'other')!.start).toBe(7)
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

describe('the methods of a generic function', () => {
  const dispatch = new Set(['_operation_command', '_control_effect', '_control_create'])
  const commands = new Set(['list-panes', 'list-windows', 'list-sessions'])
  const text = [
    'function panes(server::Server, pane)', //                                      1
    '    args = ["list-panes", "-a"]', //                                            2
    '    _operation_command(server, args...)', //                                    3
    'end', //                                                                        4
    '', //                                                                          5
    'function panes(connection::ControlConnection, pane)', //                       6
    '    _control_effect(connection, ["list-panes", "-a"])', //                      7
    'end', //                                                                        8
    '', //                                                                          9
    'function windows(server::Server)', //                                         10
    '    _operation_command(server, "list-windows")', //                            11
    'end', //                                                                       12
    '', //                                                                         13
    'function windows(connection::ControlConnection)', //                           14
    '    _quiet(connection)', //                                                    15
    'end', //                                                                       16
    '', //                                                                         17
    '_quiet(connection) = nothing', //                                              18
    '', //                                                                         19
    'function sessions(server::Server)', //                                        20
    '    _operation_command(server, "list-sessions")', //                           21
    'end', //                                                                       22
    '', //                                                                         23
    'function sessions(connection::ControlConnection)', //                         24
    '    _first(connection)', //                                                   25
    'end', //                                                                       26
    '', //                                                                         27
    '_first(handle) = _second(handle)', //                                         28
    '_second(handle) = _operation_command(handle, "list-sessions")', //            29
    '', //                                                                         30
    'function forwarding(server::Server)', //                                      31
    '    _operation_command(server, "list-windows")', //                           32
    'end', //                                                                      33
    '', //                                                                         34
    'function forwarding(f, server::Server)', //                                   35
    '    forwarding(server)', //                                                  36
    'end', //                                                                      37
    '',
  ].join('\n')
  const symbols = ['panes', 'windows', 'sessions', 'forwarding'].map((name) => ({ id: `LibTmux.${name}`, name, file: 'lib.jl', line: 1 }))
  const methods = async () => {
    const { functions } = await scanSource({ grammar: 'julia', text, commands, known: commands, dispatch })
    return functions.map((fn: object) => ({ ...fn, file: 'lib.jl' })) as unknown as Parameters<typeof deriveUsage>[0]['functions']
  }
  const entries = async (command: string) => {
    const result = deriveUsage({ command, spec: undefined, functions: await methods(), symbols, definitionOptions: { freeFunctions: true } })
    return Object.fromEntries(result.entries.map((entry) => [entry.symbol.replace('LibTmux.', ''), entry as unknown as { methods: { sends: { nameLine: number }[]; lacks: { nameLine: number }[]; deep: { nameLine: number }[]; unsure: unknown[] } }]))
  }
  const lines = (names: string[]) => (path: string) => (path === 'lib.jl' ? names.join('\n') : undefined)
  void lines

  it('tells the methods apart by the type of the first argument', async () => {
    const found = await methods()
    expect(found.filter((fn) => fn.name === 'panes').map((fn) => (fn as unknown as { receiverType: string }).receiverType)).toEqual(['Server', 'ControlConnection'])
  })

  it('finds a send that every method makes, and needs no qualifier for it', async () => {
    const { panes } = await entries('list-panes')
    expect(panes.methods.sends.map((method) => method.nameLine)).toEqual([1, 6])
    expect(panes.methods.lacks).toEqual([])
    expect(partialProblems(new Map([['panes', panes as never]]))).toEqual([])
  })

  it('finds a send that only one method makes, and asks for a condition that says when', async () => {
    const { windows } = await entries('list-windows')
    expect(windows.methods.sends.map((method) => method.nameLine)).toEqual([10])
    expect(windows.methods.lacks.map((method) => method.nameLine)).toEqual([14])
    expect(partialProblems(new Map([['windows', windows as never]])).join('\n')).toMatch(/only the Server methods send it, and 1 other method such as lib.jl:14 do not/)
  })

  it('does not call a method that only reaches the send through more calls than a symbol is credited across a method that lacks it', async () => {
    const { sessions } = await entries('list-sessions')
    expect(sessions.methods.sends.map((method) => method.nameLine)).toEqual([20])
    expect(sessions.methods.deep.map((method) => method.nameLine)).toEqual([24])
    expect(sessions.methods.lacks).toEqual([])
    expect(partialProblems(new Map([['sessions', sessions as never]]))).toEqual([])
  })

  it('counts a method that forwards to a method of its own name as sending what that one sends', async () => {
    const { forwarding } = await entries('list-windows')
    expect(forwarding.methods.sends.map((method) => method.nameLine)).toEqual([31])
    expect(forwarding.methods.deep.map((method) => method.nameLine)).toEqual([35])
    expect(forwarding.methods.lacks).toEqual([])
    expect(partialProblems(new Map([['forwarding', forwarding as never]]))).toEqual([])
  })

  describe('a receiver qualifier', () => {
    const found = async () => new Map([['LibTmux.windows\0list-windows\0null', (await entries('list-windows')).windows as never]])
    const body = (start: number, end: number, has: string) => ({ at: `lib.jl:${start}`, through: end, has: [has] })
    const condition = (over: Record<string, unknown> = {}) => ({
      port: 'julia', symbol: 'LibTmux.windows', command: 'list-windows', scope: null, when: 'on a Server', receiver: 'Server',
      evidence: [body(10, 12, 'function windows('), body(14, 16, 'function windows(')], ...over,
    })
    const apply = async (item: Record<string, unknown>) => applyConditions({ conditions: [item as never], found: await found(), readSource: lines(text.split('\n')) })

    it('is accepted when the methods that send take the type, another method does not, and both bodies are cited', async () => {
      expect(await apply(condition())).toEqual([])
    })

    it.each([
      ['a type the sending method does not take', { when: 'on a ControlConnection', receiver: 'ControlConnection' }, /ControlConnection, but the Server method at lib.jl:10 sends it too/],
      ['a body cited for the sending method only', { evidence: [body(10, 12, 'function windows(')] }, /cites the body of no method that does not send it/],
      ['a signature line in place of the body', { evidence: [{ at: 'lib.jl:10', has: ['::Server'] }, { at: 'lib.jl:14', has: ['::ControlConnection'] }] }, /cites the body of no method that sends it/],
      ['a body that ends elsewhere', { evidence: [body(10, 11, 'function windows('), body(14, 16, 'function windows(')] }, /cites the body of no method that sends it/],
    ])('is refused for %s', async (_name, over, message) => {
      expect((await apply(condition(over))).join('\n')).toMatch(message)
    })

    it('is refused for a send that every method makes', async () => {
      const every = new Map([['LibTmux.panes\0list-panes\0null', (await entries('list-panes')).panes as never]])
      const item = condition({ symbol: 'LibTmux.panes', command: 'list-panes', evidence: [body(1, 4, 'function panes('), body(6, 8, 'function panes(')] })
      expect(applyConditions({ conditions: [item as never], found: every, readSource: lines(text.split('\n')) }).join('\n')).toMatch(/no method of the function is shown not to send it/)
    })
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
    const settle = (reviews: unknown[], covering: unknown[] = [], readSource: ((path: string) => string | undefined) | null = source) =>
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
      ['a kind that is not one of the five', { kind: 'probably-fine' }, /is not one of builds, other-command, values, no-send, version-gated/],
      ['a review that names nothing', { owner: undefined, names: undefined, commands: undefined }, /names no owner, member or command/],
    ])('refuses %s, and leaves the candidate unreviewed', (_name, over, message) => {
      const result = settle([review(over)])
      expect(result.problems.join('\n')).toMatch(message)
      expect(result.unreviewed).toEqual(candidates)
    })

    describe('a method that sends one command on some supported releases and another on the rest', () => {
      const lines = ['def find(self):', '    if version < (3, 3):', '        return self.cmd("list-windows", "-a")', '    return self.cmd("display-message", "-p")', 'FLOOR = (3, 2)']
      const gated = (over: Record<string, unknown> = {}) => review({
        kind: 'version-gated', names: ['clear'], why: 'Lists below 3.3 and asks display-message from 3.3; the floor is 3.2.',
        evidence: [
          { at: 'src/libtmux/pane.py:2', has: ['version < (3, 3)'] },
          { at: 'src/libtmux/pane.py:3', has: ['"list-windows"'] },
          { at: 'src/libtmux/pane.py:4', has: ['"display-message"'] },
          { at: 'src/libtmux/pane.py:5', has: ['FLOOR = (3, 2)'] },
        ], ...over,
      })
      const read = (path: string) => (path === 'src/libtmux/pane.py' ? lines.join('\n') : undefined)

      it('is settled by a review that shows the gate, both branches and the floor below it', () => {
        expect(settle([gated()], [], read)).toEqual({ unreviewed: [], reviewed: 1, problems: [] })
      })

      it.each([
        ['the floor left out', { evidence: gatedEvidence().slice(0, 3) }],
        ['a line cited without the text that shows it', { evidence: [...gatedEvidence().slice(0, 3), { at: 'src/libtmux/pane.py:5' }] }],
        ['the gate left out', { evidence: [{ at: 'src/libtmux/pane.py:3', has: ['"list-windows"'] }] }],
      ])('refuses %s, and leaves the candidate unreviewed', (_name, over) => {
        const result = settle([gated(over)], [], read)
        expect(result.problems.join('\n')).toMatch(/a version-gated review cites the gate, both branches and the supported floor/)
        expect(result.unreviewed).toEqual(candidates)
      })

      it('refuses a gate whose cited text is not on the line', () => {
        const result = settle([gated({ evidence: gatedEvidence().map((item, index) => (index === 0 ? { ...item, has: ['version < (3, 4)'] } : item)) })], [], read)
        expect(result.problems.join('\n')).toMatch(/does not contain "version < \(3, 4\)"/)
        expect(result.unreviewed).toEqual(candidates)
      })

      function gatedEvidence() {
        return gated().evidence as { at: string; has?: string[] }[]
      }
    })

    it('does not read the evidence without a checkout, and lets a covering rule settle without being checked', () => {
      expect(settle([review({ evidence: [{ at: 'nowhere.py:1', has: ['x'] }] })], [], null)).toEqual({ unreviewed: [], reviewed: 1, problems: [] })
      expect(settle([], [{ port: 'py', owner: 'Pane', names: ['to_command'] }])).toEqual({ unreviewed: candidates, reviewed: 0, problems: [] })
      expect(settle([], [{ port: 'py', owner: 'Pane', names: ['clear'] }]).unreviewed).toEqual([])
    })
  })
})

/** A file read by the scan that finds the calls that send, in the shape the audit reads its sources. */
const sourcesOf = async (grammar: string, file: string, text: string, dispatch: string[], commands: string[]) => {
  const scanned = await scanSource({ grammar, text, commands: new Set(commands), known: new Set(commands), dispatch: new Set(dispatch) })
  return { read: (path: string) => (path === file ? text : undefined), functions: scanned.functions.map((fn) => ({ ...fn, file })) }
}

describe('scanning for the call that sends', () => {
  const sites = async (grammar: string, text: string, dispatch: string[], commands: string[]) => {
    const { functions } = await scanSource({ grammar, text, commands: new Set(commands), known: new Set(commands), dispatch: new Set(dispatch) })
    return Object.fromEntries(functions.map((fn) => [fn.name, fn.sites.map((found: { command: string, line: number, dispatch?: { line: number, name: string } | null, why?: string, builds?: boolean }) => (
      found.dispatch ? `${found.command}@${found.line}->${found.dispatch.name}@${found.dispatch.line}` : `${found.command}@${found.line} ${found.why}${found.builds ? ' (builds)' : ''}`))]))
  }

  it('records a literal that is an argument of a dispatch call, at the dispatch call, and no other literal in the function', async () => {
    const found = await sites('python', [
      'class S:',
      '    def panes(self):',
      '        return self.cmd("list-panes", "-a")',
      '    def selector(self):',
      '        fmt = get_output_format("list-windows", ["x"])',
      '        return self.cmd("list-panes", "-F", fmt)',
      '',
    ].join('\n'), ['cmd'], ['list-panes', 'list-windows'])
    expect(found.panes).toEqual(['list-panes@3->cmd@3'])
    // A row or format selector is an argument of a call that neither sends it nor builds a command from it.
    expect(found.selector).toEqual(['list-windows@5 it is an argument of get_output_format, which neither sends it nor builds a command from it', 'list-panes@6->cmd@6'])
  })

  it('does not record a command that a condition picks among others, a label, or a helper that never dispatches', async () => {
    const found = await sites('python', [
      'class S:',
      '    def choose(self, hooks):',
      '        return self.cmd("list-windows" if hooks else "list-panes")',
      '    def label(self):',
      '        return describe("list-panes")',
      '    def same(self, exit):',
      '        return self.cmd(["list-panes", "-E", exit] if exit else ["list-panes"])',
      '',
    ].join('\n'), ['cmd'], ['list-panes', 'list-windows'])
    expect(found.choose).toEqual(['list-windows@3 a condition chooses it among other commands', 'list-panes@3 a condition chooses it among other commands'])
    expect(found.label).toEqual(['list-panes@5 it is an argument of describe, which neither sends it nor builds a command from it'])
    // The control: a condition between spellings of the same command picks no other command.
    expect(found.same).toEqual(['list-panes@7->cmd@7', 'list-panes@7->cmd@7'])
  })

  it('does not record the choice of a receiver class or a value arm either', async () => {
    const ruby = await sites('ruby', [
      'class Options',
      '  def list',
      '    command = is_a?(Hooks) ? "list-windows" : "list-panes"',
      '    run(command)',
      '  end',
      '  def plain',
      '    run("list-panes", "-g")',
      '  end',
      'end',
      '',
    ].join('\n'), ['run'], ['list-panes', 'list-windows'])
    expect(ruby.list).toEqual(['list-windows@3 a condition chooses it among other commands', 'list-panes@3 a condition chooses it among other commands'])
    expect(ruby.plain).toEqual(['list-panes@7->run@7'])
  })

  it('records a command bound to a name at the later call that takes the name, and not the binding', async () => {
    const found = await sites('rust', [
      'fn split(core: &Core) {',
      '    let mut command = Command::new("list-panes");',
      '    command.arg("-h");',
      '    run(core, command).await',
      '}',
      'fn label(core: &Core) {',
      '    log(Error::new("list-panes", core.reason()));',
      '}',
      '',
    ].join('\n'), ['run'], ['list-panes'])
    expect(found.split).toEqual(['list-panes@2->run@4'])
    expect(found.label).toEqual(['list-panes@7 it is an argument of log, which neither sends it nor builds a command from it'])
  })

  it('does not record a command whose variable a call that is not a builder has bound again before the send', async () => {
    const lines = (rebind: string) => [
      'package tmux',
      'func (s Server) open() error {',
      '\tattach := []string{"list-panes"}',
      '\tattach = append(attach, "-t", "x")',
      rebind,
      '\treturn s.startControl(attach)',
      '}',
      '',
    ].join('\n')
    const guarded = await sites('go', lines('\tattach, guard, err := s.guardCommand(attach, false)'), ['startControl'], ['list-panes'])
    expect(guarded.open).toEqual(['list-panes@3 its variable is rebound by guardCommand, which neither sends it nor builds a command from it'])
    // The controls: a rebinding through a way of adding to the list, a call that binds another name, and a declared builder.
    expect((await sites('go', lines('\tattach = append([]string{"-C"}, attach...)'), ['startControl'], ['list-panes'])).open).toEqual(['list-panes@3->startControl@6'])
    expect((await sites('go', lines('\tother, err := s.guardCommand(attach, false)'), ['startControl'], ['list-panes'])).open).toEqual(['list-panes@3->startControl@6'])
    const { functions } = await scanSource({ grammar: 'go', text: lines('\tattach, err = withFlags(attach, false)'), commands: new Set(['list-panes']), known: new Set(['list-panes']), dispatch: new Set(['startControl']), builders: new Set(['withFlags']) })
    expect(functions[0].sites.map((found) => found.dispatch?.line)).toEqual([6])
  })

  it('credits a literal in a throw label to nothing, and the real send in the same function to the dispatch call', async () => {
    const found = await sites('typescript', [
      'export async function validate(runtime, options) {',
      '  if (options.signal?.aborted === true)',
      '    throw new TmuxTransportError("cancelled", {',
      '      subcommand: "list-panes",',
      '    });',
      '  return await runCommand(runtime, ["list-panes", "-p"], options);',
      '}',
      '',
    ].join('\n'), ['runCommand'], ['list-panes'])
    expect(found.validate).toEqual(['list-panes@4 it reaches no call that sends', 'list-panes@6->runCommand@6'])
  })

  it('leaves a builder that returns a command to its caller, which sends it with the call of the builder between', async () => {
    const found = await sites('python', [
      'class S:',
      '    def build(self):',
      '        return ["list-panes", "-a"]',
      '    def run(self):',
      '        command = self.build()',
      '        return self.cmd(*command)',
      '',
    ].join('\n'), ['cmd'], ['list-panes'])
    expect(found.build).toEqual(['list-panes@3 it builds a value for the caller (builds)'])
    expect(found.run).toEqual([])
    const { functions } = await scanSource({ grammar: 'python', text: ['class S:', '    def build(self):', '        return ["list-panes", "-a"]', '    def run(self):', '        command = self.build()', '        return self.cmd(*command)', ''].join('\n'), commands: new Set(['list-panes']), known: new Set(['list-panes']), dispatch: new Set(['cmd']) })
    const located = functions.map((fn: object) => ({ ...fn, file: 'lib.py' }))
    const credited = [...builtSites(located as never).entries()].map(([fn, list]) => [(fn as { name: string }).name, (list as { line: number, dispatch: { line: number }, via: { call: number } }[]).map((site) => [site.dispatch.line, site.via.call, site.line])])
    expect(credited).toEqual([['run', [[6, 5, 3]]]])
  })
})

describe('scanning for the call that sends, in the shapes of each grammar', () => {
  const sites = async (grammar: string, text: string, dispatch: string[], commands: string[]) => {
    const { functions } = await scanSource({ grammar, text, commands: new Set(commands), known: new Set(commands), dispatch: new Set(dispatch) })
    return Object.fromEntries(functions.map((fn) => [fn.name, fn.sites.map((found: { command: string, line: number, dispatch?: { line: number, name: string } | null, builds?: boolean }) => (
      found.dispatch ? `${found.command}@${found.line}->${found.dispatch.name}@${found.dispatch.line}` : `${found.command}@${found.line} ${found.builds ? 'builds' : 'sends nothing'}`))]))
  }

  it('reads the last expression of a Rust body as the value it builds, with or without a return', async () => {
    const found = await sites('rust', [
      'fn version_command() -> Command {',
      '    Command::new("list-panes")',
      '        .arg("-a")',
      '}',
      'fn explicit() -> Command {',
      '    return Command::new("list-panes").arg("-a");',
      '}',
      'async fn version(server: &Server) {',
      '    server.cmd(version_command()).await',
      '}',
      '',
    ].join('\n'), ['cmd'], ['list-panes'])
    expect(found.version_command).toEqual(['list-panes@2 builds'])
    expect(found.explicit).toEqual(['list-panes@6 builds'])
    // The control: the same literal in the arguments of the dispatch call is sent at once, and not built for anyone.
    const direct = await sites('rust', 'async fn version(server: &Server) {\n    server.cmd(Command::new("list-panes")).await\n}\n', ['cmd'], ['list-panes'])
    expect(direct.version).toEqual(['list-panes@2->cmd@2'])
  })

  it('follows a command put in a struct field of a request to the call that takes the request', async () => {
    const found = await sites('cpp', [
      'int Connection::apply(Connection connection) {',
      '  ControlRequest layout_request;',
      '  layout_request.group.push_back(',
      '      ControlCommand{{"list-panes", "-a"}});',
      '  return connection.execute(std::move(layout_request), deadline);',
      '}',
      'int Connection::other(Connection connection) {',
      '  ControlRequest request;',
      '  ControlCommand pending{{"list-panes", "-a"}};',
      '  request.group.push_back(std::move(pending));',
      '  log(std::move(request));',
      '  return 0;',
      '}',
      '',
    ].join('\n'), ['execute'], ['list-panes'])
    expect(found.apply).toEqual(['list-panes@4->execute@5'])
    // A request handed to a call that does not send is not sent.
    expect(found.other).toEqual(['list-panes@9 sends nothing'])
  })
})

describe('scanning a send made inside a closure', () => {
  it('cites the inner dispatch call when a runner of the same name wraps a closure that makes it', async () => {
    const { functions } = await scanSource({
      grammar: 'csharp', commands: new Set(['rotate-window']), known: new Set(['rotate-window']), dispatch: new Set(['RunAsync']),
      text: [
        'class Window {',
        '    Task RotateAsync(CancellationToken token) {',
        '        List<string> arguments = ["rotate-window", "-t", "x"];',
        '        return Sequence.RunAsync(',
        '            () => RunAsync(arguments, token),',
        '            () => RefreshAsync(token));',
        '    }',
        '}',
        '',
      ].join('\n'),
    })
    expect(functions[0].sites.map((found) => [found.line, found.dispatch?.line])).toEqual([[3, 5]])
  })
})

describe('citing one of several sends of a command', () => {
  it('cites the send under the fewest branches when the same command is sent on several paths', async () => {
    const { functions } = await scanSource({
      grammar: 'python', commands: new Set(['list-panes']), known: new Set(['list-panes']), dispatch: new Set(['cmd']),
      text: [
        'def panes(self, mode):',
        '    if mode:',
        '        return self.cmd("list-panes", "-a")',
        '    return self.cmd("list-panes", "-a")',
        '',
      ].join('\n'),
    })
    const fn = { ...functions[0], file: 'lib.py' }
    expect(fn.sites.map((found) => found.depth)).toEqual([1, 0])
    const symbols = [{ id: 'S.panes', name: 'panes', file: 'lib.py', line: 1 }]
    const { entries } = deriveUsage({ command: 'list-panes', spec, functions: [fn as never], symbols })
    expect(entries.map((entry: { evidence: string[] }) => entry.evidence)).toEqual([['lib.py:4']])
  })
})

describe('resolving a call to the function it calls', () => {
  const owned = (name: string, owner: string | undefined, file: string) => ({ name, owner, file })
  const caller = (over: Record<string, unknown> = {}) => ({ file: 'pane.rs', owner: 'Pane', calls: new Map([['into_command', 10]]), receivers: new Map<string, Set<string>>(), ...over })
  const capture = owned('into_command', 'CaptureOptions', 'options.rs')
  const split = owned('into_command', 'SplitOptions', 'options.rs')

  it('takes the only function of a name, whatever the call is made on', () => {
    expect(callTargets(caller(), capture, [capture])).toBe(true)
    expect(callTargets(caller({ calls: new Map() }), capture, [capture])).toBe(false)
  })

  it('does not take the function of another type that shares the name, for a call made on something else', () => {
    // `Pane.split` calls `options.into_command()`, which is not the one in `CaptureOptions`: the name alone is not the callee.
    const onOptions = caller({ receivers: new Map([['into_command', new Set(['options'])]]) })
    expect(callTargets(onOptions, capture, [capture, split])).toBe(false)
    expect(callTargets(onOptions, split, [capture, split])).toBe(false)
    // A handle named for the type is that type's; a call with no handle is the caller's own type's.
    expect(callTargets(caller({ receivers: new Map([['into_command', new Set(['captureoptions'])]]) }), capture, [capture, split])).toBe(true)
    expect(callTargets(caller({ receivers: new Map([['into_command', new Set(['captureoptions'])]]) }), split, [capture, split])).toBe(false)
    expect(callTargets(caller({ owner: 'SplitOptions' }), split, [capture, split])).toBe(true)
    expect(callTargets(caller({ owner: 'SplitOptions' }), capture, [capture, split])).toBe(false)
    expect(callTargets(caller({ receivers: new Map([['into_command', new Set(['self'])]]), owner: 'CaptureOptions' }), capture, [capture, split])).toBe(true)
  })

  it('takes a Go call on the receiver the method names, and a free function only when no second one could be meant', () => {
    const go = caller({ file: 'pane.go', owner: 'Pane', selfName: 'p', receivers: new Map([['into_command', new Set(['p'])]]) })
    expect(callTargets(go, owned('into_command', 'Pane', 'pane.go'), [capture, owned('into_command', 'Pane', 'pane.go')])).toBe(true)
    const free = owned('into_command', undefined, 'util.rs')
    const other = owned('into_command', undefined, 'elsewhere.rs')
    expect(callTargets(caller(), free, [free, capture])).toBe(true)
    expect(callTargets(caller(), free, [free, other])).toBe(false)
    expect(callTargets(caller({ file: 'util.rs' }), free, [free, other])).toBe(true)
    expect(callTargets(caller({ receivers: new Map([['into_command', new Set(['options'])]]) }), free, [free, capture])).toBe(false)
  })

  it('credits a public method only through the callee its call resolves to', () => {
    const functions = [
      located({ file: 'options.rs', name: 'into_command', owner: 'CaptureOptions', start: 1, nameLine: 1, end: 4, sites: [{ command: 'list-panes', line: 2, flags: 'a', dispatch: { line: 2, name: 'run' } }] }),
      located({ file: 'options.rs', name: 'into_command', owner: 'SplitOptions', start: 5, nameLine: 5, end: 8 }),
      located({ file: 'pane.rs', name: 'split', owner: 'Pane', start: 1, nameLine: 1, end: 6, calls: new Map([['into_command', 3]]), receivers: new Map([['into_command', new Set(['options'])]]) }),
    ]
    const symbols = [{ id: 'pane.Pane.split', name: 'split', parentName: 'Pane', file: 'pane.rs', line: 1 }]
    expect(deriveUsage({ command: 'list-panes', spec, functions, symbols }).entries).toEqual([])
    // The control: the same call made on a handle named for the type reaches the site.
    functions[2].receivers = new Map([['into_command', new Set(['captureoptions'])]])
    expect(deriveUsage({ command: 'list-panes', spec, functions, symbols }).entries.map((entry: { symbol: string }) => entry.symbol)).toEqual(['pane.Pane.split'])
  })
})

describe('reading back the lines an entry cites', () => {
  const library = [
    'def panes(self):', //                                      1
    '    return fetch("list-panes", ["-a"])', //                2
    '', //                                                      3
    'def search(self):', //                                     4
    '    return panes()', //                                    5
    '', //                                                      6
    'def broken(self):', //                                     7
    '    raise Unsupported("list-panes")', //                   8
    '', //                                                      9
    'def label(self):', //                                      10
    '    return describe("list-panes")', //                     11
    '', //                                                      12
    'def kind(self, hooks):', //                                13
    '    return fetch("list-hooks" if hooks else "list-panes")', // 14
    '', //                                                      15
    'def build(self):', //                                      16
    '    return ["list-panes", "-a"]', //                       17
    '', //                                                      18
    'def built(self):', //                                      19
    '    command = build()', //                                 20
    '    return fetch(command)', //                             21
    '', //                                                      22
    'def selector(self):', //                                   23
    '    fmt = get_output_format("list-panes", ["x"])', //      24
    '    return fetch("list-windows", "-F", fmt)', //           25
    '', //                                                      26
    'def compare(self, name):', //                              27
    '    if name == "list-panes":', //                          28
    '        return fetch("list-windows")', //                  29
  ].join('\n')
  const commands = ['list-panes', 'list-hooks', 'list-windows']
  const use = (over: Record<string, unknown> = {}) => ({ symbol: 'S.search', command: 'list-panes', scope: 'server', evidence: ['lib.py:2', 'lib.py:5'], ...over })
  const auditOver = (sources: unknown, uses: unknown[], over: Record<string, unknown> = {}) => auditEvidence({
    port: 'py', revision: 'r1', uses: uses as never, claimFor: () => undefined, spellings: (command: string) => [command],
    sourcesAt: (port: string, revision: string) => (port === 'py' && revision === 'r1' ? sources : undefined), ...over,
  } as never)
  const audit = async (uses: unknown[], over: Record<string, unknown> = {}) => auditOver(await sourcesOf('python', 'lib.py', library, ['fetch'], commands), uses, over)

  it('accepts a scanned entry whose first line is the call that sends and whose next line calls the function around it', async () => {
    expect(await audit([use()])).toEqual([])
    // The command may be spelled by its alias.
    expect(await audit([use({ command: 'lsp' })], { spellings: () => ['list-panes', 'lsp'] })).toEqual([])
  })

  it.each([
    ['a line past the end of the file', { evidence: ['lib.py:99', 'lib.py:5'] }, /lib.py:99 is not a line of py at r1/],
    ['a file the revision does not have', { evidence: ['gone.py:1'] }, /gone.py:1 is not a line of py at r1/],
    ['a first line that is not a call that sends', { evidence: ['lib.py:5'] }, /lib.py:5 is not a call that sends list-panes/],
    ['a later line that does not call the function around the line before it', { evidence: ['lib.py:2', 'lib.py:7'] }, /lib.py:7 is not a call of panes/],
    ['a later line that follows a line in no function', { evidence: ['lib.py:3', 'lib.py:5'] }, /not a line of py|is in no function|is not a call that sends/],
    ['a first line that throws', { evidence: ['lib.py:8'] }, /lib.py:8 is not a call that sends list-panes/],
    ['a first line that compares the command', { evidence: ['lib.py:28'] }, /lib.py:28 is not a call that sends list-panes/],
    ['a first line that passes the command to a call that never sends it', { evidence: ['lib.py:11'] }, /lib.py:11 is not a call that sends list-panes \(it is an argument of describe/],
    ['a first line whose command a condition picks among others', { evidence: ['lib.py:14'] }, /lib.py:14 is not a call that sends list-panes \(a condition chooses it/],
    ['a first line that is a format selector', { evidence: ['lib.py:24'] }, /lib.py:24 is not a call that sends list-panes \(it is an argument of get_output_format/],
    ['a first line that only builds the command for a caller', { evidence: ['lib.py:17'] }, /lib.py:17 is not a call that sends list-panes \(it builds a value for the caller/],
  ])('refuses %s', async (_name, over, message) => {
    expect((await audit([use(over)])).join('\n')).toMatch(message)
  })

  it('accepts what the refused lines are next to: the real send beside a comparison and beside a selector', async () => {
    expect(await audit([use({ symbol: 'S.compare', command: 'list-windows', evidence: ['lib.py:29'] })])).toEqual([])
    expect(await audit([use({ symbol: 'S.selector', command: 'list-windows', evidence: ['lib.py:25'] })])).toEqual([])
  })

  it('reads a command built by a helper as the call that sends, the call of the helper and the literal, in that order', async () => {
    const built = (evidence: string[]) => use({ symbol: 'S.built', evidence })
    expect(await audit([built(['lib.py:21', 'lib.py:20', 'lib.py:17'])])).toEqual([])
    // The builder alone sends nothing; and the triple has to be the one the scan found, in order.
    expect((await audit([built(['lib.py:17'])])).join('\n')).toMatch(/lib.py:17 is not a call that sends list-panes/)
    expect((await audit([built(['lib.py:21', 'lib.py:17', 'lib.py:20'])])).join('\n')).toMatch(/not a call/)
    expect((await audit([built(['lib.py:20'])])).join('\n')).toMatch(/lib.py:20 is not a call that sends list-panes/)
  })

  it('reads each hop as a call of the function the line before belongs to, resolved by what it is called on and not by its name', async () => {
    const rust = [
      'impl CaptureOptions {', //                                            1
      '    fn into_command(self, pane: &str) -> Command {', //              2
      '        let command = Command::new("list-panes");', //               3
      '        run(command)', //                                             4
      '    }', //                                                           5
      '}', //                                                               6
      'impl Pane {', //                                                     7
      '    fn split(&self, options: SplitOptions) {', //                    8
      '        options.into_command(&pane)', //                              9
      '    }', //                                                           10
      '    fn capture(&self, options: CaptureOptions) {', //                11
      '        self.into_command(&pane)', //                                 12
      '    }', //                                                           13
      '    fn into_command(&self, pane: &str) {', //                         14
      '        captureoptions.into_command(pane)', //                        15
      '    }', //                                                           16
      '}', //                                                               17
    ].join('\n')
    const sources = await sourcesOf('rust', 'pane.rs', rust, ['run'], ['list-panes'])
    const audited = (evidence: string[]) => auditEvidence({
      port: 'rs', revision: 'r1', uses: [{ symbol: 'pane.Pane.split', command: 'list-panes', scope: null, evidence }] as never, claimFor: () => undefined,
      spellings: (command: string) => [command], sourcesAt: () => sources as never,
    } as never)
    // `Pane.split` calls an `into_command`, but on `options`, which is not the one in `CaptureOptions` that sends.
    expect(audited(['pane.rs:4', 'pane.rs:9']).join('\n')).toMatch(/pane.rs:9 is not a call of CaptureOptions.into_command, the function around pane.rs:4/)
    // The control: a call on a handle named for the type is that type's.
    expect(audited(['pane.rs:4', 'pane.rs:15'])).toEqual([])
  })

  it('reads a reviewed entry against its claim, line by line', async () => {
    const claim = (over: Record<string, unknown> = {}) => ({ evidence: [{ at: 'lib.py:2', has: ['fetch("list-panes"'] }, { at: 'lib.py:5', has: ['panes()'], in: 'S.search' }], ...over })
    const reviewed = (evidence = ['lib.py:2', 'lib.py:5']) => use({ reviewed: true, evidence })
    expect(await audit([reviewed()], { claimFor: () => claim() })).toEqual([])
    expect((await audit([reviewed()])).join('\n')).toMatch(/reviewed, but no claim of py holds it at r1/)
    expect((await audit([reviewed(['lib.py:2', 'lib.py:4'])], { claimFor: () => claim() })).join('\n')).toMatch(/cites lib.py:4 where its claim cites lib.py:5/)
    expect((await audit([reviewed()], { claimFor: () => claim({ evidence: [{ at: 'lib.py:2', has: ['"list-windows"'] }, { at: 'lib.py:5' }] }) })).join('\n')).toMatch(/does not contain "\\"list-windows\\""/)
  })

  it('refuses a reviewed first line that reports a failure and sends nothing', async () => {
    const claim = { evidence: [{ at: 'lib.py:8', has: ['Unsupported("list-panes")'] }] }
    expect((await audit([use({ reviewed: true, evidence: ['lib.py:8'] })], { claimFor: () => claim })).join('\n')).toMatch(/lib.py:8 reports a failure and sends nothing/)
    // The control: a line that holds a dispatch call sends, whatever else it does with the result.
    const sends = { evidence: [{ at: 'lib.py:2', has: ['fetch("list-panes"'] }] }
    expect(await audit([use({ reviewed: true, evidence: ['lib.py:2'] })], { claimFor: () => sends, dispatchFor: () => new Set(['fetch']) })).toEqual([])
  })

  it('refuses a reviewed first line that only binds the command in a function that goes on to send it, and not one that builds it for a caller', () => {
    const rust = [
      'async fn set(core: &Core) {',
      '    let mut command = scope.apply(Command::new("set-option"));',
      '    run(core, "set-option", command).await',
      '}',
      'fn channel_command() -> Command {',
      '    let command = Command::new("wait-for");',
      '    command',
      '}',
    ].join('\n')
    const functions = [
      { file: 'o.rs', name: 'set', start: 1, end: 4, sites: [], calls: new Map([['run', 3], ['apply', 2]]) },
      { file: 'o.rs', name: 'channel_command', start: 5, end: 8, sites: [], calls: new Map() },
    ]
    const rs = { read: () => rust, functions }
    const run = (line: number) => auditEvidence({
      port: 'rs', revision: 'r1', claimFor: () => ({ evidence: [] }), spellings: (command: string) => [command],
      sourcesAt: () => rs, uses: [{ symbol: 'o.set', command: 'set-option', scope: null, reviewed: true, evidence: [`o.rs:${line}`] }] as never,
      dispatchFor: () => new Set(['run']),
    } as never)
    expect(run(2).join('\n')).toMatch(/o.rs:2 only binds the command to a name in set, which goes on to send it/)
    expect(run(3)).toEqual([])
    expect(run(6)).toEqual([])
  })

  describe('a wrapper that stands on a core library', () => {
    // The wrapper cites the call, and the core lines are read at the revision the via names.
    const wrapper = { read: (path: string) => (path === 'w.fs' ? 'let panes server =\n    server.PanesAsync()' : undefined), functions: [{ file: 'w.fs', name: 'panes', start: 1, end: 2, sites: [], calls: new Map([['PanesAsync', 2]]), receivers: new Map() }] }
    const core = async (text: string) => sourcesOf('csharp', 'Core.cs', text, ['Fetch'], ['list-panes'])
    const lines = (body: string) => `class Server {\n    Task PanesAsync() =>\n        ${body};\n}`
    let at: Record<string, unknown> = {}
    beforeAll(async () => {
      at = { 'fs@r1': wrapper, 'cs@r1': await core(lines('Fetch("list-panes")')), 'cs@r2': await core(`${lines('Fetch()')}\n// list-panes lived here`) }
    })
    const forwarded = (revision: string | undefined, evidence = ['Core.cs:3']) => ({
      symbol: 'S.Server.newSession', command: 'list-panes', scope: 'session', evidence: ['w.fs:2'],
      via: { port: 'cs', symbol: 'Lib.Server.PanesAsync', revision, evidence },
    })
    const audits = (uses: unknown[]) => auditEvidence({
      port: 'fs', revision: 'r1', uses: uses as never, claimFor: () => undefined, spellings: (command: string) => [command],
      sourcesAt: (port: string, revision: string) => at[`${port}@${revision}`] as never,
    } as never)

    it('accepts core lines that read as cited at the revision the via names', () => {
      expect(audits([forwarded('r1')])).toEqual([])
    })

    it('refuses core lines read at a revision where they say something else, which is what citing the wrong revision does', () => {
      expect(audits([forwarded('r2')]).join('\n')).toMatch(/via cs Lib.Server.PanesAsync\): Core.cs:3 is not a call that sends list-panes/)
    })

    it('refuses a via that names no revision, a revision nothing was scanned at, and a wrapper line that does not call the core method', () => {
      expect(audits([forwarded(undefined)]).join('\n')).toMatch(/its via names no revision/)
      expect(audits([forwarded('r9')]).join('\n')).toMatch(/no scan of cs at r9/)
      expect(audits([{ ...forwarded('r1'), evidence: ['w.fs:1'] }]).join('\n')).toMatch(/w.fs:1 is not a call of PanesAsync/)
    })

    it('reads a generated wrapper by its generator lines and the annotation that makes it forward, and not as a call', () => {
      const generated = { read: (path: string) => (path === 'gen.kt' ? 'java.get(name)' : path === 'Core.java' ? '@Operation(Kind.READ)\npublic get() {}' : undefined), functions: [] }
      const run = (annotation: string) => auditEvidence({
        port: 'kt', revision: 'r1', generated: { evidence: ['gen.kt:1'] }, claimFor: () => undefined, spellings: (command: string) => [command],
        sourcesAt: (port: string) => (port === 'kt' ? generated : { read: () => 'x', functions: [] }) as never,
        uses: [{ symbol: 'K.get', command: 'show-environment', scope: null, evidence: ['gen.kt:1', annotation], via: { port: 'kt', symbol: 'J.get', revision: 'r1', evidence: ['Core.java:2'] } }] as never,
      } as never)
      expect(run('Core.java:1').filter((problem: string) => /Operation/.test(problem))).toEqual([])
      expect(run('Core.java:2').join('\n')).toMatch(/Core.java:2 is not the @Operation annotation of the core method/)
    })
  })
})

describe('reading Elixir by its text', () => {
  const commands = new Set(['list-panes', 'list-windows'])
  const elixir = (text: string, dispatch?: string[]) => scanElixir(text, { commands, known: commands, dispatch: dispatch && new Set(dispatch) }) as unknown as {
    functions: (Scanned & { nameLine: number; callList: { name: string; receiver?: string; line: number }[] })[]
    types: { name: string; start: number; end: number }[]
  }

  it('finds a function by its do block or its keyword body, with the module around it and the docs above it', () => {
    const text = [
      'defmodule Demo.Capture do',
      '  @moduledoc false',
      '',
      '  @doc """',
      '  Reads the panes.',
      '',
      '  A blank line inside the doc does not end it.',
      '  """',
      '  @spec fetch(term()) :: term()',
      '  def fetch(server) do',
      '    if server, do: rows(server, "list-panes", ["-a"])',
      '  end',
      '',
      '  defp rows(server, command, arguments),',
      '    do: read(server, command, arguments)',
      '',
      '  defp read(_, _, _), do: :ok',
      '',
      '  @doc "Alone."',
      '',
      '  def lone(x), do: x',
      'end',
      '',
    ].join('\n')
    const { functions, types } = elixir(text, ['rows'])
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(types).toEqual([{ name: 'Capture', start: 1, end: 22 }])
    // The API model puts a function at the line of its first doc, so the doc is part of the function.
    expect([byName.fetch.start, byName.fetch.nameLine, byName.fetch.end, byName.fetch.owner]).toEqual([4, 10, 12, 'Capture'])
    expect([byName.rows.start, byName.rows.end]).toEqual([14, 15])
    expect(byName.read).toMatchObject({ start: 17, end: 17 })
    // A doc with a blank line between it and the function belongs to nothing.
    expect(byName.lone).toMatchObject({ start: 21, nameLine: 21 })
    expect(byName.fetch.sites).toEqual([{ command: 'list-panes', line: 11, flags: 'a', dispatch: { line: 11, name: 'rows' } }])
    expect([...byName.rows.calls.keys()]).toEqual(['read'])
  })

  it('reads a call by the alias before its dot, and a command no declared call is handed as named and not sent', () => {
    const text = [
      'defmodule Demo.Server do',
      '  def snapshot(server), do: Capture.fetch(server)',
      '',
      '  def name(command) do',
      '    case command do',
      '      "list-panes" -> :panes',
      '      _ -> Command.new("list-windows", [])',
      '    end',
      '  end',
      'end',
      '',
    ].join('\n')
    const { functions } = elixir(text, ['run'])
    const byName = Object.fromEntries(functions.map((fn) => [fn.name, fn]))
    expect(byName.snapshot.callList).toEqual([{ name: 'fetch', receiver: 'capture', line: 2, calleeLine: 2 }])
    expect(byName.name.sites.map((site) => [site.command, (site as { dispatch?: unknown }).dispatch])).toEqual([['list-panes', null], ['list-windows', null]])
    expect((byName.name.sites[0] as { why?: string }).why).toMatch(/case label/)
  })

  it('steps over strings, interpolation, heredocs, sigils and comments, so a command in none of them is a send', () => {
    const text = [
      'defmodule Demo do',
      '  def one(x) do',
      '    # list-panes in a comment',
      '    note = "run list-panes #{inspect("list-windows")} now"',
      '    pattern = ~r/list-panes/',
      '    format = ~S"#{pid}"',
      '    run(x, "list-panes", ["-t", ?"])',
      '  end',
      '',
      '  def ready?(x), do: x',
      'end',
      '',
    ].join('\n')
    const { functions } = elixir(text, ['run'])
    const one = functions.find((fn) => fn.name === 'one')!
    expect(one.sites).toEqual([{ command: 'list-panes', line: 7, flags: 't', dispatch: { line: 7, name: 'run' } }])
    expect(functions.find((fn) => fn.name === 'ready?')).toMatchObject({ start: 10, end: 10 })
    expect(tokenizeElixir('~S"#{pid}"').map((token) => [token.t, token.v])).toEqual([['str', '#{pid}']])
    expect(tokenizeElixir('~r/x/i y').map((token) => token.t)).toEqual(['sigil', 'id'])
  })
})

describe('the ports whose source is read', () => {
  const unread = (slugs: string[], grammars: Record<string, string>) => slugs.filter((slug) => !grammars[slug])

  it('has a grammar for every port with an API model, so one added later is not scanned as empty', () => {
    const slugs = readdirSync(new URL('../src/data/api', import.meta.url)).filter((name) => /^[a-z]+\.json$/.test(name)).map((name) => name.replace(/\.json$/, ''))
    expect(slugs).toContain('elixir')
    expect(unread(slugs, GRAMMARS)).toEqual([])
    // The control: a port the table lacks is the one named.
    expect(unread([...slugs, 'newport'], GRAMMARS)).toEqual(['newport'])
  })

  it.each([...new Set(Object.values(GRAMMARS))])('has a reader behind the grammar %s, and not only a name for it', async (grammar) => {
    // The table names a grammar, and scanSource must dispatch it: a name with no reader failed in the loader, for a file that does not exist.
    expect(await scanSource({ grammar, text: '', commands: new Set(['list-panes']), known })).toMatchObject({ functions: [] })
  })

  it('refuses a grammar nothing reads, by name', async () => {
    await expect(scanSource({ grammar: 'nonesuch', text: '', commands: new Set(['list-panes']), known })).rejects.toThrow(/no reader for the grammar "nonesuch"/)
  })
})
