import { readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { RECIPES as GO_RECIPES, instrumentGo, withoutMarks } from '../../scripts/lib/core-recipes/go.mjs'
import { matchMarks } from '../../scripts/lib/core-recipes/common.mjs'
import { ControlReader, commandCount, describeInvocation, isControlInvocation, shimScript, splitCommandLine, splitInvocation } from '../../scripts/lib/core-trace.mjs'
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
    expect(recorded.steps.map((step) => step.id)).toEqual(GO_RECIPES['typed-graph'].steps.map((step) => step.id))
    expect(recorded.steps.map((step) => [step.label, step.anchor, step.type])).toEqual(GO_RECIPES['typed-graph'].steps.map((step) => [step.label, step.anchor, step.type]))
    expect(GO_RECIPES['typed-graph'].stepMap).toBe('hand-written')
    expect(recorded.stepMap).toBe('hand-written')
  })

  it('records what the displayed program printed, which is what the page says it prints', () => {
    expect(capability(stored()).printed.join('\n') + '\n').toBe(home.expectedOutput)
  })

  it('records what each call returned and the commands it sent', () => {
    const step = (id: string) => capability(stored()).steps.find((each) => each.id === id)!
    const changes = (id: string) => step(id).commands.filter((command) => command.mutates && command.role === 'command').map((command) => command.tmux.split(' ')[0])
    expect(step('new-server').commands, 'NewServer builds a handle and sends nothing').toEqual([])
    expect(step('new-server').returned).toMatchObject({ configFile: '/dev/null', socketPath: expect.stringContaining('libtmux-quickstart-') })
    expect(step('new-session').returned).toEqual({ id: '$0', name: 'demo' })
    expect(step('new-session').commands.find((command) => command.mutates && command.role === 'command')).toMatchObject({ tmux: 'new-session -P -F#{session_id} -sdemo -d', exit: 0, stdout: '$0' })
    expect(step('rename').returned).toEqual({ id: '@0', index: 0, name: 'editor' })
    expect(changes('rename')).toEqual(['rename-window'])
    expect(step('split').returned).toEqual({ id: '%1' })
    expect(changes('split')).toEqual(['split-window'])
    expect(step('new-window').returned).toEqual({ id: '@1', index: 1, name: 'logs' })
    expect(changes('select-pane')).toEqual(['select-pane'])
    expect(changes('select-window')).toEqual(['select-window'])
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 2, panes: 3 })
    expect(changes('snapshot'), 'a snapshot only reads').toEqual([])
    expect(step('kill').commands.at(-1)).toMatchObject({ tmux: 'kill-server', mutates: true, exit: 0 })
    expect(step('kill').returned).toBeNull()
  })

  it('walks the snapshot\'s records without asking tmux: the calls after Snapshot send nothing and change nothing', () => {
    const steps = capability(stored()).steps
    const snapshot = steps.findIndex((step) => step.id === 'snapshot')
    const walk = steps.slice(snapshot + 1, -1)
    expect(walk.map((step) => step.id)).toEqual(['pane-by-id', 'pane-window', 'window-session'])
    expect(walk.map((step) => step.commands)).toEqual([[], [], []])
    for (const step of walk) expect(step.tmux).toEqual(steps[snapshot]!.tmux)
    expect(walk.map((step) => step.returned)).toEqual([{ id: '%1' }, { id: '@0', index: 0, name: 'editor' }, { id: '$0', name: 'demo' }])
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

    it('lets a call stop the server without a command only when it says so, and the server was running and is gone', () => {
      const silent = (recording: CoreRecording) => { const step = capability(recording).steps.at(-1)!; step.commands = []; return step }
      const stopped = clone()
      silent(stopped).stopsServer = true
      expect(problems(stopped)).toEqual([])
      const unsaid = clone()
      silent(unsaid)
      expect(problems(unsaid).join('\n')).toMatch(/tmux changed, but no command the call sent can change it/)
      const wrong = clone()
      capability(wrong).steps[1]!.stopsServer = true
      expect(problems(wrong).join('\n')).toMatch(/says it stopped the server, but the server was not running before it or still holds a session/)
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
    expect(describeInvocation(guarded, GO_RECIPES['typed-graph'])).toEqual({ role: 'command', tmux: "new-window -t $0 -- 'echo hello'", mutates: true, exit: 0, stdout: '@1', stderr: '' })
    expect(describeInvocation(entry(['-Lx', 'if-shell', '-F', 'c', '', '__libtmux_daemon_replaced_A', ';', 'list-panes', '-a']), GO_RECIPES['typed-graph'])).toMatchObject({ tmux: 'list-panes -a', mutates: false })
  })

  it('tells an identity probe from a command', () => {
    expect(describeInvocation(entry(['-V']), GO_RECIPES['typed-graph'])).toMatchObject({ role: 'probe', tmux: '-V' })
    expect(describeInvocation(entry(['-N', '-Lx', 'run-shell', '-C', 'libtmux-version-ab12-#{q:pid}']), GO_RECIPES['typed-graph']).role).toBe('probe')
    expect(describeInvocation(entry(['-Lx', 'run-shell', 'echo hi']), GO_RECIPES['typed-graph']).role, 'a run-shell that is not the probe is a command').toBe('command')
  })

  it('keeps a refusal as the reply, with its exit status', () => {
    expect(describeInvocation(entry(['-Lx', 'list-sessions'], { exit: 1, stderr: 'no server running\n' }), GO_RECIPES['typed-graph'])).toMatchObject({ exit: 1, stderr: 'no server running' })
  })
})

