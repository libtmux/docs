import { describe, expect, it } from 'vitest'
import { hostLeaks, idsIn, leaks, readings, recordingLeaks, sanitize, UnsettledPaneError, verifyRecording, verifySettledPanes, withoutContracts } from '../../scripts/lib/mcp-transcript-checks.mjs'
import type { TmuxState } from '../src/lib/mcp-tmux-state'

type Step = { tool: string; arguments: unknown; isError: boolean; content: unknown[]; structuredContent?: unknown }
const OPTIONS = { port: 'x', runTool: 'run_shell_command', expected: ['2 passed'] }
const good = (): Step[] => [
  { tool: 'create_session', arguments: { name: 'checks' }, isError: false, content: [], structuredContent: { paneId: '%0', session: { id: '$0' } } },
  { tool: 'run_shell_command', arguments: { paneId: '%0', command: 'pytest -q' }, isError: false, content: [], structuredContent: { output: '..\n2 passed in 0.00s', exitStatus: 0 } },
  { tool: 'kill_session', arguments: { session: '$0' }, isError: false, content: [], structuredContent: { killed: '$0' } },
]

describe('the checks a recording must pass', () => {
  it('accepts a recording whose calls worked, whose ids were returned and whose command printed its result', () => {
    expect(() => verifyRecording(good(), OPTIONS)).not.toThrow()
  })

  it('refuses a tool error', () => {
    const steps = good()
    steps[0] = { ...steps[0]!, isError: true }
    expect(() => verifyRecording(steps, OPTIONS)).toThrow(/returned an error/)
  })

  it('refuses an id no earlier result returned, and matches ids whole', () => {
    const steps = good()
    steps[1]!.arguments = { paneId: '%1', command: 'pytest -q' }
    expect(() => verifyRecording(steps, OPTIONS)).toThrow(/names %1/)
    const prefix = good()
    prefix[0]!.structuredContent = { paneId: '%10', session: { id: '$0' } }
    expect(() => verifyRecording(prefix, OPTIONS), '%0 is not a prefix match of %10').toThrow(/names %0/)
  })

  it('refuses a run whose output lacks the expected text, or only ends with it', () => {
    const missing = good()
    missing[1]!.structuredContent = { output: 'no tests ran', exitStatus: 0 }
    expect(() => verifyRecording(missing, OPTIONS)).toThrow(/lacks "2 passed"/)
    const longer = good()
    longer[1]!.structuredContent = { output: '12 passed in 0.1s', exitStatus: 0 }
    expect(() => verifyRecording(longer, OPTIONS)).toThrow(/lacks/)
  })

  it('refuses a run that did not exit 0 or that has no run step', () => {
    const failed = good()
    failed[1]!.structuredContent = { output: '2 passed', exitStatus: 1 }
    expect(() => verifyRecording(failed, OPTIONS)).toThrow(/exited 1/)
    expect(() => verifyRecording(good().filter((step) => step.tool !== 'run_shell_command'), OPTIONS)).toThrow(/expected 1 run_shell_command steps, found 0/)
  })

  it('checks each run step against its own expected text, in order', () => {
    const steps = good()
    steps.splice(2, 0, { tool: 'run_shell_command', arguments: { paneId: '%0', command: 'cat log' }, isError: false, content: [], structuredContent: { output: 'all done', exitStatus: 0 } })
    expect(() => verifyRecording(steps, { ...OPTIONS, expected: ['2 passed', 'all done'] })).not.toThrow()
    expect(() => verifyRecording(steps, { ...OPTIONS, expected: ['all done', '2 passed'] })).toThrow(/step 1 output lacks "all done"/)
    expect(() => verifyRecording(steps, OPTIONS)).toThrow(/expected 1 run_shell_command steps, found 2/)
  })

  it('reads a command\'s text from output, from text, and from lines in an object, and its status from exit_code', () => {
    const shapes: Record<string, unknown>[] = [
      { output: ['..', '2 passed in 0.01s'], exitStatus: 0 },
      { output: { lines: ['..', '2 passed in 0.01s'] }, exitStatus: 0 },
      { text: '..\n2 passed in 0.01s\n', exit_code: 0 },
    ]
    for (const result of shapes) {
      const steps = good()
      steps[1]!.structuredContent = result
      expect(() => verifyRecording(steps, OPTIONS), JSON.stringify(result)).not.toThrow()
      steps[1]!.structuredContent = { ...result, ...('exit_code' in result ? { exit_code: 2 } : { exitStatus: 2 }) }
      expect(() => verifyRecording(steps, OPTIONS), `${JSON.stringify(result)} with a failing status`).toThrow(/exited 2/)
    }
  })

  it('requires the last answer to state what the example asks about, when no command runs', () => {
    const read: Step[] = [{ tool: 'tmux_snapshot', arguments: {}, isError: false, content: [], structuredContent: { items: [{ id: '%0' }] } }]
    const options = { port: 'x', runTool: '', expected: [] as string[] }
    expect(() => verifyRecording(read, { ...options, present: ['%0'] })).not.toThrow()
    expect(() => verifyRecording(read, { ...options, present: ['%7'] })).toThrow(/last answer lacks "%7"/)
  })

  it('finds ids in text', () => {
    expect([...idsIn({ a: '%0', b: ['$1', '@22'] })].sort()).toEqual(['$1', '%0', '@22'])
  })
})

