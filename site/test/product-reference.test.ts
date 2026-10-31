import { describe, expect, it } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { API_MODELS, createApiIndex, referenceAlternatives, topLevelTypesOf } from '../src/lib/api-models'
import { coreApiSymbols, productApiAlternatives, productApiHref, productApiNavigation, productApiRedirects, productApiRoutes, productReferenceTree } from '../src/lib/product-api'
import { searchApi, apiTreeHref } from '../src/lib/api-search'
import { isTuplePayload } from '../src/lib/api-tree'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { getResolver } from '../src/lib/prose-resolver'
import { decideMention, symbolsForProduct, type ApiProduct } from '@libtmux/api-model'
import type { SidebarItem } from '../src/lib/sidebar'
import mentionIndex from '../src/data/mentions.json'
import { apiCommandRelatedLinks } from '../src/lib/api-sections'
import { productApiIndex } from '../src/lib/product-api'

const navigationLinks = (items: SidebarItem[]): string[] => items.flatMap((item) => [
  ...(item.href ? [item.href] : []), ...(item.type === 'group' ? navigationLinks(item.items) : []),
])

describe('product declaration trees', () => {
  it('keeps public product pages out of core without dropping internal declarations', () => {
    const model = API_MODELS.go
    const workspace = model.symbols.find((symbol) => symbol.id === 'workspace.Workspace.InitialSessionRequest')!
    expect(workspace).toBeDefined()
    expect(coreApiSymbols(model)).not.toContain(workspace)
    expect(productApiHref(model, workspace, 'latest')).toContain('/workspace/reference/')
    const internal = { ...workspace, apiScope: 'internal' as const }
    expect(coreApiSymbols({ ...model, symbols: [internal] })).toEqual([internal])
    for (const candidate of Object.values(API_MODELS)) {
      const core = coreApiSymbols(candidate)
      expect(core.length + symbolsForProduct(candidate, 'workspace').length + symbolsForProduct(candidate, 'mcp').length)
        .toBe(candidate.symbols.length)
    }
  })
  it('resolves native PowerShell related help to local core and workspace APIs', () => {
    const model = API_MODELS.powershell
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.Workspace\\ConvertTo-TmuxWorkspace')!
    const related = apiCommandRelatedLinks(symbol, productApiIndex(model, 'v1.2.3'))
    expect(related.map((link) => link.text)).toEqual(['Get-TmuxSnapshot', 'Resolve-TmuxWorkspace', 'ConvertTo-TmuxWorkspaceYaml', 'ConvertTo-TmuxWorkspaceJson'])
    expect(related[0].href).toBe('/powershell/v1.2.3/reference/libtmux-get-tmuxsnapshot/')
    expect(related.slice(1).every((link) => link.href.startsWith('/powershell/v1.2.3/workspace/reference/'))).toBe(true)
    expect(related.every((link) => link.symbol?.command?.kind === 'cmdlet')).toBe(true)
    const external = { ...symbol, command: { ...symbol.command!, relatedLinks: [
      { text: 'External help', href: 'https://example.com/Get-TmuxSnapshot' },
    ] } }
    expect(apiCommandRelatedLinks(external, productApiIndex(model, 'latest'))[0]).toMatchObject({
      text: 'External help', href: 'https://example.com/Get-TmuxSnapshot', symbol: undefined,
    })
  })
  it('includes each public product declaration once, including deeply nested members', () => {
    let payloads = 0
    for (const model of Object.values(API_MODELS)) for (const product of ['workspace', 'mcp'] as const) {
      const expected = symbolsForProduct(model, product).map((symbol) => productApiHref(model, symbol, 'v1.2.3')).sort()
      const actual = navigationLinks(productApiNavigation(model, product, 'v1.2.3')).sort()
      expect(actual, `${model.port} ${product}`).toEqual(expected)
      expect(new Set(actual).size).toBe(actual.length)
      const inventory = productReferenceTree(model, product, 'v1.2.3')
      const sidebar = searchApi(inventory, '').map((record) => apiTreeHref('/reference/', record, inventory.hrefs)).sort()
      // The sidebar leaves out a tuple variant's positional fields, which its page shows, and nothing else.
      const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
      const payload = symbolsForProduct(model, product).filter((symbol) => isTuplePayload(byId.get(symbol.parent ?? ''), symbol))
        .map((symbol) => productApiHref(model, symbol, 'v1.2.3')).sort()
      payloads += payload.length
      expect(expected.filter((href) => !sidebar.includes(href)), `${model.port} ${product} left out of the sidebar`).toEqual(payload)
      expect(sidebar, `${model.port} ${product} selectable sidebar`).toEqual(expected.filter((href) => !payload.includes(href)))
    }
    expect(payloads, 'a product with a tuple variant').toBeGreaterThan(0)
  })

  it('opens the PowerShell workspace module into all nine cmdlets', () => {
    const [module] = productApiNavigation(API_MODELS.powershell, 'workspace', 'latest')
    expect(module).toMatchObject({ type: 'group', label: 'LibTmux.Workspace', kind: 'module' })
    if (module.type !== 'group') throw new Error('Workspace module must have children')
    expect(module.items).toHaveLength(9)
    expect(module.items).toContainEqual({ type: 'link', label: 'ConvertTo-TmuxWorkspace', kind: 'cmdlet',
      href: '/powershell/latest/workspace/reference/libtmux-workspace-convertto-tmuxworkspace/' })
  })

  it('groups Julia extension functions by their declaring module without inventing module pages', () => {
    const tree = productApiNavigation(API_MODELS.julia, 'mcp', 'latest')
    for (const [name, functions] of [['Base', ['close', 'isopen', 'show', 'showerror']],
      ['ModelContextProtocol', ['close', 'is_connected', 'read_message', 'write_message']]] as const) {
      const group = tree.find((item) => item.label === name)
      expect(group?.type).toBe('group')
      expect(group?.kind).toBe('module')
      expect(group?.href).toBeUndefined()
      if (group?.type !== 'group') throw new Error(`Missing ${name} group`)
      expect(group.items.map((item) => item.label)).toEqual(functions)
      expect(group.items.every((item) => item.href?.startsWith('/julia/latest/mcp/reference/libtmuxmcp-'))).toBe(true)
    }
  })

  it('renders module badges for unlinked scopes and linked owners without adding a false destination', async () => {
    const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
    const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
    async function compile(relative: string, imports: Record<string, string> = {}) {
      const file = new URL(relative, import.meta.url)
      const source = readFileSync(file, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '')
      const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
        resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
      expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
      let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
      for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
      return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    }
    const badge = await compile('../src/components/api/ApiBadge.astro', Object.fromEntries(
      ['api-labels', 'api-glossary'].map((name) => [`../../lib/${name}`, new URL(`../src/lib/${name}.ts`, import.meta.url).href])))
    const link = await compile('../src/components/docs/SidebarLink.astro', { '../api/ApiBadge.astro': badge })
    const section = await compile('../src/components/docs/SidebarSection.astro', {
      './SidebarLink.astro': link, '../api/ApiBadge.astro': badge,
      // Isolate collection loading; these fixture paths already use one canonical spelling.
      '../../lib/sidebar': 'data:text/javascript,export const isActivePath = (href, currentPath) => href === currentPath',
    })
    const component = (await import(/* @vite-ignore */ section)).default
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      const scopes = productApiNavigation(API_MODELS.julia, 'mcp', 'latest')
        .filter((item) => ['Base', 'ModelContextProtocol'].includes(item.label))
      scopes.push(productApiNavigation(API_MODELS.powershell, 'workspace', 'latest')[0])
      for (const group of scopes) {
        if (group.type !== 'group') throw new Error(`Missing group ${group.label}`)
        const currentPath = navigationLinks(group.items)[0]
        win.document.body.innerHTML = await container.renderToString(component, { props: { ...group, currentPath } })
        const summary = win.document.querySelector('summary')!
        expect(summary.querySelectorAll('.api-nav__kind')).toHaveLength(1)
        const mark = summary.querySelector('.api-nav__kind')!
        expect(mark.textContent).toBe('M')
        expect(mark.getAttribute('aria-hidden')).toBe('true')
        expect(summary.querySelector('.api-nav__label')?.getAttribute('aria-description')).toBe('module')
        expect(summary.querySelector('a')?.getAttribute('href')).toBe(group.href)
        expect(win.document.querySelector('details')?.hasAttribute('open')).toBe(true)
        expect(win.document.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(currentPath)
        expect(Array.from(win.document.querySelectorAll('.sidebar-section__children a')).map((entry) => entry.getAttribute('href')))
          .toEqual(navigationLinks(group.items))
      }
    } finally {
      await win.happyDOM.abort()
    }
  })

  it('does not repeat a single Julia method signature in Markdown or remove its documentation', () => {
    const model = API_MODELS.julia
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmuxMCP.tools')!
    const markdown = symbolMarkdown({ model, symbol, packageName: 'LibTmuxMCP' })
    expect(markdown).not.toContain('### `tools(')
    expect(markdown).toContain("Return a fresh, pure SDK tool catalog containing only the application's enabled tools.")
    expect(markdown).toContain('app')
    const overloaded = model.symbols.find((entry) => entry.id === 'LibTmux.CancellationToken')!
    const overloadMarkdown = symbolMarkdown({ model, symbol: overloaded, packageName: 'LibTmux' })
    expect(overloadMarkdown).toContain('### `')
  })
})

