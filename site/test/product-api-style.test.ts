import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { symbolsForProduct } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { memberTable } from '../src/lib/api-sections'
import { productApiRoots } from '../src/lib/product-api'
import { loadAstroTemplate, withoutScope } from './astro-templates'

/**
 * A product's API symbol page presents itself as a core one does: outside the reading column's `.prose` sizing, with a
 * type's members listed once, as the core page lists them.
 */
const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

describe('the layout of a product API page', () => {
  it('keeps the page body out of the .prose element whose h2 size outranks the reference headings', () => {
    const layout = source('layouts/DocsLayout.astro')
    expect(layout).toContain("reference && 'prose max-w-none dark:prose-invert'")
    const article = layout.slice(layout.indexOf('<article'), layout.indexOf('</article>'))
    // The slot comes after the prose element closes, not inside it.
    expect(article.indexOf('<slot />')).toBeGreaterThan(article.indexOf('</div>'))
    expect(source('components/api/ProductApiPage.astro')).toMatch(/tableOfContents=\{false\} reference/)
  })

  it('shares the member list with the core page rather than restyling it', () => {
    expect(source('components/api/ApiReference.astro')).toContain('<ApiMemberList')
    expect(source('components/api/ProductApiPage.astro')).toContain('<ApiMemberList')
    expect(source('components/api/ProductApiPage.astro')).not.toMatch(/<ApiEntry[^>]*\bmember\b/)
  })
})

describe('a product API page with members', () => {
  const load = () => loadAstroTemplate('components/api/ProductApiPage.astro', {
    real: ['components/api/ApiMemberList.astro', 'components/api/ApiScalarMembers.astro', 'components/api/ApiBadge.astro'],
    stubs: {
      'components/api/ApiEntry.astro': `---\nconst { symbol, member } = Astro.props\n---\n<dl id={symbol.publicId ?? symbol.id} data-entry={symbol.id} data-member={String(Boolean(member))}></dl>`,
      'components/api/ApiType.astro': '---\nconst { type } = Astro.props\n---\n<span>{type}</span>',
      'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n{text}',
    },
    modules: {
      '../../lib/page-ports-for': { pagePortsFor: async () => [] },
      '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
    },
  })
  async function render(port: string, id: string) {
    const model = API_MODELS[port]!
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const container = await experimental_AstroContainer.create()
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(await load() as never, {
      props: { model, symbol, version: 'latest' }, request: new Request('https://libtmux.org/en/'),
    }))
    return { model, symbol, document: win.document }
  }
  const members = (port: string, id: string) => {
    const model = API_MODELS[port]!
    const symbol = model.symbols.find((entry) => entry.id === id)!
    return symbolsForProduct(model, symbol.product as 'workspace').filter((entry) => entry.parent === id)
  }

  it('lists a table type once: the table, then the rest as linked rows, never as entries under a bar', async () => {
    const { document, symbol } = await render('rs', 'config.Workspace')
    const all = members('rs', symbol.id)
    const table = memberTable(symbol, all, 'rs')!
    expect(table.rest.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-member="true"]')).toHaveLength(0)
    expect(document.querySelector('.api-members > h2')?.firstChild?.textContent).toBe('Other members')
    expect(document.querySelectorAll('.api-members .api-member-list > li')).toHaveLength(table.rest.length)
    expect(document.querySelectorAll('.api-field-table tbody tr')).toHaveLength(table.rows.length)
  }, 60_000)

  it('keeps an anchor for every member whose entry the list replaced', async () => {
    const { document, symbol } = await render('rs', 'config.Workspace')
    for (const member of members('rs', symbol.id)) {
      expect(document.getElementById(member.publicId ?? member.id), member.id).not.toBeNull()
    }
  }, 60_000)

  it('lists the members of a type with no table as rows under Members', async () => {
    const model = API_MODELS.go!
    const owner = productApiRoots(model, 'workspace').find((entry) => members('go', entry.id).length > 0 && !memberTable(entry, members('go', entry.id), 'go'))!
    const { document } = await render('go', owner.id)
    expect(document.querySelectorAll('[data-member="true"]')).toHaveLength(0)
    expect(document.querySelector('.api-members > h2')?.firstChild?.textContent).toBe('Members')
    expect(document.querySelectorAll('.api-members .api-member-list > li').length).toBe(members('go', owner.id).length)
  }, 60_000)
})
