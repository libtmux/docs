import { describe, expect, it } from 'vitest'
import { listedBy, listedValue, recordCalls, refusalCode, standInCalls, standInControls, withListed } from '../../scripts/lib/mcp-session.mjs'

/**
 * A stdio MCP server in a few lines: `list` answers with a generation, and
 * `use` is refused as `stale_target` unless it is sent that generation.
 */
const SERVER = `
const GENERATION = '4242:1700000000'
let buffer = ''
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (const line of buffer.split('\\n').slice(0, -1)) {
    const message = JSON.parse(line)
    if (message.method === 'initialize') send(message.id, { serverInfo: { name: 'fake' } })
    if (message.method === 'tools/call' && message.params.name === 'list') send(message.id, { content: [], structuredContent: { panes: [{ target: { generation: GENERATION } }] } })
    if (message.method === 'tools/call' && message.params.name === 'use') {
      const stale = message.params.arguments.target.generation !== GENERATION
      send(message.id, { isError: stale, content: [], structuredContent: stale ? { code: 'stale_target' } : { code: 'ok' } })
    }
  }
  buffer = buffer.slice(buffer.lastIndexOf('\\n') + 1)
})
process.stdin.on('end', () => process.exit(0))
`
const run = (calls: Parameters<typeof recordCalls>[0]['calls'], controls: Parameters<typeof recordCalls>[0]['controls'] = []) => recordCalls({ command: process.execPath, args: ['-e', SERVER], calls, controls, pauseMs: 0, callTimeoutMs: 10000 })

describe('a call that needs a value only an earlier result returns', () => {
  const stand = { target: { paneId: '%0', generation: '3f9a1c' } }

  it('is sent the value the listing returned, and the step records what was sent', async () => {
    const { steps } = await run([{ tool: 'list', arguments: {} }, { tool: 'use', arguments: withListed(stand, '3f9a1c', 'generation') }])
    expect(steps[1]).toMatchObject({ isError: false, arguments: { target: { paneId: '%0', generation: '4242:1700000000' } } })
  })

  it('has a control: the stand-in itself is refused as stale_target, so the swap is what makes the call work', async () => {
    const { steps } = await run([{ tool: 'list', arguments: {} }, { tool: 'use', arguments: stand }])
    expect(steps[1]).toMatchObject({ isError: true, arguments: stand, structuredContent: { code: 'stale_target' } })
  })

  it('refuses to send the stand-in when no earlier result returned the value', async () => {
    await expect(run([{ tool: 'use', arguments: withListed(stand, '3f9a1c', 'generation') }])).rejects.toThrow(/no earlier result returned a "generation"/)
  })

  it('finds the value at any depth, takes the first, and ignores a value that is not a string', () => {
    const step = (structuredContent: unknown) => ({ structuredContent })
    expect(listedValue([step({ a: [{ b: { generation: 'one' } }, { generation: 'two' }] })], 'generation')).toBe('one')
    expect(listedValue([step({ generation: 7 }), step(undefined), step({ x: { generation: 'later' } })], 'generation')).toBe('later')
    expect(listedValue([step({ other: 'x' })], 'generation')).toBeUndefined()
  })
})

describe('the calls the recorder sends for an example that holds a stand-in', () => {
  const example = [
    { tool: 'list', arguments: {} },
    { tool: 'use', arguments: { target: { paneId: '%0', generation: '3f9a1c' } } },
    { tool: 'list', arguments: { note: 'no stand-in here' } },
  ]

  it('swaps the stand-in in the calls that carry it, sends the others as written, and the recorded step keeps what went out', async () => {
    const calls = standInCalls(example, '3f9a1c', 'generation')
    expect(calls.map((call) => typeof call.arguments)).toEqual(['object', 'function', 'object'])
    expect(calls[0]!.arguments).toBe(example[0]!.arguments)
    expect(calls[2]!.arguments).toBe(example[2]!.arguments)
    const { steps } = await run(calls)
    expect(steps[1]).toMatchObject({ isError: false, arguments: { target: { paneId: '%0', generation: '4242:1700000000' } }, structuredContent: { code: 'ok' } })
    expect(JSON.stringify(steps.map((step) => step.arguments)), 'the stand-in never went out').not.toContain('3f9a1c')
  })

  it('has a control: the example sent as written is refused as stale_target', async () => {
    const { steps } = await run(example)
    expect(steps[1]).toMatchObject({ isError: true, structuredContent: { code: 'stale_target' } })
  })

  it('refuses to send a call that carries the stand-in before any result lists the value', async () => {
    await expect(run(standInCalls(example.slice(1), '3f9a1c', 'generation'))).rejects.toThrow(/no earlier result returned a "generation" to send in place of 3f9a1c/)
  })

  it('leaves every call as written when the example has no stand-in', () => {
    expect(standInCalls(example, undefined, 'generation').map((call) => call.arguments)).toEqual(example.map((call) => call.arguments))
    expect(standInCalls(example, '', 'generation').every((call) => typeof call.arguments === 'object')).toBe(true)
  })
})

