import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { select, selectAll, type Element, type Nodes } from 'astro-expressive-code/hast'
import { fromHtml } from 'hast-util-from-html'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT', ''))
afterEach(() => vi.unstubAllEnvs())

const processor = createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
const render = async (source: string, port = 'rs') => fromHtml((await (await processor).render(source, { frontmatter: { port } })).code, { fragment: true })

const sections = (tree: Nodes): Element[][] => {
  const groups: Element[][] = [[]]
  const walk = (node: Nodes) => {
    if (!('children' in node)) return
    for (const child of node.children) {
      if (child.type !== 'element') continue
      if (/^h[1-6]$/.test(child.tagName)) groups.push([])
      else if (child.tagName === 'a' && (child.properties.className as string[] | undefined)?.some((name) => name.endsWith('-mention'))) groups.at(-1)!.push(child)
      else walk(child)
    }
  }
  walk(tree)
  return groups
}
const marked = (anchor: Element) => selectAll('.api-link-kind', anchor).length > 0

/**
 * The density rule: the first mention of a name in a section carries the mark;
 * a later mention in the same section is a plain code link that keeps its kind
 * in `title` and `aria-label`. Returns what breaks the rule, so a test can name
 * the failure and a negative control can prove the check is able to fail.
 */
function violations(tree: Nodes): string[] {
  const found: string[] = []
  sections(tree).forEach((anchors, index) => {
    const seen = new Set<string>()
    for (const anchor of anchors) {
      const key = String(anchor.properties.href)
      const later = seen.has(key)
      seen.add(key)
      if (later && marked(anchor)) found.push(`section ${index}: later mention of ${key} is marked`)
      if (!later && !marked(anchor)) found.push(`section ${index}: first mention of ${key} is plain`)
      if (later && !(anchor.properties.ariaLabel && anchor.properties.dataApiKind && anchor.properties.title)) {
        found.push(`section ${index}: later mention of ${key} lost its kind`)
      }
    }
  })
  return found
}

describe('mention density', () => {
  it('marks the first mention of a name in a section and leaves later ones plain', async () => {
    const tree = await render('Read `list-clients`. Then `list-clients` again, and `Client`.\n\nOnce more, `list-clients`.')
    const [anchors] = sections(tree)
    expect(anchors!.map(marked)).toEqual([true, false, true, false])
    expect(violations(tree)).toEqual([])
  })

  it('keeps the kind of a plain mention in its tooltip and accessible name', async () => {
    const tree = await render('Read `list-clients`, then `list-clients`.')
    const later = selectAll('a.tmux-mention', tree)[1]!
    expect(later.properties).toMatchObject({ dataApiKind: 'command', ariaLabel: 'tmux command: list-clients' })
    expect(later.properties.title).toBe('tmux command')
    expect(select('.api-link-kind', later)).toBeUndefined()
    expect(select('code', later)).toBeDefined()
  })

  it('marks a name again after a heading starts a new section', async () => {
    const tree = await render('Read `list-clients`, then `list-clients`.\n\n## Next\n\nSee `list-clients`, then `list-clients`.')
    const [intro, next] = sections(tree)
    expect(intro!.map(marked)).toEqual([true, false])
    expect(next!.map(marked)).toEqual([true, false])
    expect(violations(tree)).toEqual([])
  })

  it('marks library mentions the same way', async () => {
    const tree = await render('Read `Client`, then `Client`.\n\n## Again\n\nA `Client` and a `Client`.')
    const [first, second] = sections(tree)
    expect(first!.map(marked)).toEqual([true, false])
    expect(second!.map(marked)).toEqual([true, false])
    expect(violations(tree)).toEqual([])
  })

  describe('negative controls', () => {
    it('flags a section where a later mention still carries its mark', () => {
      const badge = '<span class="api-link-kind api-nav__kind"></span>'
      const tree = fromHtml(`<p><a class="tmux-mention" href="/a/">${badge}<code>a</code></a> <a class="tmux-mention" href="/a/">${badge}<code>a</code></a></p>`, { fragment: true })
      expect(violations(tree)).toEqual(['section 0: later mention of /a/ is marked', 'section 0: later mention of /a/ lost its kind'])
    })

    it('flags a first mention that lost its mark', () => {
      const tree = fromHtml('<p><a class="tmux-mention" href="/a/"><code>a</code></a></p>', { fragment: true })
      expect(violations(tree)).toEqual(['section 0: first mention of /a/ is plain'])
    })

    it('does not mistake distinct names for repeats', async () => {
      const tree = await render('Use `list-clients`, `list-sessions` and `list-windows`.')
      expect(sections(tree)[0]!.map(marked)).toEqual([true, true, true])
    })
  })
})
