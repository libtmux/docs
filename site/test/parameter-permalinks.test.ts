import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Element } from 'happy-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { parameterId, SymbolIndex, type ApiSymbol, type Param } from '@libtmux/api-model'
import { apiEntryFields, parameterBindingFacts, POWER_SHELL_COMMON_HELP } from '../src/lib/api-sections'
import { linkTmuxDoc } from '../src/lib/tmux-links'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
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
  const bridge = 'data:text/javascript,export const { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, linkTmuxDoc } = globalThis.__apiParameterPermalinks'
  const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
  const preview = await compile('../src/components/LinkPreview.astro')
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const type = await compile('../src/components/api/ApiType.astro', {
    './SymbolName.astro': name, './ApiKeyword.astro': keyword,
    '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
    '../../lib/code-layout': new URL('../src/lib/code-layout.ts', import.meta.url).href,
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
  vi.stubGlobal('__apiParameterPermalinks', { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, linkTmuxDoc })
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