describe('the markers the recorder puts in a copy of the program', () => {
  const marked: string = instrumentGo(program, GO_RECIPES['typed-graph'].steps)
  const lines: string[] = marked.split('\n')

  it('leave the displayed program as it is once they are taken out', () => {
    expect(withoutMarks(marked)).toBe(program)
    expect(lines.filter((line) => line.endsWith('// docs:mark'))).toHaveLength(GO_RECIPES['typed-graph'].steps.length)
  })

  it('come after the whole of each call, where its value is in scope, never inside it', () => {
    for (const step of GO_RECIPES['typed-graph'].steps) {
      const [, end] = statementLines(program, step.anchor)!
      const at = lines.findIndex((line) => line.includes(`docsMark(${JSON.stringify(step.id)},`))
      expect(lines[at - 1], step.id).toBe(program.split('\n')[end - 1])
    }
  })

  it('refuse a step whose anchor is not on exactly one line', () => {
    expect(() => instrumentGo(program, [{ ...GO_RECIPES['typed-graph'].steps[0]!, anchor: 'err != nil' }])).toThrow(/not on exactly one line/)
    expect(() => instrumentGo(program, [{ ...GO_RECIPES['typed-graph'].steps[0]!, anchor: 'nothing.Here(' }])).toThrow(/not on exactly one line/)
  })
})

const source = (key: string) => json('example-sources.json')[key]
const CAPABILITIES = [
  ['watch', 'go:examples/control-mode-subscribe/main.go', ['new-server', 'new-session', 'open', 'rename', 'next-1', 'next-2', 'subscribe', 'new-window', 'next-change-1', 'next-change-2', 'kill']],
  ['run-applications', 'go:examples/run-to-completion/main.go', ['new-server', 'new-session', 'run', 'start', 'stream', 'kill']],
] as const

