import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, OWNER_KINDS } from '../src/lib/api-models'
import { membersByType } from '../src/lib/api-tree'
import { PORTS } from '../src/lib/ports'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

describe('API Markdown content parity', () => {
  it('preserves example bytes when blank lines and backticks are part of the program', () => {
    const code = 'const output = `first\n\n\nlast`;\nconsole.log(output);\nconsole.log("```");\n'
    const symbol: ApiSymbol = {
      id: 'example', name: 'example', kind: 'function', modifiers: [], signatures: [],
      source: { file: 'example.ts', line: 1 }, doc: { summary: 'Print the literal text.', examples: [{ lang: 'ts', code }] },
    }
    const text = symbolMarkdown({ model: { ...API_MODELS.ts, symbols: [symbol] }, symbol })
    expect(text).toContain(`\`\`\`\`ts\n${code}\`\`\`\``)
  })

  it('preserves parameters from every native overload, including undocumented bindings', () => {
    const model = API_MODELS.scala
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.Server.windows')!
    const text = symbolMarkdown({ model, symbol })
    expect(text).toContain('# io.github.libtmux.scaladsl.Server.windows')
    expect(text).toContain('**Module:** io.github.libtmux.scaladsl\n')
    for (const signature of symbol.signatures) expect(text).toContain(signature.raw)
    expect(text).toContain('## Parameters\n\n- `expression`')
    expect(text).toContain('- `id` (io.github.libtmux.WindowId)')
  })

  it('uses the documented signature and keeps all declarations, warnings and provenance', () => {
    const symbol: ApiSymbol = {
      id: 'Server.capture', name: 'capture', kind: 'method', modifiers: ['overload'],
      source: { file: 'server.ts', line: 1 }, inheritedFrom: 'Base.capture',
      signatures: [
        { params: [{ name: 'limit', type: 'number' }], returns: 'string[]' },
        { params: [{ name: 'options', type: 'CaptureOptions', doc: 'Choose the line range.', since: '1.2', deprecated: 'Use a range.' }],
          returns: 'string[]', returnsDoc: 'The captured lines.', raises: [{ type: 'CaptureError', doc: 'The pane no longer exists.' }] },
      ],
      doc: { summary: 'Read pane output.', deprecated: 'Use Pane.capture.', changed: 'Returns complete lines.',
        admonitions: [{ kind: 'warning', text: 'The pane may exit between commands.' }],
        references: [{ name: 'manual', text: 'The tmux capture-pane manual.' }],
        examples: [{ lang: 'ts', code: 'await pane.capture()', intro: 'Read visible lines.' }] },
    }
    const text = symbolMarkdown({ model: { ...API_MODELS.ts, symbols: [symbol] }, symbol })
    expect(text).toContain('Server.capture(limit: number) -> string[]')
    expect(text).toContain('Server.capture(options: CaptureOptions) -> string[]')
    expect(text).toContain('**Inherited from:** Base.capture')
    expect(text).toContain('## Deprecated\n\nUse Pane.capture.')
    expect(text).toContain('## Changed\n\nReturns complete lines.')
    expect(text).toContain('**warning:** The pane may exit between commands.')
    expect(text).toContain('- [manual] The tmux capture-pane manual.')
    expect(text).toContain('## Parameters\n\n- `options` (CaptureOptions): Choose the line range. (added 1.2) (deprecated Use a range.)')
    expect(text).not.toContain('- `limit`')
    expect(text).toContain('## Returns\n\nThe captured lines.')
    expect(text).toContain('## Raises\n\n- `CaptureError`: The pane no longer exists.')
    expect(text.indexOf('## Examples')).toBeLessThan(text.indexOf('## Parameters'))
  })

  for (const port of PORTS) {
    it(`${port.name} exports use the navigation's semantic order and retain inherited members`, () => {
      const model = API_MODELS[port.slug]
      const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
      const tree = membersByType(port.slug)
      const entry = [...tree.entries()].find(([id, members]) => {
        const owner = byId.get(id) ?? model.symbols.find((symbol) => symbol.publicId === id)
        return owner && OWNER_KINDS.has(owner.kind) && members.length >= 3
      })
      expect(entry, `${port.slug} has an owner with members`).toBeDefined()
      const [id, ordered] = entry!
      const owner = byId.get(id) ?? model.symbols.find((symbol) => symbol.publicId === id)!
      const text = symbolMarkdown({ model, symbol: owner })
      const members = ordered.map((entry) => byId.get(entry.id)!)
      const expected = [...members.filter((member) => !member.inheritedFrom), ...members.filter((member) => member.inheritedFrom)]
        .map((member) => member.name)
      const memberText = text.slice(text.search(/^## (?:Members|Inherited members)$/m))
      const names = [...memberText.matchAll(/^- `([^`]+)` \([a-z]+\)/gm)].map((match) => match[1])
      expect(names).toEqual(expected)
      if (members.some((member) => member.inheritedFrom)) expect(text).toContain('## Inherited members')
    })
  }
})
