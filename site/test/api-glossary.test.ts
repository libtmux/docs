import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { API_GLOSSARY_GROUPS, ALL_GLOSSARY_GROUPS, MCP_GLOSSARY_GROUPS, API_GLOSSARY_PATH, apiGlossary, apiGlossaryHref, apiGlossaryMarkdown } from '../src/lib/api-glossary'
import { NATIVE_API_GLOSSARIES } from '../src/lib/api-glossary-native'
import { glossaryPreview } from '../src/lib/link-preview'
import { GET as markdownRoute } from '../src/pages/reference/glossary.md'
import { GET as jsonRoute } from '../src/pages/reference/glossary.json'

const terms = ALL_GLOSSARY_GROUPS.flatMap((group) => group.terms)
const ids = new Set(terms.map((term) => term.id))
const modelPath = new URL('../../packages/api-model/src/model.ts', import.meta.url)
const modelSource = ts.createSourceFile(modelPath.pathname, readFileSync(modelPath, 'utf8'), ts.ScriptTarget.Latest, true)
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
const windows: Window[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const win of windows.splice(0)) await win.happyDOM.abort()
})

function declaredLabels(name: string): string[] {
  const declaration = modelSource.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === name)
  expect(declaration, `${name} remains a declared type`).toBeDefined()
  expect(ts.isUnionTypeNode(declaration!.type)).toBe(true)
  return (declaration!.type as ts.UnionTypeNode).types.map((node) => {
    expect(ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)).toBe(true)
    return ((node as ts.LiteralTypeNode).literal as ts.StringLiteral).text
  })
}

