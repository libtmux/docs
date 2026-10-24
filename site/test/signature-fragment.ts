import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { expect } from 'vitest'
import type { ApiSymbol, Signature, SymbolIndex } from '@libtmux/api-model'
import { nativeSignatureText } from '../src/lib/api-sections'
import { apiSignatureLayouts, type CodeLayout } from '../src/lib/code-layout'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
let component: Promise<Awaited<ReturnType<typeof compileFragment>>> | undefined

/** Compile the production native-signature markup of `ApiEntry` with its inline components. */
async function compileFragment() {
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
  const preview = await compile('../src/components/LinkPreview.astro', { '../lib/link-preview-card': new URL('../src/lib/link-preview-card.ts', import.meta.url).href })
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
  const wrapper = `---\nimport ApiType from './ApiType.astro'\nconst { symbol, sig, port, language, index, nameHref, nativeSignatureText, signatureLayouts = new Map() } = Astro.props\n---\n${source.slice(start, end)}`
  return (await import(/* @vite-ignore */ await compile('../src/components/api/ApiEntry.astro', { './ApiType.astro': type }, wrapper))).default
}

/** The rendered text of a declaration, without the popovers that explain a keyword. */
export function displayedSignature(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[popover]').forEach((popover) => popover.remove())
  return copy.textContent ?? ''
}

/** Render each overload of `symbol` as `ApiEntry` does and return the declaration elements. */
export async function renderSignatures(symbol: ApiSymbol, language: string, index: SymbolIndex, nameHref?: string): Promise<{ window: Window; signatures: Element[]; layouts: Map<Signature, CodeLayout> }> {
  const layouts = await apiSignatureLayouts(symbol, language)
  const container = await experimental_AstroContainer.create()
  const window = new Window()
  const fragments = await Promise.all(symbol.signatures.map(async (sig) => container.renderToString(await (component ??= compileFragment()), {
    props: { symbol, sig, port: language, language, index, nameHref, nativeSignatureText, signatureLayouts: layouts },
  })))
  window.document.body.innerHTML = fragments.join('')
  return { window, signatures: [...window.document.querySelectorAll('.api-native-signature')], layouts }
}
