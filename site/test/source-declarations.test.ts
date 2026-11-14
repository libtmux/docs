import { describe, expect, it } from 'vitest'
import { declarationRange, declarationsIn, sourceLanguage, sourceMarkdown } from '../src/lib/source-declarations'
import { pinnedSource } from '../src/lib/api-source-pages'

const range = (text: string, line: number, language: string) => declarationRange(text, line, language)

describe('declarationRange', () => {
  it('covers the doc comment, the multi-line signature and the body of a Go method', () => {
    const go = pinnedSource('go', 'tmux/pane_capture.go')!.content
    // The page the design shows: Pane.Capture is declared on line 123 and spans 112 to 129.
    expect(range(go, 123, 'go')).toEqual([112, 129])
  })

  it('closes braces by depth, ignoring brackets in strings and comments', () => {
    const text = ['// Doc.', 'func f() {', '\ts := "}"', '\t// }', '}', 'func g() {}'].join('\n')
    expect(range(text, 2, 'go')).toEqual([1, 5])
    expect(range(text, 6, 'go')).toEqual([6, 6])
  })

  it('ends a bodiless declaration on its own line', () => {
    expect(range('interface A {\n  m(): void;\n  n(x: number): string;\n}', 2, 'ts')).toEqual([2, 2])
    expect(range('const A = 1\nconst B = 2', 1, 'go')).toEqual([1, 1])
  })

  it('follows indentation in Python and includes decorators', () => {
    const text = ['@dataclass', 'class A:', '    x: int', '', '    def f(self):', '        return 1', '', 'B = 1'].join('\n')
    expect(range(text, 2, 'python')).toEqual([1, 6])
    expect(range(text, 5, 'python')).toEqual([5, 6])
  })

  it('matches an end keyword at the declaration indent in Ruby and Lua', () => {
    const ruby = ['# Doc.', 'class A', '  def f', '    1', '  end', 'end', 'x = 1'].join('\n')
    expect(range(ruby, 2, 'ruby')).toEqual([1, 6])
    expect(range(ruby, 3, 'ruby')).toEqual([3, 5])
    expect(range(ruby, 7, 'ruby')).toEqual([7, 7])
    expect(range('local function f()\n  return 1\nend', 1, 'lua')).toEqual([1, 3])
  })

  it('balances parentheses in a Lisp form and stops at a full stop in Erlang', () => {
    expect(range('(defun f (x)\n  (g x))\n(defun h ())', 1, 'lisp')).toEqual([1, 2])
    expect(range('f(a) -> 1;\nf(b) -> 2.\ng() -> 3.', 1, 'erlang')).toEqual([1, 2])
  })

  it('leaves an out-of-range line as itself', () => {
    expect(range('a\nb', 9, 'go')).toEqual([9, 9])
  })
})

describe('declarationsIn', () => {
  it('lists the declarations a file holds in file order, with their ranges', () => {
    const text = '// A.\ntype A struct {\n}\n\n// B.\nfunc B() {\n}\n'
    const symbols = [
      { id: 'pkg.B', name: 'B', kind: 'function', slug: 'pkg-b', source: { file: 'a.go', line: 6 }, signatures: [] },
      { id: 'pkg.A', name: 'A', kind: 'struct', slug: 'pkg-a', source: { file: 'a.go', line: 2 }, signatures: [] },
      { id: 'pkg.C', name: 'C', kind: 'function', slug: 'pkg-c', source: { file: 'other.go', line: 1 }, signatures: [] },
    ]
    expect(declarationsIn({ symbols } as never, 'a.go', text).map(({ id, from, to }) => [id, from, to]))
      .toEqual([['pkg.A', 1, 3], ['pkg.B', 5, 7]])
  })

  it('chooses the language from the extension', () => {
    expect([sourceLanguage('a/b.go'), sourceLanguage('x.rakumod'), sourceLanguage('Makefile'), sourceLanguage('x.PS1')])
      .toEqual(['go', 'raku', 'text', 'powershell'])
  })
})

describe('sourceMarkdown', () => {
  it('writes the file in a fence longer than any run of backticks inside it', () => {
    const origin = { repo: 'a/b', revision: 'f'.repeat(40) }
    expect(sourceMarkdown({ file: 'x/a.go', content: 'package a\n', origin })).toBe('# x/a.go\n\na/b@ffffffffffff\n\n```go\npackage a\n```\n')
    expect(sourceMarkdown({ file: 'NOTES', content: 'a ```` b\n' })).toBe('# NOTES\n\n`````\na ```` b\n`````\n')
  })
})
