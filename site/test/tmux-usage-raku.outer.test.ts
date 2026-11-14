import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nativeRakuScan, scanRaku } from '../../scripts/lib/tmux-usage-raku.mjs'
import { settleCandidates, sweepCandidates } from '../../scripts/lib/tmux-usage-sweep.mjs'

// Outer: the native compiler parses trusted source in a subprocess.
describe('Raku command source', () => {
  it('uses native declarations and literals without crediting documentation or builders', () => {
    const text = [
      'class Pane {',
      '  # method fake { "kill-pane" }',
      '  method capture { say <capture-pane -p> }',
      '  method label { q[method fake { "kill-pane" }] }',
      '  method callback { my &invoke = sub (|capture) { say <display-message> }; invoke() }',
      '}',
      '=begin pod',
      'method fake { "kill-pane" }',
      '=end pod',
    ].join('\n')
    const native = nativeRakuScan(text)
    const model = JSON.parse(readFileSync(new URL('../src/data/api/raku.json', import.meta.url), 'utf8'))
    expect(native.compiler).toBe(model.nativeProvenance.exporter.compiler)
    const scanned = scanRaku(text, native, { commands: new Set(['capture-pane', 'kill-pane', 'display-message']), known: new Set(['capture-pane', 'kill-pane', 'display-message']) })
    expect(scanned.functions.map((fn: { name: string; owner?: string; start: number; end: number }) =>
      [fn.name, fn.owner, fn.start, fn.end])).toEqual([
      ['capture', 'Pane', 3, 3], ['label', 'Pane', 4, 4], ['callback', 'Pane', 5, 5],
    ])
    expect(scanned.functions[0].sites).toEqual([expect.objectContaining({ command: 'capture-pane', line: 3, dispatch: null })])
    expect(scanned.functions[1].sites).toEqual([])
    expect(scanned.functions[2].sites).toEqual([expect.objectContaining({ command: 'display-message', line: 5, dispatch: null })])
    expect(() => scanRaku(`${text}\n`, native, { commands: new Set(), known: new Set() })).toThrow('exact bytes')
    const { candidates } = sweepCandidates({ port: 'raku', commands: ['capture-pane'], has: new Set(), symbols: [
      { id: 'Pane.capture', name: 'capture', parentName: 'Pane', file: 'lib/Pane.rakumod', kind: 'method' },
    ] })
    expect(settleCandidates({ port: 'raku', candidates, reviews: [] }).unreviewed).toHaveLength(1)
  })
})