describe('the control calls of a recording', () => {
  const example = [
    { tool: 'list', arguments: {} },
    { tool: 'use', arguments: { target: { paneId: '%0', generation: '3f9a1c' } } },
    { tool: 'use', arguments: { target: { paneId: '%1', generation: '3f9a1c' } } },
  ]

  it('makes the stand-in call as written once the example is done, in the same session, and keeps its answer out of the steps', async () => {
    const controls = standInControls(example, '3f9a1c')
    expect(controls).toEqual([{ tool: 'use', arguments: example[1]!.arguments }])
    const { steps, controls: answered } = await run([...standInCalls(example.slice(0, 2), '3f9a1c', 'generation')], controls)
    expect(steps.map((step) => step.tool)).toEqual(['list', 'use'])
    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ tool: 'use', isError: true, arguments: { target: { generation: '3f9a1c' } } })
    expect(refusalCode(answered[0])).toBe('stale_target')
    expect(refusalCode(steps[1]), 'a call the server accepted has no refusal').toBeUndefined()
  })

  it('has no control without a stand-in, and finds the code of a refusal wherever the server puts it', () => {
    expect(standInControls(example, undefined)).toEqual([])
    expect(standInControls(example.slice(0, 1), '3f9a1c')).toEqual([])
    expect(refusalCode({ isError: true, structuredContent: { error: { code: 'stale_target' } } })).toBe('stale_target')
    expect(refusalCode({ isError: false, structuredContent: { code: 'ok' } })).toBeUndefined()
    expect(refusalCode(undefined)).toBeUndefined()
  })

  it('names the tool that returned the value', async () => {
    const { steps } = await run([example[0]!])
    expect(listedBy(steps, 'generation')).toBe('list')
    expect(listedBy(steps, 'nothing')).toBeUndefined()
  })
})

describe('the state a recording reads after each call', () => {
  const calls = [{ tool: 'list', arguments: {} }, { tool: 'list', arguments: {} }, { tool: 'list', arguments: {} }]

  it('reads once before the first call and after each, and stores the state on its step', async () => {
    const { before, steps } = await recordCalls({ command: process.execPath, args: ['-e', SERVER], calls, pauseMs: 0, callTimeoutMs: 10000, observe: (step) => ({ after: step ? step.tool : null }) })
    expect(before).toEqual({ after: null })
    expect(steps.map((step) => step.tmux)).toEqual([{ after: 'list' }, { after: 'list' }, { after: 'list' }])
  })

  it('reads a state only once the pause that stands for an agent reading the result has passed', async () => {
    const times: number[] = []
    await recordCalls({ command: process.execPath, args: ['-e', SERVER], calls, pauseMs: 80, callTimeoutMs: 10000, observe: () => { times.push(Date.now()) } })
    expect(times).toHaveLength(calls.length + 1)
    for (let at = 1; at < times.length; at++) expect(times[at]! - times[at - 1]!, `read ${at}`).toBeGreaterThanOrEqual(70)
  })

  it('ends the session with the error when a state cannot be read, so no step is recorded without one', async () => {
    const failing = recordCalls({ command: process.execPath, args: ['-e', SERVER], calls, pauseMs: 0, callTimeoutMs: 10000, observe: (step) => { if (step) throw new Error('tmux could not be read') } })
    await expect(failing).rejects.toThrow('tmux could not be read')
  })

  it('stores no state, and returns none, when nothing reads it', async () => {
    const recorded = await run(calls)
    expect(recorded).not.toHaveProperty('before')
    expect(recorded.steps.every((step) => !('tmux' in step))).toBe(true)
  })
})
