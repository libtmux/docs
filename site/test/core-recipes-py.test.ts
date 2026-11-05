import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECIPES, withoutMarks } from '../../scripts/lib/core-recipes/py.mjs'
import { sandboxSockets } from '../../scripts/lib/mcp-tmux-state.mjs'
import home from '../src/data/home-examples.json'

const recipe = RECIPES['typed-graph']
const code = home.py.files[0]!.code

describe('Python recipe', () => {
  const marked = recipe.instrument(code, recipe.steps)
  it('adds only marker lines to the displayed program', () => {
    expect(withoutMarks(marked)).toBe(code)
  })
  it('marks every call except the one the program makes in a while condition, which the wrapper marks', () => {
    const body = marked.slice(marked.indexOf('libtmux.Pane.capture_pane = '))
    const marks = body.split('\n').filter((line) => line.trimStart().startsWith('docs_mark("'))
    expect(marks.map((line) => /docs_mark\("([^"]+)"/.exec(line)?.[1])).toEqual(recipe.steps.filter((step) => !step.wrapped).map((step) => step.id))
    expect(marked).toContain('libtmux.Pane.capture_pane = _docs_wrap_capture')
  })
  it('refuses an anchor the program does not hold', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: 'server.nope(', value: 'None' }])).toThrow(/not on exactly one line/)
  })
})

describe('sandbox sockets', () => {
  it('finds a socket in a directory under tmp, where tempfile.mkdtemp puts one', async () => {
    const sandbox = mkdtempSync('/tmp/libtmux-docs-test-')
    const directory = join(sandbox, 'tmp', 'made')
    mkdirSync(directory, { recursive: true })
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(join(directory, 'tmux.sock'), resolve))
    try {
      expect(sandboxSockets(sandbox)).toEqual([join(directory, 'tmux.sock')])
    } finally {
      server.close()
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
