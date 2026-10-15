import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { API_MODEL_PORTS } from '../src/lib/ports'
import { apiSignatureLayouts } from '../src/lib/code-layout'

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
    '../../lib/code-layout': new URL('../src/lib/code-layout.ts', import.meta.url).href,
  })
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf("<span class:list={['api-native-signature',")
  const end = source.indexOf('\n          ))', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const fragment = source.slice(start, end)
  const wrapper = `---\nimport ApiType from './ApiType.astro'\nconst { symbol, sig, port, language, index, nameHref, nativeSignatureText, signatureLayouts = new Map() } = Astro.props\n---\n${fragment}`
  return (await import(/* @vite-ignore */ await compile('../src/components/api/ApiEntry.astro', { './ApiType.astro': type }, wrapper))).default
}

function displayedSignature(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[popover]').forEach((popover) => popover.remove())
  return copy.textContent ?? ''
}

const cases = [
  ['ts', 'server.Server.setHook'],
  ['ts', 'selection.Selection.filter'],
  ['ts', 'selection.Selection.[Symbol.iterator]'],
  ['ts', 'types.TmuxEventStream.[Symbol.asyncDispose]'],
  ['ts', 'types.ConnectedServer.[Symbol.asyncDispose]'],
  ['ts', 'server.Server.constructor'],
  ['cxx', 'libtmux::Server::sessions'],
  ['scala', 'io.github.libtmux.scaladsl.Server.sessions'],
  ['kotlin', 'io.github.libtmux.kotlin.Server.sessions'],
  ['fsharp', 'LibTmux.FSharp.Server.newSession'],
  ['julia', 'LibTmux.Server'],
  ['powershell', 'LibTmux\\Connect-TmuxControl'],
] as const
let componentPromise: ReturnType<typeof signatureComponent> | undefined

