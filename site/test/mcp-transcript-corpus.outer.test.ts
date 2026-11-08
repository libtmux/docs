// Scans recorded source files and injected counterexamples across the complete corpus.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { hostLeaks, leaks, recordingLeaks, sanitize, verifySettledPanes, withoutContracts } from '../../scripts/lib/mcp-transcript-checks.mjs'
import type { TmuxState } from '../src/lib/mcp-tmux-state'

type Step = { tool: string; arguments: unknown; isError: boolean; content: unknown[]; structuredContent?: unknown }

it('is satisfied by every committed recording', () => {
    const dir = new URL('../src/data/mcp-transcripts/', import.meta.url)
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
      const recorded = JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as { steps: Step[] }
      const commands = name === 'ruby.json' ? ['cat'] : ['sh']
      expect(() => verifySettledPanes(recorded.steps, { port: name, commands }), name).not.toThrow()
    }
  })

it('finds a path, a user name or a machine name planted in the tmux state of every committed recording, and the rewrite removes it', () => {
    const dir = new URL('../src/data/mcp-transcripts/', import.meta.url)
    const places = ['/home/d', '/tmp/t239', '/var/folders']
    const names = ['d', 'tony-box']
    const plants: [string, string][] = [['a sandbox path', '/tmp/t239-x/project'], ['a home directory', '/home/d/work'], ['a machine name', 'tony-box'], ['a user name', 'd']]
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const recorded = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { tmuxBefore?: TmuxState; steps: { tmux?: TmuxState }[] }
      const states = [recorded.tmuxBefore, ...recorded.steps.map((step) => step.tmux)].filter((state): state is TmuxState => Boolean(state?.windows.length))
      expect(states.length, `${file} carries a state with a window to plant in`).toBeGreaterThan(0)
      expect(leaks(JSON.stringify(withoutContracts(recorded)), places, names), `${file} as recorded`).toEqual([])
      for (const [what, text] of plants) {
        // The plant goes into a window name, which is the free text a state holds, in each state in turn.
        for (const index of states.keys()) {
          const planted = structuredClone(recorded)
          const target = [planted.tmuxBefore, ...planted.steps.map((step) => step.tmux)].filter((candidate): candidate is TmuxState => Boolean(candidate?.windows.length))[index]!
          target.windows[0]!.name = text
          expect(leaks(JSON.stringify(withoutContracts(planted)), places, names), `${file}: ${what} in state ${index}`).not.toEqual([])
          const clean = sanitize(planted, { paths: [['/tmp/t239-x/project', '/home/user/project'], ['/home/d', '/home/user']], names })
          expect(leaks(JSON.stringify(withoutContracts(clean)), places, names), `${file}: ${what} in state ${index} after the rewrite`).toEqual([])
        }
      }
    }
  })

it('has committed recordings that name neither this machine nor the sandbox, and that the rewrite leaves as they are', () => {
    const dir = new URL('../src/data/mcp-transcripts/', import.meta.url)
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(8)
    // d is the name of the machine the recordings were made on; the others are whoever runs this.
    const names = ['d', hostname(), userInfo().username].filter((name) => !['host', 'user'].includes(name))
    for (const name of files) {
      const recorded = withoutContracts(JSON.parse(readFileSync(new URL(name, dir), 'utf8')))
      expect(leaks(JSON.stringify(recorded, null, 2), ['/home/d', '/tmp/t239', '/var/folders'], names), name).toEqual([])
      expect(recordingLeaks(recorded, { places: ['/home/d', '/tmp/t239', '/var/folders'], names, components: ['t239-'] }), `${name}: every parsed value`).toEqual([])
      expect(sanitize(recorded, { names }), `${name} is a fixed point of the rewrite`).toEqual(recorded)
    }
  })

