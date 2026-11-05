import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ownSockets, parseListings, readTmuxState, recordedState, runTmux, sandboxSockets, settledState, stopSandboxServers } from '../../scripts/lib/mcp-tmux-state.mjs'
import { UnsettledPaneError } from '../../scripts/lib/mcp-transcript-checks.mjs'
import { hasState, READ_ONLY_TOOLS, recordingStateProblems, stateProblems, type StatedStep, type TmuxPane, type TmuxState, type TmuxWindow } from '../src/lib/mcp-tmux-state'

const ONE = 'a1b2,80x24,0,0,0'
const TWO = 'b25f,80x24,0,0{40x24,0,0,0,39x24,41,0,1}'
const window = (over: Partial<TmuxWindow> = {}): TmuxWindow => ({ session: '$0', id: '@0', index: 0, name: 'sh', active: true, layout: ONE, ...over })
const pane = (over: Partial<TmuxPane> = {}): TmuxPane => ({ window: '@0', id: '%0', command: 'sh', left: 0, top: 0, width: 80, height: 24, active: true, ...over })
const oneState = (): TmuxState => ({ sessions: [{ id: '$0', name: 'checks' }], windows: [window()], panes: [pane()] })
const splitState = (): TmuxState => ({
  sessions: [{ id: '$0', name: 'checks' }],
  windows: [window({ layout: TWO })],
  panes: [pane({ width: 40, active: false }), pane({ id: '%1', left: 41, width: 39 })],
})
const EMPTY: TmuxState = { sessions: [], windows: [], panes: [] }

