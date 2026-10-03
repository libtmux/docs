import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../src/model.ts'
import { attachCompleteLuaExamples, type LuaExampleManifest } from '../src/languages/lua-examples.ts'

const source = { repository: 'libtmux/libtmux-lua', revision: 'a'.repeat(40) }
const program = 'local text = "<literal>"\nprint(text)\n'
const launcher = '#!/bin/sh\nset -eu\nlua "$1"\n'
const files = [
  { path: 'examples/api/connect.lua', content: program },
  { path: 'examples/api/run.sh', content: launcher },
  { path: 'examples/ordinary.lua', content: 'print("not a complete example")\n' },
]
const manifest = (): LuaExampleManifest => ({
  schema: 1,
  setup: { lua: '5.5.1', luv: '1.52.1-0', launcher: 'examples/api/run.sh' },
  examples: [{ id: 'connect', symbols: ['libtmux.Runtime:connect'], file: 'examples/api/connect.lua',
    description: 'Connect to a tmux daemon.', stdout: 'connected\n' }],
})
const target = (): ApiSymbol => ({
  id: 'libtmux.Runtime:connect', name: 'connect', kind: 'method', modifiers: [], signatures: [],
  source: { file: 'lua/libtmux/_internal/runtime.lua', revision: source.revision },
  doc: { summary: 'Existing native documentation.' },
})

describe('complete Lua API examples from native artifacts', () => {
  it('retains native docs, exact full files, pinned setup, and both source links', () => {
    const symbol = target()
    attachCompleteLuaExamples([symbol], manifest(), files, source)
    expect(symbol.doc?.summary).toBe('Existing native documentation.')
    const examples = symbol.doc!.examples!
    expect(examples).toHaveLength(4)
    expect(examples[1].code).toBe(launcher)
    expect(examples[2].code).toBe(program)
    expect(examples[1].sourceUrl).toBe(`https://github.com/${source.repository}/blob/${source.revision}/examples/api/run.sh`)
    expect(examples[2].sourceUrl).toBe(`https://github.com/${source.repository}/blob/${source.revision}/examples/api/connect.lua`)
    expect(examples[0].code).toContain(`git -C libtmux-source checkout ${source.revision}`)
    expect(examples[0].code).toContain('luarocks --tree ./rocks install luv 1.52.1-0')
    expect(examples[3].code).toBe('$ eval "$(luarocks --tree ./rocks path)" &&\n  sh run.sh connect.lua\n')
    expect(examples.some((example) => example.code.includes('not a complete example'))).toBe(false)
  })

  it('preserves historical native artifacts without the opt-in manifest', () => {
    const symbol = target()
    const before = structuredClone(symbol)
    attachCompleteLuaExamples([symbol], undefined, files, source)
    expect(symbol).toEqual(before)
  })

  it('rejects missing or ambiguous full-file payloads and changed line endings', () => {
    for (const invalid of [files.slice(0, 1), [...files, files[0]],
      files.map((file) => ({ ...file, content: file.content.replaceAll('\n', '\r\n') }))]) {
      expect(() => attachCompleteLuaExamples([target()], manifest(), invalid, source)).toThrow()
    }
  })

  it('rejects unknown and duplicate API targets', () => {
    expect(() => attachCompleteLuaExamples([], manifest(), files, source)).toThrow(/resolve once/)
    const value = manifest()
    value.examples[0].symbols.push('libtmux.Runtime:connect')
    expect(() => attachCompleteLuaExamples([target()], value, files, source)).toThrow(/duplicate API target/)
  })

  it('rejects unsafe paths and absent runtime or output contracts', () => {
    for (const mutate of [
      (value: LuaExampleManifest) => { value.setup.launcher = '../run.sh' },
      (value: LuaExampleManifest) => { value.examples[0].file = '../../connect.lua' },
      (value: LuaExampleManifest) => { value.setup.lua = 'latest' },
      (value: LuaExampleManifest) => { value.setup.luv = 'latest' },
      (value: LuaExampleManifest) => { value.examples[0].stdout = '' },
      (value: LuaExampleManifest) => { value.examples[0].description = '' },
    ]) {
      const value = manifest()
      mutate(value)
      expect(() => attachCompleteLuaExamples([target()], value, files, source)).toThrow()
    }
    expect(() => attachCompleteLuaExamples([target()], manifest(), files, { ...source, revision: 'main' }))
      .toThrow(/full revision/)
    expect(() => attachCompleteLuaExamples([target()], manifest(), files, { ...source, repository: 'other/repo' }))
      .toThrow(/Lua repository/)
  })
})
