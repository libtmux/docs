import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { SymbolIndex, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { nativeSignatureText } from '../src/lib/api-sections'
import { apiSignatureLayouts } from '../src/lib/code-layout'

const model = JSON.parse(readFileSync(new URL('../src/data/api/cxx.json', import.meta.url), 'utf8')) as ApiModel
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))

afterEach(() => vi.unstubAllGlobals())

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
  // The compiled data module uses the same helpers transformed by Vitest.
  vi.stubGlobal('__cxxSignatureHelpers', { nativeSignatureText, apiSignatureLayouts })
  const helpers = 'data:text/javascript,export const { nativeSignatureText, apiSignatureLayouts } = globalThis.__cxxSignatureHelpers'
  expect((await import(/* @vite-ignore */ helpers)).nativeSignatureText).toBe(nativeSignatureText)
  const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const type = await compile('../src/components/api/ApiType.astro', {
    './SymbolName.astro': name, './ApiKeyword.astro': keyword,
    '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
    '../../lib/code-layout': new URL('../src/lib/code-layout.ts', import.meta.url).href,
  })
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf("<span class:list={['api-native-signature',")
  const end = source.indexOf('\n          ))', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const fragment = source.slice(start, end)
  const setupStart = source.indexOf('const signatureLayouts = await apiSignatureLayouts(symbol, language)')
  const setupEnd = source.indexOf('\n\n', setupStart)
  expect(setupStart).toBeGreaterThan(0)
  expect(setupEnd).toBeGreaterThan(setupStart)
  const wrapper = `---\nimport ApiType from './ApiType.astro'\nimport { apiSignatureLayouts } from '../../lib/code-layout'\nimport { nativeSignatureText as unformattedNativeSignatureText } from '../../lib/api-sections'\nconst { symbol, sig, port, language, index, nameHref } = Astro.props\n${source.slice(setupStart, setupEnd)}\n---\n${fragment}`
  return (await import(/* @vite-ignore */ await compile('../src/components/api/ApiEntry.astro', {
    './ApiType.astro': type,
    '../../lib/code-layout': helpers,
    '../../lib/api-sections': helpers,
  }, wrapper))).default
}

function displayedSignature(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[popover]').forEach((popover) => popover.remove())
  return copy.textContent ?? ''
}

describe('C++ native signature emission', () => {
  it('lays out clang-format boundaries and native indentation with ordinary language links', async () => {
    const component = await signatureComponent()
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (symbol) => `/en/cxx/latest/reference/${symbol.slug}/`, 'cxx')
    const win = new Window()
    try {
      const formatted = {
        sessions: '[[nodiscard]] expected<std::vector<Session>, CommandFailure>\nsessions() const;',
        buffers: '[[nodiscard]] expected<std::vector<Buffer>, CommandFailure>\nbuffers() const;',
      }
      for (const name of ['sessions', 'buffers'] as const) {
        const symbol = model.symbols.find((symbol) => symbol.id === `libtmux::Server::${name}`)!
        for (const member of [false, true]) {
          win.document.body.innerHTML = await container.renderToString(component, { props: {
            symbol, sig: symbol.signatures[0], port: 'cxx', language: 'cxx', index,
            nameHref: member ? `/en/cxx/latest/reference/${symbol.slug}/` : undefined,
          } })
          const signature = win.document.querySelector('.api-native-signature')!
          expect(displayedSignature(signature)).toBe(formatted[name])
          expect(signature.classList.contains('api-native-signature--formatted')).toBe(true)
          expect(signature.getAttribute('data-code-columns')).toBe('60')
          expect(signature.getAttribute('data-code-width-status')).toBe('fits')
          expect(signature.querySelector('button.api-keyword-trigger')?.textContent).toBe('nodiscard')
          expect(signature.querySelector('[popover] a[href="https://eel.is/c++draft/dcl.attr.nodiscard"]')).not.toBeNull()
          expect(signature.querySelector('a[href="https://en.cppreference.com/cpp/container/vector"]')?.textContent).toBe('std::vector')
          expect(signature.querySelector('.api-signature-name-link')?.textContent).toBe(member ? name : undefined)
        }
      }
      const symbol = model.symbols.find((symbol) => symbol.id === 'libtmux::Server::sessions')!
      const raw = '[[nodiscard]] expected<std::vector<Session>, CommandFailure>\nsessions(\n    std::size_t limit\n) const;'
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig: { params: [{ name: 'limit', type: 'std::size_t' }], raw }, port: 'cxx', language: 'cxx', index,
      } })
      // A declaration the model does not list keeps its source bytes.
      expect(displayedSignature(win.document.querySelector('.api-native-signature')!)).toBe(raw)
    } finally {
      await win.happyDOM.abort()
    }
  })

  it('retains the shared formatted signature region and its width contract', async () => {
    const symbol: ApiSymbol = { id: 'example.pick', name: 'pick', kind: 'method', modifiers: [],
      signatures: [{ params: [
        { name: 'firstSelection', type: 'string' }, { name: 'secondSelection', type: 'string' },
      ], returns: 'Promise<string>' }], source: { file: 'example.ts' } }
    const component = await signatureComponent()
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig: symbol.signatures[0], port: 'ts', language: 'ts',
        index: new SymbolIndex([symbol], () => '/reference/pick/', 'ts'),
      } })
      const signature = win.document.querySelector('.api-native-signature--formatted')!
      expect(signature).not.toBeNull()
      expect(signature.getAttribute('tabindex')).toBe('0')
      expect(signature.getAttribute('role')).toBe('region')
      expect(signature.getAttribute('aria-label')).toBe('Signature for pick')
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
      expect(signature.hasAttribute('data-code-width-failures')).toBe(false)
      const text = displayedSignature(signature)
      expect(text).toContain('\n')
      expect(text.split('\n').every((line) => line.length <= 60)).toBe(true)
      expect([...signature.querySelectorAll('.api-parameter-name')].map((link) => link.textContent))
        .toEqual(['firstSelection', 'secondSelection'])
    } finally {
      await win.happyDOM.abort()
    }
  })
})
