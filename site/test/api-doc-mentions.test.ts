import { Window, type Element as DomElement, type HTMLAnchorElement as DomAnchor } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll } from 'astro-expressive-code/hast'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { mentionBadge, mentionBadgeHtml } from '../src/lib/mention-badge'
import { apiComponents } from './api-components'
import { indexedText } from './indexed-text'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

/**
 * A doc comment's cross-reference is the link alone: the stylesheet tints it by kind, and the kind stays in the title, the
 * data attribute and the accessible name. `ApiDoc` renders the prose of every reference page, so these read what it writes.
 * A Markdown page still marks the first mention of a name with the kind's badge.
 */
const model = API_MODELS.ts
const hrefFor = (symbol: ApiSymbol) => `/en/ts/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const window = new Window()
let doc: Awaited<ReturnType<typeof apiComponents>>['doc']
beforeAll(async () => { doc = (await apiComponents()).doc })
afterAll(async () => { await window.happyDOM.abort() })

async function render(text: string, context?: ApiSymbol) {
  const container = await experimental_AstroContainer.create()
  window.document.body.innerHTML = await container.renderToString(doc, { props: { text, index, context } })
  return window.document
}

/** What is wrong with the way a page writes its links to declarations, so a test can name the failure and a control can prove it is able to fail. */
function problems(root: Pick<DomElement, 'querySelectorAll'>): string[] {
  const found: string[] = []
  for (const link of root.querySelectorAll<DomAnchor>('a.api-xref')) {
    const href = link.getAttribute('href')!
    if (!link.matches('.api-mention')) found.push(`${href}: not a mention`)
    if (link.querySelector('.api-link-kind')) found.push(`${href}: carries a kind badge`)
    if (!(link.getAttribute('aria-label') && link.dataset.apiKind && link.getAttribute('title'))) found.push(`${href}: lost its kind`)
  }
  return found
}

describe('a doc comment cross-reference', () => {
  it('names its kind in the title, the data attribute and the accessible name, and draws no badge', async () => {
    const root = await render('`Pane` sits in a `Window`. Send keys to a `Pane` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.api-xref')]
    expect(links.map((link) => link.textContent)).toEqual(['Pane', 'Window', 'Pane'])
    // `api-doc-link` is what the stylesheet tints: only links ApiDoc writes carry it.
    expect(links.map((link) => link.matches('.api-mention.api-doc-link'))).toEqual([true, true, true])
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['class: Pane', 'class: Window', 'class: Pane'])
    expect(links.map((link) => [link.dataset.apiKind, link.getAttribute('title')])).toEqual([['class', 'class'], ['class', 'class'], ['class', 'class']])
    expect(links.map((link) => link.querySelectorAll('.api-link-kind, .api-nav__kind').length)).toEqual([0, 0, 0])
    expect(links[0].querySelector(':scope > code.api-literal.api-literal--link')?.textContent).toBe('Pane')
    expect(problems(root)).toEqual([])
  })

  it('links the same declaration as a Markdown page, which keeps the badge on the first mention', async () => {
    const root = await render('`Pane` and `Pane`')
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    try {
      const page = fromHtml((await processor.render('Read `Pane` and `Pane`.', { frontmatter: { port: 'ts' } })).code, { fragment: true })
      const markdown = selectAll('a.api-mention', page)
      expect(markdown.map((link) => Boolean(select(':scope > .api-link-kind', link)))).toEqual([true, false])
      const mine = [...root.querySelectorAll<DomAnchor>('a.api-mention')]
      expect(mine.map((link) => link.getAttribute('href')!.replace(/^\/en/, ''))).toEqual(markdown.map((link) => link.properties.href))
      // The first mention's kind is its badge's; a later one carries it on the link.
      expect(mine.map((link) => link.dataset.apiKind))
        .toEqual(markdown.map((link) => link.properties.dataApiKind ?? select('.api-link-kind', link)?.properties.dataApiKind))
      expect(root.querySelector('.api-link-kind')).toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

  it('leaves a name inside a longer literal, and a name that links outside the site, as it was', async () => {
    const root = await render('`Selection<Pane>` and `AbortSignal`')
    expect(root.querySelector('.api-link-kind')).toBeNull()
    expect(root.querySelector('a.api-mention')).toBeNull()
    expect(root.querySelectorAll('a')).not.toHaveLength(0)
  })

  it('names a tmux command in the title, the data attribute and the accessible name, without a badge', async () => {
    const root = await render('Call `list-panes` and `list-panes` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.tmux-mention')]
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.querySelectorAll('.api-link-kind').length)).toEqual([0, 0])
    expect(links.map((link) => link.classList.contains('api-doc-link'))).toEqual([true, true])
    expect(links.map((link) => [link.getAttribute('title'), link.dataset.apiKind, link.getAttribute('aria-label')]))
      .toEqual(Array(2).fill(['tmux command', 'command', 'tmux command: list-panes']))
  })

  it('is caught when a reference is plain or badged, so the check above can fail', () => {
    const plain = window.document.createElement('div')
    plain.innerHTML = '<a class="api-xref" href="/en/ts/latest/reference/pane-pane/"><code class="api-literal api-literal--link">Pane</code></a>'
    expect(problems(plain)).toEqual([
      '/en/ts/latest/reference/pane-pane/: not a mention',
      '/en/ts/latest/reference/pane-pane/: lost its kind',
    ])
    const marked = window.document.createElement('div')
    const badge = '<span class="api-link-kind"></span><code>Pane</code>'
    marked.innerHTML = `<a class="api-xref api-mention" href="/p/" title="class" data-api-kind="class" aria-label="class: Pane">${badge}</a>`
    expect(problems(marked)).toEqual(['/p/: carries a kind badge'])
  })
})

describe('a name repeated in one docstring', () => {
  it('is the link alone in every paragraph, each keeping its kind', async () => {
    const prose = await loadAstroTemplate('components/api/ApiProse.astro', { real: ['components/api/ApiDoc.astro'], modules: { 'astro-expressive-code/components': { Code: () => '' } } })
    window.document.body.innerHTML = await renderAstroTemplate(prose, { props: { text: 'Read a `Pane`.\n\nThen a `Pane` again.', index } })
    expect(window.document.querySelectorAll('a.api-xref')).toHaveLength(2)
    expect(window.document.querySelector('.api-link-kind')).toBeNull()
    expect(problems(window.document)).toEqual([])
  })
})

describe('what search indexes of a mention', () => {
  it('is the bare name, with no mark leading it', async () => {
    const root = await render('Read a `Pane` and a `Window`.')
    expect(await indexedText(root.body.innerHTML)).toBe('Read a Pane and a Window.')
  })

  it('would fuse a mark to the name if prose drew one without the ignore attribute, so the check above can fail', async () => {
    const root = await render('Read a `Pane`.')
    const badge = mentionBadgeHtml(mentionBadge('class')!).replaceAll(' data-pagefind-ignore="all"', '')
    expect(await indexedText(root.body.innerHTML.replace('<code', `${badge}<code`))).toBe('Read a CPane.')
  })
})
