import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { allExtractions, membersOf, sameNameInOtherPorts, seed, symbolById, symbolsOfKind } from '../src/db'
import { MODEL_DIR } from '../src/db/paths'

/**
 * What the projection is for: lookups that stay flat as the store grows.
 *
 * The thresholds are deliberately loose — this asserts a shape, not a
 * stopwatch, and a loaded CI box is allowed to be slow. What it would catch
 * is an index being dropped or a query being rewritten into a scan, which
 * turns microseconds into milliseconds and 1,009 pages into a coffee break.
 */

const hasModels = existsSync(join(MODEL_DIR, 'py.json'))
const describeIfSeeded = hasModels ? describe : describe.skip

describeIfSeeded('api projection performance', () => {
  let seeded: ReturnType<typeof seed>

  beforeAll(() => {
    seeded = seed()
  })

  it('stores every symbol, with no id collisions in any port', () => {
    // Swift used to produce 29 of these: its ids come from the symbol graph's
    // title path, which omits parameter types, so overloads collided —
    // `FilterOperator.equals(_:)` six ways. Fixed upstream by merging
    // overloads into one symbol with several signatures, which is what the
    // reference should render anyway.
    //
    // The guard stays rather than being deleted with the bug. A collision is
    // silent data loss: the insert skips the row and the page renders without
    // it, so nothing downstream can notice.
    const perPort = Object.entries(seeded.collisions)
      .map(([p, n]) => `${p}=${n}`)
      .join(' ')

    expect(seeded.collisions, `id collisions: ${perPort}`).toEqual({})
  })

  it('looks up by id in constant time as the store grows', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const ids = symbolsOfKind('py', version, 'method')
      .slice(0, 500)
      .map((s) => s.id)
    expect(ids.length).toBeGreaterThan(50)

    const start = performance.now()
    for (const id of ids) symbolById('py', version, id)
    const perLookup = (performance.now() - start) / ids.length

    expect(perLookup, `${perLookup.toFixed(4)}ms per lookup`).toBeLessThan(1)
  })

  it('resolves members without scanning the port', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const classes = symbolsOfKind('py', version, 'class').slice(0, 200)

    const start = performance.now()
    for (const c of classes) membersOf('py', version, c.id)
    const perQuery = (performance.now() - start) / classes.length

    expect(perQuery, `${perQuery.toFixed(4)}ms per member query`).toBeLessThan(2)
  })

  it('answers the cross-port question without touching seven files', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const names = symbolsOfKind('py', version, 'class')
      .slice(0, 200)
      .map((s) => s.name)

    const start = performance.now()
    for (const name of names) sameNameInOtherPorts(name, version, 'py')
    const perQuery = (performance.now() - start) / names.length

    expect(perQuery, `${perQuery.toFixed(4)}ms per cross-port query`).toBeLessThan(2)
  })
})
