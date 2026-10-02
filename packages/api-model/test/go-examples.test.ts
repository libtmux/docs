import { describe, expect, it } from 'vitest'
import { attachCompleteGoExamples, readCompleteGoExamples } from '../src/languages/go-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const source = { repo: 'libtmux/libtmux-go', revision: 'a'.repeat(40), goVersion: '1.26.0' }
const file = 'tmux/api_server_sessions_example_test.go'
const code = `package tmux_test

import "fmt"

// List sessions from the server.
// Keep the returned records for later inspection.
func ExampleServer_Sessions_complete() {
	fmt.Println("sessions: 2")
	// Output:
	// sessions: 2
}
`
const symbol = (): ApiSymbol => ({
  id: 'tmux.Server.Sessions', name: 'Sessions', kind: 'method', parent: 'tmux.Server',
  source: { file: 'tmux/hierarchy.go', line: 7 }, signatures: [],
  doc: { summary: 'Original contract.', examples: [{ lang: 'go', code: 'existing' }] },
})

describe('complete native Go examples', () => {
  it('attaches exact file bytes, description, dependency pin, and native run command', async () => {
    const examples = await readCompleteGoExamples([{ file, code }])
    expect(examples).toEqual([{
      symbol: 'tmux.Server.Sessions', file, code, output: 'sessions: 2',
      intro: 'List sessions from the server.\nKeep the returned records for later inspection.',
    }])
    const target = symbol()
    attachCompleteGoExamples([target], examples, source)
    expect(target.id).toBe('tmux.Server.Sessions')
    expect(target.doc?.summary).toBe('Original contract.')
    const blocks = target.doc!.examples!
    expect(blocks.map((block) => block.lang)).toEqual(['go', 'console', 'go', 'go', 'console'])
    expect(blocks[0].code).toBe('existing')
    expect(blocks[1].code).toBe(`$ git clone https://github.com/libtmux/libtmux-go.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`)
    expect(blocks[2].code).toContain('replace github.com/libtmux/libtmux-go => ./libtmux-source')
    expect(blocks[3].code).toBe(code)
    expect(blocks[3].intro).toContain(`/blob/${source.revision}/${file}`)
    expect(blocks[4].code).toBe('$ GOWORK=off go test -count=1 -v example_test.go\n')
  })

  it('uses native function and receiver-method names for attachment', async () => {
    const examples = await readCompleteGoExamples([
      { file, code: code.replace('Server_Sessions', 'NewServer') },
    ])
    expect(examples[0].symbol).toBe('tmux.NewServer')
  })

  it('omits ordinary examples, tests, and non-test source files', async () => {
    expect(await readCompleteGoExamples([
      { file, code: code.replace('_complete', '') },
      { file, code: code.replace('ExampleServer_Sessions_complete', 'TestServer') },
      { file: 'tmux/server.go', code },
    ])).toEqual([])
  })

  it.each([
    ['missing output', code.replace('// Output:', '// Result:'), /final Output/],
    ['empty output', code.replace('// sessions: 2', '//'), /observable result/],
    ['missing description', code.replace(/\/\/ List sessions[^]*?func/, 'func'), /task description/],
    ['internal package', code.replace('package tmux_test', 'package tmux'), /external test package/],
    ['additional helper', code + '\nfunc helper() {}\n', /one complete Example/],
    ['parameters', code.replace('_complete()', '_complete(n int)'), /cannot have parameters/],
    ['result', code.replace('_complete()', '_complete() int'), /cannot have parameters/],
    ['invalid syntax', code.replace('fmt.Println(', 'fmt.Println(('), /invalid Go syntax/],
    ['code after output', code.replace('// sessions: 2', '// sessions: 2\n\tfmt.Println("extra")'), /final Output/],
  ])('rejects %s', async (_label, invalid, message) => {
    await expect(readCompleteGoExamples([{ file, code: invalid }])).rejects.toThrow(message)
  })

  it('rejects duplicate examples and missing or ambiguous API targets', async () => {
    await expect(readCompleteGoExamples([{ file, code }, { file: 'tmux/other_test.go', code }]))
      .rejects.toThrow(/duplicate example/)
    const examples = await readCompleteGoExamples([{ file, code }])
    expect(() => attachCompleteGoExamples([], examples, source)).toThrow(/resolve once/)
    expect(() => attachCompleteGoExamples([symbol(), symbol()], examples, source)).toThrow(/resolve once/)
  })

  it('rejects mutable refs or missing dependency floors', async () => {
    const examples = await readCompleteGoExamples([{ file, code }])
    expect(() => attachCompleteGoExamples([symbol()], examples, { ...source, revision: 'main' }))
      .toThrow(/full source revision/)
    expect(() => attachCompleteGoExamples([symbol()], examples, { ...source, goVersion: '' }))
      .toThrow(/module Go version/)
  })
})