it('keeps the mention audit consistent with rendered prose links', () => {
  for (const row of mentionIndex.dangling) {
    const product = /\/(workspace|mcp)\//.exec(row.page)?.[1] as ApiProduct | undefined
    const decision = decideMention(row.text, { pagePort: row.port, product }, getResolver(), API_MODELS)
    expect(decision.kind, `${row.port} ${row.text} on ${row.page}`).not.toBe('link')
  }
})

it('links parent APIs in native prose without replacing facade APIs', () => {
  const resolver = getResolver()
  for (const [port, name, suffix] of [
    ['fsharp', 'QueryDocument', '/csharp/latest/reference/libtmux-query-querydocument/'],
    ['fsharp', 'Session.Name', '/csharp/latest/reference/libtmux-session-name/'],
    ['fsharp', 'PaneRunResult', '/csharp/latest/reference/libtmux-panerunresult/'],
    ['fsharp', 'PaneWaitRequest', '/csharp/latest/reference/libtmux-panewaitrequest/'],
    ['fsharp', 'PaneWaitResult', '/csharp/latest/reference/libtmux-panewaitresult/'],
    ['fsharp', 'ServerMirror', '/csharp/latest/reference/libtmux-servermirror/'],
    ['fsharp', 'ServerMirrorView', '/csharp/latest/reference/libtmux-servermirrorview/'],
    ['fsharp', 'TmuxOptionKey', '/csharp/latest/reference/libtmux-tmuxoptionkey/'],
    ['kotlin', 'ServerConfig', '/java/latest/reference/io-github-libtmux-serverconfig-serverconfig/'],
  ]) {
    const hit = resolver.resolve(port, name)
    expect(hit.how).toBe('federated')
    expect('href' in hit && hit.href).toBe(suffix)
  }
  const native = resolver.resolve('scala', 'Session.name')
  expect('symbol' in native && native.port).toBe('scala')
  expect('symbol' in native && native.symbol.id).toBe('io.github.libtmux.scaladsl.Session.name')
  const effect = resolver.resolve('scala', 'cats.Session.name')
  expect('symbol' in effect && effect.symbol.id).toBe('io.github.libtmux.scaladsl.cats.Session.name')
  expect(resolver.resolve('fsharp', 'LibTmux.FSharp.Filter`1').how).not.toBe('no-symbol')
  expect(resolver.resolve('go', 'ServerConfig').how).toBe('no-symbol')
})

