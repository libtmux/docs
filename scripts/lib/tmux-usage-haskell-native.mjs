import { createHash } from 'node:crypto'

const digest = (text) => createHash('sha256').update(text).digest('hex')
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
const COMMIT = /^(?:[a-f\d]{40}|[a-f\d]{64})$/

/**
 * A reviewed queued transport needs exact source and public-symbol coverage, not guessed call flow.
 *
 * The profile names the commit it was reviewed at. The scan reads the inventory and every file at the model's
 * commit, so another commit qualifies only when those bytes match their digests and the model equals the reviewed
 * one once its own commit id reads as the reviewed id.
 */
export function qualifyNativeHaskell({ model, symbols, inventory, readSource, profile, claims }) {
  const fail = (reason) => { throw new Error(`Native Haskell usage qualification: ${reason}`) }
  if (profile.schemaVersion !== 1 || profile.repository !== model.repo || !COMMIT.test(profile.revision) || !COMMIT.test(model.revision)) fail('repository differs from its reviewed profile, or a revision is not a full commit id')
  const inputs = inventory.filter((path) => /^(?:src|internal|cbits)\//.test(path)
    || /^(?:\.tool-versions|cabal\.project|[^/]+\.cabal)$/.test(path))
  if (!profile.files || !same(Object.keys(profile.files), inputs)) fail('source inventory differs from its reviewed profile')
  for (const [path, expected] of Object.entries(profile.files)) {
    const text = readSource(path)
    if (typeof text !== 'string' || !/^[a-f\d]{64}$/.test(expected) || digest(text) !== expected) fail(`source bytes changed in ${path}`)
  }
  const modelShape = { symbols: model.symbols, sources: model.sources, exportGroups: model.exportGroups,
    build: model.nativeProvenance?.exporter?.build }
  // The exporter cites the selected commit in `revision` fields and source links. Under another commit, any citation of
  // the reviewed id is stale, and every citation of the model's own id stands for the reviewed one.
  const shown = JSON.stringify(modelShape)
  const moved = model.revision !== profile.revision
  if ((moved && shown.includes(profile.revision)) || digest(moved ? shown.replaceAll(model.revision, profile.revision) : shown) !== profile.modelSha256) fail('public model or native build metadata differs from the profile')
  if (digest(JSON.stringify(claims)) !== profile.claimsSha256) fail('reviewed claims differ from the profile')
  const kinds = new Set(['sends', 'caller-io', 'pure', 'local-recovery', 'value'])
  const classified = new Map()
  for (const group of profile.classifications ?? []) {
    if (!kinds.has(group.kind) || !group.why?.trim() || !Array.isArray(group.symbols) || !group.symbols.length) fail('invalid public classification')
    for (const symbol of group.symbols) {
      if (typeof symbol !== 'string' || classified.has(symbol)) fail(`duplicate or invalid public classification: ${symbol}`)
      classified.set(symbol, group.kind)
    }
  }
  if (!same(classified.keys(), symbols.map((symbol) => symbol.id))) fail('public classification is incomplete or stale')
  if (!same(new Set(claims.map((claim) => claim.symbol)), [...classified].filter(([, kind]) => kind === 'sends').map(([symbol]) => symbol))) fail('claims and sending classifications disagree')
  return profile.files
}
