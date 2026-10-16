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
const nativeAuthorities: Record<string, RegExp> = {
  scala: /^https:\/\/docs\.scala-lang\.org\//, java: /^https:\/\/docs\.oracle\.com\//,
  kotlin: /^https:\/\/kotlinlang\.org\//, julia: /^https:\/\/docs\.julialang\.org\//,
  py: /^https:\/\/(?:docs\.python\.org|peps\.python\.org|packaging\.python\.org)\//,
  ts: /^https:\/\/www\.typescriptlang\.org\//,
  csharp: /^https:\/\/learn\.microsoft\.com\/en-us\/(?:dotnet\/csharp|nuget)\//,
  fsharp: /^https:\/\/learn\.microsoft\.com\/en-us\/(?:dotnet\/fsharp|nuget)\//,
  powershell: /^https:\/\/learn\.microsoft\.com\/en-us\/powershell\//,
  go: /^https:\/\/go\.dev\//, cxx: /^https:\/\/(?:eel\.is\/c\+\+draft|cmake\.org\/cmake)\//,
  rs: /^https:\/\/doc\.rust-lang\.org\//,
  ruby: /^https:\/\/(?:docs\.ruby-lang\.org|guides\.rubygems\.org|github\.com\/ruby\/rbs)\//,
  lua: /^https:\/\/(?:www\.lua\.org|luals\.github\.io)\//,
  swift: /^https:\/\/(?:docs\.swift\.org|www\.swift\.org)\//,
}

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
  it.fails('defines Java annotation interfaces and elements in native previews and exports', async () => {
    const path = '/en/java/latest/reference/glossary/'
    const annotation = NATIVE_API_GLOSSARIES.java.annotation
    expect(annotation).toBeDefined()
    expect(annotation.definition).toContain('@interface')
    expect(annotation.definition).toContain('element')
    expect(annotation.detail).toContain('no parameters')
    expect(annotation.detail).toContain('default')
    expect(annotation.references).toEqual([
      { title: 'Java annotation interfaces and elements', url: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html#jls-9.6' },
    ])
    for (const context of [API_GLOSSARY_PATH, path]) {
      expect(apiGlossaryHref('annotation', context)).toBe(`${context}#annotation`)
      expect(glossaryPreview(context).terms!.annotation.description).toBe(annotation.definition)
      expect(apiGlossaryMarkdown('https://libtmux.org', context)).toContain(annotation.detail)
    }
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'java')
    const context = { site: new URL('https://libtmux.org'), url: new URL('https://libtmux.org/en/java/latest/reference/glossary.json') } as Parameters<typeof jsonRoute>[0]
    const json = await (await jsonRoute(context)).json()
    const exported = json.groups.flatMap((group: { terms: { id: string }[] }) => group.terms).find((term: { id: string }) => term.id === 'annotation')
    expect(exported).toEqual({ id: 'annotation', ...annotation, url: `https://libtmux.org${path}#annotation` })
    expect(await (await markdownRoute(context)).text()).toContain(annotation.definition)
    for (const port of ['scala', 'kotlin', 'csharp', 'ts']) expect(apiGlossaryHref('annotation', `/en/${port}/latest/reference/glossary/`)).toBeUndefined()
    expect(apiGlossaryHref('Unknown', path)).toBeUndefined()
  })

  it('defines the Scala opaque modifier at both deliberate global and native anchors', () => {
    const path = '/en/scala/latest/reference/glossary/'
    expect(apiGlossaryHref('opaque', API_GLOSSARY_PATH)).toBe(`${API_GLOSSARY_PATH}#opaque`)
    expect(apiGlossaryHref('opaque', path)).toBe(`${path}#opaque`)
    const opaque = glossaryPreview(path).terms!.opaque
    expect(opaque.description).toContain('opaque type alias')
    expect(opaque.description).toContain('defining scope')
    expect(apiGlossary(path).groups.flatMap((group) => group.terms).find((term) => term.id === 'opaque')!.references).toEqual([
      { title: 'Scala opaque type aliases', url: 'https://docs.scala-lang.org/scala3/reference/other-new-features/opaques.html' },
    ])
  })

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
    expect(API_GLOSSARY_GROUPS.find((group) => group.id === 'modifiers')!.terms.map((term) => term.id).sort()).toEqual([...new Set([...declaredLabels('Modifier'), 'inherited', 'opaque'])].sort())
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
    for (const id of ids) {
      const term = native.groups.flatMap((group) => group.terms).find((term) => term.id === id)!
      expect(term).toEqual({ id, ...NATIVE_API_GLOSSARIES[port][id] })
      expect(term.references.length).toBeGreaterThan(0)
      for (const reference of term.references) expect(reference.url, `${port}:${id}`).toMatch(nativeAuthorities[port])
    }
  })

  it('authors a native catalog for every extracted language without a generic fallback', () => {
    const ports = readdirSync(new URL('../src/data/api/', import.meta.url)).filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const model = JSON.parse(readFileSync(new URL(`../src/data/api/${file}`, import.meta.url), 'utf8'))
        return model.symbols ? [model.port] : []
      })
    expect(Object.keys(NATIVE_API_GLOSSARIES).sort()).toEqual(ports.sort())
    expect(apiGlossaryHref('cmdlet', '/en/julia/latest/reference/glossary/')).toBeUndefined()
    expect(apiGlossaryHref('method', '/en/powershell/latest/reference/glossary/')).toBeUndefined()
  })

  it('explains named Go string and function types represented by the struct badge', () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8'))
    for (const id of ['tmux.TmuxFilter', 'tmux.CommandObserver']) expect(model.symbols.find((symbol: { id: string }) => symbol.id === id).kind).toBe('struct')
    const term = NATIVE_API_GLOSSARIES.go.struct
    expect(term.definition).toContain('named Go type')
    expect(term.detail).toContain('string')
    expect(term.detail).toContain('function')
  })

  it('explains Rust constructors represented by the method badge without inventing a self receiver', () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8'))
    for (const id of ['server.Server.new', 'plan.Plan.new']) {
      const symbol = model.symbols.find((symbol: { id: string }) => symbol.id === id)
      expect(symbol.kind).toBe('method')
      expect(symbol.signatures[0].params).toEqual([])
    }
    const term = NATIVE_API_GLOSSARIES.rs.method
    expect(term.definition).toContain('associated function')
    expect(term.detail).toContain('without a receiver')
    expect(term.detail).toContain('Type::function')
  })

  it.each([
    ['py', 'method', 'bound method'], ['ruby', 'static', 'singleton method'],
    ['lua', 'typealias', 'tooling alias'], ['go', 'method', 'receiver parameter'],
    ['rs', 'overload', 'do not overload'], ['cxx', 'readonly', 'const-qualified'],
    ['csharp', 'readonly', 'readonly instance fields'], ['fsharp', 'enum', 'discriminated union'],
    ['swift', 'interface', 'Swift protocol'], ['ts', 'private', 'TypeScript'],
    ['powershell', 'cmdlet', 'pipeline input'], ['java', 'readonly', 'final class'],
    ['kotlin', 'async', 'suspend'], ['julia', 'function', 'generic function'],
    ['scala', 'method', 'declared with def'],
  ])('keeps the native meaning of %s %s in its preview and authored twins', (port, id, meaning) => {
    const path = `/en/${port}/latest/reference/glossary/`
    expect(glossaryPreview(path).terms![id].description).toContain(meaning)
    expect(apiGlossaryMarkdown('https://libtmux.org', path)).toContain(meaning)
  })

  it('uses stable unique anchors and language references for every term', () => {
    const primaryHosts = new Set(['docs.python.org', 'docs.julialang.org', 'docs.scala-lang.org', 'go.dev', 'docs.swift.org', 'eel.is', 'learn.microsoft.com', 'doc.rust-lang.org', 'www.typescriptlang.org', 'kotlinlang.org', 'packaging.python.org', 'modelcontextprotocol.io'])
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

  it('renders the extracted Rust async contract with its native glossary link', async () => {
    const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8'))
    const method = model.symbols.find((symbol: { id: string }) => symbol.id === 'server.Server.set_hook')
    expect(method.modifiers).toContain('async')
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = await container.renderToString(await badgeComponent(), {
      request: new Request('http://localhost:53971/en/rs/latest/reference/server-server-set_hook/'),
      props: { label: 'async', variant: 'mod', value: 'async' },
    })
    const badge = win.document.querySelector('a.api-badge--mod-async')!
    expect(badge.textContent).toBe('async')
    expect(badge.getAttribute('href')).toBe('/en/rs/latest/reference/glossary/#async')
    expect(badge.getAttribute('aria-label')).toContain('async definition')
  })
})
