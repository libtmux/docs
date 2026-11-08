import { describe, expect, it } from 'vitest'
import { attachCompleteClojureExamples } from '../src/languages/clojure-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const source = { repo: 'libtmux/libtmux-java', revision: 'a'.repeat(40) }
const fixture = (launcher: boolean) => {
  const program = {
    id: 'clojure-Connect', variant: 'clojure', language: 'clojure', description: 'Connect to a private tmux server.',
    mainNamespace: 'libtmux.examples.api.connect', targets: ['libtmux.core/open!'], expectedOutput: 'connected=true\n',
    sourceFile: 'examples/src/main/clojure/libtmux/examples/api/connect.clj',
    path: 'src/main/clojure/libtmux/examples/api/connect.clj',
  }
  const setup = [
    { sourceFile: 'examples/api/clojure/deps.edn', path: 'deps.edn' },
    ...(launcher ? [{ sourceFile: 'examples/api/run.sh', path: 'run.sh' }] : []),
  ]
  const manifest = { schemaVersion: 1, examples: [program], variants: { clojure: { files: setup } } }
  const files = new Map<string, string>([
    [program.sourceFile, '(ns libtmux.examples.api.connect)\n'],
    ['examples/api/clojure/deps.edn', '{:paths ["src/main/clojure"]}\n'],
    ['examples/api/run.sh', '#!/bin/sh\n'],
  ])
  const symbols = [{
    id: 'libtmux.core/open!', publicId: 'libtmux.core/open!', qualifiedName: 'libtmux.core/open!', name: 'open!',
    kind: 'function', modifiers: [], signatures: [], slug: 'open', source: { file: 'core.clj' }, doc: { summary: 'Opens.' },
  }] as unknown as ApiSymbol[]
  const read = (path: string) => path === 'examples/api/clojure/manifest.json' ? JSON.stringify(manifest) : files.get(path)
  return { manifest, symbols, read }
}

describe('complete Clojure API programs', () => {
  it('shows the launcher where the revision ships one', () => {
    const { symbols, read } = fixture(true)
    attachCompleteClojureExamples(symbols, read, source)
    const blocks = symbols[0].doc!.examples!
    expect(blocks.map((block) => block.lang)).toEqual(['console', 'clojure', 'sh', 'clojure', 'console', 'text'])
    expect(blocks[3].intro).toContain("launcher's server")
    expect(blocks[4].code).toBe('$ sh run.sh clojure \\\n  -J-Dclojure.main.report=stderr \\\n  -M \\\n  -m libtmux.examples.api.connect\n')
  })

  it('shows a program that starts its own server without a launcher', () => {
    const { symbols, read } = fixture(false)
    attachCompleteClojureExamples(symbols, read, source)
    const blocks = symbols[0].doc!.examples!
    expect(blocks.map((block) => block.lang)).toEqual(['console', 'clojure', 'clojure', 'console', 'text'])
    expect(blocks[3].code).toBe('$ clojure \\\n  -J-Dclojure.main.report=stderr \\\n  -M \\\n  -m libtmux.examples.api.connect\n')
    const prose = blocks.map((block) => `${block.intro ?? ''}\n${block.code}`).join('\n')
    expect(prose).not.toMatch(/run\.sh|launcher|TMUX_BIN/)
  })

  it('still requires deps.edn and refuses other setup files', () => {
    const { manifest, symbols, read } = fixture(false)
    manifest.variants.clojure.files.pop()
    expect(() => attachCompleteClojureExamples(symbols, read, source)).toThrow('Invalid Clojure example catalog or setup')
    const other = fixture(false)
    other.manifest.variants.clojure.files[0].path = 'other.edn'
    expect(() => attachCompleteClojureExamples(other.symbols, other.read, source)).toThrow('Invalid Clojure example catalog or setup')
  })
})
