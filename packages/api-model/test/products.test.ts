import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ApiModel, ApiSymbol } from '../src/model.ts'
import { sourceUrl, symbolsForProduct } from '../src/products.ts'

const symbol: ApiSymbol = {
  id: 'tmuxp.WorkspaceBuilder', name: 'WorkspaceBuilder', kind: 'class',
  modifiers: [], signatures: [], product: 'workspace',
  source: { file: 'src/tmuxp/workspace/builder.py', line: 42, repo: 'tmux-python/tmuxp', revision: 'abc123' },
}
const model: ApiModel = { port: 'py', extractor: 'test', repo: 'tmux-python/libtmux', revision: 'def456', symbols: [symbol] }

describe('product reference provenance', () => {
  it('links a separate product repository and revision', () => {
    expect(sourceUrl(model, symbol)).toBe('https://github.com/tmux-python/tmuxp/blob/abc123/src/tmuxp/workspace/builder.py#L42')
  })

  it('keeps legacy core links and omits unknown line numbers', () => {
    const core = { ...symbol, product: undefined, source: { file: 'src/libtmux/pane.py' } }
    expect(sourceUrl(model, core)).toBe('https://github.com/tmux-python/libtmux/blob/def456/src/libtmux/pane.py')
    expect(symbolsForProduct({ ...model, symbols: [symbol, core] }, 'core')).toEqual([core])
    expect(symbolsForProduct({ ...model, symbols: [symbol, core] }, 'workspace')).toEqual([symbol])
  })

  it('does not invent a repository for an unproven source', () => {
    expect(sourceUrl({ ...model, repo: undefined }, { ...symbol, source: { file: 'api.py' } })).toBeUndefined()
  })
})

describe('generated product coverage', () => {
  for (const port of ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']) {
    it(`${port} has source-proven workspace and MCP declarations`, () => {
      const generated = JSON.parse(readFileSync(new URL(`../../../site/src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
      for (const product of ['workspace', 'mcp'] as const) {
        const symbols = symbolsForProduct(generated, product)
        expect(symbols.length).toBeGreaterThan(0)
        const sources = generated.sources?.filter((source) => source.product === product) ?? []
        for (const symbol of symbols) {
          expect(sources.some((source) => source.repo === symbol.source.repo && source.extractedRevision === symbol.source.extractedRevision)).toBe(true)
          expect(symbol.source.file).not.toMatch(/^(?:\/|\.\.)/)
        }
      }
    })
  }
})