describe('the tmux state a recording must carry', () => {
  const pane = { window: '@0', id: '%0', command: 'sh', left: 0, top: 0, width: 80, height: 24, active: true }
  const one: TmuxState = { sessions: [{ id: '$0', name: 'checks' }], windows: [{ session: '$0', id: '@0', index: 0, name: 'sh', active: true, layout: 'a1b2,80x24,0,0,0' }], panes: [pane] }
  const none: TmuxState = { sessions: [], windows: [], panes: [] }
  const stated = (): (Step & { tmux?: TmuxState })[] => good().map((step, index) => ({ ...step, tmux: index === 2 ? none : one }))
  const withStates = { ...OPTIONS, before: none, states: true }

  it('accepts a recording whose states follow from its calls', () => {
    expect(() => verifyRecording(stated(), withStates)).not.toThrow()
  })

  it('refuses a recording that read no state, when the recorder asks for one, and leaves a recording that carries none to its results', () => {
    expect(() => verifyRecording(good(), { ...OPTIONS, states: true })).toThrow(/no tmux state was read/)
    expect(() => verifyRecording(good(), OPTIONS)).not.toThrow()
  })

  it('refuses a step whose state could not be read, a missing start, and a state that is not one tmux can be in', () => {
    const missing = stated()
    delete missing[1]!.tmux
    expect(() => verifyRecording(missing, withStates)).toThrow(/after step 2 \(run_shell_command\): the state is missing/)
    expect(() => verifyRecording(stated(), { ...OPTIONS, states: true })).toThrow(/the state before the first call is missing/)
    const broken = stated()
    broken[1]!.tmux = { ...one, panes: [{ ...pane, window: '@9' }] }
    expect(() => verifyRecording(broken, withStates)).toThrow(/pane %0 is in window @9/)
  })

  it('refuses a state that belongs to another call: one read a step late, and one that lacks what the call returned', () => {
    const late = stated()
    late[0]!.tmux = none
    expect(() => verifyRecording(late, withStates)).toThrow(/after step 1 \(create_session\): the result returns \$0, which tmux does not have after the call/)
    const other = stated()
    other[0]!.tmux = { ...one, panes: [{ ...pane, id: '%5' }], windows: [{ ...one.windows[0]!, layout: 'a1b2,80x24,0,0,5' }] }
    expect(() => verifyRecording(other, withStates)).toThrow(/after step 1 \(create_session\): the result returns %0, which tmux does not have after the call/)
    const named = stated()
    named[1]!.arguments = { paneId: '%9', command: 'pytest -q' }
    expect(() => verifyRecording(named, withStates), 'the id was never returned, so the id check speaks first').toThrow(/names %9, which no earlier result returned/)
  })
})

