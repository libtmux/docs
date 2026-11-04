import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseListings, readTmuxState, settledState } from '../../scripts/lib/mcp-tmux-state.mjs'
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
    'W|$0|@0|0|sh|1|b25f,80x24,0,0{40x24,0,0,0,39x24,41,0,1}',
    'P|@0|%0|sh|0|0|40|24|0',
    'P|@0|%1|sh|41|0|39|24|1',
    '',
  ].join('\n')

  it('parses the three listings into a state tmux can be in', () => {
    const state = parseListings(listing)
    expect(state).toEqual({
      sessions: [{ id: '$0', name: 'checks' }],
      windows: [{ session: '$0', id: '@0', index: 0, name: 'sh', active: true, layout: 'b25f,80x24,0,0{40x24,0,0,0,39x24,41,0,1}' }],
      panes: [pane({ width: 40, active: false }), pane({ id: '%1', left: 41, width: 39 })],
    })
    expect(stateProblems(state)).toEqual([])
  })

  it.each([
    ['a name that holds the separator', 'S|$0|a|b', /expected 2 fields, found 3/],
    ['a line of another listing', 'X|$0|a', /unknown listing/],
    ['a count that is not digits', 'W|$0|@0|one|sh|1|layout', /"one" is not a number/],
    ['a flag that is not 0 or 1', 'W|$0|@0|0|sh|yes|layout', /"yes" is not a flag/],
  ])('refuses %s rather than guess', (_name, line, message) => {
    expect(() => parseListings(line)).toThrow(message)
  })

  const sandbox = '/tmp/sandbox'
  const socket = `${sandbox}/tmux-1000/transcript`
  const answers = (extra: Record<string, string | Error> = {}) => (_socket: string, args: string[]) => {
    const key = args.length === 3 ? 'sessions' : 'list'
    const answer = extra[key] ?? { sessions: '$0\n', list: listing }[key]
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }

  it('reads the one server of the sandbox', () => {
    const state = readTmuxState({ sandbox, run: answers(), sockets: () => [socket] })()
    expect(state.panes.map((item: any) => [item.id, item.command, item.width])).toEqual([['%0', 'sh', 40], ['%1', 'sh', 39]])
    expect(stateProblems(state)).toEqual([])
  })

  it('treats a sandbox with no server, and a server that has gone, as a tmux with nothing in it', () => {
    expect(readTmuxState({ sandbox, run: answers(), sockets: () => [] })()).toEqual(EMPTY)
    // tmux answers the window and pane listings of a server with no session with an error, so they must not be asked.
    const noSession = answers({ sessions: '\n', list: new Error('no current target') })
    expect(readTmuxState({ sandbox, run: noSession, sockets: () => [socket] })()).toEqual(EMPTY)
    const gone = Object.assign(new Error(`no server running on ${socket}`), { noServer: true })
    expect(readTmuxState({ sandbox, run: answers({ list: gone }), sockets: () => [socket] })()).toEqual(EMPTY)
  })

  it('fails when tmux cannot be read for any other reason, so a recording with a hole in it is never written', () => {
    expect(() => readTmuxState({ sandbox, run: answers({ list: new Error('server exited unexpectedly') }), sockets: () => [socket] })()).toThrow(/tmux could not be read: server exited unexpectedly/)
    expect(() => readTmuxState({ sandbox, run: answers({ sessions: new Error('lost connection') }), sockets: () => [socket] })()).toThrow(/tmux could not be read: lost connection/)
  })

  it('refuses a socket outside the sandbox, so it never reads the reader\'s own tmux, and a sandbox with two servers', () => {
    const run = () => { throw new Error('tmux must not be run') }
    expect(() => readTmuxState({ sandbox, run, sockets: () => ['/tmp/tmux-1000/default'] })()).toThrow(/outside the sandbox/)
    expect(() => readTmuxState({ sandbox, run, sockets: () => [`${sandbox}-other/tmux-1000/default`] })()).toThrow(/outside the sandbox/)
    expect(() => readTmuxState({ sandbox, run, sockets: () => [socket, `${sandbox}/tmux-1000/default`] })()).toThrow(/more than one tmux server \(transcript, default\)/)
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
})

describe('against a real tmux', () => {
  const available = spawnSync('tmux', ['-V']).status === 0

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
      expect(stateProblems(state)).toEqual([])
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
})
