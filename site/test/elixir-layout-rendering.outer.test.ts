// Compiles and renders real Astro declarations; pure layout fixtures remain in medium.
import { expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { displayedSignature, renderSignatures } from './signature-fragment'
import { CODE_COLUMNS } from '../src/lib/code-layout'
import { productApiIndex } from '../src/lib/product-api'

const model = API_MODELS.elixir
const index = productApiIndex(model, 'latest')
const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!

it('render as one preformatted declaration with working links and no nested anchors', async () => {
    const entry = symbol('LibTmux.Control.submit/3')
    const nameHref = `/en/elixir/latest/reference/${entry.slug}/`
    const { window, signatures, layouts } = await renderSignatures(entry, 'elixir', index, nameHref)
    try {
      expect(signatures).toHaveLength(entry.signatures.length)
      const [rendered] = signatures
      expect(rendered!.classList.contains('api-native-signature--formatted')).toBe(true)
      expect(rendered!.getAttribute('data-code-columns')).toBe(String(CODE_COLUMNS.api))
      expect(rendered!.getAttribute('data-code-width-status')).toBe('fits')
      expect(displayedSignature(rendered!)).toBe(layouts.get(entry.signatures[0]!)!.text)
      expect(rendered!.querySelector('.api-signature-name-link')?.getAttribute('href')).toBe(nameHref)
      expect([...rendered!.querySelectorAll('a.api-parameter-name')].map((link) => link.textContent)).toEqual(['control', 'request', 'options'])
      expect(rendered!.querySelector('a a')).toBeNull()
    } finally { await window.happyDOM.abort() }
  })

it('give each spec clause of an overloaded function its own declaration', async () => {
    const entry = symbol('LibTmux.Selection.new/2')
    expect(entry.signatures.length).toBeGreaterThan(1)
    const { window, signatures } = await renderSignatures(entry, 'elixir', index)
    try {
      expect(signatures).toHaveLength(entry.signatures.length)
      expect(new Set(signatures.map((element) => displayedSignature(element))).size).toBe(entry.signatures.length)
    } finally { await window.happyDOM.abort() }
  })
