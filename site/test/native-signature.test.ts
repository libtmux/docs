import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
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
import { extractSourceWithSpec } from '../../packages/api-model/src/languages/spec'
import { JAVA } from '../../packages/api-model/src/languages/specs'
import { createApiIndex } from '../src/lib/api-models'
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

function auditSignature(html: string) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-signature-audit-'))
  try {
    for (const { slug } of API_MODEL_PORTS) {
      const destination = join(directory, slug, 'latest', 'reference', 'probe')
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'index.html'), html)
    }
    const ceiling = join(directory, 'ceiling.json')
    writeFileSync(ceiling, JSON.stringify(Object.fromEntries(API_MODEL_PORTS.map(({ slug }) => [slug, 0]))))
    try {
      const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-type-links.mjs', import.meta.url)), directory, '--ceiling', ceiling], { encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, output }
    } catch (error) {
      const result = error as { status: number; stdout: string; stderr: string }
      return { code: result.status, output: `${result.stdout}${result.stderr}` }
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
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

it.each(['generated.PaneFields.index', 'Pane.index'])('renders an unresolved Scala NumberField return in %s', async (suffix) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.scaladsl.${suffix}`)!
  const signatureLayouts = await apiSignatureLayouts(symbol, 'scala')
  const index = new SymbolIndex(model.symbols, (entry) => `/${entry.id}/`, 'scala')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    win.document.body.innerHTML = await container.renderToString(component, {
      props: { symbol, sig: symbol.signatures[0], port: 'scala', language: 'scala', index, signatureLayouts, nativeSignatureText },
    })
    const declaration = win.document.querySelector('.api-native-signature')!
    expect(declaration.getAttribute('data-code-width-status')).toBe('unresolved')
    expect(declaration.getAttribute('data-code-columns')).toBe('60')
    expect(displayedSignature(declaration)).toBe(signatureLayouts.get(symbol.signatures[0]!)!.text)
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === '_root_.io.github.libtmux.scaladsl.query.Fields.NumberField').map((link) => link.getAttribute('href')))
      .toEqual(['/io.github.libtmux.scaladsl.query.Fields.NumberField/'])
  } finally { await win.happyDOM.abort() }
})

it.each([
  'generated.PaneFields.id', 'Pane.id',
  'generated.PaneFields.active', 'Pane.active',
  'generated.SessionFields.windows', 'Session.windows',
  'generated.WindowFields.session', 'Window.session',
])('renders the Scala return continuation in %s with native links', async (suffix) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.scaladsl.${suffix}`)!
  const signatureLayouts = await apiSignatureLayouts(symbol, 'scala')
  const index = new SymbolIndex(model.symbols, (entry) => `/en/scala/latest/reference/${entry.slug}/`, 'scala')
  const java = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  index.addInventory('', parentInventory(java, (entry) => `/en/java/latest/reference/${entry.slug}/`), ['scala'], 'libtmux Java')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    win.document.body.innerHTML = (await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, {
      props: { symbol, sig, port: 'scala', language: 'scala', index, signatureLayouts, nativeSignatureText },
    })))).join('')
    const declarations = [...win.document.querySelectorAll('.api-native-signature')]
    expect(declarations.map((element) => element.getAttribute('data-code-width-status'))).toEqual(symbol.signatures.map(() => 'fits'))
    expect(declarations.map((element) => element.getAttribute('data-code-columns'))).toEqual(symbol.signatures.map(() => '60'))
    expect(declarations.map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
    expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(symbol.signatures.flatMap((signature) => signature.params.map((param) => [param.name, `#${encodeURIComponent(parameterId(symbol, param.name))}`])))
    const qualified = symbol.signatures[0]!.returns!.split('[')[0]!
    const type = model.symbols.find((entry) => entry.id === qualified.replace(/^_root_\./, ''))!
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === qualified).map((link) => link.getAttribute('href')))
      .toEqual([`/en/scala/latest/reference/${type.slug}/`])
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
    expect(win.document.querySelector('a a')).toBeNull()
  } finally { await win.happyDOM.abort() }
})

