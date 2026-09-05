import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  allExtractions,
  extractionOf,
  membersOf,
  sameNameInOtherPorts,
  seed,
  symbolById,
  symbolByPublicId,
  symbolsOfKind,
} from '../src/db'
import { MODEL_DIR } from '../src/db/paths'

/**
 * The API projection, against the real extracted models.
 *
 * These are not fixtures: the point of the store is that it answers questions
 * over all eight ports at once, and a fixture with two invented symbols would
 * not exercise the thing that matters — that ids from eight different
 * extractors, with three incompatible naming grammars, coexist in one table.
 */

const hasModels = existsSync(join(MODEL_DIR, 'py.json'))
const describeIfSeeded = hasModels ? describe : describe.skip

describeIfSeeded('api projection', () => {
  beforeAll(() => {
    seed()
  })

  it('holds every port that has an extracted model', () => {
    const ports = new Set(allExtractions().map((e) => e.port))
    expect(ports.size).toBeGreaterThanOrEqual(8)
  })

  it('records provenance per port and version, not per symbol', () => {
    const rows = allExtractions()
    for (const row of rows) {
      expect(row.extractor, `${row.port}@${row.version} extractor`).toBeTruthy()
      expect(row.symbols, `${row.port}@${row.version} symbol count`).toBeGreaterThan(0)
    }
    // The field that explains why some ports carry resolved cross-references
    // and others do not is queryable rather than implied.
    const extractors = new Set(rows.map((r) => r.extractor))
    expect(extractors.size).toBeGreaterThan(1)
  })

  it('round-trips a symbol by its declaration id', () => {
    const model = JSON.parse(readFileSync(join(MODEL_DIR, 'py.json'), 'utf8'))
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const sample = model.symbols[100]

    const row = symbolById('py', version, sample.id)
    expect(row, `py ${sample.id}`).toBeTruthy()
    expect(row!.name).toBe(sample.name)
    expect(row!.kind).toBe(sample.kind)
  })

  it('stores every port with the same key, whatever its id grammar', () => {
    // C++ writes `libtmux::Server::wait_for`, Swift writes `Server.buffers()`,
    // Python writes dots. Nothing in the schema parses any of them.
    for (const port of ['py', 'cxx', 'swift']) {
      const extraction = allExtractions().find((e) => e.port === port)
      if (!extraction) continue
      const classes = symbolsOfKind(port, extraction.version, 'class')
      const any = classes[0] ?? symbolsOfKind(port, extraction.version, 'struct')[0]
      if (!any) continue
      expect(symbolById(port, extraction.version, any.id)?.id).toBe(any.id)
    }
  })

  it('finds a type and its members', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const classes = symbolsOfKind('py', version, 'class')
    expect(classes.length).toBeGreaterThan(0)

    const withMembers = classes
      .map((c) => ({ c, members: membersOf('py', version, c.id) }))
      .find((x) => x.members.length > 0)

    expect(withMembers, 'some class has members').toBeTruthy()
    for (const m of withMembers!.members) expect(m.parent).toBe(withMembers!.c.id)
  })

  it('resolves an anchor through public_id', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    const anchored = symbolsOfKind('py', version, 'class').find((s) => s.public_id)
    expect(anchored, 'a class with a public id').toBeTruthy()
    expect(symbolByPublicId('py', version, anchored!.public_id!)?.id).toBe(anchored!.id)
  })

  it('links one name across ports', () => {
    const version = allExtractions().find((e) => e.port === 'py')!.version
    // `Server` is the one concept every port agrees on by name.
    const others = sameNameInOtherPorts('Server', version, 'py')
    const ports = new Set(others.map((o) => o.port))
    expect(ports.size, `Server found in: ${[...ports].join(', ')}`).toBeGreaterThan(2)
    expect(ports.has('py')).toBe(false)
  })

  it('answers a missing symbol with undefined rather than throwing', () => {
    expect(symbolById('py', 'latest', 'nothing.like.this')).toBeUndefined()
    expect(extractionOf('nosuchport', 'latest')).toBeUndefined()
  })
})
