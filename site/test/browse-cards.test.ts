import { parseFrontmatter } from '@astrojs/markdown-remark'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectPortCards } from '../src/lib/workspace-shared-slots'
import { docsEntriesAvailable } from '../src/lib/page-port-links'

interface Card {
  label: string
  href: string
  body: string
  ports?: string[]
}

const index = (section: string, port?: string) => {
  const candidates = [section, ...(port ? [`ports/${port}/${section}`] : [])]
    .map((id) => ({ id, file: new URL(`../src/content/docs/${id}/index.md`, import.meta.url) }))
    .filter(({ file }) => existsSync(file))
    .map(({ id, file }) => {
      const parsed = parseFrontmatter(readFileSync(file, 'utf8'), { frontmatter: 'remove' })
      return { ...parsed, id, data: parsed.frontmatter }
    })
  const selected = docsEntriesAvailable(candidates, port)
  expect(selected, `${port || 'tmux'}:${section}`).toHaveLength(1)
  return selected[0]
}
const cards = (section: string, port?: string) =>
  selectPortCards(index(section).frontmatter.cards as Card[], port)

describe('shared browse cards', () => {
  it.each([
    ['guides', 7], ['concepts', 4], ['topics', 10], ['examples', 3],
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
      for (const version of ['latest', 'v0.46.2', 'v0.1']) {
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
    for (const version of ['latest', 'v0.46.2', 'v0.1']) {
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

  it('keeps the published Swift example verification anchors and source checks', () => {
    const selected = index('examples', 'swift')
    expect(selected.id).toBe('ports/swift/examples')
    expect(selected.frontmatter.port).toBe('swift')
    const body = selected.content
    expect(body).toContain('<a id="what-verified-means-per-port"></a>')
    expect(body).toContain('## Source and verification')
    expect(body).toContain('`Scripts/check_examples.py` checks that README examples match sources')
    expect(body).toContain('`swift test --package-path Examples` compiles')
    expect(body).not.toContain('| Swift |')
  })

  it('keeps the native example verification fragment and scopes its shell receipts', () => {
    const selected = index('examples')
    expect(selected.frontmatter.supportedPorts).toEqual([])
    const body = selected.content
    expect(body).toContain('<a id="what-verified-means-per-port"></a>')
    expect(body).toContain('## Source and verification')
    expect(body).toContain('a site build does not execute them')
    expect(body).toContain('`site/test/fixtures/guide-examples.json`')
    expect(body).toContain('`scripts/check-example-prose.py`')
    expect(body).toContain('recorded shell recipe')
    expect(body).toContain('tmux version')
    expect(body).toContain('other examples or other versions')
    expect(body).toContain('/tmux/latest/manual/send-keys/')
    expect(body).not.toMatch(/Swift|Scripts\/check_examples\.py|swift test|\| Port \|/)
  })
})