it.each([
  'Pane.capture', 'cats.Pane.capture', 'Server.cmd', 'cats.Server.cmd',
])('renders the Scala parameter continuation in %s with native links', async (suffix) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/scala.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.scaladsl.${suffix}`)!
  const signatureLayouts = await apiSignatureLayouts(symbol, 'scala')
  const index = new SymbolIndex(model.symbols, (entry) => `/en/scala/latest/reference/${entry.slug}/`, 'scala')
  const java = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  index.addInventory('', parentInventory(java, (entry) => `/en/java/latest/reference/${entry.slug}/`), ['scala'], 'libtmux Java')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    win.document.body.innerHTML = (await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, {
      props: { symbol, sig, port: 'scala', language: 'scala', index, signatureLayouts, nativeSignatureText },
    })))).join('')
    const declarations = [...win.document.querySelectorAll('.api-native-signature')]
    expect(declarations.map((element) => element.getAttribute('data-code-width-status'))).toEqual(symbol.signatures.map(() => 'fits'))
    expect(declarations.map((element) => element.getAttribute('data-code-columns'))).toEqual(symbol.signatures.map(() => '60'))
    expect(declarations.map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
    expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(symbol.signatures.flatMap((signature) => signature.params.map((param) => [param.name, `#${encodeURIComponent(parameterId(symbol, param.name))}`])))
    const type = suffix.endsWith('capture') ? 'io.github.libtmux.CaptureSpec.Builder' : '_root_.scala.concurrent.duration.FiniteDuration'
    const target = suffix.endsWith('capture')
      ? `/en/java/latest/reference/${java.symbols.find((entry) => entry.qualifiedName === type && entry.kind === 'class')!.slug}/`
      : 'https://www.scala-lang.org/api/3.x/scala/concurrent/duration/FiniteDuration.html'
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === type).map((link) => link.getAttribute('href'))).toEqual([target])
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
    expect(win.document.querySelector('a a')).toBeNull()
  } finally { await win.happyDOM.abort() }
})

it.each([
  'withServer', 'withControl', 'Server.control', 'Server.Companion.open',
  'Server.Companion.fromJava', 'Client.fetchAttachment', 'Server.liveState', 'Server.withLiveState',
])('renders the Kotlin %s header within the shared API width', async (suffix) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/kotlin.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === `io.github.libtmux.kotlin.${suffix}`)!
  const signatureLayouts = await apiSignatureLayouts(symbol, 'kotlin')
  const index = new SymbolIndex(model.symbols, (entry) => `/en/kotlin/latest/reference/${entry.slug}/`, 'kotlin')
  const java = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  index.addInventory('', parentInventory(java, (entry) => `/en/java/latest/reference/${entry.slug}/`), ['kotlin'], 'libtmux Java')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    win.document.body.innerHTML = (await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, {
      props: { symbol, sig, port: 'kotlin', language: 'kotlin', index, signatureLayouts, nativeSignatureText },
    })))).join('')
    const declarations = [...win.document.querySelectorAll('.api-native-signature')]
    expect(declarations.map((element) => element.getAttribute('data-code-width-status'))).toEqual(symbol.signatures.map(() => 'fits'))
    expect(declarations.map((element) => element.getAttribute('data-code-columns'))).toEqual(symbol.signatures.map(() => '60'))
    expect(declarations.map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
    expect([...win.document.querySelectorAll('a.api-parameter-name')].map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(symbol.signatures.flatMap((signature) => signature.params.map((param) => [param.name, `#${encodeURIComponent(parameterId(symbol, param.name))}`])))
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
    expect(win.document.querySelector('a a')).toBeNull()
  } finally { await win.happyDOM.abort() }
})

