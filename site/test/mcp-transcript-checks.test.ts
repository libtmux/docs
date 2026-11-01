import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { idsIn, leaks, sanitize, verifyRecording } from '../../scripts/lib/mcp-transcript-checks.mjs'

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

describe('keeping the host out of a recording', () => {
  const marks = { paths: [['/tmp/t239-x/project', '/home/user/project']] as [string, string][], names: ['d'] }

  it('refuses a name of any length as a token or a quoted value, in a string or in JSON inside one', () => {
    expect(leaks('{"pane_title":"d"}', [], ['d'])).toEqual(['d'])
    expect(leaks('{\\"pane_title\\":\\"d\\"}', [], ['d'])).toEqual(['d'])
    expect(leaks('logged in as d on host d', [], ['d'])).toEqual(['d'])
    expect(leaks('ran in /tmp/t239-x/project', ['/tmp/t239-x'], [])).toEqual(['/tmp/t239-x'])
  })

  it('does not take a name for part of a longer word, path, option or file name', () => {
    for (const text of ['id and sidebar and d2 and a-d and -d flag', '/home/d/x', 'pytest.d', '"idle"']) expect(leaks(text, [], ['d']), text).toEqual([])
  })

  it('rewrites a name and a path wherever they are, inside embedded JSON too, and leaves other text alone', () => {
    const recorded = { title: 'd', text: '{"pane_title":"d","path":"/tmp/t239-x/project","id":"%0"}', lines: ['d@d:/tmp/t239-x/project$ ls', 'id -d'] }
    const clean = sanitize(recorded, marks)
    expect(clean).toEqual({ title: 'host', text: '{"pane_title":"host","path":"/home/user/project","id":"%0"}', lines: ['host@host:/home/user/project$ ls', 'id -d'] })
    expect(leaks(JSON.stringify(clean), ['/tmp/t239-x'], ['d'])).toEqual([])
    expect(sanitize(clean, marks), 'rewriting twice changes nothing').toEqual(clean)
  })

  it('has committed recordings that name neither this machine nor the sandbox, and that the rewrite leaves as they are', () => {
    const dir = new URL('../src/data/mcp-transcripts/', import.meta.url)
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(8)
    // d is the name of the machine the recordings were made on; the others are whoever runs this.
    const names = ['d', hostname(), userInfo().username].filter((name) => !['host', 'user'].includes(name))
    for (const name of files) {
      const text = readFileSync(new URL(name, dir), 'utf8')
      expect(leaks(text, ['/home/d', '/tmp/t239', '/var/folders'], names), name).toEqual([])
      expect(sanitize(JSON.parse(text), { names }), `${name} is a fixed point of the rewrite`).toEqual(JSON.parse(text))
    }
  })
})
