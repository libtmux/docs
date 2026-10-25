import { describe, expect, it } from 'vitest'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { SymbolIndex } from '../src/link.ts'
import { neverLinks } from '../src/never-links.ts'
import type { ApiSymbol } from '../src/model.ts'

const symbol = (id: string): ApiSymbol => ({
  id, publicId: id, name: id.split('.').at(-1)!, kind: 'class',
  modifiers: [], signatures: [], source: { file: 'types.ts' },
})

describe('fenced code in doc text', () => {
  const fence = (body: string) => `\`\`\`text\n${body}\n\`\`\``

  it('is literal: the backticks of a fence, and the code between two fences, pair with nothing around them', () => {
    const text = `Before.\n\n${fence("'shell_command': ['htop']")}\n\ntmuxp allows it to be simply a string:\n\n${fence("'shell_command': 'htop'")}\n\nAfter \`Pane\`.`
    const spans = tokenizeDoc(text, 'py')
    expect(spans.filter((span) => span.kind !== 'text')).toEqual([{ kind: 'ref', role: 'any', target: 'Pane', label: 'Pane' }])
    const literal = spans.filter((span) => span.kind === 'text').map((span) => span.text).join('')
    expect(literal).toContain(fence("'shell_command': ['htop']"))
    expect(literal).toContain('simply a string:')
    expect(literal).toContain(fence("'shell_command': 'htop'"))
  })

  it('leaves a tilde fence, an unclosed fence and text without a fence as they were', () => {
    expect(tokenizeDoc('~~~\n`Pane`\n~~~\nThen `Window`.', 'py').filter((span) => span.kind === 'ref')).toEqual([{ kind: 'ref', role: 'any', target: 'Window', label: 'Window' }])
    expect(tokenizeDoc('Use `Pane`.\n```\n`Window`', 'py').filter((span) => span.kind === 'ref')).toEqual([{ kind: 'ref', role: 'any', target: 'Pane', label: 'Pane' }])
    expect(tokenizeDoc('A `Pane` and a `Window`.', 'py').filter((span) => span.kind === 'ref')).toHaveLength(2)
  })
})

describe('doc spans', () => {
  const index = new SymbolIndex([symbol('pane.Pane')], (item) => `/${item.id}/`, 'ts')

  it('gives the linked parts of the literal of a reference that resolves nowhere, as the page renders them', () => {
    const [, span] = index.docSpans('See `Pane | Map<string, Pane>`.')
    expect(span).toMatchObject({ kind: 'ref', label: 'Pane | Map<string, Pane>' })
    expect('link' in span && span.link).toBeFalsy()
    expect('parts' in span && span.parts?.some((part) => part.link)).toBe(true)
  })

  it('never links a variable or the text a program prints, in the tokenizer every path calls', () => {
    expect(neverLinks('$SocketPath')).toBe('a variable')
    expect(neverLinks(' $control ')).toBe('a variable')
    expect(neverLinks('[object Object]')).toBe('text a program prints')
    expect(neverLinks('Pane')).toBeUndefined()
    expect(neverLinks('$')).toBeUndefined()
    expect(neverLinks('[object Object] and more')).toBeUndefined()
    const powershell = new SymbolIndex([symbol('LibTmux.Server')], (item) => `/${item.id}/`, 'powershell')
    for (const text of ['$Server', '[object Object]', '[object Array]']) {
      expect(index.linkType(text), text).toEqual([{ text }])
      expect(powershell.linkType(text), text).toEqual([{ text }])
      expect(powershell.linkLiteral(text), text).toEqual([{ text }])
    }
    expect(powershell.resolve('[object Object]')).toBeUndefined()
  })

  it('leaves the text a program prints as plain code: [object Object] names no type', () => {
    const [, span] = index.docSpans('The default is `[object Object]`.')
    expect(span).toMatchObject({ kind: 'ref', label: '[object Object]' })
    expect('parts' in span && span.parts).toEqual([{ text: '[object Object]' }])
    expect(index.linkLiteral('[object Object]')).toEqual([{ text: '[object Object]' }])
  })
})