it('links .NET listings to current F# queries without retaining removed helper targets', () => {
  for (const member of ['Sessions', 'Windows', 'Panes', 'Clients']) {
    const alternatives = referenceAlternatives('csharp', `LibTmux.Server.${member}`)
    const targets = alternatives.flatMap((group) => group.ports.filter((entry) => entry.port === 'fsharp'))
    expect(targets).toHaveLength(1)
    expect(targets[0].href).toBe(`/fsharp/latest/reference/libtmux-fsharp-server-${member.toLowerCase()}/`)
  }
})

it('gives Kotlin, Scala and F# native references with parent type links', () => {
  expect(topLevelTypesOf(API_MODELS.lua).filter((symbol) => symbol.kind === 'typealias')).toEqual([])
  expect(topLevelTypesOf(API_MODELS.scala).filter((symbol) => symbol.kind === 'typealias')).toHaveLength(7)
  for (const port of ['kotlin', 'scala', 'fsharp']) {
    const model = API_MODELS[port]
    expect(PORT_BY_SLUG[port].referenceKind).toBe('model')
    expect(model.symbols.length).toBeGreaterThan(20)
    expect(model.symbols.every((symbol) => !symbol.product || symbol.product === 'core')).toBe(true)
    const index = createApiIndex(model, (symbol) => `/reference/${symbol.slug}/`)
    if (port === 'fsharp') {
      const capture = model.symbols.find((symbol) => symbol.id === 'LibTmux.FSharp.Pane.capture')!
      expect(index.linkType(capture.signatures[0].raw!, capture)
        .find((span) => span.text === 'CapturePaneRequest')?.link?.href)
        .toBe('/csharp/latest/reference/libtmux-capturepanerequest/')
    } else {
      const parent = index.resolve('io.github.libtmux.Server')
      expect(parent?.href).toBe('/java/latest/reference/io-github-libtmux-server-server/')
      const generated = model.symbols.find((symbol) => symbol.source.file.includes('/build/generated/'))!
      expect(model.generatedSources?.[generated.source.file]).toContain('package io.github.libtmux')
    }
  }
})

