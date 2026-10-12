import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { SymbolIndex, type ApiModel } from '@libtmux/api-model'
import { nativeSignatureText } from '../src/lib/api-sections'

const model = JSON.parse(readFileSync(new URL('../src/data/api/cxx.json', import.meta.url), 'utf8')) as ApiModel
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))

/** Compile the actual signature fragment and its inline components in isolation. */
async function signatureComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(relative: string, imports: Record<string, string> = {}, replacement?: string) {
    const file = new URL(relative, import.meta.url)
    const source = (replacement ?? readFileSync(file, 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const type = await compile('../src/components/api/ApiType.astro', {
    './SymbolName.astro': name, './ApiKeyword.astro': keyword,
    '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
  })
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf("<span class:list={['api-native-signature',")
  const end = source.indexOf('\n          ))', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const fragment = source.slice(start, end)
  const wrapper = `---\nimport ApiType from './ApiType.astro'\nconst { symbol, sig, port, language, index, nameHref, nativeSignatureText } = Astro.props\n---\n${fragment}`
  return (await import(/* @vite-ignore */ await compile('../src/components/api/ApiEntry.astro', { './ApiType.astro': type }, wrapper))).default
}

function displayedSignature(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[popover]').forEach((popover) => popover.remove())
  return copy.textContent ?? ''
}

describe('C++ native signature emission', () => {
  it('keeps exact boundaries, native indentation and ordinary language links', async () => {
    const component = await signatureComponent()
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (symbol) => `/en/cxx/latest/reference/${symbol.slug}/`, 'cxx')
    const win = new Window()
    try {
      for (const name of ['sessions', 'buffers']) {
        const symbol = model.symbols.find((symbol) => symbol.id === `libtmux::Server::${name}`)!
        for (const member of [false, true]) {
          win.document.body.innerHTML = await container.renderToString(component, { props: {
            symbol, sig: symbol.signatures[0], port: 'cxx', language: 'cxx', index,
            nameHref: member ? `/en/cxx/latest/reference/${symbol.slug}/` : undefined, nativeSignatureText,
          } })
          const signature = win.document.querySelector('.api-native-signature')!
          expect(displayedSignature(signature)).toBe(symbol.signatures[0].raw)
          expect(signature.querySelector('button.api-keyword-trigger')?.textContent).toBe('nodiscard')
          expect(signature.querySelector('[popover] a[href="https://eel.is/c++draft/dcl.attr.nodiscard"]')).not.toBeNull()
          expect(signature.querySelector('a[href="https://en.cppreference.com/w/cpp/container/vector"]')?.textContent).toBe('std::vector')
          expect(signature.querySelector('.api-signature-name-link')?.textContent).toBe(member ? name : undefined)
        }
      }
      const symbol = model.symbols.find((symbol) => symbol.id === 'libtmux::Server::sessions')!
      const raw = '[[nodiscard]] expected<std::vector<Session>, CommandFailure>\nsessions(\n    std::size_t limit\n) const;'
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig: { params: [{ name: 'limit', type: 'std::size_t' }], raw }, port: 'cxx', language: 'cxx', index, nativeSignatureText,
      } })
      expect(displayedSignature(win.document.querySelector('.api-native-signature')!)).toBe(raw)
    } finally {
      await win.happyDOM.abort()
    }
  })
})
