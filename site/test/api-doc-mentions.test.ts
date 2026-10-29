import { Window, type Element as DomElement, type HTMLAnchorElement as DomAnchor } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { select } from 'astro-expressive-code/hast'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { firstMention } from '../src/lib/mention-badge'
import { apiComponents } from './api-components'
import { indexedText } from './indexed-text'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

/**
 * A doc comment's cross-reference leads with its kind, as a Markdown page's mention does.
 * `ApiDoc` renders the prose of every reference page, so these read what it writes and hold it to the markup
 * `rehype-api-links` writes for the same declaration.
 */
const model = API_MODELS.ts
const hrefFor = (symbol: ApiSymbol) => `/en/ts/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const window = new Window()
let doc: Awaited<ReturnType<typeof apiComponents>>['doc']
beforeAll(async () => { doc = (await apiComponents()).doc })
afterAll(async () => { await window.happyDOM.abort() })

async function render(text: string, context?: ApiSymbol, first?: ReturnType<typeof firstMention>) {
  const container = await experimental_AstroContainer.create()
  window.document.body.innerHTML = await container.renderToString(doc, { props: { text, index, context, first } })
  return window.document
}

/** What is wrong with the way a page leads its links to declarations, so a test can name the failure and a control can prove it is able to fail. */
function problems(root: Pick<DomElement, 'querySelectorAll'>): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const link of root.querySelectorAll<DomAnchor>('a.api-xref')) {
    const href = link.getAttribute('href')!
    const later = seen.has(href)
    seen.add(href)
    const marked = Boolean(link.querySelector(':scope > .api-link-kind'))
    if (!link.matches('.api-mention')) found.push(`${href}: not a mention`)
    if (later && marked) found.push(`${href}: a later mention is marked`)
    if (!later && !marked) found.push(`${href}: the first mention is plain`)
    if (later && !(link.getAttribute('aria-label') && link.dataset.apiKind && link.getAttribute('title'))) found.push(`${href}: a later mention lost its kind`)
  }
  return found
}

describe('a doc comment cross-reference', () => {
  it('leads with its kind the first time and is the link alone after', async () => {
    const root = await render('`Pane` sits in a `Window`. Send keys to a `Pane` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.api-xref')]
    expect(links.map((link) => link.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['CPane', 'CWindow', 'Pane'])
    expect(links.map((link) => link.matches('.api-mention'))).toEqual([true, true, true])
    const [first, , later] = links
    expect(first.querySelector(':scope > .api-link-kind.api-nav__kind.api-badge--kind-class')?.getAttribute('data-api-kind')).toBe('class')
    expect(first.querySelector(':scope > .api-symbol-link__name > code.api-literal.api-literal--link')?.textContent).toBe('Pane')
    expect(later.querySelector('.api-link-kind')).toBeNull()
    expect(later.getAttribute('aria-label')).toBe('class: Pane')
    expect(later.dataset.apiKind).toBe('class')
    expect(later.getAttribute('title')).toBe('class')
    expect(problems(root)).toEqual([])
  })

  it('writes the badge a Markdown page writes for the same declaration', async () => {
    const root = await render('`Pane`')
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    try {
      const page = fromHtml((await processor.render('Read `Pane`.', { frontmatter: { port: 'ts' } })).code, { fragment: true })
      const badge = select('a.api-mention > .api-link-kind', page)!
      expect(badge).toBeDefined()
      const mine = root.querySelector('a.api-mention > .api-link-kind')!
      expect(mine.getAttribute('class')!.split(' ')).toEqual((badge.properties.className as string[]))
      expect(mine.getAttribute('data-api-kind')).toBe(badge.properties.dataApiKind)
      expect(mine.getAttribute('aria-hidden')).toBe(badge.properties.ariaHidden)
      expect(mine.getAttribute('data-pagefind-ignore')).toBe(String(badge.properties.dataPagefindIgnore))
      expect(mine.getAttribute('title')).toBe(badge.properties.title ?? mine.getAttribute('title'))
      expect(mine.querySelector('.api-badge__label')!.getAttribute('data-mark')).toBe(String(select('.api-badge__label', badge)!.properties.dataMark))
      expect(mine.textContent).toBe((select('.api-badge__label', badge)!.children[0] as { value: string }).value)
    } finally { vi.unstubAllEnvs() }
  })

  it('leaves a name inside a longer literal, and a name that links outside the site, as it was', async () => {
    const root = await render('`Selection<Pane>` and `AbortSignal`')
    expect(root.querySelector('.api-link-kind')).toBeNull()
  })

  it('marks a tmux command named in prose, the way a Markdown page does', async () => {
    const root = await render('Call `list-panes` and `list-panes` again.')
    const links = [...root.querySelectorAll<DomAnchor>('a.tmux-mention')]
    expect(links).toHaveLength(2)
    expect(links[0].querySelector(':scope > .api-link-kind.api-badge--kind-command')?.getAttribute('title')).toBe('tmux command')
    expect(links[1].querySelector('.api-link-kind')).toBeNull()
    expect(links[1].getAttribute('aria-label')).toBe('tmux command: list-panes')
  })

  it('is caught when a reference is plain, so the check above can fail', () => {
    const plain = window.document.createElement('div')
    plain.innerHTML = '<a class="api-xref" href="/en/ts/latest/reference/pane-pane/"><code class="api-literal api-literal--link">Pane</code></a>'
    expect(problems(plain)).toEqual([
      '/en/ts/latest/reference/pane-pane/: not a mention',
      '/en/ts/latest/reference/pane-pane/: the first mention is plain',
    ])
    const marked = window.document.createElement('div')
    const badge = '<span class="api-link-kind"></span><code>Pane</code>'
    marked.innerHTML = `<a class="api-xref api-mention" href="/p/">${badge}</a><a class="api-xref api-mention" href="/p/">${badge}</a>`
    expect(problems(marked)).toContain('/p/: a later mention is marked')
  })
})

describe('a name marked once in an entry', () => {
  it('is the link alone in a text that follows one that marked it, when they share the entry', async () => {
    const first = firstMention()
    const one = await render('Read a `Pane`.', undefined, first)
    expect(one.querySelectorAll('.api-link-kind')).toHaveLength(1)
    const two = await render('And another `Pane`, with a `Window`.', undefined, first)
    expect([...two.querySelectorAll('a.api-xref')].map((link) => Boolean(link.querySelector('.api-link-kind')))).toEqual([false, true])
    expect(problems(two)).toContain('/en/ts/latest/reference/pane-pane/: the first mention is plain')
  })

  it('is marked in each text rendered alone, so the sharing above is what changes it', async () => {
    await render('Read a `Pane`.')
    const alone = await render('And another `Pane`.')
    expect(alone.querySelectorAll('.api-link-kind')).toHaveLength(1)
  })

  it('is shared by the paragraphs of one docstring', async () => {
    const prose = await loadAstroTemplate('components/api/ApiProse.astro', { real: ['components/api/ApiDoc.astro'], modules: { 'astro-expressive-code/components': { Code: () => '' } } })
    window.document.body.innerHTML = await renderAstroTemplate(prose, { props: { text: 'Read a `Pane`.\n\nThen a `Pane` again.', index } })
    expect([...window.document.querySelectorAll('a.api-xref')].map((link) => Boolean(link.querySelector('.api-link-kind')))).toEqual([true, false])
  })
})

describe('what search indexes of a marked mention', () => {
  it('is the bare name, without the mark that leads it', async () => {
    const root = await render('Read a `Pane` and a `Window`.')
    expect(await indexedText(root.body.innerHTML)).toBe('Read a Pane and a Window.')
  })

  it('would fuse the mark to the name without the ignore attribute, so the check above can fail', async () => {
    const root = await render('Read a `Pane`.')
    expect(await indexedText(root.body.innerHTML.replaceAll(' data-pagefind-ignore="all"', ''))).toBe('Read a CPane.')
  })
})