describe('a pane described before its shell has started', () => {
  const split = (pane: Record<string, unknown>): Step[] => [
    { tool: 'create_session', arguments: { name: 'checks' }, isError: false, content: [], structuredContent: { id: '$0', panes: [{ id: '%0', command: 'sh', path: '/home/user/project' }] } },
    { tool: 'split_window', arguments: { pane: '%0' }, isError: false, content: [], structuredContent: pane },
  ]
  const settled = { id: '%1', command: 'sh', path: '/home/user/project', window_id: '@0' }

  it('accepts panes that run the shell and name their path', () => {
    expect(() => verifySettledPanes(split(settled), { port: 'x', commands: ['sh'] })).not.toThrow()
    expect(() => verifySettledPanes(split({ ...settled, command: 'cat' }), { port: 'x', commands: ['cat', 'sh'] })).not.toThrow()
  })

  it.each([
    ['tmux, the name of the forked child', { ...settled, command: 'tmux' }, /command "tmux"/],
    ['a path that is null', { ...settled, path: null }, /path null/],
    ['an empty path', { ...settled, path: '' }, /path ""/],
    ['a command under another spelling', { id: '%1', currentCommand: 'tmux', currentPath: '/home/user/project' }, /command "tmux"/],
    ['a pane in a list', { panes: [settled, { ...settled, id: '%2', command: 'tmux' }] }, /pane %2/],
  ])('refuses %s, naming the pane and the step', (_name, pane, message) => {
    const steps = split(pane)
    expect(() => verifySettledPanes(steps, { port: 'x', commands: ['sh'] })).toThrow(UnsettledPaneError)
    expect(() => verifySettledPanes(steps, { port: 'x', commands: ['sh'] })).toThrow(message)
    expect(() => verifySettledPanes(steps, { port: 'x', commands: ['sh'] })).toThrow(/split_window described pane/)
  })

  it('leaves an object that is not a pane alone, and a pane with no path to the servers that do not report one', () => {
    expect(() => verifySettledPanes(split({ id: '$1', command: 'tmux' }), { port: 'x', commands: ['sh'] })).not.toThrow()
    expect(() => verifySettledPanes(split({ id: '%1', command: 'sh' }), { port: 'x', commands: ['sh'] })).not.toThrow()
    expect(() => verifySettledPanes(split({ command: 'tmux' }), { port: 'x', commands: ['sh'] })).not.toThrow()
  })

  it('is part of a recording\'s checks when the caller names the commands, and its error is not a tool error', () => {
    const steps = good()
    steps.splice(1, 0, ...split({ ...settled, command: 'tmux' }).slice(1))
    expect(() => verifyRecording(steps, OPTIONS), 'unchecked unless asked').not.toThrow()
    expect(() => verifyRecording(steps, { ...OPTIONS, commands: ['sh'] })).toThrow(UnsettledPaneError)
    const failed = good()
    failed[0] = { ...failed[0]!, isError: true }
    expect(() => verifyRecording(failed, { ...OPTIONS, commands: ['sh'] })).not.toThrow(UnsettledPaneError)
  })

})

