import { Window, type Element as DomElement } from 'happy-dom'
import { afterAll, describe, expect, it } from 'vitest'
import { qualifiedNameOf } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { productApiRoots } from '../src/lib/product-api'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { indexedText } from './indexed-text'

/**
 * A product's reference index lists its declarations of every kind, so each entry leads with the kind badge a
 * mention of it carries elsewhere.
 */
const window = new Window()
afterAll(async () => { await window.happyDOM.abort() })

async function render(port: string, product: 'workspace' | 'mcp') {
  const template = await loadAstroTemplate('components/api/ProductApiIndex.astro')
  window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port, product, version: 'latest' } })
  return window.document
}

/** The entries that do not lead with a kind badge before a code-styled name. */
const plain = (root: Pick<DomElement, 'querySelectorAll'>) => [...root.querySelectorAll('dt > a')].filter((link) =>
  !link.matches('.api-mention') || !link.querySelector(':scope > .api-link-kind') || !link.querySelector(':scope > .api-symbol-link__name > code')).map((link) => link.getAttribute('href'))

describe('a product reference index', () => {
  it.each([['java', 'workspace'], ['py', 'mcp']] as const)('leads each %s %s entry with its kind', async (port, product) => {
    const root = await render(port, product)
    const symbols = productApiRoots(API_MODELS[port], product)
    const links = [...root.querySelectorAll('dt > a.api-mention')]
    expect(links).toHaveLength(symbols.length)
    expect(links.length).toBeGreaterThan(0)
    expect(plain(root)).toEqual([])
    for (const link of links) {
      const symbol = symbols.find((entry) => qualifiedNameOf(entry) === link.querySelector('code')!.textContent)!
      expect(link.querySelector(':scope > .api-link-kind')!.getAttribute('data-api-kind'), qualifiedNameOf(symbol)).toBe(symbol.kind)
    }
  })

  it('is searched by its bare names, without the mark that leads each', async () => {
    const root = await render('java', 'workspace')
    const marks = [...root.querySelectorAll('dt > a.api-mention')].map((link) => `${link.querySelector('.api-badge__label')!.textContent}${link.querySelector('code')!.textContent}`)
    const text = await indexedText(root.body.innerHTML)
    expect(marks.filter((fused) => text.includes(fused))).toEqual([])
    // Without the ignore, Pagefind fuses the first mark to its name, so the check above can fail.
    expect((await indexedText(root.body.innerHTML.replaceAll(' data-pagefind-ignore="all"', ''))).includes(marks[0]!)).toBe(true)
  })

  it('is caught when an entry is a bare code link, so the check above can fail', () => {
    const entry = window.document.createElement('div')
    entry.innerHTML = '<dl><dt><a href="/x/"><code>x.Y</code></a></dt></dl>'
    expect(plain(entry)).toEqual(['/x/'])
  })
})
