import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentKind } from '../src/lib/docs-paths'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
/** A stylesheet without comments, so a rule is matched by what it sets. */
const css = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '')

describe('which pages are reading pages', () => {
  it('knows an example page from a guide, topic or concept page', () => {
    expect(contentKind('examples/capture-pane-output')).toBe('example')
    expect(contentKind('tmux/examples/capture-pane-output')).toBe('example')
    expect(contentKind('workspace/examples/gallery')).toBe('example')
    for (const path of ['guides/capturing-output', 'tmux/topics/environment', 'concepts/queries']) {
      expect(contentKind(path), path).toBe('reading')
    }
  })

  it('leaves section indexes, reference and meta pages alone, so their cards keep the full column', () => {
    for (const path of ['examples', 'guides', 'tmux/concepts', 'reference/tmux-newserver', 'meta/support', '', 'core']) {
      expect(contentKind(path), path || '(root)').toBeUndefined()
    }
  })

  it('marks the article with its kind', () => {
    expect(read('layouts/DocsLayout.astro')).toMatch(/<article[^>]*data-content=\{contentKind\(pagePath\)\}/)
  })
})

describe('content page typesetting (record 0012, record 0025, PageExample)', () => {
  const sheet = css('styles/content-pages.css')

  it('keeps an example at the prose measure, so steps, prose and frames share one right edge', () => {
    expect(sheet).toMatch(/article\[data-content='example'\]\s*\{[^}]*max-width: var\(--measure-prose, 72ch\);/)
  })

  it('sets example steps as 18/26 semibold H3s and sections as 24/32 semibold H2s', () => {
    expect(sheet).toMatch(/article\[data-content='example'\] h3\s*\{[^}]*font-size: 1\.125rem;[^}]*line-height: 1\.625rem;[^}]*font-weight: 600;/)
    expect(sheet).toMatch(/article\[data-content='example'\] h2\s*\{[^}]*font-size: 1\.5rem;[^}]*line-height: 2rem;[^}]*font-weight: 600;/)
  })

  it('sets inline code at body weight, 0.875em, with its padding inside the chip', () => {
    expect(sheet).toMatch(/code:not\(pre code\)\s*\{[^}]*font-size: 0\.875em;[^}]*font-weight: 400;/)
    expect(sheet).toMatch(/code:not\(pre code\)\s*\{[^}]*padding: 0\.125rem 0\.1875rem;/)
  })

  it('draws a linked API name as a kind mark and a dotted underline, with no code chip', () => {
    expect(sheet).toMatch(/a\.api-mention code\s*\{[^}]*background: none;[^}]*padding: 0;/)
  })

  it('caps prose blocks of the other reading pages at the measure and leaves frames and tables the column', () => {
    expect(sheet).toMatch(/article\[data-content='reading'\] > :is\(p, ul, ol, blockquote, h2, h3, h4, dl\)\s*\{[^}]*max-width: var\(--measure-prose, 72ch\);/)
    expect(sheet).not.toMatch(/article\[data-content='reading'\]\s*\{[^}]*max-width/)
  })
})
