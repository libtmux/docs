import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { parameterId, qualifiedNameOf, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { Window } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { signatureMultiline } from '../src/lib/api-sections'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllGlobals()
})

async function parameterComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(relative: string, imports: Record<string, string> = {}) {
    const url = new URL(relative, import.meta.url)
    const source = readFileSync(url, 'utf8').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    const result = await transform(source, { filename: url.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, href] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  vi.stubGlobal('__apiSignatureScope', { parameterId, qualifiedNameOf, signatureMultiline })
  const helpers = 'data:text/javascript,export const { parameterId, qualifiedNameOf, signatureMultiline } = globalThis.__apiSignatureScope'
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const name = await compile('../src/components/api/SymbolName.astro', {
    '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href,
  })
  const type = await compile('../src/components/api/ApiType.astro', {
    '@libtmux/api-model': helpers, './SymbolName.astro': name, './ApiKeyword.astro': keyword,
  })
  const url = await compile('../src/components/api/ApiSignatureParameters.astro', {
    '@libtmux/api-model': helpers, '../../lib/api-sections': helpers, './ApiType.astro': type,
  })
  return (await import(/* @vite-ignore */ url)).default
}

it('renders each overload parameter in its own TypeScript type scope', async () => {
  const generic: Signature = { typeParams: ['Pane extends Model'], params: [{ name: 'value', type: 'Pane' }] }
  const concrete: Signature = { params: [{ name: 'value', type: 'Pane' }] }
  const context: ApiSymbol = { id: 'selection.pick', name: 'pick', kind: 'function', modifiers: [],
    signatures: [generic, concrete], source: { file: 'selection.ts' } }
  const pane: ApiSymbol = { id: 'pane.Pane', name: 'Pane', kind: 'class', modifiers: [], signatures: [], source: { file: 'pane.ts' } }
  const index = new SymbolIndex([context, pane], (symbol) => `/${symbol.id}/`, 'ts')
  const win = new Window()
  windows.push(win)
  const container = await experimental_AstroContainer.create()
  const component = await parameterComponent()
  for (const signature of [generic, concrete]) {
    win.document.body.innerHTML = await container.renderToString(component, { props: { signature, symbol: context, index, language: 'ts' } })
    expect(win.document.body.textContent).toBe('(value: Pane)')
    const links = [...win.document.querySelectorAll('a.api-type-link')].map((link) => link.getAttribute('href'))
    expect(links).toEqual(signature === generic ? [] : ['/pane.Pane/'])
  }
})

it('keeps C# record property types and parameter links distinct', async () => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/csharp.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.ClientAttachment')!
  expect(symbol.kind).toBe('class')
  expect(symbol.signatures[0].raw).toBe('public sealed record ClientAttachment(Session? Session, Window? Window, Pane? Pane);')
  const path = (entry: ApiSymbol) => `/en/csharp/latest/reference/${entry.slug}/`
  const index = new SymbolIndex(model.symbols, path, 'csharp')
  const win = new Window()
  windows.push(win)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await parameterComponent(), {
    props: { signature: symbol.signatures[0], symbol, index, language: 'csharp' },
  })
  expect(win.document.body.textContent).toBe('(Session: Session?, Window: Window?, Pane: Pane?)')
  expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')]))
    .toEqual(['Session', 'Window', 'Pane'].map((name) => [name, `#${parameterId(symbol, name)}`]))
  expect([...win.document.querySelectorAll('a.api-type-link')].map((link) => [link.textContent, link.getAttribute('href')]))
    .toEqual(['Session', 'Window', 'Pane'].map((name) => [name, path(model.symbols.find((entry) => entry.id === `LibTmux.${name}`)!)]))
})
