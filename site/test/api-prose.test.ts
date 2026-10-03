import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { parseApiProse } from '../src/lib/api-prose'

describe('shared API prose blocks', () => {
  it('preserves fenced source instead of treating prompts, comments and bullets as prose', () => {
    expect(parseApiProse('Before.\n\n```python\n>>> values = [\n...     1,\n... ]\n[1]\n\n# literal\n- literal\n```\n\nAfter.')).toEqual([
      { kind: 'p', text: 'Before.' },
      { kind: 'code', lang: 'python', code: '>>> values = [\n...     1,\n... ]\n[1]\n\n# literal\n- literal' },
      { kind: 'p', text: 'After.' },
    ])
  })

  it('keeps existing nested lists and rubrics around a longer literal fence', () => {
    expect(parseApiProse('- Server\n\n  - Session\n\n    - Window\n\n# Details\n\n````text\n```\n````')).toEqual([
      { kind: 'ul', items: [{ text: 'Server', children: [{ text: 'Session', children: [{ text: 'Window', children: [] }] }] }] },
      { kind: 'rubric', text: 'Details' },
      { kind: 'code', lang: 'text', code: '```' },
    ])
  })

  it('uses text for unlabelled literal fences and retains unfinished code', () => {
    expect(parseApiProse('~~~\na\n  b')).toEqual([{ kind: 'code', lang: 'text', code: 'a\n  b' }])
  })
})


describe('generated Python docstring parity', () => {
  it('keeps all source sessions and experimental emphasis in HTML input and Markdown', () => {
    const model = API_MODELS.py
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux._internal.query_list.QueryList')!
    const source = readFileSync(new URL('../../packages/api-model/test/fixtures/python-querylist-docstring.txt', import.meta.url), 'utf8')
    const expected = [...source.matchAll(/^>>>[^\n]*(?:\n[^\n]+)*/gm)].map((match) => match[0])
    expect(parseApiProse(symbol.doc!.body!).filter((block) => block.kind === 'code').map((block) => block.code)).toEqual(expected)
    const markdown = symbolMarkdown({ model, symbol })
    const tree = fromMarkdown(markdown)
    expect(tree.children.filter((node) => node.type === 'code').map((node) => node.value)).toEqual(expected)
    expect(markdown).toContain('*Experimental, unstable*.')
    expect(markdown).toContain('[`list`](https://docs.python.org/3/library/stdtypes.html#list)')
    expect(markdown).toContain('[`t.Generic`](https://docs.python.org/3/library/typing.html#typing.Generic)')
    expect(markdown).toContain('libtmux._internal.query_list.QueryList')
  })
})