describe.each(CAPABILITIES)('the Go recording of %s', (id, key, ids) => {
  const shown: string = source(key).content.replace(/\n$/, '')
  const check = (recording: CoreRecording, program = shown) => recordingProblems({ ...recording, capabilities: { [id]: recording.capabilities[id]! } }, { programs: { [id]: program } })

  it('is sound, is of the cached program, and says the revision the cache records', () => {
    expect(check(stored())).toEqual([])
    expect(stored().capabilities[id]!.program.sha256).toBe(sha256(shown))
    expect(stored().capabilities[id]!.revision).toBe(source(key).revision)
  })

  it('has the steps of its recipe, a repeated call once per iteration', () => {
    expect(stored().capabilities[id]!.steps.map((step) => step.id)).toEqual(ids)
    expect(stored().capabilities[id]!.stepMap).toBe('hand-written')
  })

  it('records what the program printed, which is its output.txt', () => {
    const output = source(key.replace('main.go', 'output.txt')).content
    expect(stored().capabilities[id]!.printed.join('\n') + '\n').toBe(output)
  })

  it('names nothing of the machine that recorded it', () => {
    const text = JSON.stringify(stored().capabilities[id])
    expect(leaks(text, ['/home/', '/libtmux-docs-', process.env.HOME ?? '/home'], [userInfo().username, hostname()])).toEqual([])
  })

  it('is refused for a program that is not the cached one', () => {
    expect(check(stored(), `${shown}\n// edited`)).toContainEqual(expect.stringContaining('different program'))
  })
})

describe('what the watch recording holds of a control client', () => {
  const steps = () => stored().capabilities.watch!.steps
  const step = (id: string) => steps().find((entry) => entry.id === id)!

  it('counts the commands written to the control channel as the step\'s commands', () => {
    expect(step('rename').commands.map((command) => command.tmux.split(' ')[0])).toEqual(['rename-session', 'list-sessions'])
    expect(step('rename').commands[0]!.tmux).toBe('rename-session -t $0 -- control-example')
    expect(step('open').commands.find((command) => command.role === 'command')).toMatchObject({ tmux: expect.stringMatching(/^attach-session -f /), mutates: true, exit: 0 })
    expect(step('new-window').commands[0]!.tmux).toMatch(/^new-window -t \$0/)
  })

  it('keeps what tmux sent unasked with the step it arrived in, in the order it came', () => {
    expect(step('rename').notifications).toEqual(['%session-renamed $0 control-example'])
    expect(step('new-window').notifications).toEqual(['%window-add @1', '%subscription-changed windows $0 - - - : 2'])
  })

  it('anchors the iterations of a loop on the loop\'s own line, and the two loops on different lines', () => {
    const first = [step('next-1'), step('next-2')]
    const second = [step('next-change-1'), step('next-change-2')]
    expect(first.map((entry) => entry.iteration)).toEqual([1, 2])
    expect(new Set([...first, ...second].map((entry) => entry.anchor))).toEqual(new Set(['stream.Next(ctx)']))
    const lines = (list: typeof first) => list.map((entry) => statementLines(source('go:examples/control-mode-subscribe/main.go').content.replace(/\n$/, ''), entry.anchor, '//', entry.occurrence)![0])
    expect(new Set(lines(first)).size).toBe(1)
    expect(new Set(lines(second)).size).toBe(1)
    expect(lines(first)[0]).toBeLessThan(lines(second)[0]!)
  })

  it('returns what each Next heard', () => {
    expect(step('next-2').returned).toEqual({ kind: '%session-renamed' })
    expect(step('next-change-2').returned).toEqual({ kind: '%subscription-changed', subscription: { name: 'windows', value: '2' } })
  })

  it('refuses a call that shares a line without saying it repeats, and runs that do not count up', () => {
    const planted = structuredClone(stored())
    const list = planted.capabilities.watch!.steps
    delete list.find((entry) => entry.id === 'next-2')!.iteration
    expect(recordingProblems({ ...planted, capabilities: { watch: planted.capabilities.watch! } })).toContainEqual(expect.stringContaining('does not say it is a repeated call'))
    const skipped = structuredClone(stored())
    skipped.capabilities.watch!.steps.find((entry) => entry.id === 'next-2')!.iteration = 3
    expect(recordingProblems({ ...skipped, capabilities: { watch: skipped.capabilities.watch! } })).toContainEqual(expect.stringContaining('is run 3 of its call, after 1'))
  })
})

