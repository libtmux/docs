import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordingProblems, type CoreCapability, type CoreRecording } from '../src/lib/core-recording'

/**
 * Where the Core home players mark a step that runs when its scope ends: where the scope ends, so the markers read in
 * step order (record 0084). The steps are named by the recordings' `scopeExit` field, never by their labels.
 */
const data = (name: string) => new URL(`../src/data/${name}`, import.meta.url)
const home = JSON.parse(readFileSync(data('home-examples.json'), 'utf8'))
const ports = readdirSync(data('core-recordings')).map((file) => file.replace(/\.json$/, ''))
const recording = (port: string): CoreRecording => JSON.parse(readFileSync(data(`core-recordings/${port}.json`), 'utf8'))
/** The program the home page displays for a port, which its recording is of. */
const program = (port: string): string => home[port].files.find((file: { name: string }) => file.name === home[port].program).code
const problems = (port: string, damage: (capability: CoreCapability) => void = () => {}) => {
  const stored = recording(port)
  damage(stored.capabilities['typed-graph']!)
  return recordingProblems(stored, { programs: { 'typed-graph': program(port) } })
}
const scopeExit = (capability: CoreCapability) => capability.steps.find((step) => step.scopeExit)!

describe('the scope-exit steps of the Core home recordings', () => {
  it('are marked at or below every step before them, in every port', () => {
    expect(ports.flatMap((port) => problems(port).map((problem) => `${port}: ${problem}`))).toEqual([])
  })

  // The check reads this field, so a recording that loses it is no longer checked: the set is the check's input.
  it('are the ones the recordings name, and a port that adds one extends this list', () => {
    expect(ports.flatMap((port) => recording(port).capabilities['typed-graph']!.steps.filter((step) => step.scopeExit).map((step) => `${port}:${step.id}`)))
      .toEqual(['csharp:kill', 'erlang:retire', 'go:kill', 'haskell:retire-server', 'lisp:stop-daemon', 'raku:close', 'swift:kill'])
  })

  // Main's anchors: before the markers, each of these steps was marked on the line where its scope opens.
  it.each(['csharp', 'go', 'haskell', 'lisp', 'raku', 'swift'])('are refused in %s when marked at the call, above the steps that ran before', (port) => {
    expect(problems(port, (capability) => {
      const step = scopeExit(capability)
      delete step.marker
      delete step.markerOccurrence
    }).join('\n')).toMatch(/step \d+ \(.+\): runs when its scope ends but is marked on line \d+, above line \d+, where step \d+ \(.+\) is marked/)
  })

  const faults: [string, (capability: CoreCapability) => void, RegExp][] = [
    ['a marker above an earlier step', (capability) => { scopeExit(capability).marker = 'package main' }, /runs when its scope ends but is marked on line 2, above line \d+/],
    ['a marker that is not in the program', (capability) => { scopeExit(capability).marker = 'return 0' }, /its marker "return 0" is not on exactly one line/],
    ['a marker on a step that does not say it runs when its scope ends', (capability) => { delete scopeExit(capability).scopeExit }, /has a marker but does not say it runs when its scope ends/],
  ]
  it.each(faults)('are refused for %s', (_name, damage, message) => {
    expect(problems('go', damage).join('\n')).toMatch(message)
  })

  it('leave a step that does not say it runs when its scope ends alone, as in the programs whose helpers sit above main', () => {
    expect(problems('go', (capability) => {
      const step = scopeExit(capability)
      delete step.scopeExit
      delete step.marker
    }), 'the Kill step on its defer line is out of order, and is not a scope-exit step').toEqual([])
  })
})
