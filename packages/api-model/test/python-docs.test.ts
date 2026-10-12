import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePythonDoc, pythonDocBody } from '../src/doc/python.ts'
import { docSummaryText, referencesIn, tokenizeDoc } from '../src/doc/roles.ts'
import { extractPython } from '../src/languages/python.ts'
import { SymbolIndex } from '../src/link.ts'

// Exact ast.get_docstring(QueryList) at public libtmux 9fdd083a (also v0.62.0).
const queryList = readFileSync(new URL('./fixtures/python-querylist-docstring.txt', import.meta.url), 'utf8')
const sessions = [...queryList.matchAll(/^>>>[^\n]*(?:\n[^\n]+)*/gm)].map((match) => match[0])

describe('Python docstring structure', () => {
  it('keeps every source doctest and its output in place without an Examples heading', () => {
    expect(createHash('sha256').update(queryList).digest('hex')).toBe(
      '245583d7072b64ceb8b722252375b3ba3537e06070e8fabbe1425059f4393cf1',
    )
    expect(sessions).toHaveLength(22)
    const doc = parsePythonDoc(queryList).doc
    const blocks = [...doc.body!.matchAll(/```python\n([\s\S]*?)\n```/g)].map((match) => match[1])
    expect(blocks).toEqual(sessions)
    expect(doc.summary).toBe('Filter list of object/dictionaries. For small, local datasets.')
    expect(doc.body).toContain('*Experimental, unstable*.')
    expect(doc.body!.indexOf('**With dictionaries**')).toBeLessThan(doc.body!.indexOf(blocks[0]))
    expect(doc.body!.indexOf('**With objects**')).toBeGreaterThan(doc.body!.indexOf(blocks[0]))
    expect(doc.examples).toBeUndefined()
  })

  it('preserves nested lists, references, notes and literal indentation', () => {
    const doc = parsePythonDoc(
      'Summary.\n\n- :class:`Server`\n\n  - :attr:`Server.sessions`\n\nA literal::\n\n    first\n      second\n\nAfter.\n\nNotes\n-----\n*Still experimental*.\n\n>>> 2 + 2\n4',
    ).doc
    expect(doc.body).toContain('- :class:`Server`\n\n  - :attr:`Server.sessions`')
    expect(doc.body).toContain('A literal:\n\n```text\nfirst\n  second\n```')
    expect(doc.body).toContain('### Notes\n\n*Still experimental*.\n\n```python\n>>> 2 + 2\n4\n```')
  })

  it('keeps code directives and longer fences literal, including directive-looking source', () => {
    const body = pythonDocBody('.. code-block:: python\n   :linenos:\n\n   # comment\n   print("hi")\n\nEnd.')
    expect(body).toBe('```python\n# comment\nprint("hi")\n```\n\nEnd.')
    const doc = parsePythonDoc(
      'Summary.\n\n.. code-block:: text\n\n   .. note:: literal\n   ```\n\n.. warning:: A real warning.',
    ).doc
    expect(doc.body).toContain('````text\n.. note:: literal\n```\n````')
    expect(doc.admonitions).toEqual([{ kind: 'warning', text: 'A real warning.' }])
  })

  it('keeps paragraphs and literal sessions inside their admonition', () => {
    const doc = parsePythonDoc(
      'Summary.\n\n.. note:: First paragraph.\n\n    Second paragraph with :class:`Server`.\n\n    >>> value = [\n    ...     1,\n    ... ]\n    [1]\n\nAfter.',
    ).doc
    expect(doc.admonitions).toEqual([
      {
        kind: 'note',
        text: 'First paragraph.\n\nSecond paragraph with :class:`Server`.\n\n```python\n>>> value = [\n...     1,\n... ]\n[1]\n```',
      },
    ])
    expect(doc.body).toBe('After.')
  })

  it('does not mistake an argumentless admonition for a literal introducer', () => {
    const doc = parsePythonDoc(
      'Summary.\n\n.. warning::\n\n    Use :class:`Server`.\n\n    It owns the connection.',
    ).doc
    expect(doc.body).toBeUndefined()
    expect(doc.admonitions).toEqual([{ kind: 'warning', text: 'Use :class:`Server`.\n\nIt owns the connection.' }])
  })

  it('retains every directive in Notes without leaking reST markers or an empty heading', () => {
    const doc = parsePythonDoc(
      'Summary.\n\nNotes\n-----\n.. versionchanged:: 2.0\n    New behavior.\n\n.. versionchanged:: 1.0\n    Earlier behavior.\n\n.. warning::\n    Check :class:`Server`.',
    ).doc
    expect(doc.changed).toBe('2.0 — New behavior.\n\n1.0 — Earlier behavior.')
    expect(doc.admonitions).toEqual([{ kind: 'warning', text: 'Check :class:`Server`.' }])
    expect(doc.body).toBeUndefined()
  })

  it('indexes real prose references without indexing literal roles or fence delimiters', () => {
    expect(referencesIn(':class:`Server`\n\n````text\n:class:`Imaginary`\n```\n````\n\n:class:`Window`')).toEqual([
      { role: 'class', target: 'Server' },
      { role: 'class', target: 'Window' },
    ])
  })

  it('renders single emphasis without claiming globs, arithmetic or code', () => {
    expect(tokenizeDoc('*Experimental, unstable*.')).toEqual([
      { kind: 'emphasis', text: 'Experimental, unstable' },
      { kind: 'text', text: '.' },
    ])
    for (const text of [
      'a * b and 2 * 3',
      'glob *.py here',
      String.raw`\*literal\*`,
      '`*literal*`',
      '``*literal*``',
      '**Strong**',
    ]) {
      expect(
        tokenizeDoc(text).filter((span) => span.kind === 'emphasis'),
        text,
      ).toEqual([])
    }
    expect(docSummaryText('A *small* **local** `list`.', 'py')).toBe('A small local list.')
  })
})

async function extract(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'python-doc-alias-'))
  try {
    const file = join(dir, 'example.py')
    writeFileSync(file, source)
    return await extractPython(file, 'example')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('source-scoped Python typing bindings', () => {
  it('resolves the real imported Generic while preserving the written type and type parameter', async () => {
    const [symbol] = await extract('import typing as t\nclass QueryList(list[T], t.Generic[T]):\n    pass\n')
    expect(symbol.extends).toEqual(['list[T]', 't.Generic[T]'])
    const index = new SymbolIndex([symbol], (entry) => `#${entry.id}`, 'py')
    const spans = index.linkType('t.Generic[T]', symbol)
    expect(spans.map((span) => span.text).join('')).toBe('t.Generic[T]')
    expect(spans.find((span) => span.text === 't.Generic')?.link?.href).toBe(
      'https://docs.python.org/3/library/typing.html#typing.Generic',
    )
    expect(spans.find((span) => span.text === 'T')?.link).toBeUndefined()
  })

  it('keeps aliases scoped to imports and invalidates rebound names', async () => {
    for (const prefix of [
      '',
      'import other as t\n',
      'import typing as t\nt = other\n',
      'import typing as t\nimport other as t\n',
    ]) {
      const symbols = await extract(`${prefix}class QueryList(t.Generic[T]):\n    pass\n`)
      const symbol = symbols.at(-1)!
      const index = new SymbolIndex(symbols, (entry) => `#${entry.id}`, 'py')
      expect(index.resolve('t.Generic', 'class', symbol), prefix).toBeUndefined()
    }
    const symbols = await extract('from typing import Generic as G\nclass QueryList(G[T]):\n    pass\n')
    expect(symbols[0].imports).toEqual({ G: 'typing.Generic' })
  })
})
