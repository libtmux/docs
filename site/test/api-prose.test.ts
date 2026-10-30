import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { parseApiProse } from '../src/lib/api-prose'
import { groupDirectory } from '../src/lib/api-directory'
import { parseXmlDoc } from '../../packages/api-model/src/doc/csharp'
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

  it('reads a wrapped C# list item as one item of one list', () => {
    const { doc } = parseXmlDoc('<summary>S.</summary><remarks>\nSteps:\n<list type="bullet">\n  <item><description>Open the server, and wait\n  for the first window.</description></item>\n  <item><description>Close it.</description></item>\n</list>\nDone.\n</remarks>')
    expect(parseApiProse(doc.body!)).toEqual([
      { kind: 'p', text: 'Steps:' },
      { kind: 'ul', items: [{ text: 'Open the server, and wait for the first window.', children: [] }, { text: 'Close it.', children: [] }] },
      { kind: 'p', text: 'Done.' },
    ])
  })

  it('reads a pipe table as a table block, not a paragraph of pipes', () => {
    const blocks = parseApiProse('Every handle:\n\n| To | Call |\n| --- | :--: |\n| read one | `typed_option` |\n| write `a|b` | [`set_option`] |\n\nAfter.')
    expect(blocks).toEqual([
      { kind: 'p', text: 'Every handle:' },
      { kind: 'table', head: ['To', 'Call'], align: [undefined, 'center'], rows: [['read one', '`typed_option`'], ['write `a|b`', '[`set_option`]']] },
      { kind: 'p', text: 'After.' },
    ])
  })

  it('reads alignment from the rule row, an escaped pipe as a pipe, and a ragged row as the header\'s width', () => {
    const [table] = parseApiProse('| a | b | c |\n|:--|--:|---|\n| one \\| two | x |\n| 1 | 2 | 3 | 4 |')
    expect(table).toEqual({
      kind: 'table', head: ['a', 'b', 'c'], align: ['left', 'right', undefined],
      rows: [['one | two', 'x', ''], ['1', '2', '3']],
    })
  })

  it('ends a table at a line without a leading pipe and opens one straight after a paragraph line', () => {
    expect(parseApiProse('Lead line\n| a |\n| - |\n| 1 |\ntrailing line').map((block) => block.kind)).toEqual(['p', 'table', 'p'])
  })

  it('leaves pipes in prose alone when no rule line follows', () => {
    expect(parseApiProse('| not a table |\nstill prose')).toEqual([{ kind: 'p', text: '| not a table | still prose' }])
    expect(parseApiProse('a | b\n| - |')).toEqual([{ kind: 'p', text: 'a | b | - |' }])
  })

  it('renders and exports the source-bound Go Matching example without changing Copy text', async () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'tmuxq.Matching')!
    const expected = 'active, err := tmuxq.Matching(snapshot.Panes(), tmux.PaneActiveIs(true))'
    expect(symbol.source.revision).toBe('2de249b600d65218ee8b8fdc07c6b2b919242151')
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


const row = (lead: string, refs: string) => `**${lead}.** What these are for.\n\n${refs}`
const three = [row('Connecting', '[`new`], [`builder`]'), row('Finding', '[`session`]'), row('Listing', '[`sessions`] and [`panes`]')].join('\n\n')

