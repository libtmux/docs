import { Window, type Element as DomElement, type HTMLAnchorElement as DomAnchor } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { select, selectAll } from 'astro-expressive-code/hast'
import { SymbolIndex, type ApiSymbol } from '@libtmux/api-model'
import { API_MODELS, indexFor } from '../src/lib/api-models'
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

async function render(text: string, context?: ApiSymbol, from: SymbolIndex = index) {
  const container = await experimental_AstroContainer.create()
  window.document.body.innerHTML = await container.renderToString(doc, { props: { text, index: from, context } })
  return window.document
}

/** Doc-comment prose as `ApiProse` draws it: its blocks, each with the links `ApiDoc` writes. */
async function renderProse(text: string, context?: ApiSymbol, from: SymbolIndex = index) {
  const prose = await loadAstroTemplate('components/api/ApiProse.astro', { real: ['components/api/ApiDoc.astro'], modules: { 'astro-expressive-code/components': { Code: () => '' } } })
  window.document.body.innerHTML = await renderAstroTemplate(prose, { props: { text, index: from, context } })
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

describe('a callable named in prose', () => {
  const declare = (id: string, kind: ApiSymbol['kind']): ApiSymbol => ({
    id, publicId: id, name: id.split('.').at(-1)!, kind, slug: id.replaceAll('.', '-').toLowerCase(),
    modifiers: [], signatures: [], source: { file: 'pane.ts' },
  })
  const local = new SymbolIndex([
    declare('pane.Pane', 'class'), declare('pane.Pane.kill', 'method'), declare('pane.Pane.id', 'property'), declare('pane.open', 'function'),
  ], (symbol) => `/en/ts/latest/reference/${symbol.slug}/`, 'ts')
  const linked = (root: Pick<DomElement, 'querySelectorAll'>) => [...root.querySelectorAll<DomAnchor>('a.api-mention')].map((link) => [link.textContent, link.dataset.apiKind])

  it('reads as a call when it is a method or a function, and as written when it is not', async () => {
    const root = await render('Call `Pane.kill` or `open`; read `Pane.id` of a `Pane`.', undefined, local)
    expect(linked(root)).toEqual([['Pane.kill()', 'method'], ['open()', 'function'], ['Pane.id', 'property'], ['Pane', 'class']])
    // The accessible name holds the visible text, parentheses included, so a voice command that says it works.
    expect([...root.querySelectorAll('a.api-mention')].map((link) => link.getAttribute('aria-label')))
      .toEqual(['method: Pane.kill()', 'function: open()', 'property: Pane.id', 'class: Pane'])
  })

  it('leaves the words an author chose for the link, and an operator, as written', async () => {
    const java = new SymbolIndex([declare('pane.Pane', 'class'), declare('pane.Pane.kill', 'method')], (symbol) => `/en/java/latest/reference/${symbol.slug}/`, 'java')
    const explicit = await render('Wait for the {@link Pane#kill readiness callback}.', undefined, java)
    expect(linked(explicit)).toEqual([['readiness callback', 'method']])
    expect(explicit.querySelector('a.api-mention')?.getAttribute('aria-label')).toBe('method: readiness callback')
    // An operator resolves beside its own declaration: Swift's `==` from `hash(into:)`, Scala's `&&` and `||` from themselves.
    const operator = async (port: 'swift' | 'scala', owner: string, label: string) => {
      const context = API_MODELS[port].symbols.find((symbol) => symbol.id === owner)!
      const root = await render(`Compare with \`${label}\`.`, context, indexFor(API_MODELS[port], (symbol) => `/en/${port}/latest/reference/${symbol.slug}/`))
      return linked(root)
    }
    expect(await operator('swift', 'Server.hash(into:)', '==')).toEqual([['==', 'function']])
    expect(await operator('scala', 'io.github.libtmux.scaladsl.query.Expr.&&', '&&')).toEqual([['&&', 'method']])
    expect(await operator('scala', 'io.github.libtmux.scaladsl.query.Expr.||', '||')).toEqual([['||', 'method']])
  })

  it('keeps a label that already says how it is invoked', async () => {
    expect(linked(await render('Call `Pane.kill()`.', undefined, local))).toEqual([['Pane.kill()', 'method']])
    // Elixir writes a function with its arity and PowerShell invokes a cmdlet by name.
    const elixir = await render('See `LibTmux.Capture.fetch/2`.', undefined, indexFor(API_MODELS.elixir, (symbol) => `/en/elixir/latest/reference/${symbol.slug}/`))
    expect(linked(elixir)).toEqual([['LibTmux.Capture.fetch/2', 'function']])
    const powershell = await render('See `Connect-TmuxServer`.', undefined, indexFor(API_MODELS.powershell, (symbol) => `/en/powershell/latest/reference/${symbol.slug}/`))
    expect(linked(powershell)).toEqual([['Connect-TmuxServer', 'function']])
  })
})

describe('a name repeated in one docstring', () => {
  it('is the link alone in every paragraph, each keeping its kind', async () => {
    const root = await renderProse('Read a `Pane`.\n\nThen a `Pane` again.')
    expect(root.querySelectorAll('a.api-xref')).toHaveLength(2)
    expect(root.querySelector('.api-link-kind')).toBeNull()
    expect(problems(root)).toEqual([])
  })
})

describe('a pipe table in a doc comment', () => {
  const text = 'Every handle:\n\n| To | Call |\n| --- | :-: |\n| read one | `Pane` |\n| write | `Window` and `a\\|b` |\n\nAfter.'

  it('renders as a table whose cells link their references, not as a paragraph of pipes', async () => {
    const root = await renderProse(text)
    const table = root.querySelector('.api-prose-table > table')!
    expect(table).not.toBeNull()
    // A wide table scrolls inside its region, which a keyboard must reach and a reader must hear named.
    const region = table.parentElement!
    expect([region.getAttribute('role'), region.getAttribute('aria-label'), region.getAttribute('tabindex')]).toEqual(['region', 'Table', '0'])
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['To', 'Call'])
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.getAttribute('style'))).toEqual([null, 'text-align: center'])
    expect([...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)))
      .toEqual([['read one', 'Pane'], ['write', 'Window and a|b']])
    expect([...table.querySelectorAll('tbody a.api-mention')].map((link) => link.getAttribute('data-api-kind'))).toEqual(['class', 'class'])
    expect([...root.querySelectorAll('p')].map((paragraph) => paragraph.textContent!.trim())).toEqual(['Every handle:', 'After.'])
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
