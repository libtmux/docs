import { describe, expect, it } from 'vitest'
import { cargoFeatureHref, documentedFeature } from '../src/cargo-features.ts'

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
