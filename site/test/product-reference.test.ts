import { describe, expect, it } from 'vitest'
import { API_MODELS, createApiIndex, referenceAlternatives, topLevelTypesOf } from '../src/lib/api-models'
import { productApiAlternatives, productApiRoutes } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { getResolver } from '../src/lib/prose-resolver'

it('links parent APIs in native prose without replacing facade APIs', () => {
  const resolver = getResolver()
  for (const [port, name, suffix] of [
    ['fsharp', 'QueryDocument', '/dotnet/latest/reference/libtmux-query-querydocument/'],
    ['fsharp', 'Session.Name', '/dotnet/latest/reference/libtmux-session-name/'],
    ['kotlin', 'ServerConfig', '/java/latest/reference/io-github-libtmux-serverconfig-serverconfig/'],
  ]) {
    const hit = resolver.resolve(port, name)
    expect(hit.how).toBe('federated')
    expect('href' in hit && hit.href).toBe(suffix)
  }
  const native = resolver.resolve('scala', 'Session.name')
  expect('symbol' in native && native.port).toBe('scala')
  expect(resolver.resolve('fsharp', 'LibTmux.FSharp.Filter`1').how).not.toBe('no-symbol')
  expect(resolver.resolve('go', 'ServerConfig').how).toBe('no-symbol')
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
        .toBe('/dotnet/latest/reference/libtmux-capturepanerequest/')
    } else {
      const parent = index.resolve('io.github.libtmux.Server')
      expect(parent?.href).toBe('/java/latest/reference/io-github-libtmux-server-server/')
      const generated = model.symbols.find((symbol) => symbol.source.file.includes('/build/generated/'))!
      expect(model.generatedSources?.[generated.source.file]).toContain('package io.github.libtmux')
    }
  }
})

describe('product reference equivalents', () => {
  it('keeps body links in the product with the correct target version', () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'workspace.Build')!
    const group = productApiAlternatives(model, symbol, 'v1.2.3', { ts: 'stable' })[0]
    expect(group.ports.find((entry) => entry.port === 'go')?.href).toBe('/go/v1.2.3/workspace/reference/workspace-build/')
    expect(group.ports.find((entry) => entry.port === 'ts')?.href).toBe('/ts/stable/workspace/reference/builder-applyworkspace/')
    expect(group.ports.find((entry) => entry.port === 'rs')?.href).toBe('/rs/latest/workspace/reference/src-workspacebuilder-build/')
    expect(referenceAlternatives('go', symbol.id)[0].ports.find((entry) => entry.port === 'ts')?.href).toBe('/ts/latest/workspace/reference/builder-applyworkspace/')
  })

  it('publishes every product declaration in its own reference', () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      const routes = productApiRoutes({ [port]: model }, port, {}, 'stable')
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
          expect(route.version).toBe('stable')
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
