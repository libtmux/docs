import { describe, expect, it } from 'vitest'
import { listedValue, refusalCode, requireRefusal, standInCalls, standInControls } from '../../scripts/lib/mcp-session.mjs'

describe('a call that needs a value only an earlier result returns', () => {

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

  it('has no control without a stand-in, and finds the code of a refusal wherever the server puts it', () => {
    expect(standInControls(example, undefined)).toEqual([])
    expect(standInControls(example.slice(0, 1), '3f9a1c')).toEqual([])
    expect(refusalCode({ isError: true, structuredContent: { error: { code: 'stale_target' } } })).toBe('stale_target')
    expect(refusalCode({ isError: false, structuredContent: { code: 'ok' } })).toBeUndefined()
    expect(refusalCode(undefined)).toBeUndefined()
  })

  it('requires the refusal to be the code the page documents, not any refusal', () => {
    const refused = (code: string) => ({ isError: true, structuredContent: { error: { code } } })
    const options = { port: 'julia', standIn: '3f9a1c', expected: 'stale_target', listedBy: 'list_panes' }
    expect(requireRefusal(refused('stale_target'), options)).toBe('stale_target')
    expect(() => requireRefusal(refused('invalid_target'), options)).toThrow('julia: the server refused 3f9a1c as invalid_target, not stale_target, so the recording cannot say a call must send the value list_panes returned')
    expect(() => requireRefusal({ isError: false, structuredContent: { code: 'ok' } }, options)).toThrow(/did not refuse 3f9a1c/)
    expect(() => requireRefusal(undefined, options)).toThrow(/did not refuse 3f9a1c/)
    expect(() => requireRefusal({ isError: true, structuredContent: {} }, options), 'a refusal that carries no code').toThrow(/did not refuse/)
  })

})
