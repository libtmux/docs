/**
 * The concept records behind the panel workspace. Outer loop: they read every
 * port's generated model through `equivalentsFor`, which takes about ten seconds.
 */
import { describe, expect, it } from 'vitest'
import { workspaceConcepts } from '../src/lib/panels/concept-data'

describe('workspace concepts', () => {
  const index = workspaceConcepts()

  it('accounts for every port of every concept exactly once: mapped, a recorded reason, or unmapped', () => {
    for (const c of index.list) {
      const places = [...c.rows.map((r) => r.port), ...Object.keys(c.absent), ...c.unmapped].sort()
      expect(places, c.id).toEqual(index.ports.map((p) => p.slug).sort())
    }
  })

  it('takes rows, chips and the summary from equivalentsFor, relative to the Go symbol', () => {
    const capture = index.byId.get('capture-pane')!
    expect(capture.primary).toBe('go')
    expect(capture.summary).toMatch(/^Capture captures printed content/)
    expect(capture.rows.find((r) => r.port === 'go')!.chips).toEqual([])
    expect(capture.rows.find((r) => r.port === 'rs')!.chips).toContain('async')
    expect(capture.rows.find((r) => r.port === 'py')!.chips.some((c) => c.endsWith('overloads'))).toBe(true)
  })

  it('keeps ids unique so a locator names one concept', () => {
    expect(new Set(index.list.map((c) => c.id)).size).toBe(index.list.length)
    expect(index.byId.has('send-keys')).toBe(true)
  })
})
