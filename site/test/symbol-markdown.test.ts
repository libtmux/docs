import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, OWNER_KINDS } from '../src/lib/api-models'
import { membersByType } from '../src/lib/api-tree'
import { PORTS, PORT_BY_SLUG, referenceUrl } from '../src/lib/ports'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

function inlineCodes(text: string): string[] {
  const values: string[] = []
  type Node = { type: string; value?: string; children?: Node[] }
  const collect = (node: Node) => {
    if (node.type === 'inlineCode') values.push(node.value!)
    for (const child of node.children ?? []) collect(child)
  }
  collect(fromMarkdown(text))
  return values
}

describe('API Markdown content parity', () => {
  it('exports parent objects ahead of the collections and operations they own', () => {
    const model = API_MODELS.java
    const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.Window.Window')!
    const text = symbolMarkdown({ model, symbol })
    const parents = text.slice(text.indexOf('### Parent objects'), text.indexOf('### Collections and queries'))
    expect([...parents.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1])).toEqual(['session', 'server'])
    expect(text.indexOf('### Parent objects')).toBeLessThan(text.indexOf('### Collections and queries'))
  })

  it('keeps a publicly inherited C++ server accessor with its parent objects', () => {
    const model = API_MODELS.cxx
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux::Pane')!
    const text = symbolMarkdown({ model, symbol })
    const parents = text.slice(text.indexOf('### Parent objects')).split(/\n### /)[0]
    expect([...parents.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1])).toEqual(['window', 'session', 'server'])
    expect(parents).toContain('inherited from `libtmux::detail::Row`')
  })

  it('links the F# lookup error to its .NET API in copied Markdown', () => {
    const model = API_MODELS.fsharp
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.FSharp.Server.tryFindClient')!
    expect(symbolMarkdown({ model, symbol })).toContain(
      '[`System.ArgumentException`](https://learn.microsoft.com/dotnet/api/system.argumentexception)',
    )
  })

  it('prefers a library error over a same-named .NET exception in the selected version', () => {
    const error: ApiSymbol = {
      id: 'LibTmux.ArgumentException',
      name: 'ArgumentException',
      kind: 'class',
      modifiers: [],
      signatures: [],
      source: { file: 'example.fs' },
      slug: 'argument-exception',
    }
    const symbol: ApiSymbol = {
      id: 'LibTmux.sample',
      name: 'sample',
      kind: 'function',
      modifiers: [],
      signatures: [{ params: [], raises: [{ type: 'ArgumentException', doc: 'A library error.' }] }],
      source: { file: 'example.fs' },
      slug: 'sample',
    }
    const model = { ...API_MODELS.fsharp, symbols: [error, symbol] }
    const text = symbolMarkdown({ model, symbol, version: 'stable' })
    expect(text).toContain(
      '[`ArgumentException`](' + referenceUrl(PORT_BY_SLUG.fsharp, 'stable') + 'argument-exception/)',
    )
    expect(text).not.toContain('learn.microsoft.com')
  })

  it('keeps escaped Kotlin and Scala names literal in overload labels', () => {
    for (const [port, id, expected] of [
      ['kotlin', 'io.github.libtmux.kotlin.Hooks.`set`', '`set`(event, command) [overload 1]'],
      ['scala', 'io.github.libtmux.scaladsl.cats.CommandChain.`then`', '`then`(argv)'],
    ]) {
      const model = API_MODELS[port]
      const symbol = model.symbols.find((entry) => entry.id === id)!
      expect(inlineCodes(symbolMarkdown({ model, symbol }))).toContain(expected)
    }
  })

  it('preserves escaped parameter names and generic types as literal code', () => {
    const model = API_MODELS.kotlin
    for (const symbol of model.symbols.filter((entry) =>
      entry.signatures.some((signature) => signature.params.some((param) => param.name.includes('`'))),
    )) {
      const codes = inlineCodes(symbolMarkdown({ model, symbol }))
      for (const signature of symbol.signatures) {
        for (const param of signature.params) {
          expect(codes, symbol.id).toContain(param.name)
          if (param.type) expect(codes, symbol.id).toContain(param.type)
        }
      }
    }
  })

  it('retains earlier overload contracts instead of replacing them with an undocumented final overload', () => {
    const model = API_MODELS.kotlin
    for (const name of ['session', 'window', 'pane']) {
      const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.kotlin.Server.${name}`)!
      const text = symbolMarkdown({ model, symbol })
      expect(text).toContain('## Raises')
      expect(text).toContain('NoMatch')
      expect(text).toContain('MultipleMatches')
      expect(text).toContain('expression:')
    }
    const get = model.symbols.find((entry) => entry.id === 'io.github.libtmux.kotlin.Options.get')!
    expect(symbolMarkdown({ model, symbol: get })).toContain('## Returns')
  })

  for (const port of PORTS) {
    it(`${port.name} keeps every documented overload contract in Markdown`, () => {
      const model = API_MODELS[port.slug]
      for (const symbol of model.symbols.filter((entry) => entry.signatures.length > 1)) {
        const text = symbolMarkdown({ model, symbol })
        for (const signature of symbol.signatures) {
          if (signature.returnsDoc) expect(text, symbol.id).toContain(signature.returnsDoc)
          for (const param of signature.params) {
            if (param.doc) expect(text, `${symbol.id} parameter ${param.name}`).toContain(param.doc)
          }
          for (const error of signature.raises ?? []) {
            expect(text, symbol.id).toContain(error.type)
            if (error.doc) expect(text, symbol.id).toContain(error.doc)
          }
        }
      }
    })
  }

  it('preserves example bytes when blank lines and backticks are part of the program', () => {
    const code = 'const output = `first\n\n\nlast`;\nconsole.log(output);\nconsole.log("```");\n'
    const symbol: ApiSymbol = {
      id: 'example',
      name: 'example',
      kind: 'function',
      modifiers: [],
      signatures: [],
      source: { file: 'example.ts', line: 1 },
      doc: { summary: 'Print the literal text.', examples: [{ lang: 'ts', code }] },
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
    expect(text).toContain('- `id` (`io.github.libtmux.WindowId`)')
  })

  it('uses the documented signature and keeps all declarations, warnings and provenance', () => {
    const symbol: ApiSymbol = {
      id: 'Server.capture',
      name: 'capture',
      kind: 'method',
      modifiers: ['overload'],
      source: { file: 'server.ts', line: 1 },
      inheritedFrom: 'Base.capture',
      signatures: [
        { params: [{ name: 'limit', type: 'number' }], returns: 'string[]' },
        {
          params: [
            {
              name: 'options',
              type: 'CaptureOptions',
              doc: 'Choose the line range.',
              since: '1.2',
              deprecated: 'Use a range.',
            },
          ],
          returns: 'string[]',
          returnsDoc: 'The captured lines.',
          raises: [{ type: 'CaptureError', doc: 'The pane no longer exists.' }],
        },
      ],
      doc: {
        summary: 'Read pane output.',
        deprecated: 'Use Pane.capture.',
        changed: 'Returns complete lines.',
        admonitions: [{ kind: 'warning', text: 'The pane may exit between commands.' }],
        references: [{ name: 'manual', text: 'The tmux capture-pane manual.' }],
        examples: [{ lang: 'ts', code: 'await pane.capture()', intro: 'Read visible lines.' }],
      },
    }
    const text = symbolMarkdown({ model: { ...API_MODELS.ts, symbols: [symbol] }, symbol })
    expect(text).toContain('Server.capture(limit: number) -> string[]')
    expect(text).toContain('Server.capture(options: CaptureOptions) -> string[]')
    expect(text).toContain('**Inherited from:** Base.capture')
    expect(text).toContain('## Deprecated\n\nUse Pane.capture.')
    expect(text).toContain('## Changed\n\nReturns complete lines.')
    expect(text).toContain('**warning:** The pane may exit between commands.')
    expect(text).toContain('- [manual] The tmux capture-pane manual.')
    expect(text).toContain(
      '## Parameters\n\n- `options` (`CaptureOptions`): Choose the line range. (added 1.2) (deprecated Use a range.)',
    )
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
      const expected = [
        ...members.filter((member) => !member.inheritedFrom),
        ...members.filter((member) => member.inheritedFrom),
      ].map((member) => member.name)
      const memberText = text.slice(text.search(/^## (?:Members|Inherited members)$/m))
      const names = [...memberText.matchAll(/^- `([^`]+)` \([a-z]+\)/gm)].map((match) => match[1])
      expect(names).toEqual(expected)
      if (members.some((member) => member.inheritedFrom)) expect(text).toContain('## Inherited members')
    })
  }
})
