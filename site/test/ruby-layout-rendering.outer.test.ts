// Compiles and renders real Astro declarations; pure layout fixtures remain in medium.
import { expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { displayedSignature, renderSignatures } from './signature-fragment'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { SymbolIndex } from '@libtmux/api-model/reference'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = API_MODELS.ruby

it('renders the page declaration and the Markdown export from one layout', async () => {
      const symbol = model.symbols.find((entry) => entry.id === 'LibTmux::Async::Server#new_session')!
      expect(symbol.signatures).toHaveLength(2)
      const index = new SymbolIndex(model.symbols, (entry) => `/en/ruby/latest/reference/${entry.slug}/`, 'ruby')
      const { signatures, window, layouts: prepared } = await renderSignatures(symbol, 'ruby', index)
      try {
        const expected = symbol.signatures.map((signature) => prepared.get(signature)!.text)
        expect(signatures.map(displayedSignature)).toEqual(expected)
        expect(signatures.map((element) => element.getAttribute('data-code-columns'))).toEqual(['60', '60'])
        expect(signatures.map((element) => element.getAttribute('data-code-width-status'))).toEqual(['fits', 'fits'])
        expect(signatures[1]!.querySelector('a[href="/en/ruby/latest/reference/' + model.symbols.find((entry) => entry.id === 'LibTmux::Session')!.slug + '/"]')?.textContent).toBe('LibTmux::Session')
        expect([...window.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
        const markdown = await symbolMarkdownWithLayout({ model, symbol })
        const fenced = fromMarkdown(markdown).children.find((node) => node.type === 'code')
        expect(fenced?.type === 'code' && fenced.value).toBe(expected.join('\n\n'))
      } finally { await window.happyDOM.abort() }
    })