describe('a capability directory', () => {
  it('folds three bold-led paragraphs, each followed by references alone, into rows', () => {
    const blocks = groupDirectory(parseApiProse(`Intro.\n\n${three}\n\nAfter.`))
    expect(blocks.map((block) => block.kind)).toEqual(['p', 'directory', 'p'])
    const directory = blocks[1]
    if (directory.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows.map((r) => [r.title, r.guidance, r.groups.map((g) => g.refs)])).toEqual([
      ['Connecting', 'What these are for.', [['[`new`]', '[`builder`]']]],
      ['Finding', 'What these are for.', [['[`session`]']]],
      ['Listing', 'What these are for.', [['[`sessions`]', '[`panes`]']]],
    ])
  })

  it('reads a labelled list as named groups', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), '**C.** Guidance.\n\n- Buffers: [`buffer`], [`set_buffer`]\n- Keys: [`bind_key`]'].join('\n\n')
    const directory = groupDirectory(parseApiProse(text)).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[2].groups).toEqual([
      { label: 'Buffers', refs: ['[`buffer`]', '[`set_buffer`]'] },
      { label: 'Keys', refs: ['[`bind_key`]'] },
    ])
  })

  it('leaves two rows as prose: a short run is not a directory', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]')].join('\n\n')
    expect(groupDirectory(parseApiProse(text)).map((block) => block.kind)).toEqual(['p', 'p', 'p', 'p'])
  })

  it('leaves a bold-led paragraph whose follower holds prose as prose, and ends the run there', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), row('C', 'Use [`c`] first.'), row('D', '[`d`]')].join('\n\n')
    expect(groupDirectory(parseApiProse(text)).map((block) => block.kind)).toEqual(['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'])
  })

  it('writes a bold list label as its words, without the marks', () => {
    const text = [row('A', '[`a`]'), row('B', '[`b`]'), '**C.** Guidance.\n\n- **Buffers**: [`buffer`]\n- *Keys*: [`bind_key`]'].join('\n\n')
    const directory = groupDirectory(parseApiProse(text)).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[2].groups.map((group) => group.label)).toEqual(['Buffers', 'Keys'])
  })

  it('does not read a Markdown link or a reference-style link as a Go reference', () => {
    for (const refs of ['[text](https://example.test)', '[text][ref]']) {
      const text = [row('A', refs), row('B', refs), row('C', refs)].join('\n\n')
      expect(groupDirectory(parseApiProse(text)).some((block) => block.kind === 'directory'), refs).toBe(false)
    }
  })

  it('leaves a list item without a label, or with prose after it, as prose', () => {
    const base = [row('A', '[`a`]'), row('B', '[`b`]')].join('\n\n')
    for (const list of ['- [`c`], [`d`]', '- Keys: [`c`] binds a key']) {
      expect(groupDirectory(parseApiProse(`${base}\n\n**C.** Guidance.\n\n${list}`)).some((block) => block.kind === 'directory'), list).toBe(false)
    }
  })
})

describe('a capability directory in each port\'s syntax', () => {
  const rows = (refs: string[]) => refs.map((ref, n) => `**Group ${n}.** What these are for.\n\n${ref}, ${ref}`).join('\n\n')
  it.each([
    ['rustdoc', '[`new`]'],
    ['XML doc', '<see cref="Server.Open" />'],
    ['Javadoc and TSDoc', '{@link #sessions()}'],
    ['Go doc', '[Server.Kill]'],
  ])('reads %s references', (_, ref) => {
    const directory = groupDirectory(parseApiProse(rows([ref, ref, ref]))).find((block) => block.kind === 'directory')
    if (directory?.kind !== 'directory') throw new Error('no directory')
    expect(directory.rows[0].groups[0].refs).toEqual([ref, ref])
  })

  it('reads Go\'s heading-led rows: a heading, its guidance, then the names', () => {
    const row = (title: string) => `# ${title}\n\nWhat these are for.\n\n[Server.Kill], [NewServer]`
    const blocks = groupDirectory(parseApiProse(['# What is on here', 'Intro.', row('Connecting'), row('Finding'), row('Listing')].join('\n\n')))
    expect(blocks.map((block) => block.kind)).toEqual(['rubric', 'p', 'directory'])
  })

  it('leaves a Go heading whose next paragraph is already the names as a heading', () => {
    const row = (title: string) => `# ${title}\n\n[Server.Kill], [NewServer]`
    expect(groupDirectory(parseApiProse([row('A'), row('B'), row('C')].join('\n\n'))).some((block) => block.kind === 'directory')).toBe(false)
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
    expect(markdown).toContain('[`list`](https://docs.python.org/3/builtins/stdtypes.html#list)')
    expect(markdown).toContain('[`t.Generic`](https://docs.python.org/3/library/typing.html#typing.Generic)')
    expect(markdown).toContain('libtmux._internal.query_list.QueryList')
  })
})
