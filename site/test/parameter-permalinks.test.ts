import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { parameterId, SymbolIndex, type ApiSymbol, type Param } from '@libtmux/api-model'
import { apiEntryFields, parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE } from '../src/lib/api-sections'
import { linkTmuxDoc } from '../src/lib/tmux-links'
import { signatureSpans, typeLayout } from '../src/lib/code-layout'
import { auditTypeLinks } from './type-link-audit'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const css = ['api-headings.css', 'api.css'].map((name) =>
  readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8')).join('\n')
const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllGlobals()
})

/** Compile the ordinary parameter paragraph and the complete command renderer. */
async function parameterComponents() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(relative: string, imports: Record<string, string> = {}, replacement?: string) {
    const file = new URL(relative, import.meta.url)
    const source = (replacement ?? readFileSync(file, 'utf8')).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
    return `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${file.pathname}`).toString('base64')}`
  }
  const bridge = 'data:text/javascript,export const { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE, linkTmuxDoc, signatureSpans, typeLayout } = globalThis.__apiParameterPermalinks'
  const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const type = await compile('../src/components/api/ApiType.astro', {
    './SymbolName.astro': name, './ApiKeyword.astro': keyword,
    '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
    // A native type layout loads its grammar lazily, which only Vitest's own loader resolves.
    '../../lib/code-layout': bridge,
  })
  const doc = await compile('../src/components/api/ApiDoc.astro', { '../../lib/tmux-links': bridge })
  const overloads = await compile('../src/components/api/ApiFieldOverloads.astro')
  const imports = { '@libtmux/api-model': bridge, '../../lib/api-sections': bridge,
    './ApiType.astro': type, './ApiDoc.astro': doc, './ApiFieldOverloads.astro': overloads }
  const commands = await compile('../src/components/api/ApiCommandParameters.astro', imports)
  const source = readFileSync(new URL('../src/components/api/ApiEntry.astro', import.meta.url), 'utf8')
  const start = source.indexOf('<p class:list={[(language ===')
  const end = source.indexOf('</p>', start) + 4
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const wrapper = `---
import { parameterId } from '@libtmux/api-model'
import ApiType from './ApiType.astro'
import ApiDoc from './ApiDoc.astro'
import ApiFieldOverloads from './ApiFieldOverloads.astro'
const { p, symbol, index, language, overloadTargets } = Astro.props
---
${source.slice(start, end)}`
  const ordinary = await compile('../src/components/api/ApiEntry.astro', imports, wrapper)
  return {
    ordinary: (await import(/* @vite-ignore */ ordinary)).default,
    commands: (await import(/* @vite-ignore */ commands)).default,
  }
}

let components: ReturnType<typeof parameterComponents> | undefined
const bridged = { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE, linkTmuxDoc, signatureSpans, typeLayout }
const session: ApiSymbol = { id: 'demo.Session', name: 'Session', kind: 'class', modifiers: [], signatures: [], source: { file: 'demo.py' } }
const parameter: Param = { name: 'target', type: 'Session', optional: true, default: 'None',
  doc: 'Choose the Session whose windows should be read.', since: '1.2', deprecated: 'Use selection instead.' }
const commonBinding: NonNullable<Param['binding']> = {
  mandatory: false, switch: true, common: true, dynamic: false, aliases: [],
  pipeline: { byValue: false, byPropertyName: false, remainingArguments: false },
  nativeType: 'Session', attributes: [],
}
const symbol: ApiSymbol = { id: 'internal.Probe.read', publicId: 'demo.Probe.read', name: 'read', kind: 'method', modifiers: ['overload'],
  signatures: [{ params: [parameter] }, { params: [] }], source: { file: 'demo.py' } }

async function render(command = false, language = 'py') {
  // Bridge the real Vitest-loaded helpers into compiled Astro's native imports.
  vi.stubGlobal('__apiParameterPermalinks', bridged)
  const loaded = await (components ??= parameterComponents())
  const win = new Window({ url: 'https://libtmux.org/en/py/latest/reference/demo-probe-read/' })
  windows.push(win)
  win.document.head.innerHTML = `<style>${css}</style>`
  const entry = command ? { ...symbol, id: 'LibTmux\\Read-TmuxSession', publicId: undefined, name: 'Read-TmuxSession' } : symbol
  const index = new SymbolIndex([entry, session], (row) => `/reference/${row.id}/`, command ? 'powershell' : language)
  const fields = apiEntryFields(entry, command ? 'powershell' : language).params
  const params = command ? [...fields, { ...fields[0], name: 'Verbose', binding: commonBinding }] : fields
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(command ? loaded.commands : loaded.ordinary, { props: {
    symbol: entry, index, params, p: fields[0], language, overloadTargets: new Map([['read(target)', 'selected-overload']]),
  } })
  return { win, entry, paragraph: win.document.querySelector('p')! }
}

const follows = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & 4)

it('keeps the ordinary parameter permalink before its prose and lifecycle metadata', async () => {
  const { paragraph } = await render()
  const permalink = paragraph.querySelector('a.api-heading-link')!
  const prose = [...paragraph.querySelectorAll('span')].find((span) => span.textContent === parameter.doc)!
  expect(prose).toBeDefined()
  expect(follows(permalink, prose)).toBe(true)
  expect(permalink.previousElementSibling?.classList.contains('api-parameter-signature')).toBe(true)
  expect(follows(permalink, paragraph.querySelector('.gp-sphinx-api-param-since')!)).toBe(true)
  expect(follows(permalink, paragraph.querySelector('.gp-sphinx-api-param-deprecated')!)).toBe(true)
  expect(follows(permalink, paragraph.querySelector('.api-field-overloads')!)).toBe(true)
})

it('keeps the parameter type tight inside its parentheses', async () => {
  for (const [language, heading] of [['py', 'target? (Session)'], ['julia', 'target? = None (Session)']]) {
    const { paragraph } = await render(false, language)
    expect(paragraph.querySelector('.api-parameter-signature')!.textContent!.replace(/\s+/g, ' ').trim(), language).toBe(heading)
    // The overload label is a call, so it carries its own parentheses.
    expect(paragraph.querySelector('.api-field-overloads')!.textContent!.replace(/\s+/g, ' ').trim(), language).toBe('for read(target)')
  }
})

it('keeps command parameter controls beside their signature instead of the far edge', async () => {
  const { win } = await render(true)
  const permalinks = [...win.document.querySelectorAll('a.api-heading-link')]
  expect(permalinks).toHaveLength(2)
  for (const permalink of permalinks) {
    expect(win.getComputedStyle(permalink).marginInlineStart).toBe('0.25rem')
    expect(permalink.previousElementSibling?.classList.contains('api-parameter-signature')).toBe(true)
  }
})

it.each(['py', 'go', 'ts', 'julia'])('preserves %s name, type, overload and accessible permalink destinations', async (language) => {
  const { win, paragraph } = await render(false, language)
  const permalink = paragraph.querySelector('a.api-heading-link')!
  expect(permalink.getAttribute('href')).toBe('#demo.Probe.read.parameter.target')
  expect(permalink.getAttribute('aria-label')).toBe('Link to target parameter')
  expect(permalink.getAttribute('data-pagefind-ignore')).toBe('all')
  expect(paragraph.querySelector('strong > a')?.getAttribute('href')).toBe(permalink.getAttribute('href'))
  expect(paragraph.querySelector('a.api-type-link')?.getAttribute('href')).toBe('/reference/demo.Session/')
  expect(paragraph.querySelector('.api-field-overloads a')?.getAttribute('href')).toBe('#selected-overload')
  expect(paragraph.querySelectorAll('a a')).toHaveLength(0)
  expect(paragraph.textContent).toContain('?')
  if (language === 'ts' || language === 'julia') expect(paragraph.textContent).toContain('= None')
  else expect(paragraph.textContent).toContain(parameter.doc)
  expect(win.getComputedStyle(permalink).minInlineSize).toBe('1.5rem')
  expect(win.getComputedStyle(permalink).minBlockSize).toBe('1.5rem')
  expect(win.getComputedStyle(permalink).display).toBe('inline-flex')
  expect(permalink.hasAttribute('tabindex')).toBe(false)
})

it('preserves command and common-parameter targets and native links', async () => {
  const { win, entry } = await render(true)
  for (const name of ['target', 'Verbose']) {
    const id = parameterId(entry, name)
    const row = win.document.getElementById(id)!
    expect(row).not.toBeNull()
    const permalink = row.querySelector('a.api-heading-link')!
    expect(permalink.getAttribute('href')).toBe(`#${encodeURIComponent(id)}`)
    expect(permalink.getAttribute('aria-label')).toBe(`Link to -${name} parameter`)
    expect(row.querySelector('strong > a')?.getAttribute('href')).toBe(permalink.getAttribute('href'))
    expect(row.querySelector('a.api-type-link')?.getAttribute('href')).toBe('/reference/demo.Session/')
    expect(row.querySelectorAll('a a')).toHaveLength(0)
  }
})

