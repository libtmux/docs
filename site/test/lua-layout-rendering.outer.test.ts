// Compiles and renders real Astro declarations; pure layout fixtures remain in medium.
import { expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { displayedSignature, renderSignatures } from './signature-fragment'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { SymbolIndex } from '@libtmux/api-model/reference'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'

const model = API_MODELS.lua

it('renders the page declaration, with every overload, from the Markdown layout', async () => {
      const index = new SymbolIndex(model.symbols, (entry) => `/en/lua/latest/reference/${entry.slug}/`, 'lua')
      for (const id of ['libtmux.Window:set_option', 'libtmux.Server:handle']) {
        const symbol = model.symbols.find((entry) => entry.id === id)!
        const { signatures, window, layouts: prepared } = await renderSignatures(symbol, 'lua', index)
        try {
          const expected = symbol.signatures.map((signature) => prepared.get(signature)!.text)
          expect(signatures.map(displayedSignature)).toEqual(expected)
          expect(signatures.map((element) => element.getAttribute('data-code-width-status')))
            .toEqual(expected.map((text) => text.split('\n').some((line) => line.length > 60) ? 'unresolved' : 'fits'))
          expect([...window.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
          const fenced = fromMarkdown(await symbolMarkdownWithLayout({ model, symbol })).children.find((node) => node.type === 'code')
          expect(fenced?.type === 'code' && fenced.value).toBe(expected.join('\n\n'))
        } finally { await window.happyDOM.abort() }
      }
    })
