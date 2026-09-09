import { describe, expect, it } from 'vitest'
import { API_MODELS, referenceAlternatives } from '../src/lib/api-models'
import { productApiAlternatives, productApiRoutes } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

describe('product reference equivalents', () => {
  it('keeps body links in the product with the correct target version', () => {
    const model = API_MODELS.go
    const symbol = model.symbols.find((entry) => entry.id === 'workspace.Build')!
    const group = productApiAlternatives(model, symbol, 'v1.2.3', { ts: 'stable' })[0]
    expect(group.ports.find((entry) => entry.port === 'go')?.href).toBe('/go/v1.2.3/workspace/internals/api/workspace-build/')
    expect(group.ports.find((entry) => entry.port === 'ts')?.href).toBe('/ts/stable/workspace/internals/api/builder-applyworkspace/')
    expect(group.ports.find((entry) => entry.port === 'rs')?.href).toBe('/rs/latest/workspace/internals/api/src-workspacebuilder-build/')
    expect(referenceAlternatives('go', symbol.id)[0].ports.find((entry) => entry.port === 'ts')?.href).toBe('/reference/ts/builder-applyworkspace/')
  })

  it('publishes every workspace declaration under Internals without moving MCP APIs', () => {
    for (const [port, model] of Object.entries(API_MODELS)) {
      const routes = productApiRoutes({ [port]: model }, port, {}, 'stable')
      for (const product of ['workspace', 'mcp']) {
        const declarations = routes.filter((route) => route.symbol.product === product)
        expect(declarations.length, `${port} ${product} declarations`).toBeGreaterThan(0)
        for (const route of declarations) {
          const section = product === 'workspace' ? 'workspace/internals/api' : 'mcp/api'
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