it.each([
  ['io.github.libtmux.Server.Server.sessions', 'expression', 'FilterExpr'],
  ['io.github.libtmux.batch.Batch.Batch.add', 'argv', 'Batch'],
])('renders the native Java %s overloads with owned parameter anchors', async (id, parameter, typeName) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === id)!
  expect(usesNativeSignatures(symbol, 'java')).toBe(true)
  const signatureLayouts = await apiSignatureLayouts(symbol, 'java')
  const hrefFor = (entry: ApiSymbol) => `/en/java/latest/reference/${entry.slug}/`
  const index = new SymbolIndex(model.symbols, hrefFor, 'java')
  const inventory = JSON.parse(readFileSync(new URL('../src/data/inventories/jdk.entries.json', import.meta.url), 'utf8')) as { e: [string, string][] }
  index.addInventory('https://docs.oracle.com/en/java/javase/21/docs/api/', inventory.e.map(([name, uri]) => ({
    name, uri, type: 'std:label', priority: 1, dispname: '-',
  })), ['java'], 'Java SE')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    const fragments = await Promise.all(symbol.signatures.map((sig) => container.renderToString(
      component, {
        props: { symbol, sig, port: 'java', language: 'java', index, signatureLayouts, nativeSignatureText },
      },
    )))
    win.document.body.innerHTML = fragments.join('')
    const signatures = [...win.document.querySelectorAll('.api-native-signature')]
    expect(signatures.map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
    expect(signatures).toHaveLength(symbol.signatures.length)
    for (const signature of signatures) {
      expect(signature.getAttribute('data-code-columns')).toBe('60')
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
      expect([...signature.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)).toEqual([])
    }
    const expectedTarget = model.symbols.find((entry) => entry.name === typeName && ['class', 'interface'].includes(entry.kind))!
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === typeName)
      .map((link) => link.getAttribute('href'))).toContain(hrefFor(expectedTarget))
    const standardType = parameter === 'argv' ? 'String' : 'List'
    const standardHref = `https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/${standardType === 'String' ? 'lang' : 'util'}/${standardType}.html`
    expect([...win.document.querySelectorAll('a')].filter((link) => link.textContent === standardType)
      .map((link) => link.getAttribute('href'))).toEqual(symbol.signatures.map(() => standardHref))
    const links = [...win.document.querySelectorAll('a.api-parameter-name')]
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual(
      symbol.signatures.filter((signature) => signature.params.some((param) => param.name === parameter))
        .map(() => [parameter, `#${encodeURIComponent(parameterId(symbol, parameter))}`]),
    )
    expect(win.document.querySelector('a a')).toBeNull()
  } finally { await win.happyDOM.abort() }
})

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

