import { describe, expect, it } from 'vitest'
import { rehypeCodeTabs } from '../src/plugins/rehype-code-tabs.mjs'

/**
 * The grouping rule itself, away from a built page.
 *
 * `code-tabs.test.ts` drives the rendered control and needs `_site` on disk;
 * this decides which fences become one group in the first place, which is
 * where the interesting cases live and where a stale build hid a bug for a
 * whole site's worth of pages.
 */

type El = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: El[]
  value?: string
}

const fence = (lang: string): El => ({
  type: 'element',
  tagName: 'pre',
  properties: {},
  children: [
    {
      type: 'element',
      tagName: 'code',
      properties: { className: [`language-${lang}`] },
      children: [{ type: 'text', value: `// ${lang}\n` }],
    },
  ],
})

const para = (text: string): El => ({
  type: 'element',
  tagName: 'p',
  properties: {},
  children: [{ type: 'text', value: text }],
})

const gap = (): El => ({ type: 'text', value: '\n' })

const run = (children: El[]) => {
  const tree: El = { type: 'root', children }
  rehypeCodeTabs()(tree)
  return tree
}

const groups = (tree: El) =>
  (tree.children ?? []).filter((c) => c.tagName === 'libtmux-code-tabs')

const portsOf = (group: El) => String(group.properties?.['data-ports'] ?? '').split(',')

const panelFor = (group: El, port: string) =>
  (group.children ?? [])
    .filter((c) => c.properties?.class === 'code-tab-panel')
    .find((c) => c.properties?.['data-port'] === port)

describe('rehypeCodeTabs grouping', () => {
  it('groups fences separated only by whitespace', () => {
    const tree = run([fence('python'), gap(), fence('go'), gap(), fence('rust')])
    expect(groups(tree)).toHaveLength(1)
    expect(portsOf(groups(tree)[0])).toEqual(['py', 'go', 'rs'])
  })

  it('leaves a lone fence alone', () => {
    const tree = run([fence('python')])
    expect(groups(tree)).toHaveLength(0)
  })

  it('does not tab a fence that belongs to no port', () => {
    const tree = run([fence('console'), gap(), fence('python'), gap(), fence('go')])
    expect(groups(tree)).toHaveLength(1)
    expect(portsOf(groups(tree)[0])).toEqual(['py', 'go'])
  })

  /**
   * The bug that shipped: `/topics/architecture/` explains in prose why
   * Swift's shape differs, then shows the Swift fence. That paragraph ended
   * the run, so Swift rendered as a bare block below a seven-tab group.
   *
   * Prose introducing one port's example belongs to that port's panel.
   */
  it('keeps a port in the group when prose introduces its fence', () => {
    const tree = run([
      fence('python'),
      gap(),
      fence('cpp'),
      gap(),
      para('Swift is the outlier, and deliberately so.'),
      gap(),
      fence('swift'),
    ])

    expect(groups(tree)).toHaveLength(1)
    expect(portsOf(groups(tree)[0])).toEqual(['py', 'cxx', 'swift'])
  })

  it('renders that prose inside the panel it introduces', () => {
    const tree = run([
      fence('python'),
      gap(),
      para('Swift is the outlier.'),
      gap(),
      fence('swift'),
    ])

    const swift = panelFor(groups(tree)[0], 'swift')
    expect(swift, 'a Swift panel').toBeTruthy()
    const text = JSON.stringify(swift)
    expect(text).toContain('Swift is the outlier.')

    // and it must not also remain outside the group
    const stray = (tree.children ?? []).filter((c) => c.tagName === 'p')
    expect(stray).toHaveLength(0)
  })

  it('ends the group at prose that introduces no fence', () => {
    const tree = run([
      fence('python'),
      gap(),
      fence('go'),
      gap(),
      para('An unrelated closing paragraph.'),
    ])

    expect(groups(tree)).toHaveLength(1)
    expect(portsOf(groups(tree)[0])).toEqual(['py', 'go'])
    // the trailing prose stays a sibling, after the group
    const kids = tree.children ?? []
    expect(kids[kids.length - 1].tagName).toBe('p')
  })

  it('starts a new group when a port repeats', () => {
    const tree = run([
      fence('python'),
      gap(),
      fence('go'),
      gap(),
      fence('python'),
      gap(),
      fence('go'),
    ])

    const gs = groups(tree)
    expect(gs).toHaveLength(2)
    expect(portsOf(gs[0])).toEqual(['py', 'go'])
    expect(portsOf(gs[1])).toEqual(['py', 'go'])
  })
})
