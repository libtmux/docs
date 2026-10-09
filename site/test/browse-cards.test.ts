import { parseFrontmatter } from '@astrojs/markdown-remark'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectPortCards } from '../src/lib/workspace-shared-slots'

interface Card {
  label: string
  href: string
  body: string
  ports?: string[]
}

const index = (section: string) => parseFrontmatter(readFileSync(
  new URL(`../src/content/docs/${section}/index.md`, import.meta.url), 'utf8'),
  { frontmatter: 'remove' })
const cards = (section: string, port?: string) =>
  selectPortCards(index(section).frontmatter.cards as Card[], port)

describe('shared browse cards', () => {
  it.each([
    ['guides', 6], ['concepts', 4], ['topics', 10], ['examples', 3],
  ] as const)('keeps the %s destinations in shared and native version mounts', (section, count) => {
    const shared = cards(section)
    expect(shared).toHaveLength(count)
    expect(new Set(shared.map((card) => card.href)).size).toBe(count)
    for (const port of ['py', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift']) {
      const selected = cards(section, port)
      if (section === 'guides' && port === 'rs') {
        expect(selected.filter((card) => shared.some((item) => item.href === card.href))).toEqual(shared)
        expect(selected.filter((card) => !shared.some((item) => item.href === card.href))
          .map((card) => card.href)).toEqual(['batching-commands/', 'control-mode/'])
        expect(selected).toHaveLength(count + 2)
      } else expect(selected).toEqual(shared)
      for (const version of ['latest', 'stable', 'v0.1']) {
        const base = `https://libtmux.org/pr-42/en/${port}/${version}/${section}/`
        for (const card of selected) {
          expect(new URL(card.href, base).pathname)
            .toBe(`/pr-42/en/${port}/${version}/${section}/${card.href}`)
        }
      }
    }
    expect(index(section).content).not.toMatch(/^- \*\*\[/m)
  })

  it.each(['ruby', 'lua'])('offers only covered concepts and native guides for %s', (port) => {
    const selected = cards('concepts', port)
    expect(selected.map((card) => card.label)).toEqual([
      'Server, session, window, pane', 'Native guides',
    ])
    for (const version of ['latest', 'stable', 'v0.1']) {
      const base = `https://libtmux.org/pr-42/en/${port}/${version}/concepts/`
      expect(selected.map((card) => new URL(card.href, base).pathname)).toEqual([
        `/pr-42/en/${port}/${version}/concepts/server-session-window-pane/`,
        `/pr-42/en/${port}/${version}/guides/`,
      ])
    }
  })

  it('preserves unrestricted product cards and treats an empty restriction as no destination', () => {
    const shared: Card = { label: 'Guide', href: './guide/', body: 'Read the guide.' }
    expect(selectPortCards([shared], 'go')).toEqual([shared])
    expect(selectPortCards([shared])).toEqual([shared])
    expect(selectPortCards([{ ...shared, ports: [] }], 'go')).toEqual([])
    expect(selectPortCards([{ ...shared, ports: ['root'] }], 'go')).toEqual([])
    expect(selectPortCards(undefined)).toEqual([])
  })

  it('keeps the published example verification anchors and source checks', () => {
    const body = index('examples').content
    expect(body).toContain('<a id="what-verified-means-per-port"></a>')
    expect(body).toContain('## Source and verification')
    expect(body).toContain('<!-- port:swift -->| Swift | `Scripts/check_examples.py`')
  })
})