/** The parameter paragraph a reference page prints for a parameter declared with `type`. */
async function renderType(language: string, type: string) {
  vi.stubGlobal('__apiParameterPermalinks', bridged)
  const loaded = await (components ??= parameterComponents())
  const win = new Window({ url: 'https://libtmux.org/en/py/latest/reference/demo-probe-read/' })
  windows.push(win)
  const probe: ApiSymbol = { ...symbol, signatures: [{ params: [{ name: 'value', type }] }] }
  const index = new SymbolIndex([probe], (row) => `/reference/${row.id}/`, language)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(loaded.ordinary, { props: {
    symbol: probe, index, p: apiEntryFields(probe, language).params[0], language, overloadTargets: new Map(),
  } })
  const spans = [...win.document.querySelectorAll('.api-type span')]
  return {
    html: win.document.body.innerHTML,
    syntax: spans.filter((span) => span.getAttribute('data-api-role') === 'syntax').map((span) => span.textContent),
    plain: spans.filter((span) => span.className === 'api-punct' && !span.hasAttribute('data-api-role') && /^\w+$/.test(span.textContent ?? '')).map((span) => span.textContent),
  }
}

it.each([
  ['ruby', 'untyped', ['untyped']],
  ['ruby', 'bool | nil', ['bool', 'nil']],
  ['ruby', ':horizontal | :vertical', [':horizontal', ':vertical']],
  ['swift', 'Self', ['Self']],
  ['swift', '@escaping (inout Self) async throws -> Self.Element', ['@escaping', 'inout', 'Self', 'async', 'throws', 'Self.Element']],
  ['swift', 'some Self', ['some', 'Self']],
])('lists a %s parameter typed %s with the grammar roles its signature gives', async (language, type, syntax) => {
  const rendered = await renderType(language, type)
  expect(rendered.syntax).toEqual(syntax)
  expect(rendered.plain).toEqual([])
  // The real type-link check counts none of it.
  expect(auditTypeLinks(rendered.html)).toMatchObject({ code: 0 })
})

it.each([
  ['ruby', '::Hash[::String, untyped]', ['untyped'], ['Hash', 'String']],
  ['swift', '(Hasher) async -> Self', ['async', 'Self'], ['Hasher']],
])('keeps a %s type name no model entry resolves plain in %s', async (language, type, syntax, plain) => {
  const rendered = await renderType(language, type)
  expect(rendered.syntax).toEqual(syntax)
  expect(rendered.plain).toEqual(plain)
  // The check still counts every unresolved name, and only those.
  const audit = auditTypeLinks(rendered.html)
  expect(audit.code).toBe(1)
  for (const name of plain) expect(audit.output).toContain(`${name}(1)`)
  for (const word of syntax) expect(audit.output).not.toContain(`${word}(`)
})
