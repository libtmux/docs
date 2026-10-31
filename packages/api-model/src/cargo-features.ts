/**
 * Cargo features as docs.rs shows them. This file imports nothing: the site renders from it, and a staged publication
 * copies `packages/api-model` without the repository's dependencies. Reading a manifest is extraction's job, in
 * `scripts/lib/cargo-features.mjs`.
 */

/** Cargo reserves a leading underscore for a private feature, and docs.rs gives it no entry or anchor. */
export const documentedFeature = (name: string): boolean => !name.startsWith('_')

/**
 * Where docs.rs documents a feature: one page per crate and version, with an anchor named for each feature.
 * `version` is a crate version or `latest`.
 */
export function cargoFeatureHref(crate: string, feature: string, version: string): string {
  return `https://docs.rs/crate/${encodeURIComponent(crate)}/${encodeURIComponent(version)}/features#${encodeURIComponent(feature)}`
}