it.each([
  ['control.Event.Output', 'PaneId'],
  ['control.Subscription.Pane', 'PaneId'],
  ['control.Subscription.Window', 'WindowId'],
])('links the real %s payload to its native %s owner', async (id, name) => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
  const symbol = model.symbols.find((entry) => entry.id === id)!
  const owner = model.symbols.find((entry) => entry.id === `target.${name}`)!
  expect(owner.kind).toBe('struct')
  const hrefFor = (entry: ApiSymbol) => `/en/rs/latest/reference/${entry.slug}/`
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    for (const present of [true, false]) {
      const symbols = present ? model.symbols : model.symbols.filter((entry) => entry.id !== owner.id)
      const index = new SymbolIndex(symbols, hrefFor, 'rs')
      win.document.body.innerHTML = await container.renderToString(await (componentPromise ??= signatureComponent()), {
        props: { symbol, sig: symbol.signatures[0], port: 'rs', language: 'rs', index,
          nameHref: hrefFor(symbol), nativeSignatureText },
      })
      expect(displayedSignature(win.document.body)).toBe(symbol.signatures[0].raw)
      const links = [...win.document.querySelectorAll('a.api-type-link')].filter((link) => link.textContent === name)
      expect(links.map((link) => link.getAttribute('href'))).toEqual(present ? [hrefFor(owner)] : [])
      expect(win.document.querySelector('a a')).toBeNull()
      if (name === 'PaneId' && symbol.variant === 'struct') {
        const field = model.symbols.find((entry) => entry.id === `${id}.pane`)!
        expect(win.document.querySelector(`a[href="${hrefFor(field)}"]`)?.textContent).toBe('pane')
      }
    }
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
      const receiver = signature.querySelector('[data-api-role="syntax"]')!
      expect(receiver?.textContent).toBe('s')
      expect(receiver.className).toBe('api-punct')
      expect(auditSignature(signature.outerHTML)).toMatchObject({ code: 0 })
    } finally { await win.happyDOM.abort() }
  })

  it.each([
    ['ts', undefined],
    ['scala', 'def Method(value: String = "Target"): Unknown'],
    ['kotlin', 'fun Method(value: String = "Target"): Unknown'],
  ] as const)('preserves %s literal roles without hiding an unresolved return type', async (port, raw) => {
    const sig: Signature = { raw, params: [{ name: 'value', type: port === 'ts' ? 'string' : 'String', default: '"Target"' }], returns: 'Unknown' }
    const symbol: ApiSymbol = { id: 'probe.Method', name: 'Method', kind: port === 'ts' ? 'function' : 'method', modifiers: [], signatures: [sig], source: { file: 'probe' } }
    const target: ApiSymbol = { id: 'probe.Target', name: 'Target', kind: 'class', modifiers: [], signatures: [], source: { file: 'probe' } }
    const signatureLayouts = await apiSignatureLayouts(symbol, port)
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(await (componentPromise ??= signatureComponent()), { props: {
        symbol, sig, port, language: port, signatureLayouts,
        index: new SymbolIndex([symbol, target], (entry) => `/${entry.id}/`, port), nativeSignatureText: () => signatureLayouts.get(sig)!.text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
      expect([...signature.querySelectorAll('[data-api-role="syntax"]')].map((span) => span.textContent).join('')).toContain('Target')
      expect([...signature.querySelectorAll('[data-api-role="syntax"]')].every((span) => span.className === 'api-punct')).toBe(true)
      expect(signature.querySelector('a[href="/probe.Target/"]')).toBeNull()
      const unknown = [...signature.querySelectorAll('span.api-punct')].find((span) => span.textContent === 'Unknown')!
      expect(unknown).toBeDefined()
      expect(unknown.hasAttribute('data-api-role')).toBe(false)
      expect(signature.querySelector('a.api-parameter-name')?.getAttribute('href')).toBe('#probe.Method.parameter.value')
      expect(auditSignature(signature.outerHTML)).toMatchObject({ code: 1, output: expect.stringContaining('Unknown(1)') })
    } finally { await win.happyDOM.abort() }
  })

  it.each([
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

  it.each([
    'tmux.SessionOptionValues.PromptCommandCursorStyle',
    'tmux.WindowOptionValues.PaneScrollbarsPosition',
  ])('links the actual Go return type without self-linking the declaration: %s', async (id) => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const target = model.symbols.find((entry) => entry.name === symbol.name && entry.kind === 'struct')!
    const sig = symbol.signatures[0]!
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const signatureLayouts = await apiSignatureLayouts(symbol, 'go')
    const index = new SymbolIndex(model.symbols, (entry) => `/en/go/latest/reference/${entry.slug}/`, 'go')
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'go', language: 'go', signatureLayouts, index,
        nativeSignatureText: () => signatureLayouts.get(sig)!.text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect([...signature.querySelectorAll('a')].filter((link) => link.textContent === symbol.name)
        .map((link) => link.getAttribute('href'))).toEqual([`/en/go/latest/reference/${target.slug}/`])
      expect(signature.querySelector('.api-signature-name-link')).toBeNull()
      expect(displayedSignature(signature)).toBe(signatureLayouts.get(sig)!.text)
      expect(signature.getAttribute('data-code-width-status')).toBe('fits')
    } finally { await win.happyDOM.abort() }
  })

  it('reports an indivisible Go token as unresolved in the rendered signature', async () => {
    const token = 'UnbreakableType'.repeat(6)
    const raw = `func Method() ${token}`
    const sig: Signature = { raw, params: [] }
    const symbol: ApiSymbol = { id: 'tmux.Method', name: 'Method', kind: 'function', modifiers: [], signatures: [sig], source: { file: 'probe.go' } }
    const component = await (componentPromise ??= signatureComponent())
    const container = await experimental_AstroContainer.create()
    const signatureLayouts = await apiSignatureLayouts(symbol, 'go')
    const win = new Window()
    try {
      win.document.body.innerHTML = await container.renderToString(component, { props: {
        symbol, sig, port: 'go', language: 'go', signatureLayouts,
        index: new SymbolIndex([symbol], (entry) => `/${entry.id}/`, 'go'), nativeSignatureText: () => signatureLayouts.get(sig)!.text,
      } })
      const signature = win.document.querySelector('.api-native-signature')!
      expect(signature.getAttribute('data-code-width-status')).toBe('unresolved')
      expect(JSON.parse(signature.getAttribute('data-code-width-failures')!)).toEqual([{ line: 1, columns: raw.length, limit: 60 }])
      expect(displayedSignature(signature)).toBe(raw)
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
    ['go', 'tmux.Server.ListBuffers', 'containment'],
    ['java', 'io.github.libtmux.Server.Server.sessions', 'containment'],
    ['ts', 'server.Server.setHook', 'keyboard'],
    ['scala', 'io.github.libtmux.scaladsl.Server.sessions', 'keyboard'],
    ['kotlin', 'io.github.libtmux.kotlin.Server.sessions', 'keyboard'],
    ['go', 'tmux.Server.ListBuffers', 'keyboard'],
    ['java', 'io.github.libtmux.Server.Server.sessions', 'keyboard'],
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
        // Happy DOM caches the first computed style; establish focus before measuring it.
        if (check === 'keyboard') signature.focus()
        const style = win.getComputedStyle(signature)
        expect(displayedSignature(signature)).toBe(layout.text)
        expect(style.whiteSpace).toBe('pre')
        expect(win.getComputedStyle(win.document.querySelector('dl')!).overflow).toBe('visible')
        if (check === 'containment') {
          expect(style.overflowX).toBe('auto')
          expect(style.maxInlineSize).toBe('100%')
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
          expect(win.document.activeElement).toBe(signature)
          expect(win.getComputedStyle(signature).outlineStyle).toBe('solid')
          for (const trigger of signature.querySelectorAll('[popovertarget]')) {
            expect(win.document.getElementById(trigger.getAttribute('popovertarget')!)?.getAttribute('popover')).toBe('auto')
          }
        }
      }
    } finally { await win.happyDOM.abort() }
  })

  it.each([
    ['cxx', 'libtmux::Server::sessions', 'pre-wrap'],
    ['fsharp', 'LibTmux.FSharp.Server.newSession', 'normal'],
  ] as const)('keeps unformatted %s outside the scroll-region contract', async (port, id, whiteSpace) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
    const symbol = model.symbols.find((entry) => entry.id === id)!
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
      expect(win.getComputedStyle(signature).whiteSpace).toBe(whiteSpace)
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


it.fails('audits real Java grammar roles without masking an unknown type', async () => {
  const symbols = await extractSourceWithSpec(JAVA, `public @interface Marker { String value() default "Unknown"; }
public class Probe<T> { @Marker("literal  Unknown") public synchronized T method(Target value) throws Failure { return null; } }
public class Target {} public class Failure {} public class T {}`, 'Probe.java', 'edge')
  const symbol = symbols.find((entry) => entry.name === 'method')!
  const signatureLayouts = await apiSignatureLayouts(symbol, 'java')
  const index = createApiIndex({ port: 'java', extractor: 'test', symbols }, (entry) => `/${entry.id}/`)
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    const html = await container.renderToString(component, { props: { symbol, sig: symbol.signatures[0], port: 'java', language: 'java', index, signatureLayouts, nativeSignatureText } })
    win.document.body.innerHTML = html
    expect(displayedSignature(win.document.querySelector('.api-native-signature')!)).toBe([...signatureLayouts.values()][0]!.text)
    expect([...win.document.querySelectorAll('[data-api-role="syntax"]')].map((element) => element.textContent)).toEqual(['"literal  Unknown"', 'public', 'synchronized', 'throws'])
    expect([...win.document.querySelectorAll('a')].filter((element) => element.textContent === 'T')).toEqual([])
    expect(auditSignature(html).code).toBe(0)
    const bound = [...win.document.querySelectorAll('span.api-parameter-name')].find((element) => element.textContent === 'T')!
    expect(bound).toBeDefined()
    bound.className = 'api-punct'
    bound.textContent = 'Unknown'
    expect(auditSignature(win.document.body.innerHTML).code).toBe(1)
    expect(auditSignature(`${html}<span class="api-type"><span class="api-punct">s:s8CopyableP</span></span>`).code).toBe(1)
  } finally { await win.happyDOM.abort() }
})

it.fails('links recovered annotations and owner type bindings in actual Java headers', async () => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
  const index = createApiIndex(model, (entry) => `/en/java/latest/reference/${entry.slug}/`)
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  try {
    const component = await (componentPromise ??= signatureComponent())
    for (const id of ['io.github.libtmux.Server.Server.sessions', 'io.github.libtmux.OptionKey.OptionKey.read']) {
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const signatureLayouts = await apiSignatureLayouts(symbol, 'java')
      const html = (await Promise.all(symbol.signatures.map((sig) => container.renderToString(component, { props: { symbol, sig, port: 'java', language: 'java', index, signatureLayouts, nativeSignatureText } })))).join('')
      win.document.body.innerHTML = html
      expect([...win.document.querySelectorAll('.api-native-signature')].map(displayedSignature)).toEqual([...signatureLayouts.values()].map((layout) => layout.text))
      expect(auditSignature(html).code).toBe(0)
      if (symbol.name === 'sessions') {
        expect(win.document.querySelector('a[href="/en/java/latest/reference/io-github-libtmux-catalog-operation-operation/"]')?.textContent).toBe('Operation')
        expect([...win.document.querySelectorAll('a')].find((link) => link.textContent === 'ReadOnly')?.getAttribute('href')).toContain('5687445832cd835b4509b9fbc264cdf1a8201093')
      }
    }
  } finally { await win.happyDOM.abort() }
})
