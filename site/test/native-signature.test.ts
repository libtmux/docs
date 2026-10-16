import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element, type HTMLElement } from 'happy-dom'
import { parameterId, parentInventory, SymbolIndex, type ApiModel, type ApiSymbol, type Signature } from '@libtmux/api-model'
import { apiEntryFields, nativeSignatureText, usesNativeSignatures } from '../src/lib/api-sections'
import { API_MODEL_PORTS } from '../src/lib/ports'
import { apiSignatureLayouts } from '../src/lib/code-layout'
import * as nativeLayoutChecks from '../scripts/check-native-layout.mjs'

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

async function scalaObserverFixture() {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === 'io.github.libtmux.scaladsl.Server.windows')!
  const component = await (componentPromise ??= signatureComponent())
  const container = await experimental_AstroContainer.create()
  const signatureLayouts = await apiSignatureLayouts(symbol, 'scala')
  const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, 'scala')
  const java = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  index.addInventory('', parentInventory(java, (entry) => `/en/java/latest/reference/${entry.slug}/`), ['scala'], 'libtmux Java')
  const win = new Window()
  const signatures = await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, { props: {
    symbol, sig, port: 'scala', language: 'scala', index, signatureLayouts,
    nativeSignatureText: () => signatureLayouts.get(sig)!.text,
  } })))
  win.document.body.innerHTML = `<dl><dt class="api-native-header" data-symbol-id="${symbol.id}">${signatures.join('')}</dt></dl>`
  for (const parameter of apiEntryFields(symbol, 'scala').params) {
    if (win.document.getElementById(parameterId(symbol, parameter.name))) continue
    const field = win.document.createElement('div')
    field.id = parameterId(symbol, parameter.name)
    win.document.body.append(field)
  }
  return { win, symbol }
}

async function runHostedScalaLinks(win: Window) {
  const source = readFileSync(new URL('../scripts/check-dev.mjs', import.meta.url), 'utf8')
  const route = source.indexOf("await page.goto(`${base}/scala/latest/reference/io-github-libtmux-scaladsl-server-windows/`)")
  const start = source.indexOf('    const links =', route)
  const end = source.indexOf('    for (const width of [1440, 768, 390])', start)
  expect(start).toBeGreaterThan(route)
  expect(end).toBeGreaterThan(start)
  const header = win.document.querySelector('dt.api-native-header')!
  const signature = {
    locator: (selector: string) => ({ evaluateAll: (read: (elements: Element[]) => unknown) => read([...header.querySelectorAll(selector)]) }),
    evaluate: (read: (element: Element) => unknown) => read(header),
  }
  return runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
    assert, signature, readFileSync, join, JSON, source: fileURLToPath(new URL('../', import.meta.url)), ...nativeLayoutChecks,
  })
}