describe('what a finished recording is scanned for before it is written', () => {
  // The checkout is outside the home directory, so a piece of it is not already a place of its own.
  const HOST = { sandbox: '/tmp/t239-ts-AbC123', home: '/home/d', checkout: '/srv/ports/libtmux-ts', listed: '4242:1700000000', user: 'd', machine: 'tony-box' }
  const MARKS = { paths: [['/tmp/t239-ts-AbC123/project', '/home/user/project'], ['4242:1700000000', '3f9a1c']] as [string, string][], names: ['tony-box', 'd'] }
  const dir = new URL('../src/data/mcp-transcripts/', import.meta.url)
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
  type Recorded = { contracts?: unknown; tmuxBefore: TmuxState; steps: { tool: string; tmux: TmuxState; structuredContent?: any; content: { text?: string }[] }[]; sandbox: { rewritten?: unknown } }
  const stateOf = (recorded: Recorded, index: number): TmuxState => (index === 0 ? recorded.tmuxBefore : recorded.steps[index - 1]!.tmux)

  /** What the recorder does with a finished session: the rewrite of every step and of the start, then the one call that scans the transcript. */
  const recorderPipeline = (recorded: Recorded) => {
    const steps = recorded.steps.map((step) => sanitize(step, MARKS))
    const tmuxBefore = sanitize(recorded.tmuxBefore, MARKS)
    return hostLeaks({ ...recorded, tmuxBefore, steps }, HOST)
  }

  const escapedOnce = String.raw`\/tmp\/t239-ts-AbC123`
  let thrice = escapedOnce
  for (let layer = 0; layer < 2; layer++) thrice = JSON.stringify(thrice).slice(1, -1)
  const PLANTS: [string, string][] = [
    ['an escaped sandbox root', escapedOnce],
    ['a triple-escaped sandbox root', thrice],
    ['a percent-encoded sandbox path', encodeURIComponent('/tmp/t239-ts-AbC123/project')],
    ['a percent-encoded home directory', encodeURIComponent('/home/d/work')],
    ['a percent-encoded checkout', encodeURIComponent('/srv/ports/libtmux-ts')],
    ['an escaped, then percent-encoded, checkout', encodeURIComponent(String.raw`\/srv\/ports\/libtmux-ts`)],
    ['the sandbox directory name alone', 't239-ts-AbC123'],
    ['the sandbox directory name in a file name', 'run-t239-ts-AbC123.log'],
    ['the sandbox root as JSON text with split fields', JSON.stringify({ dir: '/tmp', name: 't239-ts-AbC123' })],
    ['the checkout as JSON text with split fields', JSON.stringify({ dir: '/srv/ports', name: 'libtmux-ts' })],
    ['the checkout as JSON text inside JSON text', JSON.stringify({ outer: JSON.stringify({ dir: '/srv/ports/', name: 'libtmux-ts' }) })],
    ['the sandbox root as JSON text, escaped once more', JSON.stringify(JSON.stringify({ path: '/tmp/t239-ts-AbC123' }))],
    ['the process id and start time a Julia server lists, percent-encoded', encodeURIComponent('4242:1700000000')],
    ['a machine name, percent-encoded', 'tony-%62ox'],
    ['a user name as a unicode escape', String.raw`\u0064`],
  ]

  it('passes every committed recording through the recorder\'s own pipeline with nothing named', () => {
    for (const file of files) {
      const recorded = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Recorded
      expect(recorderPipeline(recorded), file).toEqual([])
    }
  })

  it('finds each planted form in the window name of every state of every recording the pipeline is given', () => {
    for (const file of files) {
      const recorded = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Recorded
      // A window name is the free text a state holds; the first state with a window, a middle one and the last.
      const withWindow = Array.from({ length: recorded.steps.length + 1 }, (_, index) => index).filter((index) => stateOf(recorded, index).windows.length > 0)
      expect(withWindow.length, `${file} has states with a window to plant in`).toBeGreaterThan(1)
      for (const [what, text] of PLANTS) {
        for (const index of new Set([withWindow[0]!, withWindow[Math.floor(withWindow.length / 2)]!, withWindow.at(-1)!])) {
          const planted = structuredClone(recorded)
          stateOf(planted, index).windows[0]!.name = text
          expect(recorderPipeline(planted), `${file}: ${what} in state ${index}`).not.toEqual([])
        }
      }
    }
  })

  it('finds a path split into the fields of an object or the entries of a list, in a result and in a request', () => {
    const recorded = JSON.parse(readFileSync(new URL('ts.json', dir), 'utf8')) as Recorded
    const splits: [string, (planted: Recorded) => void][] = [
      ['a sandbox directory and name in a result', (planted) => { planted.steps[0]!.structuredContent.where = { dir: '/tmp', name: 't239-ts-AbC123' } }],
      ['a checkout split into its directory and name', (planted) => { planted.steps[0]!.structuredContent.where = { cwd: '/srv/ports/', repo: 'libtmux-ts' } }],
      ['a path as two neighbouring entries', (planted) => { planted.steps[0]!.structuredContent.argv = ['cd', '/srv/ports', 'libtmux-ts'] }],
      ['an escaped path in a pane\'s output', (planted) => { planted.steps[0]!.content = [{ text: String.raw`{"cwd":"\\/tmp\\/t239-ts-AbC123\\/x"}` }] }],
      ['a key', (planted) => { planted.steps[0]!.structuredContent[String.raw`\/tmp\/t239-ts-AbC123`] = true }],
    ]
    for (const [what, plant] of splits) {
      const planted = structuredClone(recorded)
      planted.steps[0]!.structuredContent ??= {}
      plant(planted)
      expect(recorderPipeline(planted), what).not.toEqual([])
    }
  })

  it('has controls: the paths a recording is allowed to hold, a path outside the host, and the token for a generation pass', () => {
    const recorded = JSON.parse(readFileSync(new URL('ts.json', dir), 'utf8')) as Recorded
    const clean = (text: string) => {
      const planted = structuredClone(recorded)
      stateOf(planted, 1).windows[0]!.name = text
      return recorderPipeline(planted)
    }
    for (const text of ['/home/user/project', String.raw`\/home\/user\/project`, encodeURIComponent('/home/user/project'), '3f9a1c', '100%', '50%25 done', String.raw`\d+`, JSON.stringify({ dir: '/home/user', name: 'project' }), 't239']) {
      expect(clean(text), text).toEqual([])
    }
  })

  it('rewrites a path the sandbox project is under, with its slashes escaped or not, before the scan sees it', () => {
    const recorded = JSON.parse(readFileSync(new URL('ts.json', dir), 'utf8')) as Recorded
    for (const text of ['/tmp/t239-ts-AbC123/project', String.raw`{"path":"\/tmp\/t239-ts-AbC123\/project"}`]) {
      const planted = structuredClone(recorded)
      planted.steps[0]!.content = [{ text }]
      expect(recorderPipeline(planted), text).toEqual([])
      expect(JSON.stringify(sanitize(planted.steps[0], MARKS))).toContain('home')
    }
  })

  it('says where it found each, and scans the serialized text as a second layer', () => {
    const recorded = JSON.parse(readFileSync(new URL('ts.json', dir), 'utf8')) as Recorded
    const planted = structuredClone(recorded)
    stateOf(planted, 2).windows[0]!.name = String.raw`\/tmp\/t239-ts-AbC123`
    const found = hostLeaks(planted, HOST)
    expect(found).toContain('/tmp/t239-ts-AbC123 ($.steps[1].tmux.windows[0].name)')
    expect(found.some((item) => item.endsWith('(in the serialized text)'))).toBe(true)
    // Reached only by the serialized text: a number's digits never form a string, but a key joined to a value does.
    expect(leaks(JSON.stringify({ steps: [{ tmux: { windows: [{ name: String.raw`\/tmp\/t239-ts-AbC123` }] } }] }, null, 2), ['/tmp/t239-ts-AbC123'])).toEqual(['/tmp/t239-ts-AbC123'])
  })

  it('leaves the contracts out, and finds the host in everything else, as before', () => {
    const recorded = JSON.parse(readFileSync(new URL('ts.json', dir), 'utf8')) as Recorded
    const withContract = structuredClone(recorded)
    withContract.contracts = { kill_pane: { inputSchema: { properties: { pane: { pattern: String.raw`^%\d+$` } } } } }
    expect(hostLeaks(withContract, HOST)).toEqual([])
  })
})
