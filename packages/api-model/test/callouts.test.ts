import { describe, expect, it } from 'vitest'
import { parseMarkdownDoc } from '../src/doc/markdown.ts'

/**
 * DocC and GitHub callouts.
 *
 * libtmux-swift's `Server.format(_:for:)` and `Server.pipe(_:to:)` each warn
 * that a format template is executable, in DocC's `> Warning:` form. The
 * parser kept the blockquote as prose, so the page printed a paragraph with a
 * literal `>` before every line and no warning treatment at all.
 *
 * The distinction worth holding is between a callout and a quotation: only a
 * blockquote whose first line names a kind is set apart.
 */
describe('callouts', () => {
  it('lifts a named blockquote out of the prose and leaves a quotation in it', () => {
    const callout = parseMarkdownDoc('Copies output.\n\n> Warning: a template is\n> executable.\n', 'swift')
    expect(callout.admonitions).toEqual([{ kind: 'warning', text: 'a template is executable.' }])
    expect(callout.body).toBeUndefined()

    const quotation = parseMarkdownDoc('Copies output.\n\n> Worse is better.\n', 'swift')
    expect(quotation.admonitions).toBeUndefined()
    expect(quotation.body).toBe('> Worse is better.')
  })
})
