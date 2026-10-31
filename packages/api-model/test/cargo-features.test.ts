import { describe, expect, it } from 'vitest'
import { cargoFeatureHref, documentedFeature } from '../src/cargo-features.ts'
import { SymbolIndex } from '../src/link.ts'
import type { ApiSource, ApiSymbol } from '../src/model.ts'

describe('the docs.rs page of a Cargo feature', () => {
  it('is the crate\'s features page at the version, with the feature\'s own name as the anchor', () => {
    expect(cargoFeatureHref('libtmux', 'control-mode', 'latest')).toBe('https://docs.rs/crate/libtmux/latest/features#control-mode')
    expect(cargoFeatureHref('tmux-workspace', 'cli', '0.1.0-alpha.15')).toBe('https://docs.rs/crate/tmux-workspace/0.1.0-alpha.15/features#cli')
  })

  it('leaves out characters a URL cannot hold', () => {
    expect(cargoFeatureHref('libtmux', 'a b/c', 'latest')).toBe('https://docs.rs/crate/libtmux/latest/features#a%20b%2Fc')
  })
})

describe('a feature docs.rs documents', () => {
  it.each(['default', 'control-mode', 'wrap_help', 'unstable-fuzzing'])('includes %s', (name) => {
    expect(documentedFeature(name)).toBe(true)
  })

  it.each(['_derive', '_', '__private'])('leaves out the private feature %s, which has no anchor', (name) => {
    expect(documentedFeature(name)).toBe(false)
  })
})

describe('a Cargo feature named in a symbol\'s attribute', () => {
  const sources: ApiSource[] = [
    { product: 'core', package: 'libtmux', repo: 'libtmux/libtmux-rs', version: '0.1.0-alpha.15', features: ['default', 'control-mode', 'query', 'derive'] },
    { product: 'workspace', package: 'tmux-workspace', repo: 'libtmux/libtmux-rs', version: '0.1.0-alpha.16', features: ['default', 'cli'] },
    { product: 'mcp', package: 'tmux-mcp', repo: 'libtmux/libtmux-rs', version: '0.1.0-alpha.17', features: [] },
  ]
  const symbol = (product?: ApiSymbol['product']): ApiSymbol => ({
    id: 'pane.Pane.stream', name: 'stream', kind: 'method', modifiers: [], signatures: [], source: { file: 'pane.rs' }, ...(product ? { product } : {}),
  })
  const index = (versionOf: (source: ApiSource) => string = () => 'latest', from = sources) => {
    const built = new SymbolIndex([], () => '/', 'rs')
    built.addCargoFeatures(from, versionOf)
    return built
  }

  it('links to the docs.rs features page of the crate it is written in, as an external link', () => {
    expect(index().cargoFeature('control-mode', symbol('core'))).toEqual({
      href: 'https://docs.rs/crate/libtmux/latest/features#control-mode', external: true, project: 'docs.rs features',
    })
  })

  it('shows each crate the version the caller names for it, as crates of one repository carry their own', () => {
    const own = index((source) => source.version!)
    expect(own.cargoFeature('control-mode', symbol('core'))?.href).toBe('https://docs.rs/crate/libtmux/0.1.0-alpha.15/features#control-mode')
    expect(own.cargoFeature('cli', symbol('workspace'))?.href).toBe('https://docs.rs/crate/tmux-workspace/0.1.0-alpha.16/features#cli')
    expect(index((source) => source.product === 'core' ? 'latest' : source.version!).cargoFeature('cli', symbol('workspace'))?.href)
      .toBe('https://docs.rs/crate/tmux-workspace/0.1.0-alpha.16/features#cli')
  })

  it('treats a symbol with no product as the core crate\'s', () => {
    expect(index().cargoFeature('query', symbol())?.href).toBe('https://docs.rs/crate/libtmux/latest/features#query')
  })

  it.each([
    ['a feature the crate does not declare', 'native', 'core'],
    ['a feature of another crate', 'cli', 'core'],
    ['a feature of the core crate, named in the workspace crate', 'control-mode', 'workspace'],
    ['any feature of a crate with none', 'default', 'mcp'],
    ['a name that is a dependency, not a feature', 'tokio', 'core'],
  ] as const)('links nothing for %s', (_, feature, product) => {
    expect(index().cargoFeature(feature, symbol(product))).toBeUndefined()
  })

  it('links no private feature, whatever a list holds: docs.rs shows it no anchor to land on', () => {
    const listed = index(() => 'latest', [{ ...sources[0]!, features: ['_derive', 'derive', '_'] }])
    expect(listed.cargoFeature('derive', symbol('core'))?.href).toBe('https://docs.rs/crate/libtmux/latest/features#derive')
    expect(listed.cargoFeature('_derive', symbol('core'))).toBeUndefined()
    expect(listed.cargoFeature('_', symbol('core'))).toBeUndefined()
  })

  it('links nothing before the model\'s features are known', () => {
    expect(new SymbolIndex([], () => '/', 'rs').cargoFeature('control-mode', symbol('core'))).toBeUndefined()
  })
})
