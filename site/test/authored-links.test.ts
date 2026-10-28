import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { select, selectAll, type Element, type Nodes } from 'astro-expressive-code/hast'
import { fromHtml } from 'hast-util-from-html'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesIn } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { tmuxEntityAt } from '../src/lib/tmux-links'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT', ''))
afterEach(() => vi.unstubAllEnvs())

/**
 * A link a page author writes by hand to a page that documents one name leads with that name's kind, as the same
 * name found in a code span does. Which pages document a name is the site's own data; the words of the link say
 * whether it is the name that is meant.
 */
const processor = createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
const render = async (source: string, port = 'py') => fromHtml((await (await processor).render(source, { frontmatter: { port } })).code, { fragment: true })
const badge = (anchor: Element) => select(':scope > .api-link-kind', anchor)
const anchors = (tree: Nodes) => selectAll('a', tree)

/** What is wrong with the way a page leads its hand-written links, so a control can show the check is able to fail. */
function problems(tree: Nodes, expected: Record<string, string | undefined>): string[] {
  return anchors(tree).flatMap((anchor) => {
    const href = String(anchor.properties.href)
    if (!(href in expected)) return []
    const kind = badge(anchor)?.properties.dataApiKind
    return kind === expected[href] ? [] : [`${href}: expected ${expected[href] ?? 'no badge'}, found ${kind ?? 'no badge'}`]
  })
}

describe('a link written by hand to a tmux page', () => {
  const links = [
    '[`list-sessions`](/tmux/latest/manual/list-sessions/)',
    '[`exit-empty`](/tmux/latest/catalog/options/exit-empty/)',
    '[`pane_id`](/tmux/latest/catalog/formats/pane_id/)',
    '[`after-new-session`](/tmux/latest/catalog/hooks/after-new-session/)',
  ]

  it('leads with the kind of the command, option, format variable or hook it documents', async () => {
    const tree = await render(links.map((link) => `Read ${link}.`).join('\n\n'))
    expect(problems(tree, {
      '/tmux/latest/manual/list-sessions/': 'command',
      '/tmux/latest/catalog/options/exit-empty/': 'option',
      '/tmux/latest/catalog/formats/pane_id/': 'format',
      '/tmux/latest/catalog/hooks/after-new-session/': 'hook',
    })).toEqual([])
    const [anchor] = anchors(tree)
    expect(anchor!.properties.className).toContain('tmux-mention')
    expect(badge(anchor!)!.properties.title).toBe('tmux command')
    expect(select(':scope > .api-symbol-link__name > code', anchor!)).toBeDefined()
  })

  it('marks the first mention in a section and keeps the kind of a later one', async () => {
    const tree = await render('[`list-sessions`](/tmux/latest/manual/list-sessions/), then [`list-sessions`](/tmux/latest/manual/list-sessions/).')
    const [first, later] = anchors(tree)
    expect(badge(first!)).toBeDefined()
    expect(badge(later!)).toBeUndefined()
    expect(later!.properties).toMatchObject({ dataApiKind: 'command', ariaLabel: 'tmux command: list-sessions', title: 'tmux command' })
  })

  it('leaves a link whose words are not the name, and a page that documents no single name', async () => {
    const tree = await render('Send [`Enter`](/tmux/latest/manual/send-keys/) or read the [full manual](/tmux/latest/manual/full/#FORMATS) and [`nonesuch`](/tmux/latest/manual/nonesuch/).')
    expect(selectAll('.api-link-kind', tree)).toEqual([])
  })

  it('leaves a phrase about the name, however it is styled', async () => {
    const tree = await render([
      'See the [send-keys reference](/tmux/latest/manual/send-keys/),',
      'the [`send-keys` command](/tmux/latest/manual/send-keys/) and [how `capture-pane` works](/tmux/latest/manual/capture-pane/).',
    ].join('\n'))
    expect(selectAll('.api-link-kind', tree)).toEqual([])
  })

  it('leads a bare name and a command line that adds flags to it', async () => {
    const tree = await render([
      '[send-keys](/tmux/latest/manual/send-keys/)', '[`capture-pane -N`](/tmux/latest/manual/capture-pane/)',
      '[`tmux kill-pane`](/tmux/latest/manual/kill-pane/)',
    ].join('\n\n'))
    expect(problems(tree, {
      '/tmux/latest/manual/send-keys/': 'command', '/tmux/latest/manual/capture-pane/': 'command', '/tmux/latest/manual/kill-pane/': 'command',
    })).toEqual([])
  })

  it('names an entity from its path alone', () => {
    expect(tmuxEntityAt('/tmux/latest/manual/send-keys/')).toEqual({ kind: 'command', name: 'send-keys' })
    expect(tmuxEntityAt('/en/tmux/latest/catalog/options/exit-empty/')).toEqual({ kind: 'option', name: 'exit-empty' })
    expect(tmuxEntityAt('/tmux/latest/manual/full/')).toBeUndefined()
    expect(tmuxEntityAt('/tmux/latest/catalog/options/')).toBeUndefined()
    expect(tmuxEntityAt('/tmux/not-a-release/manual/send-keys/')).toBeUndefined()
  })

  it('is caught when a link stays plain, so the check above can fail', () => {
    const tree = fromHtml('<p><a href="/tmux/latest/manual/list-sessions/"><code>list-sessions</code></a></p>', { fragment: true })
    expect(problems(tree, { '/tmux/latest/manual/list-sessions/': 'command' })).toEqual(['/tmux/latest/manual/list-sessions/: expected command, found no badge'])
  })
})

describe('a link written by hand to a module of the reference', () => {
  const names = (port: string) => new Set(modulesIn(API_MODELS[port]).map((module) => module.name))
  const [pyOnly] = [...names('py')].filter((name) => !names('ts').has(name))
  const [tsOnly] = [...names('ts')].filter((name) => !names('py').has(name))
  const link = (port: string, name: string) => `See [\`${name}\`](/${port}/latest/reference/#${name}).`

  it('leads with the module kind when the reference index anchors it', async () => {
    const tree = await render(link('py', pyOnly!))
    const [anchor] = anchors(tree)
    expect(badge(anchor!)?.properties.dataApiKind).toBe('module')
    expect(select('.api-badge__label', anchor!)?.children[0]).toMatchObject({ value: 'M' })
  })

  it('asks the port the link names, not the port of the page', async () => {
    // A Python page linking a TypeScript module, and a TypeScript page linking a Python one.
    expect(problems(await render(link('ts', tsOnly!), 'py'), { [`/ts/latest/reference/#${tsOnly}`]: 'module' })).toEqual([])
    expect(problems(await render(link('py', pyOnly!), 'ts'), { [`/py/latest/reference/#${pyOnly}`]: 'module' })).toEqual([])
    // A name the named port does not anchor stays plain, whichever page links it.
    expect(selectAll('.api-link-kind', await render(link('ts', pyOnly!), 'py'))).toEqual([])
    expect(selectAll('.api-link-kind', await render(link('py', tsOnly!), 'ts'))).toEqual([])
  })

  it('leads on a page that belongs to no port', async () => {
    const tree = fromHtml((await (await processor).render(link('py', pyOnly!), { frontmatter: {} })).code, { fragment: true })
    expect(problems(tree, { [`/py/latest/reference/#${pyOnly}`]: 'module' })).toEqual([])
  })

  it('leaves an anchor the index does not have, and the index itself', async () => {
    const tree = await render('See [`nope`](/py/latest/reference/#nope) and the [index](/py/latest/reference/).')
    expect(selectAll('.api-link-kind', tree)).toEqual([])
  })
})