describe('keeping the host out of a recording', () => {
  const marks = { paths: [['/tmp/t239-x/project', '/home/user/project']] as [string, string][], names: ['d'] }

  it('refuses a name of any length as a token or a quoted value, in a string or in JSON inside one', () => {
    expect(leaks('{"pane_title":"d"}', [], ['d'])).toEqual(['d'])
    expect(leaks('{\\"pane_title\\":\\"d\\"}', [], ['d'])).toEqual(['d'])
    expect(leaks('logged in as d on host d', [], ['d'])).toEqual(['d'])
    expect(leaks('ran in /tmp/t239-x/project', ['/tmp/t239-x'], [])).toEqual(['/tmp/t239-x'])
  })

  it('finds and rewrites a path whose slashes a server escapes inside its JSON text, as Swift\'s does', () => {
    const text = String.raw`{\"currentPath\":\"\/tmp\/t239-x\/project\"}`
    expect(leaks(text, ['/tmp/t239-x'], [])).toEqual(['/tmp/t239-x'])
    expect(leaks('{"currentPath":"/home/user/project"}', ['/tmp/t239-x'], []), 'a control: the fixed path is not the sandbox').toEqual([])
    const clean = sanitize(text, marks)
    expect(clean).toBe(String.raw`{\"currentPath\":\"\/home\/user\/project\"}`)
    expect(leaks(clean, ['/tmp/t239-x'], [])).toEqual([])
    expect(sanitize('/tmp/t239-x/project', marks), 'a path written plainly is still rewritten').toBe('/home/user/project')
  })

  it('does not take a name for part of a longer word, path, option or file name', () => {
    for (const text of ['id and sidebar and d2 and a-d and -d flag', '/home/d/x', 'pytest.d', '"idle"']) expect(leaks(text, [], ['d']), text).toEqual([])
  })

  it('does not take an escape after a backslash for a name', () => {
    // libtmux-julia escapes `$` as `\d` in its format strings; a user called d is not in them.
    for (const text of [String.raw`#{s|[$]|\\d|;s|\t|\\t|}`, String.raw`ids \d0 and \d1`]) {
      expect(leaks(text, [], ['d']), text).toEqual([])
      expect(sanitize(text, { names: ['d'] }), text).toBe(text)
    }
  })

  it('finds a name beside a backslash, as in a Windows path, a network share or an environment line, and rewrites it', () => {
    const cases: [string, string][] = [
      [String.raw`C:\Users\d\AppData`, 'd'],
      [String.raw`\\wsl-box\share\file`, 'wsl-box'],
      [String.raw`USERPROFILE=C:\Users\tony`, 'tony'],
    ]
    for (const [text, name] of cases) {
      expect(leaks(text, [], [name]), text).toEqual([name])
      expect(leaks(JSON.stringify({ text }), [], [name]), `${text} as JSON`).toEqual([name])
      expect(sanitize(text, { names: [name] }), text).not.toContain(name)
    }
  })

  it('leaves the contracts out of the check, whose patterns hold a backslash before a letter', () => {
    const pattern = String.raw`^%\d+$`
    const recorded = {
      repo: 'o/r', revision: 'a'.repeat(40),
      contracts: { kill_pane: { inputSchema: { type: 'object', properties: { pane: { type: 'string', pattern } } } } },
      steps: [{ tool: 'kill_pane', arguments: { pane: '%0' }, isError: false, content: [] }],
    }
    expect(leaks(JSON.stringify(recorded), [], ['d']), 'an escape in the pattern is not a name').toEqual([])
    expect(leaks(JSON.stringify(withoutContracts(recorded)), [], ['d'])).toEqual([])
    expect(withoutContracts(recorded)).toEqual({ repo: 'o/r', revision: recorded.revision, steps: recorded.steps })
    const ranBy = { ...recorded, steps: [{ ...recorded.steps[0]!, content: [{ type: 'text', text: 'run by d' }] }] }
    expect(leaks(JSON.stringify(withoutContracts(ranBy)), [], ['d']), 'a name in what the session recorded is still found').toEqual(['d'])
    const inSteps = { ...recorded, steps: [{ ...recorded.steps[0]!, content: [{ type: 'text', text: String.raw`C:\Users\d\x` }] }] }
    expect(leaks(JSON.stringify(withoutContracts(inSteps)), [], ['d']), 'and so is one beside a backslash').toEqual(['d'])
  })

  it('rewrites a name and a path wherever they are, inside embedded JSON too, and leaves other text alone', () => {
    const recorded = { title: 'd', text: '{"pane_title":"d","path":"/tmp/t239-x/project","id":"%0"}', lines: ['d@d:/tmp/t239-x/project$ ls', 'id -d'] }
    const clean = sanitize(recorded, marks)
    expect(clean).toEqual({ title: 'host', text: '{"pane_title":"host","path":"/home/user/project","id":"%0"}', lines: ['host@host:/home/user/project$ ls', 'id -d'] })
    expect(leaks(JSON.stringify(clean), ['/tmp/t239-x'], ['d'])).toEqual([])
    expect(sanitize(clean, marks), 'rewriting twice changes nothing').toEqual(clean)
  })

})

describe('reading a text through the encodings a server or a tool may put on it', () => {
  it('removes layers of JSON escaping and percent-encoding in any order, and keeps the text itself', () => {
    const path = '/tmp/t239-x/project'
    const escaped = String.raw`\/tmp\/t239-x\/project`
    expect(readings(path)).toEqual([path])
    expect(readings(escaped)).toContain(path)
    expect(readings('%2Ftmp%2Ft239-x%2Fproject')).toContain(path)
    expect(readings('%252Ftmp%252Ft239-x%252Fproject'), 'encoded twice').toContain(path)
    expect(readings(String.raw`%5C%2Ftmp%5C%2Ft239-x`), 'percent-encoded escapes').toContain('/tmp/t239-x')
    expect(readings(String.raw`\u002ftmp\u002ft239-x`), 'unicode escapes').toContain('/tmp/t239-x')
    let layers = escaped
    for (let layer = 0; layer < 3; layer++) layers = JSON.stringify(layers).slice(1, -1)
    expect(readings(layers), 'escaped three more times').toContain(path)
    expect(readings(escaped)[0]).toBe(escaped)
    expect(readings(`${'\\'.repeat(200)}/tmux`), 'more layers than the readings go deep: the backslashes before a slash are one slash').toContain('/tmux')
  })

  it('leaves a line break written as two characters alone, so that text such as printf \\nd does not read as a name', () => {
    expect(readings(String.raw`printf 'a\nd'`)).toEqual([String.raw`printf 'a\nd'`])
    expect(leaks(String.raw`printf 'a\nd'`, [], ['d'])).toEqual([])
  })

  it('stops at a bounded number of readings for a text that keeps decoding', () => {
    expect(readings('%'.repeat(5) + '25'.repeat(40)).length).toBeLessThan(100)
  })
})