async function signatureProbe(models: Record<string, ApiModel>) {
  const ports = Object.keys(models).map((slug) => ({ slug }))
  const source = readFileSync(new URL('../scripts/check-dev.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("writeFileSync(join(root, 'src/pages/api-signature-probe.astro')")
  const end = source.indexOf('\nfor (const { slug: port } of PORTS)', start)
  let fixture = ''
  runInNewContext(source.slice(start, end), {
    root: '', join: (...parts: string[]) => parts.join('/'), signaturePorts: ports,
    writeFileSync: (_path: string, text: string) => { fixture = text },
  })
  const [, frontmatter, template] = fixture.split('---')
  const attributes = [...template.matchAll(/(data-signature-[\w-]+)=\{([^}]+)\}/g)]
    .map(([, name, expression]) => `${JSON.stringify(name)}: ${expression}`).join(', ')
  // Run the real probe's bindings without starting its Astro server.
  const entries = await runInNewContext(`(async () => {
    ${frontmatter.replace(/^import .*$/gm, '')}
    return entries.map(({ port, model, symbol }) => ({ port, symbol, attributes: { ${attributes} } }))
  })()`, { API_MODELS: models, API_MODEL_PORTS: ports, apiSignatureLayouts, nativeSignatureText, usesNativeSignatures }) as {
    port: string; symbol: ApiSymbol; attributes: Record<string, string>
  }[]
  return { source, entries }
}

async function checkHostedDeclarations(port: string) {
  const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
  const { source, entries } = await signatureProbe({ [port]: model })
  const entry = entries.find(({ symbol }) => symbol.signatures.length > 0)!
  expect(entry).toBeDefined()
  if (port === 'ts') expect(entry.symbol.signatures.every((signature) => signature.raw === undefined)).toBe(true)
  else expect(entry.symbol.signatures.every((signature) => signature.raw && signature.returns === undefined)).toBe(true)
  const component = await (componentPromise ??= signatureComponent())
  const container = await experimental_AstroContainer.create()
  const signatureLayouts = await apiSignatureLayouts(entry.symbol, port)
  const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.slug}/`, port)
  const win = new Window()
  try {
    win.document.body.innerHTML = (await Promise.all(entry.symbol.signatures.map((sig) =>
      container.renderToString(component, { props: {
        symbol: entry.symbol, sig, port, language: port, index, signatureLayouts,
        nativeSignatureText: () => signatureLayouts.get(sig)?.text ?? nativeSignatureText(entry.symbol, sig, port),
      } })))).join('\n')
    const assertionStart = source.indexOf('const visibleText = clean(await signature.innerText())')
    const assertionEnd = source.indexOf('\n        } else {', assertionStart)
    const assertion = source.slice(assertionStart, assertionEnd) + '\n}'
    const check = (text = displayedSignature(win.document.body), binding = entry.attributes) => runInNewContext(`(async () => { ${assertion} })()`, {
      assert, port, width: 390, model: entry.symbol,
      clean: (value: string) => value.replace(/\s+/g, ' ').trim(),
      entry: { getAttribute: (name: string) => binding[name] ?? null },
      signature: { innerText: () => text, locator: (selector: string) => ({ count: () => win.document.querySelectorAll(selector).length }) },
    })
    await check()
    const text = displayedSignature(win.document.body)
    await expect(check(text.replace(entry.symbol.name, 'missingCallable'))).rejects.toThrow('native declaration survives')
    await expect(check(text.replace(entry.symbol.signatures[0].params[0].name, 'missingParameter'))).rejects.toThrow('native declaration survives')
    await expect(check(text, { ...entry.attributes, 'data-signature-native': '[]' })).rejects.toThrow()
    for (const value of ['null', '[""]', '[null]']) {
      await expect(check(text, { ...entry.attributes, 'data-signature-native': value })).rejects.toThrow('prepared native declarations are bound')
    }
  } finally {
    await win.happyDOM.abort()
  }
}

describe('native signature emission', () => {
  it('checks the hosted signature fixture against rendered TypeScript declarations without raw text', () => checkHostedDeclarations('ts'))

  it('checks the hosted signature fixture against rendered Julia declarations without return annotations', () => checkHostedDeclarations('julia'))

  it('selects fixtures for every API port and retains existing typed-return choices', async () => {
    const models = Object.fromEntries(API_MODEL_PORTS.map(({ slug }) => [slug,
      JSON.parse(readFileSync(new URL(`../src/data/api/${slug}.json`, import.meta.url), 'utf8')) as ApiModel]))
    const before = JSON.stringify(models.julia)
    const { entries } = await signatureProbe(models)
    expect([...new Set(entries.map(({ port }) => port))]).toEqual(API_MODEL_PORTS.map(({ slug }) => slug))
    expect(new Set(entries.map(({ port }) => port)).size).toBe(15)
    for (const [port, model] of Object.entries(models)) {
      const callables = model.symbols.filter((symbol) => symbol.signatures.some((signature) => signature.params.length > 0 && signature.returns))
      const selected = callables.find((symbol) => /capture/i.test(symbol.name)) ?? callables[0]
      if (selected) expect(entries.find((entry) => entry.port === port)?.symbol).toBe(selected)
    }
    expect(JSON.stringify(models.julia)).toBe(before)
  })

  it.each(['empty', 'scalar-only', 'non-native', 'missing-raw', 'empty-raw'])('rejects a requested port with %s callable coverage', async (failure) => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/julia.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.capture_bytes')!
    const port = failure === 'non-native' ? 'py' : 'julia'
    const symbols: ApiSymbol[] = failure === 'empty' ? [] : failure === 'scalar-only'
      ? [{ ...symbol, signatures: [], type: 'Int', value: '1' }]
      : [{ ...symbol, signatures: symbol.signatures.map((signature) => ({ ...signature,
        raw: failure === 'missing-raw' ? undefined : failure === 'empty-raw' ? '  ' : signature.raw,
      })) }]
    await expect(signatureProbe({ [port]: { ...model, symbols } }).then(() => undefined))
      .rejects.toThrow(`API signature fixture is missing a parameterized callable for ${port}`)
  })

  it.each(cases)('preserves exact %s signature boundaries and native indentation', async (port, id) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    expect(symbol).toBeDefined()
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (entry) => `/en/${port}/latest/reference/${entry.slug}/`, port)
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const text = (entry: typeof symbol, signature: typeof symbol.signatures[number], language: string) => signatureLayouts.get(signature)?.text ?? nativeSignatureText(entry, signature, language)
    const win = new Window()
    try {
      for (const sig of symbol.signatures) {
        for (const member of [false, true]) {
          win.document.body.innerHTML = await container.renderToString(component, { props: {
            symbol, sig, port, language: port, index,
            nameHref: member ? `/en/${port}/latest/reference/${symbol.slug}/` : undefined, nativeSignatureText: text, signatureLayouts,
          } })
          const signature = win.document.querySelector('.api-native-signature')!
          const label = sig.label && sig.label !== '__AllParameterSets'
            ? `${sig.label}${sig.isDefault ? ' (default)' : ''}: ` : ''
          expect(displayedSignature(signature)).toBe(label + text(symbol, sig, port))
          if (['ts', 'scala', 'kotlin'].includes(port)) {
            expect(signature.querySelector('.api-declaration-name')?.textContent).toBe(symbol.name)
            expect(signature.getAttribute('data-code-columns')).toBe('60')
            expect(signature.getAttribute('data-code-width-status')).toBe('fits')
            expect(signature.querySelector('.api-signature-name-link')?.getAttribute('href'))
              .toBe(member ? `/en/${port}/latest/reference/${symbol.slug}/` : undefined)
            for (const param of sig.params) {
              const parameter = [...signature.querySelectorAll('a.api-parameter-name')].find((link) => link.textContent === param.name)
              expect(parameter?.getAttribute('href')).toBe(`#${encodeURIComponent(`${symbol.publicId ?? symbol.id}.parameter.${param.name}`)}`)
            }
            if (symbol.name === 'setHook') {
              const options = [...signature.querySelectorAll('a.api-type-link')].find((link) => link.textContent === 'SetHookOptions')
              expect(options?.getAttribute('href')).toBe('/en/ts/latest/reference/types-sethookoptions/')
            }
          }
        }
      }
      const sig = { ...symbol.signatures[0], label: 'ByServer', isDefault: true }
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port, language: port, index, nativeSignatureText: text, signatureLayouts,
      } })
      expect(displayedSignature(win.document.querySelector('.api-native-signature')!))
        .toBe(`ByServer (default): ${text(symbol, sig, port)}`)
    } finally {
      await win.happyDOM.abort()
    }
  })

  it.each([
    { label: 'template value', value: '`Target`', references: 0 },
    { label: 'regular expression', value: '/Target/u', references: 0 },
    { label: 'quoted value', value: '"Target"', references: 0 },
    { label: 'template type', value: '"Target"', type: '`Target-${keyof Target}`', references: 1 },
    { label: 'template interpolation', value: '`Target ${new Target()} ${/Target/u.test("Target")}`', references: 1 },
    { label: 'division next to a regex', value: 'Target / /Target/u.test("Target")', references: 1 },
    { label: 'comment', value: '(1 /* Target */ + 2)', references: 0 },
    { label: 'multiline template interpolation', value: '`first\n  Target\n${new Target()}\n  last`', references: 1 },
    { label: 'parameter named after its callable', value: '"Target"', parameter: 'method', references: 0 },
  ])('distinguishes $label syntax in linked native headers', async ({ value, type, references, parameter = 'value' }) => {
    const sig: Signature = { params: [{ name: parameter, ...(type ? { type } : {}), default: value }], returns: 'void' }
    const symbol: ApiSymbol = { id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures: [sig], source: { file: 'probe.ts' } }
    const target: ApiSymbol = { id: 'Probe.Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe.ts' } }
    const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, 'ts')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'ts')
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'ts', language: 'ts', index, signatureLayouts,
        nativeSignatureText: () => signatureLayouts.get(sig)!.text, nameHref: '/Probe.method/',
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
      expect([...signature.querySelectorAll('a[href="/Probe.Target/"]')].map((link) => link.textContent))
        .toEqual(Array.from({ length: references }, () => 'Target'))
      expect(signature.querySelector('a.api-parameter-name')?.getAttribute('href')).toBe(`#Probe.method.parameter.${parameter}`)
      expect(signature.querySelectorAll('a.api-signature-name-link')).toHaveLength(1)
    } finally {
      await win.happyDOM.abort()
    }
  })

  it.each([
    ['scala', '"Target"', 1],
    ['scala', '"🐱 Target"', 1],
    ['scala', 's"Target ${Target()}"', 2],
    ['scala', '"""first\n  Target\nlast"""', 1],
    ['kotlin', '"Target"', 1],
    ['kotlin', '"🐱 Target"', 1],
    ['kotlin', '"Target ${Target()}"', 2],
    ['kotlin', '"""first\n  Target\nlast"""', 1],
  ] as const)('retains %s parameter anchors and distinguishes literal references in %s', async (port, value, references) => {
    const sig: Signature = { raw: `${port === 'scala' ? 'def' : 'public fun'} method(value: String = ${value}): Target`, params: [{ name: 'value', type: 'String', default: value }], returns: 'Target' }
    const symbol: ApiSymbol = { id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures: [sig], source: { file: 'probe' } }
    const target: ApiSymbol = { id: 'Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe' } }
    const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, port)
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port, language: port, index, signatureLayouts,
        nativeSignatureText: () => signatureLayouts.get(sig)!.text, nameHref: '/Probe.method/',
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
      expect([...signature.querySelectorAll('a[href="/Target/"]')].map((link) => link.textContent))
        .toEqual(Array.from({ length: references }, () => 'Target'))
      expect(signature.querySelector('a.api-parameter-name')?.getAttribute('href')).toBe('#Probe.method.parameter.value')
      expect(signature.querySelector('a.api-signature-name-link')?.getAttribute('href')).toBe('/Probe.method/')
    } finally {
      await win.happyDOM.abort()
    }
  })

  it.each(['ts', 'scala', 'kotlin'] as const)('keeps a selected %s overload binding separate from a global type with the same name', async (port) => {
    const signatures: Signature[] = [
      { typeParams: ['Target'], params: [{ name: 'value', type: 'Target' }], returns: 'Target',
        ...(port === 'scala' ? { raw: 'def method[Target](value: Target): Target' } : port === 'kotlin' ? { raw: 'public fun <Target> method(value: Target): Target' } : {}) },
      { params: [{ name: 'value', type: 'Target' }], returns: 'Target',
        ...(port === 'scala' ? { raw: 'def method(value: Target): Target' } : port === 'kotlin' ? { raw: 'public fun method(value: Target): Target' } : {}) },
    ]
    const symbol: ApiSymbol = { id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures, imports: { Target: 'Probe.Target' }, source: { file: 'probe.ts' } }
    const target: ApiSymbol = { id: 'Probe.Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe.ts' } }
    const index = new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, port)
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      for (const [i, sig] of signatures.entries()) {
        win.document.body.innerHTML = await container.renderToString(component, { props: {
          symbol, sig, port, language: port, index, signatureLayouts,
          nativeSignatureText: () => signatureLayouts.get(sig)!.text,
        } })
        const signature = win.document.querySelector('.api-native-signature')!
        expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
        expect(signature.querySelectorAll('a[href="/Probe.Target/"]')).toHaveLength(i ? 2 : 0)
        expect(signature.querySelector('a.api-parameter-name')?.getAttribute('href')).toBe('#Probe.method.parameter.value')
      }
    } finally {
      await win.happyDOM.abort()
    }
  })

  it('marks an indivisible over-width header unresolved without changing its copied text', async () => {
    const sig: Signature = { params: [{ name: 'value', type: `"${'x'.repeat(90)}"` }], returns: 'A'.repeat(75) }
    const symbol: ApiSymbol = { id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures: [sig], source: { file: 'probe.ts' } }
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'ts')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'ts')
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'ts', language: 'ts', index, signatureLayouts,
        nativeSignatureText: () => signatureLayouts.get(sig)!.text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('unresolved')
      expect(JSON.parse(signature.getAttribute('data-code-width-failures')!)).toEqual([
        { line: 2, columns: 102, limit: 60 }, { line: 3, columns: 78, limit: 60 },
      ])
    } finally {
      await win.happyDOM.abort()
    }
  })

  it.each(['scala', 'kotlin'] as const)('marks unresolved %s widths on the actual native signature fragment', async (port) => {
    const value = `"${'x'.repeat(90)}"`
    const sig: Signature = { raw: `${port === 'scala' ? 'def' : 'public fun'} method(value: String = ${value}): Target`, params: [{ name: 'value', type: 'String', default: value }] }
    const symbol: ApiSymbol = { id: 'Probe.method', name: 'method', kind: 'method', modifiers: [], signatures: [sig], source: { file: 'probe' } }
    const index = new SymbolIndex([symbol], (entry) => `/${entry.id}/`, port)
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const layout = signatureLayouts.get(sig)!
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port, language: port, index, signatureLayouts,
        nativeSignatureText: () => layout.text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(layout.text)
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('unresolved')
      expect(layout.failures.length).toBeGreaterThan(0)
      expect(JSON.parse(signature.getAttribute('data-code-width-failures')!)).toEqual(layout.failures)
    } finally { await win.happyDOM.abort() }
  })
})
