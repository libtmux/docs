import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { SymbolIndex, type ApiModel } from '@libtmux/api-model'
import { nativeSignatureText } from '../src/lib/api-sections'

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

const cases = [
  ['cxx', 'libtmux::Server::sessions'],
  ['scala', 'io.github.libtmux.scaladsl.Server.sessions'],
  ['kotlin', 'io.github.libtmux.kotlin.Server.sessions'],
  ['fsharp', 'LibTmux.FSharp.Server.newSession'],
  ['julia', 'LibTmux.Server'],
  ['powershell', 'LibTmux\\Connect-TmuxControl'],
] as const
let componentPromise: ReturnType<typeof signatureComponent> | undefined

describe('native signature emission', () => {
  it.each(cases)('preserves exact %s signature boundaries and native indentation', async (port, id) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    expect(symbol).toBeDefined()
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (entry) => `/en/${port}/latest/reference/${entry.slug}/`, port)
    const win = new Window()
    try {
      for (const sig of symbol.signatures) {
        for (const member of [false, true]) {
          win.document.body.innerHTML = await container.renderToString(component, { props: {
            symbol, sig, port, language: port, index,
            nameHref: member ? `/en/${port}/latest/reference/${symbol.slug}/` : undefined, nativeSignatureText,
          } })
          const signature = win.document.querySelector('.api-native-signature')!
          const label = sig.label && sig.label !== '__AllParameterSets'
            ? `${sig.label}${sig.isDefault ? ' (default)' : ''}: ` : ''
          expect(displayedSignature(signature)).toBe(label + nativeSignatureText(symbol, sig, port))
        }
      }
      const sig = { ...symbol.signatures[0], label: 'ByServer', isDefault: true }
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port, language: port, index, nativeSignatureText,
      } })
      expect(displayedSignature(win.document.querySelector('.api-native-signature')!))
        .toBe(`ByServer (default): ${nativeSignatureText(symbol, sig, port)}`)
    } finally {
      await win.happyDOM.abort()
    }
  })
})
