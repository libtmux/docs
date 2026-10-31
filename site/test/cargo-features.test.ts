import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import type { ApiModel } from '@libtmux/api-model'
import { cargoFeatureNames } from '../../scripts/lib/cargo-features.mjs'

describe('the features a Cargo manifest declares', () => {
  it('lists the keys of the [features] table in the order written, including default and implicit-dependency features', () => {
    const manifest = `[package]
name = "probe"

# The only feature on by default.
[features]
default = ["query"]
full = ["blocking", "query"]
blocking = ["tokio/rt"]
query = ["dep:regex"]

[dependencies]
regex = { version = "1", optional = true }
`
    expect(cargoFeatureNames(manifest)).toEqual(['default', 'full', 'blocking', 'query'])
  })

  it('leaves out a private feature: Cargo reserves a leading underscore, and docs.rs gives it no anchor', () => {
    const manifest = '[features]\n_derive = []\nderive = ["_derive"]\n_private-only = ["derive"]\nwrap_help = []\n'
    expect(cargoFeatureNames(manifest)).toEqual(['derive', 'wrap_help'])
  })

  it('names nothing for a crate with no [features] table, as tmux-mcp has', () => {
    expect(cargoFeatureNames('[package]\nname = "probe"\n\n[dependencies]\nserde = "1"\n')).toEqual([])
  })

  it('does not read a feature out of another table or a dotted key of a dependency', () => {
    const manifest = '[package]\nname = "probe"\n\n[dependencies]\nregex = { version = "1", features = ["unicode"] }\n\n[dependencies.serde]\nversion = "1"\nfeatures = ["derive"]\n'
    expect(cargoFeatureNames(manifest)).toEqual([])
  })
})

describe('the Cargo features of the render path', () => {
  it('import nothing, since a staged publication copies packages/api-model without the repository\'s dependencies', () => {
    const source = readFileSync(new URL('../../packages/api-model/src/cargo-features.ts', import.meta.url), 'utf8')
    expect(source.match(/^\s*import\s/gm) ?? []).toEqual([])
  })
})

describe('the features the Rust model records', () => {
  const model = JSON.parse(readFileSync(new URL('../src/data/api/rs.json', import.meta.url), 'utf8')) as ApiModel
  const sources = model.sources ?? []
  // The checkout `gen-api-model` extracts from. Without it the comparison with the manifests is skipped, not passed.
  const checkout = (process.env.LIBTMUX_DOCS_CHECKOUT_RS ?? '~/work/libtmux/libtmux-rs').replace(/^~/, homedir())
  const manifests = sources.map((source) => {
    try {
      return execFileSync('git', ['-C', checkout, 'show', `${source.extractedRevision}:crates/${source.package}/Cargo.toml`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch { return undefined }
  })

  it('lists each crate\'s features once, as strings docs.rs documents', () => {
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      const names = source.features
      expect(Array.isArray(names), `${source.package} has a feature list`).toBe(true)
      expect(new Set(names).size, `${source.package} lists a feature twice`).toBe(names!.length)
      expect(names!.filter((name) => typeof name !== 'string' || !name || name.startsWith('_')), `${source.package} lists a private or empty name`).toEqual([])
    }
  })

  it.skipIf(manifests.some((manifest) => manifest === undefined))('holds the [features] keys of each crate\'s Cargo.toml at the revision it was extracted from, in the order written, less the private ones', () => {
    sources.forEach((source, index) => {
      const declared = Object.keys(parse(manifests[index]!).features ?? {}).filter((name) => !name.startsWith('_'))
      expect(source.features, source.package).toEqual(declared)
    })
  })
})
