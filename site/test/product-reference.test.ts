import { describe, expect, it } from 'vitest'
import { API_MODELS, createApiIndex, referenceAlternatives, topLevelTypesOf } from '../src/lib/api-models'
import { productApiAlternatives, productApiRedirects, productApiRoutes } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { getResolver } from '../src/lib/prose-resolver'
import { decideMention, type ApiProduct } from '@libtmux/api-model'
import mentionIndex from '../src/data/mentions.json'

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
      expect(
        index.linkType(capture.signatures[0].raw!, capture).find((span) => span.text === 'CapturePaneRequest')?.link
          ?.href,
      ).toBe('/csharp/latest/reference/libtmux-capturepanerequest/')
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
    expect(routes[0]).toMatchObject({
      path: 'workspace/reference/workspacebuildererror-(_-_-)',
      target: 'workspace/reference/workspacebuildererror',
      symbol: { id: 'WorkspaceBuilderError' },
    })
    expect(
      productApiRoutes({ swift: model }, 'swift', {}, 'latest').some((route) => route.path === routes[0].path),
    ).toBe(false)
    expect(productApiRedirects({ swift: model }, undefined, { swift: 'stable' }, 'latest')[0].path).toBe(
      `swift/stable/${routes[0].path}`,
    )
    expect(productApiRedirects({ swift: model }, 'go', {}, 'latest')).toEqual([])
    expect(productApiRedirects({}, 'swift', {}, 'latest')).toEqual([])
    const oldModel = {
      ...model,
      symbols: [
        ...model.symbols,
        {
          ...routes[0].symbol,
          id: 'WorkspaceBuilderError.!=(_:_:)',
        },
      ],
    }
    expect(productApiRedirects({ swift: oldModel }, 'swift', {}, 'v0.1.0')).toEqual([])
  })

  it('keeps body links in the product with the correct target version', () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'workspace.Build')!
    const group = productApiAlternatives(model, symbol, 'v1.2.3', { ts: 'stable' })[0]
    expect(group.ports.find((entry) => entry.port === 'go')?.href).toBe(
      '/go/v1.2.3/workspace/reference/workspace-build/',
    )
    expect(group.ports.find((entry) => entry.port === 'ts')?.href).toBe(
      '/ts/stable/workspace/reference/builder-applyworkspace/',
    )
    expect(group.ports.find((entry) => entry.port === 'rs')?.href).toBe(
      '/rs/latest/workspace/reference/src-workspacebuilder-build/',
    )
    expect(referenceAlternatives('go', symbol.id)[0].ports.find((entry) => entry.port === 'ts')?.href).toBe(
      '/ts/latest/workspace/reference/builder-applyworkspace/',
    )
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