describe('a tmux state', () => {
  it('accepts a window of one pane, a split window, and an empty server', () => {
    for (const state of [oneState(), splitState(), EMPTY]) expect(stateProblems(state)).toEqual([])
  })

  it.each([
    ['a field the shape lacks', (state: any) => { delete state.panes[0].width }, /panes\[0\]\.width is missing/],
    ['a field of the wrong type', (state: any) => { state.windows[0].index = '0' }, /windows\[0\]\.index is a string, expected a number/],
    ['a field it does not define', (state: any) => { state.panes[0].title = 'host' }, /panes\[0\] has an unknown field title/],
    ['a list it does not define', (state: any) => { state.clients = [] }, /unknown field clients/],
    ['a list that is not a list', (state: any) => { state.panes = {} }, /panes is not a list/],
    ['an id used twice', (state: any) => { state.sessions.push({ id: '$0', name: 'again' }) }, /\$0 appears twice/],
    ['a window in no session', (state: any) => { state.windows[0].session = '$9' }, /window @0 is in session \$9/],
    ['a pane in no window', (state: any) => { state.panes[0].window = '@9' }, /pane %0 is in window @9/],
    ['a session without a window', (state: any) => { state.sessions.push({ id: '$1', name: 'empty' }) }, /session \$1 has no window/],
    ['a window without a pane', (state: any) => { state.panes = [] }, /window @0 has no pane/],
    ['two active windows', (state: any) => { state.windows.push(window({ id: '@1', index: 1 })); state.panes.push(pane({ window: '@1', id: '%1' })) }, /session \$0 must have exactly one active window/],
    ['two active panes', (state: any) => { state.panes[0].active = true }, /window @0 must have exactly one active pane/],
    ['a layout that is not tmux\'s', (state: any) => { state.windows[0].layout = 'tiled' }, /layout is not one tmux reports/],
    ['a layout that names other panes', (state: any) => { state.windows[0].layout = 'a1b2,80x24,0,0,7' }, /layout names %7, its panes are %0/],
    ['a pane whose rectangle is not the layout\'s', (state: any) => { state.panes[1].left = 40 }, /pane %1 is 39x24 at 40,0, its window's layout puts it at 39x24 at 41,0/],
  ])('refuses %s', (_name, damage, message) => {
    const state = splitState()
    damage(state)
    expect(stateProblems(state).join('\n')).toMatch(message)
  })

  it('reads either spelling of the layout tmux reports', () => {
    const json = '{"V":2,"L":{"t":"h","w":80,"h":24,"x":0,"y":0,"c":[{"t":"p","w":40,"h":24,"x":0,"y":0,"I":"%0"},{"t":"p","w":39,"h":24,"x":41,"y":0,"I":"%1"}]}}'
    const state = splitState()
    state.windows[0]!.layout = json
    expect(stateProblems(state)).toEqual([])
  })
})

describe('the states of a recording', () => {
  type Step = StatedStep & { tmux?: TmuxState }
  const created: Step = { tool: 'create_session', arguments: { name: 'checks' }, content: [], structuredContent: { paneId: '%0', windowId: '@0', session: { id: '$0' } }, tmux: oneState() }
  const split: Step = { tool: 'split_window', arguments: { paneId: '%0' }, content: [], structuredContent: { paneId: '%1' }, tmux: splitState() }
  const listed: Step = { tool: 'list_panes', arguments: { session: 'checks' }, content: [], structuredContent: { panes: [{ id: '%0' }, { id: '%1' }] }, tmux: splitState() }
  const killed: Step = { tool: 'kill_session', arguments: { session: '$0' }, content: [], structuredContent: { killed: '$0' }, tmux: EMPTY }
  const recording = (steps: Step[] = [created, split, listed, killed]) => ({ tmuxBefore: EMPTY as unknown, steps })

  it('passes when each state follows from its call, and a recording with no state at all is left to its results', () => {
    expect(recordingStateProblems(recording())).toEqual([])
    expect(hasState(recording())).toBe(true)
    const plain = { steps: [{ tool: 'list_panes', arguments: {}, content: [] }] }
    expect(hasState(plain)).toBe(false)
    expect(recordingStateProblems(plain)).toEqual([])
  })

  it('refuses a missing start, a missing step state, and a state tmux cannot be in', () => {
    expect(recordingStateProblems({ steps: recording().steps }).join('\n')).toMatch(/the state before the first call is missing/)
    const missing = recording([created, { ...split, tmux: undefined }, listed, killed])
    expect(recordingStateProblems(missing).join('\n')).toMatch(/after step 2 \(split_window\): the state is missing/)
    const broken = splitState()
    broken.panes[1]!.window = '@9'
    expect(recordingStateProblems(recording([created, { ...split, tmux: broken }, listed, killed])).join('\n')).toMatch(/after step 2 \(split_window\): pane %1 is in window @9/)
  })

  it('refuses a state read a step late, which is what the preview showed before it drew tmux itself', () => {
    const late = recording([created, { ...split, tmux: oneState() }, listed, killed])
    expect(recordingStateProblems(late).join('\n')).toMatch(/after step 2 \(split_window\): the result returns %1, which tmux does not have after the call/)
  })

  it('refuses a call that names an id tmux did not have, which is a state from another server', () => {
    const other = recording([created, { ...split, arguments: { paneId: '%5' } }, listed, killed])
    expect(recordingStateProblems(other).join('\n')).toMatch(/after step 2 \(split_window\): the call names %5, which tmux did not have before it/)
  })

  it('lets a removal return the id it removed', () => {
    expect(recordingStateProblems(recording()), 'kill_session returns $0, which is gone').toEqual([])
    const renamed = recording([created, split, listed, { ...killed, tool: 'close_session' }])
    expect(recordingStateProblems(renamed).join('\n'), 'only a tool named kill* is exempt').toMatch(/the result returns \$0/)
  })

  it('names, outside the code that reads it, the tools that only read: dropping one from the set loses its check', () => {
    expect([...READ_ONLY_TOOLS].sort()).toEqual(['capture_pane', 'get_tmux_variables', 'list_panes', 'list_sessions', 'list_windows', 'tmux_capabilities', 'tmux_snapshot'])
  })

  it('refuses a read that changed tmux, and has a control: a call that writes may', () => {
    expect([...READ_ONLY_TOOLS]).toContain('list_panes')
    const changed = recording([created, split, { ...listed, tmux: oneState() }, killed])
    expect(recordingStateProblems(changed).join('\n')).toMatch(/after step 3 \(list_panes\): list_panes only reads, yet tmux changed/)
    expect(recordingStateProblems(recording([created, { ...split, tool: 'resize_pane' }, listed, killed]))).toEqual([])
  })
})

describe('reading a tmux server', () => {
  const listing = [
    'S|$0|checks',
    'W|$0|@0|0|sh|1|b25f,80x24,0,0{40x24,0,0,0,39x24,41,0,1}|1',
    'P|@0|%0|sh|0|0|40|24|0',
    'P|@0|%1|sh|41|0|39|24|1',
    '',
  ].join('\n')

  it('parses the three listings into a state tmux can be in', () => {
    const state = parseListings(listing)
    expect(state).toEqual({
      sessions: [{ id: '$0', name: 'checks' }],
      windows: [{ session: '$0', id: '@0', index: 0, name: 'sh', active: true, layout: 'b25f,80x24,0,0{40x24,0,0,0,39x24,41,0,1}', automaticName: true }],
      panes: [pane({ width: 40, active: false }), pane({ id: '%1', left: 41, width: 39 })],
    })
    expect(stateProblems(recordedState(state))).toEqual([])
  })

  it.each([
    ['a name that holds the separator', 'S|$0|a|b', /expected 2 fields, found 3/],
    ['a line of another listing', 'X|$0|a', /unknown listing/],
    ['a count that is not digits', 'W|$0|@0|one|sh|1|layout|1', /"one" is not a number/],
    ['a flag that is not 0 or 1', 'W|$0|@0|0|sh|yes|layout|1', /"yes" is not a flag/],
    ['a window listed without whether tmux still names it', 'W|$0|@0|0|sh|1|layout', /expected 7 fields, found 6/],
  ])('refuses %s rather than guess', (_name, line, message) => {
    expect(() => parseListings(line)).toThrow(message)
  })

  const sandbox = '/tmp/sandbox'
  const socket = `${sandbox}/tmux-1000/transcript`
  /** The paths here are not on disk, so each stands for itself. */
  const same = (path: string) => path
  const answers = (extra: Record<string, string | Error> = {}) => (_socket: string, args: string[]) => {
    const key = args.length === 3 ? 'sessions' : 'list'
    const answer = extra[key] ?? { sessions: '$0\n', list: listing }[key]
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }

  it('reads the one server of the sandbox', () => {
    const state = readTmuxState({ sandbox, run: answers(), sockets: () => [socket], realpath: same })()
    expect(state.panes.map((item: any) => [item.id, item.command, item.width])).toEqual([['%0', 'sh', 40], ['%1', 'sh', 39]])
    expect(stateProblems(state), 'the note for the settle check is not part of a state').toEqual(['windows[0] has an unknown field automaticName'])
    expect(stateProblems(recordedState(state))).toEqual([])
  })

  it('treats a sandbox with no server, and a server that has gone, as a tmux with nothing in it', () => {
    expect(readTmuxState({ sandbox, run: answers(), sockets: () => [], realpath: same })()).toEqual(EMPTY)
    // tmux answers the window and pane listings of a server with no session with an error, so they must not be asked.
    const noSession = answers({ sessions: '\n', list: new Error('no current target') })
    expect(readTmuxState({ sandbox, run: noSession, sockets: () => [socket], realpath: same })()).toEqual(EMPTY)
    const gone = Object.assign(new Error(`no server running on ${socket}`), { noServer: true })
    expect(readTmuxState({ sandbox, run: answers({ list: gone }), sockets: () => [socket], realpath: same })()).toEqual(EMPTY)
  })

  it('fails when tmux cannot be read for any other reason, so a recording with a hole in it is never written', () => {
    expect(() => readTmuxState({ sandbox, run: answers({ list: new Error('protocol version mismatch (client 8, server 7)') }), sockets: () => [socket], realpath: same })()).toThrow(/tmux could not be read: protocol version mismatch/)
    expect(() => readTmuxState({ sandbox, run: answers({ sessions: new Error('lost connection') }), sockets: () => [socket], realpath: same })()).toThrow(/tmux could not be read: lost connection/)
  })

  it('refuses a socket outside the sandbox, so it never reads the reader\'s own tmux, and a sandbox with two servers', () => {
    const run = () => { throw new Error('tmux must not be run') }
    expect(() => readTmuxState({ sandbox, run, sockets: () => ['/tmp/tmux-1000/default'], realpath: same })()).toThrow(/outside the sandbox/)
    expect(() => readTmuxState({ sandbox, run, sockets: () => [`${sandbox}-other/tmux-1000/default`], realpath: same })()).toThrow(/outside the sandbox/)
    expect(() => readTmuxState({ sandbox, run, sockets: () => [socket, `${sandbox}/tmux-1000/default`], realpath: same })()).toThrow(/more than one tmux server \(transcript, default\)/)
  })

  it('reads a socket through the path it resolves to, and refuses one whose path resolves outside the sandbox even though its name is inside', () => {
    const resolved = (path: string) => (path === socket ? `${sandbox}/real/transcript` : path === sandbox ? sandbox : '/home/reader/tmux-1000/default')
    const seen: string[] = []
    const run = (at: string, args: string[]) => { seen.push(at); return answers()(at, args) }
    readTmuxState({ sandbox, run, sockets: () => [socket], realpath: resolved })()
    expect(new Set(seen), 'tmux is run against the resolved path').toEqual(new Set([`${sandbox}/real/transcript`]))
    const link = `${sandbox}/tmux-1000/default`
    expect(() => readTmuxState({ sandbox, run: () => { throw new Error('tmux must not be run') }, sockets: () => [link], realpath: resolved })()).toThrow(/default \(\/home\/reader\/tmux-1000\/default\) is outside the sandbox/)
    expect(() => readTmuxState({ sandbox, run, sockets: () => [socket], realpath: (path) => { if (path === socket) throw new Error('ELOOP'); return path } })()).toThrow(/cannot be resolved \(ELOOP\)/)
  })

  describe('on a real file system', () => {
    const uid = process.getuid?.() ?? ''
    const make = async () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-links-')))
      const sandbox = join(base, 'sandbox')
      const outside = join(base, 'outside')
      mkdirSync(join(sandbox, `tmux-${uid}`), { recursive: true })
      mkdirSync(outside)
      // A server of the reader's, standing in: a real socket, which a link can lead to.
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(join(outside, 'default'), resolve))
      return { base, sandbox, outside, server }
    }
    const refused = () => { throw new Error('tmux must not be run') }

    it('lists a link to a socket outside the sandbox and refuses it, instead of following it or leaving it unseen', async () => {
      const { base, sandbox, outside, server } = await make()
      try {
        symlinkSync(join(outside, 'default'), join(sandbox, `tmux-${uid}`, 'default'))
        expect(sandboxSockets(sandbox), 'the link is listed').toEqual([join(sandbox, `tmux-${uid}`, 'default')])
        expect(() => readTmuxState({ sandbox, run: refused })()).toThrow(/outside the sandbox/)
        expect(ownSockets(sandbox)).toEqual({ own: [], foreign: [`${join(sandbox, `tmux-${uid}`, 'default')} (${join(outside, 'default')})`] })
      } finally {
        server.close()
        rmSync(base, { recursive: true, force: true })
      }
    })

    it('refuses a tmux directory that is itself a link out of the sandbox', async () => {
      const { base, sandbox, outside, server } = await make()
      try {
        rmSync(join(sandbox, `tmux-${uid}`), { recursive: true })
        symlinkSync(outside, join(sandbox, `tmux-${uid}`))
        expect(() => readTmuxState({ sandbox, run: refused })()).toThrow(/outside the sandbox/)
      } finally {
        server.close()
        rmSync(base, { recursive: true, force: true })
      }
    })

    it('lists the two names of a hard-linked socket as one server', async () => {
      const { base, sandbox, server } = await make()
      const inside = createServer()
      try {
        mkdirSync(join(sandbox, 'tmp', 'first'), { recursive: true })
        mkdirSync(join(sandbox, 'tmp', 'second'))
        await new Promise<void>((resolve) => inside.listen(join(sandbox, 'tmp', 'first', 'socket'), resolve))
        linkSync(join(sandbox, 'tmp', 'first', 'socket'), join(sandbox, 'tmp', 'second', 'socket'))
        expect(sandboxSockets(sandbox)).toHaveLength(1)
        expect(readTmuxState({ sandbox, run: () => '' })()).toEqual(EMPTY)
      } finally {
        inside.close()
        server.close()
        rmSync(base, { recursive: true, force: true })
      }
    })

    it('reads a socket of the sandbox, and a link that stays inside it, by the real path', async () => {
      const { base, sandbox, server } = await make()
      const inside = createServer()
      try {
        await new Promise<void>((resolve) => inside.listen(join(sandbox, 'real'), resolve))
        symlinkSync(join(sandbox, 'real'), join(sandbox, `tmux-${uid}`, 'transcript'))
        expect(ownSockets(sandbox)).toEqual({ own: [join(sandbox, 'real')], foreign: [] })
        const seen: string[] = []
        expect(readTmuxState({ sandbox, run: (at) => { seen.push(at); return '' } })()).toEqual(EMPTY)
        expect(seen).toEqual([join(sandbox, 'real')])
      } finally {
        inside.close()
        server.close()
        rmSync(base, { recursive: true, force: true })
      }
    })

    it('stops the servers of the sandbox and leaves a link to another server alone', async () => {
      const { base, sandbox, outside, server } = await make()
      const inside = createServer()
      try {
        await new Promise<void>((resolve) => inside.listen(join(sandbox, 'real'), resolve))
        symlinkSync(join(sandbox, 'real'), join(sandbox, `tmux-${uid}`, 'transcript'))
        symlinkSync(join(outside, 'default'), join(sandbox, `tmux-${uid}`, 'default'))
        const stopped: string[] = []
        stopSandboxServers(sandbox, { run: (at: string, args: string[]) => { stopped.push(`${at} ${args.join(' ')}`); return '' } })
        expect(stopped).toEqual([`${join(sandbox, 'real')} kill-server`])
      } finally {
        inside.close()
        server.close()
        rmSync(base, { recursive: true, force: true })
      }
    })
  })
})