describe('product reference equivalents', () => {
  it('preserves a removed Swift operator URL without advertising a current operator', () => {
    const model = API_MODELS.swift
    expect(model.symbols.some((symbol) => symbol.id === 'WorkspaceBuilderError.!=(_:_:)')).toBe(false)
    const routes = productApiRedirects({ swift: model }, 'swift', {}, 'latest')
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ path: 'workspace/reference/workspacebuildererror-(_-_-)',
      target: 'workspace/reference/workspacebuildererror', symbol: { id: 'WorkspaceBuilderError' } })
    expect(productApiRoutes({ swift: model }, 'swift', {}, 'latest')
      .some((route) => route.path === routes[0].path)).toBe(false)
    expect(productApiRedirects({ swift: model }, undefined, { swift: 'v0.46.2' }, 'latest')[0].path)
      .toBe(`swift/v0.46.2/${routes[0].path}`)
    expect(productApiRedirects({ swift: model }, 'go', {}, 'latest')).toEqual([])
    expect(productApiRedirects({}, 'swift', {}, 'latest')).toEqual([])
    const oldModel = { ...model, symbols: [...model.symbols, {
      ...routes[0].symbol, id: 'WorkspaceBuilderError.!=(_:_:)',
    }] }
    expect(productApiRedirects({ swift: oldModel }, 'swift', {}, 'v0.1.0')).toEqual([])
  })

  it('keeps body links in the product with the correct target version', () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'workspace.Build')!
    const group = productApiAlternatives(model, symbol, 'v1.2.3', { ts: 'v0.46.2' })[0]
    expect(group.ports.find((entry) => entry.port === 'go')?.href).toBe('/go/v1.2.3/workspace/reference/workspace-build/')
    expect(group.ports.find((entry) => entry.port === 'ts')?.href).toBe('/ts/v0.46.2/workspace/reference/builder-applyworkspace/')
    expect(group.ports.find((entry) => entry.port === 'rs')?.href).toBe('/rs/latest/workspace/reference/src-workspacebuilder-build/')
    expect(referenceAlternatives('go', symbol.id)[0].ports.find((entry) => entry.port === 'ts')?.href).toBe('/ts/latest/workspace/reference/builder-applyworkspace/')
  })

  it('publishes every product declaration in its own reference', () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      const routes = productApiRoutes({ [port]: model }, port, {}, 'v0.46.2')
      for (const product of ['workspace', 'mcp']) {
        const declarations = routes.filter((route) => route.symbol.product === product)
        if (productAvailable(PORT_BY_SLUG[port], product as 'workspace' | 'mcp')) {
          expect(declarations.length, `${port} ${product} declarations`).toBeGreaterThan(0)
        } else {
          expect(declarations, `${port} ${product} declarations`).toEqual([])
        }
        for (const route of declarations) {
          const section = `${product}/reference`
          expect(route.path).toBe(`${section}/${route.symbol.slug}`)
          expect(route.version).toBe('v0.46.2')
        }
      }
    }
  })

  it('preserves absent equivalents rather than inventing product links', () => {
    const model = API_MODELS.py
    const symbol = model.symbols.find((entry) => entry.publicId === 'tmuxp.workspace.freezer.freeze')!
    const group = productApiAlternatives(model, symbol, 'latest', {})[0]
    const typescript = group.ports.find((entry) => entry.port === 'ts')!
    expect(typescript.href).toBeUndefined()
    expect(typescript.absent).toContain('does not export live sessions')
  })
})

it('keeps the supporting-type import boundary in a product Markdown export', () => {
  const model = API_MODELS.ts
  const symbol = model.symbols.find((entry) => entry.id === 'mcp.startup.ServerStartup')!
  expect(symbol.apiScope).toBe('supporting')
  const markdown = symbolMarkdown({ model, symbol, packageName: '@libtmux/mcp' })
  expect(markdown).toContain('This type appears in public signatures. It is not a package entry point.')
})
