import { parse } from 'smol-toml'
import { documentedFeature } from '../../packages/api-model/src/cargo-features.ts'

/**
 * The features a Cargo manifest's `[features]` table declares and docs.rs documents, in the order it writes them.
 *
 * Only the table counts: an optional dependency makes an implicit feature of its own, and a dependency's `features`
 * key lists another crate's. `default` is a feature like the rest. A private feature, one whose name starts with an
 * underscore, is left out.
 *
 * Extraction reads the manifests; the site only reads the lists out of the model, so the TOML parser lives here
 * and not in `packages/api-model`, which a staged publication copies without this repository's dependencies.
 */
export function cargoFeatureNames(manifest) {
  const features = parse(manifest).features
  return features && typeof features === 'object' ? Object.keys(features).filter(documentedFeature) : []
}
