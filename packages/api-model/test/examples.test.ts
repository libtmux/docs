import { describe, expect, it } from 'vitest'
import { parseMarkdownDoc } from '../src/doc/markdown.ts'

/**
 * Repeated example blocks.
 *
 * Four consecutive accessors in libtmux-ts carry their example twice — the
 * whole fenced block copied, an authoring slip — and the reference rendered
 * both, one directly beneath the other.
 *
 * The rule is adjacency, not equality. A walkthrough legitimately shows the
 * same verification step again after a different setup, which is how libtmux's
 * own `set_hooks` docstring reads: `show_hook('session-renamed')` appears at
 * position 1 and again at 6, with three other blocks between them. Dropping
 * every repeat would cut a step out of that sequence.
 */
const fence = (code: string) => `\`\`\`ts\n${code}\n\`\`\``

describe('repeated examples', () => {
  it('drops a block that repeats the one before it', () => {
    const doc = parseMarkdownDoc(
      `The config file.\n\n${fence('new Server().configFile;')}\n\n${fence('new Server().configFile;')}\n`,
    )
    expect(doc.examples?.map((e) => e.code)).toEqual(['new Server().configFile;'])
  })

  it('keeps a repeat that something else stands between', () => {
    const doc = parseMarkdownDoc(
      [
        'Set hooks.',
        '',
        fence('session.set_hooks(a);'),
        '',
        fence('session.show_hook(a);'),
        '',
        fence('session.set_hooks(b);'),
        '',
        fence('session.show_hook(a);'),
        '',
      ].join('\n'),
    )
    expect(doc.examples?.map((e) => e.code)).toEqual([
      'session.set_hooks(a);',
      'session.show_hook(a);',
      'session.set_hooks(b);',
      'session.show_hook(a);',
    ])
  })

  it('leaves a single example alone', () => {
    const doc = parseMarkdownDoc(`One.\n\n${fence('a();')}\n`)
    expect(doc.examples?.map((e) => e.code)).toEqual(['a();'])
  })
})
