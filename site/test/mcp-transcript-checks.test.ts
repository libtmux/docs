import { describe, expect, it } from 'vitest'
import { idsIn, leaks, verifyRecording } from '../../scripts/lib/mcp-transcript-checks.mjs'

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

  it('finds ids and host names in text', () => {
    expect([...idsIn({ a: '%0', b: ['$1', '@22'] })].sort()).toEqual(['$1', '%0', '@22'])
    expect(leaks('ran in /home/someone/work', ['/home/someone', 'x', ''])).toEqual(['/home/someone'])
  })
})