describe('a tmux that does not answer', () => {
  const available = spawnSync('sh', ['-c', 'exit 0']).status === 0

  it.skipIf(!available)('is killed at the timeout, with an error that says so, rather than blocking the recorder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-hung-'))
    try {
      const hung = join(dir, 'tmux')
      writeFileSync(hung, '#!/bin/sh\nexec sleep 30\n')
      chmodSync(hung, 0o755)
      const started = Date.now()
      expect(() => runTmux('/nowhere', ['list-sessions'], { timeoutMs: 200, command: hung })).toThrow(/tmux did not answer within 200ms/)
      expect(Date.now() - started, 'it did not wait for the sleep').toBeLessThan(10000)
      const socket = '/tmp/sandbox/tmux-1000/transcript'
      const run = (at: string, args: string[]) => runTmux(at, args, { timeoutMs: 200, command: hung })
      expect(() => readTmuxState({ sandbox: '/tmp/sandbox', run, sockets: () => [socket], realpath: (path) => path })(), 'a hung server is not a tmux with nothing in it').toThrow(/tmux could not be read: tmux did not answer within 200ms/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!available)('still reports tmux\'s own message for a failure, and a missing server as such', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-failing-'))
    try {
      const failing = join(dir, 'tmux')
      writeFileSync(failing, '#!/bin/sh\necho "no server running on /x" >&2\nexit 1\n')
      chmodSync(failing, 0o755)
      expect(() => runTmux('/x', ['list-sessions'], { command: failing })).toThrow(/no server running on \/x/)
      try { runTmux('/x', ['list-sessions'], { command: failing }) } catch (error) { expect((error as { noServer?: boolean }).noServer).toBe(true) }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!available)('reads a server that drops the client while it exits as gone, and any other failure as a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-exiting-'))
    const tmux = (message: string) => {
      const path = join(dir, 'tmux')
      writeFileSync(path, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`)
      chmodSync(path, 0o755)
      return path
    }
    const noServer = (command: string) => { try { runTmux('/x', ['list-sessions'], { command }) } catch (error) { return (error as { noServer?: boolean }).noServer } }
    try {
      expect(noServer(tmux('server exited unexpectedly')), 'a client connected during kill-server').toBe(true)
      expect(noServer(tmux('protocol version mismatch (client 8, server 7)')), 'a server that answers wrongly').toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('waiting for a state to settle', () => {
  const state = (command: string, name = 'sh'): TmuxState => ({ ...oneState(), windows: [window({ name })], panes: [pane({ command })] })
  const reader = (...states: TmuxState[]) => { let at = 0; return () => states[Math.min(at++, states.length - 1)]! }
  const options = { commands: ['sh'], port: 'x', intervalMs: 1, sleep: async () => {} }

  it('returns a state once two reads agree and every pane runs the shell', async () => {
    const read = reader(state('tmux'), state('sh', 'pytest'), state('sh'), state('sh'))
    expect(await settledState({ ...options, read })({ tool: 'run_shell_command' } as never)).toEqual(state('sh'))
  })

  it('fails with the pane and the step when a pane never leaves tmux, and when the state never stops changing', async () => {
    const stuck = settledState({ ...options, read: reader(state('tmux')), timeoutMs: 0 })
    await expect(stuck({ tool: 'split_window' } as never)).rejects.toThrow(UnsettledPaneError)
    await expect(stuck({ tool: 'split_window' } as never)).rejects.toThrow(/tmux ran "tmux" in %0 after split_window, not sh/)
    let flip = 0
    const moving = settledState({ ...options, read: () => state('sh', `name${flip++}`), timeoutMs: 0 })
    await expect(moving({ tool: 'list_windows' } as never)).rejects.toThrow(/still changing/)
  })

  it('accepts the commands of a borrowed session', async () => {
    const read = reader(state('cat'), state('cat'))
    expect(await settledState({ ...options, commands: ['cat'], read })()).toEqual(state('cat'))
  })

  it('refuses two equal reads of a pane that still runs tmux, until it gives up', async () => {
    // The sleep returns at once, so the same state is read many times before the deadline: a state that agrees with itself is not settled while its pane is the forked child.
    const stuck = settledState({ ...options, read: reader(state('tmux')), timeoutMs: 25 })
    await expect(stuck({ tool: 'split_window' } as never)).rejects.toThrow(UnsettledPaneError)
    await expect(stuck({ tool: 'split_window' } as never)).rejects.toThrow(/tmux ran "tmux" in %0 after split_window, not sh/)
  })

  describe('a window tmux names after its pane\'s program', () => {
    const named = (name: string, command: string, automaticName?: boolean): TmuxState => ({ ...oneState(), windows: [window({ name, ...(automaticName === undefined ? {} : { automaticName }) } as Partial<TmuxWindow>)], panes: [pane({ command })] })
    const cat = { ...options, commands: ['cat'] }

    it('is waited for: a window still called tmux while its pane runs cat is not a state to record', async () => {
      const read = reader(named('tmux', 'cat', true), named('tmux', 'cat', true), named('cat', 'cat', true), named('cat', 'cat', true))
      const settled = await settledState({ ...cat, read })({ tool: 'tmux_snapshot' } as never)
      expect(settled.windows.map((item: TmuxWindow) => item.name)).toEqual(['cat'])
    })

    it('is refused when it never changes, naming the window and the step', async () => {
      const stuck = settledState({ ...cat, read: reader(named('tmux', 'cat', true)), timeoutMs: 25 })
      await expect(stuck({ tool: 'tmux_snapshot' } as never)).rejects.toThrow(UnsettledPaneError)
      await expect(stuck({ tool: 'tmux_snapshot' } as never)).rejects.toThrow(/x: tmux still named window @0 "tmux" after tmux_snapshot, not the program its active pane runs/)
    })

    it('compares the name with the active pane of its own window', async () => {
      const two = (name: string): TmuxState => ({ sessions: [{ id: '$0', name: 'checks' }], windows: [window({ name, automaticName: true } as Partial<TmuxWindow>)], panes: [pane({ width: 40, command: 'cat', active: false }), pane({ id: '%1', left: 41, width: 39, command: 'sh' })] })
      expect((await settledState({ ...options, commands: ['cat', 'sh'], read: reader(two('sh'), two('sh')) })()).windows[0]!.name).toBe('sh')
      await expect(settledState({ ...options, commands: ['cat', 'sh'], read: reader(two('cat')), timeoutMs: 25 })()).rejects.toThrow(/still named window @0 "cat"/)
    })

    it('accepts the name of a launcher it is told about, and no other', async () => {
      const launched = reader(named('env', 'cat', true), named('env', 'cat', true))
      expect((await settledState({ ...cat, windowNames: ['env'], read: launched })()).windows[0]!.name).toBe('env')
      await expect(settledState({ ...cat, windowNames: ['env'], read: reader(named('tmux', 'cat', true)), timeoutMs: 25 })()).rejects.toThrow(/still named window @0 "tmux"/)
      await expect(settledState({ ...cat, read: reader(named('env', 'cat', true)), timeoutMs: 25 })()).rejects.toThrow(/still named window @0 "env"/)
    })

    it('is not waited for when it was named explicitly, or when the reader does not say', async () => {
      expect((await settledState({ ...cat, read: reader(named('docs', 'cat', false), named('docs', 'cat', false)) })()).windows[0]!.name).toBe('docs')
      expect((await settledState({ ...cat, read: reader(named('docs', 'cat'), named('docs', 'cat')) })()).windows[0]!.name).toBe('docs')
    })

    it('is left out of the state it returns, which a recording stores as it is', async () => {
      const settled = await settledState({ ...cat, read: reader(named('cat', 'cat', true), named('cat', 'cat', true)) })()
      expect(settled.windows[0]).not.toHaveProperty('automaticName')
      expect(stateProblems(settled)).toEqual([])
    })
  })
})

describe('against a real tmux', () => {
  const available = spawnSync('tmux', ['-V']).status === 0

  it.skipIf(!available)('reports whether tmux still names a window after its pane\'s program, and a name given at creation as explicit', () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-names-')))
    const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: sandbox, SHELL: '/bin/sh' }
    delete env.TMUX
    const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'names', '-f', '/dev/null', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      tmux('new-session', '-d', '-s', 'docs', '/bin/cat')
      tmux('new-window', '-d', '-n', 'cat', '/bin/cat')
      const windows = (readTmuxState({ sandbox })() as { windows: (TmuxWindow & { automaticName: boolean })[] }).windows
      expect(windows.map((item) => item.automaticName), 'the first window is named by tmux, the second by its creator').toEqual([true, false])
      expect(windows[1]!.name).toBe('cat')
    } finally {
      try { tmux('kill-server') } catch { /* already gone */ }
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it.skipIf(!available)('reads a split window on a private socket as a state tmux can be in, and an exited server as empty', () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-state-')))
    const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: sandbox, SHELL: '/bin/sh' }
    delete env.TMUX
    const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'state', '-f', '/dev/null', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const read = readTmuxState({ sandbox })
      expect(read(), 'before any server').toEqual(EMPTY)
      tmux('new-session', '-d', '-s', 'checks', '-x', '80', '-y', '24')
      tmux('split-window', '-h', '-t', 'checks')
      const state = read() as TmuxState
      expect(stateProblems(recordedState(state))).toEqual([])
      expect(state.sessions).toEqual([{ id: '$0', name: 'checks' }])
      expect(state.panes.map((item) => [item.id, item.left, item.width, item.active])).toEqual([['%0', 0, 40, false], ['%1', 41, 39, true]])
      tmux('kill-server')
      for (let waited = 0; waited < 50 && read().sessions.length; waited++) execFileSync('sleep', ['0.1'])
      expect(read(), 'after the server exits').toEqual(EMPTY)
    } finally {
      try { tmux('kill-server') } catch { /* already gone */ }
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it.skipIf(!available)('reads a server that kill-server told to exit, while a client still holds it up, as a tmux with nothing in it', () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-exit-')))
    const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: sandbox, SHELL: '/bin/sh' }
    delete env.TMUX
    const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'exit', '-f', '/dev/null', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    let control: ChildProcess | undefined
    try {
      tmux('new-session', '-d', '-s', 'held')
      // A stopped control client never reads its exit message, so the server stays up after kill-server and drops every new client: the window a read after kill-server can land in.
      control = spawn('tmux', ['-L', 'exit', '-C', 'attach', '-t', 'held'], { env, stdio: ['pipe', 'ignore', 'ignore'] })
      for (let waited = 0; waited < 50 && tmux('list-clients', '-F', '#{client_pid}').trim() === ''; waited++) execFileSync('sleep', ['0.1'])
      control.kill('SIGSTOP')
      tmux('kill-server')
      const [socket] = sandboxSockets(sandbox)
      expect(() => runTmux(socket!, ['list-sessions']), 'the server is still exiting').toThrow(/server exited unexpectedly/)
      expect(readTmuxState({ sandbox })(), 'a server that is exiting').toEqual(EMPTY)
    } finally {
      control?.kill('SIGKILL')
      try { tmux('kill-server') } catch { /* already gone */ }
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