it('renders Rust structural payload names and field links without callable parameters', async () => {
  const symbol: ApiSymbol = {
    id: 'control.Event.Output', name: 'Output', kind: 'constant', parent: 'control.Event', variant: 'struct',
    modifiers: [], source: { file: 'control.rs' },
    signatures: [{ raw: 'Output {\n    pane: PaneId,\n    bytes: Vec<u8>,\n}', params: [] }],
  }
  const field = (name: string, type: string): ApiSymbol => ({
    id: `${symbol.id}.${name}`, name, type, kind: 'attribute', parent: symbol.id,
    modifiers: [], signatures: [], source: { file: 'control.rs' },
  })
  const pane: ApiSymbol = { id: 'id.PaneId', name: 'PaneId', kind: 'struct', modifiers: [], signatures: [], source: { file: 'id.rs' } }
  const index = new SymbolIndex([symbol, field('pane', 'PaneId'), field('bytes', 'Vec<u8>'), pane], (entry) => `/${entry.id}/`, 'rs')
  expect(usesNativeSignatures(symbol, 'rs')).toBe(true)
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    win.document.body.innerHTML = await container.renderToString(await (componentPromise ??= signatureComponent()), {
      props: { symbol, sig: symbol.signatures[0], port: 'rs', language: 'rs', index,
        nameHref: '/control.Event.Output/', nativeSignatureText },
    })
    expect(displayedSignature(win.document.body)).toBe(symbol.signatures[0].raw)
    expect(win.document.querySelector('.api-signature-name-link')?.getAttribute('href')).toBe('/control.Event.Output/')
    expect(win.document.querySelector('a[href="/control.Event.Output.pane/"]')?.textContent).toBe('pane')
    expect(win.document.querySelector('a[href="/id.PaneId/"]')?.textContent).toBe('PaneId')
    expect(win.document.querySelector('a[href*="parameter-"]')).toBeNull()
    expect(win.document.querySelector('a a')).toBeNull()
  } finally { await win.happyDOM.abort() }
})

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
  it('accepts actual Scala parameter anchors in the hosted reference observer', async () => {
    const { win } = await scalaObserverFixture()
    try { await runHostedScalaLinks(win) }
    finally { await win.happyDOM.abort() }
  })

  it.each([
    'missing link', 'type-link classification', 'duplicate link', 'foreign name',
    'wrong fragment', 'external destination', 'wrong owner destination',
    'missing target', 'duplicate target', 'wrong overload', 'missing overload', 'wrong owner',
    'declaration self-link', 'keyword link', 'extra unclassified parameter link', 'wrong Vector destination',
  ])('rejects %s in the hosted Scala reference observer', async (failure) => {
    const { win, symbol } = await scalaObserverFixture()
    try {
      const header = win.document.querySelector('dt.api-native-header')!
      const signatures = [...header.querySelectorAll('.api-native-signature')]
      const parameter = [...header.querySelectorAll('a.api-parameter-name')].find((link) => link.textContent === 'id')!
      const target = win.document.getElementById(parameterId(symbol, 'id'))!
      if (failure === 'missing link') parameter.remove()
      else if (failure === 'type-link classification') parameter.classList.remove('api-parameter-name')
      else if (failure === 'duplicate link') parameter.after(parameter.cloneNode(true))
      else if (failure === 'foreign name') parameter.textContent = 'foreign'
      else if (failure === 'wrong fragment') parameter.setAttribute('href', '#missing')
      else if (failure === 'external destination') parameter.setAttribute('href', `https://example.com/${parameter.getAttribute('href')}`)
      else if (failure === 'wrong owner destination') parameter.setAttribute('href', '#Other.parameter.id')
      else if (failure === 'missing target') target.remove()
      else if (failure === 'duplicate target') target.after(target.cloneNode(true))
      else if (failure === 'wrong overload') signatures[0]!.append(parameter)
      else if (failure === 'missing overload') signatures[0]!.remove()
      else if (failure === 'wrong owner') header.setAttribute('data-symbol-id', 'Other')
      else if (failure === 'wrong Vector destination') {
        for (const link of header.querySelectorAll('a')) if (link.textContent === 'Vector') link.setAttribute('href', 'https://example.com/Vector')
      } else {
        const link = win.document.createElement('a')
        link.href = '/wrong/'
        link.textContent = failure === 'declaration self-link' ? 'windows' : failure === 'keyword link' ? 'def' : 'id'
        signatures[0]!.append(link)
      }
      await expect(runHostedScalaLinks(win)).rejects.toThrow(/native |declaration token|Vector links/i)
    } finally { await win.happyDOM.abort() }
  })

  it('renders Go source headers with parameter targets and linked types', async () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'tmux.Server.ListBuffers')!
    const sig = symbol.signatures[0]!
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (entry) => `/en/go/latest/reference/${entry.slug}/`, 'go')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'go')
    const text = () => signatureLayouts.get(sig)?.text ?? nativeSignatureText(symbol, sig, 'go')
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'go', language: 'go', index, signatureLayouts,
        nameHref: `/en/go/latest/reference/${symbol.slug}/`, nativeSignatureText: text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
      expect(displayedSignature(signature)).toBe('func (s Server) ListBuffers(\n\tctx context.Context,\n\trequest ListBuffersRequest,\n) ([]string, error)')
      expect(signature.querySelector('.api-signature-name-link')?.getAttribute('href')).toBe(`/en/go/latest/reference/${symbol.slug}/`)
      expect([...signature.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['ctx', '#tmux.Server.ListBuffers.parameter.ctx'], ['request', '#tmux.Server.ListBuffers.parameter.request'],
      ])
      expect([...signature.querySelectorAll('a.api-type-link')].map((link) => [link.textContent, link.getAttribute('href')])).toContainEqual(['Server', '/en/go/latest/reference/tmux-server/'])
      expect([...signature.querySelectorAll('a.api-type-link')].map((link) => [link.textContent, link.getAttribute('href')])).toContainEqual(['ListBuffersRequest', '/en/go/latest/reference/tmux-listbuffersrequest/'])
      expect(signature.querySelector('.api-keyword')?.textContent).toBe('func')
    } finally { await win.happyDOM.abort() }
  })

  it.fails.each([
    ['tmux.SessionOptionValues.PromptCommandCursorStyle', 'func (\n\tv SessionOptionValues,\n) PromptCommandCursorStyle() OptionValue[\n\tPromptCommandCursorStyle,\n]'],
    ['tmux.WindowOptionValues.PaneScrollbarsPosition', 'func (\n\tv WindowOptionValues,\n) PaneScrollbarsPosition() OptionValue[\n\tPaneScrollbarsPosition,\n]'],
  ])('renders a width-compliant generic result for %s', async (id, expected) => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const sig = symbol.signatures[0]!
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'go')
    const signatureLayouts = await apiSignatureLayouts(symbol, 'go')
    const text = () => signatureLayouts.get(sig)?.text ?? nativeSignatureText(symbol, sig, 'go')
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'go', language: 'go', signatureLayouts,
        index, nativeSignatureText: text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
      expect(signature.getAttribute('data-code-width-failures')).toBeNull()
      expect(displayedSignature(signature)).toBe(expected)
      expect([...signature.querySelectorAll('a.api-type-link')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        [symbol.parent!.slice('tmux.'.length), `/${symbol.parent}/`],
        ...index.linkType(sig.returns!, symbol, sig).flatMap((span) => span.link ? [[span.text, span.link.href]] : []),
      ])
    } finally { await win.happyDOM.abort() }
  })

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

  it.each([
    ['ts', 'server.Server.setHook', 'containment'],
    ['scala', 'io.github.libtmux.scaladsl.Server.sessions', 'containment'],
    ['kotlin', 'io.github.libtmux.kotlin.Server.sessions', 'containment'],
    ['ts', 'server.Server.setHook', 'keyboard'],
    ['scala', 'io.github.libtmux.scaladsl.Server.sessions', 'keyboard'],
    ['kotlin', 'io.github.libtmux.kotlin.Server.sessions', 'keyboard'],
  ] as const)('gives formatted %s declaration %s local %s access', async (port, id, check) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const index = new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, port)
    const win = new Window()
    try {
      const css = ['vendor/gp-sphinx-api.css', 'api.css'].map((name) =>
        readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')).join('\n')
      win.document.head.innerHTML = `<style>:root { --focus-ring-color: #247; }${css}</style>`
      for (const [i, sig] of symbol.signatures.entries()) {
        const layout = signatureLayouts.get(sig)!
        const html = await container.renderToString(component, { props: {
          symbol, sig, port, language: port, index, signatureLayouts,
          nativeSignatureText: () => layout.text,
        } })
        win.document.body.innerHTML = `<dl class="py gp-sphinx-api-container"><dt class="gp-sphinx-api-header">${html}</dt><dd>Body</dd></dl>`
        const signature = win.document.querySelector<HTMLElement>('.api-native-signature')!
        const style = win.getComputedStyle(signature)
        expect(displayedSignature(signature)).toBe(layout.text)
        expect(win.getComputedStyle(win.document.querySelector('dl')!).overflow).toBe('visible')
        if (check === 'containment') {
          expect(style.overflowX).toBe('auto')
          expect(style.maxInlineSize).toBe('100%')
          expect(style.whiteSpace).toBe('pre-wrap')
          expect(style.overflowWrap).toBe('normal')
          for (const link of signature.querySelectorAll('.api-type-link')) {
            expect(win.getComputedStyle(link).overflowWrap).toBe('normal')
          }
          for (const breakPoint of signature.querySelectorAll('wbr')) {
            expect(win.getComputedStyle(breakPoint).display).toBe('none')
          }
        } else {
          expect(signature.getAttribute('role')).toBe('region')
          expect(signature.getAttribute('aria-label')).toBe(`Signature for ${symbol.name}${symbol.signatures.length > 1 ? `, overload ${i + 1} of ${symbol.signatures.length}` : ''}`)
          expect(signature.tabIndex).toBe(0)
          signature.focus()
          expect(win.document.activeElement).toBe(signature)
          expect(win.getComputedStyle(signature).outlineStyle).toBe('solid')
          for (const trigger of signature.querySelectorAll('[popovertarget]')) {
            expect(win.document.getElementById(trigger.getAttribute('popovertarget')!)?.getAttribute('popover')).toBe('auto')
          }
        }
      }
    } finally { await win.happyDOM.abort() }
  })

  it('keeps an unformatted native declaration outside the scroll-region contract', async () => {
    const port = 'cxx'
    const model = JSON.parse(readFileSync(new URL('../src/data/api/cxx.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === 'libtmux::Server::sessions')!
    const sig = symbol.signatures[0]
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.head.innerHTML = `<style>${readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')}</style>`
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port, language: port, index: new SymbolIndex(model.symbols, (entry) => `/${entry.slug}/`, port), nativeSignatureText,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(signature.hasAttribute('tabindex')).toBe(false)
      expect(signature.hasAttribute('role')).toBe(false)
      expect(win.getComputedStyle(signature).overflowX).not.toBe('auto')
      expect(win.getComputedStyle(signature).overflowWrap).toBe('anywhere')
    } finally { await win.happyDOM.abort() }
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