describe('the marks a run sends against the step map', () => {
  const map = [{ id: 'a' }, { id: 'b', repeat: true }, { id: 'c' }]

  it('accepts a repeated step once or many times, and numbers the arrivals', () => {
    expect(matchMarks(['a', 'b', 'c'], map).map((entry) => [entry.step.id, entry.iteration])).toEqual([['a', 1], ['b', 1], ['c', 1]])
    expect(matchMarks(['a', 'b', 'b', 'b', 'c'], map).map((entry) => entry.iteration)).toEqual([1, 1, 2, 3, 1])
  })

  it('refuses a repeat the map does not allow, a missing call, and a call out of order', () => {
    expect(() => matchMarks(['a', 'a', 'b', 'c'], map)).toThrow(/a was not expected|did not arrive/)
    expect(() => matchMarks(['a', 'c'], map)).toThrow(/b did not arrive/)
    expect(() => matchMarks(['b', 'a', 'c'], map)).toThrow(/did not arrive/)
    expect(() => matchMarks(['a', 'b', 'c', 'c'], map)).toThrow(/c was not expected/)
  })
})

describe('the control client the shim passes through', () => {
  const feed = (chunks: string[]) => {
    const reader = new ControlReader()
    return chunks.flatMap((chunk) => reader.feed(Buffer.from(chunk))).flatMap(({ event }) => (event ? [event] : []))
  }

  it('reads a reply block and a notification, however the bytes are cut', () => {
    const text = '%begin 1 2 1\nrow one\nrow two\n%end 1 2 1\n%session-renamed $0 x\n'
    const expected = [{ kind: 'reply', exit: 0, text: 'row one\nrow two' }, { kind: 'notification', text: '%session-renamed $0 x' }]
    expect(feed([text])).toEqual(expected)
    expect(feed(text.split('').map((char) => char))).toEqual(expected)
  })

  it('reads %error as a refusal, and a notification line inside a reply as the reply\'s text', () => {
    expect(feed(['%begin 1 3 1\nparse error: nope\n%error 1 3 1\n'])).toEqual([{ kind: 'reply', exit: 1, text: 'parse error: nope' }])
    expect(feed(['%begin 1 4 1\n%output %0 x\n%end 1 4 1\n'])).toEqual([{ kind: 'reply', exit: 0, text: '%output %0 x' }])
  })

  it('passes every byte through, a line without a newline last', () => {
    const reader = new ControlReader()
    const lines = reader.feed(Buffer.from('%exit\npartial'))
    expect(Buffer.concat(lines.map((entry) => entry.line)).toString()).toBe('%exit\n')
    expect(reader.rest().toString()).toBe('partial')
  })

  it('splits a command line as tmux does, and counts a reply for each command', () => {
    expect(splitCommandLine(`rename-session -t $0 'a b' ; display "x y";`)).toEqual(['rename-session', '-t', '$0', 'a b', ';', 'display', 'x y', ';'])
    expect(commandCount(splitCommandLine('if-shell -F x "" guard ; attach-session -t $0'))).toBe(2)
    expect(commandCount(['-N', '-C', 'if-shell', '-F', 'c', '', 'g', ';', 'attach-session'])).toBe(2)
    expect(commandCount(splitCommandLine('refresh-client -B w::#{x}'))).toBe(1)
  })

  it('tells a control client by its flags, not by a letter in a value', () => {
    expect(isControlInvocation(['-Llibtmux', '-C', 'attach-session'])).toBe(true)
    expect(isControlInvocation(['-CC', 'new'])).toBe(true)
    expect(isControlInvocation(['-LCache', 'list-sessions'])).toBe(false)
    expect(isControlInvocation(['-L', 'C', 'list-sessions'])).toBe(false)
    expect(isControlInvocation(['-V'])).toBe(false)
  })

  it('becomes the real tmux for a control client, with the program\'s input kept on a descriptor a background job can read', () => {
    const script = shimScript({ node: '/usr/bin/node', entry: '/x/core-trace.mjs' })
    expect(script).toContain('exec "$LIBTMUX_DOCS_REAL_TMUX" "$@"')
    expect(script).toContain('exec 3<&0')
    expect(script).toMatch(/control-in .* <&3 /)
    expect(script.indexOf('control-start'), 'the startup command is logged before tmux can answer it').toBeLessThan(script.indexOf('exec "$LIBTMUX_DOCS_REAL_TMUX"'))
  })
})
