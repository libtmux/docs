import { readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { RECIPES, instrumentGo, withoutMarks } from '../../scripts/lib/core-recipes.mjs'
import { describeInvocation, splitInvocation } from '../../scripts/lib/core-trace.mjs'
import { leaks } from '../../scripts/lib/mcp-transcript-checks.mjs'
import { recordingProblems, sha256, type CoreRecording } from '../src/lib/core-recording'
import { statementLines } from '../src/lib/core-statement'

const json = (name: string) => JSON.parse(readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'))
const home = json('home-examples.json').go
/** The program the page displays for Go: the one the recording is of. */
const program: string = home.files.find((file: { name: string }) => file.name === 'quickstart.go').code
const stored = (): CoreRecording => json('core-recordings/go.json')
const clone = (): CoreRecording => structuredClone(stored())
const capability = (recording: CoreRecording) => recording.capabilities['typed-graph']!
const problems = (recording: CoreRecording, shown = program) => recordingProblems(recording, { programs: { 'typed-graph': shown } })

describe('the Go recording of the landing page program', () => {
  it('is sound and is of the program the page displays', () => {
    expect(problems(stored())).toEqual([])
    expect(capability(stored()).program).toEqual({ file: 'quickstart.go', sha256: sha256(program) })
  })

  it('was made at the revision the displayed example records, with the library at that revision', () => {
    expect(stored().revision).toBe(home.sourceRevision)
    expect(stored().repo).toBe(home.sourceRepository)
  })

  it('has one step per call of the step map, in the order the calls ran, and says the map was written by hand', () => {
    const recorded = capability(stored())
    expect(recorded.steps.map((step) => step.id)).toEqual(RECIPES.go.steps.map((step) => step.id))
    expect(recorded.steps.map((step) => [step.label, step.anchor, step.type])).toEqual(RECIPES.go.steps.map((step) => [step.label, step.anchor, step.type]))
    expect(RECIPES.go.stepMap).toBe('hand-written')
    expect(recorded.stepMap).toBe('hand-written')
  })

  it('records what the displayed program printed, which is what the page says it prints', () => {
    expect(capability(stored()).printed.join('\n') + '\n').toBe(home.expectedOutput)
  })

  it('records what each call returned and the commands it sent', () => {
    const [server, session, run, kill] = capability(stored()).steps
    expect(server!.commands, 'NewServer builds a handle and sends nothing').toEqual([])
    expect(server!.returned).toMatchObject({ configFile: '/dev/null', socketPath: expect.stringContaining('libtmux-quickstart-') })
    expect(session!.returned).toEqual({ id: '$0', name: 'demo' })
    expect(session!.commands.find((command) => command.mutates && command.role === 'command')).toMatchObject({ tmux: 'new-session -P -F#{session_id} -sdemo -d', exit: 0, stdout: '$0' })
    expect(run!.returned).toEqual({ Status: 0, Signal: null, Lines: ['hello from tmux'], Pane: '%1' })
    expect(run!.commands.map((command) => command.tmux.split(' ')[0])).toEqual(expect.arrayContaining(['new-window', 'respawn-pane', 'wait-for', 'capture-pane', 'kill-window']))
    expect(kill!.commands.at(-1)).toMatchObject({ tmux: 'kill-server', mutates: true, exit: 0 })
    expect(kill!.returned).toBeNull()
  })

  it('keeps the window the command ran in apart from the state after the call, which no longer holds it', () => {
    const [, session, run] = capability(stored()).steps
    expect(run!.transient).toEqual([{ window: '@1', name: expect.any(String) }])
    expect(run!.tmux, 'the command\'s window was removed, so tmux is as the session left it').toEqual(session!.tmux)
  })

  it('draws the server gone after the last call, and none before the first', () => {
    const recorded = capability(stored())
    expect(recorded.tmuxBefore).toEqual({ sessions: [], windows: [], panes: [] })
    expect(recorded.steps.at(-1)!.tmux).toEqual({ sessions: [], windows: [], panes: [] })
  })

  it('names nothing of the machine that recorded it', () => {
    const text = readFileSync(new URL('../src/data/core-recordings/go.json', import.meta.url), 'utf8')
    expect(leaks(text, ['/home/', '/libtmux-docs-', process.env.HOME ?? '/home'], [userInfo().username, hostname()])).toEqual([])
    expect(text).not.toMatch(/libtmux-quickstart-(?!12345)\d/)
  })

  describe('refuses a recording that does not hold', () => {
    const faults: [string, (recording: CoreRecording) => void, RegExp][] = [
      ['another program than the displayed one', (recording) => { capability(recording).program.sha256 = sha256('package main') }, /is of a different program/],
      ['a call whose anchor is not in the program', (recording) => { capability(recording).steps[1]!.anchor = 'server.NewWindow(' }, /anchor "server.NewWindow\(" is not on exactly one line/],
      ['a call whose anchor is on two lines', (recording) => { capability(recording).steps[1]!.anchor = 'err != nil' }, /anchor "err != nil" is not on exactly one line/],
      ['two steps with one id', (recording) => { capability(recording).steps[1]!.id = 'new-server' }, /has no unique id/],
      ['a step that records no returned value', (recording) => { delete (capability(recording).steps[0] as { returned?: unknown }).returned }, /records no returned value/],
      ['a map that does not say who wrote it', (recording) => { (capability(recording) as { stepMap: string }).stepMap = 'derived' }, /does not say whether its step map was written by hand/],
      ['a command with no exit status', (recording) => { delete (capability(recording).steps[1]!.commands[2] as { exit?: number }).exit }, /a command that is not recorded whole/],
      ['tmux changing under a call that sent nothing to change it', (recording) => { capability(recording).steps[0]!.tmux = structuredClone(capability(recording).steps[1]!.tmux) }, /tmux changed, but no command the call sent can change it/],
      ['a state tmux cannot be in', (recording) => { capability(recording).steps[1]!.tmux.panes[0]!.window = '@9' }, /pane %0 is in window @9/],
      ['an id the call returned that tmux never held', (recording) => { capability(recording).steps[1]!.returned = { id: '$7', name: 'demo' } }, /it returned \$7/],
      ['a recording with no steps', (recording) => { capability(recording).steps = [] }, /has no steps/],
    ]
    it.each(faults)('%s', (_name, damage, message) => {
      const recording = clone()
      damage(recording)
      expect(problems(recording).join('\n')).toMatch(message)
    })

    it('does not accept the unchanged recording by mistake: the faults above start from one that passes', () => {
      expect(problems(clone())).toEqual([])
    })

    it('a recording is not played for a program that has since changed', () => {
      expect(problems(stored(), `${program}// changed\n`).join('\n')).toMatch(/is of a different program/)
    })
  })
})

describe('what the recorder reads from tmux invocations', () => {
  it('splits the flags that come before the commands, and the commands at each semicolon', () => {
    expect(splitInvocation(['-N', '-u', '-f/dev/null', '-Lname', 'if-shell', '-F', '#{x}', '', '__guard', ';', 'new-session', '-d'])).toEqual({
      flags: ['-N', '-u', '-f/dev/null', '-Lname'],
      commands: [['if-shell', '-F', '#{x}', '', '__guard'], ['new-session', '-d']],
    })
    expect(splitInvocation(['-L', 'name', '-V']), 'a value flag takes the next word').toEqual({ flags: ['-L', 'name', '-V'], commands: [] })
  })

  const entry = (argv: string[], extra: object = {}) => ({ argv, exit: 0, stdout: '', stderr: '', ...extra })

  it('drops the library\'s guard, names what remains, and says whether it can change tmux', () => {
    const guarded = entry(['-N', '-Lx', 'if-shell', '-F', '#{==:a,b}', '', '__libtmux_daemon_replaced_ABC', ';', 'new-window', '-t', '$0', '--', 'echo hello'], { stdout: '@1\n' })
    expect(describeInvocation(guarded, RECIPES.go)).toEqual({ role: 'command', tmux: "new-window -t $0 -- 'echo hello'", mutates: true, exit: 0, stdout: '@1', stderr: '' })
    expect(describeInvocation(entry(['-Lx', 'if-shell', '-F', 'c', '', '__libtmux_daemon_replaced_A', ';', 'list-panes', '-a']), RECIPES.go)).toMatchObject({ tmux: 'list-panes -a', mutates: false })
  })

  it('tells an identity probe from a command', () => {
    expect(describeInvocation(entry(['-V']), RECIPES.go)).toMatchObject({ role: 'probe', tmux: '-V' })
    expect(describeInvocation(entry(['-N', '-Lx', 'run-shell', '-C', 'libtmux-version-ab12-#{q:pid}']), RECIPES.go).role).toBe('probe')
    expect(describeInvocation(entry(['-Lx', 'run-shell', 'echo hi']), RECIPES.go).role, 'a run-shell that is not the probe is a command').toBe('command')
  })

  it('keeps a refusal as the reply, with its exit status', () => {
    expect(describeInvocation(entry(['-Lx', 'list-sessions'], { exit: 1, stderr: 'no server running\n' }), RECIPES.go)).toMatchObject({ exit: 1, stderr: 'no server running' })
  })
})

describe('the markers the recorder puts in a copy of the program', () => {
  const marked: string = instrumentGo(program, RECIPES.go.steps)
  const lines: string[] = marked.split('\n')

  it('leave the displayed program as it is once they are taken out', () => {
    expect(withoutMarks(marked)).toBe(program)
    expect(lines.filter((line) => line.endsWith('// docs:mark'))).toHaveLength(RECIPES.go.steps.length)
  })

  it('come after the whole of each call, where its value is in scope, never inside it', () => {
    for (const step of RECIPES.go.steps) {
      const [, end] = statementLines(program, step.anchor)!
      const at = lines.findIndex((line) => line.includes(`docsMark(${JSON.stringify(step.id)},`))
      expect(lines[at - 1], step.id).toBe(program.split('\n')[end - 1])
    }
  })

  it('refuse a step whose anchor is not on exactly one line', () => {
    expect(() => instrumentGo(program, [{ ...RECIPES.go.steps[0]!, anchor: 'err != nil' }])).toThrow(/not on exactly one line/)
    expect(() => instrumentGo(program, [{ ...RECIPES.go.steps[0]!, anchor: 'nothing.Here(' }])).toThrow(/not on exactly one line/)
  })
})
