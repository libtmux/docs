import { describe, expect, it } from 'vitest'
import type { ApiSymbol } from '../src/model.ts'
import { commentSentences, docCommentAbove, extractBehavior, verifyBehavior } from '../src/behavior.ts'

const symbol = (line: number, extra: Partial<ApiSymbol> = {}): ApiSymbol => ({
  id: 'p.Pane.Capture', name: 'Capture', kind: 'method', modifiers: [], signatures: [], source: { file: 'pane.go', line }, ...extra,
})

const GO = `package tmux

// Capture captures printed content from the receiver's exact linked pane.
// It returns a caller-owned slice. A completed nonzero exit or stderr becomes
// a [CommandError]; any stdout tmux still printed is returned alongside it.
//
// This is a point-in-time capture rather than a stream; the zero request reads
// the visible screen. Setting Hyperlinks requires tmux 3.7 on the server.
//
// Transport and context failures return any partial stdout with the error.
func (p Pane) Capture() {}
`.split('\n')

describe('the doc comment above a declaration', () => {
  it('is read line by line, without its markers, and stops at the first line that is not comment', () => {
    const comment = docCommentAbove(GO, 11, 'go')
    expect(comment[0]).toEqual({ line: 3, text: "Capture captures printed content from the receiver's exact linked pane." })
    expect(comment.at(-1)).toEqual({ line: 10, text: 'Transport and context failures return any partial stdout with the error.' })
    expect(docCommentAbove(GO, 3, 'go')).toEqual([])
  })

  it('gives each sentence the line it begins on, even when it begins mid-line and runs on', () => {
    const sentences = commentSentences(docCommentAbove(GO, 11, 'go'), 'go')
    expect(sentences.map((sentence) => [sentence.line, sentence.text.slice(0, 12)])).toEqual([
      [3, 'Capture capt'], [4, 'It returns a'], [4, 'A completed '],
      [7, 'This is a po'], [8, 'Setting Hype'], [10, 'Transport an'],
    ])
  })
})

describe('behaviour read from a Go doc comment', () => {
  const behavior = extractBehavior(symbol(11), GO, 'go')!

  it('files a sentence under the row its wording names, verbatim, with its line', () => {
    expect(behavior.ownership).toEqual({ text: 'It returns a caller-owned slice.', source: { file: 'pane.go', line: 4 }, origin: 'doc comment' })
    expect(behavior.completion?.text).toBe('This is a point-in-time capture rather than a stream; the zero request reads the visible screen.')
    expect(behavior.completion?.source.line).toBe(7)
    // Two sentences of one paragraph are one statement; a later paragraph's sentence is not appended to it.
    expect(behavior.errors?.text).toBe('A completed nonzero exit or stderr becomes a [CommandError]; any stdout tmux still printed is returned alongside it.')
    expect(behavior.boundedBy?.source.line).toBe(10)
  })

  it('reads a tmux version the comment states, and leaves the summary sentence to the page', () => {
    expect(behavior.requires).toEqual({ tmux: '3.7', source: { file: 'pane.go', line: 8 } })
    expect(Object.values(behavior).some((fact) => 'text' in fact && fact.text.startsWith('Capture captures'))).toBe(false)
  })

  it('invents nothing: a declaration whose comment states none of it has no behaviour, and a type has none', () => {
    const quiet = ['// Name returns the window name.', 'func (w Window) Name() {}']
    expect(extractBehavior(symbol(2), quiet, 'go')).toBeUndefined()
    expect(extractBehavior(symbol(11, { kind: 'struct' }), GO, 'go')).toBeUndefined()
  })
})

describe('behaviour read from a Rust doc comment', () => {
  const RUST = [
    '/// Capture the pane\'s visible contents, one entry per line.',
    '///',
    '/// Lines are [`TmuxText`] because a terminal\'s contents are bytes.',
    '///',
    '/// # Errors',
    '///',
    '/// Returns an error when tmux refuses the command.',
    '///',
    '/// # Examples',
    '///',
    '/// ```',
    '/// pane.capture().await?;',
    '/// ```',
    '#[must_use]',
    'pub async fn capture(&self) {}',
  ]

  it('reads the Errors section as errors, skips examples and attributes, and files an async function as a signature fact', () => {
    const behavior = extractBehavior(symbol(15, { modifiers: ['async'], source: { file: 'observe.rs', line: 15 } }), RUST, 'rust')!
    expect(behavior.errors).toEqual({ text: 'Returns an error when tmux refuses the command.', source: { file: 'observe.rs', line: 7 }, origin: 'doc comment' })
    expect(behavior.completion).toEqual({ text: 'Returns a future that runs when awaited.', source: { file: 'observe.rs', line: 15 }, origin: 'signature' })
    expect(Object.keys(behavior)).toEqual(['completion', 'errors'])
  })
})

describe('the check on a cited line', () => {
  const sym = symbol(11)
  const behavior = extractBehavior(sym, GO, 'go')!

  it('accepts what the extractor produced', () => {
    expect(verifyBehavior(sym, behavior, GO, 'go')).toEqual([])
  })

  it('refuses a fact whose line was edited, moved or cut, so a stale citation cannot ship', () => {
    const edited = [...GO]
    edited[3] = '// It returns a slice the caller must not retain. A completed nonzero exit or stderr becomes'
    expect(verifyBehavior(sym, behavior, edited, 'go').some((problem) => problem.includes('ownership'))).toBe(true)
    expect(verifyBehavior(sym, behavior, GO.slice(0, 5), 'go').some((problem) => problem.includes('past the end'))).toBe(true)
    const moved = { ...behavior, ownership: { ...behavior.ownership!, source: { file: 'pane.go', line: 3 } } }
    expect(verifyBehavior(sym, moved, GO, 'go').some((problem) => problem.includes('ownership'))).toBe(true)
  })

  it('refuses a curated fact whose quoted words are not on the line, and a fact citing another file', () => {
    const curated = { ...behavior, transport: { text: 'Uses a subprocess.', source: { file: 'pane.go', line: 4 }, origin: 'curated' as const } }
    expect(verifyBehavior(sym, curated, GO, 'go', { transport: 'subprocess' })).toHaveLength(1)
    expect(verifyBehavior(sym, curated, GO, 'go', { transport: 'caller-owned slice' })).toEqual([])
    const elsewhere = { ...behavior, ownership: { ...behavior.ownership!, source: { file: 'other.go', line: 4 } } }
    expect(verifyBehavior(sym, elsewhere, GO, 'go').some((problem) => problem.includes('other.go'))).toBe(true)
  })
})
