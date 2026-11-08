import { describe, expect, it } from 'vitest'
import { GRAMMARS, isLibrarySource, scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'
import { builtSites, callTargets, definitionsOf, deriveUsage } from '../../scripts/lib/tmux-usage-derive.mjs'
import { libraryScopes } from '../../scripts/lib/tmux-usage-scopes.mjs'
import scopeTable from '../src/data/tmux-usage/scopes.json'

const commands = new Set(['list-panes', 'list-windows'])
const fixture = (body: string) => `module Fixture where\n\nsend _ _ = pure ()\n\n${body}\n`
const scan = (body: string) => scanSource({ grammar: 'haskell', text: fixture(body), commands, known: commands, dispatch: new Set(['send']) })
const sent = (scanned: Awaited<ReturnType<typeof scan>>) => scanned.functions.flatMap((fn) =>
  fn.sites.filter((site) => site.dispatch && !site.builds).map((site) => ({ function: fn.name, command: site.command, flags: site.flags })))

describe('Haskell source usage', () => {
  it('registers a reader and limits library inputs to the Cabal source roots', () => {
    expect(GRAMMARS.haskell).toBe('haskell')
    expect(isLibrarySource('src/LibTmux/Id.hs', 'haskell')).toBe(true)
    expect(isLibrarySource('internal/LibTmux/Internal/Process.hs', 'haskell')).toBe(true)
    expect(isLibrarySource('test-support/Fixture.hs', 'haskell')).toBe(false)
    expect(isLibrarySource('examples/typed-values/Main.hs', 'haskell')).toBe(false)
  })

  it.each([
    'panes client = send client ["list-panes", "-a"]',
    'panes client = (send client) (["list-panes", "-a"])',
    'panes client = send client $ ["list-panes", "-a"]',
  ])('reads a demanded curried dispatch: %s', async (body) => {
    expect(sent(await scan(body))).toEqual([{ function: 'panes', command: 'list-panes', flags: 'a' }])
  })

  it('associates signatures and equations with one binding and preserves helper attribution', async () => {
    const source = fixture('panes :: Client -> IO Result\npanes client = helper client\n\nhelper 0 = send 0 ["list-panes", "-a"]\nhelper client = send client ["list-panes", "-a"]')
    const scanned = await scanSource({ grammar: 'haskell', text: source, commands, known: commands, dispatch: new Set(['send']) })
    expect(scanned.functions.filter((fn) => fn.name === 'helper')).toHaveLength(1)
    const functions = scanned.functions.map((fn) => ({ ...fn, file: 'src/Fixture.hs' }))
    const symbols = [{ id: 'Fixture.panes', name: 'panes', parentName: 'Fixture', file: 'src/Fixture.hs', line: 5 }]
    expect([...definitionsOf(functions, symbols).values()].flat()).toEqual(symbols)
    const result = deriveUsage({ command: 'list-panes', functions, symbols })
    expect(result.entries.map((entry) => entry.symbol)).toEqual(['Fixture.panes'])
    expect(result.entries[0]!.evidence).toContain('src/Fixture.hs:6')
  })

  it('preserves a literal argument builder passed to the dispatcher', async () => {
    const scanned = await scan('argv = ["list-panes", "-a"]\npanes client = send client argv')
    const functions = scanned.functions.map((fn) => ({ ...fn, file: 'src/Fixture.hs' }))
    const caller = functions.find((fn) => fn.name === 'panes')!
    const sites = builtSites(functions).get(caller)!
    expect(sites).toMatchObject([{ command: 'list-panes', flags: 'a', via: { name: 'argv', call: 6 } }])
  })

  it('follows demanded local action aliases and keeps independent flags apart', async () => {
    const source = 'panes client =\n  let action = send client ["list-panes", "-a"]\n  in action\n\nwindows client = do\n  send client ["list-windows", "-s"]\n  send client ["list-panes", "-t", "%1"]'
    const sites = sent(await scan(source))
    expect(sites).toContainEqual({ function: 'action', command: 'list-panes', flags: 'a' })
    expect(sites).toContainEqual({ function: 'windows', command: 'list-windows', flags: 's' })
    expect(sites).toContainEqual({ function: 'windows', command: 'list-panes', flags: 't' })
  })

  it.each([
    'panes client = let unused = send client ["list-panes", "-a"] in pure ()',
    'panes client = pure (send client ["list-panes", "-a"])',
    'panes client = [send client ["list-panes", "-a"]]',
    'panes client = pure () where unused = send client ["list-panes", "-a"]',
    'panes client = error "list-panes"',
    'panes client = "list-panes" == "list-windows"',
    '-- send client ["list-panes", "-a"]\n{- outer {- send client ["list-windows"] -} -}\npanes client = pure ()',
  ])('keeps values, diagnostics and unused actions out of sends: %s', async (body) => {
    expect(sent(await scan(body))).toEqual([])
  })

  it('distinguishes a local shadow from the registered module dispatcher', async () => {
    const scanned = await scan('panes client = let send _ _ = pure () in send client ["list-panes", "-a"]')
    expect(sent(scanned)).toEqual([])
  })

  it('uses exact lexical identities before the generic unique-name shortcut', () => {
    const caller = { calls: new Map([['helper', 7]]), receivers: new Map(), callList: [{ name: 'helper', line: 7, bindingId: 'local-helper' }] }
    const foreign = { name: 'helper', file: 'src/Other.hs', bindingId: 'other-helper' }
    expect(callTargets(caller, foreign, [foreign])).toBe(false)
    expect(callTargets(caller, { ...foreign, bindingId: 'local-helper' }, [foreign])).toBe(true)
  })

  it('rejects a send beyond the qualified helper depth instead of silently dropping it', async () => {
    const scanned = await scan('operation client = action where\n  action = helper\n  helper = send client ["list-panes", "-a"]')
    const functions = scanned.functions.map((fn) => ({ ...fn, file: 'src/Fixture.hs' }))
    const symbols = [{ id: 'Fixture.operation', name: 'operation', parentName: 'Fixture', file: 'src/Fixture.hs', line: 5 }]
    expect(() => deriveUsage({ command: 'list-panes', functions, symbols })).toThrow(/source usage coverage/i)
  })

  it('cites the call of the resolved lexical binding when a name is reused', async () => {
    const scanned = await scan('operation client = do\n  let helper = pure ()\n  helper\n  let helper = send client ["list-panes", "-a"]\n  helper')
    const functions = scanned.functions.map((fn) => ({ ...fn, file: 'src/Fixture.hs' }))
    const symbols = [{ id: 'Fixture.operation', name: 'operation', parentName: 'Fixture', file: 'src/Fixture.hs', line: 5 }]
    const result = deriveUsage({ command: 'list-panes', functions, symbols })
    expect(result.entries[0]!.evidence).toEqual(['src/Fixture.hs:8', 'src/Fixture.hs:9'])
  })

  it.each([
    'operation client = send client ["list-panes"]',
    'operation client = helper client\nhelper client = do\n  send client ["list-panes", "-a"]\n  send client ["list-panes", "-s"]',
    'helper client = send client ["list-panes", "-a"]\n' + Array.from({ length: 5 }, (_, i) => `operation${i} client = helper client`).join('\n'),
  ])('rejects a send the scope or sharing limits would discard: %s', async (body) => {
    const scanned = await scan(body)
    const functions = scanned.functions.map((fn) => ({ ...fn, file: 'src/Fixture.hs' }))
    const symbols = functions.filter((fn) => fn.name.startsWith('operation')).map((fn) =>
      ({ id: `Fixture.${fn.name}`, name: fn.name, parentName: 'Fixture', file: fn.file, line: fn.nameLine }))
    const spec = { scopes: libraryScopes(scopeTable.commands['list-panes']) }
    expect(() => deriveUsage({ command: 'list-panes', spec, functions, symbols })).toThrow(/source usage coverage/i)
  })

  it.each([
    'panes send client = send client ["list-panes", "-a"]',
    'panes client = External.pure ["list-panes", "-a"]',
    'panes client = External.forward ["list-panes", "-a"]',
    'helper client = send client ["list-panes", "-a"]\npanes client = traverse helper [client]',
    'forward client args = send client args\npanes client = forward client ["list-panes", "-a"]',
    'panes client = do\n  send <- pure handler\n  send client ["list-panes", "-a"]',
    'panes client = send client ["\\x6cist-panes", "-a"]',
    '(panes, other) = (send 0 ["list-panes", "-a"], pure ())',
    'panes client = let (action, other) = (send client ["list-panes", "-a"], pure ()) in action',
    'panes client argv = send client argv',
    'panes client = send client ["list-panes", "-F", "-a"]',
    'panes client = send client ["list-panes -a"]',
    'panes client = send client ["list-panes", "-Fa"]',
    'panes client = send client ["list-panes", "-F", "--", "-a"]',
    'panes client = send client ["list-panes", "-a", ";", "list-windows"]',
    'panes client = send client ["list-panes", "-a", "%1;", "list-windows"]',
    'panes client = Custom.do\n  send client ["list-panes", "-a"]\n  pure ()',
    'panes client = Custom.do\n  let action = send client ["list-panes", "-a"]\n  action',
    '(operation, other) = (\\args -> send 0 args, ())',
    'panes client = External.run $ do\n  let action = send client ["list-panes", "-a"]\n  action',
    'panes client = case client of\n  _ -> action\n    where action = send client ["list-panes", "-a"]',
    'panes client = (\\action -> action) (let action = send client ["list-panes", "-a"] in action)',
    'panes client | External.guard (send client ["list-panes", "-a"]) = pure ()',
    'panes client = [action|send client ["list-panes", "-a"]|]',
    '$(makeAction "list-panes")',
    '#if FLAG\npanes client = send client ["list-panes", "-a"]\n#else\npanes client = pure ()\n#endif',
    'panes =',
  ])('fails explicitly when source usage cannot be established: %s', async (body) => {
    await expect(scan(body)).rejects.toThrow(/Haskell.*coverage/i)
  })

  it('does not assume a replacement Prelude keeps the standard pure operation', async () => {
    const source = '{-# LANGUAGE NoImplicitPrelude #-}\nmodule Fixture where\nimport Custom (pure)\nsend _ _ = pure ()\npanes client = pure (send client ["list-panes", "-a"])\n'
    await expect(scanSource({ grammar: 'haskell', text: source, commands, known: commands, dispatch: new Set(['send']) }))
      .rejects.toThrow(/Haskell.*coverage/i)
  })

  it('does not assume rebindable do executes every action', async () => {
    const source = '{-# LANGUAGE RebindableSyntax #-}\n' + fixture('(>>) _ y = y\npanes client = do\n  send client ["list-panes", "-a"]\n  pure ()')
    await expect(scanSource({ grammar: 'haskell', text: source, commands, known: commands, dispatch: new Set(['send']) }))
      .rejects.toThrow(/Haskell.*coverage/i)
  })
})
