import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { parseApiProse } from '../src/lib/api-prose'
import { createRenderer } from 'astro-expressive-code'
import { select, toHtml } from 'astro-expressive-code/hast'
import config from '../ec.config.mjs'
import { codeLang } from '../src/lib/highlight'

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

  it('keeps native numbered and bullet lists distinct from neighboring code', () => {
    expect(parseApiProse('3. Read a snapshot.\n4. Match the records.\n\n```go\nmatched := Matching(panes, filter)\n```\n\n• Inspect errors.')).toEqual([
      { kind: 'ol', start: 3, items: [{ text: 'Read a snapshot.', children: [] }, { text: 'Match the records.', children: [] }] },
      { kind: 'code', lang: 'go', code: 'matched := Matching(panes, filter)' },
      { kind: 'ul', items: [{ text: 'Inspect errors.', children: [] }] },
    ])
  })

  it('renders and exports the source-bound Go Matching example without changing Copy text', async () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'tmuxq.Matching')!
    const expected = 'active, err := tmuxq.Matching(snapshot.Panes(), tmux.PaneActiveIs(true))'
    expect(symbol.source.revision).toBe('6f3df55f8a41999e41225eefb3940545b834e6a2')
    const blocks = parseApiProse(symbol.doc!.body!)
    expect(blocks).toEqual([{ kind: 'code', lang: 'go', code: expected }])
    const block = blocks[0]
    if (block.kind !== 'code') throw new Error('Missing native code block')
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: block.code, language: codeLang(block.lang) })
    expect(select('pre', result.renderedGroupAst)?.properties.dataLanguage).toBe('go')
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(expected)
    expect(new Set([...toHtml(result.renderedGroupAst).matchAll(/--0:([^;"]+)/g)].map((match) => match[1])).size).toBeGreaterThan(1)
    expect(fromMarkdown(symbolMarkdown({ model, symbol })).children.filter((node) => node.type === 'code'))
      .toContainEqual(expect.objectContaining({ lang: 'go', value: expected }))
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
