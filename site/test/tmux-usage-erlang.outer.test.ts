import { describe, expect, it } from 'vitest'
import { GRAMMARS, isLibrarySource, scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'
import { callTargets, definitionsOf, deriveUsage } from '../../scripts/lib/tmux-usage-derive.mjs'
import { dispatcherProblems } from '../../scripts/lib/tmux-usage-dispatch.mjs'
import { auditEvidence } from '../../scripts/lib/tmux-usage-audit.mjs'

// Outer: runs the selected OTP 29 scanner in bounded subprocesses.

const known = new Set(['list-panes', 'list-windows', 'kill-pane'])
const scan = (text: string) => scanSource({
  grammar: 'erlang', text, commands: known, known, dispatch: new Set(['run/3']),
})

describe('Erlang tmux command source', () => {
  it('registers library source without tests or generated build copies', () => {
    expect(GRAMMARS.erlang).toBe('erlang')
    expect(isLibrarySource('apps/core/src/panes.erl', 'erlang')).toBe(true)
    for (const path of ['_build/default/lib/core/src/panes.erl', 'src/panes_tests.erl', 'src/panes_SUITE.erl', 'test/panes.erl', 'property/prop_panes.erl']) {
      expect(isLibrarySource(path, 'erlang')).toBe(false)
    }
  })

  it('keeps native arity and clauses while skipping docs, attributes and comments', async () => {
    const { functions, types, orphans } = await scan([
      '-module(tmux_demo).',
      '-moduledoc """',
      'fake() -> run(s, <<"kill-pane">>, []).',
      '""".',
      '-export([panes/1, panes/2]).',
      '-record #row{command = <<"kill-pane">>}.',
      '-spec panes(term()) -> term().',
      'panes(Server) -> panes(Server, []).',
      'panes(Server, []) ->',
      '    % run(Server, <<"kill-pane">>, []).',
      '    run(Server, <<"list-panes">>, [<<"-a">>]);',
      'panes(Server, Options) -> run(Server, <<"list-panes">>, Options).',
    ].join('\n'))
    expect(types).toEqual([{ name: 'tmux_demo', start: 1, end: 12 }])
    expect(orphans).toEqual([])
    expect(functions.map((fn) => [fn.owner, fn.name, fn.start, fn.nameLine, fn.end])).toEqual([
      ['tmux_demo', 'panes/1', 8, 8, 8], ['tmux_demo', 'panes/2', 9, 9, 12],
    ])
    expect(functions[1].sites).toEqual([
      { command: 'list-panes', line: 11, flags: 'a', dispatch: { line: 11, name: 'run/3' } },
      { command: 'list-panes', line: 12, flags: '', dispatch: { line: 12, name: 'run/3' } },
    ])
    expect(functions[0].callList).toContainEqual({ name: 'panes/2', line: 8, calleeLine: 8 })
    const symbols = [{ id: 'panes', name: 'panes/2', parentName: 'tmux_demo', file: 'demo.erl', line: 9 }]
    expect([...definitionsOf(functions.map((fn) => ({ ...fn, file: 'demo.erl' })), symbols).values()]).toEqual([symbols])
  })

  it('counts nested argument syntax and resolves local and remote calls by module', async () => {
    const { functions } = await scan([
      "-module('demo.mod').",
      "read(S) -> tmux_target:run(S, <<\"list-panes\">>, [<<\"-t\">>, <<\"%1\">>]),",
      "    helper(fun(A, B) -> #{id => {A, B}} end, <<1, 2>>, #tmux_model:pane{id = <<\"%1\">>}).",
      "helper(F, B, P) -> {F, B, P}.",
    ].join('\n'))
    expect(functions.map((fn) => fn.name)).toEqual(['read/1', 'helper/3'])
    expect(functions[0].callList).toEqual([
      { name: 'run/3', receiver: 'tmux_target', line: 2, calleeLine: 2 },
      { name: 'helper/3', line: 3, calleeLine: 3 },
    ])
    expect(functions[0].sites[0].flags).toBe('t')
    expect(callTargets(functions[0], functions[1], [functions[1], { ...functions[1], owner: 'other' }])).toBe(true)
  })

  it('does not turn a comparison, case label or command builder into a send', async () => {
    const { functions } = await scan([
      '-module(demo).',
      'read(S, C) when C =:= <<"list-panes">> ->',
      '    case C of <<"list-windows">> -> raw(<<"list-panes">>, [<<"-a">>]);',
      '        _ -> run(S, <<"list-panes">>, [<<"-t">>, C]) end.',
    ].join('\n'))
    const sites = functions[0].sites
    expect(sites.map((site) => site.dispatch)).toEqual([null, null, null, { line: 4, name: 'run/3' }])
    expect(sites.at(-1)?.flags).toBe('t')
  })

  it('keeps strings, quoted atoms and character escapes out of syntax', async () => {
    const { functions } = await scan([
      "-module(demo).",
      "'quoted.name'(S) ->",
      "    Chars = [$%, $., $;, $\\\", $\\x{2E}],",
      "    Text = ~\"run(S, \\\"kill-pane\\\", [])\",",
      "    run(S, <<\"list-\" \"panes\">>, [<<\"-a\">>]),",
      "    {Chars, Text}.",
    ].join('\n'))
    expect(functions.map((fn) => [fn.name, fn.end])).toEqual([["'quoted.name'/1", 6]])
    expect(functions[0].sites).toEqual([
      { command: 'list-panes', line: 5, flags: 'a', dispatch: { line: 5, name: 'run/3' } },
    ])
  })

  it('does not lend flags between calls or send nested predicates and callbacks', async () => {
    const { functions } = await scan([
      '-module(demo).',
      'read(S, C) -> case C of',
      '    a -> run(S, <<"list-panes">>, [<<"-a">>]);',
      '    b -> run(S, <<"list-panes">>, [<<"-t">>]);',
      '    c -> run(S, choose(<<"list-panes">>), []);',
      '    d -> run(S, fun() -> <<"list-panes">> end, []);',
      '    e -> run(S, C =:= <<"list-panes">>, []) end.',
    ].join('\n'))
    expect(functions[0].sites.map((site) => [site.flags, site.dispatch !== null])).toEqual([
      ['a', true], ['t', true], ['', false], ['', false], ['', false],
    ])
  })

  it('honors declared builders and diagnostic argument labels', async () => {
    const { functions } = await scanSource({
      grammar: 'erlang', known, commands: known, dispatch: new Set(['run/3']),
      builders: new Set(['raw/2']), labels: new Map([['run/3', new Set([2])]]),
      text: '-module(demo).\nread(S) -> run(S, raw(<<"list-panes">>, [<<"-a">>]), <<"list-windows">>).',
    })
    expect(functions[0].sites.map((site) => [site.command, site.dispatch !== null])).toEqual([
      ['list-panes', true], ['list-windows', false],
    ])
  })

  it('does not attribute another module\'s call to a sole same-named helper', async () => {
    const local = await scan('-module(demo).\nread() -> other:helper().\nhelper() -> ok.')
    expect(callTargets(local.functions[0], local.functions[1], [local.functions[1]])).toBe(false)
    const remote = await scan('-module(other).\nhelper() -> ok.')
    expect(callTargets(local.functions[0], remote.functions[0], [remote.functions[0]])).toBe(true)
  })

  it('excludes deferred fun bodies and refuses unresolved declaration identities', async () => {
    const deferred = await scan('-module(demo).\ncallback(S) -> fun() -> run(S, <<"kill-pane">>, []) end.')
    expect(deferred.functions[0].sites[0].dispatch).toBe(null)
    expect(deferred.functions[0].callList).toEqual([])
    await expect(scan('-define(MOD,demo).\n-module(?MOD).\nread()->other:helper().\nhelper()->ok.')).rejects.toThrow('module identity is unresolved')
    await expect(scan('-module(demo).\n-define(NAME, read).\n?NAME(S)->run(S, <<"kill-pane">>, []).')).rejects.toThrow('function head is unresolved')
  })

  it('uses native sigils, triple strings and canonical atom spellings', async () => {
    const { functions } = await scan([
      '-module(demo).',
      '-doc ~s"""',
      '"',
      'fake(S)->run(S, <<"kill-pane">>, []).',
      '"',
      '""".',
      "'quoted.name'(S) -> run(S, ~\"list-\\x70anes\", []).",
      'café(S) -> run(S, <<"""',
      'list-panes',
      '""">>, []).',
    ].join('\n'))
    expect(functions.map((fn) => fn.name)).toEqual(["'quoted.name'/1", 'café/1'])
    expect(functions.flatMap((fn) => fn.sites).map((site) => site.command)).toEqual(['list-panes', 'list-panes'])
    const symbols = [{ id: 'quoted', name: "'quoted.name'/1", file: 'demo.erl', line: 7 }]
    expect([...definitionsOf(functions.map((fn) => ({ ...fn, file: 'demo.erl' })), symbols).values()]).toEqual([symbols])
  })

  it('resolves static import attributes and consumes flag operands', async () => {
    const local = await scan('-module(demo).\n-import(other,[helper/0]).\nread()->helper().')
    const remote = await scan('-module(other).\nhelper()->ok.')
    expect(callTargets(local.functions[0], remote.functions[0], [remote.functions[0]])).toBe(true)
    const { functions } = await scan([
      '-module(demo).',
      'read(S) -> run(S, <<"list-panes">>, [<<"-F">>, <<"-a">>]),',
      '    run(S, <<"list-panes">>, [choose(<<"-a">>)]),',
      '    run(S, <<"list-panes">>, [<<"-t">>, target(), <<"-a">>]),',
      '    run(S, <<"list-panes">>, [<<"--">>, <<"-a">>]).',
    ].join('\n'))
    expect(functions[0].sites.map((site) => site.flags)).toEqual(['F', '', 'at', ''])
  })

  it('does not credit computed command values or uncertain argv structure', async () => {
    const { functions } = await scan([
      '-module(demo).',
      'read(S, X) -> run(S, <<"list-panes", X/binary>>, []),',
      '    run(S, #{command => <<"list-panes">>}, []),',
      '    run(S, {<<"list-panes">>, X}, []),',
      '    run(S, <<"list-panes">>, [<<"-F">>] ++ [<<"-a">>]),',
      '    run(S, <<"list-panes">>, [<<"-F">> | [<<"-a">>]]),',
      '    run(S, <<"list-panes">>, [<<"-t">>, X | X]).',
    ].join('\n'))
    expect(functions[0].sites.slice(0, 3).map((site) => site.dispatch)).toEqual([null, null, null])
    expect(functions[0].sites.slice(3).map((site) => site.flags)).toEqual(['', '', ''])
    await expect(scan('-module(demo).\nread(S)->run(S, <<"list-panes">>, [])')).rejects.toThrow('unterminated Erlang form')
  })

  it('keeps punctuation atoms out of call arity', async () => {
    const { functions } = await scan("-module(demo).\nread()->helper(',').\nhelper(X)->X.")
    expect(functions[0].callList).toEqual([{ name: 'helper/1', line: 2, calleeLine: 2 }])
  })

  it('cites the resolved local call rather than a later remote namesake', async () => {
    const text = [
      '-module(demo).',
      'read(S) ->',
      '    helper(S),',
      '    other:helper(S).',
      'helper(S) -> run(S, <<"kill-pane">>, []).',
    ].join('\n')
    const { functions } = await scan(text)
    const located = functions.map((fn) => ({ ...fn, file: 'demo.erl' }))
    const derived = deriveUsage({ command: 'kill-pane',
      functions: located,
      symbols: [{ id: 'read', name: 'read/1', file: 'demo.erl', line: 2 }],
    })
    expect(derived.entries[0].evidence).toEqual(['demo.erl:5', 'demo.erl:3'])
    const audit = (evidence: string[]) => auditEvidence({
      port: 'erlang', revision: 'fixture',
      uses: [{ ...derived.entries[0], evidence }], claimFor: () => undefined,
      sourcesAt: () => ({ read: () => text, functions: located }),
      spellings: (command: string) => [command],
    })
    expect(audit(derived.entries[0].evidence)).toEqual([])
    expect(audit(['demo.erl:5', 'demo.erl:4']).join('\n')).toMatch(/not a call/)
  })

  it('binds a declared dispatcher to its native module and arity', async () => {
    const { functions } = await scanSource({ grammar: 'erlang', commands: known, known,
      dispatch: new Set(['tmux_target:run/3']),
      text: [
        '-module(demo).',
        'good(S)->tmux_target:run(S, <<"list-panes">>, []).',
        'other(S)->not_tmux:run(S, <<"list-panes">>, []).',
        'local(S)->run(S, <<"list-panes">>, []).',
        'run(S, Name, Args)->{S,Name,Args}.',
      ].join('\n'),
    })
    expect(functions.slice(0, 3).map((fn) => fn.sites[0].dispatch)).toEqual([
      { line: 2, name: 'tmux_target:run/3' }, null, null,
    ])
  })

  it('does not confuse differently named calls in the same static module', async () => {
    const { functions } = await scan('-module(demo).\nread(S)->other:unrelated(S), other:helper(S).')
    const target = (await scan('-module(other).\nhelper(S)->S.')).functions[0]
    expect(callTargets(functions[0], target, [target], functions[0].callList![0])).toBe(false)
    expect(callTargets(functions[0], target, [target], functions[0].callList![1])).toBe(true)
  })

  it('keeps a literal command when a different argument computes its options', async () => {
    const { functions } = await scan('-module(demo).\nread(S, Args)->run(S, <<"kill-pane">>, Args ++ [<<"-t">>, <<"%1">>]).')
    expect(functions[0].sites[0].dispatch).toEqual({ line: 2, name: 'run/3' })
  })

  it('proves qualified dispatcher definitions from native heads rather than text mentions', async () => {
    const text = '-module(transport).\nraw(Name, Args) ->\n    {Name, Args}.\n'
    const { functions } = await scan(text)
    const input = {
      port: 'erlang', readSource: () => text,
      functions: functions.map((fn) => ({ ...fn, file: 'transport.erl' })),
    }
    const rule = { name: 'transport:raw/2', kind: 'builder', why: 'Builds a command value.' }
    const check = (name: string, line: number, has: string[]) => dispatcherProblems({
      ...input, dispatchers: [{ ...rule, name, evidence: [{ at: `transport.erl:${line}`, has }] }],
    })
    expect(check(rule.name, 2, ['raw(Name, Args)'])).toEqual([])
    expect(check('other:raw/2', 2, ['raw(Name, Args)']).join('\n')).toMatch(/no cited line shows/)
    expect(check(rule.name, 3, ['{Name, Args}']).join('\n')).toMatch(/no cited line shows/)
    expect(dispatcherProblems({ ...input, functions: undefined, dispatchers: [{
      ...rule, evidence: [{ at: 'transport.erl:2', has: [] }],
    }] }).join('\n')).toMatch(/no cited line shows/)
  })

  it('requires an executable native port call rather than transport-looking text', async () => {
    for (const [body, accepts] of [
      ['open_port({spawn_executable, Name}, Args)', true],
      ['erlang:open_port({spawn_executable, Name}, Args)', true],
      ['{Name, Args, <<"open_port({spawn_executable,">>}', false],
      ['fun()->open_port({spawn_executable, Name}, Args) end', false],
      ['other:open_port({spawn_executable, Name}, Args)', false],
      ['{open_port({spawn, Name}, Args), <<"open_port({spawn_executable,">>}', false],
      ['{erlang:open_port({spawn_executable =:= spawn, Name}, Args), <<"open_port({spawn_executable,">>}', false],
      ['open_port({spawn_executable, Name}, Args).\n-compile({no_auto_import,[open_port/2]}).\nopen_port(_,_) -> ok', false],
    ] as const) {
      const text = `-module(tmux_transport).\nraw(Name, Args) -> ${body}.\n`
      const { functions } = await scan(text)
      const file = 'apps/libtmux_erlang/src/tmux_transport.erl'
      const problems = dispatcherProblems({
        port: 'erlang', readSource: () => text,
        functions: functions.map((fn) => ({ ...fn, file })),
        dispatchers: [{ name: 'tmux_transport:raw/2', why: 'Starts the native process.',
          evidence: [{ at: `${file}:2`, has: ['raw(Name, Args)'] }] }],
      })
      expect(problems.length === 0, body).toBe(accepts)
    }
  })
})