/** Compile the real small component without starting a site or building API pages. */
async function badgeComponent(name = 'ApiBadge') {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const source = new URL(`../src/components/api/${name}.astro`, import.meta.url)
  const compiled = await transform(readFileSync(source, 'utf8'), {
    filename: source.pathname, internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
    resolvePath: (specifier: string) => specifier,
  })
  expect(compiled.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
  let code = compiled.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
  for (const name of ['api-labels', 'api-glossary']) {
    code = code.replaceAll(`"../../lib/${name}"`, JSON.stringify(new URL(`../src/lib/${name}.ts`, import.meta.url).href))
  }
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

describe('API glossary coverage', () => {
  it('explains Scala methods and extensions in the Scala preview', () => {
    const preview = glossaryPreview('/en/scala/latest/reference/glossary/')
    expect(preview.terms!.method.description).toContain('def')
    expect(preview.terms!.method.detail).toContain('extension')
    expect(JSON.stringify(preview)).not.toContain('Python')
    expect(JSON.stringify(preview)).not.toContain('Julia')
  })

  it('exports a Scala glossary with native references and its own identity', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'scala')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const context = { site: new URL('https://libtmux.org'), url: new URL('https://libtmux.org/en/scala/latest/reference/glossary.json') } as Parameters<typeof jsonRoute>[0]
    const json = await (await jsonRoute(context)).json()
    const markdown = await (await markdownRoute(context)).text()
    expect(json.url).toBe('https://libtmux.org/en/scala/latest/reference/glossary/')
    const method = json.groups.flatMap((group: { terms: { id: string }[] }) => group.terms).find((term: { id: string }) => term.id === 'method')
    expect(method.definition).toContain('def')
    expect(method.references.map((reference: { url: string }) => new URL(reference.url).hostname)).toEqual(['docs.scala-lang.org', 'docs.scala-lang.org'])
    expect(markdown).toContain('Source: https://libtmux.org/en/scala/latest/reference/glossary/')
    expect(markdown).not.toContain('Python')
    expect(markdown).not.toContain('Julia')
  })

  it('defines every kind and modifier supported by the API model, including unused kinds', () => {
    expect(API_GLOSSARY_GROUPS.find((group) => group.id === 'symbol-kinds')!.terms.map((term) => term.id).sort()).toEqual([...declaredLabels('SymbolKind'), 'cmdlet'].sort())
    expect(API_GLOSSARY_GROUPS.find((group) => group.id === 'modifiers')!.terms.map((term) => term.id).sort()).toEqual([...declaredLabels('Modifier'), 'inherited'].sort())
    expect(ids.size).toBe(terms.length)
    expect(ids.has('package')).toBe(true)
  })

  it('covers every kind, modifier, command kind, and package badge in the extracted models', () => {
    const folder = new URL('../src/data/api/', import.meta.url)
    const missing: string[] = []
    let symbols = 0
    for (const file of readdirSync(folder).filter((file) => file.endsWith('.json'))) {
      const model = JSON.parse(readFileSync(new URL(file, folder), 'utf8'))
      for (const symbol of model.symbols ?? []) {
        symbols++
        const labels = [symbol.kind, ...(symbol.modifiers ?? []), ...(symbol.command ? [symbol.command.kind] : []), ...(symbol.package ? ['package'] : []), ...(symbol.inheritedFrom ? ['inherited'] : [])]
        for (const label of labels) if (!apiGlossaryHref(label)) missing.push(`${file}:${symbol.id}:${label}`)
      }
    }
    expect(symbols).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it.each(Object.keys(NATIVE_API_GLOSSARIES))('covers every extracted %s badge with a native definition', (port) => {
    const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8'))
    const path = `/preview-17/en/${port}/v9-proof/reference/glossary/`
    const native = apiGlossary(path)
    expect(native.port).toBe(port)
    expect(native.path).toBe(path)
    const ids = native.groups.flatMap((group) => group.terms.map((term) => term.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const symbol of model.symbols) {
      for (const label of [symbol.kind, ...(symbol.modifiers ?? []), ...(symbol.command ? [symbol.command.kind] : []), ...(symbol.inheritedFrom ? ['inherited'] : []), 'package']) {
        expect(apiGlossaryHref(label, path), `${symbol.id}:${label}`).toBe(`${path}#${label}`)
      }
    }
    for (const id of ids) expect(native.groups.flatMap((group) => group.terms).find((term) => term.id === id)).toEqual({ id, ...NATIVE_API_GLOSSARIES[port][id] })
  })

  it('uses stable unique anchors and language references for every term', () => {
    const primaryHosts = new Set(['docs.python.org', 'docs.julialang.org', 'go.dev', 'docs.swift.org', 'eel.is', 'learn.microsoft.com', 'doc.rust-lang.org', 'www.typescriptlang.org', 'kotlinlang.org', 'packaging.python.org', 'modelcontextprotocol.io'])
    for (const term of terms) {
      expect(term.id).toMatch(/^[a-z][a-zA-Z]*$/)
      expect(apiGlossaryHref(term.id)).toBe(`${API_GLOSSARY_PATH}#${term.id}`)
      expect(term.definition.length).toBeGreaterThan(20)
      expect(term.references.length).toBeGreaterThan(0)
      for (const reference of term.references) {
        const url = new URL(reference.url)
        expect(url.protocol).toBe('https:')
        expect(primaryHosts.has(url.hostname), reference.url).toBe(true)
        expect(reference.title.length).toBeGreaterThan(0)
      }
    }
    for (const unknown of ['', 'not-a-kind', 'constructor', '__proto__', '2 overloads']) expect(apiGlossaryHref(unknown)).toBeUndefined()
  })

  it('keeps MCP annotation definitions and previews in the current port, version, and preview prefix', () => {
    const annotations = MCP_GLOSSARY_GROUPS.flatMap((group) => group.terms)
    expect(annotations.map((term) => term.id).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint', 'title'])
    for (const base of ['/en/cxx/latest/', '/preview-17/en/rs/stable/', '/en/julia/latest/']) {
      const href = `${base}mcp/reference/glossary/`
      const preview = glossaryPreview(href)
      for (const term of annotations) {
        expect(apiGlossaryHref(term.id, `${base}mcp/tools/create_session/`)).toBe(`${href}#${term.id}`)
        expect(preview.terms![term.id]).toMatchObject({ href: `${href}#${term.id}`, description: term.definition, detail: term.detail })
      }
      expect(apiGlossaryHref('attribute', `${base}mcp/reference/tooldefinition/`)).toBe(`${href}#attribute`)
      expect(apiGlossaryHref('inventedHint', `${base}mcp/tools/create_session/`)).toBeUndefined()
    }
  })

  it('keeps native glossary links at the port English root across preview locales', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'powershell')
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-138/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-138/ja')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'ja')
    vi.stubEnv('LIBTMUX_DOCS_LOCALES_ROOT', '/pr-138/')
    vi.resetModules()
    const glossary = await import('../src/lib/api-glossary')
    expect(glossary.apiGlossaryHref('cmdlet')).toBe('/pr-138/en/powershell/latest/reference/glossary/#cmdlet')
    expect(glossary.apiGlossaryHref('function')).toBe('/pr-138/en/powershell/latest/reference/glossary/#function')
  })

  it('exports the same terms, definitions, anchors, and references through Markdown and JSON', async () => {
    const context = { site: new URL('https://libtmux.org') } as Parameters<typeof jsonRoute>[0]
    const jsonResponse = await jsonRoute(context)
    const markdownResponse = await markdownRoute(context)
    expect(jsonResponse.headers.get('Content-Type')).toContain('application/json')
    expect(markdownResponse.headers.get('Content-Type')).toContain('text/markdown')
    const json = await jsonResponse.json()
    const markdown = await markdownResponse.text()
    expect(markdown).toBe(apiGlossaryMarkdown('https://libtmux.org'))
    expect(json.schema).toBe(1)
    expect(json.url).toBe(`https://libtmux.org${API_GLOSSARY_PATH}`)
    expect(json.groups.flatMap((group: { terms: unknown[] }) => group.terms)).toHaveLength(terms.length)
    for (const term of terms) {
      expect(markdown).toContain(`### ${term.id}\n`)
      expect(markdown).toContain(term.definition)
      const exported = json.groups.flatMap((group: { terms: { id: string }[] }) => group.terms).find((entry: { id: string }) => entry.id === term.id)
      expect(exported).toEqual({ ...term, url: `https://libtmux.org${API_GLOSSARY_PATH}#${term.id}` })
      for (const reference of term.references) expect(markdown).toContain(`](${reference.url})`)
    }
  })
})

describe('rendered API badges', () => {
  it('renders native Scala meanings and matching contextual twins in Core, MCP and Workspace', async () => {
    const component = await badgeComponent('ApiGlossaryContent')
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    windows.push(win)
    for (const product of ['', 'mcp/', 'workspace/']) {
      const path = `/preview-17/en/scala/v9-proof/${product}reference/glossary/`
      win.document.body.innerHTML = await container.renderToString(component, { props: { contextPath: path } })
      const section = win.document.querySelector('section[aria-labelledby="method"]')!
      expect(section.textContent).toContain('declared with def')
      expect(section.textContent).toContain('extension method')
      expect([...section.querySelectorAll('a')].map((link) => new URL(link.href).hostname)).toEqual(['docs.scala-lang.org', 'docs.scala-lang.org'])
      expect(win.document.body.textContent).not.toMatch(/Python|Julia/)
      expect(win.document.querySelector('a[href$=".json"]')!.getAttribute('href')).toBe(`${path.slice(0, -1)}.json`)
      expect(Boolean(win.document.querySelector('#readOnlyHint'))).toBe(product === 'mcp/')
    }
  })

  it('links full labels to their meanings while keeping compact marks safe inside links', async () => {
    const component = await badgeComponent()
    const container = await experimental_AstroContainer.create()
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    for (const [label, variant, value, target] of [
      ['cmdlet', 'kind', 'function', 'cmdlet'],
      ['class', 'kind', 'class', 'class'],
      ['readonly', 'mod', 'readonly', 'readonly'],
      ['inherited', 'mod', 'inherited', 'inherited'],
      ['3 overloads', 'mod', 'overload', 'overload'],
      ['LibTmux.Workspace', 'mod', 'package', 'package'],
    ]) {
      win.document.body.innerHTML = await container.renderToString(component, { props: { label, variant, value } })
      const link = win.document.querySelector('a')!
      expect(link, label).not.toBeNull()
      expect(link.getAttribute('href')).toBe(`${API_GLOSSARY_PATH}#${target}`)
      expect(link.textContent).toBe(label)
      expect(link.getAttribute('aria-label')).toContain(`${target} definition`)
      expect(link.classList.contains(`api-badge--${variant}-${value}`)).toBe(true)
    }
    const compact = await container.renderToString(component, { props: { label: 'class', variant: 'kind', value: 'class', compact: true } })
    win.document.body.innerHTML = `<a href="/en/reference/symbol/">${compact} A type</a>`
    expect(win.document.querySelectorAll('a')).toHaveLength(1)
    expect(win.document.querySelector('span.api-nav__kind')!.getAttribute('aria-hidden')).toBe('true')
    const command = await container.renderToString(component, { props: { label: 'cmdlet', variant: 'kind', value: 'cmdlet', compact: true } })
    win.document.body.innerHTML = `<a href="/en/reference/command/">${command} A command</a>`
    expect(win.document.querySelector('span.api-nav__kind.api-badge--kind-function')?.textContent).toBe('f')
    expect(win.document.querySelector('span')?.getAttribute('title')).toBe('cmdlet')
    const unknown = await container.renderToString(component, { props: { label: 'future-kind', variant: 'kind', value: 'future-kind' } })
    win.document.body.innerHTML = unknown
    expect(win.document.querySelector('a')).toBeNull()
    expect(win.document.querySelector('span')!.textContent).toBe('future-kind')
  })
})
